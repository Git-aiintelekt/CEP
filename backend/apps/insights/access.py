"""Who may open a report or a dashboard, and which rows a person may see.

Sharing: a report or a dashboard is its owner's, or the workspace's (visibility), and besides can be shared with named
people and roles (report_share, dashboard_share, patch 0060), each with view or edit. A share with a role reaches everyone
holding the role. The owner and report administrators share; a share with edit lets someone with report.edit change it.

    GET            /insights/principals/?q=                 people and roles to share with or to write a rule for
    GET, PUT       /insights/reports/<id>/shares/           the visibility and the shares, replaced as a whole
    GET, PUT       /insights/dashboards/<id>/shares/

Row access: a rule (report_row_rule, patch 0060) lets a person or a role see only some values of one field of a dataset,
such as a store manager seeing only their stores. Every run of that dataset for them (reports, dashboard tiles, slicer
values, exports, deliveries made in their name) gets an IN rule per field, the values of all their rules on the field
together; rules on different fields all apply. A rule on a field the dataset no longer offers refuses the run rather
than showing everything. The query window of a workspace's own database runs SQL as written and is not limited.

    GET, POST      /insights/row-rules/                     the rules (report.admin), and the datasets and fields they can name
    PUT, DELETE    /insights/row-rules/<id>/
"""
import json
import uuid

from django.core.cache import cache
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode
from apps.delivery.engine import session
from apps.tenants import context

KINDS = ("user", "role")
PERMISSIONS = ("view", "edit")
TABLES = {"report": ("report_share", "report_id", "report"), "dashboard": ("dashboard_share", "dashboard_id", "dashboard")}
MAX_SHARES, MAX_VALUES = 100, 500
RULE_TYPES = ("string", "number", "boolean")


class AccessError(Exception):
    """A rule this person is under cannot be applied; the message is for the person."""


def _q(sql, args=()):
    with session.connection().cursor() as cursor:
        cursor.execute(sql, args)
        if cursor.description:
            names = [c[0] for c in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]
        return cursor.rowcount


def _has(request, code: str) -> bool:
    return HasPermissionCode.for_(code)().has_permission(request, None)


def present(table: str) -> bool:
    """whether a table of patch 0060 is there yet; until it is, nothing is shared through it and no rule applies"""
    key = f"cep:insights:present:{table}"
    known = cache.get(key)
    if known is None:
        from django.conf import settings
        from django.db import connections
        with connections[settings.PLATFORM_ALIAS].cursor() as cursor:         # a table is there or not whatever the workspace
            cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [table])
            known = bool(cursor.fetchone()[0])
        cache.set(key, known, 60)
    return known


def _require(table: str) -> None:
    if not present(table):
        raise Conflict("This needs database patch 0060, which is not applied yet. Ask your platform team.")


# ---------------------------------------------------------------------------------------------------- sharing in SQL
def _reach(alias: str, permission: str | None = None) -> str:
    """the share row reaches the person: shared with them, or with one of their roles"""
    edit = " AND s.permission = 'edit'" if permission == "edit" else ""
    return (f"((s.principal_kind = 'user' AND s.principal_id = %s) OR (s.principal_kind = 'role' AND s.principal_id IN "
            f"(SELECT ur.role_id FROM user_role ur WHERE ur.user_id = %s))){edit}")


def visible_sql(kind: str, alias: str, user_id: str, admin: bool) -> tuple[str, list]:
    """The items a person may open: the workspace's, their own, the ones shared with them or their roles; an administrator all."""
    if admin:
        return "TRUE", []
    table, column, _ = TABLES[kind]
    if not present(table):
        return f"({alias}.visibility = 'WORKSPACE' OR {alias}.owner_user_id = %s)", [str(user_id)]
    return (f"({alias}.visibility = 'WORKSPACE' OR {alias}.owner_user_id = %s OR EXISTS (SELECT 1 FROM {table} s WHERE s.{column} = {alias}.id AND {_reach('s')}))",
            [str(user_id), str(user_id), str(user_id)])


