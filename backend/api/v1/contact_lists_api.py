"""Contact lists: browse, create (upload / audience / clone), inspect, fix, and see where a list is used.

    GET    /contact-lists/                          browse; ?search= &list_environment= &source=UPLOAD|BI|CLONE &status=
    POST   /contact-lists/                          the upload wizard's first step: a DRAFT list waiting for its file
    GET    /contact-lists/stats/                    the three numbers above the table
    GET    /contact-lists/audiences/                audiences the data team defined (C360 segments)
    POST   /contact-lists/from-audience/            a list that follows an audience
    POST   /contact-lists/{id}/clone/               a snapshot of a list
    POST   /contact-lists/{id}/refresh/             bring an audience list in line with its audience now
    GET    /contact-lists/{id}/usage/               campaigns it is attached to; which are live
    GET    /contact-lists/{id}/members/             the people in it; POST adds people by email address
    POST   /contact-lists/{id}/members/remove/      {ids}
    GET    /contact-lists/{id}/members/export/      CSV; ?ids=1,2,3 for a selection
    GET    /contact-lists/imports/                  the workspace's uploads, newest first; ?active=true = the unfinished ones
    POST   /contact-lists/{id}/imports/             multipart `file`: store a CSV and queue it  (permission list.import)
    GET    /contact-lists/{id}/imports/{import}/    status, progress, columns, mapping, review numbers: poll this
    POST   /contact-lists/{id}/imports/{import}/review/   {mapping}: 202, the check runs in the background
    POST   /contact-lists/{id}/imports/{import}/apply/    202, the contacts are added in the background
    POST   /contact-lists/{id}/imports/{import}/cancel/
    GET    /contact-lists/{id}/imports/{import}/report/   CSV: every row of the file, what happened to it, its governance status
    GET    /contact-lists/{id}/governance/                the list's people as a marketing email send would judge them today

A file is never read, checked or imported inside a request (apps/contact_lists/jobs.py): the upload answers at once and
the three steps run as background jobs, a few at a time for the whole platform and one at a time per workspace.
"""
import csv
import tempfile

from django.db.models import Count, Q
from django.http import FileResponse, StreamingHttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.contact_lists import governance, imports, jobs, lists
from apps.contact_lists.models import ContactList, ContactListImport
from apps.tenants import context

from .serializers import AUDIT_FIELDS, TenantModelSerializer
from .views import BaseTenantViewSet

SOURCE_LABEL = {"UPLOAD": "Upload", "BI": "BI / Extraction", "EXTRACTION": "BI / Extraction", "SEGMENT": "BI / Extraction", "CLONE": "Cloned"}
SOURCE_FILTER = {"UPLOAD": ["UPLOAD"], "BI": ["BI", "EXTRACTION", "SEGMENT"], "CLONE": ["CLONE"]}
VETTED = ("BI", "EXTRACTION", "SEGMENT", "CLONE")           # defined upstream, or copied from a list that was: a campaign may take it as is


def _user_id(request):
    return None if hasattr(request.user, "has_scope") else request.user.id


