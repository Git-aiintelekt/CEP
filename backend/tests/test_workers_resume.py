"""Separate workers carry on where they stopped (docs/WORKERS_DEPLOYMENT_PLAN.md, patch 0095): the send window gives out a few
batches at a time and each finished batch the next; a batch whose worker died is given out again, and the claim keeps every
message to one send; a paused run gets its batch back; a retry stays with its worker; a run left PREPARING starts again; an
upload carries on from its last finished chunk; a stall raises an alert. Texts go through the sandbox engine. Rolled back."""
from types import SimpleNamespace
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections, transaction

from apps.contact_lists import imports, jobs
from apps.contact_lists.models import ContactList, ContactListImport
from apps.delivery import stalls
from apps.delivery.engine import dispatch_sms, runs, session
from apps.delivery.engine.dispatch import RetryBatch
from apps.delivery.providers.sandbox_sms import SandboxSmsProvider
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"])]


@pytest.fixture
def window(world, monkeypatch):
    """A published text to the 22 people of `world`, due now; a window of 2 batches of 5; batches given to workers are collected
    in `given` instead of being queued, and a worker's "next batch, please" runs at once."""
    from workers import campaign
    body = world.template("ZW window text", "SMS", body="Hi {{first_name}}, new arrivals are in. Reply STOP to opt out")
    cid = world.drip("ZW window", "SMS", [(0, body, {})], lists=[world.everyone])
    world.publish(cid)
    run = str(world.run_of(cid, 0).pk)
    world.sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [run])
    given = []
    monkeypatch.setattr(runs, "WINDOW", 2)
    monkeypatch.setattr(SandboxSmsProvider, "max_batch", 5)
    monkeypatch.setattr(runs, "quiet_until", lambda *a, **k: None)
    monkeypatch.setattr(campaign, "_send", lambda kind, tenant, run_id, batches: given.extend(batches))
    monkeypatch.setattr(campaign.finalize_run, "delay", lambda tenant, run_id, refill=1: campaign.finalize_run(tenant, run_id, refill))
    with mock.patch("apps.governance.windows.hold_until", return_value=(None, "")):
        yield SimpleNamespace(run=run, given=given, campaign=campaign)


def _state(world, run):
    (row,) = world.sql("""SELECT count(*) FILTER (WHERE status = 'QUEUED'),
                                 count(*) FILTER (WHERE status = 'QUEUED' AND enqueued_at >= now() - interval '1 hour'),
                                 count(*) FILTER (WHERE status NOT IN ('QUEUED', 'FAILED')), COALESCE(max(attempts), 0)
                            FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s""", [world.tenant, run], True)
    return {"queued": row[0], "with_workers": row[1], "sent": row[2], "most_attempts": row[3]}


@pytest.mark.slow
def test_the_send_window_feeds_workers_and_survives_a_dead_one(world, window, check):
    from workers import sms
    started = window.campaign.start_run(world.tenant, window.run)
    state = _state(world, window.run)
    check("the start gives out the window only: 2 batches of 5 of the 22 messages", started["batches"] == 2 and [len(b) for b in window.given] == [5, 5]
          and state["queued"] == 22 and state["with_workers"] == 10, f"{started} {state}")

    first, second = window.given.pop(0), window.given[0]
    sms.send_batch(world.tenant, window.run, first)
    state = _state(world, window.run)
    check("a finished batch gives out exactly one more", len(window.given) == 2 and state["sent"] == 5 and state["with_workers"] == 10, f"{len(window.given)} {state}")

    window.campaign.finalize_run(world.tenant, window.run, 0)
    check("the dispatcher's minute adds nothing while batches are with workers", len(window.given) == 2, str(len(window.given)))

    # every worker died: the messages they held are still waiting, given out over an hour ago
    world.sql("UPDATE sms_execution SET enqueued_at = now() - interval '2 hours' WHERE tenant_id = %s AND campaign_run_id = %s AND status = 'QUEUED'", [world.tenant, window.run])
    lost = list(window.given)
    window.given.clear()
    window.campaign.finalize_run(world.tenant, window.run, 0)
    check("the dispatcher gives the lost messages out again, first in line", len(window.given) == 2 and window.given[0] == second, f"{window.given} vs {second}")

    sms.send_batch(world.tenant, window.run, window.given.pop(0))
    late = sms.send_batch(world.tenant, window.run, lost[0])               # the dead worker's task, handed out again by the queue
    check("the dead worker's copy of a batch sends nothing: the claim kept each message to one send", late.get("submitted") == 0 and late.get("skipped") == 5, str(late))

    for _ in range(20):
        if not window.given:
            break
        sms.send_batch(world.tenant, window.run, window.given.pop(0))
    state = _state(world, window.run)
    (status,) = world.sql("SELECT status FROM campaign_run WHERE id = %s", [window.run], True)[0]
    check("every message went out once and the run completed", state == {"queued": 0, "with_workers": 0, "sent": 22, "most_attempts": 1} and status == "COMPLETED",
          f"{state} {status}")
    check.done()


