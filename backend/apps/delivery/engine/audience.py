"""Who receives a run, and why everyone else does not.

Set-based on purpose: one INSERT ... SELECT builds the frozen campaign list from the attached contact lists, another
creates the mailer_execution rows. Rules, in order (first match is the recorded suppression_reason):

    EXCLUDED_LIST      the party is in a list attached to this campaign as an exclusion
    UNKNOWN_PARTY      the list names a party that is not in customer_master
    NO_EMAIL           no valid email address on the customer
    BLOCKED_ADDRESS    contact_point_status.blocked (hard bounce, complaint, manual, registry)
    INVALID_ADDRESS    contact_point_status.is_valid = false
    SUPPRESSED         consent_suppression.suppressed                       (marketing only, as are the next three)
    UNSUBSCRIBED       consent_status = OPTED_OUT
    NO_CONSENT         no OPTED_IN consent for email
    FREQUENCY_CAP      an active governance policy's max_messages within period_days is already reached
    DUPLICATE_ADDRESS  another party in this run has the same address (the first keeps it)

Runs on the caller's connection, inside its transaction, under the tenant's row-level security.
"""
from . import session
from .render import subject_of

PRIMARY_EMAIL = """(SELECT lower(e ->> 'address') FROM jsonb_array_elements(cm.emails) e
                     WHERE COALESCE((e ->> 'is_valid')::boolean, TRUE) AND COALESCE(e ->> 'address', '') <> ''
                     ORDER BY COALESCE((e ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1)"""

BUILD = f"""
WITH picked AS (                                          -- PARTY_ID_LAST_WINS across the attached lists
    SELECT DISTINCT ON (m.party_id) m.party_id, m.contact_list_id, m.custom_attributes
      FROM contact_list_member m
      JOIN contact_list_campaign c ON c.contact_list_id = m.contact_list_id AND c.campaign_id = %(campaign)s AND c.role = 'INCLUDE'
     WHERE m.tenant_id = %(tenant)s
     ORDER BY m.party_id, m.added_at DESC
), excluded AS (                                        -- lists attached to keep their people OUT of this campaign
    SELECT DISTINCT m.party_id FROM contact_list_member m
      JOIN contact_list_campaign c ON c.contact_list_id = m.contact_list_id AND c.campaign_id = %(campaign)s AND c.role = 'EXCLUDE'
     WHERE m.tenant_id = %(tenant)s
), resolved AS (
    SELECT p.*, cm.party_id AS known, {PRIMARY_EMAIL} AS email
      FROM picked p LEFT JOIN customer_master cm ON cm.party_id = p.party_id AND cm.tenant_id = %(tenant)s
), capped AS (                                            -- the strictest applicable policy that this party has already used up
    SELECT r.party_id, (SELECT g.id FROM communication_governance_policy g
                         WHERE g.tenant_id = %(tenant)s AND g.is_active AND %(caps)s
                           AND (g.scope = 'GLOBAL' OR (g.scope = 'CHANNEL' AND COALESCE(g.channel, 'EMAIL') = 'EMAIL'))
                           AND ((SELECT count(*) FROM mailer_execution x
                                  WHERE x.tenant_id = %(tenant)s AND x.party_id = r.party_id AND x.status NOT IN ('QUEUED', 'FAILED')
                                    AND x.created_at >= now() - make_interval(days => g.period_days))
                                + CASE WHEN g.scope = 'GLOBAL' THEN                      -- a GLOBAL policy counts every message, texts included
                                       (SELECT count(*) FROM sms_execution y
                                         WHERE y.tenant_id = %(tenant)s AND y.party_id = r.party_id AND y.status NOT IN ('QUEUED', 'FAILED')
                                           AND y.created_at >= now() - make_interval(days => g.period_days)) ELSE 0 END) >= g.max_messages
                         ORDER BY g.priority LIMIT 1) AS policy_id
      FROM resolved r
), judged AS (
    SELECT r.*, k.policy_id,
           CASE WHEN EXISTS (SELECT 1 FROM excluded e WHERE e.party_id = r.party_id) THEN 'EXCLUDED_LIST'
                WHEN r.known IS NULL THEN 'UNKNOWN_PARTY'
                WHEN r.email IS NULL THEN 'NO_EMAIL'
                WHEN cps.blocked THEN 'BLOCKED_ADDRESS'
                WHEN cps.is_valid = FALSE THEN 'INVALID_ADDRESS'
                WHEN %(marketing)s AND cs.suppressed THEN 'SUPPRESSED'
                WHEN %(marketing)s AND cs.consent_status = 'OPTED_OUT' THEN 'UNSUBSCRIBED'
                WHEN %(marketing)s AND COALESCE(cs.consent_status, 'UNKNOWN') <> 'OPTED_IN' THEN 'NO_CONSENT'
                WHEN k.policy_id IS NOT NULL THEN 'FREQUENCY_CAP'
           END AS reason
      FROM resolved r
      JOIN capped k ON k.party_id = r.party_id
      LEFT JOIN consent_suppression cs ON cs.tenant_id = %(tenant)s AND cs.party_id = r.party_id AND cs.channel = 'EMAIL'
      LEFT JOIN contact_point_status cps ON cps.tenant_id = %(tenant)s AND cps.contact_point_type = 'EMAIL' AND cps.contact_value = r.email
), ranked AS (
    SELECT j.*, CASE WHEN j.reason IS NULL THEN row_number() OVER (PARTITION BY j.email, (j.reason IS NULL) ORDER BY j.party_id) END AS seat
      FROM judged j
)
INSERT INTO campaign_list_member (campaign_list_id, tenant_id, party_id, source_contact_list_id, custom_value_pairs, status, suppression_reason)
SELECT %(list)s, %(tenant)s, party_id, contact_list_id, COALESCE(custom_attributes, '{{}}'::jsonb),
       CASE WHEN reason IS NULL AND seat = 1 THEN 'ELIGIBLE' ELSE 'SUPPRESSED' END,
       CASE WHEN reason IS NOT NULL THEN reason WHEN seat > 1 THEN 'DUPLICATE_ADDRESS' END
  FROM ranked
"""

