"""Shared set-up for the backend tests (`python -m pytest` in backend/).

The database
    No database is created. The tests use the one in the repository's .env (DATABASE_URL, PLATFORM_DATABASE_URL), which must
    be on this machine: a run that finds any other host stops before the first test. Every test runs inside a transaction on
    both connections (default and platform) that is rolled back at the end, so nothing a test writes is kept. The scenarios
    expect the sample workspace NWA (CEP_Seed_Data.sql) to be there.

Nothing leaves the machine
    Any network connection to another host fails with "blocked in tests": no email, no Postal, Digivize or Mailgun call, no
    webhook. A test that needs an answer from outside mocks it (requests.Session.post, a provider adapter).

Code that writes on a connection of its own
    The error recorder (apps.platform_ops.observe) writes through the test's platform connection here, so its rows are rolled
    back with everything else, and the request-figures thread is not started.

check
    check(label, ok, extra="") records one labelled expectation and returns ok; check.done() at the end of a test fails it
    with every expectation that did not hold. A scenario keeps going after a failed check, so one run shows all of them.
"""
import ipaddress
import socket

import pytest

LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}


# ---------------------------------------------------------------------------------------------------- the database
def pytest_sessionstart(session):
    from django.conf import settings
    far = sorted(alias for alias, db in settings.DATABASES.items() if str(db.get("HOST") or "").lower() not in LOCAL_HOSTS)
    if far:
        pytest.exit(f"The backend tests run only against a database on this machine; the {', '.join(far)} connection points elsewhere. "
                    "Point backend/.env at the local copy and run again.", returncode=2)


@pytest.fixture(scope="session")
def django_db_setup():
    """The configured database as it is: nothing created, nothing migrated (the SQL layers are the schema)."""


# ---------------------------------------------------------------------------------------------------- the network
def _local(address) -> bool:
    host = address[0] if isinstance(address, tuple) else address
    if isinstance(host, bytes):
        host = host.decode()
    if not isinstance(host, str):
        return True                                       # a Unix socket path or the like
    if host.lower() in LOCAL_HOSTS or host.lower() == "testserver":
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    real_connect, real_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def connect(self, address):
        if not _local(address):
            raise OSError(f"Network connection to {address!r} blocked in tests: mock the call.")
        return real_connect(self, address)

    def connect_ex(self, address):
        if not _local(address):
            raise OSError(f"Network connection to {address!r} blocked in tests: mock the call.")
        return real_connect_ex(self, address)

    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)


# ---------------------------------------------------------------------------------------------------- side connections
@pytest.fixture(autouse=True)
def observe_in_transaction(monkeypatch):
    from django.conf import settings
    from django.db import connections

    from apps.platform_ops import observe
    monkeypatch.setattr(observe, "_cursor", lambda: connections[settings.PLATFORM_ALIAS].cursor())
    monkeypatch.setattr(observe, "_forget", lambda: None)
    monkeypatch.setattr(observe, "_start_flusher", lambda: None)
    with observe._lock:
        observe._buckets.clear()
    yield
    with observe._lock:
        observe._buckets.clear()


@pytest.fixture(autouse=True)
def fresh_context():
    """Every test starts with no workspace and outside platform mode, whatever the one before it set."""
    from apps.tenants import context
    tenant_token, platform_token = context._current.set(None), context._platform.set(False)
    yield
    context._current.reset(tenant_token)
    context._platform.reset(platform_token)


@pytest.fixture(autouse=True)
def fresh_cache():
    """The local cache holds tenant routing, parameters and throttle counts: clear it so tests cannot see each other's."""
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def staff_sessions_on_platform(monkeypatch):
    """The back-office reads its session on the platform connection, which cannot see the default connection's uncommitted
    rows: Client.force_login(staff) saves the session there, as signing in to /admin/ does."""
    from django.test import Client

    from apps.tenants import context
    real = Client.force_login

    def force_login(self, user, backend=None):
        if not getattr(user, "is_staff", False):
            return real(self, user, backend)
        token = context.set_platform(True)
        try:
            return real(self, user, backend)
        finally:
            context.reset_platform(token)

    monkeypatch.setattr(Client, "force_login", force_login)


