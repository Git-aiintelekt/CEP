"""A text receipt: the point of sale asked for SMS (EntryType), so the transaction goes out as a text on the workspace's e-receipt
campaign of the SMS channel — its message template rendered with the same tags as the email receipt, through the campaign's sender
and text engine, recorded as an sms_execution under the campaign's run of the day (so callbacks, opt-outs and the Recipients tab
work as for any text). Transactional: marketing consent does not apply; a number that replied STOP or is blocked is refused."""
from __future__ import annotations

import json

from django.utils import timezone

from apps.campaigns.models import Campaign
from apps.delivery.engine import receipts, session
from apps.delivery.engine.dispatch_sms import text_content
from apps.delivery.engine.receipts import ReceiptRefused
from apps.delivery.engine.render import Renderer
from apps.delivery.providers import Outcome, ProviderError, SmsMessage, registry
from apps.templates import design
from apps.templates.models import PersonalizationTag, RenderedTemplateContent


def _campaign(tenant_id, reference: str) -> Campaign:
    import uuid
    found = Campaign.objects.select_related("template", "sender_profile__delivery_provider", "tenant").filter(tenant_id=tenant_id, deleted_at__isnull=True, campaign_type="E_RECEIPT")
    try:
        found = found.filter(pk=uuid.UUID(str(reference)))
    except ValueError:
        found = found.filter(code=reference)
    campaign = found.first()
    if campaign is None:
        raise ReceiptRefused("No text e-receipt campaign with this id or code.", "campaign", 404)
    if campaign.channel not in ("SMS", "MMS"):
        raise ReceiptRefused("The text receipt campaign must be on the SMS channel.", "campaign", 409)
    if campaign.status not in ("PRODUCTION_PUBLISHED", "ACTIVE"):
        raise ReceiptRefused("Publish the text e-receipt campaign before sending receipts with it.", "campaign", 409)
    sender = campaign.sender_profile
    if sender is None or sender.deleted_at is not None or sender.verification_status != "VERIFIED":
        raise ReceiptRefused("The text campaign's sender is missing or not verified.", "campaign", 409)
    return campaign


