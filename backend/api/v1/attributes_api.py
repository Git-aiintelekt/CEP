"""Customer Attributes (apps/customers/attributes.py): Settings → Customer Attributes and its Sources, the Tag Check on a campaign's
Audience and Review steps, Fill From Database, and the push endpoint other systems send values to.

    GET    /customer-attributes/                         the attributes, with how many people have a value and the tags that use each
    POST   /customer-attributes/                         add one (attribute.edit); {make_tag: true} also adds the tag {{key}}
    PATCH  /customer-attributes/{id}/   DELETE           the key is fixed once saved; an attribute a tag reads cannot be removed
    GET    /customer-attributes/sources/                 the sources with their last run
    POST   /customer-attributes/sources/   PATCH/DELETE  /customer-attributes/sources/{id}/
    POST   /customer-attributes/sources/{id}/sync/       Sync Now: a full read of a Report Database source, in the background
    GET    /customer-attributes/sources/{id}/runs/       its recent runs
    GET    /customer-attributes/databases/               the Report Databases a source may read
    GET    /customer-attributes/databases/{id}/tables/   [?table=X: that table's columns]   [&field=Y: a few of its values]
    GET    /customer-attributes/runs/{id}/               one run (Fill From Database is polled here)
    POST   /customer-attributes/tag-check/               {template, include, exclude}: the Tag Check card
    POST   /customer-attributes/fill/                    {include, exclude, tags: [{tag, attribute}]}: Fill From Database (list.edit)
    POST   /customer-attributes/values/                  {system, people: [{id, values: {key: value}}]}: an API source pushes values
                                                        (an API key with the scope attributes:write, or attribute.edit)
"""
from __future__ import annotations

import uuid

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode
from apps.contact_lists import tag_values
from apps.customers import attributes
from apps.customers.models import CustomerAttributeDefinition, CustomerAttributeSource, CustomerAttributeSyncRun
from apps.tenants import context

EDIT = "attribute.edit"
MAX_PUSH = 1000


class ReadOrEdit(BasePermission):
    """Reading: anyone signed in to the workspace (the upload's Tag Values step and Settings → Tags list the attributes). Changing:
    Manage Customer Attributes."""

    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return HasPermissionCode.for_(EDIT)().has_permission(request, view)


class CanPush(BasePermission):
    """An integration key with the scope attributes:write, or a person who manages attributes."""

    def has_permission(self, request, view):
        user = request.user
        if getattr(user, "is_platform_admin", False):
            return True
        if hasattr(user, "has_scope"):
            return user.has_scope("attributes:write")
        return EDIT in user.permission_codes()


def _user_id(request):
    return None if hasattr(request.user, "has_scope") else request.user.id


def _present():
    if not attributes.present():
        raise Conflict("Customer Attributes need database patch 0100. Ask the platform team to apply it.")


def _uuid(value, field: str):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        raise ValidationError({field: "Not a valid id."}) from None


def _counts() -> dict:
    """{key: people with a value}, over every source; cached for five minutes (a large workspace has millions of rows)."""
    tenant = str(context.require().tenant_id)
    key = f"cep:attributes:counts:{tenant}"
    found = cache.get(key)
    if found is None:
        from django.db import connections
        with connections[context.require().db_alias].cursor() as cursor:
            cursor.execute("""SELECT k, count(DISTINCT v.party_id) FROM customer_attribute_values v, jsonb_object_keys(v.data) k
                               WHERE v.tenant_id = %s GROUP BY k""", [tenant])
            found = {k: int(n) for k, n in cursor.fetchall()}
        cache.set(key, found, 300)
    return found


def _forget_counts():
    cache.delete(f"cep:attributes:counts:{context.require().tenant_id}")


