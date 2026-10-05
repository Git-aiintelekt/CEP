"""Platform personalization tags (patch 0026) against the local database, rolled back. Everything on the default connection:
the platform table is writable by the app role, and a row made on the platform alias would be invisible to the API's connection.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
import uuid
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.identity.models import AppUser
from apps.platform_ops.admin import PlatformPersonalizationTagForm
from apps.platform_ops.models import PlatformPersonalizationTag
from apps.templates import datapoints, inherit
from apps.templates.models import PersonalizationTag
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_platform_tags(check, admin_email):
    """Platform personalization tags (patch 0026) against the local database, rolled back. Everything on the default connection:"""
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None):
        if method in ("get", "delete"):
            return getattr(c, method)(path, **H)
        return getattr(c, method)(path, json.dumps(body or {}), content_type="application/json", **H)

    # ---- the data points, no database
    check("fixed data points, typed ones, static and the wrong ones are told apart",
          datapoints.problem("CUSTOMER_MASTER", "first_name", None) is None
          and datapoints.problem("CUSTOMER_MASTER", "custom_attributes.loyalty_tier", None) is None
          and "key" in (datapoints.problem("CUSTOMER_MASTER", "custom_attributes.", None) or "")
          and "Not a customer data point" in (datapoints.problem("CUSTOMER_MASTER", "emails", None) or "")
          and datapoints.problem("CAMPAIGN_LIST_MEMBER", "custom_value_pairs.tier", None) is None
          and "custom_value_pairs" in (datapoints.problem("CAMPAIGN_LIST_MEMBER", "tier", None) or "")
          and datapoints.problem("CAMPAIGN", "code", None) is None and "offers" in (datapoints.problem("CAMPAIGN", "budget", None) or "")
          and datapoints.problem("STATIC", "", "1-800") is None and "static value" in (datapoints.problem("STATIC", "", " ") or "")
          and "leave the path empty" in (datapoints.problem("STATIC", "x", "1") or "") and "Choose" in (datapoints.problem("NOPE", "x", None) or "")
          and datapoints.data_type_of("RECEIPT", "receipt.grand_total") == "NUMBER" and datapoints.data_type_of("CUSTOMER_MASTER", "custom_attributes.x") is None)
    groups = dict(datapoints.choices())
    check("the picker lists every source with its points, and Static as one entry", set(groups) == set(datapoints.SOURCES.values()) and groups["Static value"] == [("STATIC|", "A fixed value, typed under Static value")]
          and ("CUSTOMER_MASTER|first_name", "First Name") in groups["Customer"], str(list(groups)))

    # ---- the back-office form, no database
    def form(**data):
        base = {"tag_key": "loyalty_tier", "label": "Loyalty Tier", "tag_kind": "CUSTOM", "data_point": "CUSTOMER_MASTER|first_name", "source_path": "",
                "data_type": "STRING", "applies_to_channels": ["EMAIL", "SMS"], "sample_value": "Gold", "is_active": True}
        return PlatformPersonalizationTagForm(data={**base, **data})

    fixed = form()
    typed = form(data_point="CAMPAIGN_LIST_MEMBER|custom_value_pairs.", source_path="tier")
    full = form(data_point="CUSTOMER_MASTER|custom_attributes.", source_path="custom_attributes.points")
    static = form(data_point="STATIC|", static_value="1-800-555-0100")
    check("a fixed data point sets the source and path; a typed key is completed with its prefix; static keeps only its value",
          fixed.is_valid() and fixed.cleaned_data["resolution_source"] == "CUSTOMER_MASTER" and fixed.cleaned_data["source_path"] == "first_name"
          and typed.is_valid() and typed.cleaned_data["source_path"] == "custom_value_pairs.tier"
          and full.is_valid() and full.cleaned_data["source_path"] == "custom_attributes.points"
          and static.is_valid() and static.cleaned_data["resolution_source"] == "STATIC" and static.cleaned_data["source_path"] is None and static.cleaned_data["static_value"] == "1-800-555-0100",
          f"{fixed.errors} {typed.errors} {full.errors} {static.errors}")
    bad_key = form(tag_key="First Name")
    no_static = form(data_point="STATIC|", static_value="")
    no_key = form(data_point="CAMPAIGN_LIST_MEMBER|custom_value_pairs.", source_path="")
    check("a key with spaces, a static tag without its value and a typed point without its key are refused, in words",
          not bad_key.is_valid() and "tag_key" in bad_key.errors and not no_static.is_valid() and "static_value" in no_static.errors
          and not no_key.is_valid() and "source_path" in no_key.errors, f"{bad_key.errors} {no_static.errors} {no_key.errors}")

    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])          # the workspace table's audit trigger
        seeded = PlatformPersonalizationTag.objects.using("default").filter(is_active=True).count()
        check("the patch seeded the standard catalogue", seeded >= 9, str(seeded))

        # ---- one platform tag into the workspace
        tag = PlatformPersonalizationTag.objects.using("default").create(
            tag_key="zp_loyalty_tier", label="Loyalty Tier", tag_kind="CUSTOM", resolution_source="CUSTOMER_MASTER", source_path="custom_attributes.loyalty_tier",
            data_type="STRING", applies_to_channels=["EMAIL", "SMS"], sample_value="Gold", default_value="Member", description="The person's tier")
        first = inherit.apply_to_tenant(tag, TENANT, using="default", user_id=admin.pk)
        copy = PersonalizationTag.objects.using("default").get(tenant_id=TENANT, tag_key="zp_loyalty_tier")
        again = inherit.apply_to_tenant(tag, TENANT, using="default")
        check("the workspace gets a linked copy with every field; a second pass changes nothing",
              first == "added" and again == "unchanged" and str(copy.platform_tag_id) == str(tag.id) and copy.label == "Loyalty Tier" and copy.source_path == "custom_attributes.loyalty_tier"
              and copy.sample_value == "Gold" and copy.default_value == "Member" and copy.applies_to_channels == ["EMAIL", "SMS"] and copy.is_active, f"{first} {again}")
        tag.label, tag.sample_value = "Loyalty Level", "Platinum"
        tag.save(using="default")
        changed = inherit.apply_to_tenant(tag, TENANT, using="default")
        copy.refresh_from_db(using="default")
        check("a changed platform tag updates its copy", changed == "updated" and copy.label == "Loyalty Level" and copy.sample_value == "Platinum", changed)

        # ---- the workspace's own tag with the same key is left alone
        own = api("post", "/api/v1/personalization-tags/", {"tag_key": "zp_store_hours", "label": "Store Hours", "tag_kind": "CUSTOM", "source_system": "CEP", "resolution_source": "STATIC",
                                                             "static_value": "9-9", "data_type": "STRING", "applies_to_channels": ["EMAIL"], "sample_value": "9-9", "is_active": True})
        clash = PlatformPersonalizationTag.objects.using("default").create(tag_key="zp_store_hours", label="Store Hours (platform)", resolution_source="STATIC", static_value="10-8", data_type="STRING")
        kept = inherit.apply_to_tenant(clash, TENANT, using="default")
        theirs = PersonalizationTag.objects.using("default").get(tenant_id=TENANT, tag_key="zp_store_hours")
        check("a tag the workspace made itself with the same key is kept, unlinked and unchanged",
              own.status_code == 201 and kept == "kept" and theirs.platform_tag_id is None and theirs.static_value == "9-9", f"{own.status_code} {kept}")

        # ---- the workspace API: inherited is read-only, its own is not
        listed = api("get", "/api/v1/personalization-tags/?page_size=500").json()
        rows = {row["tag_key"]: row for row in listed["results"]}
        patched = api("patch", f"/api/v1/personalization-tags/{copy.id}/", {"label": "Mine now"})
        deleted = api("delete", f"/api/v1/personalization-tags/{copy.id}/")
        own_patched = api("patch", f"/api/v1/personalization-tags/{own.json()['id']}/", {"label": "Opening Hours"})
        own_deleted = api("delete", f"/api/v1/personalization-tags/{own.json()['id']}/")
        check("the API lists the inherited copy with its link, refuses to change or delete it with a plain message, and lets the workspace's own tag be changed and deleted",
              rows["zp_loyalty_tier"]["platform_tag_id"] == str(tag.id) and patched.status_code == 403 and "back-office" in patched.json()["detail"]
              and deleted.status_code == 403 and own_patched.status_code == 200 and own_patched.json()["label"] == "Opening Hours" and own_deleted.status_code == 204,
              f"{patched.status_code} {patched.content[:120]} {deleted.status_code} {own_patched.status_code} {own_deleted.status_code}")
        forged = api("patch", f"/api/v1/personalization-tags/{copy.id}/", {"platform_tag_id": None})
        check("the link itself cannot be written from the workspace", forged.status_code == 403, str(forged.status_code))

        # ---- switching a platform tag off, and the whole catalogue into a workspace
        tag.is_active = False
        tag.save(using="default")
        off = inherit.apply_to_tenant(tag, TENANT, using="default")
        copy.refresh_from_db(using="default")
        gone = api("get", "/api/v1/personalization-tags/?page_size=500").json()["results"]
        check("a platform tag switched off switches its copies off, and they leave the workspace's list", off == "updated" and copy.is_active is False and all(r["tag_key"] != "zp_loyalty_tier" for r in gone), off)
        counts = inherit.inherit_platform_tags(TENANT, using="default", user_id=admin.pk)
        active = PlatformPersonalizationTag.objects.using("default").filter(is_active=True).count()
        check("inheriting the catalogue touches every active platform tag once and never a workspace's own",
              sum(counts.values()) == active and counts["kept"] >= 1 and counts["added"] + counts["updated"] + counts["unchanged"] + counts["kept"] == active, str(counts))
        outcomes = inherit.push_platform_tag(clash, using="default", user_id=admin.pk)
        check("pushing one tag reports each workspace by outcome (the copy was added by the inherit above), and the summary reads as a sentence",
              CODE in outcomes["unchanged"] and inherit.summary(outcomes) == "1 unchanged"
              and inherit.summary({"added": ["A", "B"], "updated": [], "unchanged": [], "kept": ["NWA"]}) == "2 added; kept their own tag with this key: NWA"
              and inherit.summary({"added": [], "updated": [], "unchanged": [], "kept": []}) == "nothing to change",
              f"{outcomes} | {inherit.summary(outcomes)}")

        transaction.set_rollback(True)
    check.done()