@pytest.mark.slow
def test_a_paused_run_gets_its_batch_back_and_a_retry_stays_with_its_worker(world, window, check):
    from workers import sms
    window.campaign.start_run(world.tenant, window.run)
    world.sql("UPDATE campaign_run SET status = 'PAUSED' WHERE id = %s", [window.run])
    skipped = sms.send_batch(world.tenant, window.run, window.given[0])
    (given_back,) = world.sql("SELECT count(*) FROM sms_execution WHERE tenant_id = %s AND id = ANY(%s) AND enqueued_at IS NULL", [world.tenant, window.given[0]], True)[0]
    check("a paused run's batch is not sent and its messages are free to be given out on resume", skipped.get("skipped") == 5 and given_back == 5, f"{skipped} {given_back}")

    world.sql("UPDATE campaign_run SET status = 'SENDING' WHERE id = %s", [window.run])
    batch = window.given[1]
    with mock.patch.object(dispatch_sms, "send_batch", side_effect=RetryBatch(batch, "Waiting for the engine's limit", retry_after=600)), \
            mock.patch.object(sms.send_batch, "apply_async"):
        sms.send_batch(world.tenant, window.run, batch)
    (later,) = world.sql("SELECT count(*) FROM sms_execution WHERE tenant_id = %s AND id = ANY(%s) AND enqueued_at > now() + interval '5 minutes'", [world.tenant, batch], True)[0]
    with session.tenant_scope(world.tenant), session.tx():
        busy = runs.in_flight(world.tenant, window.run)
        again = runs.hand_out(world.tenant, window.run, 10)
    check("a batch waiting for a retry stays with its worker: not given out twice", later == 5 and busy and not set(batch) & {i for b in again for i in b},
          f"{later} {busy} {again}")
    check.done()


@pytest.mark.slow
def test_a_run_left_preparing_starts_again(world, window, check):
    run = window.run
    world.sql("UPDATE campaign_run SET status = 'PREPARING', started_at = now() - interval '10 minutes' WHERE id = %s", [run])
    key = f"cep.campaign_run.prepare:{run}"
    other = connections["platform"]                                        # another connection: the worker still preparing it
    with other.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_lock(hashtextextended(%s, 0))", [key])
    try:
        with session.tenant_scope(world.tenant):
            alive = runs.recover_preparing(world.tenant, run)
            with pytest.raises(runs.RunNotStarted):
                runs.start(world.tenant, run)
    finally:
        with other.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", [key])
    (status,) = world.sql("SELECT status FROM campaign_run WHERE id = %s", [run], True)[0]
    check("while its worker is alive, the run is left alone and nobody else starts it", alive is False and status == "PREPARING", f"{alive} {status}")

    with session.tenant_scope(world.tenant):
        gone = runs.recover_preparing(world.tenant, run)
    (status,) = world.sql("SELECT status FROM campaign_run WHERE id = %s", [run], True)[0]
    check("once its worker is gone, the run goes back to SCHEDULED, with a note in its log", gone and status == "SCHEDULED"
          and any("prepared again" in m for m in world.activity(SimpleNamespace(pk=run), "WARNING")), f"{gone} {status}")

    world.sql("UPDATE campaign_run SET status = 'PREPARING', started_at = now() - interval '1 minute' WHERE id = %s", [run])
    with session.tenant_scope(world.tenant):
        fresh = runs.recover_preparing(world.tenant, run)
    check("a run that only just started preparing is left alone", fresh is False)
    check.done()


