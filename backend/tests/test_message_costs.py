"""What texts cost (patch 0099, apps/delivery/costs.py, docs/mockups/sms-mms-costs.html): rates set in the back-office, the workspace
seeing prices only, the estimate before a send, the workspace's limits at publish, the actual cost after, and WhatsApp's rate card.

The rates are written on the platform connection, as the back-office writes them, so the workspace-side reads here run on the same
connection (a tenant context on the platform alias): a rolled-back test cannot see one connection's rows from the other. The column
grants that keep costs from the workspace are checked on the workspace's own connection. Every change is rolled back."""
import io
import json
import uuid
from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.conf import settings
from django.db import ProgrammingError, connections, transaction
from django.test import Client
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.campaigns import approval
from apps.campaigns.models import Campaign, ContactListCampaign
from apps.delivery import costs, countries
from apps.delivery.models import DeliveryProvider, SenderProfile, WhatsAppRate
from apps.identity.models import AppUser
from apps.platform_ops import admin_rates
from apps.templates.models import RenderedTemplateContent, TemplateMaster
from apps.tenants import context
from apps.tenants.models import Tenant

P = settings.PLATFORM_ALIAS
NWA = "a0000000-0000-4000-8000-000000000001"


# ---------------------------------------------------------------------------------------------------- without the database
def test_countries_and_the_rate_a_message_gets(check):
    check("a US number", countries.country_of("+14045550100") == "US")
    check("a Canadian area code", countries.country_of("+14165550100") == "CA")
    check("a Caribbean area code", countries.country_of("+18685551234") == "TT")
    check("the UK", countries.country_of("+447911123456") == "GB")
    check("Kazakhstan inside +7", countries.country_of("+77011234567") == "KZ")
    check("nothing for nonsense", countries.country_of("hello") is None)
    check("a short code", countries.sender_type("55123") == "SHORT_CODE")
    check("a toll-free number", countries.sender_type("+1 888 555 0142") == "TOLL_FREE")
    check("letters", countries.sender_type("CITITRND") == "ALPHANUMERIC")
    check("a long code", countries.sender_type("+14045550100") == "LONG_CODE")
    check("Meta's North America", countries.market_for("US", ["North America", "Other"]) == "North America")
    check("a market of its own beats the group", countries.market_for("US", ["United States", "North America"]) == "United States")
    check("Jamaica in Rest of Latin America", countries.market_for("JM", ["Rest of Latin America", "Other"]) == "Rest of Latin America")
    check("Other catches the rest", countries.market_for("IS", ["United Kingdom", "Other"]) == "Other")
    check("no market without Other", countries.market_for("IS", ["United Kingdom"]) is None)

    today = date(2026, 11, 25)
    engine = str(uuid.uuid4())

    def row(sender_type="ANY", country=None, start=date(2026, 10, 1), until=None, price="0.0075"):
        return {"id": uuid.uuid4(), "delivery_provider_id": engine, "sender_type": sender_type, "country_code": country, "effective_from": start, "effective_until": until,
                "sms_price": Decimal(price), "mms_price": None, "carrier_fees": "PASS_ON", "fee_part_price": Decimal("0.0030"), "fee_mms_price": Decimal("0")}
    book = costs.RateBook(None, rows=[row(price="0.0070"), row("SHORT_CODE", price="0.0075"), row(country="GB", price="0.0400"),
                                      row("SHORT_CODE", start=date(2027, 1, 1), price="0.0080"), row("TOLL_FREE", until=date(2026, 10, 31), price="0.0099")])
    check("a short code row beats the Any row", book.price(engine, "SHORT_CODE", "US", today, "SMS").unit == Decimal("0.0075"))
    check("a country row beats the sender type", book.price(engine, "SHORT_CODE", "GB", today, "SMS").unit == Decimal("0.0400"))
    check("an ended rate is not used", book.price(engine, "TOLL_FREE", "US", today, "SMS").unit == Decimal("0.0070"))
    check("a rate starting later is used from its day", book.price(engine, "SHORT_CODE", "US", date(2027, 1, 2), "SMS").unit == Decimal("0.0080"))
    check("no MMS price, no MMS rate", book.price(engine, "SHORT_CODE", "US", today, "MMS") is None)
    check("another engine has no rate", book.price(str(uuid.uuid4()), "ANY", "US", today, "SMS") is None)
    check.done()


