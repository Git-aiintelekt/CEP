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