def shared_edit_sql(kind: str, alias: str, user_id: str) -> tuple[str, list]:
    """true when the item is shared with the person, or one of their roles, with edit"""
    table, column, _ = TABLES[kind]
    if not present(table):
        return "FALSE", []
    return f"EXISTS (SELECT 1 FROM {table} s WHERE s.{column} = {alias}.id AND {_reach('s', 'edit')})", [str(user_id), str(user_id)]


def shared_any_sql(kind: str, alias: str) -> str:
    table, column, _ = TABLES[kind]
    if not present(table):
        return "FALSE"
    return f"EXISTS (SELECT 1 FROM {table} s WHERE s.{column} = {alias}.id)"


# ---------------------------------------------------------------------------------------------------- people and roles
def _people(tenant_id, ids=None, q: str = "") -> list[dict]:
    where, args = ["u.tenant_id = %s", "u.deleted_at IS NULL", "u.is_active"], [str(tenant_id)]
    if ids is not None:
        where.append("u.id::text = ANY(%s)"); args.append(list(ids))
    if q:
        where.append("(u.display_name ILIKE %s OR u.email ILIKE %s)"); args += [f"%{q}%", f"%{q}%"]
    return [{"kind": "user", "id": r["id"], "name": r["display_name"] or r["email"], "detail": r["email"]}
            for r in _q(f"SELECT u.id::text, u.display_name, u.email FROM app_user u WHERE {' AND '.join(where)} ORDER BY u.display_name LIMIT 50", args)]


def _roles(tenant_id, ids=None, q: str = "") -> list[dict]:
    where, args = ["r.tenant_id = %s", "r.deleted_at IS NULL"], [str(tenant_id)]
    if ids is not None:
        where.append("r.id::text = ANY(%s)"); args.append(list(ids))
    if q:
        where.append("r.name ILIKE %s"); args.append(f"%{q}%")
    rows = _q(f"""SELECT r.id::text, r.name, (SELECT count(*) FROM user_role ur JOIN app_user u ON u.id = ur.user_id AND u.deleted_at IS NULL WHERE ur.role_id = r.id) AS people
                    FROM role r WHERE {' AND '.join(where)} ORDER BY r.name LIMIT 50""", args)
    return [{"kind": "role", "id": r["id"], "name": r["name"], "detail": f"{r['people']} {'person' if r['people'] == 1 else 'people'}"} for r in rows]


def _named(tenant_id, items: list[dict]) -> dict[tuple[str, str], dict]:
    """the people and roles these principals are, by (kind, id)"""
    users = {p["id"]: p for p in _people(tenant_id, [i["id"] for i in items if i["kind"] == "user"])} if any(i["kind"] == "user" for i in items) else {}
    roles = {r["id"]: r for r in _roles(tenant_id, [i["id"] for i in items if i["kind"] == "role"])} if any(i["kind"] == "role" for i in items) else {}
    return {**{("user", k): v for k, v in users.items()}, **{("role", k): v for k, v in roles.items()}}


class PrincipalsView(APIView):
    """People and roles of the workspace, for a share or a row rule; anyone who builds reports may look them up."""
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        if not (_has(request, "report.edit") or _has(request, "report.admin")):
            raise PermissionDenied("Sharing needs the report.edit permission.")
        tenant_id = context.require().tenant_id
        q = " ".join(str(request.query_params.get("q") or "").split())[:100]
        return Response({"people": _people(tenant_id, q=q), "roles": _roles(tenant_id, q=q)})


# ---------------------------------------------------------------------------------------------------- shares
def _principal(raw, where: str) -> tuple[str, str]:
    kind = raw.get("kind") if isinstance(raw, dict) else None
    try:
        principal = str(uuid.UUID(str(raw.get("id")))) if isinstance(raw, dict) else ""
    except ValueError:
        principal = ""
    if kind not in KINDS or not principal:
        raise ValidationError({where: "Name a person or a role."})
    return kind, principal


def shares_of(kind: str, item_id: str, tenant_id) -> list[dict]:
    table, column, _ = TABLES[kind]
    if not present(table):
        return []
    rows = _q(f"SELECT principal_kind, principal_id::text, permission FROM {table} WHERE {column} = %s ORDER BY created_at", [str(item_id)])
    named = _named(tenant_id, [{"kind": r["principal_kind"], "id": r["principal_id"]} for r in rows])
    out = []
    for r in rows:
        who = named.get((r["principal_kind"], r["principal_id"]))
        if who:                                                            # a person who left or a role deleted no longer shows
            out.append({**who, "permission": r["permission"]})
    return out