# ---------------------------------------------------------------------------------------------------- end to end, on the platform connection
pytestmark_db = pytest.mark.django_db(databases=["default", "platform"])


def _sql(statement, args=None, fetch=False):
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [NWA])
        cursor.execute(statement, args or [])
        return cursor.fetchall() if fetch else None


def _people(names):
    """ZC people with US numbers, opted in to texts, in one list: -> list id"""
    for index, name in enumerate(names, start=1):
        party = f"ZC-P{index:02d}"
        _sql("INSERT INTO customer_master (party_id, tenant_id, first_name, last_name, phones) VALUES (%s, %s, %s, 'Test', %s::jsonb)",
             [party, NWA, name, json.dumps([{"number": f"+1470555{1200 + index}", "type": "MOBILE", "is_primary": True}])])
        _sql("INSERT INTO consent_suppression (tenant_id, party_id, channel, consent_status, marketable, opted_in_at) VALUES (%s, %s, 'SMS', 'OPTED_IN', TRUE, now())", [NWA, party])
    list_id = _sql("INSERT INTO contact_list (tenant_id, name, source_type, list_environment, member_count) VALUES (%s, 'ZC list', 'UPLOAD', 'PRODUCTION', %s) RETURNING id",
                   [NWA, len(names)], True)[0][0]
    for index in range(1, len(names) + 1):
        _sql("INSERT INTO contact_list_member (contact_list_id, tenant_id, party_id) VALUES (%s, %s, %s)", [list_id, NWA, f"ZC-P{index:02d}"])
    return list_id


def _sent(campaign, provider, rows):
    """sms_execution rows as the send worker leaves them: (status, parts, kind, extra columns)"""
    run = str(uuid.uuid4())
    for index, (status, parts, kind, extra) in enumerate(rows):
        columns = {"tenant_id": NWA, "campaign_id": str(campaign.pk), "campaign_run_id": run, "party_id": f"ZC-P{index + 1:02d}", "phone_number": f"+1470555{1201 + index}",
                   "message_type": kind, "idempotency_key": f"zc-{run}-{index}", "status": status, "segment_count": parts, "from_sender_id": "55123",
                   "provider_code": "DIGIVIZE", "delivery_provider_id": str(provider.pk), "submitted_at": "now()", **extra}
        names = list(columns)
        values = ["now()" if columns[name] == "now()" else "%s" for name in names]
        _sql(f"INSERT INTO sms_execution ({', '.join(names)}) VALUES ({', '.join(values)})", [columns[name] for name in names if columns[name] != "now()"])


@pytestmark_db
def test_estimate_limits_and_actual_cost(check, admin_email):
    token = context.set_current(NWA, P)
    try:
        with transaction.atomic(using=P), mock.patch.object(admin_rates, "P", P), mock.patch.object(costs, "P", P):
            _scenario(check, admin_email)
    finally:
        context.reset(token)
    check.done()