def send(tenant_id, *, campaign_ref: str, to_number: str, receipt: dict, store: dict | None, party_id: str | None, name: str, idempotency_key: str,
         extra_sources: dict | None = None) -> dict:
    """-> {'status', 'execution_id', 'provider_message_id', 'duplicate', 'segments'}; raises ReceiptRefused."""
    campaign = _campaign(tenant_id, campaign_ref)
    key = f"{tenant_id}:{campaign.pk}:RECEIPT:{idempotency_key}"[:200]
    with session.connection().cursor() as cursor:
        cursor.execute("""SELECT id, status, provider_message_id, created_at FROM sms_execution WHERE tenant_id = %s AND idempotency_key = %s
                           ORDER BY (status = 'FAILED'), created_at DESC LIMIT 1""", [str(tenant_id), key])
        existing = cursor.fetchone()
        if existing and existing[1] != "FAILED":
            return {"status": existing[1], "execution_id": existing[0], "provider_message_id": existing[2], "duplicate": True, "segments": None}
        cursor.execute("""SELECT block_reason FROM contact_point_status WHERE tenant_id = %s AND contact_point_type = 'PHONE' AND contact_value = %s::citext AND blocked""",
                       [str(tenant_id), to_number])
        blocked = cursor.fetchone()
        if not blocked and party_id:
            cursor.execute("SELECT 1 FROM consent_suppression WHERE tenant_id = %s AND party_id = %s AND channel IN ('SMS', 'MMS') AND consent_status = 'OPTED_OUT'", [str(tenant_id), party_id])
            blocked = ("SMS_STOP",) if cursor.fetchone() else None
    if blocked:
        raise ReceiptRefused(f"This number is blocked ({(blocked[0] or 'blocked').replace('_', ' ').lower()}): nothing was sent.", "to", 422)

    from apps.platform_ops import billing
    billing.assert_can_send(tenant_id)
    content = RenderedTemplateContent.objects.filter(template_id=campaign.template_id).order_by("-version_number").first()
    if content is None or not (content.sms_body or content.text_content):
        raise ReceiptRefused("The text campaign's template has no saved message.", "campaign", 409)
    tags = list(PersonalizationTag.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True))
    run = receipts._run_of_today(tenant_id, campaign)
    sender = campaign.sender_profile
    currency = str(receipt.get("currency") or "USD")
    shown = {**receipt, **{k: receipts.money(v, currency) for k, v in receipt.items() if k in receipts.MONEY_KEYS and v is not None}}
    customer = {"party_id": party_id or "", "first_name": (name or "").split(" ")[0], "last_name": " ".join((name or "").split(" ")[1:]), "email": "", "custom_attributes": {}}
    renderer = Renderer(campaign=campaign, run=run, content=text_content(content), tags=tags)
    rendered = renderer.render(customer=customer, member={"custom_value_pairs": receipts.coupon_values(receipt)}, system={"phone": to_number},
                               sources={"RECEIPT": {"receipt": shown}, "STORE": store or {}, **(extra_sources or {})})
    text = (rendered.get("text") or "").strip()
    if not text:
        raise ReceiptRefused("The text campaign's message rendered empty.", "campaign", 409)
    metrics = design.sms_metrics(text)
    media = design.message_media_url(campaign.template) if campaign.template.channel == "MMS" else None

    with session.connection().cursor() as cursor:
        if existing:
            cursor.execute("""UPDATE sms_execution SET status = 'SUBMITTED', submitted_at = now(), status_reason = NULL, phone_number = %s, campaign_run_id = %s,
                                     rendered_text = %s, segment_count = %s, delivery_provider_id = %s
                               WHERE tenant_id = %s AND id = %s AND created_at = %s RETURNING id, created_at""",
                           [to_number, str(run.pk), text, metrics["segments"], str(sender.delivery_provider_id), str(tenant_id), existing[0], existing[3]])
        else:
            cursor.execute("""INSERT INTO sms_execution (tenant_id, campaign_id, campaign_run_id, party_id, phone_number, message_type, template_version_id, from_sender_id,
                                                         provider_code, idempotency_key, status, submitted_at, rendered_text, segment_count, media_url, delivery_provider_id)
                              VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'SUBMITTED', now(), %s, %s, %s, %s) RETURNING id, created_at""",
                           [str(tenant_id), str(campaign.pk), str(run.pk), party_id or f"receipt:{idempotency_key}"[:60], to_number, "MMS" if media else "SMS", str(content.pk),
                            (sender.sender_id or "")[:30] or None, sender.delivery_provider.provider_type, key, text, metrics["segments"], media, str(sender.delivery_provider_id)])
        execution_id, created_at = cursor.fetchone()

    message = SmsMessage(to_number=to_number, from_sender=sender.sender_id or "", text=text, media_url=media, idempotency_key=key, tag=campaign.code or "receipt",
                         metadata={"cep_tenant": campaign.tenant.code, "cep_run": str(run.pk), "cep_execution": str(execution_id), "cep_party": str(party_id or ""),
                                   "cep_campaign": campaign.code or "", "cep_purpose": "receipt", "cep_receipt": str(receipt.get("number") or idempotency_key)})
    try:
        with registry.for_provider(sender.delivery_provider) as provider:
            result = provider.send_guarded(message, related_ref=f"receipt:{idempotency_key}")
            for _ in range(2):
                if result.outcome is not Outcome.RETRY:
                    break
                provider.guard.attempt += 1
                result = provider.send_guarded(message, related_ref=f"receipt:{idempotency_key}")
    except ProviderError as exc:
        result, failure = None, str(exc)
    status, reason = ("SUBMITTED", None) if result is not None and result.outcome is Outcome.ACCEPTED else ("FAILED", (result.reason if result is not None else failure)[:200])
    with session.connection().cursor() as cursor:
        cursor.execute("""UPDATE sms_execution SET status = %s, status_reason = %s, provider_message_id = %s, provider_acked_at = now(), failed_at = CASE WHEN %s = 'FAILED' THEN now() END,
                                 personalization_payload = %s::jsonb
                           WHERE tenant_id = %s AND id = %s AND created_at = %s""",
                       [status, reason, (result.provider_message_id or None) if result is not None else None, status, json.dumps(renderer.used, default=str), str(tenant_id), execution_id, created_at])
    if status == "FAILED":
        temporary = result is None or result.outcome is Outcome.RETRY
        raise ReceiptRefused(f"The text engine did not accept the receipt: {reason}", None, 424 if temporary else 422)
    return {"status": status, "execution_id": execution_id, "provider_message_id": result.provider_message_id, "duplicate": False, "segments": metrics["segments"]}
