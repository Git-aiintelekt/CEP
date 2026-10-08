"""The nightly journey rollup: what the Performance tab reads.

    journey_master_analytical             one row per journey: who is inside, who finished, who left (rewritten whole)
    journey_execution_master_analytical   one row per step a customer finished, flattened with its campaign and channel

The fact table is rebuilt from yesterday's start (or from the last day it holds, if the job has missed nights), so a
re-run never counts a step twice and a missed night is caught up.
"""
import logging

from apps.delivery.engine import session

from . import tenants

log = logging.getLogger("cep.journeys")

MASTER = ["""
DELETE FROM journey_master_analytical a WHERE a.tenant_id = %(tenant)s
   AND NOT EXISTS (SELECT 1 FROM journey j WHERE j.id = a.journey_id AND j.deleted_at IS NULL)""", """
INSERT INTO journey_master_analytical (journey_id, tenant_id, journey_name, population_mode, status, business_objective,
                                       active_enrollment_count, completed_count, exited_count, converted_count, attributed_revenue, created_at, last_refreshed_at)
SELECT j.id, j.tenant_id, j.name, j.population_mode, j.status, j.description,
       count(e.id) FILTER (WHERE e.status = 'ACTIVE'), count(e.id) FILTER (WHERE e.status = 'COMPLETED'),
       count(e.id) FILTER (WHERE e.status = 'EXITED'), count(e.id) FILTER (WHERE e.converted_at IS NOT NULL), COALESCE(sum(e.attributed_revenue), 0),
       j.created_at, now()
  FROM journey j LEFT JOIN journey_enrollment e ON e.journey_id = j.id AND e.tenant_id = j.tenant_id
 WHERE j.tenant_id = %(tenant)s AND j.deleted_at IS NULL
 GROUP BY j.id
ON CONFLICT (journey_id) DO UPDATE SET journey_name = EXCLUDED.journey_name, population_mode = EXCLUDED.population_mode, status = EXCLUDED.status,
       business_objective = EXCLUDED.business_objective, active_enrollment_count = EXCLUDED.active_enrollment_count,
       completed_count = EXCLUDED.completed_count, exited_count = EXCLUDED.exited_count, converted_count = EXCLUDED.converted_count,
       attributed_revenue = EXCLUDED.attributed_revenue, last_refreshed_at = now()""", """
UPDATE journey_master_analytical a SET
       sent_count = m.sent, delivered_count = m.delivered, open_count = m.opened, click_count = m.clicked, bounce_count = m.bounced, complaint_count = m.complained
  FROM (SELECT g.journey_id,
               count(*) FILTER (WHERE x.sent) AS sent, count(*) FILTER (WHERE x.delivered) AS delivered, count(*) FILTER (WHERE x.opened) AS opened,
               count(*) FILTER (WHERE x.clicked) AS clicked, count(*) FILTER (WHERE x.bounced) AS bounced, count(*) FILTER (WHERE x.complained) AS complained
          FROM journey_generated_campaign g
          JOIN (SELECT tenant_id, campaign_id,
                       (submitted_at IS NOT NULL OR status IN ('SUBMITTED', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED')) AS sent,
                       (delivered_at IS NOT NULL OR status IN ('DELIVERED', 'OPENED', 'CLICKED')) AS delivered,
                       (opened_at IS NOT NULL OR status IN ('OPENED', 'CLICKED')) AS opened, (clicked_at IS NOT NULL OR status = 'CLICKED') AS clicked,
                       (bounced_at IS NOT NULL OR status = 'BOUNCED') AS bounced, (complained_at IS NOT NULL OR status = 'COMPLAINED') AS complained
                  FROM mailer_execution WHERE tenant_id = %(tenant)s
                UNION ALL
                SELECT tenant_id, campaign_id, (submitted_at IS NOT NULL OR status IN ('SUBMITTED', 'DELIVERED', 'RESPONDED')),
                       (delivered_at IS NOT NULL OR status IN ('DELIVERED', 'RESPONDED')), FALSE, FALSE, status = 'FAILED', FALSE
                  FROM sms_execution WHERE tenant_id = %(tenant)s) x ON x.tenant_id = g.tenant_id AND x.campaign_id = g.campaign_id
         WHERE g.tenant_id = %(tenant)s GROUP BY g.journey_id) m
 WHERE a.tenant_id = %(tenant)s AND a.journey_id = m.journey_id""", """
UPDATE journey_master_analytical a SET held_back_count = h.held, failed_count = h.failed
  FROM (SELECT e.journey_id, count(*) FILTER (WHERE x.execution_status = 'SKIPPED') AS held, count(*) FILTER (WHERE x.execution_status = 'FAILED') AS failed
          FROM journey_node_execution x JOIN journey_node n ON n.id = x.journey_node_id
          JOIN journey_enrollment e ON e.id = x.journey_enrollment_id AND e.tenant_id = x.tenant_id
         WHERE x.tenant_id = %(tenant)s AND n.node_family = 'COMMUNICATION' GROUP BY e.journey_id) h
 WHERE a.tenant_id = %(tenant)s AND a.journey_id = h.journey_id"""]