def _scenario(check, admin_email):
    tenant = Tenant.objects.using(P).get(pk=NWA)
    admin = AppUser.objects.using(P).get(email=admin_email)
    list_id = _people(["Ann", "Bob", "Bartholomew-Alexander Montgomery-Featherstonehaugh"])
    engine = DeliveryProvider.objects.using(P).create(tenant=tenant, provider_type="DIGIVIZE", channel="SMS", name="ZC Digivize")
    sender = SenderProfile.objects.using(P).create(tenant=tenant, delivery_provider=engine, channel="SMS", display_name="ZC Shop", sender_id="55123", verification_status="VERIFIED")
    template = TemplateMaster.objects.using(P).create(tenant=tenant, name="ZC text", channel="SMS", status="ACTIVE")
    body = "ZC Shop: Hi {{first_name}}, our winter sale starts today with 30% off everything in store and online. Reply STOP to opt out. HELP for help. Fin."
    RenderedTemplateContent.objects.using(P).create(template=template, version_number=1, sms_body=body)
    campaign = Campaign.objects.using(P).create(tenant=tenant, name="ZC winter sale", code="ZC-COST-1", campaign_type="REGULAR_MARKETING", channel="SMS",
                                                solicitation_type="MARKETING", template=template, sender_profile=sender)
    ContactListCampaign.objects.using(P).create(campaign=campaign, contact_list_id=list_id, tenant=tenant)
    campaign = Campaign.objects.using(P).select_related("tenant", "template", "sender_profile").get(pk=campaign.pk)

    first = costs.estimate(campaign)
    check("no rate: the estimate says so and is not 0", first == {"available": False, "reason": "SMS prices are not set up for this sender yet."}, first)

    costs.set_currency(tenant, "usd", using=P)
    tenant.refresh_from_db(using=P)
    check("the currency is kept in capitals", costs.currency(tenant) == "USD")
    today = costs.tenant_day(tenant)
    form = admin_rates.RateForm({"delivery_provider": str(engine.pk), "sender_type": "SHORT_CODE", "country_code": "", "effective_from": today.isoformat(),
                                 "sms_cost": "0.0042", "carrier_fee_part": "0.0030", "failed_billed": "1", "pricing": "FIXED", "sms_price": "0.0030",
                                 "carrier_fees": "PASS_ON"}, engines=[engine], today=today)
    check("a price below the cost is refused", not form.is_valid() and "below the cost" in str(form.errors), form.errors)
    form = admin_rates.RateForm({"delivery_provider": str(engine.pk), "sender_type": "SHORT_CODE", "country_code": "", "effective_from": today.isoformat(),
                                 "sms_cost": "0.0042", "mms_cost": "0.0120", "carrier_fee_part": "0.0030", "carrier_fee_mms": "0.0050", "failed_billed": "1",
                                 "pricing": "MARKUP", "sms_markup": "78.57", "mms_markup": "150", "carrier_fees": "PASS_ON"}, engines=[engine], today=today)
    check("a markup rate is valid", form.is_valid(), form.errors)
    check("the markup works the price out", form.cleaned_data["sms_price"] == Decimal("0.0075") and form.cleaned_data["mms_price"] == Decimal("0.0300"), form.cleaned_data)
    rate = admin_rates.add_rate(tenant, admin_rates._rate_values(form.cleaned_data), admin.pk)
    check("the workspace's fee is the carrier fee when passed on", rate.fee_part_price == Decimal("0.0030"))

    later = admin_rates._rate_values({**form.cleaned_data, "effective_from": today + timedelta(days=10), "sms_price": Decimal("0.0080"), "pricing": "FIXED"})
    admin_rates.add_rate(tenant, later, admin.pk)
    rate.refresh_from_db(using=P)
    check("a new price ends the rate in force the day before", rate.effective_until == today + timedelta(days=9), rate.effective_until)
    try:
        admin_rates.add_rate(tenant, later, admin.pk)
        check("two rates cannot start on the same day", False)
    except ValueError:
        check("two rates cannot start on the same day", True)

    figure = costs.estimate_with_check(campaign, store=True)
    check("the estimate is ready", figure.get("available"), figure)
    check("every opted-in person is counted", figure["recipients"] == 3, figure)
    check("the long name makes a second part", [row["parts"] for row in figure["parts"]] == [1, 2], figure["parts"])
    check("parts × (price + carrier fee)", figure["total"] == str(costs.money(Decimal(figure["units"]) * Decimal("0.0105"))), figure)
    check("two lines: parts and carrier fees", [line["label"] for line in figure["lines"]] == ["parts", "Carrier fees"], figure["lines"])
    check("no cost leaves for the workspace", "0.0042" not in json.dumps(figure, default=str))
    check("within limits without any", figure["check"]["state"] == "OK" and not approval.required(campaign), figure["check"])

    costs.save_workspace_settings(tenant, {"approval_above": Decimal("0.01")})
    Tenant.objects.using(P).filter(pk=NWA).update(settings=tenant.settings)
    campaign.tenant.settings = tenant.settings
    figure = costs.estimate_with_check(campaign, store=True)
    check("above the approval limit: approval", figure["check"]["state"] == "APPROVAL", figure["check"])
    check("the campaign now needs approval", approval.required(campaign) and "estimated cost" in (approval.problem(campaign) or ""), approval.problem(campaign))
    check("the request button appears", "request_approval" in approval.actions(campaign))

    costs.save_workspace_settings(tenant, {"approval_above": None, "monthly_budget": Decimal("0.01"), "over_budget": "BLOCK"})
    campaign.tenant.settings = tenant.settings
    figure = costs.estimate_with_check(campaign, store=True)
    check("over a blocking budget: blocked", figure["check"]["state"] == "BLOCK" and costs.blocked(campaign), figure["check"])
    check("blocked is not an approval", not costs.needs_approval(campaign))

    _sent(campaign, engine, [("DELIVERED", 2, "SMS", {}), ("DELIVERED", 1, "SMS", {}), ("FAILED", 1, "SMS", {}), ("QUEUED", 1, "SMS", {})])
    actual = costs.campaign_actual(campaign)
    check("the actual counts the parts sent, failed attempts billed", actual and actual["total"] == str(costs.money(Decimal(4) * Decimal("0.0105"))), actual)
    check("the failed one is said", actual["failed_included"] == 1)
    platform = costs.campaign_actual(campaign, platform=True)
    check("the platform sees the cost", platform["cost"] == str(costs.money(Decimal(4) * Decimal("0.0072"))), platform)
    month = costs.month_spend(tenant, cached=False)
    check("the month counts the campaign's texts", Decimal(month["campaigns"]) >= Decimal(actual["total"]), month)
    rows, totals = admin_rates.usage_rows(tenant, *costs.month_bounds(today))
    check("Message Usage has the campaign with its margin", any(row["name"] == "ZC winter sale" and row["margin_pct"] for row in rows), rows)

    # ---- WhatsApp: Meta's card, a markup, a fixed price, free messages
    wa = DeliveryProvider.objects.using(P).create(tenant=tenant, provider_type="WHATSAPP_META", channel="WHATSAPP", name="ZC WhatsApp")
    upload = io.BytesIO(b"Rate card\nMarket,Currency,Marketing,Utility,Authentication,Authentication-International\n"
                        b"North America,USD,$0.0250,$0.0040,$0.0135,\nRest of Latin America,USD,0.0740,0.0113,0.0405,\nOther,USD,0.0604,0.0077,0.0424,0.0500\n")
    upload.name = "whatsapp_rate_card.csv"
    rows_read, code = admin_rates.read_rate_card(upload)
    check("Meta's card is read", code == "USD" and [row["market"] for row in rows_read] == ["North America", "Rest of Latin America", "Other"], rows_read)
    check("the international column is not taken for authentication", rows_read[2]["authentication"] == Decimal("0.0424"))
    pending = {"engine": str(wa.pk), "effective_from": today.isoformat(), "currency": "USD", "file_name": upload.name,
               "rows": [{key: (str(value) if isinstance(value, Decimal) else value) for key, value in row.items()} for row in rows_read]}
    from apps.delivery.models import WhatsAppRateCard
    card = admin_rates.save_card(tenant, pending, admin.pk, settings_from=WhatsAppRateCard(pricing="MARKUP", markup=Decimal("40")),
                                 fixed={("north america", "marketing"): Decimal("0.0300")})
    prices = {rate.market: rate for rate in WhatsAppRate.objects.using(P).filter(rate_card=card)}
    check("a fixed price wins over the markup", prices["North America"].price_marketing == Decimal("0.0300"))
    check("the markup prices the rest", prices["Rest of Latin America"].price_marketing == Decimal("0.1036"), prices["Rest of Latin America"].price_marketing)
    book = costs.WhatsAppBook(NWA)
    check("a US number is priced at North America", book.price(wa.pk, "US", today, "MARKETING")[0] == Decimal("0.0300"))
    check("costs are not in the workspace's book", book.price(wa.pk, "US", today, "MARKETING")[1] is None)

    wa_campaign = Campaign.objects.using(P).create(tenant=tenant, name="ZC WhatsApp", code="ZC-COST-2", campaign_type="REGULAR_MARKETING", channel="WHATSAPP",
                                                   solicitation_type="MARKETING")
    _sent(wa_campaign, wa, [("DELIVERED", None, "WHATSAPP", {"wa_billable": True, "wa_category": "marketing"}),
                            ("DELIVERED", None, "WHATSAPP", {"wa_billable": False, "wa_category": "service", "wa_pricing_type": "free_customer_service"}),
                            ("FAILED", None, "WHATSAPP", {})])
    wa_campaign = Campaign.objects.using(P).select_related("tenant").get(pk=wa_campaign.pk)
    wa_actual = costs.campaign_actual(wa_campaign)
    check("WhatsApp: a delivered, billable message at its price", wa_actual["total"] == "0.03", wa_actual)
    check("WhatsApp: the free one and the failed one cost nothing", wa_actual["free"] == 1 and wa_actual["not_charged"] == 1, wa_actual)

    # ---- the workspace's page: prices, never costs
    with connections["default"].cursor() as cursor:                  # as the tenant middleware does: the tenant row is read on the workspace's login
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [NWA])
    request = APIRequestFactory().get("/api/v1/message-costs/")
    force_authenticate(request, user=admin)
    from api.v1.costs_api import MessageCostsView
    response = MessageCostsView.as_view()(request)
    payload = json.dumps(response.data, default=str)
    check("Message Costs answers", response.status_code == 200, (response.status_code, payload[:300]))
    if response.status_code != 200:
        return
    check("the page shows the short code's price", response.data["texts"] and response.data["texts"][0]["current"]["sms"] == "0.0075", response.data["texts"])
    check("and the coming change", response.data["texts"][0]["next"]["sms"] == "0.0080")
    check("the page never carries a cost", "0.0042" not in payload and "0.0250" not in payload)
    check("WhatsApp prices by market", response.data["whatsapp"] and response.data["whatsapp"][0]["markets"], response.data["whatsapp"])


