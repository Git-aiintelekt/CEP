"""Who receives a text run (SMS or MMS), and why everyone else does not. The text twin of audience.py.

Rules, in order (first match is the recorded suppression_reason):

    UNKNOWN_PARTY      the list names a party that is not in customer_master
    NO_PHONE           the customer has no phone number
    INVALID_NUMBER     no number in E.164 form (+14045550001) that is not a landline / fax, or the number is marked invalid
    BLOCKED_NUMBER     contact_point_status.blocked: STOP reply, do-not-disturb registry, undeliverable number, manual block
    UNSUBSCRIBED       opted out of texts (SMS or MMS). Applies to EVERY kind of campaign: a STOP is a STOP
    SUPPRESSED         consent_suppression.suppressed                                  (marketing only, as are the next two)
    TOPIC_OPTED_OUT    the person unticked this campaign's topic on the preference page (marketing, preference centre on)
    NO_CONSENT         no OPTED_IN consent for texts: marketing texts need express consent
    FREQUENCY_CAP      an active governance policy's max_messages within period_days is already reached
    DUPLICATE_NUMBER   another party in this run has the same number (the first keeps it)

A GLOBAL policy counts every message the person received (email and text); a CHANNEL policy counts texts only.

A later drip message (`base_list_id`) takes its people from the first message's Campaign List instead of the contact
lists, all of them whatever their outcome there; every rule above then applies again at its own send.
"""
from apps.governance import preferences

from . import session

PRIMARY_PHONE = r"""(SELECT e ->> 'number' FROM jsonb_array_elements(cm.phones) e
                     WHERE (e ->> 'number') ~ '^\+[1-9][0-9]{7,14}$' AND upper(COALESCE(e ->> 'type', 'MOBILE')) NOT IN ('LANDLINE', 'FAX')
                     ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC, (upper(COALESCE(e ->> 'type', '')) = 'MOBILE') DESC LIMIT 1)"""

FROM_LISTS = """
    SELECT DISTINCT ON (m.party_id) m.party_id, m.contact_list_id, m.custom_attributes, l.approval_status    -- PARTY_ID_LAST_WINS across the attached lists
      FROM contact_list_member m
      JOIN contact_list_campaign c ON c.contact_list_id = m.contact_list_id AND c.campaign_id = %(campaign)s AND c.role = 'INCLUDE'
      JOIN contact_list l ON l.id = m.contact_list_id AND l.tenant_id = m.tenant_id
     WHERE m.tenant_id = %(tenant)s
     ORDER BY m.party_id, (l.approval_status IN ('AWAITING', 'REFUSED')), m.added_at DESC"""

# a later drip message: everyone on the first message's Campaign List, whatever happened to them there, and nobody else
FROM_BASE = """
    SELECT DISTINCT ON (b.party_id) b.party_id, b.source_contact_list_id AS contact_list_id, b.custom_value_pairs AS custom_attributes, l.approval_status
      FROM campaign_list_member b
      LEFT JOIN contact_list l ON l.id = b.source_contact_list_id AND l.tenant_id = b.tenant_id
     WHERE b.tenant_id = %(tenant)s AND b.campaign_list_id = %(base)s
     ORDER BY b.party_id"""


