"""Stalls, for the alert evaluator (apps/platform_ops/alerts.py, every 5 minutes): work that should be moving and is not.

    a send     SENDING for over 15 minutes, with messages due and not with a worker, and nothing claimed in 15 minutes
    a run      PREPARING for over 30 minutes (a very large audience takes a while; a worker that died is handled by
               runs.recover_preparing, so a run still here is being built slowly or its worker hangs)
    an upload  claimed, but no heartbeat for 10 minutes; or waiting for 10 minutes while no upload worker is at work at all

Read on the platform connection, across workspaces. Each stall is one alert, resolved when it moves again.
"""
from django.conf import settings
from django.db import connections

STALLED_SEND = """
    SELECT t.code, c.name, r.id::text, '{table}' FROM campaign_run r JOIN tenant t ON t.id = r.tenant_id
      JOIN campaign c ON c.id = r.campaign_id AND c.tenant_id = r.tenant_id
     WHERE t.status = 'ACTIVE' AND r.status = 'SENDING' AND r.run_type <> 'ERECEIPT_INSTANCE' AND c.status NOT IN ('PAUSED', 'ARCHIVED')
       AND r.started_at < now() - interval '15 minutes'
       AND EXISTS (SELECT 1 FROM {table} e WHERE e.tenant_id = r.tenant_id AND e.campaign_run_id = r.id AND e.status = 'QUEUED'
                      AND (e.send_after IS NULL OR e.send_after <= now()) AND (e.enqueued_at IS NULL OR e.enqueued_at <= now()))
       AND NOT EXISTS (SELECT 1 FROM {table} e WHERE e.tenant_id = r.tenant_id AND e.campaign_run_id = r.id AND e.submitted_at > now() - interval '15 minutes')
     LIMIT 20"""


def problems() -> dict:
    """name -> (severity, summary, detail)"""
    found = {}
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        for table in ("sms_execution", "mailer_execution"):
            cursor.execute(STALLED_SEND.format(table=table))
            for code, campaign, run_id, _ in cursor.fetchall():
                found[f"Stalled send · {code} · {campaign}"[:100]] = (
                    "FAIL", "Messages are waiting and none has gone out for 15 minutes.",
                    f"Run {run_id}. Check that the send workers are running (celery -A config inspect ping; systemctl status cep-worker-out), "
                    "then the engine on Engine Health. Waiting messages go out again by themselves once a worker is back.")
        cursor.execute("""SELECT t.code, c.name, r.id::text FROM campaign_run r JOIN tenant t ON t.id = r.tenant_id
                            JOIN campaign c ON c.id = r.campaign_id AND c.tenant_id = r.tenant_id
                           WHERE t.status = 'ACTIVE' AND r.status = 'PREPARING' AND r.started_at < now() - interval '30 minutes' LIMIT 20""")
        for code, campaign, run_id in cursor.fetchall():
            found[f"Slow to prepare · {code} · {campaign}"[:100]] = (
                "WARN", "The send has been preparing its audience for over 30 minutes.",
                f"Run {run_id}. A very large audience takes a while; if the worker preparing it hangs, it is replaced at its time limit and the run starts again.")
        cursor.execute("""SELECT t.code, i.file_name, i.status, i.worker IS NOT NULL FROM contact_list_import i JOIN tenant t ON t.id = i.tenant_id
                           WHERE t.status = 'ACTIVE' AND i.next_action IS NOT NULL
                             AND ((i.worker IS NOT NULL AND i.heartbeat_at < now() - interval '10 minutes')
                                  OR (i.worker IS NULL AND i.queued_at < now() - interval '10 minutes'
                                      AND NOT EXISTS (SELECT 1 FROM contact_list_import o WHERE o.worker IS NOT NULL AND o.heartbeat_at >= now() - interval '5 minutes')))
                           LIMIT 20""")
        for code, file_name, status, claimed in cursor.fetchall():
            found[f"Stalled upload · {code} · {file_name}"[:100]] = (
                "WARN", "An upload has not moved for 10 minutes." if claimed else "An upload has waited 10 minutes and no upload worker is at work.",
                f"Status {status}. Check that the upload worker is running (systemctl status cep-worker-in). The upload carries on from its last finished chunk.")
    return found