class ContactListSerializer(TenantModelSerializer):
    source_label = serializers.SerializerMethodField()
    vetted = serializers.SerializerMethodField(help_text="Comes from an audience or a clone: a campaign being built may attach it without asking. An upload is never attached automatically.")
    attached_campaigns = serializers.IntegerField(read_only=True, default=0)
    live_campaigns = serializers.IntegerField(read_only=True, default=0)
    parent_name = serializers.CharField(source="parent_contact_list.name", read_only=True, default=None)

    class Meta(TenantModelSerializer.Meta):
        model = ContactList
        fields = "__all__"
        read_only_fields = AUDIT_FIELDS + ("member_count", "last_refreshed_at", "source_reference", "criteria", "parent_contact_list", "legacy_contact_list_id")
        extra_kwargs = {"source_type": {"required": False}}      # POST makes an upload list; the other sources have their own endpoints

    def get_source_label(self, item) -> str:
        return SOURCE_LABEL.get(item.source_type, item.source_type)

    def get_vetted(self, item) -> bool:
        return item.source_type in VETTED

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Give the list a name.")
        same = ContactList.objects.filter(tenant_id=context.require().tenant_id, name__iexact=value, deleted_at__isnull=True)
        if self.instance is not None:
            same = same.exclude(pk=self.instance.pk)
        if same.exists():
            raise serializers.ValidationError("Another list already has this name.")
        return value

    def validate(self, attrs):
        instance = self.instance
        if instance is None:
            if attrs.get("source_type", "UPLOAD") != "UPLOAD":
                raise serializers.ValidationError({"source_type": "Create audience lists with from-audience and copies with clone."})
            attrs.update({"source_type": "UPLOAD", "list_kind": "STATIC", "status": "DRAFT", "is_master": True})
            return attrs
        for locked in ("source_type", "list_kind"):
            if locked in attrs and attrs[locked] != getattr(instance, locked):
                raise serializers.ValidationError({locked: "This cannot be changed after the list is created."})
        if "status" in attrs and attrs["status"] != instance.status:
            if instance.status == "DRAFT" or attrs["status"] == "DRAFT":
                raise serializers.ValidationError({"status": "A list becomes active when its first import is added."})
        return attrs


class NewListSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    list_environment = serializers.ChoiceField(choices=ContactList.ListEnvironment.choices, default="PRODUCTION")
    channel = serializers.ChoiceField(choices=ContactList.Channel.choices, required=False)   # a clone keeps the source's when not given

    def validate_name(self, value):
        return ContactListSerializer(context=self.context).validate_name(value)


class FromAudienceSerializer(NewListSerializer):
    audience = serializers.UUIDField()


class ManualContactsSerializer(serializers.Serializer):
    contacts = serializers.ListField(child=serializers.DictField(child=serializers.CharField(allow_blank=True, allow_null=True)), allow_empty=False)


class RemoveSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False, max_length=5000)


class MappingSerializer(serializers.Serializer):
    mapping = serializers.DictField(child=serializers.CharField(allow_blank=True, allow_null=True))


PHASE = {"UPLOADED": "Waiting to be read", "STAGING": "Reading the file", "STAGED": "Read. Match the columns to continue", "MATCHING": "Checking the rows",
         "REVIEW": "Checked. Review it to continue", "APPLYING": "Adding contacts to the list", "APPLIED": "Imported", "FAILED": "Failed", "CANCELLED": "Cancelled"}
WAITING = {"STAGE": "Waiting to be read", "REVIEW": "Waiting to be checked", "APPLY": "Waiting to be imported"}


def import_payload(record: ContactListImport, with_issues: bool = False) -> dict:
    working = record.status in ("STAGING", "MATCHING", "APPLYING") or bool(record.next_action)
    total = record.progress_total or 0
    percent = 100 if not working else (min(99, int(record.progress_done * 100 / total)) if total and record.status in ("STAGING", "MATCHING", "APPLYING") else 0)
    data = {
        "id": str(record.pk), "contact_list": str(record.contact_list_id), "list_name": record.contact_list.name, "list_status": record.contact_list.status,
        "file_name": record.file_name, "file_size": record.file_size, "status": record.status,
        "phase": WAITING[record.next_action] if record.next_action and record.status not in ("STAGING", "MATCHING", "APPLYING") else PHASE.get(record.status, record.status),
        "working": working, "progress": {"done": record.progress_done, "total": total, "percent": percent, "unit": "bytes" if record.status in ("UPLOADED", "STAGING") else "rows"},
        "mapping_confirmed": record.mapping_confirmed, "error": record.error,
        "row_count": record.row_count, "columns": record.file_columns, "mapping": record.column_mapping, "properties": imports.catalogue(imports.channel_of(record.contact_list)),
        "list_channel": imports.channel_of(record.contact_list),
        "review": None, "applied_count": record.applied_count, "new_people": record.new_customer_count, "consents_recorded": record.consent_count,
        "created_at": record.created_at, "started_at": record.started_at, "completed_at": record.completed_at,
        "created_by_name": getattr(record.created_by, "display_name", None) or getattr(record.created_by, "email", None),
    }
    if record.status in ("REVIEW", "APPLYING", "APPLIED") and not (record.status == "REVIEW" and record.next_action == "REVIEW"):
        held_back = record.duplicate_count + record.rejected_count
        data["review"] = {"ready": record.matched_count + record.unmatched_count, "held_back": held_back, "new": record.unmatched_count, "existing": record.matched_count,
                          "warnings": record.warning_count, "errors": held_back, "duplicates": record.duplicate_count, "rejected": record.rejected_count}
    if with_issues and data["review"] is not None:
        data["issues"] = imports.issues(record)
    data["summary"] = reconciliation(record) if data["review"] is not None else None
    return data


