"""Customer Attributes and template tags from the list (patch 0100; apps/customers/attributes.py, apps/contact_lists/tag_values.py;
docs/mockups/customer-attributes.html option 1, docs/mockups/list-tag-values.html option A with B's Tag Check).

A Report Database source read by a fake reader (the database is never reached), its values kept one row per customer per source, the
tags that read them at send, a push from another system, the Tag Check over a campaign's lists, Fill From Database, and a file
uploaded with a Tag Values step through the worker the way the server runs it. Everything on the default connection, rolled back."""
import json
import traceback
import uuid
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections, transaction
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.contact_lists import imports, jobs, tag_values
from apps.contact_lists.models import ContactList, ContactListImport
from apps.customers import attributes
from apps.customers.models import CustomerAttributeDefinition, CustomerAttributeSource, CustomerAttributeSyncRun
from apps.delivery.engine import session
from apps.delivery.engine.render import Renderer
from apps.identity.models import AppUser
from apps.platform_ops import crypto
from apps.templates.models import PersonalizationTag, RenderedTemplateContent, TemplateMaster
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"])]


# ---------------------------------------------------------------------------------------------------- without the database
def test_values_are_typed_and_columns_named(check):
    check("a number from text", attributes.typed("1,240", "NUMBER") == 1240)
    check("a decimal stays a decimal", attributes.typed(Decimal("12.50"), "NUMBER") == 12.5)
    check("not a number", attributes.typed("lots", "NUMBER") is None)
    check("a date from a datetime", attributes.typed(timezone.now().replace(year=2026, month=12, day=31), "DATE") == "2026-12-31")
    check("a date from text", attributes.typed("2026-12-31 00:00:00", "DATE") == "2026-12-31")
    check("Y is yes", attributes.typed("Y", "BOOLEAN") is True and attributes.typed("n", "BOOLEAN") is False)
    check("empty text is nothing", attributes.typed("  ", "TEXT") is None)
    check("text is cut at 500", len(attributes.typed("x" * 900, "TEXT")) == 500)
    check("a column as a key", tag_values.norm("Store Name") == "store_name" and tag_values.norm("Coupon #") == "coupon" and tag_values.norm("2nd Store") == "c_2nd_store")
    check("the CRM falls back to C360's IDs", "custom_attributes ->> 'party_id'" in attributes.id_sql("ICRM"))
    check("another system does not", "custom_attributes" not in attributes.id_sql("SHOPIFY"))

    record = ContactListImport(file_columns=[{"name": "Email"}, {"name": "First Name"}, {"name": "Store Name"}, {"name": "Coupon"}, {"name": "c360:mobile", "virtual": True},
                                             {"name": "Postal Code"}, {"name": "first_name"}],
                               column_mapping={"email": "Email", "first_name": "First Name"})
    check("the extra columns: unmapped, not virtual, not a fixed key", [c["norm"] for c in tag_values.extra_columns(record)] == ["store_name", "coupon"],
          str(tag_values.extra_columns(record)))
    check.done()


# ---------------------------------------------------------------------------------------------------- end to end
def _forget_tenant():
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', '', false)")


def _sql(statement, args=None, fetch=False):
    with connections["default"].cursor() as cursor:
        cursor.execute(statement, args or [])
        return cursor.fetchall() if fetch else None


@contextmanager
def _world(admin_email):
    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    user = AppUser.objects.using("platform").get(email=admin_email)
    context.reset_platform(ptok)
    T = str(tenant.id)
    with transaction.atomic(using="default"), transaction.atomic(using="platform"), mock.patch.object(attributes, "kick", lambda: None):
        token = context.set_current(T, "default", str(user.pk))
        _sql("SELECT set_config('app.current_tenant', %s, false)", [T])
        _sql("SELECT set_config('app.current_user_id', %s, false)", [str(user.pk)])
        try:
            yield T, user
        finally:
            context.reset(token)
            transaction.set_rollback(True, using="default")
            transaction.set_rollback(True, using="platform")


