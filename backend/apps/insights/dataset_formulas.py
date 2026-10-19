"""Shared formulas: measures and calculated columns saved on a dataset (the platform's, a workspace database's or an uploaded
file's), so every report on it reads one definition of Margin or Refund Rate. Written in the formula language
(apps/insights/formula.py), checked against the dataset's fields and the shared formulas before them, and offered in the
catalogue as fields like any other (catalog.for_tenant -> attach); derived.materialize works them out when a report compiles.

    GET, POST        /insights/datasets/<key>/formulas/                 the dataset's shared formulas; POST adds one (report.edit)
    PUT, DELETE      /insights/datasets/<key>/formulas/<id>/            change one, or remove one no report uses
    POST             /insights/datasets/<key>/formulas/<id>/certify/    {certified}: report administrators vouch for it
    POST             /insights/datasets/<key>/formulas/check/           {id?, field}: the check as you type, nothing saved

Certified formulas are changed by report administrators only; anyone else's change would leave the mark on a different sum.
Table report_dataset_formula (patch 0065, row-level security). A formula's key is f_<slug>; reports name it by key in their
columns and by label inside their own formulas, which is how a removal finds the reports that still use it.
"""
from django.core.cache import cache
from django.utils.text import slugify
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.delivery.engine import session
from apps.insights import catalog
from apps.insights.api import VIEW, _can_see_pii, _has, _q, _tenant
from apps.tenants import context

BUILDER = [IsAuthenticated, SameTenant, HasPermissionCode.for_("report.edit") | HasPermissionCode.for_("report.admin")]
MAX_PER_DATASET = 50
NUMBER_FORMATS = ("integer", "decimal", "money", "percent")
COLUMNS = """f.id::text, f.dataset_key, f.key, f.label, f.description, f.kind, f.expression, f.type, f.role, f.format, f.sensitivity, f.certified,
             f.certified_at, cu.display_name AS certified_by_name, f.sort_order, f.created_by::text, au.display_name AS created_by_name, f.created_at, f.updated_at, f.row_version"""


def present() -> bool:
    return bool(_q("SELECT to_regclass('public.report_dataset_formula') IS NOT NULL AS present")[0]["present"])


def _rows(tenant_id, dataset_key: str | None = None) -> list[dict]:
    where, args = "f.tenant_id = %s AND f.deleted_at IS NULL", [str(tenant_id)]
    if dataset_key:
        where += " AND f.dataset_key = %s"
        args.append(dataset_key)
    return _q(f"""SELECT {COLUMNS} FROM report_dataset_formula f LEFT JOIN app_user cu ON cu.id = f.certified_by LEFT JOIN app_user au ON au.id = f.created_by
                   WHERE {where} ORDER BY f.dataset_key, f.sort_order, f.created_at""", args)


def by_dataset(tenant_id) -> dict[str, list[dict]]:
    """the workspace's shared formulas by dataset, as plain data, cached a minute (catalog.TTL)"""
    key = f"cep:insights:formulas:{tenant_id}"
    known = cache.get(key)
    if known is not None:
        return known
    if context.current() is None or context.is_platform() or not present():
        return {}
    known: dict[str, list[dict]] = {}
    for row in _rows(tenant_id):
        known.setdefault(row["dataset_key"], []).append({k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()})
    cache.set(key, known, catalog.TTL)
    return known


def invalidate(tenant_id) -> None:
    cache.delete(f"cep:insights:formulas:{tenant_id}")


def as_field(row: dict) -> dict:
    """a shared formula as a catalogue field: plain data, worked out when a report compiles (derived.materialize)"""
    measure_kind = row["kind"] == "measure"
    type_ = row["type"] if row["type"] in catalog.OPERATORS else "number"
    adds_up = not measure_kind and row.get("role") == "measure"
    dated = type_ in ("date", "datetime")
    return {"key": row["key"], "label": row["label"], "column": None, "type": type_, "role": "measure" if (measure_kind or adds_up) else "dimension",
            "aggregates": ["calc"] if measure_kind else (["sum", "avg", "min", "max", "count"] if adds_up else []),
            "operators": [] if measure_kind else catalog.OPERATORS[type_], "buckets": list(catalog.BUCKETS) if dated and not measure_kind and not adds_up else [],
            "format": row.get("format") or ({"date": "date", "datetime": "datetime"}.get(type_)), "sensitivity": row.get("sensitivity") or "NORMAL",
            "shared": {"id": row["id"], "kind": row["kind"], "expression": row["expression"], "role": row.get("role"), "format": row.get("format"),
                       "certified": bool(row["certified"]), "description": row.get("description"), "certified_by_name": row.get("certified_by_name")}}