def _run_payload(run: CustomerAttributeSyncRun | None) -> dict | None:
    if run is None:
        return None
    return {"id": str(run.pk), "trigger": run.trigger, "trigger_label": attributes.TRIGGER_WORDS.get(run.trigger, run.trigger), "status": run.status,
            "people_read": run.people_read, "people_matched": run.people_matched, "values_changed": run.values_changed, "error": run.error,
            "queued_at": run.queued_at, "started_at": run.started_at, "finished_at": run.finished_at, "params": {k: v for k, v in (run.params or {}).items() if k in ("capped_at", "file")}}


def _database_names() -> dict:
    return {row["id"]: row["name"] for row in attributes.databases_offered()}


def _source_payload(source: CustomerAttributeSource, names: dict | None = None, last=None, counts: dict | None = None) -> dict:
    names = names if names is not None else _database_names()
    return {"id": str(source.pk), "name": source.name, "system": source.system, "kind": source.kind, "kind_label": CustomerAttributeSource.Kind(source.kind).label,
            "report_connection_id": str(source.report_connection_id) if source.report_connection_id else None,
            "database_name": names.get(str(source.report_connection_id)) if source.report_connection_id else None,
            "table_name": source.table_name, "id_column": source.id_column, "is_active": source.is_active, "last_sync_at": source.last_sync_at,
            "last_run": _run_payload(last), "attribute_count": (counts or {}).get(str(source.pk), 0), "row_version": source.row_version}


def _tags_using() -> dict:
    from apps.templates.models import PersonalizationTag
    out: dict[str, list[str]] = {}
    for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True):
        key = tag.tag_key.strip("{} ")
        if tag.resolution_source == "CUSTOMER_ATTRIBUTE" and tag.source_path:
            out.setdefault(tag.source_path, []).append(key)
        elif tag.resolution_source in ("CUSTOMER_MASTER", "CAMPAIGN_LIST_MEMBER") or tag.resolution_source is None:
            out.setdefault(key, [])
    return {k: sorted(set(v)) for k, v in out.items() if v}


def _definition_payload(d: CustomerAttributeDefinition, counts: dict, using: dict) -> dict:
    return {"id": str(d.id), "key": d.key, "label": d.label, "data_type": d.data_type, "data_type_label": CustomerAttributeDefinition.DataType(d.data_type).label,
            "scope": d.scope, "source": {"id": str(d.source.pk), "name": d.source.name, "kind": d.source.kind, "system": d.source.system,
                                          "table_name": d.source.table_name} if d.source else None,
            "source_field": d.source_field, "refresh": d.refresh, "refresh_label": CustomerAttributeDefinition.Refresh(d.refresh).label, "is_pii": d.is_pii,
            "default_value": d.default_value, "is_active": d.is_active, "people_with_value": counts.get(d.key, 0) if d.scope == "CUSTOMER" else None,
            "tags": using.get(d.key, []), "row_version": d.row_version}


# ---------------------------------------------------------------------------------------------------- attributes
class AttributesView(APIView):
    permission_classes = [IsAuthenticated, ReadOrEdit]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        if not attributes.present():
            return Response({"available": False, "attributes": [], "sources": 0, "can_edit": False})
        counts, using = _counts(), _tags_using()
        can_edit = getattr(request.user, "is_platform_admin", False) or (not hasattr(request.user, "has_scope") and EDIT in request.user.permission_codes())
        return Response({"available": True, "attributes": [_definition_payload(d, counts, using) for d in attributes.definitions(active_only=False)],
                         "sources": CustomerAttributeSource.objects.count(), "can_edit": can_edit})

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        _present()
        data = _clean_definition(request.data, None)
        try:
            with transaction.atomic(using=context.require().db_alias):
                definition = CustomerAttributeDefinition.objects.create(tenant_id=context.require().tenant_id, created_by_id=_user_id(request), **data)
                if request.data.get("make_tag"):
                    _make_tag(definition, request)
        except IntegrityError:
            raise ValidationError({"key": "Another attribute already has this key."}) from None
        _forget_counts()
        return Response(_definition_payload(definition, {}, _tags_using()), status=201)


