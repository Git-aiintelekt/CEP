"""WhatsApp through Meta: the adapter against Meta's documented shapes, then a workspace end to end with Meta faked.

A number is connected, a template is written with tags, submitted, approved by Meta's callback, sent to a list (consent,
opt-outs and a text STOP judged the WhatsApp way), and Meta's delivered / read / failed callbacks, a quick-reply STOP and a
Sync come back. Rolled back; nothing leaves the machine (Meta is an HTTP adapter mounted on the engine's session)."""
import hashlib
import hmac
import json
from unittest import mock
from urllib.parse import urlsplit

import pytest
import requests
from django.core.cache import cache
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.delivery import engine
from apps.delivery.engine import runs
from apps.delivery.providers import EventType, WhatsAppMessage, registry
from apps.delivery.providers.whatsapp_meta import WhatsAppMetaProvider, reason_of
from apps.identity.models import AppUser
from apps.integrations.bridge import logbook, metrics
from apps.platform_ops import params
from apps.templates import whatsapp
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]

APP_SECRET, TOKEN, WABA, NUMBER_ID = "app-s3cret", "EAAtoken", "104883925517204", "118204576330981"


def signed(body: dict) -> tuple[bytes, str]:
    raw = json.dumps(body).encode()
    return raw, "sha256=" + hmac.new(APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()


def callback(field: str, value: dict) -> dict:
    return {"object": "whatsapp_business_account", "entry": [{"id": WABA, "changes": [{"field": field, "value": value}]}]}


def test_meta_adapter_and_template_forms(check):
    """The parts that need no database: tags to Meta's numbers and back, the message body, Meta's callbacks and errors."""
    meta, order = whatsapp.to_meta("Hi ${FIRST_NAME}, {{first_name}} again: {{store}} is open.")
    check("tags become Meta's numbers in the order they first appear, a tag used twice keeps its number, ${X} is {{x}}",
          meta == "Hi {{1}}, {{1}} again: {{2}} is open." and order == ["first_name", "store"], f"{meta} {order}")
    check("and back to tags; a number without a tag stays a number", whatsapp.to_tags("Hi {{1}}, {{2}}.", [{"tag": "first_name"}, {"tag": ""}]) == "Hi {{first_name}}, {{2}}.")
    check("values fill the numbers for the record", whatsapp.filled("Hi {{1}}, {{2}}.", ["Mei", "Harbour Mall"]) == "Hi Mei, Harbour Mall.")

    adapter = WhatsAppMetaProvider(config={"waba_id": WABA, "phone_number_id": NUMBER_ID}, secret=TOKEN, transactional_secret=APP_SECRET)
    body = adapter.payload(WhatsAppMessage(to_number="+65 9123 4471", template_name="weekend_offer", language="en", body_values=["Mei", "20%"], header_type="IMAGE",
                                           header_link="https://cdn.example/w.jpg", idempotency_key="t:r:p:WHATSAPP:v1"))
    check("a template message: the number in digits, the header picture by link, the body values in order, our key echoed back by Meta",
          body["to"] == "6591234471" and body["type"] == "template" and body["template"]["name"] == "weekend_offer" and body["template"]["language"] == {"code": "en"}
          and body["template"]["components"][0] == {"type": "header", "parameters": [{"type": "image", "image": {"link": "https://cdn.example/w.jpg"}}]}
          and body["template"]["components"][1]["parameters"] == [{"type": "text", "text": "Mei"}, {"type": "text", "text": "20%"}]
          and body["biz_opaque_callback_data"] == "t:r:p:WHATSAPP:v1", json.dumps(body)[:300])

    raw, signature = signed({"a": 1})
    check("a callback is accepted only with Meta's signature of the body by the app secret",
          adapter.verify_webhook({"x-hub-signature-256": signature}, raw) and not adapter.verify_webhook({"x-hub-signature-256": "sha256=00"}, raw)
          and not adapter.verify_webhook({}, raw))
    check("the subscription handshake echoes the challenge only for this address's token",
          adapter.subscribe_challenge({"hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1158201444"}, "tok") == "1158201444"
          and adapter.subscribe_challenge({"hub.mode": "subscribe", "hub.verify_token": "other", "hub.challenge": "1"}, "tok") is None)

    statuses = callback("messages", {"metadata": {"display_phone_number": "6568124400"}, "statuses": [
        {"id": "wamid.A", "status": "sent", "timestamp": "1762300000", "recipient_id": "6591234471"},
        {"id": "wamid.A", "status": "delivered", "timestamp": "1762300005", "recipient_id": "6591234471", "biz_opaque_callback_data": "k1"},
        {"id": "wamid.A", "status": "read", "timestamp": "1762300100", "recipient_id": "6591234471"},
        {"id": "wamid.B", "status": "failed", "timestamp": "1762300006", "recipient_id": "60124481902",
         "errors": [{"code": 131049, "title": "This message was not delivered to maintain healthy ecosystem engagement."}]}],
        "messages": [{"from": "6591234471", "id": "wamid.IN1", "timestamp": "1762300200", "type": "button", "button": {"text": "Stop Offers", "payload": "Stop Offers"}},
                     {"from": "6591234471", "id": "wamid.IN2", "timestamp": "1762300300", "type": "text", "text": {"body": "Is the shirt in navy?"}}]})
    events = adapter.parse_webhook(statuses)
    check("statuses: sent is skipped (the engine recorded the hand-over), delivered, read (as an open) and failed (with Meta's reason in words)",
          [(e.event_type, e.provider_message_id) for e in events] == [(EventType.DELIVERED, "wamid.A"), (EventType.OPENED, "wamid.A"), (EventType.DROPPED, "wamid.B")]
          and events[0].idempotency_key == "k1" and "share of marketing messages" in events[2].reason and "131049" in events[2].reason
          and len({e.provider_event_id for e in events}) == 3, str([(e.event_type, e.reason) for e in events]))
    inbound = adapter.parse_inbound(statuses)
    check("messages people send: a quick-reply tap and a typed text, from a number with +",
          [(m.from_number, m.text) for m in inbound] == [("+6591234471", "Stop Offers"), ("+6591234471", "Is the shirt in navy?")])
    updates = adapter.parse_account_updates({"entry": [{"changes": [
        {"field": "message_template_status_update", "value": {"event": "REJECTED", "message_template_id": 9001, "message_template_name": "weekend_offer",
                                                              "message_template_language": "en", "reason": "INVALID_FORMAT"}},
        {"field": "message_template_quality_update", "value": {"message_template_id": 9001, "new_quality_score": "RED"}},
        {"field": "phone_number_quality_update", "value": {"event": "UPGRADE", "current_limit": "TIER_10K"}}]}]})
    check("account callbacks: a template's review with its reason, its quality, the number's new daily limit",
          updates == [{"kind": "template_status", "meta_template_id": "9001", "name": "weekend_offer", "language": "en", "status": "REJECTED", "reason": "INVALID_FORMAT"},
                      {"kind": "template_quality", "meta_template_id": "9001", "quality": "RED"}, {"kind": "number_quality", "event": "UPGRADE", "limit": 10000}], str(updates))
    check("Meta's errors read as sentences with the code", reason_of({"code": 131026, "message": "Receiver is incapable"}) == (131026, "Not a WhatsApp number, or it cannot receive this message (Meta 131026)")
          and reason_of({"message": "odd"}) == (None, "odd"))
    check("the engine type is offered as a WhatsApp engine with the fields Meta gives",
          next(i for i in registry.catalogue() if i["provider_type"] == "WHATSAPP_META")["channel"] == "WHATSAPP"
          and {f["key"] for f in next(i for i in registry.catalogue() if i["provider_type"] == "WHATSAPP_META")["fields"]} >= {"waba_id", "phone_number_id", "access_token", "app_secret"})
    check.done()


def test_whatsapp_end_to_end(check, admin_email):
    """A workspace sends WhatsApp: number, template, Meta's review, a campaign, the callbacks, Sync."""
    meta = {"sent": [], "submitted": [], "templates": []}

    class FakeMeta(requests.adapters.BaseAdapter):
        def send(self, request, **kwargs):
            path, method = urlsplit(request.url).path, request.method
            body = json.loads(request.body or b"{}") if request.body and request.headers.get("Content-Type", "").startswith("application/json") else {}
            status, answer = 404, {"error": {"code": 100, "message": "Unknown path"}}
            if request.headers.get("Authorization") != f"Bearer {TOKEN}":
                status, answer = 401, {"error": {"code": 190, "message": "Invalid OAuth access token."}}
            elif method == "POST" and path.endswith(f"/{NUMBER_ID}/messages"):
                meta["sent"].append(body)
                if body["to"].endswith("000"):
                    status, answer = 400, {"error": {"code": 131026, "message": "Message undeliverable"}}
                else:
                    status, answer = 200, {"messaging_product": "whatsapp", "contacts": [{"input": body["to"], "wa_id": body["to"]}],
                                           "messages": [{"id": f"wamid.{body['to']}"}]}
            elif method == "GET" and path.endswith(f"/{NUMBER_ID}"):
                status, answer = 200, {"display_phone_number": "+65 6812 4400", "verified_name": "City HT", "quality_rating": "GREEN",
                                       "messaging_limit_tier": "TIER_1K", "name_status": "APPROVED", "id": NUMBER_ID}
            elif method == "POST" and path.endswith(f"/{WABA}/message_templates"):
                meta["submitted"].append(body)
                status, answer = 200, {"id": "9001", "status": "PENDING", "category": body["category"]}
            elif method == "GET" and path.endswith(f"/{WABA}/message_templates"):
                status, answer = 200, {"data": meta["templates"], "paging": {"cursors": {"before": "a", "after": "b"}}}
            response = requests.Response()
            response.status_code, response._content, response.url, response.request = status, json.dumps(answer).encode(), request.url, request
            response.headers["Content-Type"] = "application/json"
            return response

        def close(self):
            pass

    class Fake(WhatsAppMetaProvider):
        def open(self):
            super().open()
            self._session.mount("https://", FakeMeta())

    tok = context.set_platform(True)
    staff = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    TENANT, CODE = str(staff.tenant_id), staff.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(staff))}

    def api(method, path, body=None):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **H)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **H)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    real_enabled = params.enabled
    cache.clear()
    with transaction.atomic(), mock.patch.object(logbook, "P", "default"), mock.patch.object(metrics, "P", "default"), \
            mock.patch.object(registry, "adapter_class", lambda kind: Fake if kind == "WHATSAPP_META" else registry._ADAPTERS[kind]), \
            mock.patch.object(runs, "quiet_until", return_value=None):
        registry.catalogue()                                # loads the adapters before adapter_class is asked for one

        # ------------------------------------------------------------ the number
        off = api("post", "/api/v1/delivery-providers/", {"provider_type": "WHATSAPP_META", "name": "City HT WhatsApp", "config": {"waba_id": WABA, "phone_number_id": NUMBER_ID},
                                                          "secret": TOKEN, "transactional_secret": APP_SECRET})
        listed_off = [i["provider_type"] for i in api("get", "/api/v1/delivery-providers/catalogue/").json()]
        check("a workspace without WhatsApp switched on is not offered the engine and cannot add one", off.status_code == 400 and "WHATSAPP_META" not in listed_off, off.content[:200])
        with mock.patch.object(params, "enabled", lambda tid, feature: True if feature == "whatsapp" else real_enabled(tid, feature)):
            run_scenario(check, api, sql, meta, TENANT)
    check.done()