def attach(datasets: list[dict], tenant_id, can_see_pii: bool) -> list[dict]:
    """each dataset with its shared formulas among its fields (personal ones locked for a reader without the right), and a
    stamp of them, which the result cache keys carry so a changed formula is read afresh"""
    shared = by_dataset(tenant_id)
    out = []
    for dataset in datasets:
        rows = shared.get(dataset["key"]) or []
        if not rows:
            out.append(dataset)
            continue
        fields, locked = list(dataset["fields"]), list(dataset.get("locked", []))
        for row in rows:
            if row.get("sensitivity") == "PII" and not can_see_pii:
                locked.append({"key": row["key"], "label": row["label"]})
            else:
                fields.append(as_field(row))
        stamp = ",".join(f"{r['id'][:8]}.{r['row_version']}" for r in rows)
        out.append({**dataset, "fields": fields, "locked": locked, "formulas_version": stamp})
    return out


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def usage(tenant_id, dataset_key: str, key: str, label: str) -> int:
    """the reports on the dataset that name the formula: by key in a column, a rule or a sort, or by label in a formula"""
    rows = _q("""SELECT count(*) AS n FROM report WHERE tenant_id = %s AND dataset_key = %s AND deleted_at IS NULL
                   AND (definition::text LIKE %s OR lower(definition::text) LIKE %s)""",
              [str(tenant_id), dataset_key, f'%"{_like(key)}"%', f"%[{_like(label.lower())}]%"])
    return int(rows[0]["n"])


# ---------------------------------------------------------------------------------------------------- checking one
def _dataset(request, key: str, before_id: str | None = None) -> dict:
    """the dataset as a shared formula is written against: its fields and the shared formulas before this one"""
    tenant = _tenant()
    dataset = catalog.dataset(tenant.pk, key, _can_see_pii(request))
    if dataset is None:
        raise NotFound("No such dataset.")
    if before_id:
        keep, seen = [], False
        for field in dataset["fields"]:
            shared = field.get("shared")
            if shared and shared["id"] == before_id:
                seen = True
            if shared and seen:
                continue
            keep.append(field)
        dataset = {**dataset, "fields": keep}
    return dataset


class Problem(ValueError):
    def __init__(self, where: str, message: str, at: int | None = None):
        super().__init__(message)
        self.where, self.at = where, at

    def refused(self) -> ValidationError:
        return ValidationError({self.where: str(self)})


def _checked(dataset: dict, body: dict) -> tuple[dict, dict]:
    """(the spec as derived.check left it, the field it makes), or Problem naming the part and the place"""
    from apps.insights import derived
    kind = body.get("kind")
    if kind not in ("formula", "measure"):
        raise Problem("kind", "A shared formula is a formula for each row or a measure formula.")
    label = " ".join(str(body.get("label") or "").split())[:60]
    if not label:
        raise Problem("label", "Give the formula a name.")
    item = {"label": label, "kind": kind, "expression": body.get("expression"), **({"role": body["role"]} if body.get("role") else {}),
            **({"format": body["format"]} if body.get("format") else {})}
    try:
        spec = derived.check(dataset, [item])[0]
    except derived.DerivedError as exc:
        raise Problem(exc.field.split(".", 1)[-1], str(exc), exc.at) from None
    made = next(f for f in derived.augment(dataset, {"derived": [spec]})["fields"] if f["key"] == spec["key"])
    return spec, made


def _check_label(dataset: dict, label: str, own_key: str | None):
    for field in dataset["fields"]:
        if field["key"] != own_key and " ".join(field["label"].split()).lower() == label.lower():
            raise ValidationError({"label": f"The dataset already has a field called {field['label']}."})


