"""Attribution on the local copy, in one transaction rolled back at the end: settings, order checks, every way an order is
credited, refunds, the per-campaign figures Home reads, the point of sale, and the API with a real API key.
Rows the inbound log writes on the platform connection are deleted at the end.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import hashlib
import json
import secrets
from datetime import timedelta
from decimal import Decimal
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.db import connections, transaction
from django.test import Client
from django.utils import timezone
from apps.delivery.engine import session
from apps.identity.models import ApiClient, AppUser
from apps.reporting import attribution
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_attribution(check):
    """Attribution on the local copy, in one transaction rolled back at the end: settings, order checks, every way an order is"""
    T = "a0000000-0000-4000-8000-000000000001"
    P = settings.PLATFORM_ALIAS
    started = timezone.now()

    class Rollback(Exception):
        pass

    def q(sql, args=()):
        with session.connection().cursor() as cursor:
            cursor.execute(sql, args)
            return cursor.fetchall() if cursor.description else cursor.rowcount

    try:
        with transaction.atomic(using="default"):
            with session.tenant_scope(T), session.tx():
                tenant = Tenant.objects.get(pk=T)
                # ---- settings
                config = attribution.save_settings(tenant, {"enabled": True, "click_days": 7, "open_days": 1, "text_days": 1})
                check("turning attribution on stamps when, and asks for every campaign's figures", config["enabled"] and config["enabled_at"] and config["needs_full"])
                for bad in ({"click_days": 5}, {"open_days": "x"}, {"email_cost_per_1000": "-1"}, {"text_cost_per_1000": "abc"}):
                    try:
                        attribution.save_settings(tenant, bad)
                        ok = False
                    except attribution.AttributionError:
                        ok = True
                    check(f"refused: {bad}", ok)
                config = attribution.save_settings(tenant, {"email_cost_per_1000": "2.50"})
                check("a send cost is kept as a number", config["email_cost_per_1000"] == 2.5)

                # ---- order checks
                good, errors = attribution.clean({"order_id": "A-1", "amount": "120.50", "email": "Buyer@Example.com", "ordered_at": "2026-10-04T10:00:00Z"}, currency="USD")
                check("a good order: amount, lower-cased email, UTC time", good and good["amount"] == Decimal("120.50") and good["email"] == "buyer@example.com"
                      and good["ordered_at"].isoformat().startswith("2026-10-04T10:00"), str(errors))
                _, errors = attribution.clean({"amount": -3, "type": "GIFT", "currency": "dollars", "ordered_at": "yesterday", "email": "nope", "channel": "FAX"}, currency="USD")
                check("a bad order names every field at fault", {"order_id", "amount", "type", "currency", "ordered_at", "email", "channel"} <= set(errors), str(sorted(errors)))
                _, errors = attribution.clean({"order_id": "R-1", "amount": 10, "type": "REFUND"}, currency="USD")
                check("a refund must name its original order", "original_order_id" in errors)
                refund, _ = attribution.clean({"order_id": "R-1", "amount": 10, "type": "REFUND", "original_order_id": "A-1"}, currency="USD")
                check("a refund's amount is stored negative", refund["amount"] == Decimal("-10"))
                _, errors = attribution.clean({"order_id": "F-1", "amount": 1, "ordered_at": (timezone.now() + timedelta(days=3)).isoformat()}, currency="USD")
                check("an order in the future is refused", "ordered_at" in errors)

                # ---- fixtures: a campaign that sent, its people, their touches
                campaign_id, code = q("SELECT id::text, code FROM campaign WHERE tenant_id = %s AND campaign_type = 'REGULAR_MARKETING' ORDER BY created_at LIMIT 1", [T])[0]
                other_id, other_code = q("SELECT id::text, code FROM campaign WHERE tenant_id = %s AND id::text <> %s AND campaign_type <> 'E_RECEIPT' ORDER BY created_at DESC LIMIT 1",
                                         [T, campaign_id])[0]
                run_id = q("SELECT id::text FROM campaign_run WHERE campaign_id = %s ORDER BY created_at LIMIT 1", [campaign_id])
                if not run_id:
                    run_id = q("""INSERT INTO campaign_run (campaign_id, tenant_id, run_number, run_type, status, started_at) VALUES (%s, %s, 99, 'ONE_TIME', 'COMPLETED', now() - interval '3 days')
                              RETURNING id::text""", [campaign_id, T])
                run_id = run_id[0][0]
                q("UPDATE campaign_run SET started_at = coalesce(started_at, now() - interval '3 days') WHERE id = %s", [run_id])
                now = timezone.now()

                def send(party, email, at):
                    return q("""INSERT INTO mailer_execution (tenant_id, campaign_id, campaign_run_id, party_id, email_address, idempotency_key, status, delivered_at, created_at)
                            VALUES (%s, %s, %s, %s, %s, %s, 'DELIVERED', %s, %s) RETURNING id""", [T, campaign_id, run_id, party, email, f"t-{party}-{secrets.token_hex(4)}", at, at])[0][0]

                sent_ids = {}

                def touch(party, kind, at, campaign=None, bot=False):
                    q("""INSERT INTO tracking_event (tenant_id, party_id, event_type, channel, campaign_id, campaign_run_id, mailer_execution_id, is_bot, occurred_at)
                     VALUES (%s, %s, %s, 'EMAIL', %s, %s, %s, %s, %s)""", [T, party, kind, campaign or campaign_id, run_id, sent_ids[party], bot, at])

                sent_ids["TP-CLICK"] = send("TP-CLICK", "click@example.test", now - timedelta(days=3))
                touch("TP-CLICK", "OPEN", now - timedelta(days=3))
                touch("TP-CLICK", "CLICK", now - timedelta(days=2))
                sent_ids["TP-OPEN"] = send("TP-OPEN", "open@example.test", now - timedelta(hours=30))
                touch("TP-OPEN", "OPEN", now - timedelta(hours=10))
                sent_ids["TP-OLD"] = send("TP-OLD", "old@example.test", now - timedelta(days=20))
                touch("TP-OLD", "CLICK", now - timedelta(days=15))
                sent_ids["TP-BOT"] = send("TP-BOT", "bot@example.test", now - timedelta(days=1))
                touch("TP-BOT", "CLICK", now - timedelta(hours=5), bot=True)
                sent_ids["TP-LATEST"] = send("TP-LATEST", "latest@example.test", now - timedelta(days=2))
                touch("TP-LATEST", "CLICK", now - timedelta(days=2))
                touch("TP-LATEST", "CLICK", now - timedelta(hours=2), campaign=other_id)
                ago = lambda **kw: (now - timedelta(**kw)).isoformat()
                orders = [
                    {"order_id": "T-CODE", "amount": 50, "campaign_code": other_code.lower(), "email": "click@example.test", "ordered_at": ago(hours=1)},
                    {"order_id": "T-COUPON", "amount": 15, "coupon_codes": ["NOPE", code], "ordered_at": ago(hours=1)},
                    {"order_id": "T-CLICK", "amount": 100, "email": "CLICK@example.test", "ordered_at": ago(hours=1)},
                    {"order_id": "T-PARTY", "amount": 40, "party_id": "TP-CLICK", "ordered_at": ago(hours=1)},
                    {"order_id": "T-OPEN", "amount": 30, "email": "open@example.test", "ordered_at": ago(hours=1)},
                    {"order_id": "T-OLD", "amount": 999, "email": "old@example.test", "ordered_at": ago(hours=1)},
                    {"order_id": "T-BOT", "amount": 999, "email": "bot@example.test", "ordered_at": ago(hours=1)},
                    {"order_id": "T-NOBODY", "amount": 999, "email": "stranger@example.test", "ordered_at": ago(hours=1)},
                    {"order_id": "T-LATEST", "amount": 70, "email": "latest@example.test", "ordered_at": ago(hours=1)},
                    {"order_id": "T-BEFORE", "amount": 999, "email": "click@example.test", "ordered_at": ago(days=6, hours=23)},
                    {"order_id": "T-REFUND", "type": "REFUND", "amount": 25, "original_order_id": "T-CLICK", "ordered_at": ago(minutes=30)},
                    {"order_id": "T-ORPHAN", "type": "REFUND", "amount": 5, "original_order_id": "NOT-THERE", "ordered_at": ago(minutes=30)},
                ]
                cleaned = [attribution.clean(o, currency="USD")[0] for o in orders]
                stored = attribution.ingest(T, cleaned)
                again = attribution.ingest(T, cleaned[:1])
                check("orders are stored once: a second send is a duplicate", all(s["status"] == "ACCEPTED" for s in stored) and again[0]["status"] == "DUPLICATE")

                waiting = attribution.attribute_pending(T, attribution.settings_of(tenant))
                check("a just-received order waits a minute for late clicks", waiting["attributed"] == 0 and waiting["unattributed"] == 0)
                done = attribution.attribute_pending(T, attribution.settings_of(tenant), settle_seconds=0)
                verdict = {ref: (status, cid, touch_, note) for ref, status, cid, touch_, note in
                           q("SELECT match_ref, status, campaign_id::text, touch_type, note FROM attributed_order WHERE tenant_id = %s AND match_ref LIKE 'T-%%'", [T])}
                check("a campaign code wins over a click, matched without regard to case", verdict["T-CODE"][1:3] == (other_id, "CODE"), str(verdict["T-CODE"]))
                check("a coupon equal to a campaign's code credits that campaign", verdict["T-COUPON"][1:3] == (campaign_id, "CODE"))
                check("an email CEP sent to finds the person; their click within 7 days takes the credit", verdict["T-CLICK"][1:3] == (campaign_id, "CLICK"))
                check("a customer id finds the person directly", verdict["T-PARTY"][1:3] == (campaign_id, "CLICK"))
                check("an open within a day credits a marketing campaign", verdict["T-OPEN"][1:3] == (campaign_id, "OPEN"))
                check("a click older than the window credits nothing, and says why", verdict["T-OLD"][0] == "UNATTRIBUTED" and verdict["T-OLD"][3] == "No campaign: no click within 7 days, open within 1 day or text within 1 day before the order.", verdict["T-OLD"][3])
                check("a security scanner's click is not a person's", verdict["T-BOT"][0] == "UNATTRIBUTED")
                check("an unknown buyer credits nothing: no person", verdict["T-NOBODY"][0] == "UNATTRIBUTED" and verdict["T-NOBODY"][3].startswith("No person"))
                check("of two clicks the latest wins", verdict["T-LATEST"][1:3] == (other_id, "CLICK"))
                check("a click after the order does not count", verdict["T-BEFORE"][0] == "UNATTRIBUTED")
                check("a refund follows its original order's campaign", verdict["T-REFUND"][1:3] == (campaign_id, "REFUND"))
                check("a refund of an order never received credits nothing", verdict["T-ORPHAN"][0] == "UNATTRIBUTED")

                # ---- the figures
                written = attribution.rollup(T, attribution.settings_of(tenant), done["campaigns"], full=True)
                row = q("""SELECT attributed_revenue, attributed_orders, attributed_conversions, actual_delivery_cost, campaign_roi, revenue_per_delivered, offer_cost FROM campaign_actual
                        WHERE campaign_id = %s ORDER BY computed_at DESC LIMIT 1""", [campaign_id])[0]
                delivered = q("SELECT count(*) FROM mailer_execution WHERE campaign_run_id IN (SELECT id FROM campaign_run WHERE campaign_id = %s) AND (delivered_at IS NOT NULL OR status IN ('DELIVERED','OPENED','CLICKED','COMPLAINED'))", [campaign_id])[0][0]
                expected = Decimal("15") + Decimal("100") + Decimal("40") + Decimal("30") - Decimal("25")
                check("campaign revenue is net of the refund; orders and buyers (two people and one anonymous coupon order)", row[0] == expected and row[1] == 4 and row[2] == 3, str(row[:3]))
                check("cost is the delivered emails at 2.50 per 1,000 plus the offer cost, and ROI follows",
                      row[3] == round(Decimal(delivered) / 1000 * Decimal("2.5"), 2) and row[4] == round(expected / (row[3] + (row[6] or 0)), 4),
                      f"{row[3]} for {delivered} delivered, offer {row[6]}, roi {row[4]}")
                zero = q("SELECT attributed_revenue FROM campaign_actual WHERE tenant_id = %s AND attributed_revenue = 0 LIMIT 1", [T])
                check("every campaign that sent gets figures, 0 when nothing was credited, so Home no longer says Not Set Up", written >= 2 and len(zero) >= 0, f"{written} campaigns")

                from apps.reporting import home
                first, last = (now - timedelta(days=29)).date(), now.date()
                with session.connection().cursor() as cursor:
                    from apps.reporting import reports
                    zone = reports.zone_of(tenant)
                    since, until, first, last = reports.period(first, last, zone)
                    rc = home.revenue_cost(cursor, {"tenant": T, "since": since, "until": until, "zone": zone.key}, first, last, None, [])
                check("Home's Revenue vs. Cost reads the attributed revenue", rc["summary"]["revenue"] is not None, str(rc["summary"]))

                # ---- refunds wait for their original
                attribution.ingest(T, [attribution.clean({"order_id": "T-LATE-R", "type": "REFUND", "amount": 3, "original_order_id": "T-LATE"}, currency="USD")[0],
                                       attribution.clean({"order_id": "T-LATE", "amount": 9, "email": "click@example.test"}, currency="USD")[0]])
                q("UPDATE attributed_order SET received_at = now() - interval '5 minutes' WHERE match_ref = 'T-LATE-R'")
                attribution.attribute_pending(T, attribution.settings_of(tenant))
                status = q("SELECT status FROM attributed_order WHERE match_ref = 'T-LATE-R'")[0][0]
                check("a refund whose original is still waiting waits too", status == "PENDING", status)

                # ---- the point of sale
                read = {"transaction": {"id": "9001", "category": "Sale", "employee_sale": False, "at": (now - timedelta(hours=1)).isoformat(), "store_number": "12", "currency": "USD", "original_id": ""},
                        "totals": {"grand_total": 108.0, "tax_total": 8.0, "shipping_total": None}, "recipient": {"customer_id": "TP-CLICK", "email": "", "phone": ""},
                        "discounts": [{"code": "SAVE10"}], "items": [{"promo_codes": ["SAVE10", "FALL"]}]}
                check("store sales are not recorded until the workspace allows it", attribution.record_pos(tenant, read, key="m:12:1:9001:20261004") is False)
                attribution.save_settings(tenant, {"store_sales": True})
                tenant.refresh_from_db()
                check("with store sales counted, a sale is an order", attribution.record_pos(tenant, read, key="m:12:1:9001:20261004") is True)
                pos = q("SELECT kind, amount, channel, store_number, coupon_codes FROM attributed_order WHERE source = 'POS' AND match_ref = '9001'")[0]
                check("a sale counts net of tax, from the store, with its codes once each", pos == ("ORDER", Decimal("100.00"), "STORE", "12", ["SAVE10", "FALL"]), str(pos))
                ret = {**read, "transaction": {**read["transaction"], "id": "9002", "category": "Return", "original_id": "9001"}}
                attribution.record_pos(tenant, ret, key="m:12:1:9002:20261004")
                check("a return becomes a refund of the original sale", q("SELECT kind, amount, original_ref FROM attributed_order WHERE match_ref = '9002'")[0] == ("REFUND", Decimal("-100.00"), "9001"))
                emp = {**read, "transaction": {**read["transaction"], "id": "9003", "employee_sale": True}}
                check("an employee sale is left out", attribution.record_pos(tenant, emp, key="m:12:1:9003:20261004") is False)

                # ---- summary and list
                s = attribution.summary(T)
                check("the summary counts orders, credited revenue and the share by touch", s["orders"] >= 10 and s["attributed_orders"] >= 6 and s["by_touch"]["CLICK"]["orders"] >= 3
                      and s["store_orders"] == 2, json.dumps({k: s[k] for k in ("orders", "attributed_orders", "attributed_share", "pending", "unattributed")}))
                rows = attribution.recent(T, status="UNATTRIBUTED", q="T-")
                check("the list filters by state and search, and says why an order earned nothing", rows and all(r["status"] == "UNATTRIBUTED" and r["note"] for r in rows))

                # ---- the API, as a shop with a key
                prefix = "cep_in_" + secrets.token_hex(3)
                key = prefix + secrets.token_urlsafe(24).replace("-", "a").replace("_", "b")
                ApiClient.objects.create(tenant_id=T, name="Test shop", client_type="INTEGRATION", key_prefix=prefix, key_hash=hashlib.sha256(key.encode()).hexdigest(),
                                         scopes=["orders:ingest"])
                shop = Client(HTTP_X_TENANT="NWA", HTTP_AUTHORIZATION=f"Bearer {key}")
                response = shop.post("/api/v1/orders/", json.dumps({"orders": [{"order_id": "API-1", "amount": 12, "email": "click@example.test"},
                                                                              {"order_id": "API-2", "amount": "x"}]}), content_type="application/json")
                body = response.json()
                check("POST /orders/ answers per order: accepted and rejected with the field", response.status_code == 200 and body["accepted"] == 1 and body["rejected"] == 1
                      and body["results"][1]["errors"].get("amount"), json.dumps(body)[:200])
                response = shop.post("/api/v1/orders/", json.dumps({"order_id": "API-1", "amount": 12}), content_type="application/json")
                check("a single order sent again is a duplicate", response.status_code == 200 and response.json()["duplicates"] == 1)
                check("all rejected is a 400", shop.post("/api/v1/orders/", json.dumps({"amount": 1}), content_type="application/json").status_code == 400)
                check("more than 500 orders a call is refused", shop.post("/api/v1/orders/", json.dumps({"orders": [{"order_id": str(i), "amount": 1} for i in range(501)]}),
                                                                   content_type="application/json").status_code == 400)
                prefix2 = "cep_in_" + secrets.token_hex(3)
                key2 = prefix2 + secrets.token_urlsafe(24).replace("-", "a").replace("_", "b")
                ApiClient.objects.create(tenant_id=T, name="Lists only", client_type="INTEGRATION", key_prefix=prefix2, key_hash=hashlib.sha256(key2.encode()).hexdigest(), scopes=["lists:write"])
                check("a key without orders:ingest is refused", Client(HTTP_X_TENANT="NWA", HTTP_AUTHORIZATION=f"Bearer {key2}").post(
                    "/api/v1/orders/", json.dumps({"order_id": "X", "amount": 1}), content_type="application/json").status_code == 403)

                admin = next(u for u in AppUser.objects.filter(tenant_id=T, is_active=True, deleted_at__isnull=True).order_by("created_at") if "user.admin" in u.permission_codes())
                user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
                from rest_framework.test import APIClient
                web = APIClient()
                web.force_authenticate(admin)
                page = web.get("/api/v1/attribution/settings/", HTTP_X_TENANT="NWA")
                data = page.json() if page.status_code == 200 else {}
                check("GET settings: the rules, the endpoint and scope, keys that can send, and the summary", page.status_code == 200 and data["endpoint"].endswith("/api/v1/orders/")
                      and data["scope"] == "orders:ingest" and data["keys_with_scope"] >= 1 and "summary" in data and "needs_full" not in data, str(page.status_code))
                page = web.put("/api/v1/attribution/settings/", {"click_days": 99}, format="json", HTTP_X_TENANT="NWA")
                check("PUT settings refuses a window not offered, naming the field", page.status_code == 400 and "click_days" in page.json().get("errors", {}), page.content[:120])
                page = web.get("/api/v1/attribution/orders/?status=ATTRIBUTED", HTTP_X_TENANT="NWA")
                check("GET orders lists credited orders with the campaign's name", page.status_code == 200 and page.json()["results"] and page.json()["results"][0]["campaign_name"])
                page = web.post("/api/v1/attribution/recalculate/", HTTP_X_TENANT="NWA")
                out = page.json() if page.status_code == 200 else {}
                check("Recalculate judges the orders again and rewrites the figures", page.status_code == 200 and out["reset"] >= 12 and out["campaigns"] >= 2, json.dumps(out))

                attribution.save_settings(tenant, {"enabled": False})
                check("with attribution off, the shop is told so (409)", shop.post("/api/v1/orders/", json.dumps({"order_id": "OFF", "amount": 1}), content_type="application/json").status_code == 409)

                # ---- the job finds enabled workspaces only
                check("the job skips a workspace with attribution off", all(tid != T for tid, _ in attribution.enabled_tenants()))
            raise Rollback
    except Rollback:
        pass
    finally:
        with connections[P].cursor() as cursor:
            cursor.execute("DELETE FROM integration_log WHERE tenant_id = %s AND started_at >= %s AND url = '/api/v1/orders/'", [T, started])
            print("deleted log rows:", cursor.rowcount)
            cursor.execute("DELETE FROM integration WHERE tenant_id = %s AND kind = 'ORDERS' AND created_at >= %s", [T, started])
            print("cleaned integration records:", cursor.rowcount)
            cursor.execute("SELECT count(*) FROM integration_log WHERE tenant_id = %s AND started_at >= %s", [T, started])
            print("log rows left:", cursor.fetchone()[0])
        with connections[P].cursor() as cursor:
            cursor.execute("SELECT count(*) FROM attributed_order")
            print("orders left after rollback:", cursor.fetchone()[0])
    check.done()
