"""UTM tracking: which links are tagged and how, Settings → UTM Tracking, the campaign's link list, send-time tagging of email
and text messages (short links for texts), a campaign's own choices and the short link's click. Rolled back."""
import json
from types import SimpleNamespace
from unittest import mock

import pytest
from django.db import connections
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from api.v1 import utm_api
from apps.delivery import utm
from apps.delivery.engine import linktags
from apps.identity.models import AppUser
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

ON = {"utm": {"email": True, "sms": True, "domains": ["northwindapparel.com"]}}
HTML = ('<a href="https://shop.northwindapparel.com/fall"><img alt="Hero image" src="x"></a>'
        '<a class="b" href="https://shop.northwindapparel.com/fall?x=1&amp;y=2">Shop the Collection</a>'
        '<a href="https://northwindapparel.com/stores?utm_source=instore">Find a store</a>'
        '<a href="https://instagram.com/nw">Instagram</a><a href="{{unsubscribe_url}}">Unsubscribe</a><a href="mailto:a@b.co">Write to us</a>')


def test_rules(check):
    settings = utm.settings_for(ON)
    check("the recommended values: source c360, campaign name and code, link label with the variant, the campaign's type as tactic",
          settings["params"]["utm_source"] == {"kind": "text", "value": "c360"} and settings["params"]["utm_id"]["value"] == "campaign_code"
          and settings["params"]["utm_content"]["value"] == "link_label_variant" and settings["keep_existing"])
    found = [(link["label"], utm.verdict(link["url"].replace("{{unsubscribe_url}}", "https://c360.example/api/v1/public/unsubscribe/?t=1"), settings, ("c360.example",)))
             for link in utm.links(HTML)]
    check("an image link takes its alt text; own tags, other sites, unsubscribe and mailto: are told apart", found == [
        ("hero-image", "TAGGED"), ("shop-the-collection", "TAGGED"), ("find-a-store", "OWN_TAGS"), ("instagram", "NOT_YOUR_SITE"),
        ("unsubscribe", "NEVER"), ("write-to-us", "NEVER")], str(found))
    tagged = utm.tag_url("https://shop.northwindapparel.com/fall?x=1#top", {"utm_source": "c360", "utm_medium": "email", "utm_content": "hero"}, settings)
    check("tags follow the address's own query, in the standard order, before its anchor",
          tagged == "https://shop.northwindapparel.com/fall?x=1&utm_source=c360&utm_medium=email&utm_content=hero#top", tagged)
    own = utm.tag_url("https://northwindapparel.com/s?utm_source=instore", {"utm_source": "c360", "utm_medium": "email"}, settings)
    replaced = utm.tag_url("https://northwindapparel.com/s?utm_source=instore", {"utm_source": "c360", "utm_medium": "email"}, {**settings, "keep_existing": False})
    check("a link's own tags are kept (missing ones added), or replaced when the workspace says so",
          own.endswith("utm_source=instore&utm_medium=email") and replaced.endswith("s?utm_source=c360&utm_medium=email"), own + " / " + replaced)
    values = utm.campaign_values({"campaign_name": "Fall Launch: New Arrivals", "campaign_code": "CMP-2026-0042", "campaign_category": "promotional",
                                  "overrides": {"utm_campaign": "Fall 26"}}, settings, "SMS")
    check("values go out lowercase with dashes; medium and format follow the channel; a campaign's own name wins",
          values["utm_campaign"] == "fall-26" and values["utm_id"] == "cmp-2026-0042" and values["utm_medium"] == "sms" and values["utm_creative_format"] == "text", str(values))
    stored, errors = utm.validate({"email": True, "domains": [], "params": {"utm_source": {"kind": "none"}, "utm_campaign": {"kind": "field", "value": "nope"}}})
    check("utm_source cannot be dropped, a field must be a known one, and a switched-on channel needs your sites",
          set(errors) == {"params.utm_source", "params.utm_campaign", "domains"}, str(errors))
    stored, errors = utm.validate({"sms": True, "domains": ["https://Shop.NorthwindApparel.com/x", "northwindapparel.com"],
                                   "params": {"utm_source": {"kind": "text", "value": "Northwind News"}}, "keep_existing": False})
    check("a domain typed as an address is cleaned; fixed text is stored as it goes out", not errors and stored["domains"] == ["northwindapparel.com", "shop.northwindapparel.com"]
          and stored["params"]["utm_source"]["value"] == "northwind-news" and stored["keep_existing"] is False, str(stored) + str(errors))
    check.done()


def _campaign(**fields):
    return SimpleNamespace(pk="00000000-0000-4000-8000-0000000000c1", tenant_id="00000000-0000-4000-8000-0000000000f1", name="Fall Launch: New Arrivals", code="CMP-2026-0042", campaign_type="REGULAR_MARKETING",
                           solicitation_type="MARKETING", **{"channel": "EMAIL", **fields})


