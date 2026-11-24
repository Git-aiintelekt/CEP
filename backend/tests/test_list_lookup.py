"""Look Up in C360 (apps/contact_lists/lookup.py): the rules each looked-up person is judged by, and a file of Customer IDs through the
worker the way the server runs it (STAGE → LOOKUP → REVIEW → APPLY), the CRM's reads replaced by a fake. Then the same IDs again:
the people are recognised by their ID. Rolled back; needs patch 0097."""
import random
import traceback
import uuid
from contextlib import contextmanager
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections, transaction
from django.utils import timezone

from apps.contact_lists import imports, jobs, lookup
from apps.contact_lists.models import ContactList, ContactListImport
from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.insights import external
from apps.platform_ops import crypto, mail
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"])]


def _person(**over):
    base = {"status": "PARTY_ENABLED", "first_name": "Ana", "last_name": "Diaz", "loyalty_id": None, "timezone": "America/Chicago", "has_role": True, "customer": True,
            "phone": {"digits": "4045550101", "valid": None, "dnd": None, "allow": "Y", "since": "2026-01-05", "ended": False},
            "email": None, "postal_code": "30303"}
    return {**base, **over}


def test_the_rules_a_looked_up_person_is_judged_by():
    assert lookup.verdict(None, "SMS", "CUSTOMER") == {"held": "Customer ID not found"}
    assert lookup.verdict(None, "SMS", None) == {"held": "Party ID not found"}
    assert lookup.verdict(_person(status="PARTY_DISABLED"), "SMS", "CUSTOMER")["held"] == "Disabled in the source database"
    assert lookup.verdict(_person(has_role=False), "SMS", "LEAD")["held"] == "Not a Lead"
    assert lookup.verdict(_person(phone=None), "SMS", "CUSTOMER")["held"] == "No primary phone"
    phone = _person()["phone"]
    assert lookup.verdict(_person(phone={**phone, "ended": True}), "SMS", None)["held"] == "Number no longer in use"
    assert lookup.verdict(_person(phone={**phone, "valid": "N"}), "SMS", None)["held"] == "Number not valid"
    assert lookup.verdict(_person(phone={**phone, "digits": "404555010"}), "SMS", None)["held"] == "Number not valid"
    assert lookup.verdict(_person(phone={**phone, "dnd": "Y"}), "SMS", None)["held"] == "On Do Not Disturb"
    assert lookup.verdict(_person(customer=False, phone={**phone, "allow": "N"}), "SMS", None)["held"] == "Phone not open to solicitation"
    customer_no = lookup.verdict(_person(phone={**phone, "allow": "N"}), "SMS", "CUSTOMER")
    assert customer_no["mobile"] == "4045550101" and "sms_consent_date" not in customer_no and customer_no["warning"].startswith("Customer not open to solicitation")
    ok = lookup.verdict(_person(), "SMS", "CUSTOMER")
    assert ok == {"first_name": "Ana", "last_name": "Diaz", "timezone": "America/Chicago", "postal_code": "30303", "mobile": "4045550101", "sms_consent_date": "2026-01-05"}
    assert lookup.verdict(_person(phone={**phone, "allow": None}), "SMS", None).get("sms_consent_date") is None      # empty: imported, no consent
    email = {"address": "ana@lookup.test", "valid": None, "allow": "Y", "since": "2025-12-01", "ended": False}
    assert lookup.verdict(_person(email=None), "EMAIL", None)["held"] == "No email"
    assert lookup.verdict(_person(email={**email, "valid": "N"}), "EMAIL", None)["held"] == "Email not valid"
    assert lookup.verdict(_person(email={**email, "address": "not-an-address"}), "EMAIL", None)["held"] == "Email not valid"
    assert lookup.verdict(_person(email={**email, "allow": "N"}), "EMAIL", None)["held"] == "Email not open to solicitation"
    by_email = lookup.verdict(_person(email=email), "EMAIL", None)
    assert by_email["email"] == "ana@lookup.test" and by_email["consent_date"] == "2025-12-01" and by_email["mobile"] == "4045550101"
    assert lookup.id_column(["Customer ID", "Store"]) == "Customer ID" and lookup.id_column(["anything"]) == "anything"
    with pytest.raises(lookup.LookupError_):
        lookup.id_column(["Store", "Name"])


def _forget_tenant():
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', '', false)")


