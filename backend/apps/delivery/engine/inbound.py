"""What people text back.

    STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT, REVOKE  (first word)  -> opted out of SMS and MMS, the number is blocked
    START, UNSTOP, SUBSCRIBE                                       (whole text)  -> opted in again, a STOP block on the number is lifted
    HELP, INFO                                                     (whole text)  -> recorded as a help request
    anything else                                                                -> recorded as a reply; the message they answered becomes RESPONDED

A STOP belongs to the NUMBER, not only to the person: the number is blocked even when nobody in customer_master owns it,
so another record carrying the same number is not texted either. Confirmation and help texts are the aggregator's job in
most programmes (carriers require them on the short code itself); the platform records and enforces.
"""
import json
import re

from django.utils import timezone

from ..providers.base import InboundMessage
from . import events, session, unsubscribe

STOP_WORDS = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"}
START_WORDS = {"START", "UNSTOP", "SUBSCRIBE"}
HELP_WORDS = {"HELP", "INFO"}
E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")


def classify(text: str) -> tuple[str | None, str]:
    """-> (keyword, action). STOP counts as the first word ('STOP please'); the others only as the whole message."""
    words = re.findall(r"[A-Za-z]+", (text or "").upper())
    if words and words[0] in STOP_WORDS:
        return words[0], "OPT_OUT"
    if len(words) == 1 and words[0] in START_WORDS:
        return words[0], "OPT_IN"
    if len(words) == 1 and words[0] in HELP_WORDS:
        return words[0], "HELP"
    return None, "NONE"


def candidates(number: str) -> list[str]:
    """Aggregators report the sender with or without '+', and North American ones often without the country code."""
    digits = re.sub(r"\D", "", number or "")
    found = ["+" + digits] if digits else []
    if len(digits) == 10:
        found.append("+1" + digits)
    return [n for n in found if E164.match(n)]


def handle(tenant_id, provider_type: str, message: InboundMessage) -> str:
    """-> 'OPT_OUT' | 'OPT_IN' | 'HELP' | 'NONE' | 'duplicate' | 'invalid'. Runs inside the caller's tenant transaction."""
    numbers = candidates(message.from_number)
    if not numbers:
        return "invalid"
    keyword, action = classify(message.text)
    when = events._plausible(message.received_at)
    with session.connection().cursor() as cursor:
        # the message they are answering: the last text sent to that number (it also tells us who they are)
        cursor.execute("""SELECT id, party_id, phone_number, campaign_id, campaign_run_id, status, created_at FROM sms_execution
                           WHERE tenant_id = %s AND phone_number = ANY(%s) AND status <> 'QUEUED' ORDER BY created_at DESC LIMIT 1""", [str(tenant_id), numbers])
        last = cursor.fetchone()
        number = last[2] if last else numbers[-1]
        party_id = last[1] if last else None
        if party_id is None:
            cursor.execute("""SELECT party_id FROM customer_master cm WHERE cm.tenant_id = %s
                                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(cm.phones) e WHERE e ->> 'number' = ANY(%s)) ORDER BY party_id LIMIT 1""",
                           [str(tenant_id), numbers])
            row = cursor.fetchone()
            party_id = row[0] if row else None

        cursor.execute("""INSERT INTO sms_inbound_message (tenant_id, provider, from_number, to_number, body, keyword, action, party_id, sms_execution_id, campaign_id,
                                                           provider_message_id, raw_payload, received_at)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                          ON CONFLICT (tenant_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING RETURNING id""",
                       [str(tenant_id), provider_type, number, message.to_number or None, (message.text or "")[:2000], keyword, action, party_id, last[0] if last else None,
                        str(last[3]) if last else None, message.provider_message_id or None, json.dumps(message.raw, default=str), when])
        if cursor.fetchone() is None:
            return "duplicate"                              # the aggregator delivered the same reply twice

        if last and last[5] not in ("OPTED_OUT", "FAILED"):
            cursor.execute("UPDATE sms_execution SET status = %s, responded_at = %s WHERE tenant_id = %s AND id = %s AND created_at = %s",
                           ["OPTED_OUT" if action == "OPT_OUT" else "RESPONDED", when, str(tenant_id), last[0], last[6]])
        if action == "OPT_OUT":
            events.block_number(cursor, tenant_id, number, party_id, reason="MANUAL", source="SMS_STOP", detail=f"Replied {keyword}", when=when)
        elif action == "OPT_IN":
            cursor.execute("""UPDATE contact_point_status SET blocked = FALSE, unblocked_at = %s
                               WHERE tenant_id = %s AND contact_point_type = 'PHONE' AND contact_value = %s AND blocked AND block_source = 'SMS_STOP'""",
                           [timezone.now(), str(tenant_id), number])

    if party_id and action in ("OPT_OUT", "OPT_IN"):
        evidence = {"from": number, "text": (message.text or "")[:200], "provider": provider_type, "provider_message_id": message.provider_message_id}
        for channel in ("SMS", "MMS"):
            if action == "OPT_OUT":
                unsubscribe.opt_out(tenant_id=tenant_id, party_id=party_id, campaign_id=last[3] if last else None, run_id=last[4] if last else None, method="SMS_STOP",
                                    evidence=evidence, execution_id=last[0] if last else None, channel=channel)
            else:
                unsubscribe.opt_in(tenant_id=tenant_id, party_id=party_id, channel=channel, evidence=evidence, execution_id=last[0] if last else None)
    return action