def serialize(row: dict, uses: int | None = None) -> dict:
    out = {k: row[k] for k in ("id", "dataset_key", "key", "label", "description", "kind", "expression", "type", "role", "format", "sensitivity", "certified",
                               "certified_at", "certified_by_name", "created_by_name", "created_at", "updated_at", "row_version")}
    if uses is not None:
        out["reports"] = uses
    return out


def _row(tenant_id, dataset_key: str, formula_id) -> dict:
    found = [r for r in _rows(tenant_id, dataset_key) if r["id"] == str(formula_id)]
    if not found:
        raise NotFound("No such formula.")
    return found[0]


# ---------------------------------------------------------------------------------------------------- the API
class FormulasView(APIView):
    def get_permissions(self):
        return [p() for p in (VIEW if self.request.method == "GET" else BUILDER)]

    @extend_schema(responses={200: None})
    def get(self, request, version=None, dataset=None):
        tenant = _tenant()
        if catalog.dataset(tenant.pk, dataset, _can_see_pii(request)) is None:
            raise NotFound("No such dataset.")
        rows = _rows(tenant.pk, dataset) if present() else []
        return Response({"dataset": dataset, "ready": present(), "can_certify": _has(request, "report.admin"),
                         "formulas": [serialize(r, usage(tenant.pk, dataset, r["key"], r["label"])) for r in rows]})

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None, dataset=None):
        tenant = _tenant()
        if not present():
            raise Conflict("Shared formulas need a database update (patch 0065). Ask your administrator.")
        body = request.data if isinstance(request.data, dict) else {}
        target = _dataset(request, dataset)
        if len([f for f in target["fields"] if f.get("shared")]) >= MAX_PER_DATASET:
            raise ValidationError({"dataset": f"A dataset holds up to {MAX_PER_DATASET} shared formulas."})
        try:
            spec, made = _checked(target, body)
        except Problem as exc:
            raise exc.refused() from None
        _check_label(target, spec["label"], None)
        base = ("f_" + slugify(spec["label"]).replace("-", "_"))[:40].rstrip("_") or "f_formula"
        taken = {f["key"] for f in target["fields"]} | {r["key"] for r in _q("SELECT key FROM report_dataset_formula WHERE tenant_id = %s AND dataset_key = %s",
                                                                          [str(tenant.pk), dataset])}
        key, n = base, 2
        while key in taken:
            key, n = f"{base[:37]}_{n}", n + 1
        description = " ".join(str(body.get("description") or "").split())[:300] or None
        with session.tx():
            made_row = _q("""INSERT INTO report_dataset_formula (tenant_id, dataset_key, key, label, description, kind, expression, type, role, format, sensitivity,
                                                                 sort_order, created_by, updated_by)
                             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                     (SELECT coalesce(max(sort_order), 0) + 1 FROM report_dataset_formula WHERE tenant_id = %s AND dataset_key = %s), %s, %s)
                             RETURNING id::text""",
                          [str(tenant.pk), dataset, key, spec["label"], description, spec["kind"], spec["expression"], spec["type"], spec.get("role"), spec.get("format"),
                           made["sensitivity"], str(tenant.pk), dataset, str(request.user.pk), str(request.user.pk)])
        invalidate(tenant.pk)
        return Response(serialize(_row(tenant.pk, dataset, made_row[0]["id"]), 0), status=status.HTTP_201_CREATED)