HELD_BACK = (("NO_EMAIL", "No email address"), ("INVALID_EMAIL", "Not a valid email address"), ("NO_MOBILE", "No mobile number"), ("INVALID_MOBILE", "Mobile number not recognised"),
             ("DUPLICATE_IN_FILE", "The same person earlier in the file"))


def reconciliation(record: ContactListImport) -> dict | None:
    """The upload in numbers that add up, so it can be reconciled against its source:
        rows in the file = held back + ready;  ready = the governance lines;  ready = added to the list + already in it."""
    stored = record.summary or {}
    if "ready" not in stored:
        return None
    held, ready, counts = stored.get("held_back", {}), stored.get("ready", {}), stored.get("governance", {})
    lines = governance.breakdown(counts)
    sendable = sum(line["count"] for line in lines if line["sendable"])
    result = stored.get("result")
    return {
        "rows": stored.get("rows", record.row_count),
        "held_back": {"total": held.get("total", 0), "reasons": [{"code": code, "label": label, "count": int(held.get(code, 0))} for code, label in HELD_BACK]},
        "ready": {"total": ready.get("total", 0), "new": ready.get("new", 0), "existing": ready.get("existing", 0)},
        "governance": {"sendable": sendable, "not_sendable": ready.get("total", 0) - sendable, "statuses": lines},
        "mobile": stored.get("mobile"),
        "result": None if result is None else {**result, "new_people": record.new_customer_count, "consents_recorded": record.consent_count},
        "balanced": stored.get("rows", 0) == held.get("total", 0) + ready.get("total", 0) and sum(line["count"] for line in lines) == ready.get("total", 0)
                    and (result is None or result["added"] + result["already_in_list"] == ready.get("total", 0)),
        "checked_at": stored.get("checked_at"),
    }


def _safe_cell(value):
    """A cell that starts with = + - or @ would be run as a formula by a spreadsheet: neutralise it. Empty stays empty."""
    if value is None:
        return ""
    return "'" + value if isinstance(value, str) and value and value[0] in "=+-@" else value


class _Echo:
    def write(self, value):
        return value


