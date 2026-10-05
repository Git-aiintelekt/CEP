"""The point of sale posts a TTDR transaction and an e-receipt goes out: the endpoint, its XML answers, the tags, the stores, the trail. Rolled back;
Postal is a fake.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from django.conf import settings
import hashlib
import json
import secrets
from pathlib import Path
from unittest import mock
import requests
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns.models import Campaign
from apps.identity.models import ApiClient, AppUser
from apps.integrations.bridge import logbook
from apps.pos import mapping, ttdr
from apps.pos.models import Store
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_pos(check, admin_email):
    """The point of sale posts a TTDR transaction and an e-receipt goes out: the endpoint, its XML answers, the tags, the stores, the trail. Rolled back;"""
    class PacedClient(Client):
        def post(self, *args, **kwargs):
            import time
            time.sleep(0.4)
            return super().post(*args, **kwargs)
    SAMPLE = (Path(settings.BASE_DIR) / "apps" / "pos" / "schemas" / "sample-transaction.xml").read_bytes()
    sent = []

    class Roll(Exception):
        pass

    class FakeAnswer:
        status_code = 200

        def __init__(self, body):
            self._body = body

        def json(self):
            return self._body

    def postal_post(self, url, json=None, **kwargs):
        sent.append({"url": url, "body": json})
        return FakeAnswer({"status": "success", "data": {"message_id": f"m-{len(sent)}@postal.example", "messages": {(json or {}).get("to", [""])[0]: {"id": 9000 + len(sent)}}}})

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    tok = context.set_current(str(tenant.id), "default", str(user.pk))
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"), mock.patch.object(logbook, "P", "default"), mock.patch.object(requests.Session, "post", postal_post):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
                cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
            # ---- the reader
            read = ttdr.parse(SAMPLE)
            check("the sample reads: cents to dollars, hundredths to units, six items, a masked debit tender, the barcode", read["totals"]["grand_total"] == 83.73 and len(read["items"]) == 6
                  and read["items"][0]["quantity"] == 1.0 and read["items"][0]["unit_price"] == 14.99 and read["transaction"]["items_sold"] == 6.0 and read["tenders"][0]["last4"] == "3425"
                  and "X" in read["tenders"][0]["account"] and read["transaction"]["barcode_value"] == "0080101243309092326")
            try:
                ttdr.parse(b"<Transaction/>"); bad = None
            except ttdr.TtdrError as exc:
                bad = exc.code
            try:
                ttdr.parse(SAMPLE.replace(b"TTDRV322", b"Anand")); wrong = None
            except ttdr.TtdrError as exc:
                wrong = (exc.code, str(exc))
            check("a wrong root and a schema violation are refused with a code and the reason", bad == "E103" and wrong and wrong[0] == "E103" and "TTDRVersion" in wrong[1], f"{bad} {wrong}")
            receipt = mapping.receipt_of(read)
            check("the receipt dictionary the layout renders: number, totals, items, tender words, item count", receipt["number"] == "243309" and receipt["grand_total"] == 83.73
                  and receipt["tender_summary"] == "Debit ···3425" and receipt["item_count"] == 6.0 and len(receipt["items"]) == 6, str({k: receipt[k] for k in ("number", "tender_summary", "item_count")}))

            # ---- a POS API key, the stores, the settings
            raw_key = "cep_in_POSKEY" + secrets.token_urlsafe(24).replace("-", "").replace("_", "")
            ApiClient.objects.create(tenant_id=tenant.id, name="POS test key", client_type="INTEGRATION", key_prefix=raw_key[:13], key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
                                     scopes=["receipts:send"], created_by_id=user.pk)
            from apps.delivery.models import DeliveryProvider
            from apps.platform_ops import crypto
            DeliveryProvider.objects.filter(tenant_id=tenant.id, provider_type="POSTAL").update(secret_enc=crypto.encrypt("test-key"), secret_ref=None)   # the seed engine has no credential
            made = API.post("/api/v1/stores/", {"store_number": "801", "name": "Northwind Apparel Buckhead", "brand": "Northwind Apparel", "address1": "1200 Peachtree St NE", "city": "Atlanta", "state": "GA",
                                                "postal_code": "30309", "country": "US", "phone": "(404) 555-0100", "manager": "Dana Reyes", "return_policy": "Returns within 30 days with this receipt."}, content_type="application/json")
            twice = API.post("/api/v1/stores/", {"store_number": "801", "name": "Again"}, content_type="application/json")
            check("a store is listed by number; the same number twice is refused", made.status_code == 201 and twice.status_code == 400 and "already listed" in str(twice.json()), f"{made.status_code} {twice.status_code}")
            csv_text = "store_number,name,city,state,phone\n802,Northwind Apparel Midtown,Atlanta,GA,(404) 555-0101\n801,Northwind Apparel Buckhead,Atlanta,GA,(404) 555-0100\n,No number\n"
            from django.core.files.uploadedfile import SimpleUploadedFile
            imported = API.post("/api/v1/stores/import/", {"file": SimpleUploadedFile("stores.csv", csv_text.encode("utf-8"), content_type="text/csv")})
            check("a CSV adds new stores and updates listed ones; a line without a number is reported", imported.status_code == 200 and imported.json()["added"] == 1 and imported.json()["updated"] == 1
                  and imported.json()["problems"] and Store.objects.filter(tenant_id=tenant.id).count() == 2, str(imported.json())[:140])
            settings_page = API.get("/api/v1/workspace/pos/").json()
            check("the POS settings say the endpoint, the tenant key, the header names, the scope and list the e-receipt campaigns",
                  settings_page["endpoint"].endswith("/api/v1/pos/transactions/") and settings_page["tenant_key"] == "NWA" and settings_page["headers"] == ["X-Tenant-Key", "accessTokenKey"]
                  and settings_page["scope"] == "receipts:send" and any(c["ready"] for c in settings_page["campaigns"]) and settings_page["stores"] == 2, str(settings_page)[:160])
            live = next(c for c in settings_page["campaigns"] if c["ready"])
            API.put("/api/v1/workspace/pos/", {"campaign": live["id"]}, content_type="application/json")
            tenant = Tenant.objects.get(pk=tenant.id)
            check("the campaign choice is saved", mapping.settings_of(tenant)["campaign"] == live["id"])

            # ---- the endpoint, as the point of sale calls it. The vendored sample asks for EMAIL; the user's original asked for PRINT
            POS = PacedClient()                                   # the workspace inbound throttle allows a few calls a second: pace the posts
            PRINTED = SAMPLE.replace(b"<EntryType>EMAIL</EntryType>", b"<EntryType>PRINT</EntryType>").replace(b"243309", b"243300")
            printed = POS.post("/api/v1/pos/transactions/", data=PRINTED, content_type="application/xml", HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("S104: EntryType PRINT is accepted and sends nothing", printed.status_code == 200 and "S104" in printed.content.decode() and len(sent) == 0, printed.content.decode()[-160:])
            texted = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"<EntryType>EMAIL</EntryType>", b"<EntryType>SMS</EntryType>").replace(b"243309", b"243301"), content_type="application/xml",
                              HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("S105: EntryType SMS is accepted (the schema is told about it) and sends nothing yet", texted.status_code == 200 and "S105" in texted.content.decode() and len(sent) == 0, texted.content.decode()[-160:])
            both = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"<EntryType>EMAIL</EntryType>", b"<EntryType>BOTH</EntryType>").replace(b"243309", b"243302"), content_type="application/xml",
                            HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("BOTH (print and email) sends the e-receipt", both.status_code == 200 and "S100" in both.content.decode() and len(sent) == 1)
            sent.clear()
            answer = POS.post("/api/v1/pos/transactions/", data=SAMPLE, content_type="application/xml", HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            body = answer.content.decode()
            check("S100: the receipt went out through Postal, the answer is the XML the point of sale expects",
                  answer.status_code == 200 and "<RESPONSE_CODE>S100</RESPONSE_CODE>" in body and "<ORI_ORDER_ID>243309</ORI_ORDER_ID>" in body and "<MESSAGE_ID>" in body and len(sent) == 1
                  and sent[0]["body"]["to"] == ["someone@example.com"], f"{answer.status_code} {body[-300:]} sent={len(sent)}")
            html = sent[0]["body"].get("html_body", "")
            check("the receipt is rendered from the transaction (the recipient's name from the XML) and carries the receipt tag as the Postal tag",
                  "Guest" in html and sent[0]["body"].get("subject") and "243309" in (sent[0]["body"].get("tag") or "") and '"u":"receipt"' in (sent[0]["body"].get("tag") or ""), f"{html[:80]!r} tag={sent[0]['body'].get('tag')}")
            again = POS.post("/api/v1/pos/transactions/", data=SAMPLE, content_type="application/xml", HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("S102: the same transaction again sends nothing", again.status_code == 200 and "S102" in again.content.decode() and len(sent) == 1)
            form = POS.post("/api/v1/pos/transactions/", data={"XmlInput": SAMPLE.decode("utf-8").replace("243309", "243310")}, HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("the XML may also come as the form field XmlInput", form.status_code == 200 and "S100" in form.content.decode() and "243310" in form.content.decode() and len(sent) == 2, form.content.decode()[:160])
            bearer = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"243309", b"243311"), content_type="text/xml", HTTP_X_TENANT="NWA", HTTP_AUTHORIZATION=f"Bearer {raw_key}")
            check("… or with the key as a Bearer token and X-Tenant", bearer.status_code == 200 and "S100" in bearer.content.decode())
            no_email = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"<EmailAddress>someone@example.com</EmailAddress>", b"").replace(b"243309", b"243312"), content_type="application/xml",
                                HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("S101: no email address on the recipient, nothing sent", no_email.status_code == 200 and "S101" in no_email.content.decode() and len(sent) == 3)
            wrong_key = POS.post("/api/v1/pos/transactions/", data=SAMPLE, content_type="application/xml", HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY="cep_in_nonsense")
            check("E888: a wrong key gets an XML refusal, not JSON", wrong_key.status_code == 401 and "E888" in wrong_key.content.decode() and wrong_key["Content-Type"].startswith("application/xml"))
            invalid = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"TTDRV322", b"Anand"), content_type="application/xml", HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("E103: a document that breaks the schema is refused with the reason", invalid.status_code == 400 and "E103" in invalid.content.decode() and "TTDRVersion" in invalid.content.decode())
            empty = POS.post("/api/v1/pos/transactions/", data=b"", content_type="application/xml", HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("E101: an empty body", empty.status_code == 400 and "E101" in empty.content.decode())

            # ---- returns and exchanges read as refunds
            returned = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"SaleTransaction", b"ReturnTransaction").replace(b"243309", b"243320"), content_type="application/xml",
                                HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
            check("a ReturnTransaction is sent as a refund receipt", returned.status_code == 200 and "S100" in returned.content.decode() and "243320" in (sent[-1]["body"].get("tag") or ""))
            r2 = mapping.receipt_of(ttdr.parse(SAMPLE.replace(b"SaleTransaction", b"ReturnTransaction")))
            check("… every amount negative, the tender 'Refund to …'", r2["grand_total"] == -83.73 and r2["items"][0]["quantity"] == -1.0 and r2["tender_summary"].startswith("Refund to debit") and r2["refund"])
            r3 = mapping.receipt_of(ttdr.parse(SAMPLE.replace(b"SaleTransaction", b"ExchangeTransaction").replace(b"<ItemReceivedType>Pickedup</ItemReceivedType>", b"<ItemReceivedType>Return</ItemReceivedType>", 1)))
            check("an exchange shows only the returned line as a negative", r3["kind"] == "Exchange" and r3["items"][0]["returned"] and r3["items"][0]["total"] < 0 and not r3["items"][1]["returned"] and r3["items"][1]["total"] > 0)

            # ---- text receipts: an e-receipt campaign on the SMS channel, the Digivize engine faked
            from unittest import mock as _mock
            from apps.delivery.models import SenderProfile
            from apps.delivery.providers import SendResult
            from apps.delivery.providers.digivize import DigivizeProvider
            from apps.templates.models import RenderedTemplateContent, TemplateMaster
            texts = []
            def fake_text(self, message):
                texts.append(message)
                return SendResult.accepted(f"dz-{len(texts)}")
            sms_template = TemplateMaster.objects.filter(tenant_id=tenant.id, channel="SMS", deleted_at__isnull=True).first()
            sms_content = RenderedTemplateContent.objects.filter(template_id=sms_template.pk).order_by("-version_number").first() if sms_template else None
            sms_sender = SenderProfile.objects.filter(tenant_id=tenant.id, channel="SMS", deleted_at__isnull=True, verification_status="VERIFIED").first()
            if sms_template and sms_content and sms_sender:
                DeliveryProvider.objects.filter(pk=sms_sender.delivery_provider_id).update(secret_enc=crypto.encrypt("test-key"), secret_ref=None, is_active=True)
                text_campaign = Campaign.objects.create(tenant_id=tenant.id, name="Text receipt (test)", code="CMP-TEXT-RECEIPT", campaign_type="E_RECEIPT", channel="SMS", solicitation_type="TRANSACTIONAL",
                                                        status="ACTIVE", template=sms_template, sender_profile=sms_sender, send_type="IMMEDIATE", created_by_id=user.pk)
                chosen = API.put("/api/v1/workspace/pos/", {"text_campaign": str(text_campaign.pk)}, content_type="application/json")
                check("the text campaign is chosen; an email campaign is refused for it", chosen.status_code == 200 and chosen.json()["text_campaign"] == str(text_campaign.pk)
                      and API.put("/api/v1/workspace/pos/", {"text_campaign": live["id"]}, content_type="application/json").status_code == 400)
                with _mock.patch.object(DigivizeProvider, "send", fake_text):
                    only_text = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"<EntryType>EMAIL</EntryType>", b"<EntryType>SMS</EntryType>").replace(b"243309", b"243330"), content_type="application/xml",
                                         HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
                    body_text = only_text.content.decode()
                    check("S103: EntryType SMS sends a text receipt to the recipient's number, +1 added", only_text.status_code == 200 and "S103" in body_text and "<TEXT_MESSAGE_ID>dz-1</TEXT_MESSAGE_ID>" in body_text
                          and len(texts) == 1 and texts[0].to_number == "+14249440599" and texts[0].text.strip(), body_text[-220:])
                    with connections["default"].cursor() as cursor:
                        cursor.execute("SELECT status, phone_number, rendered_text, segment_count FROM sms_execution WHERE tenant_id = %s AND campaign_id = %s ORDER BY id DESC LIMIT 1", [str(tenant.id), str(text_campaign.pk)])
                        row = cursor.fetchone()
                    check("… recorded as an sms_execution (status, number, the text, its parts)", row and row[0] == "SUBMITTED" and row[1] == "+14249440599" and row[2] and row[3] >= 1, str(row)[:120])
                    again_text = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"<EntryType>EMAIL</EntryType>", b"<EntryType>SMS</EntryType>").replace(b"243309", b"243330"), content_type="application/xml",
                                          HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
                    check("… not twice", "S102" in again_text.content.decode() and len(texts) == 1)
                    both_ways = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"<EntryType>EMAIL</EntryType>", b"<EntryType>EMAIL_SMS</EntryType>").replace(b"243309", b"243331"), content_type="application/xml",
                                         HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
                    bw = both_ways.content.decode()
                    check("EMAIL_SMS sends both: S100 with the text's outcome in the answer", both_ways.status_code == 200 and "S100" in bw and "<TEXT_STATUS>SENT</TEXT_STATUS>" in bw and len(texts) == 2 and len(sent) >= 2, bw[-260:])
                    no_number = POS.post("/api/v1/pos/transactions/", data=SAMPLE.replace(b"<EntryType>EMAIL</EntryType>", b"<EntryType>SMS</EntryType>").replace(b"<PhoneNumber>4249440599</PhoneNumber>", b"<PhoneNumber>12</PhoneNumber>").replace(b"243309", b"243332"),
                                         content_type="application/xml", HTTP_X_TENANT_KEY="NWA", HTTP_ACCESSTOKENKEY=raw_key)
                    check("S105: a text asked for without a usable number", no_number.status_code == 200 and "S105" in no_number.content.decode() and "no mobile number" in no_number.content.decode())
            else:
                print("skip: NWA has no SMS template, content or verified text sender to build a text receipt campaign with")

            # ---- the trail
            trail = API.get("/api/v1/workspace/pos/received/").json()
            codes = [row["code"] for row in trail["results"]]
            check("what was received is listed from the integration log with the code, the transaction id and the receipt's execution",
                  "S100" in codes and "S102" in codes and "S101" in codes and "S104" in codes and "S105" in codes and "E103" in codes and any(r["transaction_id"] == "243309" and r["execution_id"] for r in trail["results"]), str(codes))
            only = API.get("/api/v1/workspace/pos/received/", {"code": "S100"}).json()
            check("… filtered by code, searched by transaction id", all(r["code"] == "S100" for r in only["results"]) and API.get("/api/v1/workspace/pos/received/", {"q": "243310"}).json()["results"][0]["transaction_id"] == "243310")
            raise Roll
    except Roll:
        pass
    finally:
        context.reset(tok)
    check.done()