LOG_SUPPRESSED = """
INSERT INTO governance_evaluation_log (tenant_id, party_id, campaign_id, campaign_run_id, channel, policy_id, decision, reason)
SELECT m.tenant_id, m.party_id, %(campaign)s, %(run)s, 'EMAIL',
       CASE WHEN m.suppression_reason = 'FREQUENCY_CAP' THEN
            (SELECT g.id FROM communication_governance_policy g WHERE g.tenant_id = %(tenant)s AND g.is_active ORDER BY g.priority LIMIT 1) END,
       'SUPPRESS', m.suppression_reason
  FROM campaign_list_member m
 WHERE m.tenant_id = %(tenant)s AND m.campaign_list_id = %(list)s AND m.status = 'SUPPRESSED'
"""

QUEUE = f"""
INSERT INTO mailer_execution (tenant_id, campaign_id, campaign_run_id, campaign_list_member_id, party_id, email_address, template_version_id,
                              subject_line, idempotency_key, status, delivery_provider_id)
SELECT m.tenant_id, %(campaign)s, %(run)s, m.id, m.party_id, {PRIMARY_EMAIL}, %(content)s, %(subject)s,
       %(tenant)s::text || ':' || %(run)s::text || ':' || m.party_id || ':EMAIL:v' || %(version)s::text, 'QUEUED', %(provider)s
  FROM campaign_list_member m JOIN customer_master cm ON cm.party_id = m.party_id AND cm.tenant_id = m.tenant_id
 WHERE m.tenant_id = %(tenant)s AND m.campaign_list_id = %(list)s AND m.status = 'ELIGIBLE'
"""


def build(*, tenant_id, campaign, run, campaign_list, content, provider_id) -> dict:
    """Fills the campaign list and queues one execution per eligible member. Returns the counts."""
    marketing = campaign.solicitation_type == "MARKETING"
    args = {"tenant": str(tenant_id), "campaign": str(campaign.pk), "run": str(run.pk), "list": str(campaign_list.pk), "marketing": marketing,
            "caps": marketing and bool(getattr(campaign, "respect_governance", True)),     # corporate frequency limits: marketing only (BRD 12), unless switched off for this campaign
            "content": str(content.pk), "version": content.version_number, "subject": subject_of(campaign, content)[:300], "provider": str(provider_id)}
    with session.connection().cursor() as cursor:
        cursor.execute(BUILD, args)
        cursor.execute(LOG_SUPPRESSED, args)
        cursor.execute(QUEUE, args)
        queued = cursor.rowcount
        cursor.execute("""SELECT COALESCE(suppression_reason, 'ELIGIBLE'), count(*) FROM campaign_list_member
                           WHERE tenant_id = %(tenant)s AND campaign_list_id = %(list)s GROUP BY 1""", args)
        breakdown = dict(cursor.fetchall())
    return {"queued": queued, "members": sum(breakdown.values()), "eligible": breakdown.pop("ELIGIBLE", 0), "suppressed": breakdown}