class FormulaView(APIView):
    permission_classes = BUILDER

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None, dataset=None, formula_id=None):
        tenant = _tenant()
        current = _row(tenant.pk, dataset, formula_id)
        body = request.data if isinstance(request.data, dict) else {}
        admin = _has(request, "report.admin")
        if current["certified"] and not admin:
            raise PermissionDenied("A certified formula is changed by a report administrator; ask one, or save your version under another name.")
        if body.get("row_version") is not None and int(body["row_version"]) != current["row_version"]:
            raise Conflict("The formula changed since you opened it. Reload and try again.")
        merged = {"label": body.get("label", current["label"]), "kind": current["kind"], "expression": body.get("expression", current["expression"]),
                  "role": body.get("role", current["role"]), "format": body.get("format", current["format"])}
        target = _dataset(request, dataset, before_id=current["id"])
        try:
            spec, made = _checked(target, merged)
        except Problem as exc:
            raise exc.refused() from None
        _check_label(target, spec["label"], current["key"])
        uses = usage(tenant.pk, dataset, current["key"], current["label"])
        if uses and (spec["type"] != current["type"] or spec.get("role") != current["role"] or spec["label"] != current["label"]) and not body.get("confirm"):
            raise Conflict(f"{uses} report{'' if uses == 1 else 's'} use{'s' if uses == 1 else ''} this formula; a new name, type or use can stop "
                           f"{'it' if uses == 1 else 'them'} running. Send confirm to go ahead.")
        description = " ".join(str(body.get("description", current["description"]) or "").split())[:300] or None
        with session.tx():
            _q("""UPDATE report_dataset_formula SET label = %s, description = %s, expression = %s, type = %s, role = %s, format = %s, sensitivity = %s,
                         updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE tenant_id = %s AND id = %s""",
               [spec["label"], description, spec["expression"], spec["type"], spec.get("role"), spec.get("format"), made["sensitivity"], str(request.user.pk),
                str(tenant.pk), current["id"]])
        invalidate(tenant.pk)
        return Response(serialize(_row(tenant.pk, dataset, current["id"]), uses))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, dataset=None, formula_id=None):
        tenant = _tenant()
        current = _row(tenant.pk, dataset, formula_id)
        if current["certified"] and not _has(request, "report.admin"):
            raise PermissionDenied("A certified formula is removed by a report administrator.")
        uses = usage(tenant.pk, dataset, current["key"], current["label"])
        if uses:
            raise Conflict(f"{uses} report{'' if uses == 1 else 's'} use{'s' if uses == 1 else ''} this formula. Take it out of {'it' if uses == 1 else 'them'} first.")
        with session.tx():
            _q("UPDATE report_dataset_formula SET deleted_at = now(), updated_by = %s, row_version = row_version + 1 WHERE tenant_id = %s AND id = %s",
               [str(request.user.pk), str(tenant.pk), current["id"]])
        invalidate(tenant.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class FormulaCertifyView(APIView):
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("report.admin")]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None, dataset=None, formula_id=None):
        tenant = _tenant()
        current = _row(tenant.pk, dataset, formula_id)
        certified = (request.data or {}).get("certified")
        if not isinstance(certified, bool):
            raise ValidationError({"certified": "On or off."})
        with session.tx():
            _q("""UPDATE report_dataset_formula SET certified = %s, certified_by = %s, certified_at = CASE WHEN %s THEN now() END, updated_at = now(),
                         row_version = row_version + 1 WHERE tenant_id = %s AND id = %s""",
               [certified, str(request.user.pk) if certified else None, certified, str(tenant.pk), current["id"]])
        invalidate(tenant.pk)
        return Response(serialize(_row(tenant.pk, dataset, current["id"]), usage(tenant.pk, dataset, current["key"], current["label"])))


class FormulaCheckView(APIView):
    """the check as a shared formula is typed: against the dataset's fields and the shared formulas before it"""
    def get_permissions(self):
        return [p() for p in VIEW]

    @extend_schema(responses={200: None})
    def post(self, request, version=None, dataset=None):
        body = request.data if isinstance(request.data, dict) else {}
        field = body.get("field") if isinstance(body.get("field"), dict) else {}
        target = _dataset(request, dataset, before_id=str(body["id"]) if body.get("id") else None)
        try:
            spec, made = _checked(target, field)
        except Problem as exc:
            return Response({"ok": False, "message": str(exc), "at": exc.at, "where": exc.where})
        checked = made["expression"]["checked"] if made.get("expression") else made["derived"]["checked"]
        return Response({"ok": True, "spec": spec, "role": made["role"], "personal": made["sensitivity"] == "PII", "uses": [f["label"] for f in checked.fields.values()],
                         "analytic": bool(getattr(checked, "analytic", False))})

