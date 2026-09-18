"""E-receipts: one transactional email per purchase, sent the moment the point of sale or the web shop asks.

Unlike a campaign run there is no audience to build: the caller names the recipient and supplies the receipt. The message
goes through the same provider adapter, is recorded as a mailer_execution (so callbacks, reports and metering work
unchanged) under the campaign's ERECEIPT_INSTANCE run of the day, and is idempotent on the receipt number: a cash
register that retries does not make the customer receive two receipts.

Receipts are transactional: marketing consent and frequency caps do not apply. A blocked address (hard bounce,
complaint) is still refused, because sending to it again harms the sender's reputation.
"""
from __future__ import annotations

import base64
import binascii
from html import escape

from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignRun
from apps.templates.models import PersonalizationTag, RenderedTemplateContent

from ..providers import Attachment, EmailMessage, Outcome, ProviderError, registry
from . import session
from .render import Renderer

MAX_ATTACHMENTS = 5
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "CAD": "CA$", "AUD": "A$", "JPY": "¥"}
MONEY_KEYS = {"subtotal", "discount_total", "tax_total", "grand_total", "shipping_total", "tip_total", "amount_paid", "change_due"}


class ReceiptRefused(Exception):
    """The receipt cannot be sent as asked. `field` names the offending input when there is one."""
    def __init__(self, message: str, field: str | None = None, status: int = 400):
        super().__init__(message)
        self.field, self.status = field, status


def money(value, currency: str = "USD") -> str:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return str(value)
    symbol = SYMBOLS.get((currency or "USD").upper())
    text = f"{abs(amount):,.2f}"
    return f"{'-' if amount < 0 else ''}{symbol}{text}" if symbol else f"{'-' if amount < 0 else ''}{text} {currency.upper()}"


def items_html(items: list[dict], currency: str) -> str:
    """The {{receipt_body}} block: one row per line item. Every value is escaped here, so the renderer inserts it as it is."""
    if not items:
        return ""
    rows = []
    for item in items:
        quantity = item.get("quantity", 1)
        shown_quantity = f"{quantity:g}" if isinstance(quantity, (int, float)) else str(quantity)         # 2, not 2.0; 0.5 stays 0.5
        detail = " · ".join(filter(None, [f"SKU {escape(str(item['sku']))}" if item.get("sku") else "",
                                           f"{escape(shown_quantity)} × {escape(money(item['unit_price'], currency))}" if item.get("unit_price") is not None else ""]))
        rows.append('<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:20px;color:#0f172a;">'
                    f'{escape(str(item.get("description") or item.get("name") or "Item"))}'
                    + (f'<br><span style="font-size:12px;color:#64748b;">{detail}</span>' if detail else "") + "</td>"
                    '<td align="right" style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:20px;color:#0f172a;white-space:nowrap;">'
                    f'{escape(money(item.get("total", (item.get("unit_price") or 0) * (quantity or 1)), currency))}</td></tr>')
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + "".join(rows) + "</table>"


def _attachments(raw: list[dict]) -> list[Attachment]:
    if len(raw) > MAX_ATTACHMENTS:
        raise ReceiptRefused(f"At most {MAX_ATTACHMENTS} attachments.", "attachments")
    out, total = [], 0
    for index, item in enumerate(raw):
        try:
            data = base64.b64decode(item.get("data") or "", validate=True)
        except (binascii.Error, ValueError):
            raise ReceiptRefused(f"Attachment {index + 1}: data must be base64.", "attachments") from None
        if not item.get("name") or not data:
            raise ReceiptRefused(f"Attachment {index + 1} needs a name and data.", "attachments")
        total += len(data)
        out.append(Attachment(str(item["name"])[:200], str(item.get("content_type") or "application/octet-stream"), data))
    if total > MAX_ATTACHMENT_BYTES:
        raise ReceiptRefused("Attachments may be 10 MB in total.", "attachments")
    return out


