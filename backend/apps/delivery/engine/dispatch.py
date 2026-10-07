"""Sends one batch of queued executions through the run's delivery provider.

Per message: claim (QUEUED -> SUBMITTED, committed) -> provider.send -> record (committed).
Claiming first means a worker that dies mid-batch can never send the same message twice; the worst case is a message
marked SUBMITTED that never left, which `runs.sweep` turns into FAILED so it is visible instead of silently lost.
"""
import logging

from django.utils import timezone

from apps.campaigns.models import CampaignRun
from apps.customers.models import CustomerMaster
from apps.governance import preferences
from apps.templates.models import PersonalizationTag, RenderedTemplateContent

from ..providers import TRAFFIC_BULK, TRAFFIC_TRANSACTIONAL, EmailMessage, Outcome, ProviderError, registry
from . import content as run_content, session, unsubscribe
from .render import Renderer

log = logging.getLogger("cep.delivery")
MAX_ATTEMPTS = 5


class RetryBatch(Exception):
    """Some messages hit a temporary provider problem and are QUEUED again: run the batch again later."""
    def __init__(self, execution_ids, reason):
        super().__init__(reason)
        self.execution_ids, self.reason = execution_ids, reason


def _load(tenant_id, run_id):
    with session.tx():
        run = CampaignRun.objects.select_related("campaign__template", "campaign__sender_profile__delivery_provider", "drip_step__template").get(pk=run_id, tenant_id=tenant_id)
        campaign = run.campaign
        _, content, step = run_content.of_run(run)
        tags = list(PersonalizationTag.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True).select_related("inner_template"))
        inner = {}
        for tag in tags:
            if tag.resolution_source == "INNER_TEMPLATE" and tag.inner_template_id:
                body = RenderedTemplateContent.objects.filter(template_id=tag.inner_template_id).order_by("-version_number").first()
                inner[tag.tag_key.strip("{} ")] = (body.html_content or "") if body else ""
        tenant_code = campaign.tenant.code
    return run, campaign, content, step, tags, inner, tenant_code