def _crm(T, user):
    """A MySQL Report Database (never reached), an iCRM source on its LOYALTY table and two attributes, and a Shopify API source."""
    connection = str(uuid.uuid4())
    _sql("""INSERT INTO report_connection (id, tenant_id, name, engine, host, database_name, schema_name, username, password_enc, read_only)
            VALUES (%s, %s, 'Attr CRM', 'mysql57', 'crm.attr.test', 'crm', 'crm', 'reader', %s, TRUE)""", [connection, T, crypto.encrypt("secret")])
    icrm = CustomerAttributeSource.objects.create(tenant_id=T, name="ZA iCRM", system="ICRM", kind="DATABASE", report_connection_id=connection,
                                                  table_name="LOYALTY", id_column="PARTY_ID", created_by_id=user.pk)
    shop = CustomerAttributeSource.objects.create(tenant_id=T, name="ZA Shopify", system="SHOPIFY", kind="API", created_by_id=user.pk)
    points = CustomerAttributeDefinition.objects.create(tenant_id=T, key="za_points", label="Points", data_type="NUMBER", source=icrm, source_field="POINTS_BALANCE", refresh="NIGHTLY")
    tier = CustomerAttributeDefinition.objects.create(tenant_id=T, key="za_tier_end", label="Tier End", data_type="DATE", source=icrm, source_field="TIER_END_DATE", refresh="NIGHTLY")
    order = CustomerAttributeDefinition.objects.create(tenant_id=T, key="za_last_order", label="Last Online Order", data_type="DATE", source=shop, source_field="last_order", refresh="ON_CHANGE")
    return icrm, shop, points, tier, order


PEOPLE = ["ZA9001", "ZA-UPL-2", "ZA-UPL-3"]
CRM_ROWS = {"ZA9001": {"POINTS_BALANCE": Decimal("1240"), "TIER_END_DATE": date(2026, 12, 31)}, "ZA9002": {"POINTS_BALANCE": 0, "TIER_END_DATE": None}}


def fake_reader(asked):
    def read(source, ids, fields):
        asked.append((source.name, sorted(ids), sorted(fields)))
        return {i: {f: CRM_ROWS[i].get(f) for f in fields} for i in ids if i in CRM_ROWS}
    return read


def _customers(T):
    """Three people: two synced from C360 under their CRM ID, one from an upload with the CRM's ID kept on the record."""
    for party, first, extra in (("ZA9001", "Ana", {}), ("ZA-UPL-2", "Ben", {"party_id": "ZA9002"}), ("ZA-UPL-3", "Cy", {})):
        _sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, custom_attributes) VALUES (%s, %s, %s, 'Attr', %s::jsonb) ON CONFLICT DO NOTHING",
             [party, T, first, json.dumps(extra)])