class ContactListViewSet(BaseTenantViewSet):
    queryset = ContactList.objects.select_related("parent_contact_list")
    serializer_class = ContactListSerializer
    permission_code = "list.edit"
    filterset_fields = ["list_kind", "is_master", "list_environment"]
    search_fields = ["name", "description"]
    ordering_fields = ["name", "member_count", "updated_at", "created_at"]

    def get_queryset(self):
        live = Q(contact_list_campaigns__campaign__deleted_at__isnull=True)
        qs = super().get_queryset().annotate(
            attached_campaigns=Count("contact_list_campaigns__campaign", filter=live, distinct=True),      # the link table has a composite key: count campaigns
            live_campaigns=Count("contact_list_campaigns__campaign", filter=live & Q(contact_list_campaigns__campaign__status__in=lists.LIVE), distinct=True))
        if self.action == "list":
            status = self.request.query_params.get("status")
            qs = qs.filter(status=status) if status else qs.exclude(status=ContactList.Status.DRAFT)      # a half-finished upload is not a list yet
            source = self.request.query_params.get("source")
            if source:
                if source not in SOURCE_FILTER:
                    raise ValidationError({"source": f"Expected one of {', '.join(SOURCE_FILTER)}."})
                qs = qs.filter(source_type__in=SOURCE_FILTER[source])
        return qs

    def filter_queryset(self, queryset):
        # ?search= and the other filters describe the table of lists; on /{id}/members/?search= they are about the people
        return super().filter_queryset(queryset) if self.action == "list" else queryset

    def perform_create(self, serializer):
        serializer.save(tenant_id=context.require().tenant_id, created_by_id=_user_id(self.request))

    def perform_update(self, serializer):
        serializer.save(updated_by_id=_user_id(self.request))

    def perform_destroy(self, instance):
        if instance.contact_list_campaigns.filter(campaign__deleted_at__isnull=True).exists():
            raise Conflict("This list is attached to a campaign. Detach it there first, or archive the list.")
        if instance.contact_lists.filter(deleted_at__isnull=True, list_kind="DERIVED").exists():
            raise Conflict("Another list is built on this one. Delete that list first.")
        jobs.cancel_all_for(instance)                      # a worker that is on one of its files stops at its next chunk
        lists.remove_all(instance)
        super().perform_destroy(instance)

    def _respond(self, contact_list, status=200):
        return Response(self.get_serializer(self.get_queryset().get(pk=contact_list.pk)).data, status=status)

    # ------------------------------------------------------------ landing page
    @extend_schema(responses=inline_serializer("ContactListStats", {"total_lists": serializers.IntegerField(), "total_contacts": serializers.IntegerField(),
                                                                    "attached_to_live_campaigns": serializers.IntegerField()}))
    @action(detail=False, methods=["get"])
    def stats(self, request, version=None):
        return Response(lists.stats(context.require().tenant_id))

    # ------------------------------------------------------------ BI / extraction
    @extend_schema(responses=inline_serializer("Audience", {"id": serializers.UUIDField(), "code": serializers.CharField(), "name": serializers.CharField(),
                                                            "description": serializers.CharField(allow_null=True), "source_system": serializers.CharField(),
                                                            "synced_at": serializers.DateTimeField(), "member_count": serializers.IntegerField(),
                                                            "list_count": serializers.IntegerField()}, many=True))
    @action(detail=False, methods=["get"], pagination_class=None)
    def audiences(self, request, version=None):
        return Response(lists.audiences(context.require().tenant_id))

    @extend_schema(request=FromAudienceSerializer, responses={201: ContactListSerializer})
    @action(detail=False, methods=["post"], url_path="from-audience")
    def from_audience(self, request, version=None):
        body = FromAudienceSerializer(data=request.data, context=self.get_serializer_context())
        body.is_valid(raise_exception=True)
        try:
            created = lists.create_from_audience(tenant_id=context.require().tenant_id, segment_id=body.validated_data["audience"], name=body.validated_data["name"],
                                                 description=body.validated_data["description"], environment=body.validated_data["list_environment"], channel=body.validated_data.get("channel") or "EMAIL", user_id=_user_id(request))
        except lists.ListError as exc:
            raise ValidationError({"audience": str(exc)}) from exc
        return self._respond(created, 201)

    @extend_schema(request=None, responses=inline_serializer("ListRefresh", {"added": serializers.IntegerField(), "removed": serializers.IntegerField(),
                                                                             "member_count": serializers.IntegerField()}))
    @action(detail=True, methods=["post"])
    def refresh(self, request, pk=None, version=None):
        try:
            return Response(lists.sync_from_segment(self.get_object(), _user_id(request)))
        except lists.ListError as exc:
            raise Conflict(str(exc)) from exc

    # ------------------------------------------------------------ clone
    @extend_schema(request=NewListSerializer, responses={201: ContactListSerializer})
    @action(detail=True, methods=["post"])
    def clone(self, request, pk=None, version=None):
        source = self.get_object()
        body = NewListSerializer(data=request.data, context=self.get_serializer_context())
        body.is_valid(raise_exception=True)
        try:
            copy = lists.clone(source, name=body.validated_data["name"], description=body.validated_data["description"],
                               environment=body.validated_data["list_environment"], channel=body.validated_data.get("channel"), user_id=_user_id(request))
        except lists.ListError as exc:
            raise Conflict(str(exc)) from exc
        return self._respond(copy, 201)

    # ------------------------------------------------------------ where it is used
    @extend_schema(responses=inline_serializer("ListUsage", {"campaigns": serializers.ListField(child=serializers.DictField()), "attached_campaigns": serializers.IntegerField(),
                                                             "live_campaigns": serializers.IntegerField(), "added_this_week": serializers.IntegerField()}))
    @action(detail=True, methods=["get"])
    def usage(self, request, pk=None, version=None):
        return Response(lists.usage(self.get_object()))

    @extend_schema(responses=inline_serializer("ListGovernance", {"total": serializers.IntegerField(), "sendable": serializers.IntegerField(), "not_sendable": serializers.IntegerField(),
                                                                  "statuses": serializers.ListField(child=serializers.DictField()), "checked_at": serializers.DateTimeField()}))
    @action(detail=True, methods=["get"], url_path="governance")
    def governance_now(self, request, pk=None, version=None):
        """Unsubscribed, bounced, complained, blocked, invalid, suppressed, no consent, marketable: the list's people today."""
        return Response(lists.governance_now(self.get_object()))

    @extend_schema(responses=inline_serializer("ListReach", {"email": serializers.DictField(), "sms": serializers.DictField(), "checked_at": serializers.DateTimeField()}))
    @action(detail=True, methods=["get"], url_path="reach")
    def reach(self, request, pk=None, version=None):
        """How many people a marketing email and a marketing text could reach today."""
        return Response(lists.reach(self.get_object()))

    # ------------------------------------------------------------ the people in it
    @extend_schema(methods=["GET"], parameters=[OpenApiParameter("search", str), OpenApiParameter("source", str), OpenApiParameter("status", str, description="a consent state, SENDABLE or NOT_SENDABLE"),
                                                OpenApiParameter("page", int), OpenApiParameter("page_size", int)],
                   responses=inline_serializer("ListMembers", {"count": serializers.IntegerField(), "page": serializers.IntegerField(), "page_size": serializers.IntegerField(),
                                                               "results": serializers.ListField(child=serializers.DictField())}))
    @extend_schema(methods=["POST"], request=ManualContactsSerializer,
                   responses=inline_serializer("ListMembersAdded", {"added": serializers.IntegerField(), "already_in_list": serializers.IntegerField(), "new_people": serializers.IntegerField(),
                                                                    "invalid": serializers.ListField(child=serializers.CharField()), "member_count": serializers.IntegerField()}))
    @action(detail=True, methods=["get", "post"], pagination_class=None)
    def members(self, request, pk=None, version=None):
        contact_list = self.get_object()
        if request.method == "POST":
            body = ManualContactsSerializer(data=request.data)
            body.is_valid(raise_exception=True)
            try:
                return Response(lists.add_manually(contact_list, body.validated_data["contacts"], _user_id(request)))
            except lists.ListError as exc:
                raise Conflict(str(exc)) from exc
        params = request.query_params
        try:
            page, size = max(1, int(params.get("page", 1))), min(200, max(1, int(params.get("page_size", 50))))
        except ValueError:
            raise ValidationError({"page": "Expected a number."}) from None
        try:
            return Response(lists.members(contact_list, search=params.get("search", ""), source=params.get("source", ""), status=params.get("status", ""), page=page, page_size=size))
        except lists.ListError as exc:
            raise ValidationError({"status": str(exc)}) from None

    @extend_schema(request=RemoveSerializer, responses=inline_serializer("ListMembersRemoved", {"removed": serializers.IntegerField(), "member_count": serializers.IntegerField()}))
    @action(detail=True, methods=["post"], url_path="members/remove")
    def members_remove(self, request, pk=None, version=None):
        body = RemoveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            return Response(lists.remove(self.get_object(), body.validated_data["ids"], _user_id(request)))
        except lists.ListError as exc:
            raise Conflict(str(exc)) from exc

    @extend_schema(parameters=[OpenApiParameter("ids", str, description="comma-separated member ids; default: everyone")], responses={(200, "text/csv"): str})
    @action(detail=True, methods=["get"], url_path="members/export")
    def members_export(self, request, pk=None, version=None):
        contact_list = self.get_object()
        raw = request.query_params.get("ids", "")
        try:
            ids = [int(value) for value in raw.split(",") if value.strip()] if raw else None
        except ValueError:
            raise ValidationError({"ids": "Expected comma-separated numbers."}) from None

        def rows():
            writer = csv.writer(_Echo())
            yield writer.writerow(["email", "first_name", "last_name", "mobile", "added_on", "source", "customer_id"])
            page = 1
            while True:
                chunk = lists.members(contact_list, page=page, page_size=200, ids=ids)["results"]
                for row in chunk:
                    # a leading = + - @ would be run as a formula by a spreadsheet: neutralise it
                    cells = [row["email"], row["first_name"], row["last_name"], row["mobile"], row["added_at"].date().isoformat(), row["source"].title(), row["party_id"]]
                    yield writer.writerow([_safe_cell(c) for c in cells])
                if len(chunk) < 200:
                    break
                page += 1

        response = StreamingHttpResponse(list(rows()), content_type="text/csv; charset=utf-8")     # materialised: the request transaction ends with the view
        safe = "".join(ch if ch.isalnum() or ch in "-_ " else "_" for ch in contact_list.name).strip() or "contact-list"
        response["Content-Disposition"] = f'attachment; filename="{safe}.csv"'
        return response

    # ------------------------------------------------------------ upload (background jobs)
    def _import(self, contact_list, import_id) -> ContactListImport:
        record = ContactListImport.objects.select_related("contact_list", "created_by").filter(pk=import_id, contact_list=contact_list, tenant_id=contact_list.tenant_id).first()
        if record is None:
            raise NotFound("No such import for this list.")
        return record

    @extend_schema(operation_id="contact_lists_uploads_list", parameters=[OpenApiParameter("active", bool, description="only uploads that are not finished")], responses=dict)
    @action(detail=False, methods=["get"], url_path="imports", pagination_class=None)
    def import_jobs(self, request, version=None):
        active = request.query_params.get("active", "").lower() in ("1", "true", "yes")
        return Response([import_payload(record) for record in jobs.recent(context.require().tenant_id, active_only=active)])

    @extend_schema(request={"multipart/form-data": inline_serializer("ListUpload", {"file": serializers.FileField()})}, responses={201: dict})
    @action(detail=True, methods=["post"], url_path="imports", parser_classes=[MultiPartParser],
            permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("list.import")])
    def imports(self, request, pk=None, version=None):
        """Stores the file and answers at once. Reading it is a background job: poll the import for its progress."""
        contact_list = self.get_object()
        if contact_list.status == ContactList.Status.ARCHIVED:
            raise Conflict("An archived list cannot be changed. Restore it first.")
        if contact_list.list_kind != ContactList.ListKind.STATIC:
            raise Conflict("Only lists made from files take uploads. This one follows an audience.")
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Choose a CSV file."})
        try:
            record = imports.accept(contact_list, upload, _user_id(request))
        except imports.ImportError_ as exc:
            raise ValidationError({"file": str(exc)}) from exc
        except jobs.TooManyUploads as exc:
            raise Conflict(str(exc)) from exc
        return Response(import_payload(record), status=201)

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"], url_path=r"imports/(?P<import_id>[0-9a-f-]{36})")
    def import_detail(self, request, pk=None, import_id=None, version=None):
        return Response(import_payload(self._import(self.get_object(), import_id), with_issues=True))

    @extend_schema(request=MappingSerializer, responses={202: dict})
    @action(detail=True, methods=["post"], url_path=r"imports/(?P<import_id>[0-9a-f-]{36})/review", parser_classes=[JSONParser],
            permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("list.import")])
    def import_review(self, request, pk=None, import_id=None, version=None):
        """Confirms the mapping. The check runs in the background, right away or as soon as the file has been read."""
        record = self._import(self.get_object(), import_id)
        body = MappingSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            record = imports.confirm_mapping(record, body.validated_data["mapping"])
        except imports.ImportError_ as exc:
            raise ValidationError({"mapping": str(exc)}) from exc
        return Response(import_payload(record), status=202)

    @extend_schema(request=None, responses={202: dict})
    @action(detail=True, methods=["post"], url_path=r"imports/(?P<import_id>[0-9a-f-]{36})/apply", parser_classes=[JSONParser],
            permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("list.import")])
    def import_apply(self, request, pk=None, import_id=None, version=None):
        record = self._import(self.get_object(), import_id)
        try:
            record = imports.request_apply(record)
        except imports.ImportError_ as exc:
            raise Conflict(str(exc)) from exc
        return Response(import_payload(record), status=202)

    @extend_schema(request=None, responses=dict)
    @action(detail=True, methods=["post"], url_path=r"imports/(?P<import_id>[0-9a-f-]{36})/cancel", parser_classes=[JSONParser],
            permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("list.import")])
    def import_cancel(self, request, pk=None, import_id=None, version=None):
        record = self._import(self.get_object(), import_id)
        try:
            jobs.cancel(record)
        except imports.ImportError_ as exc:
            raise Conflict(str(exc)) from exc
        return Response(import_payload(record))

    @extend_schema(responses={(200, "text/csv"): str})
    @action(detail=True, methods=["get"], url_path=r"imports/(?P<import_id>[0-9a-f-]{36})/report")
    def import_report(self, request, pk=None, import_id=None, version=None):
        """Every row of the file: imported or held back, why, whether the person was known, and the governance status."""
        record = self._import(self.get_object(), import_id)
        if record.status not in ("REVIEW", "APPLYING", "APPLIED"):
            raise Conflict("The report is there once the file has been checked.")
        # written to a spooled file inside the request (the tenant's transaction ends with the view), then sent from it:
        # memory stays bounded for a 250,000-row report
        spool = tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024, mode="w+b")
        spool.write("\ufeff".encode("utf-8"))                                  # Excel reads UTF-8 only with the mark
        text = _Echo()
        writer = csv.writer(text)
        spool.write(writer.writerow(imports.REPORT_HEADER).encode("utf-8"))
        for row in imports.report_rows(record):
            # a leading = + - @ would be run as a formula by a spreadsheet: neutralise it
            spool.write(writer.writerow([_safe_cell(cell) for cell in row]).encode("utf-8"))
        spool.seek(0)
        safe = "".join(ch if ch.isalnum() or ch in "-_ ." else "_" for ch in record.file_name.rsplit(".", 1)[0]).strip() or "upload"
        return FileResponse(spool, as_attachment=True, filename=f"{safe} - upload report.csv", content_type="text/csv; charset=utf-8")