def _item(kind: str, item_id, request) -> dict:
    """the item, if this person may open it; and whether they may share it (the owner, or a report administrator)"""
    admin = _has(request, "report.admin")
    where, args = visible_sql(kind, "i", str(request.user.pk), admin)
    _, _, table = TABLES[kind]
    rows = _q(f"SELECT i.id::text, i.name, i.visibility, i.owner_user_id::text FROM {table} i WHERE i.id = %s AND i.deleted_at IS NULL AND {where}", [str(item_id), *args])
    if not rows:
        raise NotFound(f"No such {kind}.")
    row = rows[0]
    row["can_share"] = admin or str(row["owner_user_id"]) == str(request.user.pk)
    return row


class _SharesView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("report.view")]
    kind = "report"

    @extend_schema(responses={200: None})
    def get(self, request, version=None, item_id=None):
        tenant_id = context.require().tenant_id
        row = _item(self.kind, item_id, request)
        return Response({"visibility": row["visibility"], "shares": shares_of(self.kind, row["id"], tenant_id), "can_share": row["can_share"]})

    @extend_schema(responses={200: None})
    def put(self, request, version=None, item_id=None):
        tenant_id = context.require().tenant_id
        row = _item(self.kind, item_id, request)
        if not row["can_share"]:
            raise PermissionDenied(f"Only the {self.kind}'s owner, or a report administrator, can share it.")
        _require(TABLES[self.kind][0])
        body = request.data if isinstance(request.data, dict) else {}
        visibility = str(body.get("visibility") or row["visibility"]).upper()
        if visibility not in ("PRIVATE", "WORKSPACE"):
            raise ValidationError({"visibility": "PRIVATE or WORKSPACE."})
        raw = body.get("shares", [])
        if not isinstance(raw, list) or len(raw) > MAX_SHARES:
            raise ValidationError({"shares": f"Share with up to {MAX_SHARES} people and roles."})
        wanted, seen = [], set()
        for i, item in enumerate(raw):
            principal_kind, principal_id = _principal(item, f"shares[{i}]")
            permission = item.get("permission", "view")
            if permission not in PERMISSIONS:
                raise ValidationError({f"shares[{i}].permission": "Can view or can edit."})
            if (principal_kind, principal_id) in seen:
                continue
            seen.add((principal_kind, principal_id))
            wanted.append({"kind": principal_kind, "id": principal_id, "permission": permission})
        named = _named(tenant_id, wanted)
        for i, item in enumerate(wanted):
            if (item["kind"], item["id"]) not in named:
                raise ValidationError({f"shares[{i}]": "Not a person or a role of this workspace."})
        table, column, item_table = TABLES[self.kind]
        user_id = str(request.user.pk)
        with session.tx():
            _q(f"DELETE FROM {table} WHERE {column} = %s", [row["id"]])
            for item in wanted:
                _q(f"INSERT INTO {table} (tenant_id, {column}, principal_kind, principal_id, permission, created_by) VALUES (%s, %s, %s, %s, %s, %s)",
                   [str(tenant_id), row["id"], item["kind"], item["id"], item["permission"], user_id])
            if visibility != row["visibility"]:
                _q(f"UPDATE {item_table} SET visibility = %s, updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE id = %s", [visibility, user_id, row["id"]])
        return Response({"visibility": visibility, "shares": shares_of(self.kind, row["id"], tenant_id), "can_share": True})


class ReportSharesView(_SharesView):
    kind = "report"


class DashboardSharesView(_SharesView):
    kind = "dashboard"