def test_a_source_synced_tags_at_send_a_push_and_the_tag_check(check, admin_email):
    with _world(admin_email) as (T, user):
        icrm, shop, points, tier, order = _crm(T, user)
        _customers(T)

        # Sync Now: a full read, by the CRM's ID wherever C360 keeps it
        run = attributes.queue(icrm, "MANUAL", user_id=user.pk)
        check("queued once: asking again gives the same run", attributes.queue(icrm, "MANUAL").pk == run.pk)
        CustomerAttributeSyncRun.objects.filter(pk=run.pk).update(params={"party_ids": PEOPLE})          # this test's people, not the whole local copy
        asked = []
        with mock.patch.object(attributes, "_setting", lambda key, default: 2 if key == "attributes.sync_batch_ids" else default):
            done = attributes.run_pending(alias="default", tenant_id=T, reader=fake_reader(asked))
        run.refresh_from_db()
        check("the run is done", done == {"done": 1, "failed": 0} and run.status == "DONE", f"{done} {run.status} {run.error}")
        mine = [a for a in asked if "ZA9001" in a[1] or "ZA9002" in a[1]]
        check("the table is read by the two CRM IDs, for the two fields", sorted(i for a in mine for i in a[1] if i in ("ZA9001", "ZA9002")) == ["ZA9001", "ZA9002"]
              and all(a[2] == ["POINTS_BALANCE", "TIER_END_DATE"] for a in asked), str(asked[:4]))
        values = attributes.values_of(["ZA9001", "ZA-UPL-2", "ZA-UPL-3"])
        check("Ana's values, typed", values.get("ZA9001") == {"za_points": 1240, "za_tier_end": "2026-12-31"}, str(values.get("ZA9001")))
        check("Ben's zero is kept and his empty date is not", values.get("ZA-UPL-2") == {"za_points": 0}, str(values.get("ZA-UPL-2")))
        check("Cy has no CRM ID: nothing", "ZA-UPL-3" not in values)
        ids = _sql("SELECT external_id, party_id FROM customer_external_id WHERE tenant_id = %s AND system = 'ICRM' AND party_id IN ('ZA9001', 'ZA-UPL-2') ORDER BY 1", [T], True)
        check("the IDs matched are remembered", ids == [("ZA9001", "ZA9001"), ("ZA9002", "ZA-UPL-2")], str(ids))
        icrm.refresh_from_db()
        check("the source says when it was read", icrm.last_sync_at is not None and str(icrm.last_sync_run_id) == str(run.pk))
        check("counted", run.people_matched >= 2 and run.values_changed >= 2, f"{run.people_matched} {run.values_changed}")

        # a push from Shopify, by Shopify's IDs; an unknown field is reported, an unknown person counted
        _sql("INSERT INTO customer_external_id (tenant_id, system, external_id, party_id) VALUES (%s, 'SHOPIFY', 'gid-1', 'ZA9001')", [T])
        from api.v1.attributes_api import PushView
        request = APIRequestFactory().post("/api/v1/customer-attributes/values/", {"system": "shopify", "people": [
            {"id": "gid-1", "values": {"last_order": "2026-11-20T09:14:00Z", "colour": "red"}}, {"id": "gid-404", "values": {"last_order": "2026-01-01"}}]}, format="json")
        force_authenticate(request, user=user)
        response = PushView.as_view()(request)
        check("the push is taken", response.status_code == 200 and response.data["matched"] == 1 and response.data["unknown_people"] == 1
              and response.data["ignored_fields"] == ["colour"], f"{response.status_code} {getattr(response, 'data', None)}")
        check("Ana now has both sources' values", attributes.values_of(["ZA9001"])["ZA9001"] == {"za_points": 1240, "za_tier_end": "2026-12-31", "za_last_order": "2026-11-20"},
              str(attributes.values_of(["ZA9001"])))
        # a second sync of the database replaces only its own row
        again = attributes.queue(icrm, "MANUAL")
        CustomerAttributeSyncRun.objects.filter(pk=again.pk).update(params={"party_ids": PEOPLE})
        attributes.run_one(str(again.pk), reader=lambda source, ids, fields: {"ZA9001": {"POINTS_BALANCE": 1300, "TIER_END_DATE": None}})
        check("the database's row is replaced, Shopify's untouched", attributes.values_of(["ZA9001"])["ZA9001"] == {"za_points": 1300, "za_last_order": "2026-11-20"},
              str(attributes.values_of(["ZA9001"])))

        # tags at send: a tag that names the attribute, a tag not in the catalogue named like one, and the list entry first
        tag = PersonalizationTag.objects.create(tenant_id=T, tag_key="za_balance", label="Balance", tag_kind="CUSTOM", source_system="CEP",
                                                resolution_source="CUSTOMER_ATTRIBUTE", source_path="za_points", default_value="your")
        content = type("C", (), {"html_content": "", "text_content": "Hi {{first_name}}: {{za_balance}} points, {{za_last_order}}, {{za_tier_end}}.",
                                 "subject_line": "", "preheader": ""})()
        campaign = type("Campaign", (), {"tenant_id": T, "name": "ZA", "subject_line": None, "preheader": None})()
        renderer = Renderer(campaign=campaign, run=None, content=content, tags=[tag])
        text = renderer.render(customer={"party_id": "ZA9001", "first_name": "Ana"}, member={"custom_value_pairs": {}}, system={})["text"]
        check("the attributes fill the tags", text == "Hi Ana: 1300 points, 2026-11-20, .", text)
        text = renderer.render(customer={"party_id": "ZA9001", "first_name": "Ana"}, member={"custom_value_pairs": {"za_points": "77", "za_tier_end": "2027-01-31"}}, system={})["text"]
        check("a value on the list entry comes first", text == "Hi Ana: 77 points, 2026-11-20, 2027-01-31.", text)
        text = renderer.render(customer={"party_id": "ZA-UPL-3", "first_name": "Cy"}, member={"custom_value_pairs": {}}, system={})["text"]
        check("no value: the tag's default", text == "Hi Cy: your points, , .", text)
        check("the data points offer the attributes", any(p["path"] == "za_points" for p in attributes.points()))
        from apps.templates import datapoints
        check("a tag may read an attribute that exists", datapoints.problem("CUSTOMER_ATTRIBUTE", "za_points", None) is None)
        check("and not one that does not", "No customer attribute" in (datapoints.problem("CUSTOMER_ATTRIBUTE", "za_nope", None) or ""))
        check("the platform catalogue never offers it", all(name != "Customer attribute" for name, _ in datapoints.choices()))

        # B: the Tag Check over a list, then Fill From Database for the ones without
        list_id = _sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count) VALUES (%s, 'ZA list', 'UPLOAD', 'PRODUCTION', 3) RETURNING id",
                       [T], True)[0][0]
        for party, values in (("ZA9001", {"store_name": "Midtown"}), ("ZA-UPL-2", {}), ("ZA-UPL-3", {"store_name": "Buckhead", "za_tier_end": "2030-01-01"})):
            _sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id, custom_attributes) VALUES (%s, %s, %s, %s::jsonb)", [list_id, T, party, json.dumps(values)])
        template = TemplateMaster.objects.create(tenant_id=T, name="ZA Tags", channel="SMS", status="ACTIVE", created_by_id=user.pk)
        RenderedTemplateContent.objects.create(template=template, version_number=1,
                                               sms_body="Hi {{first_name}}, {{za_balance}} pts at {{store_name}} until {{za_tier_end}}. {{unsubscribe_url}}")
        found = tag_values.template_tags(template)
        check("the template's personal tags, system tags left out", [t["key"] for t in found] == ["first_name", "za_balance", "store_name", "za_tier_end"], str(found))
        result = tag_values.tag_check(template, [str(list_id)], [])
        by_key = {t["key"]: t for t in result["tags"]}
        check("three people", result["people"] == 3, str(result["people"]))
        check("first name from the customer record", by_key["first_name"]["with_value"] == 3 and by_key["first_name"]["from"] == "CUSTOMER", str(by_key["first_name"]))
        check("the balance from the attributes, for two", by_key["za_balance"]["with_value"] == 2 and by_key["za_balance"]["from"] == "ATTRIBUTE", str(by_key["za_balance"]))
        check("the store from the list, two of three", by_key["store_name"]["with_value"] == 2 and by_key["store_name"]["from"] == "LIST", str(by_key["store_name"]))
        check("the tier end: one on the list, none from the attributes now", by_key["za_tier_end"]["with_value"] == 1, str(by_key["za_tier_end"]))
        check("tags short and what can be filled", result["short"] == 3 and {f["tag"]: f["attribute"] for f in result["fillable"]}.get("za_tier_end") == "za_tier_end",
              str(result["fillable"]))

        fill = attributes.queue(None, "FILL", params={"include": [str(list_id)], "exclude": [], "tags": [{"tag": "za_tier_end", "attribute": "za_tier_end"},
                                                                                                      {"tag": "za_balance", "attribute": "za_points"}]})
        CRM_ROWS["ZA9002"]["TIER_END_DATE"] = date(2027, 6, 30)
        try:
            ok = attributes.run_one(str(fill.pk), reader=fake_reader([]))
        finally:
            CRM_ROWS["ZA9002"]["TIER_END_DATE"] = None
        fill.refresh_from_db()
        members = dict(_sql("SELECT party_id, custom_attributes FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s", [T, list_id], True))
        members = {k: (json.loads(v) if isinstance(v, str) else v) for k, v in members.items()}
        check("the fill ran", ok and fill.status == "DONE", f"{fill.status} {fill.error}")
        check("Ben's entry gets his new tier end and his balance", members["ZA-UPL-2"].get("za_tier_end") == "2027-06-30" and members["ZA-UPL-2"].get("za_balance") == 0,
              str(members["ZA-UPL-2"]))
        check("a value the entry already had stays", members["ZA-UPL-3"].get("za_tier_end") == "2030-01-01", str(members["ZA-UPL-3"]))
        check("Ana's balance, read afresh, is copied onto her entry", members["ZA9001"].get("za_balance") == 1240 and members["ZA9001"].get("store_name") == "Midtown", str(members["ZA9001"]))

        # the API: removing an attribute a tag reads is refused
        from api.v1.attributes_api import AttributeView, AttributesView
        request = APIRequestFactory().delete(f"/api/v1/customer-attributes/{points.pk}/")
        force_authenticate(request, user=user)
        response = AttributeView.as_view()(request, pk=points.pk)
        check("a tag reads it: not removed", response.status_code == 409, str(response.status_code))
        request = APIRequestFactory().post("/api/v1/customer-attributes/", {"key": "first_name", "label": "First"}, format="json")
        force_authenticate(request, user=user)
        response = AttributesView.as_view()(request)
        check("a key C360 fills itself is refused", response.status_code == 400 and "key" in str(response.data), f"{response.status_code} {getattr(response, 'data', '')}")
        request = APIRequestFactory().post("/api/v1/customer-attributes/", {"key": "za_fav", "label": "Favourite Store", "source": str(shop.pk), "make_tag": True}, format="json")
        force_authenticate(request, user=user)
        response = AttributesView.as_view()(request)
        check("an API attribute is added, with its tag", response.status_code == 201 and response.data["refresh"] == "ON_CHANGE" and response.data["source_field"] == "za_fav"
              and PersonalizationTag.objects.filter(tag_key="za_fav", resolution_source="CUSTOMER_ATTRIBUTE").exists(), f"{response.status_code} {getattr(response, 'data', '')}")
    check.done()