class AttributeView(APIView):
    permission_classes = [IsAuthenticated, ReadOrEdit]

    def _get(self, pk):
        _present()
        return get_object_or_404(CustomerAttributeDefinition.objects.select_related("source"), pk=pk)

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, pk, version=None):
        definition = self._get(pk)
        if "key" in request.data and request.data["key"] != definition.key:
            raise ValidationError({"key": "The key is fixed once saved: tags and templates use it."})
        data = _clean_definition({**_as_body(definition), **request.data}, definition)
        for field, value in data.items():
            setattr(definition, field, value)
        definition.updated_by_id = _user_id(request)
        definition.save()
        definition.refresh_from_db()
        return Response(_definition_payload(definition, _counts(), _tags_using()))

    @extend_schema(responses={204: None})
    def delete(self, request, pk, version=None):
        definition = self._get(pk)
        tags = _tags_using().get(definition.key) or []
        if tags:
            raise Conflict(f"The tag {', '.join('{{' + t + '}}' for t in tags)} reads this attribute. Change or remove the tag first.")
        definition.delete()
        _forget_counts()
        return Response(status=204)


def _as_body(d: CustomerAttributeDefinition) -> dict:
    return {"key": d.key, "label": d.label, "data_type": d.data_type, "scope": d.scope, "source": str(d.source_id) if d.source_id else None,
            "source_field": d.source_field, "refresh": d.refresh, "is_pii": d.is_pii, "default_value": d.default_value, "is_active": d.is_active}


def _clean_definition(body, current: CustomerAttributeDefinition | None) -> dict:
    errors = {}
    key = str(body.get("key") or "").strip()
    if current is None:
        if not attributes.KEY_RE.match(key):
            errors["key"] = "Lower-case letters, digits and underscores, starting with a letter: what goes inside {{ }}."
        elif key in attributes.RESERVED:
            errors["key"] = "C360 already fills this one itself. Choose another key."
        elif CustomerAttributeDefinition.objects.filter(key=key).exists():
            errors["key"] = "Another attribute already has this key."
    label = str(body.get("label") or "").strip()
    if not label or len(label) > 120:
        errors["label"] = "Give the attribute a name of up to 120 characters."
    data_type = str(body.get("data_type") or "TEXT").upper()
    if data_type not in CustomerAttributeDefinition.DataType.values:
        errors["data_type"] = "Choose a type."
    scope = str(body.get("scope") or "CUSTOMER").upper()
    if scope not in CustomerAttributeDefinition.Scope.values:
        errors["scope"] = "Choose what the value belongs to."
    source = None
    if body.get("source"):
        source = CustomerAttributeSource.objects.filter(pk=_uuid(body["source"], "source")).first()
        if source is None:
            errors["source"] = "That source is not in this workspace any more."
    field = str(body.get("source_field") or "").strip() or None
    refresh = str(body.get("refresh") or "").upper() or None
    if source is not None:
        allowed = attributes.REFRESH_BY_KIND[source.kind]
        refresh = refresh if refresh in allowed else allowed[0]
        if source.kind == "DATABASE":
            if scope == "LIST":
                errors["scope"] = "A database value belongs to the customer. A value of one list entry comes from a file."
            if not field or not attributes.IDENT_RE.match(field):
                errors["source_field"] = "Choose the column the value is read from."
        if source.kind == "API" and not field:
            field = key or (current.key if current else None)
    else:
        refresh = "ON_IMPORT"
    default = body.get("default_value")
    default = (str(default).strip() or None) if default is not None else None
    if default and len(default) > 500:
        errors["default_value"] = "Up to 500 characters."
    if errors:
        raise ValidationError(errors)
    data = {"label": label, "data_type": data_type, "scope": scope, "source": source, "source_field": field, "refresh": refresh,
            "is_pii": bool(body.get("is_pii")), "default_value": default, "is_active": body.get("is_active", True) is not False}
    if current is None:
        data["key"] = key
    return data


