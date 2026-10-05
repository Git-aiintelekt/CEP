"""Contact compliance: the declaration before apply, the policy (hold back / refuse, texts need a date), approval before the first send
with the audience gate, and the compliance record. Rolled back.

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
from apps.contact_lists import consent, imports, jobs
from apps.contact_lists.models import ContactList, ContactListImport
from apps.identity.models import AppUser
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_contact_compliance(check, admin_email):
    """Contact compliance: the declaration before apply, the policy (hold back / refuse, texts need a date), approval before the first send"""
    CSV = ("Email,First name,Mobile number,Email consent date,Text consent date\r\n"
           "ann@compliance.test,Ann,+12125550161,2026-01-10,2026-02-01\r\n"
           "ben@compliance.test,Ben,+12125550162,,\r\n"
           "cy@compliance.test,Cy,+12125550163,2026-01-12,\r\n").encode()
    BEAT = lambda *a: None                                                                   # noqa: E731

    def rows(sql, args=()):
        with connections["default"].cursor() as c:
            c.execute(sql, args)
            return c.fetchall()

    def stage_and_review(contact_list, user_id):
        record = imports.accept(contact_list, SimpleUploadedFile("list.csv", CSV, content_type="text/csv"), user_id=user_id)
        imports.stage(record, 500, BEAT)
        record = ContactListImport.objects.get(pk=record.pk)
        record = imports.confirm_mapping(record, record.column_mapping)
        imports.review(record, 500, BEAT)
        return ContactListImport.objects.get(pk=record.pk)

    def apply(record, user_id):
        imports.apply(record, 500, BEAT, user_id=user_id)
        imports.discard_file(record)
        record.status = "APPLIED"
        record.save()
        return ContactListImport.objects.get(pk=record.pk)

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", str(user.pk))
    T = str(tenant.id)
    API = Client(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}", HTTP_X_TENANT=tenant.code)
    try:
        with transaction.atomic(using="default"), transaction.atomic(using="platform"), mock.patch.object(jobs, "enqueue", lambda *a, **k: None), mock.patch.object(jobs, "assert_room", lambda *a, **k: None):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
                cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
            tenant = Tenant.objects.get(pk=T)
            saved_settings = dict(tenant.settings or {})

            # ---- the policy endpoint
            r = API.get("/api/v1/workspace/consent-policy/")
            check("the policy reads with its defaults, the attestation with the workspace's name, the bases", r.status_code == 200 and r.json()["without_consent"] == "HOLD_BACK"
                  and tenant.name in r.json()["attestation_preview"] and [b["key"] for b in r.json()["bases"]] == ["WEB_FORM", "IN_STORE", "CUSTOMER_REQUEST", "IMPLIED"], f"{r.status_code} {str(r.content)[:160]}")
            r = API.put("/api/v1/workspace/consent-policy/", {"without_consent": "MAYBE"}, content_type="application/json")
            check("a bad policy value is refused with its field", r.status_code == 400 and "without_consent" in str(r.content), f"{r.status_code} {str(r.content)[:120]}")
            r = API.put("/api/v1/workspace/consent-policy/", {"approval_before_send": True, "attestation": "I confirm {workspace} may message these people"}, content_type="application/json")
            check("the policy saves and the attestation preview follows", r.status_code == 200 and r.json()["approval_before_send"] is True and r.json()["attestation_preview"] == f"I confirm {tenant.name} may message these people", f"{r.status_code} {str(r.content)[:160]}")

            # ---- the declaration gates the import
            r = API.post("/api/v1/contact-lists/", {"name": f"Compliance email {T[:4]}", "channel": "EMAIL"}, content_type="application/json")
            check("an upload list is created", r.status_code == 201, f"{r.status_code} {str(r.content)[:300]}")
            email_list = ContactList.objects.get(pk=r.json()["id"])
            rec = stage_and_review(email_list, user.pk)
            payload = API.get(f"/api/v1/contact-lists/{email_list.pk}/imports/{rec.pk}/").json()
            check("the upload payload carries the declaration slot: required, nothing declared, the attestation sentence, the bases", payload["consent"]["required"] is True and payload["consent"]["basis"] is None
                  and payload["consent"]["attestation"].startswith("I confirm") and payload["consent"]["bases"][3]["allowed"] is True, json.dumps(payload["consent"])[:200])
            r = API.post(f"/api/v1/contact-lists/{email_list.pk}/imports/{rec.pk}/apply/", content_type="application/json")
            check("apply before the declaration is refused (409)", r.status_code == 409 and "agreed" in str(r.content), f"{r.status_code} {str(r.content)[:120]}")
            r = API.post(f"/api/v1/contact-lists/{email_list.pk}/imports/{rec.pk}/consent/", {"basis": "WEB_FORM", "attested": False}, content_type="application/json")
            check("the declaration needs the attestation", r.status_code == 400 and "attested" in str(r.content), f"{r.status_code} {str(r.content)[:120]}")
            r = API.post(f"/api/v1/contact-lists/{email_list.pk}/imports/{rec.pk}/consent/", {"basis": "PURCHASED", "attested": True}, content_type="application/json")
            check("a bought list is not a basis", r.status_code == 400, f"{r.status_code}")
            r = API.post(f"/api/v1/contact-lists/{email_list.pk}/imports/{rec.pk}/consent/", {"basis": "WEB_FORM", "collected_at": "  Fall   sign-up form ", "attested": True}, content_type="application/json")
            check("the declaration is kept with the uploader's name and time", r.status_code == 200 and r.json()["consent"]["basis"] == "WEB_FORM" and r.json()["consent"]["collected_at"] == "Fall sign-up form"
                  and r.json()["consent"]["attested_by_name"] and r.json()["consent"]["attested_at"], f"{r.status_code} {str(r.content)[:200]}")
            rec = ContactListImport.objects.get(pk=rec.pk)
            check("hold back policy: every row is ready, Ben has no consent", rec.summary["held_back"]["total"] == 0 and rec.summary["governance"]["NO_CONSENT"] == 1 and rec.summary["policy"]["without_consent"] == "HOLD_BACK",
                  json.dumps(rec.summary["held_back"]) + json.dumps(rec.summary["governance"]))
            rec = apply(rec, user.pk)
            evidence = rows("SELECT evidence FROM consent_record WHERE tenant_id = %s AND contact_list_id = %s AND channel = 'EMAIL' ORDER BY id", [T, str(email_list.pk)])
            check("the consent records carry the basis and where it was collected", len(evidence) == 2 and all((json.loads(e[0]) if isinstance(e[0], str) else e[0]).get("basis") == "WEB_FORM" for e in evidence)
                  and all((json.loads(e[0]) if isinstance(e[0], str) else e[0]).get("collected_at") == "Fall sign-up form" for e in evidence), str(evidence)[:200])
            email_list = ContactList.objects.get(pk=email_list.pk)
            check("approval before first send: the list awaits approval after the import", email_list.approval_status == "AWAITING", email_list.approval_status)
            listed = API.get(f"/api/v1/contact-lists/{email_list.pk}/").json()
            check("the list payload says so", listed["approval_status"] == "AWAITING" and listed["approved_by_name"] is None)

            # ---- the audience gate
            estimate = service.audience(Campaign(channel="EMAIL", solicitation_type="MARKETING"), include=[str(email_list.pk)], exclude=[])
            lines = {line["code"]: line["count"] for line in estimate["statuses"]}
            check("a campaign's estimate on an awaiting list: nobody, three in a list awaiting approval, the list row carries the status",
                  estimate["estimated_recipients"] == 0 and lines.get("LIST_NOT_APPROVED") == 3 and estimate["lists"][0]["approval_status"] == "AWAITING", json.dumps(lines))
            r = API.post(f"/api/v1/contact-lists/{email_list.pk}/refuse/", {"note": "Form not found"}, content_type="application/json")
            check("refuse records who and the note", r.status_code == 200 and r.json()["approval_status"] == "REFUSED" and r.json()["approval_note"] == "Form not found" and r.json()["approved_by_name"], f"{r.status_code} {str(r.content)[:160]}")
            r = API.post(f"/api/v1/contact-lists/{email_list.pk}/approve/", {}, content_type="application/json")
            check("approve lifts the gate", r.status_code == 200 and r.json()["approval_status"] == "APPROVED", f"{r.status_code}")
            estimate = service.audience(Campaign(channel="EMAIL", solicitation_type="MARKETING"), include=[str(email_list.pk)], exclude=[])
            lines = {line["code"]: line["count"] for line in estimate["statuses"]}
            check("after approval the estimate counts the people again: Ann and Cy marketable, Ben without consent", estimate["estimated_recipients"] == 2 and lines.get("NO_CONSENT") == 1 and "LIST_NOT_APPROVED" not in lines, json.dumps(lines))
            other = ContactList.objects.create(tenant_id=T, name=f"Compliance plain {T[:4]}", source_type="UPLOAD", list_kind="STATIC", status="ACTIVE", channel="EMAIL", created_by_id=user.pk)
            r = API.post(f"/api/v1/contact-lists/{other.pk}/approve/", {}, content_type="application/json")
            check("a list that needs no approval cannot be approved (409)", r.status_code == 409, f"{r.status_code}")

            # ---- the record
            record = API.get(f"/api/v1/contact-lists/{email_list.pk}/compliance/").json()
            check("the compliance record: the upload with its basis and attestation, the approval, the policy, today's consent by channel",
                  record["uploads"][0]["basis"] == "WEB_FORM" and record["uploads"][0]["attested_by_name"] and record["approval"]["status"] == "APPROVED" and record["policy"]["approval_before_send"] is True
                  and record["consent"] == [{"channel": "EMAIL", "opted_in_from_file": 2, "confirmed_since": 0, "no_consent": 1, "unsubscribed": 0}] and record["inherited"] is False,
                  json.dumps(record)[:400])

            # ---- the refuse policy and the text date rule
            API.put("/api/v1/workspace/consent-policy/", {"without_consent": "REFUSE", "texts_need_date": True, "approval_before_send": False}, content_type="application/json")
            r = API.post("/api/v1/contact-lists/", {"name": f"Compliance refuse {T[:4]}", "channel": "EMAIL"}, content_type="application/json")
            refuse_list = ContactList.objects.get(pk=r.json()["id"])
            rec2 = stage_and_review(refuse_list, user.pk)
            check("refuse policy: Ben (no consent date) is held back as refused, Ann and Cy are ready", rec2.summary["held_back"]["NO_CONSENT_DATE"] == 1 and rec2.summary["ready"]["total"] == 2
                  and rec2.summary["policy"]["without_consent"] == "REFUSE", json.dumps(rec2.summary["held_back"]))
            rec2.status = "REVIEW"
            rec2.save(update_fields=["status"])
            payload = API.get(f"/api/v1/contact-lists/{refuse_list.pk}/imports/{rec2.pk}/").json()
            check("the reconciliation names the refusal", any(line["code"] == "NO_CONSENT_DATE" and line["count"] == 1 for line in payload["summary"]["held_back"]["reasons"]), json.dumps(payload["summary"]["held_back"]))
            r = API.post("/api/v1/contact-lists/", {"name": f"Compliance texts {T[:4]}", "channel": "SMS"}, content_type="application/json")
            sms_list = ContactList.objects.get(pk=r.json()["id"])
            rec3 = stage_and_review(sms_list, user.pk)
            check("texts need a date: only Ann (text consent date) is ready, two refused for no text consent date", rec3.summary["held_back"]["NO_TEXT_CONSENT_DATE"] == 2 and rec3.summary["ready"]["total"] == 1,
                  json.dumps(rec3.summary["held_back"]))
            r = API.post(f"/api/v1/contact-lists/{sms_list.pk}/imports/{rec3.pk}/consent/", {"basis": "IMPLIED", "attested": True}, content_type="application/json")
            check("a texts list refuses implied consent", r.status_code == 400 and "express" in str(r.content), f"{r.status_code} {str(r.content)[:160]}")
            payload = API.get(f"/api/v1/contact-lists/{sms_list.pk}/imports/{rec3.pk}/").json()
            check("the payload marks implied as not allowed for a texts list", [b["allowed"] for b in payload["consent"]["bases"]] == [True, True, True, False])
            rec3 = ContactListImport.objects.get(pk=rec3.pk)
            rec3 = consent.declare(rec3, basis="IN_STORE", attested=True, user_id=user.pk)
            rec3 = apply(rec3, user.pk)
            sms_list = ContactList.objects.get(pk=sms_list.pk)
            check("approval off: the list needs no approval after the import", sms_list.approval_status == "NOT_REQUIRED" and rec3.applied_count == 1, f"{sms_list.approval_status} {rec3.applied_count}")
            tenant.settings = saved_settings
            tenant.save(update_fields=["settings"])
            raise RuntimeError("roll back")
    except RuntimeError as exc:
        if str(exc) != "roll back":
            raise
    check.done()
