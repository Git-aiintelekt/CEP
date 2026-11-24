"""Error details (docs/mockups/error-details.html, A then C) and the alert for errors people met: an error someone met (an ER-… answer, a
screen that failed in their browser) opens one alert for the platform administrators, a job's error does not; the back-office's Note for
Users reaches the 500 answer, Resolve clears it, and saving the internal note no longer erases it. observe writes on its own autocommit
connection, so every error row this test makes is deleted at the end."""
import uuid

import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.db import connections
from django.test import Client, RequestFactory

from api.exceptions import unexpected_problem
from apps.identity.models import AppUser
from apps.platform_ops import alerts, mail, observe, params

pytestmark = [pytest.mark.django_db(databases=["default", "platform"])]
P = settings.PLATFORM_ALIAS


def _one(sql, args=()):
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchone()


@pytest.fixture
def errors():
    """the error groups made by the test, removed afterwards (observe commits them on its own connection)"""
    top = _one("SELECT coalesce(max(id), 0) FROM error_group")[0]
    yield f"probe-{uuid.uuid4().hex[:8]}"
    with observe._cursor() as cursor:
        cursor.execute("DELETE FROM error_group WHERE id > %s", [top])


def _met(marker, n=1, **extra):
    """an error answered to someone with a reference: a request's error has its path"""
    gid = None
    for _ in range(n):
        gid = observe.record_error(source="BACKEND", kind="django.db.utils.ProgrammingError", message=f"{marker} upload refused", place="apps.contacts.imports",
                                   tenant_code="CITYST", method="POST", path="/api/v1/contact-lists/x/imports/",
                                   context={"page": "/lists/new"}, **extra)
    return gid


def test_an_error_someone_met_opens_one_alert_and_a_job_error_does_not(errors, monkeypatch):
    met = _met(errors)
    browser = observe.record_error(source="BROWSER", kind="TypeError", message=f"{errors} cannot read x", place="Page /campaigns/:id")
    job = observe.record_error(source="JOB", kind="RuntimeError", message=f"{errors} job broke", place="Job prune")

    found = alerts.people_errors()
    mine = {name: value for name, value in found.items() if errors in value[1]}
    assert set(mine) == {f"Error ER-{met} · ProgrammingError", f"Error ER-{browser} · TypeError"}
    severity, summary, detail = mine[f"Error ER-{met} · ProgrammingError"]
    assert severity == "WARN"
    assert summary == f"{errors} upload refused · 1 time in 24 hours · new today"
    assert f"ER-{met} (django.db.utils.ProgrammingError). Last " in detail
    assert " in CITYST, /lists/new. " in detail and f"Back-office → Errors → ER-{met}" in detail
    assert not any(f"ER-{job} " in name for name in found)

    _met(errors, 10)
    assert alerts.people_errors()[f"Error ER-{met} · ProgrammingError"][0] == "FAIL"   # ten in an hour: failing

    sent = []
    monkeypatch.setattr(alerts, "_problems", lambda: {k: v for k, v in alerts.people_errors().items() if errors in v[1]})
    monkeypatch.setattr(params, "get", lambda key, default=None: ["ops@example.test"] if key == "alerts.recipients" else default)
    monkeypatch.setattr(mail, "send", lambda template, to, context, subject="": sent.append((template, to, subject, context)) or True)
    result = alerts.evaluate()
    assert f"Error ER-{met} · ProgrammingError" in result["opened"] and result["sent"]["email"]
    template, to, subject, context = sent[0]
    assert template == "platform_alert" and to == ["ops@example.test"] and subject.startswith("[C360] 1 failing: Error ER-")
    assert alerts.evaluate()["opened"] == []                                                    # still open: no second email at once

    with observe._cursor() as cursor:
        cursor.execute("UPDATE error_group SET status = 'RESOLVED', resolved_at = now() WHERE id = ANY(%s)", [[met, browser]])
    assert set(alerts.evaluate()["resolved"]) == {f"Error ER-{met} · ProgrammingError", f"Error ER-{browser} · TypeError"}


def test_the_note_for_users_reaches_the_500_answer_until_the_error_is_resolved(errors):
    staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    admin = Client()
    admin.force_login(staff)
    request = RequestFactory().post("/api/v1/contact-lists/x/imports/")

    def crash():
        raise RuntimeError(f"{errors} boom")

    def answer():
        try:
            crash()
        except RuntimeError as exc:
            return unexpected_problem(exc, request)

    first = answer()
    gid = int(first["reference"].removeprefix("ER-"))
    assert "note" not in first
    page = f"/admin/platform_ops/errorgroup/{gid}/change/"

    body = admin.get(page).content.decode()
    assert "Note for Users" in body and 'name="user_note"' in body

    admin.post(page, {"note": "internal: RLS on app_user", "user_note": "  Uploads from Switch\nWorkspace fail.   Fixed tonight. " + "x" * 400})
    note, internal = _one("SELECT user_note, note FROM error_group WHERE id = %s", [gid])
    assert note.startswith("Uploads from Switch Workspace fail. Fixed tonight. x") and len(note) == 300
    assert internal == "internal: RLS on app_user"

    again = answer()                                       # the same error met again: its answer carries the note
    assert again["reference"] == f"ER-{gid}" and again["note"] == note

    admin.post(page, {"do": "ignore"})                     # a status button without the note fields keeps both notes
    assert _one("SELECT user_note, note FROM error_group WHERE id = %s", [gid]) == (note, internal)

    admin.post(page, {"do": "resolve", "note": internal, "user_note": note})
    assert _one("SELECT status, user_note FROM error_group WHERE id = %s", [gid]) == ("RESOLVED", None)
    assert "note" not in answer()
