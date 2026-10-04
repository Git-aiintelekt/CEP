"""The point of sale: a TTDR transaction in, an e-receipt out, an XML answer back — plus the workspace's stores, its POS
settings and the trail of what was received (read from the integration log; the transaction itself is never stored)."""
import csv
import io
import json
import logging
import re
from datetime import datetime, timedelta

from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, NotAuthenticated, AuthenticationFailed, PermissionDenied, Throttled, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.delivery.engine import receipts
from apps.integrations.bridge import logbook
from apps.integrations.bridge.inbound import InboundLogMixin
from apps.integrations.models import IntegrationLog
from apps.platform_ops import params
from apps.pos import mapping, receipt_text, ttdr
from apps.pos.models import Store
from apps.reporting import attribution
from apps.tenants import context
from apps.tenants.models import Tenant

from .delivery_api import CanSendReceipts

log = logging.getLogger("cep.pos")

ADMIN = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]
VIEW = [IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.view")]
TRANS_ID = re.compile(r"<(?:\w+:)?TransId>\s*([^<]{1,60}?)\s*</")
STORE_FIELDS = ("store_number", "name", "brand", "address1", "address2", "city", "state", "postal_code", "country", "district", "phone", "email", "manager", "return_policy",
                "url1", "url2", "url3", "url4", "image_url", "is_active")

# the answers the point of sale reads: S = accepted, E = refused (the receipt was not sent)
S_SENT, S_NO_RECIPIENT, S_DUPLICATE, S_TEXT_SENT, S_PRINTED, S_TEXT_NOT_SENT = "S100", "S101", "S102", "S103", "S104", "S105"


def asks_for(entry_type: str) -> tuple[bool, bool]:
    """(email, text) from the transaction's EntryType: EMAIL / BOTH / ALL / EMAIL_SMS… want an email; SMS / SMS_LINK / EMAIL_SMS… want a text;
    PRINT / NOPRINT / PUSH / NONE and the registration flows (SMS_REGISTER, SMS_UPDATE) want nothing from CEP."""
    value = (entry_type or "PRINT").upper()
    if value in ("SMS_REGISTER", "SMS_UPDATE"):
        return False, False
    email = "EMAIL" in value or value in ("BOTH", "ALL", "PUSH_BOTH")
    text = "SMS" in value or value == "ALL"
    return email, text
E_KEY, E_ENGINE, E_CAMPAIGN, E_BLOCKED, E_LIMIT, E_PAUSED, E_FEATURE = "E888", "E900", "E120", "E121", "E429", "E503", "E122"


def xml_answer(code: str, *, transaction_id: str = "", message: str = "", status: int = 200, extra: dict | None = None) -> HttpResponse:
    from xml.sax.saxutils import escape
    lines = [f'<?xml version="1.0" encoding="UTF-8"?>', f'<RESPONSE ResponseId="{int(timezone.now().timestamp())}">',
             f"    <RESPONSE_DATE>{timezone.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}</RESPONSE_DATE>"]
    if transaction_id:
        lines.append(f"    <ORI_ORDER_ID>{escape(transaction_id)}</ORI_ORDER_ID>")
    lines.append(f"    <RESPONSE_CODE>{code}</RESPONSE_CODE>")
    if message:
        lines.append(f"    <RESPONSE_MESSAGE>{escape(message)}</RESPONSE_MESSAGE>")
    for key, value in (extra or {}).items():
        if value not in (None, ""):
            lines.append(f"    <{key}>{escape(str(value))}</{key}>")
    lines.append("</RESPONSE>")
    response = HttpResponse("\n".join(lines) + "\n", content_type="application/xml; charset=utf-8", status=status)
    response.data = {"code": code, "transaction_id": transaction_id or None, "message": message or None, **(extra or {})}       # what the integration log keeps
    return response


class PosTransactionView(InboundLogMixin, APIView):
    """POST /api/v1/pos/transactions/ — a TTDR 3.2.2 transaction as the body (application/xml or text/xml), or as the form field
    `XmlInput`. Authenticated by a workspace API key with the scope receipts:send, sent as `Authorization: Bearer cep_…` or as
    `accessTokenKey` with `X-Tenant-Key` naming the workspace. Answers XML: S100 the receipt went out, S101 accepted but the
    recipient has no email address (nothing sent), S102 this transaction was already received (nothing sent again), E1xx the
    document is refused (the message says where), E120/E121 the e-receipt campaign is not ready, E429 over the rate limit,
    E888 the key is wrong, E900 the sending engine did not accept the receipt (call again later)."""
    permission_classes = [IsAuthenticated, CanSendReceipts, params.RequiresFeature.for_("ereceipt")]
    integration_kind = logbook.KIND_POS
    integration_system = "POS"

    def integration_ref(self, request, body):
        found = TRANS_ID.search((getattr(request, "_cep_raw", b"") or b"").decode("utf-8", "replace"))
        return f"receipt:{found.group(1)}" if found else None

    def dispatch(self, request, *args, **kwargs):
        request._cep_raw = request.body
        return super().dispatch(request, *args, **kwargs)

    def handle_exception(self, exc):
        """The point of sale reads XML whatever happened, so every refusal is an XML answer with a code."""
        if isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
            return xml_answer(E_KEY, message="The API key is missing, wrong, expired or revoked.", status=401)
        if isinstance(exc, PermissionDenied):
            text = str(getattr(exc, "detail", exc))
            return xml_answer(E_FEATURE if "feature" in text.lower() or "plan" in text.lower() else E_KEY, message=text, status=403)
        if isinstance(exc, Throttled):
            return xml_answer(E_LIMIT, message="Over the rate limit; call again later.", status=429)
        if isinstance(exc, APIException) and exc.status_code == 503:
            return xml_answer(E_PAUSED, message="The point-of-sale integration is paused in this workspace.", status=503)
        return super().handle_exception(exc)

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        raw = _document(request)
        try:
            read = ttdr.parse(raw)
        except ttdr.TtdrError as exc:
            return xml_answer(exc.code, message=str(exc), status=400)
        transaction = read["transaction"]
        recipient = read["recipient"]
        tenant = Tenant.objects.get(pk=context.require().tenant_id)
        key = f"{transaction['merchant_number']}:{transaction['store_number']}:{transaction['register_number']}:{transaction['id']}:{transaction['date']}"
        try:
            attribution.record_pos(tenant, read, key=key)              # only when the workspace counts store sales for attribution
        except Exception:                                              # noqa: BLE001  attribution must never cost a receipt
            log.exception("POS transaction not recorded for attribution")
        entry = (transaction.get("entry_type") or "PRINT").upper()
        wants_email, wants_text = asks_for(entry)
        if not wants_email and not wants_text:
            return xml_answer(S_PRINTED, transaction_id=transaction["id"], message=f"Accepted; EntryType {entry} asks for no e-receipt. Nothing was sent.")
        prefs = mapping.settings_of(tenant)
        key = f"{transaction['merchant_number']}:{transaction['store_number']}:{transaction['register_number']}:{transaction['id']}:{transaction['date']}"
        common = {"receipt": mapping.receipt_of(read), "store": mapping.store_tags(tenant.pk, read), "party_id": recipient.get("customer_id") or None,
                  "name": " ".join(p for p in (recipient.get("first_name"), recipient.get("last_name")) if p), "extra_sources": {"TRANSACTION": mapping.transaction_tags(read)}}

        text_note: dict = {}
        if wants_text:                                     # the text goes first when both are asked for: its outcome rides along in the answer
            number = mapping.e164(recipient.get("phone") or "", prefs["default_country"])
            text_ref = mapping.text_campaign_for(tenant)
            if not number:
                text_note = {"TEXT_STATUS": "NOT_SENT", "TEXT_MESSAGE": "The recipient has no mobile number."}
            elif not text_ref:
                text_note = {"TEXT_STATUS": "NOT_SENT", "TEXT_MESSAGE": "No text e-receipt campaign is published or chosen under Settings, POS Receipts."}
            else:
                try:
                    texted = receipt_text.send(tenant.pk, campaign_ref=text_ref, to_number=number, idempotency_key=key + ":SMS", **common)
                    text_note = {"TEXT_STATUS": "DUPLICATE" if texted.get("duplicate") else "SENT", "TEXT_EXECUTION_ID": texted.get("execution_id"), "TEXT_MESSAGE_ID": texted.get("provider_message_id")}
                except receipts.ReceiptRefused as exc:
                    text_note = {"TEXT_STATUS": "NOT_SENT", "TEXT_MESSAGE": str(exc)}
            if not wants_email:
                if text_note["TEXT_STATUS"] == "SENT":
                    return xml_answer(S_TEXT_SENT, transaction_id=transaction["id"], extra=text_note)
                if text_note["TEXT_STATUS"] == "DUPLICATE":
                    return xml_answer(S_DUPLICATE, transaction_id=transaction["id"], message="This transaction was received before; the text receipt is not sent twice.", extra=text_note)
                return xml_answer(S_TEXT_NOT_SENT, transaction_id=transaction["id"], message=text_note.get("TEXT_MESSAGE", ""), extra={"TEXT_STATUS": "NOT_SENT"})

        if not recipient.get("email"):
            return xml_answer(S_NO_RECIPIENT, transaction_id=transaction["id"], message="Accepted; the recipient has no email address, so no e-receipt was sent.", extra=text_note)
        try:
            result = receipts.send(tenant.pk, campaign_ref=mapping.campaign_for(tenant, read), to=recipient["email"], idempotency_key=key, **common)
        except receipts.ReceiptRefused as exc:
            if exc.field == "campaign":
                return xml_answer(E_CAMPAIGN, transaction_id=transaction["id"], message=str(exc), status=409, extra=text_note)
            if exc.field == "to":
                return xml_answer(E_BLOCKED, transaction_id=transaction["id"], message=str(exc), status=422, extra=text_note)
            return xml_answer(E_ENGINE, transaction_id=transaction["id"], message=str(exc), status=exc.status if exc.status in (424, 422) else 424, extra=text_note)
        if result.get("duplicate"):
            return xml_answer(S_DUPLICATE, transaction_id=transaction["id"], message="This transaction was received before; the receipt is not sent twice.",
                              extra={"EXECUTION_ID": result.get("execution_id"), **text_note})
        return xml_answer(S_SENT, transaction_id=transaction["id"], message=mapping.missing_store_note(tenant.pk, read),
                          extra={"EXECUTION_ID": result.get("execution_id"), "MESSAGE_ID": result.get("provider_message_id"), **text_note})


def _document(request) -> bytes:
    content_type = (request.content_type or "").lower()
    if "xml" in content_type or not content_type or "octet-stream" in content_type:
        return request._cep_raw
    if "form" in content_type:
        return (request.POST.get("XmlInput") or request.POST.get("xml") or "").encode("utf-8")
    if "json" in content_type:
        try:
            body = json.loads(request._cep_raw or b"{}")
        except ValueError:
            return b""
        return str(body.get("XmlInput") or body.get("xml") or "").encode("utf-8")
    return request._cep_raw


# ------------------------------------------------------------------------------------------------------------ stores
class StoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = ("id", *STORE_FIELDS, "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def validate_store_number(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Give the store its number, as the point of sale sends it.")
        return value

    def validate_name(self, value):
        value = " ".join((value or "").split())
        if not value:
            raise serializers.ValidationError("Give the store a name.")
        return value

    def validate(self, attrs):
        number = attrs.get("store_number", getattr(self.instance, "store_number", None))
        others = Store.objects.filter(tenant_id=context.require().tenant_id, store_number=number).exclude(pk=getattr(self.instance, "pk", None))
        if number and others.exists():
            raise serializers.ValidationError({"store_number": f"Store {number} is already listed."})
        return attrs


class StoreViewSet(viewsets.ModelViewSet):
    """The workspace's stores, by the number the point of sale sends. Reads need campaign.view, changes user.admin."""
    queryset = Store.objects.none()
    serializer_class = StoreSerializer
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_permissions(self):
        return [p() for p in (VIEW if self.request.method in ("GET", "HEAD", "OPTIONS") else ADMIN)]

    def get_queryset(self):
        return Store.objects.filter(tenant_id=context.require().tenant_id).order_by("store_number")

    def perform_create(self, serializer):
        serializer.save(tenant_id=context.require().tenant_id, created_by_id=self.request.user.pk)

    def perform_update(self, serializer):
        serializer.save(updated_by_id=self.request.user.pk)

    @extend_schema(request=None, responses={200: None})
    @action(detail=False, methods=["post"], url_path="import")
    def import_csv(self, request, version=None):
        """A CSV with a header row of store columns (store_number and name at least); a store already listed is updated."""
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Choose a CSV file."})
        text = upload.read().decode("utf-8-sig", "replace")
        reader = csv.DictReader(io.StringIO(text))
        headers = {(h or "").strip().lower().replace(" ", "_"): h for h in (reader.fieldnames or [])}
        if "store_number" not in headers and "store" not in headers and "number" not in headers:
            raise ValidationError({"file": "The first row must name the columns, with store_number among them."})
        added = updated = 0
        problems = []
        tenant_id = context.require().tenant_id
        for line, row in enumerate(reader, start=2):
            values = {key.strip().lower().replace(" ", "_"): (value or "").strip() for key, value in row.items() if key}
            number = values.get("store_number") or values.get("store") or values.get("number")
            if not number:
                problems.append(f"line {line}: no store number")
                continue
            data = {field: values[field] for field in STORE_FIELDS if field in values and field != "is_active"}
            data["store_number"] = number
            if "is_active" in values:
                data["is_active"] = values["is_active"].lower() not in ("0", "false", "no", "off")
            existing = Store.objects.filter(tenant_id=tenant_id, store_number=number).first()
            form = StoreSerializer(existing, data=data if existing is None else {**data}, partial=existing is not None, context={"request": request})
            if not form.is_valid():
                problems.append(f"line {line}: " + "; ".join(f"{k}: {v[0] if isinstance(v, list) else v}" for k, v in form.errors.items()))
                continue
            if existing is None:
                form.save(tenant_id=tenant_id, created_by_id=request.user.pk)
                added += 1
            else:
                form.save(updated_by_id=request.user.pk)
                updated += 1
        return Response({"added": added, "updated": updated, "problems": problems[:50]})


# ------------------------------------------------------------------------------------------------------------ settings and the trail
class PosSettingsView(APIView):
    """Which e-receipt campaign the point of sale's transactions go out on, and what the point of sale must be told."""
    permission_classes = ADMIN

    def _payload(self, tenant):
        from apps.campaigns.models import Campaign
        live = Campaign.objects.filter(tenant_id=tenant.pk, deleted_at__isnull=True, campaign_type="E_RECEIPT").order_by("name")
        return {**mapping.settings_of(tenant), "endpoint": f"{params.public_api_url()}/api/v1/pos/transactions/", "tenant_key": tenant.code,
                "headers": ["X-Tenant-Key", "accessTokenKey"], "scope": "receipts:send",
                "campaigns": [{"id": str(c.pk), "name": c.name, "code": c.code, "status": c.status, "channel": c.channel, "ready": c.status in ("PRODUCTION_PUBLISHED", "ACTIVE")} for c in live],
                "stores": Store.objects.filter(tenant_id=tenant.pk).count()}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(Tenant.objects.get(pk=context.require().tenant_id)))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        from apps.campaigns.models import Campaign
        tenant = Tenant.objects.get(pk=context.require().tenant_id)
        data = request.data if isinstance(request.data, dict) else {}
        for key, channels in (("campaign", ("EMAIL", "MULTI")), ("return_campaign", ("EMAIL", "MULTI")), ("text_campaign", ("SMS", "MMS"))):
            if data.get(key) and not Campaign.objects.filter(pk=data[key], tenant_id=tenant.pk, deleted_at__isnull=True, campaign_type="E_RECEIPT", channel__in=channels).exists():
                raise ValidationError({key: "Choose one of this workspace's e-receipt campaigns" + (" on the SMS channel." if key == "text_campaign" else " on the email channel.")})
        mapping.save_settings(tenant, data)
        return Response(self._payload(tenant))


