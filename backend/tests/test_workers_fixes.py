"""Found in the .51 rehearsal of separate workers (docs/WORKERS_DEPLOYMENT_PLAN.md): a worker knows every CEP task; a run whose
worker died mid-batch stays open until the sweep has marked the messages it had claimed, so they read as interrupted (and can
be resent), never as sent. Rolled back."""
from unittest import mock

import pytest

from apps.delivery.engine import runs, session

pytestmark = [pytest.mark.django_db(databases=["default", "platform"])]


def test_a_worker_knows_every_task():
    from config.celery import app
    app.loader.import_default_modules()
    names = set(app.tasks)
    wanted = {"workers.campaign.dispatch_due_runs", "workers.campaign.start_run", "workers.campaign.finalize_run", "workers.sms.send_batch",
              "workers.email.send_batch", "workers.lists.process_imports", "workers.journey.enroll_customers", "workers.platform.evaluate_alerts",
              "workers.maintenance.ensure_monthly_partitions"}
    assert wanted <= names, sorted(wanted - names)


@pytest.mark.slow
def test_a_run_stays_open_until_unconfirmed_messages_are_swept(world, check):
    body = world.template("ZF unconfirmed text", "SMS", body="Hi {{first_name}}, new arrivals are in. Reply STOP to opt out")
    cid = world.drip("ZF unconfirmed", "SMS", [(0, body, {})], lists=[world.three])
    world.publish(cid)
    run = str(world.run_of(cid, 0).pk)
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [run])
    with mock.patch("apps.governance.windows.hold_until", return_value=(None, "")), mock.patch.object(runs, "quiet_until", return_value=None), \
            session.tenant_scope(world.tenant):
        runs.start(world.tenant, run)
    # a worker claimed the three and died before the engine answered
    world.sql("UPDATE sms_execution SET status = 'SUBMITTED', submitted_at = now() - interval '1 minute', attempts = 1, provider_acked_at = NULL WHERE campaign_run_id = %s", [run])
    with session.tenant_scope(world.tenant):
        early = runs.finalize(world.tenant, run)
    (status,) = world.sql("SELECT status FROM campaign_run WHERE id = %s", [run], True)[0]
    check("with claimed messages the engine never answered, the run stays open", early is None and status == "SENDING", f"{early} {status}")

    world.sql("UPDATE sms_execution SET submitted_at = now() - interval '20 minutes' WHERE campaign_run_id = %s", [run])
    with session.tenant_scope(world.tenant):
        swept = runs.sweep(world.tenant, run)
        closed = runs.finalize(world.tenant, run)
    reasons = {row[0] for row in world.sql("SELECT status_reason FROM sms_execution WHERE campaign_run_id = %s", [run], True)}
    check("after the sweep they read as interrupted, and the run closes", swept == 3 and reasons == {runs.INTERRUPTED} and closed == "FAILED", f"{swept} {reasons} {closed}")
    check.done()