@pytestmark_db
def test_workspace_login_reads_prices_only():
    """The workspace's database login is granted the price columns of message_rate, never the cost ones."""
    with transaction.atomic(using="default"), connections["default"].cursor() as cursor:
        cursor.execute("SELECT sms_price, mms_price, fee_part_price FROM message_rate LIMIT 0")
        for column in ("sms_cost", "carrier_fee_part", "sms_markup"):
            with pytest.raises(ProgrammingError):
                with transaction.atomic(using="default"):
                    cursor.execute(f"SELECT {column} FROM message_rate LIMIT 0")
        cursor.execute("SELECT price_marketing FROM whatsapp_rate LIMIT 0")
        with pytest.raises(ProgrammingError):
            with transaction.atomic(using="default"):
                cursor.execute("SELECT cost_marketing FROM whatsapp_rate LIMIT 0")


@pytestmark_db
def test_back_office_message_rate_pages(check, admin_email):
    staff = AppUser.objects.using(P).get(email=admin_email)
    client = Client()
    client.force_login(staff)
    base = f"/admin/tenants/tenant/{NWA}/message-rates/"
    with transaction.atomic(using=P):
        engine = DeliveryProvider.objects.using(P).create(tenant_id=NWA, provider_type="DIGIVIZE", channel="SMS", name="ZC Digivize pages")
        page = client.get(base)
        check("Message Rates opens", page.status_code == 200, page.status_code)
        saved = client.post(base, {"currency": "USD"})
        check("the currency is set", saved.status_code == 302 and costs.currency(Tenant.objects.using(P).get(pk=NWA)) == "USD", saved.status_code)
        today = costs.tenant_day(Tenant.objects.using(P).get(pk=NWA))
        added = client.post(base + "add/", {"delivery_provider": str(engine.pk), "sender_type": "ANY", "country_code": "", "effective_from": today.isoformat(),
                                            "sms_cost": "0.0042", "carrier_fee_part": "0", "failed_billed": "1", "pricing": "FIXED", "sms_price": "0.0075",
                                            "carrier_fees": "PASS_ON", "source": "ZC price sheet"})
        check("Add Rate saves", added.status_code == 302, added.content[:400])
        page = client.get(base)
        check("the rate is listed with its margin", b"ZC Digivize pages" in page.content and b"44%" in page.content)
        check("the tenant's page has the panel", b"Manage Message Rates" in client.get(f"/admin/tenants/tenant/{NWA}/change/").content)
        check("WhatsApp Rates opens", client.get(base + "whatsapp/").status_code == 200)
        check("Message Usage opens", client.get("/admin/tenants/tenant/message-usage/").status_code == 200)
        check("Message Usage for one tenant", client.get(f"/admin/tenants/tenant/message-usage/?tenant={NWA}").status_code == 200)
    check.done()