FILE = ("Email,First Name,Store Name,Coupon,Party ID\r\n"
        "za.one@example.test,Ana,Midtown,BF25-1,ZA9001\r\n"
        "za.two@example.test,Ben,,BF25-2,ZA9002\r\n"
        "za.three@example.test,Cy,Buckhead,BF25-3,\r\n").encode("utf-8")


def test_an_upload_with_its_tag_values_through_the_worker(check, admin_email):
    real_tx = session.tx

    @contextmanager
    def worker_tx():
        with real_tx():
            yield
        _forget_tenant()

    with _world(admin_email) as (T, user), mock.patch.object(jobs, "kick", lambda: None), mock.patch.object(jobs, "assert_room", lambda *a, **k: None):
        icrm, shop, points, tier, order = _crm(T, user)
        _customers(T)
        template = TemplateMaster.objects.create(tenant_id=T, name="ZA Upload", channel="EMAIL", status="ACTIVE", created_by_id=user.pk)
        RenderedTemplateContent.objects.create(template=template, version_number=1, subject_line="{{first_name}}, your code",
                                               html_content="<p>{{store_name}} · {{offer_code}} · {{za_points}} · {{za_tier_end}}</p>")
        contact_list = ContactList.objects.create(tenant_id=T, name=f"ZA Upload {T[:4]}", created_by_id=user.pk, source_type="UPLOAD", list_environment="PRODUCTION", status="ACTIVE")
        record = imports.accept(contact_list, SimpleUploadedFile("tags.csv", FILE, content_type="text/csv"), user_id=user.pk)

        options = tag_values.options(record, str(template.pk), {"email": "Email", "first_name": "First Name", "party_id": "Party ID"})
        suggested = {t["key"]: t["suggested"] for t in options["tags"]}
        check("the step offers the template's tags", [t["key"] for t in options["tags"]] == ["first_name", "store_name", "offer_code", "za_points", "za_tier_end"], str(options["tags"]))
        check("suggested: the record, a column of the same name, attributes, the default",
              suggested == {"first_name": {"from": "CUSTOMER"}, "store_name": {"from": "FILE", "column": "Store Name"}, "offer_code": {"from": "DEFAULT"},
                            "za_points": {"from": "ATTRIBUTE", "attribute": "za_points"}, "za_tier_end": {"from": "ATTRIBUTE", "attribute": "za_tier_end"}}, str(suggested))
        check("the free columns", [c["name"] for c in options["columns"]] == ["Store Name", "Coupon"], str(options["columns"]))

        refused = None
        try:
            imports.confirm_mapping(record, {"email": "Email", "first_name": "First Name", "party_id": "Party ID"},
                                    {"template_id": str(template.pk), "tags": {"offer_code": {"from": "FILE", "column": "Nope"}}}, with_tags=True)
        except imports.ImportError_ as exc:
            refused = str(exc)
        check("a column the file does not have is refused", refused is not None and "offer_code" in refused, str(refused))
        asked = []

        def worker(step):
            job = jobs.claim("default", T)
            _forget_tenant()
            errors = []
            with mock.patch.object(session, "tx", worker_tx), mock.patch.object(attributes.Reader, "__call__", lambda self, source, ids, fields: fake_reader(asked)(source, ids, fields)), \
                    mock.patch.object(jobs.log, "exception", lambda *a, **k: errors.append(traceback.format_exc().strip().splitlines()[-1])):
                ok = job is not None and job[2] == step and jobs._run(str(job[0]), str(job[1]), job[2], job[3])
            _sql("SELECT set_config('app.current_tenant', %s, false)", [T])
            row = ContactListImport.objects.select_related("contact_list").get(pk=record.pk)
            check(f"{step}: the worker finishes it", bool(ok) and row.error is None, f"job={job} status={row.status} error={row.error} logged={errors}")
            return row

        row = worker("STAGE")
        imports.confirm_mapping(row, {"email": "Email", "first_name": "First Name", "party_id": "Party ID"},
                                {"template_id": str(template.pk), "tags": {"first_name": {"from": "CUSTOMER"}, "store_name": {"from": "FILE", "column": "Store Name"},
                                                                           "offer_code": {"from": "FILE", "column": "Coupon"}, "za_points": {"from": "ATTRIBUTE", "attribute": "za_points"},
                                                                           "za_tier_end": {"from": "DEFAULT"}}}, with_tags=True)
        row = worker("REVIEW")
        result = (row.tag_values or {}).get("result") or {}
        counts = {k: (v["with_value"], v["sample"]) for k, v in (result.get("tags") or {}).items()}
        check("three rows ready", result.get("ready") == 3, str(result))
        check("first names from the file or the record", counts.get("first_name") == (3, "Ana"), str(counts))
        check("the store: two of three", counts.get("store_name") == (2, "Midtown"), str(counts))
        check("the coupon: all", counts.get("offer_code") == (3, "BF25-1"), str(counts))
        check("the balance read from the CRM for the two with an ID", counts.get("za_points") == (2, "1240"), str(counts))
        check("the default counts nobody", counts.get("za_tier_end") == (0, None), str(counts))
        check("the CRM was asked for the file's IDs", any(sorted(a[1]) == ["ZA9001", "ZA9002"] and a[2] == ["POINTS_BALANCE"] for a in asked), str(asked))

        check("reviewed and waiting", row.status == "REVIEW" and not row.next_action, f"{row.status} {row.next_action}")
        ContactListImport.objects.filter(pk=row.pk).update(attested_at=timezone.now())
        try:
            imports.request_apply(ContactListImport.objects.select_related("contact_list").get(pk=row.pk))
        except imports.ImportError_ as exc:
            check("the import can be applied", False, str(exc))
            check.done()
        row = worker("APPLY")
        members = _sql("""SELECT m.custom_attributes FROM contact_list_member m JOIN customer_master cm ON cm.party_id = m.party_id AND cm.tenant_id = m.tenant_id
                           WHERE m.tenant_id = %s AND m.contact_list_id = %s ORDER BY cm.first_name""", [T, str(contact_list.pk)], True)
        members = [json.loads(m) if isinstance(m, str) else m for (m,) in members]
        if not check("three entries", len(members) == 3 and row.applied_count == 3, f"{len(members)} {row.applied_count}"):
            check.done()
        ana = members[0]
        check("the file's other columns kept under their own names", ana.get("store_name") == "Midtown" and ana.get("coupon") == "BF25-1", str(ana))
        check("the tag values kept under the tags' keys", ana.get("offer_code") == "BF25-1" and ana.get("za_points") == 1240, str(ana))
        check("an empty cell is not kept", "store_name" not in members[1] and members[1].get("za_points") == 0, str(members[1]))
        check("nothing read for someone without an ID", "za_points" not in members[2], str(members[2]))
        runs = CustomerAttributeSyncRun.objects.filter(source=icrm, trigger="IMPORT")
        check("the database values are kept with the customers too", runs.count() == 1 and runs[0].status == "DONE" and runs[0].people_matched == 2,
              str([(r.status, r.people_matched) for r in runs]))
    check.done()


