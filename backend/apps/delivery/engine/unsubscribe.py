"""The unsubscribe link in every marketing email, and what happens when it is used.

The link carries a signed token (no database lookup to read it, nothing guessable): tenant code, party, campaign, run and
the address. GET shows a confirmation page (mail scanners follow links; they do not press buttons), POST records the
opt-out. Mailbox providers' one-click unsubscribe (RFC 8058) POSTs to the same address. A test send carries a token marked
`test`: its page says the message was a test and nothing is ever opted out through it.
"""
from django.core import signing
from django.utils import timezone

from apps.platform_ops import params

from . import session

SALT = "cep.unsubscribe"


def token_for(*, tenant_code: str, party_id: str, email: str, campaign_id, run_id) -> str:
    return signing.dumps({"t": tenant_code, "p": party_id, "e": email, "c": str(campaign_id), "r": str(run_id)}, salt=SALT, compress=True)


def test_token(*, tenant_code: str, email: str) -> str:
    """The link in a test send: signed so the page can name the workspace, marked so nothing is opted out through it."""
    return signing.dumps({"t": tenant_code, "e": email, "test": True}, salt=SALT, compress=True)


def read(token: str) -> dict | None:
    try:
        return signing.loads(token, salt=SALT)              # no max_age: a link in a year-old email must still work
    except signing.BadSignature:
        return None


def url_for(token: str) -> str:
    return f"{params.public_api_url()}/api/v1/public/unsubscribe/?t={token}"


def headers_for(token: str) -> dict[str, str]:
    return {"List-Unsubscribe": f"<{url_for(token)}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}


def opt_out(*, tenant_id, party_id: str, email: str = "", campaign_id=None, run_id=None, method: str = "UNSUBSCRIBE_LINK", evidence: dict | None = None,
            execution_id: int | None = None, channel: str = "EMAIL") -> bool:
    """Records the opt-out (append-only consent_record) and updates the current state. Returns False when already opted out.
    method: UNSUBSCRIBE_LINK | COMPLAINT | SMS_STOP. For texts pass channel='SMS' (and again 'MMS': a STOP covers both)."""
    source = method if method in ("COMPLAINT", "SMS_STOP") else "UNSUBSCRIBE_LINK"
    reason = {"COMPLAINT": "COMPLAINT", "SMS_STOP": "SMS_STOP"}.get(method, "UNSUBSCRIBED")
    execution_column = "mailer_execution_id" if channel == "EMAIL" else "sms_execution_id"
    now = timezone.now()
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT consent_status FROM consent_suppression WHERE tenant_id = %s AND party_id = %s AND channel = %s", [str(tenant_id), party_id, channel])
        row = cursor.fetchone()
        if row and row[0] == "OPTED_OUT":
            return False
        cursor.execute(f"""INSERT INTO consent_record (tenant_id, party_id, channel, action, source, evidence, campaign_id, campaign_run_id, {execution_column}, occurred_at)
                           VALUES (%s, %s, %s, 'OPT_OUT', %s, %s::jsonb, %s, %s, %s, %s) RETURNING id""",
                       [str(tenant_id), party_id, channel, source, _json({"email": email, **(evidence or {})} if channel == "EMAIL" else (evidence or {})),
                        campaign_id and str(campaign_id), run_id and str(run_id), execution_id, now])
        record_id = cursor.fetchone()[0]
        cursor.execute("""INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, opted_out_at, opt_out_method, marketable, marketable_reason,
                                                          last_consent_record_id, source_system, updated_at)
                          VALUES (%s, %s, %s, 'OPTED_OUT', %s, %s, FALSE, %s, %s, 'CEP', %s)
                          ON CONFLICT (tenant_id, party_id, channel) DO UPDATE
                             SET consent_status = 'OPTED_OUT', opted_out_at = EXCLUDED.opted_out_at, opt_out_method = EXCLUDED.opt_out_method, marketable = FALSE,
                                 marketable_reason = EXCLUDED.marketable_reason, last_consent_record_id = EXCLUDED.last_consent_record_id, updated_at = EXCLUDED.updated_at""",
                       [str(tenant_id), party_id, channel, now, method, reason, record_id, now])
    return True


def opt_in(*, tenant_id, party_id: str, channel: str, evidence: dict | None = None, execution_id: int | None = None) -> bool:
    """START / UNSTOP: the person asks for texts again. Returns False when they were not opted out."""
    now = timezone.now()
    with session.connection().cursor() as cursor:
        cursor.execute("SELECT consent_status FROM consent_suppression WHERE tenant_id = %s AND party_id = %s AND channel = %s", [str(tenant_id), party_id, channel])
        row = cursor.fetchone()
        if not row or row[0] != "OPTED_OUT":
            return False
        cursor.execute("""INSERT INTO consent_record (tenant_id, party_id, channel, action, source, evidence, sms_execution_id, occurred_at)
                          VALUES (%s, %s, %s, 'RESUBSCRIBE', 'SMS_STOP', %s::jsonb, %s, %s) RETURNING id""",
                       [str(tenant_id), party_id, channel, _json(evidence or {}), execution_id, now])
        record_id = cursor.fetchone()[0]
        cursor.execute("""UPDATE consent_suppression SET consent_status = 'OPTED_IN', opted_in_at = %s, opted_out_at = NULL, opt_out_method = NULL, marketable = NOT suppressed,
                                 marketable_reason = NULL, last_consent_record_id = %s, updated_at = %s
                           WHERE tenant_id = %s AND party_id = %s AND channel = %s""", [now, record_id, now, str(tenant_id), party_id, channel])
    return True


def _json(value) -> str:
    import json
    return json.dumps(value, default=str)
