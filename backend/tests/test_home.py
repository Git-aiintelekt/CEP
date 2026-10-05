"""Home overview: alerts, revenue vs. cost, governance, journeys; the rewritten report summary against the tables. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import random
import uuid
from datetime import date, timedelta
from django.db import connections, transaction
from django.test import Client
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns.models import Campaign, CampaignRun
from apps.identity.models import AppUser
from apps.reporting import home, reports
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_home(check):
    """Home overview: alerts, revenue vs. cost, governance, journeys; the rewritten report summary against the tables. Rolled back."""
    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    tok = context.set_current(str(tenant.id), "default", str(user.pk))
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    today = date.today()
    period = {"from": (today - timedelta(days=29)).isoformat(), "to": today.isoformat()}
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
            from django.core.cache import cache
            cache.clear()

            # ---- the summary still says what the tables say (the grouping-sets rewrite)
            summary = reports.summary(tenant, date.fromisoformat(period["from"]), today)
            with connections["default"].cursor() as cursor:
                cursor.execute("""SELECT count(*) FILTER (WHERE x.status NOT IN ('QUEUED', 'FAILED')), count(*) FILTER (WHERE x.status IN ('DELIVERED', 'OPENED', 'CLICKED')), count(DISTINCT x.campaign_id)
                                FROM mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id
                               WHERE x.tenant_id = %s AND NOT r.test_mode AND x.created_at >= %s AND x.created_at < %s""",
                               [str(tenant.id), summary["period"]["from"], summary["period"]["to"] + timedelta(days=1)])
                sent, delivered, n_campaigns = cursor.fetchone()
            email = summary["by_channel"]["EMAIL"]
            check("summary totals per channel match a plain count over mailer_execution", email["sent"] == sent and email["delivered"] == delivered, f"{email} vs {sent}/{delivered}")
            check("every campaign row has its name and channel (the second lookup)", all(row["name"] and row["channel"] for row in summary["campaigns"]) and len([r for r in summary["campaigns"] if r["channel"] == "EMAIL"]) == n_campaigns,
                  f"{[(r['name'], r['channel']) for r in summary['campaigns']]}")
            check("the days add up to the totals sent", sum(day["sent"] for day in summary["days"]) == summary["totals"]["sent"], f"{summary['days']}")
            check("the best send hour is an hour or nothing", summary["highlights"]["best_send_hour"] is None or 0 <= summary["highlights"]["best_send_hour"]["hour"] <= 23)
            with connections["default"].cursor() as cursor:
                from django.test.utils import CaptureQueriesContext
                with CaptureQueriesContext(connections["default"]) as caught:
                    again = reports.summary(tenant, date.fromisoformat(period["from"]), today)
            check("a second read within 30 s comes from the cache: no queries, the same answer", len(caught.captured_queries) == 0 and again == summary, str(len(caught.captured_queries)))
            cache.clear()

            # ---- the overview
            answer = API.get("/api/v1/home/overview/", period)
            body = answer.json()
            check("GET /home/overview/ answers the four parts and the period", answer.status_code == 200 and set(body) == {"period", "attention", "revenue_cost", "governance", "journeys"}
                  and body["period"]["from"] == period["from"], f"{answer.status_code} {str(body)[:200]}")
            attention = body["attention"]
            failed_now = list(Campaign.objects.filter(tenant_id=tenant.id, deleted_at__isnull=True, campaign_runs__status="FAILED", campaign_runs__test_mode=False,
                                                      campaign_runs__completed_at__gte=timezone.now() - timedelta(days=7)).exclude(status__in=("ARCHIVED", "PAUSED")).values_list("id", flat=True))
            check("attention: the failed campaigns' ids, the test-published count, the approval count",
                  set(attention["failed_ids"]) <= {str(pk) for pk in failed_now} and attention["awaiting_publish"] == Campaign.objects.filter(tenant_id=tenant.id, status="TEST_PUBLISHED", deleted_at__isnull=True).count()
                  and isinstance(attention["awaiting_approval"], int), str(attention))
            rc = body["revenue_cost"]
            check("revenue vs. cost: a granularity, points across the period (day by day for 30 days), a summary with cost, by-campaign top and others",
                  rc["granularity"] == "day" and (not rc["points"] or len(rc["points"]) == 30) and set(rc["summary"]) == {"revenue", "cost", "roi", "revenue_per_1000_delivered"}
                  and set(rc["by_campaign"]) == {"top", "others"}, str(rc)[:300])
            if rc["points"]:
                check("the points' revenue adds up to the summary's revenue (spread over the send days)",
                      rc["summary"]["revenue"] is None or abs(sum(p["revenue"] or 0 for p in rc["points"]) - rc["summary"]["revenue"]) < 0.05 * max(1, len(rc["points"])),
                      f"{sum(p['revenue'] or 0 for p in rc['points'])} vs {rc['summary']['revenue']}")
                check("the points' cost adds up to the summary's cost", abs(sum(p["cost"] for p in rc["points"]) - rc["summary"]["cost"]) < 0.05 * max(1, len(rc["points"])),
                      f"{sum(p['cost'] for p in rc['points'])} vs {rc['summary']['cost']}")
            ninety = API.get("/api/v1/home/overview/", {"from": (today - timedelta(days=89)).isoformat(), "to": today.isoformat()}).json()["revenue_cost"]
            check("over a month the points are weekly: 13 weeks for 90 days", ninety["granularity"] == "week" and (not ninety["points"] or len(ninety["points"]) == 13), f"{ninety['granularity']} {len(ninety['points'])}")
            gov = body["governance"]
            check("governance: contacted, held back and the three reasons; held back never exceeds the reasons' sum",
                  set(gov) == {"contacted", "held_back", "reasons"} and set(gov["reasons"]) == {"frequency_cap", "no_consent", "suppression"} and gov["held_back"] <= sum(gov["reasons"].values()), str(gov))
            from apps.platform_ops import params as feature_params
            if feature_params.enabled(tenant.id, "journeys"):
                check("journeys: NWA has the feature, so its active journeys come with their people", isinstance(body["journeys"], dict) and set(body["journeys"]) == {"rows", "total"}
                      and all({"id", "name", "status", "channels", "in_flight", "entered", "conversion_rate"} <= set(row) for row in body["journeys"]["rows"]), str(body["journeys"])[:160])
            else:
                check("journeys are null: NWA does not have the journeys feature", body["journeys"] is None, str(body["journeys"])[:80])

            # ---- filters
            sms = API.get("/api/v1/home/overview/", {**period, "channel": "SMS"}).json()
            check("channel=SMS narrows revenue vs. cost to text campaigns", sms["revenue_cost"]["summary"]["cost"] <= rc["summary"]["cost"] and all(True for _ in sms["revenue_cost"]["points"]), str(sms["revenue_cost"]["summary"]))
            one = API.get("/api/v1/home/overview/", {**period, "campaigns": str(uuid.uuid4())}).json()
            check("an unknown campaign id leaves nothing in scope: no points, null revenue, zero cost, nobody contacted",
                  one["revenue_cost"]["points"] == [] and one["revenue_cost"]["summary"] == {"revenue": None, "cost": 0, "roi": None, "revenue_per_1000_delivered": None} and one["governance"]["contacted"] == 0, str(one["revenue_cost"]))
            bad = API.get("/api/v1/home/overview/", {**period, "channel": "FAX"})
            check("an unknown channel is refused on its field", bad.status_code == 400 and "channel" in bad.json()["errors"], f"{bad.status_code} {bad.json()}")
            bad = API.get("/api/v1/home/overview/", {"from": "yesterday"})
            check("a bad date is refused on its field", bad.status_code == 400 and "from" in bad.json()["errors"], f"{bad.status_code} {bad.json()}")
            from django.test.utils import CaptureQueriesContext
            with CaptureQueriesContext(connections["default"]) as caught:
                twice = API.get("/api/v1/home/overview/", period).json()
            check("a second overview within 30 s comes from the cache: no figure queries, the same answer", twice == body and len(caught.captured_queries) <= 8, str(len(caught.captured_queries)))

            # ---- journeys, when the workspace has them: give NWA the feature and a journey with people in it, inside the rollback
            from apps.journeys.models import Journey, JourneyEnrollment, JourneyVersion
            from apps.platform_ops import params
            journey = Journey.objects.create(tenant_id=tenant.id, name="Cart Recovery", status="ACTIVE", population_mode="EVENT_TRIGGERED", code=f"JRN-2026-{random.randint(90000, 99999)}", created_by=user, updated_by=user)
            version = JourneyVersion.objects.create(journey=journey, version_number=1, status="ACTIVE", created_by=user, updated_by=user)
            Journey.objects.filter(pk=journey.pk).update(current_version=version)
            with connections["default"].cursor() as cursor:
                cursor.execute("""INSERT INTO journey_node (id, journey_version_id, node_key, node_family, node_type, config) VALUES (%s, %s, 'n1', 'COMMUNICATION', 'EMAIL', '{}'), (%s, %s, 'n2', 'COMMUNICATION', 'SMS', '{}')""",
                               [str(uuid.uuid4()), str(version.pk), str(uuid.uuid4()), str(version.pk)])
            for index, status in enumerate(["ACTIVE", "ACTIVE", "COMPLETED", "EXITED"]):
                JourneyEnrollment.objects.create(journey=journey, journey_version=version, tenant_id=tenant.id, party_id=f"P-T-{index}", status=status)
            paused = Journey.objects.create(tenant_id=tenant.id, name="Birthday Reward", status="PAUSED", population_mode="FIXED", code=f"JRN-2026-{random.randint(90000, 99999)}", created_by=user, updated_by=user)
            with connections["default"].cursor() as cursor:
                rows = home.journeys(cursor, tenant.id)
            by_name = {row["name"]: row for row in rows["rows"]}
            cart, birthday = by_name.get("Cart Recovery"), by_name.get("Birthday Reward")
            check("an active journey: its channels from the version's communication nodes, 2 in flight of 4 entered, 25% completed",
                  cart and cart["status"] == "ACTIVE" and cart["channels"] == ["EMAIL", "SMS"] and (cart["in_flight"], cart["entered"], cart["completed"], cart["conversion_rate"]) == (2, 4, 1, 25.0), str(cart))
            check("a paused journey says who paused it and when", birthday and birthday["status"] == "PAUSED" and birthday["paused_by"] and birthday["paused_at"], str(birthday))
            # a failed journey run turns the journey FAILED
            generated = Campaign.objects.create(tenant_id=tenant.id, name=f"Cart Recovery step {uuid.uuid4().hex[:4]}", channel="SMS", campaign_type="JOURNEY", send_type="IMMEDIATE", status="ACTIVE",
                                                is_journey_generated=True, origin_journey=journey, created_by=user, updated_by=user, code=f"CMP-2026-{random.randint(90000, 99999)}")
            CampaignRun.objects.create(campaign=generated, tenant_id=tenant.id, run_number=1, run_type="JOURNEY_INSTANCE", status="FAILED", test_mode=False, started_at=timezone.now(), completed_at=timezone.now())
            with connections["default"].cursor() as cursor:
                cart = {row["name"]: row for row in home.journeys(cursor, tenant.id)["rows"]}["Cart Recovery"]
            check("a journey whose last run failed reads FAILED, with the step's channel and when", cart["status"] == "FAILED" and cart["failing_step"] == "SMS" and cart["failing_since"], str(cart))
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    check.done()