def test_send_time(check):
    renderer = SimpleNamespace(html=HTML, text="")
    stored = {"enabled": True, "overrides": {}, "labels": {"2|https://shop.northwindapparel.com/fall?x=1&y=2": "Hero CTA"}}
    with mock.patch.object(linktags, "ready", return_value=True), mock.patch.object(linktags, "campaign_config", return_value=stored), \
            mock.patch.object(linktags, "never_hosts", return_value=("c360.example",)):
        tagger = linktags.Tagger(_campaign(), "EMAIL", "default", renderer, tenant_settings=ON)
        html = HTML.replace("{{unsubscribe_url}}", "https://c360.example/api/v1/public/unsubscribe/?t=1")
        out = tagger.email({"html": html, "text": "Shop now: https://shop.northwindapparel.com/fall?x=1&y=2 or https://instagram.com/nw"}, "B")
    check("the campaign's own label and the A/B variant make utm_content; the HTML keeps &amp;", "utm_content=hero-cta-b" in out["html"]
          and "x=1&amp;y=2&amp;utm_source=c360" in out["html"] and "utm_content=hero-image-b" in out["html"], out["html"][:400])
    check("Instagram, unsubscribe and mailto: go out as written", 'href="https://instagram.com/nw"' in out["html"] and "unsubscribe/?t=1\"" in out["html"]
          and 'href="mailto:a@b.co"' in out["html"])
    check("the text part's link takes its HTML twin's label; other sites stay as they are",
          "utm_content=hero-cta-b" in out["text"] and out["text"].endswith("https://instagram.com/nw"), out["text"])

    sms_renderer = SimpleNamespace(html="", text="Weekend: https://shop.northwindapparel.com/weekend now")
    made = []
    with mock.patch.object(linktags, "ready", return_value=True), mock.patch.object(linktags, "campaign_config", return_value={"enabled": True, "overrides": {}, "labels": {}}), \
            mock.patch.object(linktags, "shorten", side_effect=lambda alias, t, code, c, url, label: made.append((url, label)) or "https://c360.example/api/v1/l/NWA/k7Pq2Xs/"):
        tagger = linktags.Tagger(_campaign(channel="SMS"), "SMS", "default", sms_renderer, tenant_settings=ON)
        text = tagger.sms(sms_renderer.text)
    check("a text's link becomes the short link of its tagged address", text == "Weekend: https://c360.example/api/v1/l/NWA/k7Pq2Xs/ now"
          and made and "utm_medium=sms" in made[0][0] and made[0][1] == "link-1", text + str(made))

    for why, settings, config, ready in (("the workspace has texts off", {"utm": {"email": True, "domains": ["northwindapparel.com"]}}, {"enabled": True}, True),
                                         ("the campaign switched tagging off", ON, {"enabled": False, "overrides": {}, "labels": {}}, True),
                                         ("patch 0070 is not applied", ON, {"enabled": True}, False)):
        with mock.patch.object(linktags, "ready", return_value=ready), mock.patch.object(linktags, "campaign_config", return_value=config):
            tagger = linktags.Tagger(_campaign(channel="SMS"), "SMS", "default", sms_renderer, tenant_settings=settings)
            check(f"no tagging when {why}", tagger.sms(sms_renderer.text) == sms_renderer.text)
    check.done()


def _client(admin_email):
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    client = Client()
    headers = {"HTTP_X_TENANT": admin.tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}
    return client, headers