def test_any_number_of_tags_go_onto_a_list_entry(check):
    """PostgreSQL takes 100 arguments a function call: 120 tags from the file must still all be kept."""
    keys = [f"tag_{n:03d}" for n in range(120)]
    record = ContactListImport(file_columns=[{"name": f"Col {n}"} for n in range(120)], column_mapping={},
                               tag_values={"template_id": "x", "tags": {key: {"from": "FILE", "column": f"Col {n}"} for n, key in enumerate(keys)}})
    expression, params = tag_values.member_sql(record)
    raw = {f"Col {n}": f"v{n}" for n in range(120)}
    with connections["default"].cursor() as cursor:
        cursor.execute(f"SELECT {expression} FROM (SELECT %(raw)s::jsonb AS raw) r", {**params, "raw": json.dumps(raw)})
        kept = cursor.fetchone()[0]
    kept = json.loads(kept) if isinstance(kept, str) else kept
    check("every tag kept under its key", all(kept.get(key) == f"v{n}" for n, key in enumerate(keys)), str(len(kept)))
    check.done()


def test_the_send_reads_nothing_more_when_the_list_carries_the_values(check, admin_email):
    from django.test.utils import CaptureQueriesContext
    with _world(admin_email) as (T, user):
        icrm, shop, points, tier, order = _crm(T, user)
        _customers(T)
        tag = PersonalizationTag.objects.create(tenant_id=T, tag_key="za_balance", label="Balance", tag_kind="CUSTOM", source_system="CEP",
                                                resolution_source="CUSTOMER_ATTRIBUTE", source_path="za_points", default_value="your")
        content = type("C", (), {"html_content": "", "text_content": "{{first_name}}: {{za_balance}} · {{store_name}} · {{offer_code}}", "subject_line": "", "preheader": ""})()
        campaign = type("Campaign", (), {"tenant_id": T, "name": "ZA", "subject_line": None, "preheader": None})()
        renderer = Renderer(campaign=campaign, run=None, content=content, tags=[tag])
        member = {"custom_value_pairs": {"za_points": 50, "store_name": "Midtown", "offer_code": "BF25"}}
        with CaptureQueriesContext(connections["default"]) as queries:
            for party in ("ZA9001", "ZA-UPL-2", "ZA-UPL-3"):
                renderer.render(customer={"party_id": party, "first_name": "Ana"}, member=member, system={})
        check("the list's values: no query at all, whatever the number of people", len(queries) == 0, str([q["sql"][:80] for q in queries]))
        renderer = Renderer(campaign=campaign, run=None, content=content, tags=[tag])
        with CaptureQueriesContext(connections["default"]) as first:
            renderer.render(customer={"party_id": "ZA9001", "first_name": "Ana"}, member={"custom_value_pairs": {}}, system={})
        with CaptureQueriesContext(connections["default"]) as second:
            renderer.render(customer={"party_id": "ZA-UPL-2", "first_name": "Ben"}, member={"custom_value_pairs": {}}, system={})
        reads = lambda q: [x for x in q if "customer_attribute_values" in x["sql"]]      # noqa: E731
        check("a person without list values: one read of their attributes", len(reads(first)) == 1 and len(reads(second)) == 1,
              f"{len(reads(first))} {len(reads(second))}")
        check("the workspace's attribute list is read once per send, not per person", not any("customer_attribute_definition" in x["sql"] for x in second),
              str([x["sql"][:60] for x in second]))
    check.done()


