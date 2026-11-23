"""Resend Interrupted (docs/mockups/resend-interrupted.html, option A): the messages of a finished run that a send worker had
taken when it stopped, and the engine never confirmed (runs.INTERRUPTED). Some may have reached the person, so they are never
sent again on their own; the person running the campaign decides, once per message.

    overview(run) -> {"interrupted", "delivered_since", "held_back", "to_send", "first_at", "last_at", "window", "can_resend", "last_resend"}
    resend(run, *, user, at_window) -> {"resent", "left_out", "send_after"}

Left out of a resend: anyone the engine reported as delivered since, and anyone today's consent and block rules would hold
back (a STOP, an unsubscribe, a block, a marketing suppression, no consent for marketing). Frequency caps are not counted
again: it is the same message. The rest go back to QUEUED (attempts kept, reason runs.RESENT), the run reopens as SENDING
and its workers send them like any other waiting message; a second interruption is runs.INTERRUPTED_AGAIN, never offered.
"""
from apps.campaigns import service
from apps.campaigns.models import CampaignActivityLog, CampaignRun

from . import runs, session

FINISHED = ("COMPLETED", "FAILED")
LEFT_OUT = "Interrupted; not sent again (delivered since, opted out, blocked or no consent)"


def _allowed(kind: str) -> str:
    """SQL over alias x (the execution row): today's consent and block rules still let this message go. %(marketing)s is the campaign's kind."""
    if kind == "SMS":
        return """NOT EXISTS (SELECT 1 FROM contact_point_status cps WHERE cps.tenant_id = x.tenant_id AND cps.contact_point_type = 'PHONE' AND cps.contact_value = x.phone_number
                                  AND ((cps.blocked AND NOT (x.message_type = 'WHATSAPP' AND cps.block_source = 'SMS_STOP')) OR cps.is_valid = FALSE))
              AND NOT EXISTS (SELECT 1 FROM consent_suppression o WHERE o.tenant_id = x.tenant_id AND o.party_id = x.party_id AND o.consent_status = 'OPTED_OUT'
                                  AND o.channel = ANY(CASE WHEN x.message_type = 'WHATSAPP' THEN ARRAY['WHATSAPP'] ELSE ARRAY['SMS', 'MMS'] END))
              AND NOT ((%(marketing)s OR x.message_type = 'WHATSAPP') AND NOT EXISTS (
                       SELECT 1 FROM consent_suppression c WHERE c.tenant_id = x.tenant_id AND c.party_id = x.party_id AND c.consent_status = 'OPTED_IN'
                          AND NOT (%(marketing)s AND c.suppressed)
                          AND c.channel = ANY(CASE WHEN x.message_type = 'WHATSAPP' THEN ARRAY['WHATSAPP'] ELSE ARRAY[x.message_type, 'SMS'] END)))"""
    return """NOT EXISTS (SELECT 1 FROM contact_point_status cps WHERE cps.tenant_id = x.tenant_id AND cps.contact_point_type = 'EMAIL'
                              AND cps.contact_value = x.email_address::citext AND cps.blocked)
              AND NOT (%(marketing)s AND NOT EXISTS (
                       SELECT 1 FROM consent_suppression c WHERE c.tenant_id = x.tenant_id AND c.party_id = x.party_id AND c.channel = 'EMAIL'
                          AND c.consent_status = 'OPTED_IN' AND NOT c.suppressed))"""


def _scope(run) -> tuple[str, str, dict]:
    kind = runs.family(run.campaign)
    table = runs.TABLE[kind]
    args = {"tenant": str(run.tenant_id), "run": str(run.pk), "reason": runs.INTERRUPTED, "marketing": run.campaign.solicitation_type == "MARKETING"}
    return kind, table, args


def _window(run, kind: str) -> dict:
    """When a marketing send could go now: {"opens": None} inside the send window, else the moment it opens and the words."""
    if run.campaign.solicitation_type != "MARKETING":
        return {"opens": None, "words": ""}
    from apps.governance import windows
    with session.tx():
        channel = runs.text_channel(run.campaign) if kind == "SMS" else "EMAIL"
        zone = run.campaign.tenant.timezone
        with session.connection().cursor() as cursor:
            opens, words = windows.hold_until(cursor, str(run.tenant_id), channel, zone)
    return {"opens": opens, "words": words}


