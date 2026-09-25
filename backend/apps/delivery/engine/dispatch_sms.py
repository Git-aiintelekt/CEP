"""Sends one batch of queued text executions (SMS or MMS) through the run's aggregator adapter. The text twin of dispatch.py:
claim (QUEUED -> SUBMITTED, committed) -> render -> provider.send -> record (committed), so nothing is ever texted twice.

What is recorded per message, because texts are regulated: the exact text sent, its number of parts (what the carrier bills),
the values merged in for this person, the sender number, and the aggregator's answer.
"""
import json
import logging
from types import SimpleNamespace

from django.utils import timezone

from apps.campaigns.models import CampaignRun
from apps.customers.models import CustomerMaster
from apps.templates import design
from apps.templates.models import PersonalizationTag, RenderedTemplateContent

from ..providers import Outcome, ProviderError, SmsMessage, registry
from . import session
from .dispatch import MAX_ATTEMPTS, RetryBatch, _as_dict
from .render import Renderer

log = logging.getLogger("cep.delivery")


def _load(tenant_id, run_id):
    with session.tx():
        run = CampaignRun.objects.select_related("campaign__template", "campaign__sender_profile__delivery_provider", "campaign__tenant").get(pk=run_id, tenant_id=tenant_id)
        campaign = run.campaign
        content = RenderedTemplateContent.objects.filter(template_id=campaign.template_id).order_by("-version_number").first()
        tags = list(PersonalizationTag.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True))
        tenant_code = campaign.tenant.code
    return run, campaign, content, tags, tenant_code


def text_content(content) -> SimpleNamespace:
    """The renderer works on (subject, html, text): a text message is the text part only."""
    return SimpleNamespace(subject_line=content.subject_line or "", html_content="", text_content=content.sms_body or "")


def _claim(tenant_id, execution_id):
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""UPDATE sms_execution SET status = 'SUBMITTED', submitted_at = now(), attempts = attempts + 1
                           WHERE tenant_id = %s AND id = %s AND status = 'QUEUED'
                       RETURNING party_id, phone_number, idempotency_key, campaign_list_member_id, attempts, media_url, message_type, from_sender_id""",
                       [str(tenant_id), execution_id])
        return cursor.fetchone()


def _record(tenant_id, execution_id, member_id, *, status, reason=None, message_id=None, text=None, segments=None, used=None, answer=None) -> None:
    with session.tx(), session.connection().cursor() as cursor:
        if status == "QUEUED":
            cursor.execute("UPDATE sms_execution SET status = 'QUEUED', submitted_at = NULL, status_reason = %s WHERE tenant_id = %s AND id = %s",
                           [reason, str(tenant_id), execution_id])
            return
        cursor.execute("""UPDATE sms_execution SET status = %s, status_reason = %s, provider_message_id = COALESCE(%s, provider_message_id), rendered_text = COALESCE(%s, rendered_text),
                                 segment_count = COALESCE(%s, segment_count), personalization_payload = COALESCE(%s::jsonb, personalization_payload),
                                 provider_acked_at = now(), response_code = %s, provider_response = %s::jsonb, failed_at = CASE WHEN %s = 'FAILED' THEN now() END
                           WHERE tenant_id = %s AND id = %s""",
                       [status, reason, message_id or None, text, segments, json.dumps(used) if used is not None else None, (answer or {}).get("outcome"),
                        json.dumps(answer or {}), status, str(tenant_id), execution_id])
        if status == "SUBMITTED" and member_id:
            cursor.execute("UPDATE campaign_list_member SET status = 'SENT' WHERE tenant_id = %s AND id = %s", [str(tenant_id), member_id])


def _dead_letter(tenant_id, run_id, claimed, reason) -> None:
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""INSERT INTO dead_letter_message (tenant_id, queue_name, task_name, campaign_run_id, party_id, channel, idempotency_key, payload, error_class,
                                                           error_message, attempts)
                          VALUES (%s, 'sms', 'workers.sms.send_batch', %s, %s, %s, %s, %s::jsonb, 'ProviderTemporaryFailure', %s, %s)""",
                       [str(tenant_id), str(run_id), claimed[0], claimed[6], claimed[2], json.dumps({"phone": claimed[1]}), reason, claimed[4]])