@pytest.mark.slow
def test_a_stalled_send_raises_an_alert(world, window, check):
    window.campaign.start_run(world.tenant, window.run)
    world.sql("UPDATE campaign_run SET started_at = now() - interval '30 minutes' WHERE id = %s", [window.run])
    world.sql("UPDATE sms_execution SET enqueued_at = NULL WHERE tenant_id = %s AND campaign_run_id = %s", [world.tenant, window.run])
    with mock.patch.object(stalls, "settings", SimpleNamespace(PLATFORM_ALIAS="default")):
        found = stalls.problems()
    name = next((n for n in found if n.startswith("Stalled send") and n.endswith("ZW window")), None)
    check("messages waiting with no worker and nothing sent for 15 minutes: one alert for the campaign", name is not None and found[name][0] == "FAIL", str(list(found)))

    world.sql("UPDATE sms_execution SET submitted_at = now() WHERE id = (SELECT min(id) FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s)", [world.tenant, window.run])
    with mock.patch.object(stalls, "settings", SimpleNamespace(PLATFORM_ALIAS="default")):
        moving = stalls.problems()
    check("a send that is moving raises none", not any(n.endswith("ZW window") for n in moving), str(list(moving)))
    check.done()


@pytest.mark.slow
def test_resend_interrupted(world, window, check):
    """A finished run with three interrupted texts: one reported delivered since, one person who replied STOP since; the
    dialog's numbers, the resend of the one left, the run reopened and closed again, and never a second offer."""
    from workers import sms
    window.campaign.start_run(world.tenant, window.run)
    for _ in range(10):
        if not window.given:
            break
        sms.send_batch(world.tenant, window.run, window.given.pop(0))
    ids = [row[0] for row in world.sql("SELECT id FROM sms_execution WHERE tenant_id = %s AND campaign_run_id = %s ORDER BY id LIMIT 3", [world.tenant, window.run], True)]
    world.sql("UPDATE sms_execution SET status = 'FAILED', status_reason = %s, provider_acked_at = NULL WHERE id = ANY(%s)", [runs.INTERRUPTED, ids])
    world.sql("UPDATE sms_execution SET delivered_at = now() WHERE id = %s", [ids[0]])
    (stop_party,) = world.sql("SELECT party_id FROM sms_execution WHERE id = %s", [ids[1]], True)[0]
    world.sql("UPDATE consent_suppression SET consent_status = 'OPTED_OUT', marketable = FALSE WHERE tenant_id = %s AND party_id = %s AND channel = 'SMS'", [world.tenant, stop_party])

    listing = world.api("get", f"/api/v1/campaign-runs/{window.run}/recipients/?status=INTERRUPTED").json()
    check("the list shows them as Interrupted, counted apart from other failures", listing["count"] == 3 and {r["status"] for r in listing["results"]} == {"INTERRUPTED"}
          and listing["by_status"].get("INTERRUPTED") == 3, str({k: listing.get(k) for k in ("count", "by_status")}))
    offer = world.api("get", f"/api/v1/campaign-runs/{window.run}/interrupted/").json()
    check("the dialog's numbers: 3 interrupted, 1 delivered since, 1 opted out since, 1 to send", offer["interrupted"] == 3 and offer["delivered_since"] == 1
          and offer["held_back"] == 1 and offer["to_send"] == 1 and offer["can_resend"] and offer["engine"] == "ZS sandbox texts", str(offer))

    done = world.api("post", f"/api/v1/campaign-runs/{window.run}/interrupted/", {"at_window": False})
    body = done.json()
    rows = dict(world.sql("SELECT id, status FROM sms_execution WHERE id = ANY(%s)", [ids], True))
    (status,) = world.sql("SELECT status FROM campaign_run WHERE id = %s", [window.run], True)[0]
    check("the one left goes back to the queue; the other two stay failed with the reason; the run reopens", done.status_code == 200 and body["resent"] == 1
          and body["left_out"] == 2 and rows[ids[2]] == "QUEUED" and rows[ids[0]] == "FAILED" and rows[ids[1]] == "FAILED" and status == "SENDING", f"{done.status_code} {body} {rows} {status}")
    check("nothing is offered again, and the notice says it was done", body["interrupted"] == 0 and body["last_resend"] and body["last_resend"]["count"] == 1, str(body))

    window.campaign.finalize_run(world.tenant, window.run, 0)
    for _ in range(5):
        if not window.given:
            break
        sms.send_batch(world.tenant, window.run, window.given.pop(0))
    (status,) = world.sql("SELECT status FROM campaign_run WHERE id = %s", [window.run], True)[0]
    (sent,) = world.sql("SELECT status FROM sms_execution WHERE id = %s", [ids[2]], True)[0]
    check("it is sent with the next batch and the run closes again", sent not in ("QUEUED", "FAILED") and status == "COMPLETED", f"{sent} {status}")

    again = world.api("post", f"/api/v1/campaign-runs/{window.run}/interrupted/", {})
    check("a second resend finds nothing", again.status_code == 200 and again.json()["resent"] == 0, again.content[:200])
    check.done()