ANA, BEN = (f"90{random.randint(10_000_000, 99_999_999)}" for _ in range(2))        # numbers nobody in the local copy has
CRM = {
    "1001": _person(first_name="Ana", phone={"digits": ANA, "valid": None, "dnd": None, "allow": "Y", "since": "2026-01-05", "ended": False}),
    "1002": _person(first_name="Ben", phone={"digits": BEN, "valid": None, "dnd": None, "allow": "N", "since": "2025-11-01", "ended": False}),
    "1003": _person(first_name="Cy", has_role=False),
    "1004": _person(first_name="Di", status="PARTY_DISABLED"),
    "1005": _person(first_name="Ed", phone=None),
}
FILE = ("Customer ID,Store\r\n1001,0412\r\n1002,0412\r\n1003,0412\r\n1004,0412\r\n1005,0412\r\n1006,0412\r\n1001,0413\r\n,0414\r\n").encode("utf-8")


def test_a_file_of_customer_ids_through_the_worker(check, admin_email):
    real_tx = session.tx

    @contextmanager
    def worker_tx():
        with real_tx():
            yield
        _forget_tenant()

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    T = str(tenant.id)
    asked = []

    def fake_read(conn, ids, role):
        asked.append((len(ids), role))
        return {i: dict(CRM[i]) for i in ids if i in CRM}

    class Closed:
        def close(self):
            pass

    sent = []
    with transaction.atomic(using="default"), transaction.atomic(using="platform"), \
            mock.patch.object(jobs, "kick", lambda: None), mock.patch.object(jobs, "assert_room", lambda *a, **k: None), \
            mock.patch.object(lookup, "read", fake_read), mock.patch.object(external, "connect", lambda row, **k: Closed()), \
            mock.patch.object(jobs, "_setting", lambda key, default: 1 if key == "lists.notify_email_rows" else default), \
            mock.patch.object(mail, "send", lambda template, to, context_, **k: sent.append((template, to, context_["title"])) or True):
        token = context.set_current(T, "default", str(user.pk))
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
            cursor.execute("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
            cursor.execute("UPDATE report_connection SET use_for_lists = FALSE WHERE tenant_id = %s", [T])
            crm = str(uuid.uuid4())
            cursor.execute("""INSERT INTO report_connection (id, tenant_id, name, engine, host, database_name, schema_name, username, password_enc, read_only, use_for_lists)
                              VALUES (%s, %s, 'Lookup CRM', 'mysql57', 'crm.lookup.test', 'crm_prod', 'crm_prod', 'reader', %s, TRUE, TRUE)""", [crm, T, crypto.encrypt("secret")])
            cursor.execute("""INSERT INTO report_connection (id, tenant_id, name, engine, host, database_name, username, password_enc, read_only, use_for_lists)
                              VALUES (%s, %s, 'Lookup PG', 'postgresql', 'pg.lookup.test', 'pg', 'reader', %s, TRUE, TRUE)""", [str(uuid.uuid4()), T, crypto.encrypt("secret")])
        offered = lookup.sources(T)
        check("only the ticked MySQL database is offered", [row["name"] for row in offered] == ["Lookup CRM"], str(offered))
        plan = lookup.plan(T, [], "CUSTOMER")                   # one database offered: it is used without being picked
        check("the plan: the database, the role and what the IDs are called", plan["connections"] == [crm] and plan["id_label"] == "Customer ID", str(plan))
        refused = None
        try:
            lookup.plan(T, [str(uuid.uuid4())], "CUSTOMER")
        except lookup.LookupError_ as exc:
            refused = str(exc)
        check("a database that is not offered is refused", refused is not None and "not set up" in refused, str(refused))

        contact_list = ContactList.objects.create(tenant_id=T, name=f"Lookup {T[:4]}", created_by_id=user.pk, source_type="UPLOAD", list_environment="PRODUCTION", status="ACTIVE", channel="SMS")
        record = imports.accept(contact_list, SimpleUploadedFile("customers.csv", FILE, content_type="text/csv"), user_id=user.pk, lookup=plan)
        check("the upload keeps the plan and the ID column", record.lookup["id_column"] == "Customer ID" and record.column_mapping == {}, str(record.lookup))
        context.reset(token)

        errors = []

        def worker(step):
            job = jobs.claim("default", T)
            _forget_tenant()
            errors.clear()
            with mock.patch.object(session, "tx", worker_tx), \
                    mock.patch.object(jobs.log, "exception", lambda *a, **k: errors.append(traceback.format_exc().strip().splitlines()[-1])):
                ok = job is not None and job[2] == step and jobs._run(str(job[0]), str(job[1]), job[2], job[3])
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [T])
            row = ContactListImport.objects.get(pk=record.pk)
            check(f"{step}: the worker finishes it", bool(ok) and row.error is None, f"job={job} status={row.status} logged={errors}")
            return row

        row = worker("STAGE")
        check("the file is read, then the lookup is queued", row.status == "STAGED" and row.next_action == "LOOKUP" and row.row_count == 8, f"{row.status} {row.next_action} {row.row_count}")
        row = worker("LOOKUP")
        result = (row.lookup or {}).get("result") or {}
        held = {item["reason"]: item["count"] for item in result.get("held", [])}
        check("the lookup reads the six distinct IDs once, for the role", asked == [(6, "CUSTOMER")], str(asked))
        check("the lookup holds back what C360 says not to use",
              held == {"Not a Customer": 1, "Disabled in the source database": 1, "No primary phone": 1, "Customer ID not found": 1, "No Customer ID in this row": 1}, str(held))
        check("found, usable and filled", result.get("found") == 6 and result.get("usable") == 3 and result["filled"]["mobile"] == 3 and result["filled"]["sms_consent_date"] == 2, str(result))
        check("then the check is queued with the mapping set", row.next_action == "REVIEW" and row.mapping_confirmed and row.column_mapping.get("mobile") == "c360:mobile", str(row.column_mapping))

        row = worker("REVIEW")
        summary = row.summary
        check("the review: two ready, the repeated ID and five lookup reasons held back",
              summary["ready"]["total"] == 2 and summary["held_back"]["LOOKUP"] == 5 and summary["held_back"]["DUPLICATE_IN_FILE"] == 1 and row.warning_count == 1, str(summary))
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT row_number, match_status, error_message, warning, match_method FROM contact_list_import_row WHERE tenant_id = %s AND import_id = %s ORDER BY row_number", [T, str(row.pk)])
            lines = {line: (status, error, warning, method) for line, status, error, warning, method in cursor.fetchall()}
        check("the repeated ID is a duplicate of line 2", lines[8][:2] == ("DUPLICATE", "Same ID as line 2"), str(lines[8]))
        check("the Customer not open to solicitation is imported with a remark", lines[3][0] == "UNMATCHED" and "not open to solicitation" in (lines[3][2] or "") and lines[3][3] == "PARTY_ID", str(lines[3]))
        from api.v1.contact_lists_api import import_payload
        payload = import_payload(row)
        check("the payload carries the lookup for the review", payload["lookup"]["id_label"] == "Customer ID" and payload["lookup"]["result"]["usable"] == 3
              and any(r["code"] == "LOOKUP" and r["count"] == 5 for r in payload["summary"]["held_back"]["reasons"]), str(payload["lookup"]))
        check("a large upload emails its uploader when it has been checked", sent and sent[-1][0] == "list_upload" and sent[-1][1] == [user.email] and "ready for your review" in sent[-1][2], str(sent))

        ContactListImport.objects.filter(pk=row.pk).update(attested_at=timezone.now())
        token = context.set_current(T, "default", str(user.pk))
        imports.request_apply(ContactListImport.objects.select_related("contact_list").get(pk=row.pk))
        context.reset(token)
        row = worker("APPLY")
        with connections["default"].cursor() as cursor:
            cursor.execute("""SELECT cm.custom_attributes ->> 'party_id', cm.party_id LIKE 'SRC-%%', cm.phones -> 0 ->> 'number', cs.consent_status
                                FROM customer_master cm LEFT JOIN consent_suppression cs ON cs.tenant_id = cm.tenant_id AND cs.party_id = cm.party_id AND cs.channel = 'SMS'
                               WHERE cm.tenant_id = %s AND cm.custom_attributes ->> 'party_id' IN ('1001', '1002') ORDER BY 1""", [T])
            people = cursor.fetchall()
        check("two people added, keyed by their ID, Ana with a text opt-in and Ben with none",
              row.status == "APPLIED" and row.applied_count == 2 and people == [("1001", True, f"+1{ANA}", "OPTED_IN"), ("1002", True, f"+1{BEN}", None)], f"{row.status} {people}")
        check("and the uploader is emailed when it is imported", sent[-1][2].endswith("is imported"), str(sent[-1]))

        # the same IDs again: recognised by their ID
        token = context.set_current(T, "default", str(user.pk))
        record = imports.accept(contact_list, SimpleUploadedFile("again.csv", b"Customer ID\r\n1001\r\n1002\r\n", content_type="text/csv"), user_id=user.pk, lookup=plan)
        context.reset(token)
        worker("STAGE")
        worker("LOOKUP")
        row = worker("REVIEW")
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT match_status, match_method FROM contact_list_import_row WHERE tenant_id = %s AND import_id = %s ORDER BY row_number", [T, str(row.pk)])
            again = cursor.fetchall()
        check("the next file finds the same people by their ID", again == [("MATCHED", "PARTY_ID"), ("MATCHED", "PARTY_ID")] and row.summary["ready"]["existing"] == 2, str(again))
        transaction.set_rollback(True, using="default")
        transaction.set_rollback(True, using="platform")
    check.done()