def _make_tag(definition: CustomerAttributeDefinition, request) -> None:
    """The tag {{key}} that reads the attribute, unless the workspace has a tag with that key already."""
    from apps.templates.models import PersonalizationTag
    if PersonalizationTag.objects.filter(tag_key=definition.key, deleted_at__isnull=True).exists():
        return
    PersonalizationTag.objects.create(tenant_id=definition.tenant_id, tag_key=definition.key, label=definition.label, tag_kind="CUSTOM", source_system="CEP",
                                      resolution_source="CUSTOMER_ATTRIBUTE", source_path=definition.key, default_value=definition.default_value,
                                      data_type=attributes.TAG_TYPE.get(definition.data_type, "STRING"), created_by_id=_user_id(request))


# ---------------------------------------------------------------------------------------------------- sources
def _last_runs(source_ids) -> dict:
    out = {}
    for run in CustomerAttributeSyncRun.objects.filter(source_id__in=list(source_ids)).order_by("source_id", "-queued_at").distinct("source_id"):
        out[str(run.source_id)] = run
    return out


class SourcesView(APIView):
    permission_classes = [IsAuthenticated, ReadOrEdit]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        if not attributes.present():
            return Response({"available": False, "sources": []})
        sources = list(CustomerAttributeSource.objects.order_by("name"))
        runs, names = _last_runs([s.pk for s in sources]), _database_names()
        counts: dict[str, int] = {}
        for source_id in CustomerAttributeDefinition.objects.filter(is_active=True).values_list("source_id", flat=True):
            if source_id:
                counts[str(source_id)] = counts.get(str(source_id), 0) + 1
        return Response({"available": True, "sources": [_source_payload(s, names, runs.get(str(s.pk)), counts) for s in sources]})

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None):
        _present()
        data = _clean_source(request.data, None)
        try:
            with transaction.atomic(using=context.require().db_alias):
                source = CustomerAttributeSource.objects.create(tenant_id=context.require().tenant_id, created_by_id=_user_id(request), **data)
        except IntegrityError:
            raise ValidationError({"name": "Another source already has this name."}) from None
        return Response(_source_payload(source), status=201)


class SourceView(APIView):
    permission_classes = [IsAuthenticated, ReadOrEdit]

    def _get(self, pk):
        _present()
        return get_object_or_404(CustomerAttributeSource, pk=pk)

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, pk, version=None):
        source = self._get(pk)
        if "kind" in request.data and request.data["kind"] != source.kind:
            raise ValidationError({"kind": "A source's kind is fixed. Add a new source instead."})
        body = {"name": source.name, "system": source.system, "kind": source.kind, "report_connection_id": source.report_connection_id,
                "table_name": source.table_name, "id_column": source.id_column, "is_active": source.is_active, **request.data}
        data = _clean_source(body, source)
        for field, value in data.items():
            setattr(source, field, value)
        source.updated_by_id = _user_id(request)
        try:
            with transaction.atomic(using=context.require().db_alias):
                source.save()
        except IntegrityError:
            raise ValidationError({"name": "Another source already has this name."}) from None
        source.refresh_from_db()
        return Response(_source_payload(source, last=_last_runs([source.pk]).get(str(source.pk))))

    @extend_schema(responses={204: None})
    def delete(self, request, pk, version=None):
        source = self._get(pk)
        source.delete()                                   # its values and runs go with it; attributes that read it keep their values elsewhere
        _forget_counts()
        return Response(status=204)