SINCE = """SELECT LEAST(date_trunc('day', now()) - interval '1 day',
                        COALESCE(date_trunc('day', (SELECT max(executed_at) FROM journey_execution_master_analytical WHERE tenant_id = %(tenant)s)),
                                 '-infinity'::timestamptz))"""

FACTS = ["DELETE FROM journey_execution_master_analytical WHERE tenant_id = %(tenant)s AND executed_at >= %(since)s", """
INSERT INTO journey_execution_master_analytical (tenant_id, party_id, journey_id, node_id, event_type, campaign_id, campaign_run_id, channel, outcome, executed_at)
SELECT x.tenant_id, x.party_id, e.journey_id, x.journey_node_id, n.node_type, r.campaign_id, x.generated_campaign_run_id,
       CASE WHEN n.node_family = 'COMMUNICATION' THEN n.node_type END, x.execution_status, x.executed_at
  FROM journey_node_execution x
  JOIN journey_enrollment e ON e.id = x.journey_enrollment_id AND e.tenant_id = x.tenant_id
  JOIN journey_node n ON n.id = x.journey_node_id
  LEFT JOIN campaign_run r ON r.id = x.generated_campaign_run_id AND r.tenant_id = x.tenant_id
 WHERE x.tenant_id = %(tenant)s AND x.executed_at >= %(since)s"""]


def rollup_tenant(tenant_id: str) -> dict:
    """Must run inside session.tenant_scope(tenant_id). One transaction: the Performance tab never sees half a rollup."""
    args = {"tenant": str(tenant_id)}
    with session.tx(), session.connection().cursor() as cursor:
        for sql in MASTER:
            cursor.execute(sql, args)
        cursor.execute("SELECT count(*) FROM journey_master_analytical WHERE tenant_id = %(tenant)s", args)
        journeys = cursor.fetchone()[0]
        cursor.execute(SINCE, args)
        args["since"] = cursor.fetchone()[0]
        for sql in FACTS:
            cursor.execute(sql, args)
        facts = cursor.rowcount
    return {"journeys": journeys, "facts": facts}


def run() -> dict:
    totals = {"tenants": 0, "journeys": 0, "facts": 0, "failed": 0}
    for tenant_id in tenants("""SELECT DISTINCT j.tenant_id FROM journey j JOIN tenant t ON t.id = j.tenant_id
                                 WHERE t.status = 'ACTIVE' AND j.deleted_at IS NULL"""):
        try:
            with session.tenant_scope(tenant_id):
                result = rollup_tenant(tenant_id)
        except Exception:                                  # noqa: BLE001  one workspace's trouble must not stop the others
            log.exception("journey rollup failed for tenant %s", tenant_id)
            totals["failed"] += 1
            continue
        totals["tenants"] += 1
        totals["journeys"] += result["journeys"]
        totals["facts"] += result["facts"]
    return totals
