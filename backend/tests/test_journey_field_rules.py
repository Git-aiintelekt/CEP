"""Journeys' field limits: the journey's own fields and the canvas's step settings are published in GET /field-rules/
(journey, journey_step) and the server refuses what breaks them, naming the field. Rolled back."""
import pytest
from rest_framework.test import APIClient

from api.v1 import field_rules
from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.journeys import graph
from apps.journeys.models import JourneyVersion

from .test_journey_events import T, make_journey

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_journey_field_rules(check, admin_email):
    journey_rules = field_rules.rules_for(field_rules.RESOURCES["journey"])
    step_rules = field_rules.rules_for(field_rules.RESOURCES["journey_step"])
    check("journey: name 200 from its column; description 2,000, goal and exit criteria 500; re-entry days 1 to 3,650",
          journey_rules["name"]["max"] == 200 and journey_rules["description"]["max"] == 2000 and journey_rules["goal_description"]["max"] == 500
          and journey_rules["exit_criteria_description"]["max"] == 500
          and journey_rules["reentry_after_days"]["min_value"] == 1 and journey_rules["reentry_after_days"]["max_value"] == 3650,
          str({k: journey_rules[k] for k in ("description", "goal_description", "reentry_after_days")})[:300])
    check("journey_step: step name 120, duration 0 to 999, days 0 to 365, event type 60 with its pattern, message step 100",
          step_rules["label"]["max"] == 120 and step_rules["duration"]["max_value"] == 999 and step_rules["days"]["max_value"] == 365
          and step_rules["event_type"]["max"] == 60 and step_rules["event_type"].get("pattern") and step_rules["message_step"]["max"] == 100, str(step_rules)[:300])

    user = AppUser.objects.using("platform").select_related("tenant").get(email=admin_email)
    api = APIClient()
    api.force_authenticate(user)
    with session.tenant_scope(T):
        with session.tx():                                 # the tenant setting row-level security reads is set per transaction
            journey = make_journey("limits", entry={"entry_type": "EVENT", "rule_definition": {"event_type": "ZJ_LIMITS"}}, status="DRAFT")
        url = f"/api/v1/journeys/{journey.pk}/"

        def patch(body):
            return api.patch(url, body, format="json", HTTP_X_TENANT="NWA")

        too_long = {"name": "N" * 201, "description": "D" * 2001, "goal_description": "G" * 501, "exit_criteria_description": "E" * 501}
        refused = {field: patch({field: value}) for field, value in too_long.items()}
        check("one character over the limit is refused on its own field", all(r.status_code == 400 and field in (r.json().get("errors") or {}) for field, r in refused.items()),
              str({field: (r.status_code, list((r.json().get("errors") or {}).keys())) for field, r in refused.items()}))
        at_limit = patch({"name": "N" * 200, "description": "D" * 2000, "goal_description": "G" * 500, "exit_criteria_description": "E" * 500})
        check("exactly at the limit is saved", at_limit.status_code == 200, at_limit.content[:200])
        days = [patch({"reentry_policy": "AFTER_X_DAYS", "reentry_after_days": value}).status_code for value in (0, 3651, 90)]
        check("re-entry days outside 1 to 3,650 are refused, 90 is saved", days == [400, 400, 200], str(days))

        version = JourneyVersion.objects.get(journey=journey)
        base = graph.read(version)

        def save_with(config):
            current = JourneyVersion.objects.get(pk=version.pk)
            nodes = [dict(node, config=config) if node["type"] == "EXIT" else node for node in base["nodes"]]
            body = {"row_version": current.row_version, "graph": {"entry_rules": base["entry_rules"], "nodes": nodes, "connections": base["connections"]}}
            return api.put(f"/api/v1/journeys/{journey.pk}/versions/1/graph/", body, format="json", HTTP_X_TENANT="NWA")

        broken = {"duration": {"duration": 1000}, "days": {"days": 366}, "event_type": {"event_type": "cart abandon"}, "label": {"label": "L" * 121},
                  "message_step": {"message_step": "m" * 101}, "duration as text": {"duration": "3"}}
        answers = {name: save_with(config) for name, config in broken.items()}
        check("a step setting over its limit is refused with the setting named",
              all(r.status_code == 400 and name.split()[0] in str(r.json().get("errors")) for name, r in answers.items()),
              str({name: (r.status_code, str(r.json().get("errors"))[:80]) for name, r in answers.items()}))
        fine = save_with({"label": "L" * 120, "duration": 999, "days": 365, "event_type": "CATEGORY_PURCHASE", "message_step": "", "unit": "DAYS"})
        check("settings at their limits are saved; a blank one is left to readiness", fine.status_code == 200, fine.content[:200])
    check.done()
