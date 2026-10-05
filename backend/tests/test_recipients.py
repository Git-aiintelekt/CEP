"""Who a run went to and what became of each message; the campaign's blocked and unsubscribed people; the engine's callback health. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns.models import Campaign, CampaignRun
from apps.delivery.models import DeliveryProvider, MailerExecution
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_recipients(check, admin_email):
    """Who a run went to and what became of each message; the campaign's blocked and unsubscribed people; the engine's callback health. Rolled back."""
    class Roll(Exception):
        pass

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    tok = context.set_current(str(tenant.id), "default", str(user.pk))
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
            run = CampaignRun.objects.filter(tenant_id=tenant.id, test_mode=False, campaign__channel="EMAIL").annotate().order_by("-created_at").first()
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT campaign_run_id, count(*) FROM mailer_execution WHERE tenant_id = %s GROUP BY 1 ORDER BY 2 DESC LIMIT 1", [str(tenant.id)])
                run_id, n = cursor.fetchone()
            run = CampaignRun.objects.get(pk=run_id)
            page = API.get(f"/api/v1/campaign-runs/{run.pk}/recipients/", {"page_size": 5}).json()
            check("the run's recipients page: count, rows with address/status/times, the status breakdown and the family",
                  page["count"] == n and len(page["results"]) == 5 and {"address", "status", "provider_message_id", "submitted_at", "opened_at", "first_name"} <= set(page["results"][0])
                  and sum(page["by_status"].values()) == n and page["run"]["family"] == "EMAIL", f"{page.get('count')} of {n}, {str(page)[:120]}")
            first = page["results"][0]
            found = API.get(f"/api/v1/campaign-runs/{run.pk}/recipients/", {"q": first["address"][:8]}).json()
            check("search by address narrows the list", 1 <= found["count"] < n and any(r["id"] == first["id"] for r in found["results"]), str(found["count"]))
            status = next(iter(page["by_status"]))
            by = API.get(f"/api/v1/campaign-runs/{run.pk}/recipients/", {"status": status, "page_size": 200}).json()
            check("filter by status", by["count"] == page["by_status"][status] and all(r["status"] == status for r in by["results"]), f"{status} {by['count']}")
            bad = API.get(f"/api/v1/campaign-runs/{run.pk}/recipients/", {"status": "NONSENSE"})
            check("an unknown status is refused on its field", bad.status_code == 400 and "status" in str(bad.json()))
            export = API.get(f"/api/v1/campaign-runs/{run.pk}/recipients/export.csv")
            lines = export.content.decode("utf-8-sig").splitlines()
            check("CSV export: a header and every recipient", export.status_code == 200 and lines[0].startswith("address,first_name") and len(lines) == n + 1, f"{export.status_code} {len(lines)}")
            detail = API.get(f"/api/v1/campaign-runs/{run.pk}/recipients/{first['id']}/").json()
            check("a recipient's detail: the message, its timeline in order, the callbacks count, the log rows and the address's standing",
                  detail["recipient"]["id"] == first["id"] and detail["events"] and "Queued" in [e["what"] for e in detail["events"]]
                  and [e["at"] for e in detail["events"]] == sorted(e["at"] for e in detail["events"]) and "callbacks" in detail and isinstance(detail["log"], list)
                  and detail["standing"] is not None and {"blocked", "consent", "hard_bounces"} <= set(detail["standing"]), str(detail)[:200])
            missing = API.get(f"/api/v1/campaign-runs/{run.pk}/recipients/999999999/")
            check("an unknown recipient is a 404", missing.status_code == 404)
            checked = API.post(f"/api/v1/campaign-runs/{run.pk}/recipients/{first['id']}/check/")
            check("Check with Postal on a seed message answers in words (no such message at Postal, or no id to look up)",
                  checked.status_code in (200, 400) and ("detail" in checked.json() or "status" in checked.json()), f"{checked.status_code} {str(checked.json())[:140]}")

            campaign = run.campaign
            blocked = API.get(f"/api/v1/campaigns/{campaign.pk}/suppressions/").json()
            everyone = API.get("/api/v1/suppressions/").json()
            check("the campaign's blocked and unsubscribed people: the Suppressions rows kept to this campaign, with a summary",
                  blocked["count"] <= everyone["count"] and {"summary", "results", "count"} <= set(blocked) and all({"reason_label", "source_label", "since", "group"} <= set(r) for r in blocked["results"])
                  and blocked["summary"]["total"] == blocked["count"], f"{blocked['count']} of {everyone['count']}")
            parties = set()
            with connections["default"].cursor() as cursor:
                cursor.execute("""SELECT m.party_id FROM contact_list_member m JOIN contact_list_campaign c ON c.contact_list_id = m.contact_list_id WHERE m.tenant_id = %s AND c.campaign_id = %s
                              UNION SELECT m.party_id FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id WHERE m.tenant_id = %s AND l.campaign_id = %s""",
                               [str(tenant.id), str(campaign.pk), str(tenant.id), str(campaign.pk)])
                parties = {r[0] for r in cursor.fetchall()}
            check("… every row is one of the campaign's people", all(r["party_id"] in parties for r in blocked["results"]))
            only = API.get(f"/api/v1/campaigns/{campaign.pk}/suppressions/", {"reason": "BOUNCED"}).json()
            check("filter by reason group", all(r["group"] == "BOUNCED" for r in only["results"]))
            csv_out = API.get(f"/api/v1/campaigns/{campaign.pk}/suppressions/export.csv")
            check("… and a CSV", csv_out.status_code == 200 and csv_out.content.decode("utf-8-sig").splitlines()[0] == "contact,channel,reason,source,detail,since,customer_id,name"
                  and len(csv_out.content.decode("utf-8-sig").splitlines()) == blocked["count"] + 1)

            engines = API.get("/api/v1/delivery-providers/").json()
            rows = engines["results"] if isinstance(engines, dict) else engines
            postal = next(r for r in rows if r["provider_type"] == "POSTAL")
            check("an engine carries its callback health: last callback time (or null) and the last 24 hours' count", "last_callback_at" in postal and "callbacks_24h" in postal, str({k: postal.get(k) for k in ("last_callback_at", "callbacks_24h")}))
            raise Roll
    except Roll:
        pass
    finally:
        context.reset(tok)
    check.done()