def send_batch(tenant_id, run_id, execution_ids: list[int]) -> dict:
    """Must be called inside session.tenant_scope(tenant_id). Raises RetryBatch when some messages should be tried again."""
    run, campaign, content, tags, tenant_code = _load(tenant_id, run_id)
    if run.status not in ("SENDING", "PREPARING"):
        return {"skipped": len(execution_ids), "reason": f"run is {run.status}"}
    provider_row = campaign.sender_profile.delivery_provider
    renderer = Renderer(campaign=campaign, run=run, content=text_content(content), tags=tags)
    counts = {"submitted": 0, "failed": 0, "retry": 0, "skipped": 0, "parts": 0}
    retry_ids, retry_reason = [], ""

    try:
        provider = registry.for_provider(provider_row)
        provider.open()
    except ProviderError as exc:
        if exc.retryable:
            raise RetryBatch(execution_ids, str(exc)) from None
        raise

    try:
        for execution_id in execution_ids:
            claimed = _claim(tenant_id, execution_id)
            if claimed is None:
                counts["skipped"] += 1
                continue
            party_id, phone, idempotency_key, member_id, attempts, media_url, message_type, from_sender = claimed
            try:
                with session.tx():
                    customer = CustomerMaster.objects.filter(tenant_id=tenant_id, party_id=party_id).values("party_id", "first_name", "last_name", "custom_attributes").first() or {}
                    with session.connection().cursor() as cursor:
                        cursor.execute("SELECT custom_value_pairs FROM campaign_list_member WHERE tenant_id = %s AND id = %s", [str(tenant_id), member_id])
                        found = cursor.fetchone()
                rendered = renderer.render(customer=customer, member={"custom_value_pairs": _as_dict(found[0]) if found else {}}, system={"phone": phone})
                text = rendered["text"].strip()
                metrics = design.sms_metrics(text)
                if not text or len(text) > design.MAX_MESSAGE_CHARS:
                    _record(tenant_id, execution_id, member_id, status="FAILED", text=text or None, segments=metrics["segments"], used=renderer.used,
                            reason="The message is empty after personalization" if not text else f"The message is {len(text)} characters after personalization (at most {design.MAX_MESSAGE_CHARS})")
                    counts["failed"] += 1
                    continue
                result = provider.send_guarded(SmsMessage(to_number=phone, from_sender=from_sender or "", text=text, media_url=media_url if message_type == "MMS" else None,
                                                  subject=rendered["subject"] if message_type == "MMS" else "", idempotency_key=idempotency_key, tag=campaign.code or "",
                                                  metadata={"cep_tenant": tenant_code, "cep_run": str(run.pk)}), related_ref=f"sms_execution:{execution_id}")
            except ProviderError as exc:
                _record(tenant_id, execution_id, member_id, status="QUEUED", reason=str(exc)[:200])
                if exc.retryable:
                    raise RetryBatch(execution_ids, str(exc)) from None
                raise
            except Exception as exc:                        # noqa: BLE001  one person's data must not stop the run
                log.exception("text execution %s could not be prepared", execution_id)
                _record(tenant_id, execution_id, member_id, status="FAILED", reason=f"{exc.__class__.__name__}: {exc}"[:200])
                counts["failed"] += 1
                continue

            answer = {"outcome": result.outcome.value, "provider_message_id": result.provider_message_id, "reason": result.reason}
            if result.outcome is Outcome.ACCEPTED:
                _record(tenant_id, execution_id, member_id, status="SUBMITTED", message_id=result.provider_message_id, text=text, segments=metrics["segments"],
                        used=renderer.used, answer=answer)
                counts["submitted"] += 1
                counts["parts"] += metrics["segments"]
            elif result.outcome is Outcome.REJECTED:
                _record(tenant_id, execution_id, member_id, status="FAILED", reason=result.reason, text=text, segments=metrics["segments"], used=renderer.used, answer=answer)
                counts["failed"] += 1
            elif attempts >= MAX_ATTEMPTS:
                _record(tenant_id, execution_id, member_id, status="FAILED", reason=f"Gave up after {attempts} attempts: {result.reason}"[:200], text=text, answer=answer)
                _dead_letter(tenant_id, run_id, claimed, result.reason)
                counts["failed"] += 1
            else:
                _record(tenant_id, execution_id, member_id, status="QUEUED", reason=result.reason)
                retry_ids.append(execution_id)
                retry_reason = result.reason
                counts["retry"] += 1
    finally:
        provider.close()
    if retry_ids:
        raise RetryBatch(retry_ids, retry_reason)
    return counts


def fail_queued(tenant_id, run_id, reason: str, execution_ids: list[int] | None = None) -> int:
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("UPDATE sms_execution SET status = 'FAILED', failed_at = now(), status_reason = %s WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'"
                       + (" AND id = ANY(%s)" if execution_ids is not None else ""),
                       [reason[:200], str(tenant_id), str(run_id), *([list(execution_ids)] if execution_ids is not None else [])])
        return cursor.rowcount


def send_test(tenant_id, campaign, to: list[str]) -> list[dict]:
    """The campaign's current text to a few numbers, with the catalogue's sample values. Not recorded as an execution."""
    with session.tx():
        content = RenderedTemplateContent.objects.filter(template_id=campaign.template_id).order_by("-version_number").first()
        tags = list(PersonalizationTag.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True))
        sender = campaign.sender_profile
        provider_row = sender.delivery_provider
        media = design.message_media_url(campaign.template) if campaign.template.channel == "MMS" else None
    samples = {tag.tag_key.strip("{} "): tag.sample_value for tag in tags if tag.sample_value}
    rendered = Renderer(campaign=campaign, run=None, content=text_content(content), tags=[]).render(customer={}, member={"custom_value_pairs": samples}, system={})
    results = []
    with registry.for_provider(provider_row) as provider:
        for number in to:
            result = provider.send(SmsMessage(to_number=number, from_sender=sender.sender_id or "", text="[TEST] " + rendered["text"].strip(), media_url=media,
                                              idempotency_key=f"test:{campaign.pk}:{timezone.now().timestamp():.0f}", tag="test"))
            results.append({"to": number, "ok": result.outcome is Outcome.ACCEPTED, "detail": result.reason or result.provider_message_id})
    return results