def _claim(tenant_id, execution_id) -> tuple | None:
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""UPDATE mailer_execution SET status = 'SUBMITTED', submitted_at = now(), attempts = attempts + 1
                           WHERE tenant_id = %s AND id = %s AND status = 'QUEUED' AND (send_after IS NULL OR send_after <= now()) AND COALESCE(variant_key, '') <> 'HOLD'
                       RETURNING party_id, email_address, idempotency_key, campaign_list_member_id, attempts, variant_key, subject_line""", [str(tenant_id), execution_id])
        return cursor.fetchone()


def _record(tenant_id, execution_id, member_id, *, status, reason=None, message_id=None) -> None:
    with session.tx(), session.connection().cursor() as cursor:
        if status == "QUEUED":
            cursor.execute("UPDATE mailer_execution SET status = 'QUEUED', submitted_at = NULL, status_reason = %s WHERE tenant_id = %s AND id = %s",
                           [reason, str(tenant_id), execution_id])
            return
        cursor.execute("UPDATE mailer_execution SET status = %s, status_reason = %s, provider_message_id = COALESCE(%s, provider_message_id) WHERE tenant_id = %s AND id = %s",
                       [status, reason, message_id or None, str(tenant_id), execution_id])
        if status == "SUBMITTED" and member_id:
            cursor.execute("UPDATE campaign_list_member SET status = 'SENT' WHERE tenant_id = %s AND id = %s", [str(tenant_id), member_id])


def _dead_letter(tenant_id, run_id, row, reason) -> None:
    import json
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("""INSERT INTO dead_letter_message (tenant_id, queue_name, task_name, campaign_run_id, party_id, channel, idempotency_key, payload, error_class,
                                                           error_message, attempts)
                          VALUES (%s, 'email', 'workers.email.send_batch', %s, %s, 'EMAIL', %s, %s::jsonb, 'ProviderTemporaryFailure', %s, %s)""",
                       [str(tenant_id), str(run_id), row[0], row[2], json.dumps({"email": row[1]}), reason, row[4]])


def send_batch(tenant_id, run_id, execution_ids: list[int]) -> dict:
    """Must be called inside session.tenant_scope(tenant_id). Raises RetryBatch when some messages should be tried again."""
    run, campaign, content, step, tags, inner, tenant_code = _load(tenant_id, run_id)
    if run.status not in ("SENDING", "PREPARING"):
        return {"skipped": len(execution_ids), "reason": f"run is {run.status}"}
    sender = campaign.sender_profile
    provider_row = sender.delivery_provider
    renderer = Renderer(campaign=campaign, run=run, content=content, tags=tags, inner_templates=inner, step=step)
    marketing = campaign.solicitation_type == "MARKETING"
    counts = {"submitted": 0, "failed": 0, "retry": 0, "skipped": 0}
    retry_ids, retry_reason = [], ""
    left_out: dict[str, int] = {}                           # source tag -> recipients in this batch whose code block was left out
    without_code = 0                                        # recipients in this batch missing at least one code block

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
            if claimed is None:                             # already handled by an earlier attempt of this batch
                counts["skipped"] += 1
                continue
            party_id, email, idempotency_key, member_id, attempts, variant_key, own_subject = claimed
            try:
                with session.tx():
                    customer = CustomerMaster.objects.filter(tenant_id=tenant_id, party_id=party_id).values("party_id", "first_name", "last_name", "custom_attributes").first() or {}
                    with session.connection().cursor() as cursor:
                        cursor.execute("SELECT custom_value_pairs, segment_codes FROM campaign_list_member WHERE tenant_id = %s AND id = %s", [str(tenant_id), member_id])
                        found = cursor.fetchone()
                member = {"custom_value_pairs": _as_dict(found[0]) if found else {}, "segment_codes": found[1] if found else []}
                customer["email"] = email
                token = unsubscribe.token_for(tenant_code=tenant_code, party_id=party_id, email=email, campaign_id=campaign.pk, run_id=run.pk)
                rendered = renderer.render(customer=customer, member=member, system={"unsubscribe_url": unsubscribe.url_for(token), "preference_url": preferences.link_for(campaign.tenant, token), "email": email},
                                           subject=own_subject if variant_key else None)
                message = EmailMessage(to_email=email, to_name=" ".join(filter(None, [customer.get("first_name"), customer.get("last_name")])),
                                       from_email=sender.from_address, from_name=sender.display_name, reply_to=sender.reply_to_address or None,
                                       subject=rendered["subject"], html=rendered["html"], text=rendered["text"], idempotency_key=idempotency_key,
                                       tag=campaign.code or "", headers=unsubscribe.headers_for(token) if marketing else {},
                                       metadata={"cep_tenant": tenant_code, "cep_run": str(run.pk), "cep_execution": str(execution_id), "cep_party": str(party_id or ""),
                                                 "cep_campaign": campaign.code or "", "cep_purpose": "marketing" if marketing else "transactional"},
                                       traffic=TRAFFIC_BULK if marketing else TRAFFIC_TRANSACTIONAL)
                result = provider.send_guarded(message, related_ref=f"mailer_execution:{execution_id}")
            except ProviderError as exc:                    # nothing more will go out: put this one back and stop
                _record(tenant_id, execution_id, member_id, status="QUEUED", reason=str(exc)[:200])
                if exc.retryable:
                    raise RetryBatch(execution_ids, str(exc)) from None
                raise
            except Exception as exc:                        # noqa: BLE001  a rendering problem with one person must not stop the run
                log.exception("execution %s could not be prepared", execution_id)
                _record(tenant_id, execution_id, member_id, status="FAILED", reason=f"{exc.__class__.__name__}: {exc}"[:200])
                counts["failed"] += 1
                continue

            if result.outcome is Outcome.ACCEPTED:
                _record(tenant_id, execution_id, member_id, status="SUBMITTED", message_id=result.provider_message_id)
                counts["submitted"] += 1
                without_code += 1 if rendered["codes_left_out"] else 0
                for source in set(rendered["codes_left_out"]):
                    left_out[source] = left_out.get(source, 0) + 1
            elif result.outcome is Outcome.REJECTED:
                _record(tenant_id, execution_id, member_id, status="FAILED", reason=result.reason)
                counts["failed"] += 1
            elif attempts >= MAX_ATTEMPTS:
                _record(tenant_id, execution_id, member_id, status="FAILED", reason=f"Gave up after {attempts} attempts: {result.reason}"[:200])
                _dead_letter(tenant_id, run_id, claimed, result.reason)
                counts["failed"] += 1
            else:
                _record(tenant_id, execution_id, member_id, status="QUEUED", reason=result.reason)
                retry_ids.append(execution_id)
                retry_reason = result.reason
                counts["retry"] += 1
    finally:
        provider.close()
        if without_code:
            record_codes_left_out(tenant_id, campaign.pk, run_id, without_code, left_out)
    if retry_ids:
        raise RetryBatch(retry_ids, retry_reason)
    return counts


CODES_LEFT_OUT = "CODES_LEFT_OUT"


def record_codes_left_out(tenant_id, campaign_id, run_id, total: int, by_source: dict[str, int]) -> None:
    """One activity entry per batch; the run's completion message adds them up (runs.codes_left_out)."""
    from apps.campaigns import service
    names = ", ".join(sorted(by_source))
    service.record_run_event(tenant_id, campaign_id, run_id, CODES_LEFT_OUT,
                             f"A barcode or QR code was left out for {total:,} recipient{'s' if total != 1 else ''} with no usable value ({names}).",
                             severity="WARNING", detail={"recipients": total, "by_source": by_source})


