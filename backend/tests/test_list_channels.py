"""List channels: the same file uploaded to an email list, a text list and a both list; who is held back, how a person is
recognised, which consent is recorded, and what a text campaign's audience makes of the text list. Rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from unittest import mock
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns import service
from apps.campaigns.models import Campaign
from apps.contact_lists import imports, jobs
from apps.contact_lists.models import ContactList, ContactListImport
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_list_channels(check):
    """List channels: the same file uploaded to an email list, a text list and a both list; who is held back, how a person is"""
    CSV = ("Email,First name,Mobile number,Email consent date,Text consent date\r\n"
           "ann@lists.test,Ann,+12125550141,2026-01-10,2026-02-01\r\n"
           ",Ben,15875764422,,2026-02-01\r\n"
           "not-an-address,Cy,+12125550143,,\r\n"
           "dee@lists.test,Dee,,2026-01-10,\r\n"
           "eve@lists.test,Eve,+12125550141,,\r\n").encode()
    BEAT = lambda *a: None                                                                   # noqa: E731

    def rows(sql, args=()):
        with connections["default"].cursor() as c:
            c.execute(sql, args)
            return c.fetchall()

    def run_import(contact_list, user_id):
        """accept → stage → confirm → review → apply, in the request's connection (the jobs are not started)."""
        record = imports.accept(contact_list, SimpleUploadedFile("list.csv", CSV, content_type="text/csv"), user_id=user_id)
        imports.stage(record, 500, BEAT)
        record = ContactListImport.objects.get(pk=record.pk)
        record = imports.confirm_mapping(record, record.column_mapping)
        imports.review(record, 500, BEAT)
        record = ContactListImport.objects.get(pk=record.pk)
        imports.apply(record, 500, BEAT, user_id=user_id)
        imports.discard_file(record)
        record.save()
        return ContactListImport.objects.get(pk=record.pk)

    def held(record):
        return {k: v for k, v in record.summary["held_back"].items() if v}

    def members(contact_list):
        return rows("""SELECT cm.first_name, m.matched_by, cm.emails::text, cm.phones::text, m.party_id FROM contact_list_member m JOIN customer_master cm ON cm.party_id = m.party_id
                   WHERE m.tenant_id = %s AND m.contact_list_id = %s ORDER BY cm.first_name""", [str(contact_list.tenant_id), str(contact_list.pk)])

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email="aby.john@aiintelekt.com")
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    T = str(tenant.id)
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"), mock.patch.object(jobs, "enqueue", lambda *a, **k: None), mock.patch.object(jobs, "assert_room", lambda *a, **k: None):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
                cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
            made = {}
            for channel in ("SMS", "EMAIL", "BOTH"):
                r = API.post("/api/v1/contact-lists/", {"name": f"Channel test {channel} {T[:4]}", "channel": channel}, content_type="application/json")
                check(f"a {channel} list is created with its channel", r.status_code == 201 and r.json()["channel"] == channel, f"{r.status_code} {str(r.content)[:120]}")
                made[channel] = ContactList.objects.get(pk=r.json()["id"])
            plain = API.post("/api/v1/contact-lists/", {"name": f"Channel default {T[:4]}"}, content_type="application/json")
            check("a list without a channel is an email list", plain.status_code == 201 and plain.json()["channel"] == "EMAIL")
            bad = API.post("/api/v1/contact-lists/", {"name": f"Channel bad {T[:4]}", "channel": "FAX"}, content_type="application/json")
            check("an unknown channel is refused", bad.status_code == 400)
            check("the catalogue's required column follows the channel", [p["key"] for p in imports.catalogue("SMS") if p["required"]] == ["mobile"]
                  and [p["key"] for p in imports.catalogue("EMAIL") if p["required"]] == ["email"] and [p["key"] for p in imports.catalogue("BOTH") if p["required"]] == ["email", "mobile"])
            check("the template's new headers are recognised", imports.guess(["Email consent date", "Text consent date", "Mobile number"]) == {"consent_date": "Email consent date", "sms_consent_date": "Text consent date", "mobile": "Mobile number"})

            # ---- the text list
            sms = run_import(made["SMS"], user.pk)
            payload = API.get(f"/api/v1/contact-lists/{made['SMS'].pk}/imports/{sms.pk}/").json()
            check("the upload payload marks Mobile number as the required column for a text list and names the channel",
                  payload["list_channel"] == "SMS" and [p["key"] for p in payload["properties"] if p["required"]] == ["mobile"], str([p for p in payload["properties"] if p["required"]])[:120])
            check("text list: a row without a mobile number is held back; rows without or with a bad email are imported; Eve with her own address is her own person",
                  held(sms) == {"total": 1, "NO_MOBILE": 1} and sms.matched_count + sms.unmatched_count == 4, json.dumps(sms.summary["held_back"]))
            issues = imports.issues(sms)
            check("... with the reasons on the lines", any("No mobile number" in (i.get("message") or "") for i in issues)
                  and any("Email address not recognised" in (i.get("message") or "") for i in issues), str(issues)[:300])
            got = members(made["SMS"])
            check("text list members: Ann by email, Ben and Cy by their numbers with no address kept, Eve by email",
                  [(m[0], m[1]) for m in got] == [("Ann", "EMAIL"), ("Ben", "PHONE"), ("Cy", "PHONE"), ("Eve", "EMAIL")] and json.loads(got[1][2]) == [] and json.loads(got[1][3])[0]["number"] == "+15875764422"
                  and json.loads(got[2][2]) == [] and got[1][4].startswith("UPL-") and got[1][4] != got[2][4], str(got)[:300])
            consents = rows("SELECT cm.first_name, cs.channel, cs.consent_status FROM consent_suppression cs JOIN customer_master cm ON cm.party_id = cs.party_id WHERE cs.tenant_id = %s AND cs.party_id = ANY(%s) ORDER BY 1, 2",
                            [T, [m[4] for m in got]])
            check("text consent dates become SMS opt-ins (Ann, Ben), the email consent date an EMAIL opt-in (Ann), nothing for Cy or Eve",
                  consents == [("Ann", "EMAIL", "OPTED_IN"), ("Ann", "SMS", "OPTED_IN"), ("Ben", "SMS", "OPTED_IN")], str(consents))
            gov = rows("SELECT governance_status, count(*) FROM contact_list_import_row WHERE tenant_id = %s AND import_id = %s AND match_status IN ('MATCHED', 'UNMATCHED') GROUP BY 1 ORDER BY 1", [T, str(sms.pk)])
            check("the text list is judged on text consent: two can receive marketing texts, Cy and Eve have no consent", dict(gov) == {"MARKETABLE": 2, "NO_CONSENT": 2}, str(gov))
            estimate = service.audience(Campaign(channel="SMS", solicitation_type="MARKETING"), include=[str(made["SMS"].pk)], exclude=[])
            lines = {line["code"]: line["count"] for line in estimate["statuses"]}
            check("a marketing text campaign's estimate on the text list: 2 recipients, 2 left out for no consent, the list row carries its channel",
                  estimate["estimated_recipients"] == 2 and lines.get("NO_CONSENT") == 2 and estimate["lists"][0]["channel"] == "SMS", json.dumps({k: v for k, v in estimate.items() if k in ("estimated_recipients", "statuses")})[:300])

            # ---- the email list: the old rules, untouched
            email = run_import(made["EMAIL"], user.pk)
            check("email list: no address and a bad address are held back, a row without a mobile is imported, Eve is her own person",
                  held(email) == {"total": 2, "NO_EMAIL": 1, "INVALID_EMAIL": 1} and [m[0] for m in members(made["EMAIL"])] == ["Ann", "Dee", "Eve"], json.dumps(email.summary["held_back"]) + " " + str([m[0] for m in members(made["EMAIL"])]))
            # ---- both: both columns required
            both = run_import(made["BOTH"], user.pk)
            check("both list: a row needs an address and a number", held(both) == {"total": 3, "NO_EMAIL": 1, "INVALID_EMAIL": 1, "NO_MOBILE": 1} and [m[0] for m in members(made["BOTH"])] == ["Ann", "Eve"],
                  json.dumps(both.summary["held_back"]))
            # ---- the mapping rule
            rec = imports.accept(made["SMS"], SimpleUploadedFile("list.csv", CSV, content_type="text/csv"), user_id=user.pk)
            try:
                imports.clean_mapping(rec, {"email": "Email"})
                check("a text list refuses a mapping without the mobile column", False)
            except imports.ImportError_ as exc:
                check("a text list refuses a mapping without the mobile column", "mobile number" in str(exc), str(exc))
            imports.discard_file(rec)
            # ---- clone keeps the channel; the attached-list rows carry it
            cloned = API.post(f"/api/v1/contact-lists/{made['SMS'].pk}/clone/", {"name": f"Channel clone {T[:4]}"}, content_type="application/json")
            check("a clone keeps the channel unless told otherwise", cloned.status_code == 201 and cloned.json()["channel"] == "SMS", f"{cloned.status_code} {str(cloned.content)[:100]}")
            changed = API.patch(f"/api/v1/contact-lists/{made['EMAIL'].pk}/", {"channel": "BOTH"}, content_type="application/json")
            check("a list's channel can be changed", changed.status_code == 200 and changed.json()["channel"] == "BOTH", f"{changed.status_code}")
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    check.done()