def overview(run) -> dict:
    """Inside session.tenant_scope: what Resend Interrupted would do for this run now."""
    kind, table, args = _scope(run)
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(f"""SELECT count(*), count(*) FILTER (WHERE x.delivered_at IS NOT NULL),
                                  count(*) FILTER (WHERE x.delivered_at IS NULL AND NOT ({_allowed(kind)})), min(x.submitted_at), max(x.submitted_at)
                             FROM {table} x WHERE x.tenant_id = %(tenant)s AND x.campaign_run_id = %(run)s AND x.status = 'FAILED' AND x.status_reason = %(reason)s""", args)
        interrupted, delivered, held, first_at, last_at = cursor.fetchone()
        window = _window(run, kind) if interrupted else {"opens": None, "words": ""}
        last = (CampaignActivityLog.objects.filter(tenant_id=run.tenant_id, campaign_run_id=run.pk, detail__has_key="resend")
                .order_by("-occurred_at").values("occurred_at", "actor_name", "detail").first())
        sender = run.campaign.sender_profile
        engine = sender.delivery_provider.name if sender is not None and sender.delivery_provider_id else ""
    return {"engine": engine, "interrupted": interrupted, "delivered_since": delivered, "held_back": held, "to_send": interrupted - delivered - held,
            "first_at": first_at, "last_at": last_at, "window": window, "can_resend": run.status in FINISHED and run.run_type != "ERECEIPT_INSTANCE",
            "last_resend": {"at": last["occurred_at"], "by": last["actor_name"], "count": last["detail"].get("resend", 0)} if last else None}


class NotNow(Exception):
    """The run is still sending (its own retries may be at work), or it is a receipt run."""


def resend(run, *, user, at_window: bool = False) -> dict:
    """Inside session.tenant_scope: the interrupted messages that may still go, back to QUEUED; the run reopens."""
    if run.status not in FINISHED or run.run_type == "ERECEIPT_INSTANCE":
        raise NotNow("Resend Interrupted is offered once the run has finished.")
    kind, table, args = _scope(run)
    window = _window(run, kind) if at_window else {"opens": None}
    with session.tx(), session.connection().cursor() as cursor:
        cursor.execute(f"""UPDATE {table} x SET status = 'QUEUED', status_reason = %(resent)s, submitted_at = NULL, enqueued_at = NULL, send_after = %(after)s
                            WHERE x.tenant_id = %(tenant)s AND x.campaign_run_id = %(run)s AND x.status = 'FAILED' AND x.status_reason = %(reason)s
                              AND x.delivered_at IS NULL AND {_allowed(kind)}""",
                       {**args, "resent": runs.RESENT, "after": window["opens"]})
        resent = cursor.rowcount
        # the rest stay failed, with the reason they were not sent again: the notice no longer offers them
        cursor.execute(f"""UPDATE {table} x SET status_reason = %(kept)s
                            WHERE x.tenant_id = %(tenant)s AND x.campaign_run_id = %(run)s AND x.status = 'FAILED' AND x.status_reason = %(reason)s""",
                       {**args, "kept": LEFT_OUT})
        left_out = cursor.rowcount
        if not resent and not left_out:
            return {"resent": 0, "left_out": 0, "send_after": None}
        if resent:
            CampaignRun.objects.filter(pk=run.pk, tenant_id=run.tenant_id, status__in=FINISHED).update(status="SENDING", completed_at=None)
        when = f" They go out when the send window opens, {window['opens']:%a %d %b %H:%M}." if resent and window["opens"] else ""
        service.record(run.campaign, "SEND_STARTED", f"Sent again: {resent:,} interrupted message{'' if resent == 1 else 's'}"
                       + (f"; {left_out:,} left out (delivered since, opted out, blocked or no consent)." if left_out else ".") + when,
                       user=user, run=run, detail={"resend": resent, "left_out": left_out})
    return {"resent": resent, "left_out": left_out, "send_after": window["opens"]}
