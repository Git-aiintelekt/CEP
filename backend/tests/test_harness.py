"""The test harness itself: nothing a test writes survives it, nothing leaves the machine, and each test starts clean."""
import socket

import pytest
import requests
from django.db import connections

from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
MARK = "zz-harness-probe"


def _probe_count() -> int:
    with connections["platform"].cursor() as cursor:
        cursor.execute("SELECT count(*) FROM job_run WHERE job_name = %s", [MARK])
        return cursor.fetchone()[0]


def test_writes_are_visible_inside_the_test():
    with connections["platform"].cursor() as cursor:
        cursor.execute("INSERT INTO job_run (job_name, worker) VALUES (%s, 'harness')", [MARK])
    assert _probe_count() == 1
    context.set_current("a0000000-0000-4000-8000-000000000001", "default")   # left set on purpose: the next test must not see it


def test_the_previous_test_left_nothing_behind():
    assert _probe_count() == 0
    assert context.current() is None and context.is_platform() is False


def test_no_network():
    with pytest.raises(Exception, match="blocked in tests"):
        requests.get("https://example.com/", timeout=5)
    with pytest.raises(OSError, match="blocked in tests"):
        socket.create_connection(("93.184.215.14", 443), timeout=5)


def test_check_reports_every_failed_expectation(check):
    from tests.conftest import Checks
    inner = Checks()
    inner("one", True)
    inner("two", False, "why")
    inner("three", False)
    with pytest.raises(pytest.fail.Exception, match=r"2 of 3 checks failed:\n  - two  \[why\]\n  - three"):
        inner.done()
    check("a check fixture exists for every test", callable(check))
    check.done()