# ---------------------------------------------------------------------------------------------------- row access
def rules_for(tenant_id, user_id, dataset_key: str) -> dict[str, list]:
    """the values this person may see per field of the dataset: their own rules and their roles', together"""
    if user_id is None or not present("report_row_rule"):
        return {}
    rows = _q("""SELECT field_key, allowed FROM report_row_rule
                  WHERE tenant_id = %s AND dataset_key = %s
                    AND ((principal_kind = 'user' AND principal_id = %s) OR (principal_kind = 'role' AND principal_id IN (SELECT role_id FROM user_role WHERE user_id = %s)))
                  ORDER BY field_key""", [str(tenant_id), dataset_key, str(user_id), str(user_id)])
    out: dict[str, list] = {}
    for r in rows:
        values = json.loads(r["allowed"]) if isinstance(r["allowed"], str) else (r["allowed"] or [])
        kept = out.setdefault(r["field_key"], [])
        kept.extend(v for v in values if v not in kept)
    return out


def restrict(tenant_id, user, dataset: dict, definition: dict) -> tuple[dict, list[dict]]:
    """The definition with the person's row rules and-ed onto its filters, and what they say (for the note above the rows)."""
    from .definition import DefinitionError, _scalar
    rules = rules_for(tenant_id, getattr(user, "pk", None), dataset["key"])
    if not rules:
        return definition, []
    added, notes = [], []
    for key, values in rules.items():
        field = next((f for f in dataset["fields"] if f["key"] == key), None)
        if field is None:
            raise AccessError("Your access to this data is limited by a rule on a field this dataset no longer offers. Ask your administrator to change the rule.")
        try:
            typed = [_scalar(field["type"], value, "access") for value in values]
        except DefinitionError:
            raise AccessError(f"Your access rule on {field['label']} has a value that is not a {field['type']}. Ask your administrator to change the rule.") from None
        if not typed:
            added.append({"field": key, "operator": "is_null", "value": None})       # a rule with no values shows nothing but the empty ones
        elif "in" in field["operators"]:
            added.append({"field": key, "operator": "in", "value": typed})
        else:
            added.append({"combinator": "or", "rules": [{"field": key, "operator": "=", "value": v} for v in typed]})
        notes.append({"field": key, "label": field["label"], "values": typed})
    filters = definition.get("filters") or {"combinator": "and", "rules": []}
    combined = {"combinator": "and", "rules": [filters, *added]} if filters.get("rules") else {"combinator": "and", "rules": added}
    return {**definition, "filters": combined}, notes


class _RulesBase(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("report.admin")]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _require("report_row_rule")

    def _choices(self, tenant_id) -> list[dict]:
        from . import catalog
        return [{"key": d["key"], "label": d["label"], "fields": [{"key": f["key"], "label": f["label"], "type": f["type"]} for f in d["fields"]
                                                                   if f["role"] == "dimension" and f["type"] in RULE_TYPES]}
                for d in catalog.for_tenant(tenant_id, True)]

    def _body(self, tenant_id, body: dict) -> dict:
        from .definition import DefinitionError, _scalar
        errors = {}
        choices = {d["key"]: d for d in self._choices(tenant_id)}
        dataset = choices.get(str(body.get("dataset") or ""))
        if dataset is None:
            raise ValidationError({"dataset": "Choose one of the datasets this workspace reports on."})
        field = next((f for f in dataset["fields"] if f["key"] == body.get("field")), None)
        if field is None:
            raise ValidationError({"field": "Choose a text, number or yes/no field of the dataset."})
        principal_kind, principal_id = _principal(body.get("principal") or {}, "principal")
        if (principal_kind, principal_id) not in _named(tenant_id, [{"kind": principal_kind, "id": principal_id}]):
            errors["principal"] = "Not a person or a role of this workspace."
        raw = body.get("values")
        if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_VALUES:
            errors["values"] = f"Give 1 to {MAX_VALUES} values."
            raw = []
        values = []
        for value in raw:
            try:
                typed = _scalar(field["type"], value, "values")
            except DefinitionError as exc:
                errors["values"] = f"{value!r}: {exc}"; break
            if typed not in values:
                values.append(typed)
        if errors:
            raise ValidationError(errors)
        return {"dataset_key": dataset["key"], "field_key": field["key"], "principal_kind": principal_kind, "principal_id": principal_id, "allowed": values,
                "note": " ".join(str(body.get("note") or "").split())[:200] or None}

    def _rows(self, tenant_id, rule_id=None) -> list[dict]:
        where, args = ["tenant_id = %s"], [str(tenant_id)]
        if rule_id:
            where.append("id = %s"); args.append(str(rule_id))
        rows = _q(f"""SELECT id::text, dataset_key, field_key, principal_kind, principal_id::text, allowed, note, updated_at, row_version
                        FROM report_row_rule WHERE {' AND '.join(where)} ORDER BY dataset_key, field_key, created_at""", args)
        named = _named(tenant_id, [{"kind": r["principal_kind"], "id": r["principal_id"]} for r in rows])
        choices = {d["key"]: d for d in self._choices(tenant_id)}
        out = []
        for r in rows:
            dataset = choices.get(r["dataset_key"])
            field = next((f for f in (dataset or {}).get("fields", []) if f["key"] == r["field_key"]), None)
            out.append({"id": r["id"], "dataset": r["dataset_key"], "dataset_label": dataset["label"] if dataset else r["dataset_key"], "field": r["field_key"],
                        "field_label": field["label"] if field else r["field_key"], "broken": field is None,
                        "principal": named.get((r["principal_kind"], r["principal_id"]), {"kind": r["principal_kind"], "id": r["principal_id"], "name": "Removed", "detail": ""}),
                        "values": json.loads(r["allowed"]) if isinstance(r["allowed"], str) else r["allowed"], "note": r["note"], "updated_at": r["updated_at"], "row_version": r["row_version"]})
        return out