def _campaign(tenant_id, reference: str) -> Campaign:
    found = Campaign.objects.select_related("template", "sender_profile__delivery_provider", "tenant").filter(tenant_id=tenant_id, deleted_at__isnull=True,
                                                                                                               campaign_type="E_RECEIPT")
    import uuid
    try:
        found = found.filter(pk=uuid.UUID(str(reference)))
    except ValueError:
        found = found.filter(code=reference)
    campaign = found.first()
    if campaign is None:
        raise ReceiptRefused("No e-receipt campaign with this id or code.", "campaign", 404)
    if campaign.status not in ("PRODUCTION_PUBLISHED", "ACTIVE"):
        raise ReceiptRefused("Publish the e-receipt campaign before sending receipts with it.", "campaign", 409)
    sender = campaign.sender_profile
    if sender is None or sender.deleted_at is not None or sender.verification_status != "VERIFIED":
        raise ReceiptRefused("The campaign's sender is missing or not verified.", "campaign", 409)
    return campaign


def _run_of_today(tenant_id, campaign) -> CampaignRun:
    today = timezone.localdate()
    run = CampaignRun.objects.filter(campaign=campaign, tenant_id=tenant_id, run_type="ERECEIPT_INSTANCE", status="SENDING", created_at__date=today).order_by("-run_number").first()
    if run is None:
        CampaignRun.objects.filter(campaign=campaign, tenant_id=tenant_id, run_type="ERECEIPT_INSTANCE", status="SENDING").update(status="COMPLETED", completed_at=timezone.now())
        run = CampaignRun.objects.create(campaign=campaign, tenant_id=tenant_id, run_type="ERECEIPT_INSTANCE", status="SENDING", started_at=timezone.now(),
                                         run_number=(CampaignRun.objects.filter(campaign=campaign).count() + 1))
        Campaign.objects.filter(pk=campaign.pk, status="PRODUCTION_PUBLISHED").update(status="ACTIVE")
    return run


