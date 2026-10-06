"""Save feedback on the server: every API error answers problem+json in CEP's words. Database errors become plain sentences
on the field they concern (never the database's wording), the database not answering is a 503, anything else a 500 with a
reference the back-office Errors page finds. Rolled back."""
import json
import re

import pytest
from django.db import IntegrityError, OperationalError, connection, transaction
from django.test import RequestFactory
from rest_framework.test import APIClient

from api import exceptions
from apps.delivery.engine import session
from apps.identity.models import AppUser

from .test_journey_events import T, make_journey

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def refused(sql, args):
    """The database error the statement raises, from inside a savepoint so the test carries on."""
    try:
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(sql, args)
    except Exception as exc:  # noqa: BLE001
        return exc
    return None


def test_save_feedback(check, admin_email):
    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    with session.tenant_scope(T):
        with session.tx():
            journey = make_journey("feedback", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_FB"}}, status="DRAFT")
            other = make_journey("feedback two", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_FB"}}, status="DRAFT")

            duplicate = refused("UPDATE journey SET code = %s WHERE id = %s", [journey.code, str(other.pk)])
            status, body = exceptions.database_problem(duplicate)
            check("a duplicate is a 400 on its field, in CEP's words", isinstance(duplicate, IntegrityError) and status == 400
                  and body["errors"] == {"code": ["Another record already uses this code."]} and body["title"] == "Check the highlighted fields", json.dumps(body))

            rule = refused("UPDATE journey SET reentry_policy = 'AFTER_X_DAYS', reentry_after_days = 0 WHERE id = %s", [str(journey.pk)])
            status, body = exceptions.database_problem(rule)
            check("a broken database rule with its own sentence lands on its field", status == 400
                  and body["errors"] == {"reentry_after_days": ["Days before re-entry must be more than 0."]}, json.dumps(body))

            choice = refused("UPDATE journey SET status = 'NOPE' WHERE id = %s", [str(journey.pk)])
            status, body = exceptions.database_problem(choice)
            check("any other rule names its column from the rule's name", status == 400 and body["errors"] == {"status": ["This value is not one CEP allows here."]},
                  json.dumps(body))

            missing = refused("UPDATE journey SET name = NULL WHERE id = %s", [str(journey.pk)])
            status, body = exceptions.database_problem(missing)
            check("a missing required value names its field", status == 400 and body["errors"] == {"name": ["This field is required."]}, json.dumps(body))

            too_long = refused("UPDATE journey SET code = %s WHERE id = %s", ["X" * 41, str(journey.pk)])
            status, body = exceptions.database_problem(too_long)
            check("a value too long is said plainly", status == 400 and body["errors"] == {"non_field_errors": ["A value is longer than CEP allows."]}, json.dumps(body))

            texts = json.dumps([exceptions.database_problem(e)[1] for e in (duplicate, rule, choice, missing, too_long)])
            check("no database wording ever goes out", not re.search(r"duplicate key|violates|constraint|null value|character varying|ux_|ck_", texts), texts[:300])

    down = exceptions.database_problem(OperationalError("could not connect to server"))
    check("the database not answering is a 503 with CEP's sentence", down[0] == 503 and down[1]["detail"] == "CEP's database is not answering. Try again in a minute."
          and "connect" not in json.dumps(down[1]))

    request = RequestFactory().post("/api/v1/journeys/")
    response = exceptions.problem_json_exception_handler(RuntimeError("secret internals: password=hunter2"), {"request": request})
    body = response.data
    check("anything else is a 500 with a reference and a time, and none of the exception's own words",
          response.status_code == 500 and re.fullmatch(r"ER-\d+", body.get("reference", "")) and body["title"] == "CEP had a problem"
          and "hunter2" not in json.dumps(body) and body["reference"] in body["detail"] and body.get("at"), json.dumps(body))

    try:
        raise OperationalError("server closed the connection unexpectedly")
    except OperationalError:
        outside = exceptions.server_error(RequestFactory().get("/api/v1/me/"))
    check("an error outside a view on an API path is problem+json too (here the database down: 503)",
          outside.status_code == 503 and outside["Content-Type"] == "application/problem+json" and b"closed the connection" not in outside.content, outside.content[:200])

    api = APIClient()
    api.force_authenticate(user)
    with session.tenant_scope(T):
        with session.tx():
            journey = make_journey("feedback api", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_FB"}}, status="DRAFT")
        answer = api.patch(f"/api/v1/journeys/{journey.pk}/", {"name": "N" * 201}, format="json", HTTP_X_TENANT="NWA")
    check("a refused form says what to do in its title, not 'Invalid input'", answer.status_code == 400 and answer.json()["title"] == "Check the highlighted fields"
          and "name" in answer.json()["errors"], answer.content[:200])
    check.done()