def _clean_source(body, current: CustomerAttributeSource | None) -> dict:
    errors = {}
    name = str(body.get("name") or "").strip()
    if not name or len(name) > 120:
        errors["name"] = "Give the source a name of up to 120 characters."
    system = str(body.get("system") or "").strip().upper().replace(" ", "_")
    if not attributes.SYSTEM_RE.match(system):
        errors["system"] = "The system's short name: letters, digits and underscores, starting with a letter (ICRM, SHOPIFY)."
    kind = str(body.get("kind") or "").upper()
    if kind not in CustomerAttributeSource.Kind.values:
        errors["kind"] = "Choose how the values arrive."
    data = {"name": name, "system": system, "kind": kind, "is_active": body.get("is_active", True) is not False,
            "report_connection_id": None, "table_name": None, "id_column": None}
    if kind == "DATABASE" and not errors:
        connection = str(body.get("report_connection_id") or "")
        offered = {row["id"]: row for row in attributes.databases_offered()}
        table, id_column = str(body.get("table_name") or "").strip(), str(body.get("id_column") or "").strip()
        if connection not in offered:
            errors["report_connection_id"] = "Choose a Report Database (MySQL or PostgreSQL, tested and active)."
        elif not attributes.IDENT_RE.match(table):
            errors["table_name"] = "Choose the table or view."
        elif not attributes.IDENT_RE.match(id_column):
            errors["id_column"] = "Choose the column that holds the person's ID."
        else:
            changed = current is None or str(current.report_connection_id) != connection or current.table_name != table or current.id_column != id_column
            if changed:
                probe = CustomerAttributeSource(tenant_id=context.require().tenant_id, report_connection_id=connection, table_name=table, id_column=id_column)
                try:
                    names = {c["name"] for c in attributes.columns(attributes.connection_row(probe), table)}
                except attributes.AttributeError_ as exc:
                    raise ValidationError({"table_name": str(exc)}) from None
                if id_column not in names:
                    errors["id_column"] = f"{table} has no column {id_column}."
            data.update({"report_connection_id": connection, "table_name": table, "id_column": id_column})
    if errors:
        raise ValidationError(errors)
    return data


class SourceSyncView(APIView):
    """Sync Now: a full read of the source, in the background."""
    permission_classes = [IsAuthenticated, HasPermissionCode.for_(EDIT)]

    @extend_schema(request=None, responses={202: None})
    def post(self, request, pk, version=None):
        _present()
        source = get_object_or_404(CustomerAttributeSource, pk=pk)
        if source.kind != "DATABASE":
            raise ValidationError({"kind": "Only a Report Database source is read by a sync: files and the API bring their values themselves."})
        if not attributes.source_attributes(source):
            raise ValidationError({"attributes": "No attribute reads this source yet. Add one first."})
        run = attributes.queue(source, "MANUAL", user_id=_user_id(request))
        return Response(_run_payload(run), status=202)


class SourceRunsView(APIView):
    permission_classes = [IsAuthenticated, ReadOrEdit]

    @extend_schema(responses={200: None})
    def get(self, request, pk, version=None):
        _present()
        source = get_object_or_404(CustomerAttributeSource, pk=pk)
        return Response([_run_payload(run) for run in CustomerAttributeSyncRun.objects.filter(source=source).order_by("-queued_at")[:20]])


class RunView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: None})
    def get(self, request, pk, version=None):
        _present()
        return Response(_run_payload(get_object_or_404(CustomerAttributeSyncRun, pk=pk)))


class DatabasesView(APIView):
    """The Report Databases a source may read; ?id= one of them: its tables; &table=: that table's columns; &field=: a few values."""
    permission_classes = [IsAuthenticated, HasPermissionCode.for_(EDIT)]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        offered = {row["id"]: row for row in attributes.databases_offered()}
        connection = request.query_params.get("id")
        if not connection:
            return Response({"databases": list(offered.values())})
        if connection not in offered:
            raise ValidationError({"id": "That Report Database cannot be read for attributes."})
        probe = CustomerAttributeSource(tenant_id=context.require().tenant_id, report_connection_id=connection)
        try:
            row = attributes.connection_row(probe)
            table, field = request.query_params.get("table"), request.query_params.get("field")
            if table and field:
                return Response({"sample": attributes.sample(row, table, field)})
            if table:
                return Response({"columns": attributes.columns(row, table)})
            return Response({"tables": attributes.tables(row)})
        except attributes.AttributeError_ as exc:
            raise ValidationError({"database": str(exc)}) from None


# ---------------------------------------------------------------------------------------------------- the Tag Check and Fill From Database
def _lists(body, name: str) -> list[str]:
    value = body.get(name) or []
    if not isinstance(value, list):
        raise ValidationError({name: "A list of contact list ids."})
    return [str(_uuid(v, name)) for v in value]