def send(tenant_id, *, campaign_ref: str, to: str, receipt: dict, store: dict | None = None, party_id: str | None = None, name: str = "",
         attachments: list[dict] | None = None, idempotency_key: str | None = None) -> dict:
    """Runs inside the caller's tenant transaction (the API request). -> {'status', 'execution_id', 'provider_message_id', 'duplicate'}"""
    number = str(idempotency_key or receipt.get("number") or receipt.get("order_number") or "").strip()
    if not number:
        raise ReceiptRefused("Give receipt.number (or order_number, or idempotency_key): it makes retries safe.", "receipt")
    files = _attachments(attachments or [])
    campaign = _campaign(tenant_id, campaign_ref)
    key = f"{tenant_id}:{campaign.pk}:RECEIPT:{number}"[:200]
    to = to.strip().lower()

    with session.connection().cursor() as cursor:
        cursor.execute("""SELECT id, status, provider_message_id, created_at FROM mailer_execution WHERE tenant_id = %s AND idempotency_key = %s
                           ORDER BY (status = 'FAILED'), created_at DESC LIMIT 1""", [str(tenant_id), key])
        existing = cursor.fetchone()
        if existing and existing[1] != "FAILED":
            return {"status": existing[1], "execution_id": existing[0], "provider_message_id": existing[2], "duplicate": True}
        cursor.execute("SELECT block_reason FROM contact_point_status WHERE tenant_id = %s AND contact_point_type = 'EMAIL' AND contact_value = %s AND blocked", [str(tenant_id), to])
        blocked = cursor.fetchone()
    if blocked:
        raise ReceiptRefused(f"This address is blocked ({(blocked[0] or 'blocked').replace('_', ' ').lower()}): nothing was sent.", "to", 422)

    from apps.platform_ops import billing
    billing.assert_can_send(tenant_id)
    content = RenderedTemplateContent.objects.filter(template_id=campaign.template_id).order_by("-version_number").first()
    if content is None or not (content.html_content or content.text_content):
        raise ReceiptRefused("The campaign's template has no saved content.", "campaign", 409)
    tags = list(PersonalizationTag.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True))
    run = _run_of_today(tenant_id, campaign)
    sender = campaign.sender_profile

    currency = str(receipt.get("currency") or "USD")
    shown = {**receipt, **{k: money(v, currency) for k, v in receipt.items() if k in MONEY_KEYS and v is not None}}
    customer = {"party_id": party_id or "", "first_name": (name or "").split(" ")[0], "last_name": " ".join((name or "").split(" ")[1:]), "email": to, "custom_attributes": {}}
    if party_id:
        from apps.customers.models import CustomerMaster
        known = CustomerMaster.objects.filter(tenant_id=tenant_id, party_id=party_id).values("party_id", "first_name", "last_name", "custom_attributes").first()
        if known:
            customer = {**known, "email": to, "first_name": known["first_name"] or customer["first_name"]}
    rendered = Renderer(campaign=campaign, run=run, content=content, tags=tags).render(
        customer=customer, member={"custom_value_pairs": {}}, system={"email": to},
        sources={"RECEIPT": {"receipt": shown}, "STORE": store or {}}, html_blocks={"receipt_body": items_html(receipt.get("items") or [], currency)})

    with session.connection().cursor() as cursor:
        if existing:                                        # an earlier attempt failed: the same row is tried again, so one receipt stays one execution
            cursor.execute("""UPDATE mailer_execution SET status = 'SUBMITTED', submitted_at = now(), attempts = attempts + 1, status_reason = NULL, email_address = %s,
                                     campaign_run_id = %s, subject_line = %s, delivery_provider_id = %s
                               WHERE tenant_id = %s AND id = %s AND created_at = %s RETURNING id, created_at""",
                           [to, str(run.pk), rendered["subject"], str(sender.delivery_provider_id), str(tenant_id), existing[0], existing[3]])
        else:
            cursor.execute("""INSERT INTO mailer_execution (tenant_id, campaign_id, campaign_run_id, party_id, email_address, template_version_id, subject_line, idempotency_key,
                                                            status, submitted_at, attempts, delivery_provider_id)
                              VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'SUBMITTED', now(), 1, %s) RETURNING id, created_at""",
                           [str(tenant_id), str(campaign.pk), str(run.pk), party_id or f"receipt:{number}"[:60], to, str(content.pk), rendered["subject"], key,
                            str(sender.delivery_provider_id)])
        execution_id, created_at = cursor.fetchone()

    message = EmailMessage(to_email=to, to_name=name, from_email=sender.from_address, from_name=sender.display_name, reply_to=sender.reply_to_address or None,
                           subject=rendered["subject"], html=rendered["html"], text=rendered["text"], idempotency_key=key, tag=campaign.code or "receipt",
                           metadata={"cep_tenant": campaign.tenant.code, "cep_run": str(run.pk)}, attachments=files)
    try:
        with registry.for_provider(sender.delivery_provider) as provider:
            result = provider.send(message)
            for _ in range(2):                              # a receipt is wanted now: two quick retries, then the caller decides
                if result.outcome is not Outcome.RETRY:
                    break
                result = provider.send(message)
    except ProviderError as exc:
        result = None
        failure = str(exc)
    status, reason = ("SUBMITTED", None) if result is not None and result.outcome is Outcome.ACCEPTED else ("FAILED", (result.reason if result is not None else failure)[:200])
    with session.connection().cursor() as cursor:
        cursor.execute("UPDATE mailer_execution SET status = %s, status_reason = %s, provider_message_id = %s WHERE tenant_id = %s AND id = %s AND created_at = %s",
                       [status, reason, (result.provider_message_id or None) if result is not None else None, str(tenant_id), execution_id, created_at])
    if status == "FAILED":
        temporary = result is None or result.outcome is Outcome.RETRY
        # 424, not 5xx: the request transaction is rolled back on a server error, and the failed attempt must stay on record
        raise ReceiptRefused(f"The delivery provider did not accept the receipt: {reason}", None, 424 if temporary else 422)
    return {"status": status, "execution_id": execution_id, "provider_message_id": result.provider_message_id, "duplicate": False}