def test_look_up_in_c360_with_tag_values_chosen_while_it_runs_and_changed_after_the_check(check, admin_email):
    """A file of IDs: the Tag Values step is answered while the lookup still runs (the check reads them), then changed after the check
    (the TAGS job reads them alone, without checking the file again); importing waits for it."""
    import random
    from apps.contact_lists import lookup
    from apps.insights import external
    real_tx = session.tx

    @contextmanager
    def worker_tx():
        with real_tx():
            yield
        _forget_tenant()

    phones = {i: f"90{random.randint(10_000_000, 99_999_999)}" for i in ("ZA9001", "ZA9002")}
    crm = {i: {"status": "PARTY_ENABLED", "first_name": n, "last_name": "Attr", "loyalty_id": None, "timezone": None, "has_role": True, "customer": True,
               "phone": {"digits": phones[i], "valid": None, "dnd": None, "allow": "Y", "since": "2026-01-05", "ended": False}, "email": None, "postal_code": None}
           for i, n in (("ZA9001", "Ana"), ("ZA9002", "Ben"))}

    class Closed:
        def close(self):
            pass

    with _world(admin_email) as (T, user), mock.patch.object(jobs, "kick", lambda: None), mock.patch.object(jobs, "assert_room", lambda *a, **k: None), \
            mock.patch.object(lookup, "read", lambda conn, ids, role: {i: dict(crm[i]) for i in ids if i in crm}), \
            mock.patch.object(external, "connect", lambda row, **k: Closed()):
        icrm, shop, points, tier, order = _crm(T, user)
        _sql("UPDATE report_connection SET use_for_lists = FALSE WHERE tenant_id = %s", [T])
        _sql("UPDATE report_connection SET use_for_lists = TRUE, status = 'ACTIVE' WHERE tenant_id = %s AND id = %s", [T, str(icrm.report_connection_id)])
        template = TemplateMaster.objects.create(tenant_id=T, name="ZA Lookup", channel="SMS", status="ACTIVE", created_by_id=user.pk)
        RenderedTemplateContent.objects.create(template=template, version_number=1, sms_body="Hi {{first_name}}, {{za_points}} points, store {{store}}")
        contact_list = ContactList.objects.create(tenant_id=T, name=f"ZA Lookup {T[:4]}", created_by_id=user.pk, source_type="UPLOAD", list_environment="PRODUCTION",
                                                  status="ACTIVE", channel="SMS")
        plan = lookup.plan(T, [], "CUSTOMER")
        record = imports.accept(contact_list, SimpleUploadedFile("ids.csv", b"Customer ID,Store\r\nZA9001,Midtown\r\nZA9002,Buckhead\r\n", content_type="text/csv"),
                                user_id=user.pk, lookup=plan)
        options = tag_values.options(record, str(template.pk))
        check("the step offers the file's other column, not its ID column", [c["name"] for c in options["columns"]] == ["Store"], str(options["columns"]))
        record = imports.save_tag_values(record, {"template_id": str(template.pk), "tags": {"za_points": {"from": "ATTRIBUTE", "attribute": "za_points"},
                                                                                            "store": {"from": "FILE", "column": "Store"}}})
        check("kept before anything ran, nothing queued for it", record.tag_values["tags"]["store"] == {"from": "FILE", "column": "Store"} and record.next_action == "STAGE")
        asked = []

        def worker(step):
            job = jobs.claim("default", T)
            _forget_tenant()
            errors = []
            with mock.patch.object(session, "tx", worker_tx), mock.patch.object(attributes.Reader, "__call__", lambda self, source, ids, fields: fake_reader(asked)(source, ids, fields)), \
                    mock.patch.object(jobs.log, "exception", lambda *a, **k: errors.append(traceback.format_exc().strip().splitlines()[-1])):
                ok = job is not None and job[2] == step and jobs._run(str(job[0]), str(job[1]), job[2], job[3])
            _sql("SELECT set_config('app.current_tenant', %s, false)", [T])
            row = ContactListImport.objects.select_related("contact_list").get(pk=record.pk)
            check(f"{step}: the worker finishes it", bool(ok) and row.error is None, f"job={job} status={row.status} error={row.error} logged={errors}")
            return row

        worker("STAGE")
        worker("LOOKUP")
        row = worker("REVIEW")
        counts = {k: (x["with_value"], x["sample"]) for k, x in ((row.tag_values or {}).get("result") or {}).get("tags", {}).items()}
        check("the check counted the values chosen while it ran", counts == {"za_points": (2, "1240"), "store": (2, "Midtown")} and row.next_action is None, f"{counts} {row.next_action}")

        # changed after the check: read again on their own
        row = imports.save_tag_values(row, {"template_id": str(template.pk), "tags": {"za_points": {"from": "DEFAULT"}, "store": {"from": "FILE", "column": "Store"}}})
        check("changed after the check: the TAGS job is queued and the import waits for it", row.next_action == "TAGS" and not (row.tag_values or {}).get("result"), str(row.next_action))
        refused = None
        try:
            imports.request_apply(ContactListImport.objects.select_related("contact_list").get(pk=row.pk))
        except imports.ImportError_ as exc:
            refused = str(exc)
        check("importing waits", refused is not None)
        from api.v1.contact_lists_api import import_payload
        payload = import_payload(ContactListImport.objects.select_related("contact_list", "created_by").get(pk=row.pk))
        check("the payload says what it is doing", payload["phase"] == "Waiting to read the tag values" and payload["working"], payload["phase"])
        summary_before = row.summary
        row = worker("TAGS")
        counts = {k: (x["with_value"], x["sample"]) for k, x in ((row.tag_values or {}).get("result") or {}).get("tags", {}).items()}
        check("TAGS: the new figures, the check itself untouched", counts == {"za_points": (0, None), "store": (2, "Midtown")} and row.status == "REVIEW"
              and row.next_action is None and row.summary == summary_before, f"{counts} {row.status} {row.next_action}")

        ContactListImport.objects.filter(pk=row.pk).update(attested_at=timezone.now())
        imports.request_apply(ContactListImport.objects.select_related("contact_list").get(pk=row.pk))
        row = worker("APPLY")
        members = [json.loads(m) if isinstance(m, str) else m for (m,) in _sql(
            "SELECT custom_attributes FROM contact_list_member WHERE tenant_id = %s AND contact_list_id = %s ORDER BY custom_attributes ->> 'store'", [T, str(contact_list.pk)], True)]
        check("the entries carry the file's store under the tag, and no ID column", [m.get("store") for m in members] == ["Buckhead", "Midtown"]
              and not any("customer_id" in m for m in members) and not any("za_points" in m for m in members), str(members))
    check.done()