# ---------------------------------------------------------------------------------------------------- people
NWA = "a0000000-0000-4000-8000-000000000001"


@pytest.fixture
def admin_email():
    """The address of the person the scenarios act as: the first active back-office user who administers NWA. On a local
    copy that is the platform operator's own account; a database built for tests gets one from tests/ci_fixtures.sql."""
    from django.conf import settings
    from django.db import connections
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute("""SELECT u.email FROM app_user u
                           WHERE u.tenant_id = %s AND u.is_active AND u.is_staff AND u.deleted_at IS NULL
                             AND EXISTS (SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_id = ur.role_id JOIN permission p ON p.id = rp.permission_id
                                          WHERE ur.user_id = u.id AND p.code = 'user.admin')
                           ORDER BY u.created_at LIMIT 1""", [NWA])
        row = cursor.fetchone()
    if row is None:
        pytest.fail("No back-office user administers NWA: load tests/ci_fixtures.sql into a database built for tests.", pytrace=False)
    return row[0]


# ---------------------------------------------------------------------------------------------------- check
class Checks:
    def __init__(self):
        self.results: list[tuple[str, bool, str]] = []

    def __call__(self, label: str, ok, extra="") -> bool:
        self.results.append((label, bool(ok), str(extra)))
        return bool(ok)

    @property
    def failed(self):
        return [(label, extra) for label, ok, extra in self.results if not ok]

    def done(self):
        if not self.results:
            pytest.fail("No check ran.", pytrace=False)
        if self.failed:
            lines = [f"{len(self.failed)} of {len(self.results)} checks failed:"] + [f"  - {label}" + (f"  [{extra[:300]}]" if extra else "") for label, extra in self.failed]
            pytest.fail("\n".join(lines), pytrace=False)


@pytest.fixture
def check():
    return Checks()