def _build_sql(picked: str) -> str:
    return f"""
WITH picked AS ({picked}
), excluded AS (                                        -- lists attached to keep their people OUT of this campaign
    SELECT DISTINCT m.party_id FROM contact_list_member m
      JOIN contact_list_campaign c ON c.contact_list_id = m.contact_list_id AND c.campaign_id = %(campaign)s AND c.role = 'EXCLUDE'
     WHERE m.tenant_id = %(tenant)s
), resolved AS (
    SELECT p.*, cm.party_id AS known, COALESCE(jsonb_array_length(cm.phones), 0) AS numbers, {PRIMARY_PHONE} AS phone
      FROM picked p LEFT JOIN customer_master cm ON cm.party_id = p.party_id AND cm.tenant_id = %(tenant)s
), capped AS (
    SELECT r.party_id, (SELECT g.id FROM communication_governance_policy g
                         WHERE g.tenant_id = %(tenant)s AND g.is_active AND %(caps)s
                           AND (g.scope = 'GLOBAL' OR (g.scope = 'CHANNEL' AND COALESCE(g.channel, %(channel)s) = %(channel)s))
                           AND (CASE WHEN g.scope = 'GLOBAL' THEN
                                     (SELECT count(*) FROM mailer_execution x WHERE x.tenant_id = %(tenant)s AND x.party_id = r.party_id
                                         AND x.status NOT IN ('QUEUED', 'FAILED') AND x.created_at >= now() - make_interval(days => g.period_days)) ELSE 0 END
                                + (SELECT count(*) FROM sms_execution y WHERE y.tenant_id = %(tenant)s AND y.party_id = r.party_id
                                      AND y.status NOT IN ('QUEUED', 'FAILED') AND y.created_at >= now() - make_interval(days => g.period_days))) >= g.max_messages
                         ORDER BY g.priority LIMIT 1) AS policy_id
      FROM resolved r
), judged AS (
    SELECT r.*,
           CASE WHEN EXISTS (SELECT 1 FROM excluded e WHERE e.party_id = r.party_id) THEN 'EXCLUDED_LIST'
                WHEN r.approval_status IN ('AWAITING', 'REFUSED') THEN 'LIST_NOT_APPROVED'
                WHEN r.known IS NULL THEN 'UNKNOWN_PARTY'
                WHEN r.numbers = 0 THEN 'NO_PHONE'
                WHEN r.phone IS NULL THEN 'INVALID_NUMBER'
                WHEN cps.blocked THEN 'BLOCKED_NUMBER'
                WHEN cps.is_valid = FALSE THEN 'INVALID_NUMBER'
                WHEN EXISTS (SELECT 1 FROM consent_suppression o WHERE o.tenant_id = %(tenant)s AND o.party_id = r.party_id AND o.channel IN ('SMS', 'MMS')
                                AND o.consent_status = 'OPTED_OUT') THEN 'UNSUBSCRIBED'
                WHEN %(marketing)s AND cs.suppressed THEN 'SUPPRESSED'
                WHEN %(marketing)s AND COALESCE(cs.consent_status, 'UNKNOWN') <> 'OPTED_IN' THEN 'NO_CONSENT'
                WHEN %(topic)s::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM party_topic_preference tp WHERE tp.tenant_id = %(tenant)s AND tp.party_id = r.party_id
                                                             AND tp.topic_id = %(topic)s::uuid AND tp.opted_out) THEN 'TOPIC_OPTED_OUT'
                WHEN k.policy_id IS NOT NULL THEN 'FREQUENCY_CAP'
           END AS reason
      FROM resolved r
      JOIN capped k ON k.party_id = r.party_id
      LEFT JOIN LATERAL (SELECT x.consent_status, x.suppressed FROM consent_suppression x
                          WHERE x.tenant_id = %(tenant)s AND x.party_id = r.party_id AND x.channel IN (%(channel)s, 'SMS')
                          ORDER BY (x.channel = %(channel)s) DESC LIMIT 1) cs ON TRUE
      LEFT JOIN contact_point_status cps ON cps.tenant_id = %(tenant)s AND cps.contact_point_type = 'PHONE' AND cps.contact_value = r.phone
), ranked AS (
    SELECT j.*, CASE WHEN j.reason IS NULL THEN row_number() OVER (PARTITION BY j.phone, (j.reason IS NULL) ORDER BY j.party_id) END AS seat
      FROM judged j
)
INSERT INTO campaign_list_member (campaign_list_id, tenant_id, party_id, source_contact_list_id, custom_value_pairs, status, suppression_reason)
SELECT %(list)s, %(tenant)s, party_id, contact_list_id, COALESCE(custom_attributes, '{{}}'::jsonb),
       CASE WHEN reason IS NULL AND seat = 1 THEN 'ELIGIBLE' ELSE 'SUPPRESSED' END,
       CASE WHEN reason IS NOT NULL THEN reason WHEN seat > 1 THEN 'DUPLICATE_NUMBER' END
  FROM ranked
"""