def run_scenario(check, api, sql, meta, TENANT):
    r = api("post", "/api/v1/delivery-providers/", {"provider_type": "WHATSAPP_META", "name": "City HT WhatsApp", "config": {"waba_id": WABA, "phone_number_id": NUMBER_ID},
                                                    "secret": TOKEN, "transactional_secret": APP_SECRET})
    engine_row = r.json()
    check("the WhatsApp engine is added with the token and the app secret stored, and its callback address shown", r.status_code == 201 and engine_row["channel"] == "WHATSAPP"
          and engine_row["has_secret"] and engine_row["has_transactional_secret"] and engine_row["webhook_url"], r.content[:200])
    hook = urlsplit(engine_row["webhook_url"]).path
    token = hook.rstrip("/").rsplit("/", 1)[-1]
    checked = api("post", f"/api/v1/delivery-providers/{engine_row['id']}/check/").json()
    check("the check reads the number from Meta: display number, name, quality and daily limit", checked["ok"] and "City HT" in checked["detail"] and "1,000 people a day" in checked["detail"]
          and checked["config"]["wa_limit"] == 1000, str(checked))
    shake = api("get", f"{hook}?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=4711")
    wrong = api("get", f"{hook}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4711")
    check("Meta's handshake on the callback address answers the challenge for the address's own token only", shake.status_code == 200 and shake.content == b"4711"
          and wrong.status_code == 404, f"{shake.status_code} {wrong.status_code}")
    bad_sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": engine_row["id"], "display_name": "City HT", "sender_id": "CITYHT"})
    sender = api("post", "/api/v1/delivery-senders/", {"delivery_provider": engine_row["id"], "display_name": "City HT", "sender_id": "+65 6812 4400"}).json()
    verified = api("post", f"/api/v1/delivery-senders/{sender['id']}/verify/", {}).json()
    check("a WhatsApp sender is the number with country code, verified by Meta's answer about the engine's number", bad_sender.status_code == 400
          and sender["sender_id"] == "+6568124400" and sender["channel"] == "WHATSAPP" and verified["verification_status"] == "VERIFIED", str(verified))

    # ------------------------------------------------------------ the template
    sql("""INSERT INTO personalization_tag (tenant_id, tag_key, label, tag_kind, source_system, resolution_source, source_path, data_type, applies_to_channels, sample_value)
           VALUES (%s, 'zw_store', 'ZW Store', 'CUSTOM', 'CEP', 'CAMPAIGN_LIST_MEMBER', 'custom_value_pairs.zw_store', 'STRING', ARRAY['SMS', 'WHATSAPP'], 'Harbour Mall')""", [TENANT])
    template = api("post", "/api/v1/templates/", {"name": "ZW Weekend Offer", "channel": "WHATSAPP"}).json()
    tid = template["id"]
    base = {"engine": engine_row["id"], "meta_name": "zw_weekend_offer", "language": "en", "category": "MARKETING", "header_type": "TEXT", "header_text": "This Weekend",
            "body": "Hi {{first_name}}, this weekend only: 20% off at {{zw_store}}. Show this message at the till.", "footer_text": "Reply STOP to opt out",
            "buttons": [{"type": "URL", "text": "Find a Store", "url": "https://cityht.example/stores"}, {"type": "QUICK_REPLY", "text": "Stop Offers"}],
            "samples": {"first_name": "Mei Ling", "zw_store": "Harbour Mall"}, "fallbacks": {"zw_store": "any City HT store"}, "base_version": 0}
    refused = {
        "name": api("post", f"/api/v1/templates/{tid}/whatsapp/", {**base, "meta_name": "Weekend Offer"}),
        "end": api("post", f"/api/v1/templates/{tid}/whatsapp/", {**base, "body": "Your store is {{zw_store}}"}),
        "side": api("post", f"/api/v1/templates/{tid}/whatsapp/", {**base, "body": "Hi {{first_name}} {{zw_store}} is open today."}),
        "sample": api("post", f"/api/v1/templates/{tid}/whatsapp/", {**base, "samples": {"first_name": "Mei Ling"}}),
        "button": api("post", f"/api/v1/templates/{tid}/whatsapp/", {**base, "buttons": [{"type": "URL", "text": "Go", "url": "http://plain.example"}]}),
    }
    check("Meta's rules are checked before submitting: its name form, no tag at the start or end, no two tags side by side, a sample per tag, https links",
          all(r.status_code == 400 for r in refused.values()) and "meta_name" in refused["name"].json()["errors"] and "starts or ends" in refused["end"].json()["errors"]["body"]
          and "side by side" in refused["side"].json()["errors"]["body"] and "samples" in refused["sample"].json()["errors"] and "buttons" in refused["button"].json()["errors"],
          str({k: v.json().get("errors") for k, v in refused.items()})[:400])
    saved = api("post", f"/api/v1/templates/{tid}/whatsapp/", base)
    s = saved.json()
    check("saved: Meta's form of the body with numbered variables, each with its tag, sample and fallback; still a draft",
          saved.status_code == 201 and s["meta_body"] == "Hi {{1}}, this weekend only: 20% off at {{2}}. Show this message at the till."
          and s["variables"] == [{"tag": "first_name", "sample": "Mei Ling", "fallback": ""}, {"tag": "zw_store", "sample": "Harbour Mall", "fallback": "any City HT store"}]
          and s["meta_status"] == "DRAFT" and s["editable"] and s["version_number"] == 1, saved.content[:300])
    early = api("post", f"/api/v1/templates/{tid}/activate/")
    check("a template Meta has not approved cannot be activated", early.status_code == 400 and "Submit it to Meta" in json.dumps(early.json()), early.content[:200])
    submitted = api("post", f"/api/v1/templates/{tid}/whatsapp/submit/").json()
    sent_def = meta["submitted"][-1]
    check("submitted: Meta gets the name, language, category, the header, the body with an example per number, the footer and the buttons; the template waits in review",
          submitted["meta_status"] == "PENDING" and submitted["meta_template_id"] == "9001" and not submitted["editable"]
          and sent_def["name"] == "zw_weekend_offer" and sent_def["components"][0] == {"type": "HEADER", "format": "TEXT", "text": "This Weekend"}
          and sent_def["components"][1]["example"] == {"body_text": [["Mei Ling", "Harbour Mall"]]}
          and sent_def["components"][3]["buttons"][1] == {"type": "QUICK_REPLY", "text": "Stop Offers"}, json.dumps(sent_def)[:400])
    locked = api("post", f"/api/v1/templates/{tid}/whatsapp/", {**base, "base_version": 1})
    check("a template in review cannot change: Meta sends exactly what it reviewed", locked.status_code == 409 and "Copy it" in locked.content.decode(), locked.content[:200])

    raw, signature = signed(callback("message_template_status_update", {"event": "APPROVED", "message_template_id": 9001, "message_template_name": "zw_weekend_offer",
                                                                         "message_template_language": "en", "reason": "NONE"}))
    forged = c_post(api, hook, raw, "sha256=" + "0" * 64)
    approved = c_post(api, hook, raw, signature)
    after = api("get", f"/api/v1/templates/{tid}/").json()
    check("Meta's approval arrives signed by the app secret (a forged one is refused) and makes the template usable",
          forged.status_code == 401 and approved.status_code == 200 and approved.json()["applied"] == 1 and after["status"] == "ACTIVE"
          and after["whatsapp"]["meta_status"] == "APPROVED", f"{forged.status_code} {approved.content[:200]} {after.get('status')}")

    # ------------------------------------------------------------ the audience and the send
    people = [("ZW-P01", "Mei", "+6591234471", "OPTED_IN", {"zw_store": "Harbour Mall"}), ("ZW-P02", "Arif", "+60124481902", "OPTED_IN", {}),
              ("ZW-P03", "Grace", "+639175520000", "OPTED_IN", {}), ("ZW-P04", "Daniel", "+6584561180", "OPTED_OUT", {}),
              ("ZW-P05", "Ed", "+6584561181", None, {}), ("ZW-P06", "Fay", "+6584561182", "OPTED_IN", {})]
    list_id = sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count) VALUES (%s, 'ZW list', 'UPLOAD', 'PRODUCTION', 6) RETURNING id", [TENANT], True)[0][0]
    for party, name, phone, consent, extra in people:
        sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb)",
            [party, TENANT, name, json.dumps([{"number": phone, "type": "MOBILE", "is_primary": True}])])
        sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, custom_attributes) VALUES (%s, %s, %s, %s::jsonb)", [list_id, TENANT, party, json.dumps(extra)])
        sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'SMS', 'OPTED_IN', TRUE, now())", [TENANT, party])
        if consent:
            sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'WHATSAPP', %s, %s, now())",
                [TENANT, party, consent, consent == "OPTED_IN"])
    sql("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, blocked, block_reason, block_source, blocked_at)
           VALUES (%s, 'PHONE', '+6584561182', 'ZW-P06', TRUE, 'MANUAL', 'SMS_STOP', now())""", [TENANT])
    campaign = api("post", "/api/v1/campaigns/", {"name": "ZW Weekend Offer", "campaign_type": "REGULAR_MARKETING", "channel": "WHATSAPP", "template": tid,
                                                  "sender_profile": sender["id"], "contact_lists": [str(list_id)]})
    cid = campaign.json()["id"]
    with mock.patch("api.v1.views._enqueue_run"):
        published = api("post", f"/api/v1/campaigns/{cid}/publish/")
    check("a WhatsApp campaign with an approved template publishes", campaign.status_code == 201 and published.status_code == 201, f"{campaign.content[:200]} {published.content[:300]}")
    engine.process_run(TENANT, published.json()["id"])
    rows = {party: (status, reason, kind, text) for party, status, reason, kind, text in sql(
        """SELECT m.party_id, COALESCE(x.status, m.suppression_reason), x.status_reason, x.message_type, x.rendered_text
             FROM campaign_list_member m LEFT JOIN sms_execution x ON x.campaign_list_member_id = m.id AND x.tenant_id = m.tenant_id
            WHERE m.tenant_id = %s AND m.campaign_list_id = (SELECT id FROM campaign_list WHERE campaign_run_id = %s)""", [TENANT, published.json()["id"]], True)}
    check("WhatsApp consent decides: opted in is sent, opted out of WhatsApp is left out, consent to texts alone is not enough, a text STOP does not stop WhatsApp",
          rows["ZW-P01"][0] == "SUBMITTED" and rows["ZW-P04"][0] == "UNSUBSCRIBED" and rows["ZW-P05"][0] == "NO_CONSENT" and rows["ZW-P06"][0] == "SUBMITTED"
          and rows["ZW-P01"][2] == "WHATSAPP", json.dumps(rows))
    check("each person's values fill the template: their own tag value, the template's fallback when it is empty; the record is the words they got",
          rows["ZW-P01"][3] == "Hi Mei, this weekend only: 20% off at Harbour Mall. Show this message at the till."
          and rows["ZW-P02"][3] == "Hi Arif, this weekend only: 20% off at any City HT store. Show this message at the till.", json.dumps(rows))
    check("a number Meta cannot deliver to fails with Meta's reason", rows["ZW-P03"][0] == "FAILED" and "131026" in (rows["ZW-P03"][1] or ""), str(rows["ZW-P03"]))
    to_mei = next(b for b in meta["sent"] if b["to"] == "6591234471")
    check("Meta is sent the approved template by name with the values, never the words", to_mei["template"]["name"] == "zw_weekend_offer"
          and to_mei["template"]["components"] == [{"type": "body", "parameters": [{"type": "text", "text": "Mei"}, {"type": "text", "text": "Harbour Mall"}]}], json.dumps(to_mei))

    # ------------------------------------------------------------ what comes back
    raw, signature = signed(callback("messages", {"metadata": {"display_phone_number": "6568124400"}, "statuses": [
        {"id": "wamid.6591234471", "status": "delivered", "timestamp": "1762300005", "recipient_id": "6591234471"},
        {"id": "wamid.6591234471", "status": "read", "timestamp": "1762300100", "recipient_id": "6591234471"},
        {"id": "wamid.6584561182", "status": "failed", "timestamp": "1762300006", "recipient_id": "6584561182", "errors": [{"code": 131049, "title": "ecosystem"}]}]}))
    back = c_post(api, hook, raw, signature)
    again = c_post(api, hook, raw, signature)
    raw, signature = signed(callback("messages", {"metadata": {"display_phone_number": "6568124400"},          # Meta sends what people send in a callback of its own
        "messages": [{"from": "6591234471", "id": "wamid.IN1", "timestamp": "1762300200", "type": "button", "button": {"text": "Stop Offers", "payload": "Stop Offers"}}]}))
    tapped = c_post(api, hook, raw, signature)
    state = {party: (status, read) for party, status, read in sql("""SELECT party_id, status, read_at IS NOT NULL FROM sms_execution WHERE tenant_id = %s AND campaign_id = %s""", [TENANT, cid], True)}
    consent = dict(sql("SELECT channel, consent_status FROM consent_suppression WHERE tenant_id = %s AND party_id = 'ZW-P01'", [TENANT], True))
    blocked = sql("SELECT count(*) FROM contact_point_status WHERE tenant_id = %s AND contact_value = '+6591234471' AND blocked", [TENANT], True)[0][0]
    check("Meta's callbacks: delivered, then read; a failure with Meta's reason; the same callback twice is applied once",
          back.status_code == 200 and back.json()["applied"] == 3 and again.json()["duplicate"] == 3 and state["ZW-P01"][1] is True and state["ZW-P06"][0] == "FAILED", f"{back.content[:200]} {state}")
    check("a Stop Offers tap opts the person out of WhatsApp only: texts keep their consent and the number is not blocked",
          tapped.json().get("inbound") == 1 and state["ZW-P01"][0] == "OPTED_OUT" and consent == {"SMS": "OPTED_IN", "WHATSAPP": "OPTED_OUT"} and blocked == 0, f"{state['ZW-P01']} {consent} {blocked}")
    figures = api("get", f"/api/v1/campaigns/{cid}/metrics/").json()["counts"]
    check("the campaign's figures count WhatsApp reads as opens, the STOP as an opt-out, and a message Meta reported as failed as failed",
          figures["opened"] == 1 and figures["failed"] == 2 and figures["sent"] == 2 and figures["unsubscribed"] == 1, str(figures))

    # ------------------------------------------------------------ copy and Sync
    copy = api("post", f"/api/v1/templates/{tid}/clone/", {})
    copied = api("get", f"/api/v1/templates/{copy.json()['id']}/whatsapp/").json()
    check("a copy of an approved template is a draft under a name of its own, to be reviewed again", copy.status_code == 201 and copied["meta_name"] == "zw_weekend_offer_v2"
          and copied["meta_status"] == "DRAFT" and copied["editable"] and copied["body"].startswith("Hi {{first_name}}"), json.dumps(copied)[:300])
    meta["templates"] = [{"id": "9001", "name": "zw_weekend_offer", "language": "en", "status": "PAUSED", "category": "MARKETING", "quality_score": {"score": "RED"}},
                         {"id": "9002", "name": "zw_points_balance", "language": "en", "status": "APPROVED", "category": "UTILITY",
                          "components": [{"type": "BODY", "text": "Hi {{1}}, you have {{2}} points.", "example": {"body_text": [["Mei", "1,200"]]}}]}]
    synced = api("post", "/api/v1/templates/whatsapp-sync/", {"engine": engine_row["id"]}).json()
    listed = {t["whatsapp"]["meta_name"]: t for t in api("get", "/api/v1/templates/?channel=WHATSAPP").json()["results"]}
    check("Sync: a known template takes Meta's status and quality, one made in WhatsApp Manager appears with its samples and no tags yet",
          synced == {"found": 2, "added": 1, "updated": 1} and listed["zw_weekend_offer"]["whatsapp"]["meta_status"] == "PAUSED"
          and listed["zw_weekend_offer"]["whatsapp"]["meta_quality"] == "RED" and listed["zw_points_balance"]["whatsapp"]["origin"] == "META", str(synced))
    points = listed["zw_points_balance"]["id"]
    unmapped = api("post", f"/api/v1/templates/{points}/activate/")
    mapped = api("post", f"/api/v1/templates/{points}/whatsapp/", {"variable_tags": ["first_name", "zw_store"], "fallbacks": {"2": "0"}})
    usable = api("post", f"/api/v1/templates/{points}/activate/")
    check("a synced template is usable once each of its numbers has a tag; its words stay Meta's", unmapped.status_code == 400 and mapped.status_code == 201
          and mapped.json()["body"] == "Hi {{first_name}}, you have {{zw_store}} points." and mapped.json()["meta_body"] == "Hi {{1}}, you have {{2}} points."
          and usable.status_code == 200 and usable.json()["status"] == "ACTIVE", f"{unmapped.status_code} {mapped.content[:200]} {usable.status_code}")


def c_post(api, path, raw: bytes, signature: str):
    """A callback from Meta: the raw body with its signature header, no sign-in."""
    client = Client()
    return client.post(path, raw, content_type="application/json", HTTP_X_HUB_SIGNATURE_256=signature)