# ---------------------------------------------------------------------------------------------------- drip scenarios
@pytest.fixture
def world(admin_email):
    """People P01-P22 (email and phone, opted in to both), a list of the first three and one of all 22, Postal (mocked) and the
    sandbox for texts, and helpers to make templates and drips, publish them and send a message's run."""
    import json
    from datetime import datetime, time, timedelta
    from types import SimpleNamespace
    from unittest import mock
    from zoneinfo import ZoneInfo

    import requests
    from django.db import connection
    from django.test import Client
    from django.utils import timezone
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.campaigns.models import CampaignActivityLog, CampaignRun
    from apps.delivery import engine
    from apps.delivery.engine import runs
    from apps.identity.models import AppUser
    from apps.integrations.bridge import logbook
    from apps.platform_ops import notifications
    from apps.tenants import context

    NY = ZoneInfo("America/New_York")
    UNSUBSCRIBE = '<a href="{{unsubscribe_url}}">Unsubscribe</a>'

    def start(days=3, hour=14, minute=30):
        """A start date `days` ahead at hour:minute, New York time (the drips' send_timezone)."""
        return datetime.combine(timezone.now().astimezone(NY).date() + timedelta(days=days), time(hour, minute), tzinfo=NY)

    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    tenant, code = str(admin.tenant_id), admin.tenant.code
    client = Client()
    headers = {"HTTP_X_TENANT": code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}
    posted, refuse = [], []                                 # refuse: Postal refuses a message whose subject contains one of these

    def api(method, path, body=None):
        if method in ("get", "delete"):
            return getattr(client, method)(path, **headers)
        return getattr(client, method)(path, json.dumps(body or {}), content_type="application/json", **headers)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [tenant])
            cursor.execute(statement, args or [])
            return cursor.fetchall() if fetch else None

    def postal_post(self, url, **kwargs):
        body = kwargs.get("json") or {}
        posted.append({"to": (body.get("to") or [""])[0], "subject": body.get("subject"), "html": body.get("html_body") or "", "text": body.get("plain_body") or ""})
        response = requests.Response()
        if any(words in (body.get("subject") or "") for words in refuse):
            response.status_code, response._content = 200, json.dumps({"status": "parameter-error", "data": {"code": "InvalidRecipient", "message": "The address is not valid"}}).encode()
            return response
        response.status_code, response._content = 200, json.dumps({"status": "success", "time": 0.01, "flags": {}, "data": {
            "message_id": f"m{len(posted)}@postal.example", "messages": {(body.get("to") or ["x"])[0]: {"id": len(posted), "token": "t"}}}}).encode()
        return response

    def person(party, number):
        sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb, %s::jsonb)",
            [party, tenant, party, json.dumps([{"address": f"{party.lower()}@zs.example", "is_primary": True}]),
             json.dumps([{"number": f"+1470555{3000 + number}", "type": "MOBILE", "is_primary": True}])])
        for channel in ("EMAIL", "SMS"):
            sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, %s, 'OPTED_IN', TRUE, now())", [tenant, party, channel])

    def make_list(name, parties):
        list_id = str(sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, %s, 'UPLOAD', 'PRODUCTION', %s, %s) RETURNING id",
                          [tenant, name, len(parties), str(admin.pk)], True)[0][0])
        for party in parties:
            add_member(list_id, party)
        return list_id

    def add_member(list_id, party):
        sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, tenant, party])

    def template(name, channel, *, subject=None, preheader=None, html=None, body=None, media=None):
        made = api("post", "/api/v1/templates/", {"name": name, "channel": channel}).json()
        if channel == "EMAIL" and html is not None:
            sql("INSERT INTO rendered_template_content (template_id, version_number, subject_line, preheader, html_content, text_content) VALUES (%s, 1, %s, %s, %s, %s)",
                [made["id"], subject, preheader, html + UNSUBSCRIBE, html])
            sql("INSERT INTO template_design_state (template_id, version_number, editor_state) VALUES (%s, 1, '{}'::jsonb)", [made["id"]])    # as the editor saves it
        elif body is not None:
            sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body, text_content) VALUES (%s, 1, %s, %s)", [made["id"], body, body])
        if media:
            asset = str(sql("""INSERT INTO media_asset (tenant_id, file_name, mime_type, byte_size, storage_key, checksum_sha256, public_url, scan_status)
                               VALUES (%s, %s, 'image/png', 1000, %s, md5(%s), %s, 'SKIPPED') RETURNING id""", [tenant, media, media, media, f"https://cdn.zs.example/{media}"], True)[0][0])
            sql("INSERT INTO template_design_state (template_id, version_number, editor_state) VALUES (%s, 1, %s::jsonb)",
                [made["id"], json.dumps({"kind": "message", "channel": "MMS", "media_asset_id": asset})])
        if html is not None or body is not None:
            sql("UPDATE template_master SET status = 'ACTIVE' WHERE id = %s", [made["id"]])
        return made["id"]

    def drip(name, channel, messages, *, lists, start=None, series_time=None, **extra):
        """messages: [(day, template_id, {step fields})]; the first is Day 0. Every copy is made ACTIVE so the drip can be published."""
        sender = email_sender if channel == "EMAIL" else text_sender
        made = api("post", "/api/v1/campaigns/", {"name": name, "campaign_type": "DRIP", "channel": channel, "sender_profile": sender, "contact_lists": lists,
                                                  "scheduled_at": start.isoformat() if start else None, "send_timezone": "America/New_York",
                                                  "drip_config": {"steps": [{"day": 0}], **({"time": series_time} if series_time else {})}, **extra})
        assert made.status_code == 201, made.content
        cid = made.json()["id"]
        first = api("get", f"/api/v1/campaigns/{cid}/steps/").json()[0]
        for index, (day, template_id, fields) in enumerate(messages):
            if index == 0:
                answer = api("patch", f"/api/v1/campaigns/{cid}/steps/{first['id']}/", {"template": template_id, **fields})
            else:
                answer = api("post", f"/api/v1/campaigns/{cid}/steps/", {"start_from": "template", "template": template_id, "day": day})
                if fields and answer.status_code == 201:
                    answer = api("patch", f"/api/v1/campaigns/{cid}/steps/{answer.json()['id']}/", fields)
            assert answer.status_code in (200, 201), answer.content
        sql("UPDATE template_master SET status = 'ACTIVE' WHERE id IN (SELECT template_id FROM campaign_drip_step WHERE campaign_id = %s)", [cid])
        return cid

    def publish(cid):
        """Publishes as B3 allows it: every message counted as tested, and a start date ahead when the drip has none."""
        sql("UPDATE campaign_drip_step SET content_changed_at = now() - interval '1 minute', tested_at = now() WHERE campaign_id = %s", [cid])
        sql("UPDATE campaign SET scheduled_at = now() + interval '1 day' WHERE id = %s AND scheduled_at IS NULL", [cid])
        with mock.patch("api.v1.views._enqueue_run"):
            answer = api("post", f"/api/v1/campaigns/{cid}/publish/")
        assert answer.status_code == 201, answer.content
        return answer

    def run_of(cid, day):
        return CampaignRun.objects.get(campaign_id=cid, test_mode=False, sequence_label=f"Day {day}")

    def send(cid, day):
        run = run_of(cid, day)
        sql("UPDATE campaign_run SET scheduled_at = now() - interval '1 minute' WHERE id = %s", [str(run.pk)])
        with mock.patch.object(runs, "quiet_until", return_value=None):
            engine.process_run(tenant, str(run.pk))
        return CampaignRun.objects.get(pk=run.pk)

    def members(run):
        return dict(sql("""SELECT m.party_id, COALESCE(m.suppression_reason, 'ELIGIBLE') FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id
                            WHERE m.tenant_id = %s AND l.campaign_run_id = %s""", [tenant, str(run.pk)], True))

    def activity(run, event="SEND_STARTED"):
        return [entry.message for entry in CampaignActivityLog.objects.filter(campaign_run_id=run.pk, event_type=event)]

    with mock.patch.object(logbook, "P", "default"), mock.patch.object(requests.Session, "post", postal_post), \
            mock.patch.object(notifications.mail, "send", return_value=True):
        sql("UPDATE communication_governance_policy SET is_active = FALSE WHERE tenant_id = %s", [tenant])     # the workspace's own caps would blur the scenarios
        people = [f"ZS-P{n:02d}" for n in range(1, 23)]
        for number, party in enumerate(people, start=1):
            person(party, number)
        three, everyone = make_list("ZS three", people[:3]), make_list("ZS everyone", people)
        postal = api("post", "/api/v1/delivery-providers/", {"provider_type": "POSTAL", "name": "ZS Postal", "secret": "postal-key", "config": {"endpoint": "https://postal.zs.example"}}).json()
        email_sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": postal["id"], "display_name": "ZS Shop", "from_address": "news@zs.example"}).json()["id"]
        api("post", f"/api/v1/delivery-senders/{email_sender}/verify/", {"to": "me@zs.example"})
        sandbox = api("post", "/api/v1/delivery-providers/", {"provider_type": "SANDBOX_SMS", "name": "ZS sandbox texts", "config": {}}).json()
        text_sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": sandbox["id"], "display_name": "ZS Shop", "sender_id": "55180"}).json()["id"]
        api("post", f"/api/v1/delivery-senders/{text_sender}/verify/", {"to": "+14705550100"})
        posted.clear()
        yield SimpleNamespace(tenant=tenant, api=api, sql=sql, posted=posted, refuse=refuse, text_sender=text_sender, people=people, three=three, everyone=everyone, add_member=add_member, make_list=make_list,
                              template=template, drip=drip, email_sender=email_sender, publish=publish, run_of=run_of, send=send, members=members, activity=activity, start=start, ny=NY, unsubscribe=UNSUBSCRIBE)

