"""Suppressions page API against the local database, rolled back: listing, filters, summary, export, unblock, block by hand and by file, permissions.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from unittest import mock
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.identity.models import AppUser
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_suppressions(check):
    """Suppressions page API against the local database, rolled back: listing, filters, summary, export, unblock, block by hand and by file, permissions."""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email="aby.john@aiintelekt.com")
    analyst = AppUser.objects.get(email="priya.natarajan@northwindapparel.example")          # campaign.view only
    devon = AppUser.objects.get(email="devon.okafor@northwindapparel.example")               # Campaign Manager: no consent.edit
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()

    def headers(user):
        return {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(user))}

    H, HA, HD = headers(admin), headers(analyst), headers(devon)

    def api(method, path, body=None, h=H):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **h)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **h)

    def sql(statement, args=None, fetch=False):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            cur.execute(statement, args or [])
            return cur.fetchall() if fetch else None

    with transaction.atomic():
        for party, first, email, phone in (("ZS-P01", "Dolores", "d.alvarez@zs.example", "+14045550101"), ("ZS-P02", "Miriam", "m.okonkwo@zs.example", "+14045550102"),
                                           ("ZS-P03", "Sana", "s.ram@zs.example", "+14045550103"), ("ZS-P04", "Jordan", "j.lee@zs.example", "+14045550104"),
                                           ("ZS-P05", "Clean", "clean@zs.example", "+14045550105")):
            sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, emails, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb, %s::jsonb)",
                [party, TENANT, first, json.dumps([{"address": email, "is_primary": True}]), json.dumps([{"number": phone, "type": "MOBILE", "is_primary": True}])])
            sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'EMAIL', 'OPTED_IN', TRUE, now())", [TENANT, party])
        # what happened to addresses and numbers
        sql("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, hard_bounce_count, last_bounce_reason, blocked, block_reason, block_source, blocked_at)
           VALUES (%s, 'EMAIL', 'd.alvarez@zs.example', 'ZS-P01', 1, 'mailbox does not exist', TRUE, 'HARD_BOUNCE', 'PROVIDER', now() - interval '2 days')""", [TENANT])
        sql("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, complaint_count, blocked, block_reason, block_source, blocked_at)
           VALUES (%s, 'EMAIL', 'j.lee@zs.example', 'ZS-P04', 1, TRUE, 'COMPLAINT', 'PROVIDER', now() - interval '20 days')""", [TENANT])
        sql("""INSERT INTO contact_point_status (tenant_id, contact_point_type, contact_value, party_id, blocked, block_reason, block_source, blocked_at)
           VALUES (%s, 'EMAIL', 'promo@competitor.example', NULL, TRUE, 'MANUAL', 'IMPORT', now() - interval '1 day')""", [TENANT])
        # what people decided
        sql("""UPDATE consent_suppression SET consent_status = 'OPTED_OUT', opted_out_at = now() - interval '3 days', opt_out_method = 'UNSUBSCRIBE_LINK', marketable = FALSE, marketable_reason = 'UNSUBSCRIBED'
            WHERE tenant_id = %s AND party_id = 'ZS-P03' AND channel = 'EMAIL'""", [TENANT])
        sql("""INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, opted_out_at, opt_out_method, marketable, marketable_reason)
           VALUES (%s, 'ZS-P02', 'SMS', 'OPTED_OUT', now() - interval '4 days', 'SMS_STOP', FALSE, 'SMS_STOP')""", [TENANT])

        # ---- 1. the list
        everything = api("get", "/api/v1/suppressions/?search=ZS-").json()
        rows = {row["contact"]: row for row in everything["results"]}
        check("one list over both tables: a hard bounce, a complaint and an import block from contact_point_status, an unsubscribe and a STOP from consent",
              everything["count"] == 4 and set(rows) == {"d.alvarez@zs.example", "j.lee@zs.example", "s.ram@zs.example", "+14045550102"}
              and rows["d.alvarez@zs.example"]["reason_label"] == "Hard Bounce" and rows["d.alvarez@zs.example"]["can_unblock"] is True and rows["d.alvarez@zs.example"]["detail"] == "mailbox does not exist"
              and rows["j.lee@zs.example"]["reason"] == "COMPLAINT" and rows["j.lee@zs.example"]["can_unblock"] is False
              and rows["s.ram@zs.example"]["reason"] == "UNSUBSCRIBED" and rows["s.ram@zs.example"]["source_label"] == "Unsubscribe link" and rows["s.ram@zs.example"]["can_unblock"] is False
              and rows["+14045550102"]["reason_label"] == "Opted Out" and rows["+14045550102"]["channel"] == "PHONE" and rows["+14045550102"]["name"] == "Miriam Test", str(everything)[:300])
        check("... newest first, with the person behind each address", [row["contact"] for row in everything["results"]][:2] == ["d.alvarez@zs.example", "s.ram@zs.example"]
              and rows["d.alvarez@zs.example"]["party_id"] == "ZS-P01")
        by_phone = api("get", "/api/v1/suppressions/?channel=PHONE").json()
        bounced = api("get", "/api/v1/suppressions/?reason=BOUNCED&search=ZS-").json()
        blocked = api("get", "/api/v1/suppressions/?reason=BLOCKED&search=competitor").json()
        named = api("get", "/api/v1/suppressions/?search=Jordan").json()
        bad = api("get", "/api/v1/suppressions/?reason=SPOOKY")
        check("filters: channel, reason group, a search over the address, the customer id and the name; an unknown reason is refused",
              all(row["channel"] == "PHONE" for row in by_phone["results"]) and bounced["count"] == 1 and bounced["results"][0]["group"] == "BOUNCED"
              and blocked["count"] == 1 and blocked["results"][0]["source_label"] == "Import" and blocked["results"][0]["party_id"] is None
              and named["count"] == 1 and named["results"][0]["contact"] == "j.lee@zs.example" and bad.status_code == 400, f"{by_phone['count']} {bounced['count']} {blocked['count']} {named['count']}")
        summary = api("get", "/api/v1/suppressions/summary/").json()
        groups = {g["key"]: g for g in summary["groups"]}
        check("the summary counts by group and what was added this week", set(groups) == {"UNSUBSCRIBED", "BOUNCED", "COMPLAINED", "BLOCKED"} and groups["BOUNCED"]["count"] >= 1
              and groups["BOUNCED"]["this_week"] >= 1 and groups["COMPLAINED"]["count"] >= 1 and groups["UNSUBSCRIBED"]["phone"] >= 1 and summary["total"] >= 5, str(summary))
        export = api("get", "/api/v1/suppressions/export.csv?search=ZS-")
        lines = export.content.decode("utf-8-sig").splitlines()
        check("the export is a CSV of the same rows", export.status_code == 200 and export["Content-Type"].startswith("text/csv") and lines[0].startswith("contact,channel,reason") and len(lines) == 5
              and any("Hard Bounce" in line for line in lines), str(lines[:2]))

        # ---- 2. undoing
        bounce = rows["d.alvarez@zs.example"]
        undone = api("post", f"/api/v1/suppressions/{bounce['kind']}/{bounce['id']}/unblock/")
        complaint = api("post", f"/api/v1/suppressions/CONTACT_POINT/{rows['j.lee@zs.example']['id']}/unblock/")
        consent = api("post", f"/api/v1/suppressions/CONSENT/{rows['s.ram@zs.example']['id']}/unblock/")
        after = api("get", "/api/v1/suppressions/?search=ZS-").json()
        flag = sql("SELECT blocked, unblocked_at IS NOT NULL FROM contact_point_status WHERE tenant_id = %s AND contact_value = 'd.alvarez@zs.example'", [TENANT], True)[0]
        check("a bounce can be unblocked (the row keeps its history); a complaint and an unsubscribe cannot, in words",
              undone.status_code == 200 and undone.json()["was"] == "HARD_BOUNCE" and flag == (False, True) and after["count"] == 3
              and complaint.status_code == 409 and "spam complaint" in complaint.json()["detail"] and consent.status_code == 409 and "opt in again" in consent.json()["detail"],
              f"{undone.content[:120]} {complaint.status_code} {consent.status_code}")

        # ---- 3. blocking by hand and by file
        blocked = api("post", "/api/v1/suppressions/block/", {"values": ["Clean@zs.example", "404-555-0199", "nonsense", "clean@zs.example"], "note": "legal hold"}).json()
        again = api("post", "/api/v1/suppressions/block/", {"values": ["clean@zs.example"]}).json()
        row = api("get", "/api/v1/suppressions/?search=clean@zs").json()["results"][0]
        phone = api("get", "/api/v1/suppressions/?search=4045550199").json()["results"][0]
        check("addresses and numbers are normalised (lower case, +1 for a bare North American number), duplicates and rubbish are reported, the person is matched, the note kept",
              blocked["blocked"] == 2 and blocked["invalid"] == ["nonsense"] and again["already_blocked"] == 1 and row["party_id"] == "ZS-P05" and row["reason"] == "MANUAL"
              and row["source_label"] == "Added by a person" and row["detail"] == "legal hold" and phone["contact"] == "+14045550199" and phone["party_id"] is None, f"{blocked} {again}")
        estimate_list = str(sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count, created_by) VALUES (%s, 'ZS list', 'UPLOAD', 'PRODUCTION', 1, %s) RETURNING id",
                                [TENANT, str(admin.pk)], True)[0][0])
        sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, 'ZS-P05')", [estimate_list, TENANT])
        estimate = api("get", f"/api/v1/campaigns/audience-estimate/?include={estimate_list}&channel=EMAIL").json()
        check("a blocked address is left out of a campaign's audience from then on", estimate["estimated_recipients"] == 0 and any(s["code"] == "BLOCKED" and s["count"] == 1 for s in estimate["statuses"]),
              str(estimate["statuses"]))
        csv_bytes = "email,reason\nhold1@zs.example,legal\n+14045550177,legal\nnot an address,\n".encode("utf-8")
        upload = c.post("/api/v1/suppressions/block/", {"file": SimpleUploadedFile("holds.csv", csv_bytes, content_type="text/csv"), "note": "from the file"}, **H).json()
        check("a CSV upload blocks every cell that looks like an address or a number and says so", upload["blocked"] == 2 and upload["source"] == "IMPORT" and upload["invalid_count"] == 0, str(upload))
        too_many = api("post", "/api/v1/suppressions/block/", {"values": [f"x{i}@zs.example" for i in range(5001)]})
        check("more than 5,000 at a time is refused", too_many.status_code == 400 and "5,000" in str(too_many.json()["errors"]), too_many.content[:160])

        # ---- 4. who may do what
        check("anyone who works on campaigns can read the list; changing it needs consent.edit",
              api("get", "/api/v1/suppressions/", h=HA).status_code == 200 and api("get", "/api/v1/suppressions/summary/", h=HD).status_code == 200
              and api("post", "/api/v1/suppressions/block/", {"values": ["a@b.example"]}, h=HA).status_code == 403
              and api("post", "/api/v1/suppressions/block/", {"values": ["a@b.example"]}, h=HD).status_code == 403
              and api("post", f"/api/v1/suppressions/CONTACT_POINT/{row['id']}/unblock/", h=HD).status_code == 403)

        transaction.set_rollback(True)
    check.done()