def fail_queued(tenant_id, run_id, reason: str, execution_ids: list[int] | None = None) -> int:
    """Everything still waiting fails with the reason: the whole run when the provider cannot send at all (bad credentials,
    switched off), or only `execution_ids` when one batch has used up its retries."""
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute("UPDATE mailer_execution SET status = 'FAILED', status_reason = %s WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'"
                       + (" AND id = ANY(%s)" if execution_ids is not None else ""),
                       [reason[:200], str(tenant_id), str(run_id), *([list(execution_ids)] if execution_ids is not None else [])])
        return cursor.rowcount


def _as_dict(value) -> dict:
    import json
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def send_test(tenant_id, campaign, to: list[str], *, step=None, label: dict | None = None) -> list[dict]:
    """Sends the campaign's current content to a few addresses, personalized with the catalogue's sample values.
    Nothing is recorded as an execution and no consent rule applies: the recipients are the people building the campaign.
    A drip message's test (`step`) sends that message's template, subject, preheader and A/B test; `label` marks it:
    {"subject": "[Test 2 of 4 · would send Day 3]", "banner": "Test · Message 2 of 4 · ..."}."""
    with session.tx():
        template_id = (step.template_id if step is not None else campaign.template_id)
        content = RenderedTemplateContent.objects.filter(template_id=template_id).order_by("-version_number").first()
        tags = list(PersonalizationTag.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True))
        sender = campaign.sender_profile
        provider_row = sender.delivery_provider
        tenant_code = campaign.tenant.code
    samples = {tag.tag_key.strip("{} "): tag.sample_value for tag in tags if tag.sample_value}
    renderer = Renderer(campaign=campaign, run=None, content=content, tags=[], step=step)
    # with a subject line test, each address gets both: [TEST A] with the template's subject and [TEST B] with the second one
    from . import abtest
    from .render import with_banner
    test = abtest.config(campaign, step)
    variants = [("A", None), ("B", test["subject_b"])] if test else [(None, None)]
    results = []
    with registry.for_provider(provider_row) as provider:
        for address in to:
            for variant, own_subject in variants:
                token = unsubscribe.test_token(tenant_code=tenant_code, email=address)
                rendered = renderer.render(customer={}, member={"custom_value_pairs": samples},
                                           system={"unsubscribe_url": unsubscribe.url_for(token), "preference_url": preferences.link_for(campaign.tenant, token), "email": address},
                                           subject=own_subject)
                if label:
                    words = label["subject"]
                    mark = (words[:-1] + f" · {variant}] " if variant else words + " ")
                    html, text = with_banner(rendered["html"], label["banner"]), label["banner"] + "\n\n" + rendered["text"]
                else:
                    mark, html, text = (f"[TEST {variant}] " if variant else "[TEST] "), rendered["html"], rendered["text"]
                result = provider.send(EmailMessage(to_email=address, from_email=sender.from_address, from_name=sender.display_name, reply_to=sender.reply_to_address or None,
                                                    subject=mark + rendered["subject"], html=html, text=text,
                                                    idempotency_key=f"test:{campaign.pk}:{getattr(step, 'pk', '')}:{variant or ''}:{timezone.now().timestamp():.0f}", tag="test",
                                                    metadata={"cep_tenant": tenant_code}))
                results.append({"to": address, "ok": result.outcome is Outcome.ACCEPTED, "detail": result.reason or result.provider_message_id,
                                **({"variant": variant, "subject": rendered["subject"]} if variant and not label else {}),
                                **({"subject": mark + rendered["subject"], **({"variant": variant} if variant else {})} if label else {})})
    return results