def test_settings_and_preview(check, admin_email):
    client, headers = _client(admin_email)

    def call(method, path, body=None):
        return getattr(client, method)(f"/api/v1/{path}", json.dumps(body) if body is not None else None, content_type="application/json", **headers)

    first = call("get", "workspace/utm/").json()
    check("Settings → UTM Tracking starts off, with the recommended values and the fields to choose from",
          "email" in first and "params" in first and {f["key"] for f in first["fields"]} >= {"campaign_name", "campaign_code", "link_label_variant"}, str(first)[:300])
    refused = call("put", "workspace/utm/", {"email": True, "domains": [], "params": {}})
    check("switching a channel on without your sites is refused, on the domains field", refused.status_code == 400 and "domains" in refused.json().get("errors", refused.json()), refused.content[:300])
    saved = call("put", "workspace/utm/", {"email": True, "sms": True, "domains": ["northwindapparel.com"], "keep_existing": True,
                                           "params": {"utm_source": {"kind": "text", "value": "c360"}, "utm_term": {"kind": "none", "value": ""}}})
    check("saved settings come back as stored", saved.status_code == 200 and saved.json()["email"] and saved.json()["domains"] == ["northwindapparel.com"], saved.content[:300])

    template = SimpleNamespace(pk="tpl", channel="EMAIL")
    content = SimpleNamespace(html_content=HTML, text_content="", sms_body="", subject_line="")
    first_of = lambda value: mock.Mock(**{"filter.return_value.first.return_value": value, "filter.return_value.order_by.return_value.first.return_value": value})  # noqa: E731
    with mock.patch.object(utm_api, "TemplateMaster", mock.Mock(objects=first_of(template))), \
            mock.patch.object(utm_api, "RenderedTemplateContent", mock.Mock(objects=first_of(content))):
        preview = call("post", "utm/preview/", {"template_id": "tpl", "channel": "EMAIL", "name": "Fall Launch: New Arrivals", "code": "CMP-2026-0042",
                                                "tracking": {"enabled": True, "overrides": {"utm_campaign": "Fall 26"}, "labels": {"1|https://shop.northwindapparel.com/fall": "Hero"}}}).json()
    rows = {row["position"]: row for row in preview.get("links", [])}
    check("the preview lists every link with its verdict; the unsubscribe tag is never tagged", preview.get("workspace_on")
          and [rows[p]["verdict"] for p in sorted(rows)] == ["TAGGED", "TAGGED", "OWN_TAGS", "NOT_YOUR_SITE", "NEVER", "NEVER"], json.dumps(preview)[:600])
    check("a campaign's own label and campaign name show in the address it opens", rows[1]["label"] == "hero" and "utm_content=hero" in rows[1]["opens"]
          and "utm_campaign=fall-26" in rows[1]["opens"] and preview["defaults"]["utm_campaign"] == "fall-launch-new-arrivals", rows.get(1))
    check.done()


def _ready() -> bool:
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.campaign_link_tracking') IS NOT NULL")
        return cursor.fetchone()[0]


def test_campaign_choices_and_short_link(check, admin_email):
    if not _ready():
        pytest.skip("patch 0070 (UTM tracking) has not been applied to this database")
    client, headers = _client(admin_email)
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    from apps.campaigns.models import Campaign
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(admin.tenant_id)])
    campaign = Campaign.objects.filter(tenant_id=admin.tenant_id, deleted_at__isnull=True).order_by("created_at").first()
    if campaign is None:
        pytest.skip("no campaign in this database")

    def call(method, path, body=None):
        return getattr(client, method)(f"/api/v1/{path}", json.dumps(body) if body is not None else None, content_type="application/json", **headers)

    before = call("get", f"campaigns/{campaign.pk}/link-tracking/").json()
    check("a campaign without its own choices follows the workspace", before.get("ready") and before.get("enabled") is True and before.get("labels") == {}, str(before))
    saved = call("put", f"campaigns/{campaign.pk}/link-tracking/", {"enabled": False, "overrides": {"utm_campaign": "Fall 26", "utm_id": "ignored"},
                                                                    "labels": {"1|https://x.example": "Hero Image!"}}).json()
    check("its own choices are kept, cleaned (only campaign name and tactic can be its own)", saved.get("enabled") is False and saved.get("overrides") == {"utm_campaign": "fall-26"}
          and saved.get("labels") == {"1|https://x.example": "hero-image"}, str(saved))
    version = Campaign.objects.filter(pk=campaign.pk).values_list("row_version", flat=True).first()
    check("saving them does not touch the campaign's row_version (the wizard's save stays valid)", version == campaign.row_version, f"{campaign.row_version} -> {version}")

    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(admin.tenant_id)])
    short = linktags.shorten("default", admin.tenant_id, admin.tenant.code, campaign.pk, "https://shop.northwindapparel.com/w?utm_source=c360", "link-1")
    again = linktags.shorten("default", admin.tenant_id, admin.tenant.code, campaign.pk, "https://shop.northwindapparel.com/w?utm_source=c360", "link-1")
    check("one short link per campaign and address, under the workspace's code", short == again and f"/api/v1/l/{admin.tenant.code}/" in short, short)
    path = short[short.index("/api/v1/l/"):]
    opened = Client().get(path)
    peeked = Client().head(path)
    clicks = call("get", f"campaigns/{campaign.pk}/link-tracking/").json().get("clicks", [])
    check("opening it goes on to the tagged page and counts one click; a link preview's HEAD does not count", opened.status_code == 302
          and opened["Location"] == "https://shop.northwindapparel.com/w?utm_source=c360" and peeked.status_code == 302
          and any(row["clicks"] == 1 for row in clicks), str(clicks))
    gone = Client().get(f"/api/v1/l/{admin.tenant.code}/nosuchtoken/")
    unknown = Client().get("/api/v1/l/NOSUCHWS/abc/")
    check("an unknown code or workspace gets the plain 'not available' page", gone.status_code == 404 and b"not available" in gone.content
          and unknown.status_code == 404 and b"not available" in unknown.content, unknown.content[:200])
    check.done()