class TagCheckView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        template = tag_values._template(request.data.get("template"))
        if template is None:
            raise ValidationError({"template": "Choose the template."})
        include, exclude = _lists(request.data, "include"), _lists(request.data, "exclude")
        if not include:
            return Response({"template": {"id": str(template.pk), "name": template.name}, "people": 0, "tags": [], "short": 0, "fillable": [], "attributes": []})
        return Response(tag_values.tag_check(template, include, exclude))


class FillView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("list.edit")]

    @extend_schema(request=None, responses={202: None})
    def post(self, request, version=None):
        _present()
        include, exclude = _lists(request.data, "include"), _lists(request.data, "exclude")
        keys = {d.key for d in attributes.definitions() if d.scope == "CUSTOMER"}
        tags = []
        for item in request.data.get("tags") or []:
            tag, attribute = str((item or {}).get("tag") or ""), str((item or {}).get("attribute") or "")
            if tag and attribute in keys and attributes.KEY_RE.match(tag.replace(".", "_")):
                tags.append({"tag": tag, "attribute": attribute})
        if not include or not tags:
            raise ValidationError({"tags": "Choose at least one tag and the attribute it is filled from."})
        run = attributes.queue(None, "FILL", params={"include": include, "exclude": exclude, "tags": tags, "campaign_id": request.data.get("campaign")},
                               user_id=_user_id(request))
        return Response(_run_payload(run), status=202)


class PushView(APIView):
    """Another system sends values: {system, people: [{id, values: {key: value}}]}, up to 1,000 people a call. `id` is the person's ID
    in that system; the workspace needs an API source for the system, and each key an attribute that reads that source."""
    permission_classes = [IsAuthenticated, CanPush]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        _present()
        system = str(request.data.get("system") or "").strip().upper()
        people = request.data.get("people")
        if not isinstance(people, list) or not people:
            raise ValidationError({"people": "A list of {id, values}."})
        if len(people) > MAX_PUSH:
            raise ValidationError({"people": f"Up to {MAX_PUSH:,} people a call."})
        source = CustomerAttributeSource.objects.filter(system=system, kind="API", is_active=True).order_by("created_at").first()
        if source is None:
            raise ValidationError({"system": f"This workspace has no API source for {system or 'that system'}. Add one under Settings → Customer Attributes → Sources."})
        defs = {d.source_field or d.key: d for d in attributes.definitions() if d.source_id == source.pk and d.scope == "CUSTOMER"}
        ids = [str((p or {}).get("id") or "").strip() for p in people]
        matched = attributes.match_ids(system, ids)
        rows, ignored, unknown = {}, set(), 0
        for person, external in zip(people, ids):
            party = matched.get(external)
            if not party:
                unknown += 1
                continue
            values = {}
            for field, value in ((person or {}).get("values") or {}).items():
                definition = defs.get(field)
                if definition is None:
                    ignored.add(str(field)[:60])
                    continue
                values[definition.key] = attributes.typed(value, definition.data_type)
            if values:
                rows.setdefault(party, {}).update(values)
        from django.utils import timezone
        run = CustomerAttributeSyncRun.objects.create(tenant_id=context.require().tenant_id, source=source, trigger="API", status="RUNNING", started_at=timezone.now())
        changed = attributes.store(source.pk, rows, run.pk, replace=False)
        attributes.remember_ids(system, [(x, matched[x]) for x in ids if x in matched])
        now = timezone.now()
        CustomerAttributeSyncRun.objects.filter(pk=run.pk).update(status="DONE", finished_at=now, people_read=len(people), people_matched=len(rows), values_changed=changed)
        CustomerAttributeSource.objects.filter(pk=source.pk).update(last_sync_at=now, last_sync_run_id=run.pk)
        _forget_counts()
        return Response({"received": len(people), "matched": len(rows), "unknown_people": unknown, "changed": changed, "ignored_fields": sorted(ignored)})