class RowRulesView(_RulesBase):
    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant_id = context.require().tenant_id
        return Response({"rules": self._rows(tenant_id), "datasets": self._choices(tenant_id)})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        tenant_id = context.require().tenant_id
        data = self._body(tenant_id, request.data if isinstance(request.data, dict) else {})
        if _q("SELECT 1 FROM report_row_rule WHERE tenant_id = %s AND dataset_key = %s AND field_key = %s AND principal_kind = %s AND principal_id = %s",
              [str(tenant_id), data["dataset_key"], data["field_key"], data["principal_kind"], data["principal_id"]]):
            raise ValidationError({"principal": "That person or role already has a rule on this field; change it instead."})
        rule_id, user_id = str(uuid.uuid4()), str(request.user.pk)
        with session.tx():
            _q("""INSERT INTO report_row_rule (id, tenant_id, dataset_key, field_key, principal_kind, principal_id, allowed, note, created_by, updated_by)
                  VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
               [rule_id, str(tenant_id), data["dataset_key"], data["field_key"], data["principal_kind"], data["principal_id"], json.dumps(data["allowed"]), data["note"], user_id, user_id])
        return Response(self._rows(tenant_id, rule_id)[0], status=status.HTTP_201_CREATED)


class RowRuleView(_RulesBase):
    @extend_schema(responses={200: None})
    def put(self, request, version=None, rule_id=None):
        tenant_id = context.require().tenant_id
        current = self._rows(tenant_id, rule_id)
        if not current:
            raise NotFound("No such rule.")
        body = request.data if isinstance(request.data, dict) else {}
        if int(body.get("row_version") or 0) != current[0]["row_version"]:
            return Response({"type": "about:blank", "title": "The rule changed since you opened it", "status": 409, "detail": "Reload it and apply your change again."}, status=status.HTTP_409_CONFLICT)
        data = self._body(tenant_id, {"dataset": current[0]["dataset"], "field": current[0]["field"], "principal": current[0]["principal"], **body})
        with session.tx():
            _q("""UPDATE report_row_rule SET dataset_key = %s, field_key = %s, principal_kind = %s, principal_id = %s, allowed = %s, note = %s, updated_by = %s, updated_at = now(),
                                             row_version = row_version + 1 WHERE tenant_id = %s AND id = %s""",
               [data["dataset_key"], data["field_key"], data["principal_kind"], data["principal_id"], json.dumps(data["allowed"]), data["note"], str(request.user.pk), str(tenant_id), str(rule_id)])
        return Response(self._rows(tenant_id, rule_id)[0])

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, rule_id=None):
        tenant_id = context.require().tenant_id
        with session.tx():
            gone = _q("DELETE FROM report_row_rule WHERE tenant_id = %s AND id = %s", [str(tenant_id), str(rule_id)])
        if not gone:
            raise NotFound("No such rule.")
        return Response(status=status.HTTP_204_NO_CONTENT)
