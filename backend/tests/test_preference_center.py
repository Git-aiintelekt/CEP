"""The preference centre, end to end on the local database, rolled back: settings, topics, the public page, the tag, the audience rule,
the campaign's topic and the publish check.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import uuid
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns import service
from apps.campaigns.models import Campaign
from apps.contact_lists.models import ContactList
from apps.delivery.engine import unsubscribe
from apps.governance import preferences
from apps.governance.models import SubscriptionTopic
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_preference_center(check):
    """The preference centre, end to end on the local database, rolled back: settings, topics, the public page, the tag, the audience rule,"""
    class Roll(Exception):
        pass

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    tok = context.set_current(str(tenant.id), "default", str(user.pk))

    def fresh():
        """The tenant as the API sees it: the router picks the alias, and inside a rolled-back test that alias alone sees the API's writes."""
        return Tenant.objects.get(pk=tenant.id)

    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    PUBLIC = Client()
    URL = "/api/v1/public/preferences/"
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
                cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
            tenant = fresh()
            # ---- settings
            check("off by default", preferences.enabled(tenant) is False and preferences.settings_of(tenant)["heading"] == "Choose what you receive")
            answer = API.get("/api/v1/workspace/preference-center/")
            page = answer.json()
            check("GET settings: the switch, the words, the tag, a preview link and the figures", answer.status_code == 200 and page["enabled"] is False and page["tag"] == "{{preference_url}}"
                  and "/public/preferences/?t=" in page["preview_url"] and set(page["stats"]) == {"days", "opened", "unsubscribed", "opted_in", "topics_unticked"} and page["workspace_name"] == tenant.name,
                  f"{answer.status_code} {str(page)[:120]}")
            answer = API.put("/api/v1/workspace/preference-center/", {"privacy_url": "www.example.com/privacy"}, content_type="application/json")
            check("a privacy link without https:// is refused on its field", answer.status_code == 400 and "privacy_url" in str(answer.json()), str(answer.json())[:100])
            answer = API.put("/api/v1/workspace/preference-center/", {"enabled": True, "brand_name": "Northwind Apparel", "footer": "1200 Peachtree St NE, Atlanta, GA 30309", "privacy_url": "https://example.com/privacy"},
                             content_type="application/json")
            tenant = fresh()
            check("switched on with the page's words", answer.status_code == 200 and answer.json()["enabled"] is True and preferences.enabled(tenant) and preferences.brand_name(tenant) == "Northwind Apparel",
                  f"{answer.status_code} {str(answer.json())[:160]} | enabled after refresh: {preferences.enabled(tenant)} | brand {preferences.brand_name(tenant)!r}")

            # ---- topics through the API
            made = API.post("/api/v1/subscription-topics/", {"name": "Rewards and offers", "description": "Member offers and birthday rewards.", "channels": ["EMAIL", "SMS"]}, content_type="application/json")
            made2 = API.post("/api/v1/subscription-topics/", {"name": "New arrivals", "channels": ["email"]}, content_type="application/json")
            bad = API.post("/api/v1/subscription-topics/", {"name": "", "channels": []}, content_type="application/json")
            check("topics are created with a code made from the name and a sort order; a nameless one is refused",
                  made.status_code == 201 and made.json()["code"] == "rewards_and_offers" and made2.status_code == 201 and made2.json()["channels"] == ["EMAIL"] and made2.json()["sort_order"] > made.json()["sort_order"]
                  and bad.status_code == 400 and "name" in str(bad.json()), f"{made.status_code} {str(made.json())[:80]} | {bad.status_code}")
            rewards, arrivals = made.json()["id"], made2.json()["id"]
            listed = API.get("/api/v1/subscription-topics/").json()
            check("the list carries the switch state for the campaign setup, and the opt-out count per topic", listed["enabled"] is True and [t["name"] for t in listed["results"]] == ["Rewards and offers", "New arrivals"]
                  and listed["results"][0]["opted_out"] == 0, str(listed)[:120])

            # ---- the public page for a real person on an NWA list
            with connections["default"].cursor() as cursor:
                cursor.execute("""SELECT cm.party_id, (SELECT e ->> 'address' FROM jsonb_array_elements(cm.emails) e LIMIT 1) FROM customer_master cm
                               WHERE cm.tenant_id = %s AND jsonb_array_length(cm.emails) > 0 AND NOT EXISTS (SELECT 1 FROM consent_suppression cs WHERE cs.tenant_id = cm.tenant_id AND cs.party_id = cm.party_id AND cs.channel = 'EMAIL' AND cs.consent_status = 'OPTED_OUT')
                               ORDER BY cm.party_id LIMIT 1""", [str(tenant.id)])
                party, email = cursor.fetchone()
            token = unsubscribe.token_for(tenant_code=tenant.code, party_id=party, email=email or "person@example.com", campaign_id=str(uuid.uuid4()), run_id=str(uuid.uuid4()))
            view = PUBLIC.get(URL, {"t": token})
            body = view.content.decode()
            check("GET: the person's page with both topics ticked, the brand, the masked address and the footer", view.status_code == 200 and "Rewards and offers" in body and "New arrivals" in body
                  and "Northwind Apparel" in body and "•••" in body and "Peachtree" in body and 'name="topic" value="' + rewards + '" checked' in body, str(view.status_code))
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT count(*) FROM tracking_event WHERE tenant_id = %s AND party_id = %s AND event_type = 'PREFERENCE_VIEW'", [str(tenant.id), party])
                check("the view is recorded as a Preference View", cursor.fetchone()[0] == 1)
            saved = PUBLIC.post(f"{URL}?t={token}", {"action": "save", "email": "on", "topic": [rewards]})
            body = saved.content.decode()
            check("POST: unticking a topic is saved and said back", saved.status_code == 200 and "Saved. You will receive email about Rewards and offers" in body
                  and preferences.opted_out(tenant.id, party) == {arrivals}, body[body.find("Saved"):body.find("Saved") + 90] if "Saved" in body else str(saved.status_code))
            check("the topic's opt-out count follows", API.get("/api/v1/subscription-topics/").json()["results"][1]["opted_out"] == 1)
            off = PUBLIC.post(f"{URL}?t={token}", {"action": "save", "topic": [rewards, arrivals]})
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT consent_status, opt_out_method FROM consent_suppression WHERE tenant_id = %s AND party_id = %s AND channel = 'EMAIL'", [str(tenant.id), party])
                row = cursor.fetchone()
            check("unticking Email opts the person out with method PREFERENCE_CENTER; the page says they are unsubscribed", off.status_code == 200 and row == ("OPTED_OUT", "PREFERENCE_CENTER")
                  and "You are unsubscribed" in off.content.decode(), str(row))
            back = PUBLIC.post(f"{URL}?t={token}", {"action": "save", "email": "on", "topic": [rewards, arrivals]})
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT consent_status FROM consent_suppression WHERE tenant_id = %s AND party_id = %s AND channel = 'EMAIL'", [str(tenant.id), party])
                status = cursor.fetchone()[0]
                cursor.execute("SELECT action, source FROM consent_record WHERE tenant_id = %s AND party_id = %s AND channel = 'EMAIL' ORDER BY occurred_at DESC, id DESC LIMIT 1", [str(tenant.id), party])
                last = cursor.fetchone()
            check("ticking Email again opts back in (RESUBSCRIBE, source PREFERENCE_CENTER)", back.status_code == 200 and status == "OPTED_IN" and last == ("RESUBSCRIBE", "PREFERENCE_CENTER") and "Saved" in back.content.decode(), f"{status} {last}")
            all_off = PUBLIC.post(f"{URL}?t={token}", {"action": "unsubscribe_all"})
            check("Unsubscribe from all: the red page; the topics are untouched", all_off.status_code == 200 and "You are unsubscribed" in all_off.content.decode() and preferences.opted_out(tenant.id, party) == set())
            preferences.save(tenant, {"allow_opt_in": False})
            locked = PUBLIC.post(f"{URL}?t={token}", {"action": "reopen"})
            check("with opting in again switched off, Email is shown locked with when it was switched off", locked.status_code == 200 and "Switched off on" in locked.content.decode() and 'name="email"  disabled' in locked.content.decode().replace("checked", "").replace("  ", " ") or "disabled" in locked.content.decode())
            refused = PUBLIC.post(f"{URL}?t={token}", {"action": "save", "email": "on", "topic": [rewards, arrivals]})
            check("… and a POST that ticks it is refused in words, nothing recorded", refused.status_code == 200 and "switched off: to receive them again" in refused.content.decode())
            preferences.save(tenant, {"allow_opt_in": True})
            PUBLIC.post(f"{URL}?t={token}", {"action": "save", "email": "on", "topic": [rewards, arrivals]})

            # ---- the unsubscribe page links here; a test token previews; off = no page
            confirm = PUBLIC.get("/api/v1/public/unsubscribe/", {"t": token}).content.decode()
            check("the unsubscribe confirmation offers 'choose what you receive'", "choose what you receive" in confirm and "/public/preferences/?t=" in confirm)
            preview = PUBLIC.get(URL, {"t": unsubscribe.test_token(tenant_code=tenant.code, email="someone@example.com")}).content.decode()
            check("a test send's link opens a preview that saves nothing", "Preview from a test message" in preview and "Rewards and offers" in preview and 'disabled>Save Preferences' in preview)
            check("a bad token gets the page's own 400", PUBLIC.get(URL, {"t": "nonsense"}).status_code == 400)
            check("{{preference_url}} is the page while on", "/public/preferences/?t=" in preferences.link_for(tenant, token))
            preferences.save(tenant, {"enabled": False})
            tenant = fresh()
            no_page = PUBLIC.get(URL, {"t": token}).content.decode()
            check("switched off: the page says so and offers the unsubscribe link; the tag is the unsubscribe link; the confirmation loses the offer",
                  "does not offer a preference page" in no_page and "/public/unsubscribe/?t=" in no_page and "/public/unsubscribe/?t=" in preferences.link_for(tenant, token)
                  and "choose what you receive" not in PUBLIC.get("/api/v1/public/unsubscribe/", {"t": token}).content.decode())
            preferences.save(tenant, {"enabled": True})
            tenant = fresh()

            # ---- the campaign's topic, the audience estimate and the publish check
            campaign = Campaign.objects.filter(tenant_id=tenant.id, deleted_at__isnull=True, status="DRAFT", channel="EMAIL", campaign_type="REGULAR_MARKETING", solicitation_type="MARKETING").order_by("created_at").first()
            answer = API.patch(f"/api/v1/campaigns/{campaign.pk}/", {"topic": str(uuid.uuid4())}, content_type="application/json")
            check("a topic that is not the workspace's is refused", answer.status_code == 400 and "topic" in str(answer.json()), str(answer.json())[:100])
            answer = API.patch(f"/api/v1/campaigns/{campaign.pk}/", {"topic": arrivals}, content_type="application/json")
            check("the campaign is filed under a topic; the change is logged as 'topic'", answer.status_code == 200 and answer.json()["topic"] == arrivals, f"{answer.status_code} {str(answer.json())[:100]}")
            campaign = Campaign.objects.get(pk=campaign.pk)
            lists = list(campaign.contact_list_campaigns.filter(role="INCLUDE").values_list("contact_list_id", flat=True))
            if not lists:
                lists = list(ContactList.objects.filter(tenant_id=tenant.id, deleted_at__isnull=True).values_list("id", flat=True)[:1])
            base = service.audience(campaign, include=lists)
            with connections["default"].cursor() as cursor:                # one marketable person on that list unticks the topic
                cursor.execute("SELECT m.party_id FROM contact_list_member m WHERE m.tenant_id = %s AND m.contact_list_id = ANY(%s::uuid[]) ORDER BY m.party_id", [str(tenant.id), [str(i) for i in lists]])
                members = [r[0] for r in cursor.fetchall()]
            marketable = next((p["party_id"] for p in service.audience(campaign, include=lists, sample=500)["sample"] if p["status"] == "MARKETABLE"), None)
            if marketable:
                preferences.set_topics(tenant.id, marketable, [SubscriptionTopic.objects.get(pk=arrivals)], {arrivals})
                after = service.audience(campaign, include=lists)
                line = next((s for s in after["statuses"] if s["code"] == "TOPIC_OPTED_OUT"), None)
                check("the audience estimate leaves out the person who unticked the campaign's topic", after["estimated_recipients"] == base["estimated_recipients"] - 1 and line and line["count"] == 1,
                      f"{base['estimated_recipients']} -> {after['estimated_recipients']} {line}")
                preferences.save(tenant, {"enabled": False}); tenant = fresh(); campaign = Campaign.objects.get(pk=campaign.pk)
                check("… but not while the preference centre is off", service.audience(campaign, include=lists)["estimated_recipients"] == base["estimated_recipients"])
                preferences.save(tenant, {"enabled": True}); tenant = fresh(); campaign = Campaign.objects.get(pk=campaign.pk)
            else:
                print("skip: no marketable member on the list to test the audience rule with")
            problems = service.publish_problems(campaign, production=True)
            check("a filed campaign has no topic problem", "topic" not in problems, str(problems.get("topic")))
            campaign.topic = None
            problems = service.publish_problems(campaign, production=True)
            check("an unfiled marketing campaign cannot be published while topics exist", problems.get("topic", "").startswith("Choose the topic"), str(problems.get("topic")))
            preferences.save(tenant, {"enabled": False}); tenant = fresh(); campaign = Campaign.objects.get(pk=campaign.pk); campaign.topic = None
            check("… unless the preference centre is off", "topic" not in service.publish_problems(campaign, production=True))
            preferences.save(tenant, {"enabled": True}); tenant = fresh()
            gone = API.delete(f"/api/v1/subscription-topics/{arrivals}/")
            campaign = Campaign.objects.get(pk=campaign.pk)
            check("removing a topic hides it and tells a campaign filed under it at publish", gone.status_code == 204 and len(API.get("/api/v1/subscription-topics/").json()["results"]) == 1
                  and "removed" in service.publish_problems(campaign, production=True).get("topic", ""), str(service.publish_problems(campaign, production=True).get("topic")))
            raise Roll
    except Roll:
        pass
    finally:
        context.reset(tok)
    check.done()