CODE_WORDS = {"S100": "Receipt sent", "S101": "No email address", "S102": "Already received", "S103": "Text receipt sent", "S104": "Printed, no e-receipt", "S105": "Text not sent",
              "E888": "Wrong key", "E900": "Engine refused", "E120": "No campaign",
              "E121": "Address blocked", "E122": "Not in the plan", "E429": "Over the limit", "E503": "Paused"}


class PosReceivedView(APIView):
    """What the point of sale sent, newest first, read from the integration log: nothing about a transaction is stored elsewhere."""
    permission_classes = VIEW

    @extend_schema(parameters=[OpenApiParameter("q", str), OpenApiParameter("code", str), OpenApiParameter("days", int), OpenApiParameter("before", str)], responses={200: None})
    def get(self, request, version=None):
        tenant_id = context.require().tenant_id
        record = logbook.integration_for(tenant_id, kind=logbook.KIND_POS, system="POS", create=False)
        rows = IntegrationLog.objects.filter(tenant_id=tenant_id, direction="IN", kind=logbook.KIND_POS).order_by("-started_at", "-id")
        if record:
            rows = rows.filter(integration_id=record["id"])
        params_ = request.query_params
        try:
            days = min(365, max(1, int(params_.get("days", 30))))
        except ValueError:
            raise ValidationError({"days": "A whole number of days."}) from None
        rows = rows.filter(started_at__gte=timezone.now() - timedelta(days=days))
        if params_.get("q"):
            q = params_["q"].strip()[:60]
            rows = rows.filter(related_ref=f"receipt:{q}") | rows.filter(related_ref__icontains=q)
        if params_.get("before"):
            try:
                rows = rows.filter(started_at__lt=datetime.fromisoformat(params_["before"]))
            except ValueError:
                raise ValidationError({"before": "An ISO 8601 time."}) from None
        wanted = params_.get("code")
        page, out = list(rows[:301]), []
        for row in page:
            answer = _answer(row)
            if wanted and answer.get("code") != wanted:
                continue
            out.append({"id": row.id, "at": row.started_at, "transaction_id": (row.related_ref or "").removeprefix("receipt:") or None, "code": answer.get("code"),
                        "code_label": CODE_WORDS.get(answer.get("code") or "", answer.get("code")), "message": answer.get("message"), "http_status": row.response_status,
                        "outcome": row.outcome, "execution_id": answer.get("EXECUTION_ID"), "message_id": answer.get("MESSAGE_ID"), "bytes": row.request_bytes,
                        "duration_ms": row.duration_ms})
            if len(out) >= 100:
                break
        return Response({"results": out, "more": len(page) > 300, "next_before": page[-1].started_at if len(page) > 300 else None, "days": days})


def _answer(row) -> dict:
    try:
        data = json.loads(row.response_body or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


class PosSampleView(APIView):
    """GET /pos/sample/: a TTDR document a developer can post to try the endpoint (the receipt goes to the address in it)."""
    permission_classes = VIEW

    @extend_schema(responses={(200, "application/xml"): str})
    def get(self, request, version=None):
        from pathlib import Path
        sample = Path(ttdr.__file__).parent / "schemas" / "sample-transaction.xml"
        text = sample.read_text(encoding="utf-8") if sample.exists() else ""
        return HttpResponse(text.replace("someone@example.com", request.user.email if hasattr(request.user, "email") else "someone@example.com"), content_type="application/xml; charset=utf-8")