BUILD = _build_sql(FROM_LISTS)
BUILD_FROM_BASE = _build_sql(FROM_BASE)

LOG_SUPPRESSED = """
INSERT INTO governance_evaluation_log (tenant_id, party_id, campaign_id, campaign_run_id, channel, policy_id, decision, reason)
SELECT m.tenant_id, m.party_id, %(campaign)s, %(run)s, %(channel)s,
       CASE WHEN m.suppression_reason = 'FREQUENCY_CAP' THEN
            (SELECT g.id FROM communication_governance_policy g WHERE g.tenant_id = %(tenant)s AND g.is_active ORDER BY g.priority LIMIT 1) END,
       'SUPPRESS', m.suppression_reason
  FROM campaign_list_member m
 WHERE m.tenant_id = %(tenant)s AND m.campaign_list_id = %(list)s AND m.status = 'SUPPRESSED'
"""

QUEUE = f"""
INSERT INTO sms_execution (tenant_id, campaign_id, campaign_run_id, campaign_list_member_id, party_id, phone_number, message_type, template_version_id, media_url,
                           from_sender_id, provider_code, internal_batch_id, idempotency_key, status, delivery_provider_id)
SELECT m.tenant_id, %(campaign)s, %(run)s, m.id, m.party_id, {PRIMARY_PHONE}, %(channel)s, %(content)s, %(media)s, %(sender)s, %(provider_code)s, %(run)s::text,
       %(tenant)s::text || ':' || %(run)s::text || ':' || m.party_id || ':' || %(channel)s || ':v' || %(version)s::text, 'QUEUED', %(provider)s
  FROM campaign_list_member m JOIN customer_master cm ON cm.party_id = m.party_id AND cm.tenant_id = m.tenant_id
 WHERE m.tenant_id = %(tenant)s AND m.campaign_list_id = %(list)s AND m.status = 'ELIGIBLE'
"""


def build(*, tenant_id, campaign, run, campaign_list, content, provider, sender, channel: str, media_url: str | None, base_list_id=None) -> dict:
    """Fills the campaign list and queues one sms_execution per eligible member. `channel` is SMS or MMS. `base_list_id`: as in
    audience.build, the people of that Campaign List instead of the contact lists' members."""
    args = {"tenant": str(tenant_id), "campaign": str(campaign.pk), "run": str(run.pk), "list": str(campaign_list.pk), "marketing": campaign.solicitation_type == "MARKETING",
            "caps": campaign.solicitation_type == "MARKETING" and bool(getattr(campaign, "respect_governance", True)),
            "channel": channel, "content": str(content.pk), "version": content.version_number, "media": media_url if channel == "MMS" else None,
            "sender": (sender.sender_id or "")[:30] or None, "provider_code": provider.provider_type, "provider": str(provider.pk),
            "topic": preferences.topic_filter(campaign), "base": str(base_list_id) if base_list_id else None}
    with session.connection().cursor() as cursor:
        cursor.execute(BUILD_FROM_BASE if base_list_id else BUILD, args)
        cursor.execute(LOG_SUPPRESSED, args)
        cursor.execute(QUEUE, args)
        queued = cursor.rowcount
        cursor.execute("""SELECT COALESCE(suppression_reason, 'ELIGIBLE'), count(*) FROM campaign_list_member
                           WHERE tenant_id = %(tenant)s AND campaign_list_id = %(list)s GROUP BY 1""", args)
        breakdown = dict(cursor.fetchall())
    return {"queued": queued, "members": sum(breakdown.values()), "eligible": breakdown.pop("ELIGIBLE", 0), "suppressed": breakdown}