CSV = ("Email,First name,Mobile number,Email consent date\r\n"
       + "".join(f"resume{n}@resume.test,Resume{n},+1404555{1100 + n},2026-01-1{n}\r\n" for n in range(1, 6))).encode("utf-8")


def test_an_upload_carries_on_where_it_stopped(check, admin_email):
    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    T = str(tenant.id)

    def stops_after(chunks):
        seen = []

        def beat(done, total):
            seen.append(done)
            if len(seen) == chunks:
                raise RuntimeError("the worker stopped")
        return beat

    def fresh():
        return ContactListImport.objects.select_related("contact_list", "tenant").get(pk=record.pk)

    def staged():
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT row_number, raw ->> 'Email' FROM contact_list_import_row WHERE tenant_id = %s AND import_id = %s ORDER BY row_number", [T, str(record.pk)])
            return cursor.fetchall()

    with transaction.atomic(using="default"), transaction.atomic(using="platform"), mock.patch.object(jobs, "kick", lambda: None):
        token = context.set_current(T, "default", str(user.pk))
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
        contact_list = ContactList.objects.create(tenant_id=T, name=f"Resume upload {T[:4]}", created_by_id=user.pk, source_type="UPLOAD",
                                                  list_environment="PRODUCTION", status="ACTIVE", channel="EMAIL")
        record = imports.accept(contact_list, SimpleUploadedFile("resume.csv", CSV, content_type="text/csv"), user_id=user.pk)

        with pytest.raises(RuntimeError):
            imports.stage(fresh(), 2, stops_after(1))
        before = staged()
        imports.stage(fresh(), 2, lambda done, total: None)
        after = staged()
        check("reading the file carries on after the last stored chunk: every line once, in order",
              [n for n, _ in before] == [2, 3] and after == [(n, f"resume{n - 1}@resume.test") for n in range(2, 7)] and fresh().row_count == 5, f"{before} {after}")

        imports.review(fresh(), 2, lambda done, total: None)
        with pytest.raises(RuntimeError):
            imports.apply(fresh(), 2, stops_after(1))
        halfway = fresh()
        check("importing records how far it got, with the counts of that part", halfway.summary.get("applied_through") == 3
              and halfway.new_customer_count == 2 and halfway.consent_count == 2, f"{halfway.summary.get('applied_through')} {halfway.new_customer_count} {halfway.consent_count}")

        imports.apply(fresh(), 2, lambda done, total: None)
        done = fresh()
        members = ContactList.objects.get(pk=contact_list.pk).member_count
        check("the import carries on from there: five new people, five consents, five members, nothing counted twice",
              done.new_customer_count == 5 and done.consent_count == 5 and done.applied_count == 5 and members == 5,
              f"new={done.new_customer_count} consents={done.consent_count} applied={done.applied_count} members={members}")
        context.reset(token)
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using="platform")
    check.done()
