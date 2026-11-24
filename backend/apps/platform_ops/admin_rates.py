"""Back-office → Tenants → a tenant → Message Rates (patch 0099, docs/mockups/sms-mms-costs.html): what an SMS part, an MMS and a
WhatsApp message cost the platform and what the workspace pays, and Message Usage, the month's cost, price and margin. Platform
team only: everything here reads and writes on the platform alias. The workspace sees prices alone (apps/delivery/costs.py).

A rate is never changed once in force. Changing a price adds a rate from a date (today or later), which ends the one before the
day before; a rate that has not started yet can still be edited or deleted. WhatsApp works the same way by rate card."""
import csv
import io
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextInputWidget

from apps.delivery import costs, countries
from apps.delivery.models import DeliveryProvider, MessageRate, WhatsAppRate, WhatsAppRateCard

P = settings.PLATFORM_ALIAS
TEXT_CHANNELS = ("SMS", "MMS")
PRICING = [("FIXED", "Fixed Price"), ("MARKUP", "Markup on Cost")]
FEES = [("PASS_ON", "Passed On at Cost"), ("INCLUDED", "Included in Price"), ("ABSORBED", "Not Charged")]
FEES_LABEL = dict(FEES)
CATEGORIES = ("marketing", "utility", "authentication")


def _tenant(tenant_id):
    from apps.tenants.models import Tenant
    return get_object_or_404(Tenant.objects.using(P), pk=tenant_id)


def _today(tenant) -> date:
    return costs.tenant_day(tenant)


def _money_field(label, required=True, help_text=""):
    return forms.DecimalField(label=label, required=required, min_value=0, max_digits=12, decimal_places=4, help_text=help_text,
                              widget=UnfoldAdminTextInputWidget(attrs={"inputmode": "decimal", "placeholder": "0.0000"}))


def _percent_field(label, help_text=""):
    return forms.DecimalField(label=label, required=False, min_value=0, max_value=500, max_digits=7, decimal_places=2, help_text=help_text,
                              widget=UnfoldAdminTextInputWidget(attrs={"inputmode": "decimal", "placeholder": "%"}))


def margin(price, cost) -> str | None:
    """(price − cost) ÷ price, as a whole percent."""
    if price in (None, 0) or cost is None:
        return None
    return f"{round((Decimal(price) - Decimal(cost)) / Decimal(price) * 100)}%"


# ---------------------------------------------------------------------------------------------------- the tenant's currency
class CurrencyForm(forms.Form):
    currency = forms.RegexField(label="Currency", regex=r"^[A-Za-z]{3}$", max_length=3, widget=UnfoldAdminTextInputWidget(attrs={"placeholder": "USD"}),
                                help_text="ISO 4217 code: USD, GBP, EUR. Cost and price share it. Set once, before the first rate.",
                                error_messages={"invalid": "Three letters, like USD."})


# ---------------------------------------------------------------------------------------------------- a rate
class RateForm(forms.Form):
    """Every field the platform team fills in for an SMS / MMS rate. The price is worked out from a markup, or entered; a price
    below the cost is refused unless Below Cost on Purpose is ticked."""
    delivery_provider = forms.ChoiceField(label="Sending Engine", widget=UnfoldAdminSelectWidget, help_text="The tenant's text message engines.")
    sender_type = forms.ChoiceField(label="Sender Type", choices=countries.SENDER_TYPES, initial="ANY", widget=UnfoldAdminSelectWidget,
                                    help_text="A Short Code row beats an Any row for messages from a short code.")
    country_code = forms.ChoiceField(label="Destination", required=False, widget=UnfoldAdminSelectWidget,
                                     help_text="All Countries, or one country when the provider prices it differently. A country row beats All Countries.")
    effective_from = forms.DateField(label="Effective From", widget=UnfoldAdminTextInputWidget(attrs={"type": "date"}),
                                     help_text="Today or later. Ends the current rate for the same engine, sender type and destination the day before.")
    sms_cost = _money_field("SMS Cost a Part", help_text="What the provider bills for one part.")
    mms_cost = _money_field("MMS Cost a Message", required=False, help_text="Leave empty if this engine sends no MMS.")
    carrier_fee_part = _money_field("Carrier Fee a Part", required=False, help_text="Carrier pass-through fees (US 10DLC and the like). Empty or 0 if none.")
    carrier_fee_mms = _money_field("Carrier Fee an MMS", required=False, help_text="Empty or 0 if none.")
    failed_billed = forms.TypedChoiceField(label="Failed Messages Are Billed", choices=[("1", "Yes"), ("0", "No")], coerce=lambda v: v == "1", initial="1",
                                           widget=forms.RadioSelect, help_text="Whether the provider charges for messages carriers refuse.")
    source = forms.CharField(label="Source", required=False, max_length=200, widget=UnfoldAdminTextInputWidget(attrs={"placeholder": "Digivize price sheet, 18 Nov 2026"}),
                             help_text="Where these figures come from. For the record only.")
    pricing = forms.ChoiceField(label="Pricing", choices=PRICING, initial="FIXED", widget=forms.RadioSelect, help_text="Markup works the price out from the cost.")
    sms_price = _money_field("SMS Price a Part", required=False, help_text="Up to 4 decimals. With Markup, worked out for you.")
    sms_markup = _percent_field("SMS Markup", help_text="Percent on cost, with Markup on Cost.")
    mms_price = _money_field("MMS Price a Message", required=False, help_text="Required when MMS has a cost.")
    mms_markup = _percent_field("MMS Markup", help_text="Percent on cost, with Markup on Cost.")
    carrier_fees = forms.ChoiceField(label="Carrier Fees to the Workspace", choices=FEES, initial="PASS_ON", widget=UnfoldAdminSelectWidget,
                                     help_text="Passed On: the workspace sees the fee as its own line, at cost. Included: one figure, so the price must cover cost and fee. "
                                               "Not Charged: the platform absorbs it.")
    below_cost = forms.BooleanField(label="Below Cost on Purpose", required=False, help_text="Allow a price below what the provider charges.")

    def __init__(self, *args, tenant=None, engines=(), today=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.today = today or date.today()
        self.fields["delivery_provider"].choices = [(str(engine.pk), f"{engine.name} ({engine.channel})") for engine in engines]
        self.fields["country_code"].choices = [("", "All Countries")] + countries.choices()

    def clean_effective_from(self):
        value = self.cleaned_data["effective_from"]
        if value < self.today:
            raise forms.ValidationError("Today or later: past days keep the rate they were sent at.")
        return value

    def clean(self):
        data = super().clean()
        if self.errors:
            return data
        for key in ("carrier_fee_part", "carrier_fee_mms"):
            data[key] = data.get(key) or Decimal("0")
        sms_cost, mms_cost = data["sms_cost"], data.get("mms_cost")
        if data["pricing"] == "MARKUP":
            if data.get("sms_markup") is None:
                self.add_error("sms_markup", "Enter the markup in percent.")
            else:
                data["sms_price"] = costs.marked_up(sms_cost, data["sms_markup"])
            if mms_cost is not None:
                if data.get("mms_markup") is None:
                    self.add_error("mms_markup", "Enter the markup in percent.")
                else:
                    data["mms_price"] = costs.marked_up(mms_cost, data["mms_markup"])
            else:
                data["mms_price"] = None
        else:
            data["sms_markup"] = data["mms_markup"] = None
            if data.get("sms_price") is None:
                self.add_error("sms_price", "Enter the price the workspace pays for a part.")
            if mms_cost is not None and data.get("mms_price") is None:
                self.add_error("mms_price", "Enter the price of an MMS, or leave the MMS cost empty.")
            if mms_cost is None and data.get("mms_price") is not None:
                self.add_error("mms_cost", "Enter what an MMS costs, or leave the MMS price empty.")
        if self.errors:
            return data
        included = data["carrier_fees"] == "INCLUDED"
        below = []
        if data["sms_price"] < sms_cost + (data["carrier_fee_part"] if included else 0):
            below.append("SMS")
        if mms_cost is not None and data["mms_price"] < mms_cost + (data["carrier_fee_mms"] if included else 0):
            below.append("MMS")
        if below and not data.get("below_cost"):
            raise forms.ValidationError(f"The {' and '.join(below)} price is below the cost{' and carrier fee' if included else ''}. Raise it, or tick Below Cost on Purpose.")
        data["below_cost"] = bool(below)
        data["country_code"] = data.get("country_code") or None
        return data

    def margin_words(self) -> str:
        data = self.cleaned_data
        included = data["carrier_fees"] == "INCLUDED"
        parts = []
        for kind, price, cost, fee in (("SMS", data["sms_price"], data["sms_cost"], data["carrier_fee_part"]),
                                       ("MMS", data.get("mms_price"), data.get("mms_cost"), data["carrier_fee_mms"])):
            if price is None or cost is None:
                continue
            spent = cost + (fee if included else 0)
            parts.append(f"{kind} {costs.four(price - spent)} ({margin(price, spent) or '—'})")
        return "Margin: " + ", ".join(parts) + "."


def _rate_values(data: dict) -> dict:
    fees = data["carrier_fees"]
    return {"delivery_provider_id": data["delivery_provider"], "sender_type": data["sender_type"], "country_code": data["country_code"],
            "effective_from": data["effective_from"], "sms_cost": data["sms_cost"], "mms_cost": data.get("mms_cost"), "carrier_fee_part": data["carrier_fee_part"],
            "carrier_fee_mms": data["carrier_fee_mms"], "failed_billed": data["failed_billed"], "source": data.get("source") or None, "pricing": data["pricing"],
            "sms_markup": data.get("sms_markup"), "mms_markup": data.get("mms_markup"), "below_cost": data["below_cost"], "sms_price": data["sms_price"],
            "mms_price": data.get("mms_price"), "carrier_fees": fees,
            "fee_part_price": data["carrier_fee_part"] if fees == "PASS_ON" else Decimal("0"), "fee_mms_price": data["carrier_fee_mms"] if fees == "PASS_ON" else Decimal("0")}


def _same_key(tenant, values):
    return MessageRate.objects.using(P).filter(tenant=tenant, delivery_provider_id=values["delivery_provider_id"], sender_type=values["sender_type"],
                                               country_code=values["country_code"])


def add_rate(tenant, values: dict, user_id) -> MessageRate:
    """A new rate from its date: the rate in force then ends the day before; a later one that already exists ends this one."""
    start = values["effective_from"]
    siblings = _same_key(tenant, values)
    if siblings.filter(effective_from=start).exists():
        raise ValueError("A rate for this engine, sender type and destination already starts on that day. Edit that one instead.")
    with transaction.atomic(using=P):
        siblings.filter(effective_from__lt=start).exclude(effective_until__lt=start).update(effective_until=start - timedelta(days=1))
        later = siblings.filter(effective_from__gt=start).order_by("effective_from").first()
        until = later.effective_from - timedelta(days=1) if later else None
        return MessageRate.objects.using(P).create(tenant=tenant, effective_until=until, created_by_id=user_id, updated_by_id=user_id, **values)


def delete_rate(rate) -> None:
    """Only a rate that has not started: the rate before it runs on to where this one would have ended."""
    with transaction.atomic(using=P):
        before = _same_key(rate.tenant, {"delivery_provider_id": rate.delivery_provider_id, "sender_type": rate.sender_type, "country_code": rate.country_code}) \
            .filter(effective_until=rate.effective_from - timedelta(days=1)).first()
        if before is not None:
            MessageRate.objects.using(P).filter(pk=before.pk).update(effective_until=rate.effective_until)
        MessageRate.objects.using(P).filter(pk=rate.pk).delete()


def _engines(tenant, channels=TEXT_CHANNELS):
    return list(DeliveryProvider.objects.using(P).filter(tenant=tenant, channel__in=channels, deleted_at__isnull=True).order_by("name"))


def _row(rate, today) -> dict:
    included = rate.carrier_fees == "INCLUDED"
    state = "ended" if rate.effective_until and rate.effective_until < today else ("future" if rate.effective_from > today else "current")
    return {"rate": rate, "state": state, "sender_type": countries.SENDER_TYPE_LABELS.get(rate.sender_type, rate.sender_type),
            "country": countries.name_of(rate.country_code) if rate.country_code else "All countries", "fees": FEES_LABEL.get(rate.carrier_fees),
            "sms_margin": margin(rate.sms_price, rate.sms_cost + (rate.carrier_fee_part if included else 0)),
            "mms_margin": margin(rate.mms_price, rate.mms_cost + (rate.carrier_fee_mms if included else 0)) if rate.mms_cost is not None else None}


def rates_view(request, tenant_id):
    """The tenant's Message Rates: the currency, the SMS and MMS rates (ended ones on request), Copy From Another Tenant, WhatsApp."""
    tenant = _tenant(tenant_id)
    today = _today(tenant)
    currency_form = CurrencyForm(initial={"currency": costs.currency(tenant) or ""})
    if request.method == "POST" and "currency" in request.POST:
        currency_form = CurrencyForm(request.POST)
        if currency_form.is_valid():
            code = currency_form.cleaned_data["currency"].upper()
            had = costs.currency(tenant)
            costs.set_currency(tenant, code, using=P)
            if had and had != code:
                with transaction.atomic(using=P):                   # rates in the old currency: those used end yesterday, those not started go
                    rates = MessageRate.objects.using(P).filter(tenant=tenant)
                    rates.filter(effective_from__gte=today).delete()
                    rates.filter(effective_from__lt=today).exclude(effective_until__lt=today).update(effective_until=today - timedelta(days=1))
                messages.warning(request, f"{tenant.code}: the currency is now {code}. Every open rate ended yesterday: add the rates again in {code}.")
            else:
                messages.success(request, f"{tenant.code}: currency {code}.")
            return redirect(reverse("admin:tenants_tenant_message_rates", args=[tenant.pk]))
    show_ended = request.GET.get("ended") == "1"
    rates = list(MessageRate.objects.using(P).filter(tenant=tenant).select_related("delivery_provider").order_by("delivery_provider__name", "sender_type", "country_code", "effective_from"))
    rows = [_row(rate, today) for rate in rates]
    ended = sum(1 for row in rows if row["state"] == "ended")
    from apps.tenants.models import Tenant
    others = Tenant.objects.using(P).exclude(pk=tenant.pk).filter(pk__in=MessageRate.objects.using(P).values("tenant_id")).order_by("code")
    wa_engines = _engines(tenant, ("WHATSAPP",))
    context = {**admin.site.each_context(request), "title": f"{tenant.name} · Message Rates", "tenant": tenant, "currency": costs.currency(tenant),
               "currency_form": currency_form, "rows": [row for row in rows if show_ended or row["state"] != "ended"], "ended": ended, "show_ended": show_ended,
               "engines": _engines(tenant), "others": others, "today": today.isoformat(), "wa_engines": wa_engines,
               "wa_cards": WhatsAppRateCard.objects.using(P).filter(tenant=tenant).count()}
    return render(request, "admin/tenants/message_rates.html", context)


def rate_form_view(request, tenant_id, rate_id=None):
    """Add Rate, Edit Rate (a rate that has not started) and Change From a Date (a rate in force: the form starts as a copy of it)."""
    tenant = _tenant(tenant_id)
    today = _today(tenant)
    back = reverse("admin:tenants_tenant_message_rates", args=[tenant.pk])
    if not costs.currency(tenant):
        messages.error(request, "Set the tenant's currency first.")
        return redirect(back)
    engines = _engines(tenant)
    if not engines:
        messages.error(request, f"{tenant.code} has no SMS or MMS engine. Its administrator adds one under Settings → Sending Engines.")
        return redirect(back)
    rate = get_object_or_404(MessageRate.objects.using(P), pk=rate_id, tenant=tenant) if rate_id else None
    editing = rate is not None and rate.effective_from > today
    if request.method == "POST" and editing and "delete" in request.POST:
        delete_rate(rate)
        messages.success(request, "The rate that had not started yet was deleted.")
        return redirect(back)
    initial = {"effective_from": (today + timedelta(days=1)).isoformat()}
    if rate is not None:
        initial = {"delivery_provider": str(rate.delivery_provider_id), "sender_type": rate.sender_type, "country_code": rate.country_code or "",
                   "effective_from": (rate.effective_from if editing else max(today + timedelta(days=1), rate.effective_from + timedelta(days=1))).isoformat(),
                   "sms_cost": rate.sms_cost, "mms_cost": rate.mms_cost, "carrier_fee_part": rate.carrier_fee_part, "carrier_fee_mms": rate.carrier_fee_mms,
                   "failed_billed": "1" if rate.failed_billed else "0", "source": rate.source, "pricing": rate.pricing, "sms_price": rate.sms_price,
                   "sms_markup": rate.sms_markup, "mms_price": rate.mms_price, "mms_markup": rate.mms_markup, "carrier_fees": rate.carrier_fees,
                   "below_cost": rate.below_cost}
    form = RateForm(request.POST or None, initial=initial, tenant=tenant, engines=engines, today=today)
    if request.method == "POST" and form.is_valid():
        values = _rate_values(form.cleaned_data)
        try:
            if editing:
                key_changed = any(str(getattr(rate, name) or "") != str(values[name] or "") for name in ("delivery_provider_id", "sender_type", "country_code", "effective_from"))
                with transaction.atomic(using=P):
                    if key_changed:
                        delete_rate(rate)
                        add_rate(tenant, values, request.user.pk)
                    else:
                        MessageRate.objects.using(P).filter(pk=rate.pk).update(updated_by_id=request.user.pk, **values)
            else:
                add_rate(tenant, values, request.user.pk)
        except ValueError as error:
            form.add_error(None, str(error))
        else:
            messages.success(request, f"Rate saved from {values['effective_from']:%d %b %Y}. {form.margin_words()}")
            return redirect(back)
    title = "Edit Rate" if editing else ("Change Rate From a Date" if rate else "Add Rate")
    context = {**admin.site.each_context(request), "title": f"{tenant.name} · {title}", "heading": title, "tenant": tenant, "form": form, "currency": costs.currency(tenant),
               "editing": editing, "rate": rate, "back": back,
               "groups": [("Applies To", ["delivery_provider", "sender_type", "country_code", "effective_from"]),
                          ("Cost · from the provider's contract, platform team only", ["sms_cost", "mms_cost", "carrier_fee_part", "carrier_fee_mms", "failed_billed", "source"]),
                          ("Price · what the workspace sees and pays", ["pricing", "sms_price", "sms_markup", "mms_price", "mms_markup", "carrier_fees", "below_cost"])]}
    return render(request, "admin/tenants/message_rate_form.html", context)


class CopyForm(forms.Form):
    source = forms.ChoiceField(label="Copy From", widget=UnfoldAdminSelectWidget)
    effective_from = forms.DateField(label="Effective From", widget=UnfoldAdminTextInputWidget(attrs={"type": "date"}))


def copy_view(request, tenant_id):
    """Copy From Another Tenant: the other tenant's rates in force on the date, onto this tenant's engines of the same provider."""
    tenant = _tenant(tenant_id)
    back = reverse("admin:tenants_tenant_message_rates", args=[tenant.pk])
    if request.method != "POST":
        return redirect(back)
    from apps.tenants.models import Tenant
    form = CopyForm(request.POST)
    form.fields["source"].choices = [(str(t.pk), t.code) for t in Tenant.objects.using(P).exclude(pk=tenant.pk)]
    if not form.is_valid():
        messages.error(request, "Choose a tenant and a date.")
        return redirect(back)
    source = _tenant(form.cleaned_data["source"])
    start = form.cleaned_data["effective_from"]
    if start < _today(tenant):
        messages.error(request, "Today or later: past days keep the rate they were sent at.")
        return redirect(back)
    if costs.currency(source) != costs.currency(tenant):
        messages.error(request, f"{source.code} is in {costs.currency(source) or 'no currency'}, {tenant.code} in {costs.currency(tenant) or 'no currency'}: copy only between the same currency.")
        return redirect(back)
    engines = {engine.provider_type: engine for engine in reversed(_engines(tenant))}
    copied, skipped = 0, 0
    for rate in MessageRate.objects.using(P).filter(tenant=source, effective_from__lte=start).exclude(effective_until__lt=start).select_related("delivery_provider"):
        engine = engines.get(rate.delivery_provider.provider_type)
        if engine is None:
            skipped += 1
            continue
        values = {name: getattr(rate, name) for name in ("sender_type", "country_code", "sms_cost", "mms_cost", "carrier_fee_part", "carrier_fee_mms", "failed_billed",
                                                         "pricing", "sms_markup", "mms_markup", "below_cost", "sms_price", "mms_price", "carrier_fees", "fee_part_price", "fee_mms_price")}
        values.update(delivery_provider_id=engine.pk, effective_from=start, source=f"Copied from {source.code}" + (f": {rate.source}" if rate.source else "")[:180])
        try:
            add_rate(tenant, values, request.user.pk)
            copied += 1
        except ValueError:
            skipped += 1
    messages.success(request, f"{copied} rate{'s' if copied != 1 else ''} copied from {source.code}, from {start:%d %b %Y}." + (f" {skipped} skipped (no engine of that provider, or a rate already starts that day)." if skipped else ""))
    return redirect(back)


# ---------------------------------------------------------------------------------------------------- WhatsApp rate cards
def _number(raw) -> Decimal | None:
    text = str(raw or "").strip().replace("$", "").replace("€", "").replace("£", "").replace(",", "")
    if text in ("", "-", "n/a", "N/A", "—"):
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def read_rate_card(upload) -> tuple[list[dict], str | None]:
    """Meta's rate card (CSV or Excel): one row per market with Marketing, Utility and Authentication. -> (rows, currency or None).
    The header row is found by its Market column; Authentication-International and Service columns are ignored."""
    name = (upload.name or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        sheet = load_workbook(upload, read_only=True, data_only=True).active
        table = [[cell for cell in row] for row in sheet.iter_rows(values_only=True)]
    else:
        text = upload.read().decode("utf-8-sig", errors="replace")
        table = list(csv.reader(io.StringIO(text)))
    header_at, columns = None, {}
    for index, row in enumerate(table[:30]):
        cells = [str(cell or "").strip().lower() for cell in row]
        market = next((i for i, cell in enumerate(cells) if cell in ("market", "country", "market / country", "country/region", "region")), None)
        if market is not None and any("marketing" in cell for cell in cells):
            header_at = index
            columns["market"] = market
            for i, cell in enumerate(cells):
                if "marketing" in cell and "marketing" not in columns:
                    columns["marketing"] = i
                elif "utility" in cell and "utility" not in columns:
                    columns["utility"] = i
                elif cell.startswith("authentication") and "international" not in cell and "authentication" not in columns:
                    columns["authentication"] = i
                elif cell == "currency":
                    columns["currency"] = i
            break
    if header_at is None:
        raise ValueError("No header row with a Market column and a Marketing column was found. Use Meta's rate card as downloaded.")
    rows, currencies = [], set()
    for row in table[header_at + 1:]:
        cells = list(row) + [None] * 10
        market = str(cells[columns["market"]] or "").strip()
        if not market:
            continue
        prices = {key: _number(cells[columns[key]]) if key in columns else None for key in CATEGORIES}
        if all(value is None for value in prices.values()):
            continue
        if "currency" in columns and cells[columns["currency"]]:
            currencies.add(str(cells[columns["currency"]]).strip().upper())
        rows.append({"market": market[:80], **prices})
    if not rows:
        raise ValueError("The file has a header but no market with a price.")
    if len(currencies) > 1:
        raise ValueError(f"The file mixes currencies ({', '.join(sorted(currencies))}). Download the card in the account's billing currency.")
    return rows, (currencies.pop() if currencies else None)


def _price(cost, fixed, card_pricing, markup) -> Decimal | None:
    if fixed is not None:
        return Decimal(fixed)
    if cost is None:
        return None
    return costs.marked_up(cost, markup if card_pricing == "MARKUP" else 0)


def _card_rows(card, today, tenant) -> list[dict]:
    rates = list(WhatsAppRate.objects.using(P).filter(rate_card=card))
    from api.v1.costs_api import contacts_by_market
    from apps.tenants import context as tenant_context
    token = tenant_context.set_current(str(tenant.pk), P)
    try:
        contacts = contacts_by_market(tenant, [rate.market for rate in rates])
    finally:
        tenant_context.reset(token)
    out = []
    for rate in rates:
        cells = []
        for key in CATEGORIES:
            cost, price, fixed = getattr(rate, f"cost_{key}"), getattr(rate, f"price_{key}"), getattr(rate, f"fixed_{key}")
            cells.append({"cost": cost, "price": price, "fixed": fixed is not None, "margin": margin(price, cost)})
        out.append({"rate": rate, "cells": cells, "contacts": contacts.get(rate.market, 0)})
    out.sort(key=lambda row: (row["rate"].market == countries.OTHER, -row["contacts"], row["rate"].market))
    return out


def whatsapp_view(request, tenant_id):
    """The tenant's WhatsApp rate cards: the one in force per WhatsApp engine with its markets, the import, and the pricing."""
    tenant = _tenant(tenant_id)
    today = _today(tenant)
    show_ended = request.GET.get("ended") == "1"
    engines = []
    for engine in _engines(tenant, ("WHATSAPP",)):
        cards = list(WhatsAppRateCard.objects.using(P).filter(tenant=tenant, delivery_provider=engine).order_by("-effective_from"))
        current = next((c for c in cards if c.effective_from <= today and (not c.effective_until or c.effective_until >= today)), None)
        future = [c for c in cards if c.effective_from > today]
        ended = [c for c in cards if c.effective_until and c.effective_until < today]
        shown = current or (future[-1] if future else None)
        engines.append({"engine": engine, "card": shown, "rows": _card_rows(shown, today, tenant) if shown else [], "future": future, "ended": ended,
                        "show_ended": show_ended})
    context = {**admin.site.each_context(request), "title": f"{tenant.name} · WhatsApp Rates", "tenant": tenant, "engines": engines,
               "currency": costs.currency(tenant), "today": today.isoformat(), "back": reverse("admin:tenants_tenant_message_rates", args=[tenant.pk])}
    return render(request, "admin/tenants/whatsapp_rates.html", context)


class ImportForm(forms.Form):
    delivery_provider = forms.ChoiceField(label="WhatsApp Account", widget=UnfoldAdminSelectWidget)
    file = forms.FileField(label="Rate Card", help_text="Meta's CSV or Excel file, as downloaded from Meta's WhatsApp pricing page.")
    effective_from = forms.DateField(label="Effective From", widget=UnfoldAdminTextInputWidget(attrs={"type": "date"}),
                                     help_text="Today or later. Ends the previous card the day before.")
    currency = forms.RegexField(label="Billing Currency", regex=r"^[A-Za-z]{3}$", max_length=3, widget=UnfoldAdminTextInputWidget(attrs={"placeholder": "USD"}),
                                help_text="Must match the WhatsApp account's billing currency in Meta's WhatsApp Manager.")


SESSION_KEY = "cep_wa_import"


def import_view(request, tenant_id):
    """Import Meta Rate Card: upload → the changes against the card in force → Import. Nothing is saved before the confirmation."""
    tenant = _tenant(tenant_id)
    today = _today(tenant)
    back = reverse("admin:tenants_tenant_whatsapp_rates", args=[tenant.pk])
    engines = _engines(tenant, ("WHATSAPP",))
    if not engines:
        messages.error(request, f"{tenant.code} has no WhatsApp engine.")
        return redirect(back)
    pending = request.session.get(SESSION_KEY)
    if pending and pending.get("tenant") != str(tenant.pk):
        pending = None
    if request.method == "POST" and "confirm" in request.POST and pending:
        problem = _import_problem(pending, request.POST.get("below_cost") == "1")
        if problem:
            messages.error(request, problem)
        else:
            card = save_card(tenant, pending, request.user.pk, below_cost=request.POST.get("below_cost") == "1")
            request.session.pop(SESSION_KEY, None)
            messages.success(request, f"Rate card imported: {len(pending['rows'])} markets from {card.effective_from:%d %b %Y}.")
            return redirect(back)
    if request.method == "POST" and "cancel" in request.POST:
        request.session.pop(SESSION_KEY, None)
        return redirect(back)
    form = ImportForm(initial={"effective_from": today.isoformat(), "currency": costs.currency(tenant) or "",
                               "delivery_provider": request.GET.get("engine") or str(engines[0].pk)})
    form.fields["delivery_provider"].choices = [(str(e.pk), e.name) for e in engines]
    if request.method == "POST" and "upload" in request.POST:
        form = ImportForm(request.POST, request.FILES)
        form.fields["delivery_provider"].choices = [(str(e.pk), e.name) for e in engines]
        if form.is_valid():
            start = form.cleaned_data["effective_from"]
            code = form.cleaned_data["currency"].upper()
            try:
                rows, file_currency = read_rate_card(form.cleaned_data["file"])
            except Exception as error:                                         # noqa: BLE001  an unreadable file: said on the form
                form.add_error("file", str(error))
            else:
                if start < today:
                    form.add_error("effective_from", "Today or later: past days keep the card they were sent at.")
                elif file_currency and file_currency != code:
                    form.add_error("currency", f"The card is in {file_currency}, the account bills in {code}. Download the card in {code}.")
                else:
                    pending = {"tenant": str(tenant.pk), "engine": form.cleaned_data["delivery_provider"], "effective_from": start.isoformat(), "currency": code,
                               "file_name": form.cleaned_data["file"].name[:200],
                               "rows": [{key: (str(value) if isinstance(value, Decimal) else value) for key, value in row.items()} for row in rows]}
                    request.session[SESSION_KEY] = pending
    review = _review(tenant, pending) if pending else None
    context = {**admin.site.each_context(request), "title": f"{tenant.name} · Import Meta Rate Card", "tenant": tenant, "form": form, "pending": pending,
               "review": review, "back": back}
    return render(request, "admin/tenants/whatsapp_import.html", context)


def _previous(tenant, engine_id, start):
    return WhatsAppRateCard.objects.using(P).filter(tenant=tenant, delivery_provider_id=engine_id, effective_from__lt=start).order_by("-effective_from").first()


def _review(tenant, pending) -> dict:
    """What the import changes, against the card in force on the date: markets read, changed, new, missing; and fixed prices the
    new costs would put below cost."""
    start = date.fromisoformat(pending["effective_from"])
    before = _previous(tenant, pending["engine"], start)
    old = {rate.market.lower(): rate for rate in WhatsAppRate.objects.using(P).filter(rate_card=before)} if before else {}
    pricing, markup = (before.pricing, before.markup) if before else ("MARKUP", Decimal("0"))
    changes, below, new = [], [], []
    for row in pending["rows"]:
        prior = old.get(row["market"].lower())
        if prior is None:
            new.append(row["market"])
        for key in CATEGORIES:
            cost = Decimal(row[key]) if row[key] is not None else None
            was = getattr(prior, f"cost_{key}") if prior else None
            fixed = getattr(prior, f"fixed_{key}") if prior else None
            price = _price(cost, fixed, pricing, markup)
            if prior is not None and cost != was:
                changes.append({"market": row["market"], "category": key.title(), "was": was, "cost": cost, "price": price})
            if fixed is not None and cost is not None and fixed < cost:
                below.append(f"{row['market']} {key.title()}: the fixed price {costs.four(fixed)} is below the new cost {costs.four(cost)}")
    read = {row["market"].lower() for row in pending["rows"]}
    missing = [rate.market for key, rate in old.items() if key not in read]
    return {"start": start, "before": before, "pricing": pricing, "markup": markup, "changes": changes, "changes_shown": changes[:12], "more": max(0, len(changes) - 12),
            "below": below, "new": new, "missing": missing, "count": len(pending["rows"])}


def _import_problem(pending, below_ok: bool) -> str | None:
    from apps.tenants.models import Tenant
    tenant = Tenant.objects.using(P).get(pk=pending["tenant"])
    review = _review(tenant, pending)
    if review["below"] and not below_ok:
        return "A fixed price would be below the new cost. Raise it under Edit Pricing first, or tick Below Cost on Purpose."
    if WhatsAppRateCard.objects.using(P).filter(tenant=tenant, delivery_provider_id=pending["engine"], effective_from=pending["effective_from"]).exists():
        return "A card for this account already starts on that day."
    return None


def save_card(tenant, pending, user_id, *, below_cost=False, settings_from=None, fixed=None) -> WhatsAppRateCard:
    """A new card from its date with the costs given; pricing and fixed prices carry over from the card before (or settings_from)."""
    start = date.fromisoformat(pending["effective_from"]) if isinstance(pending["effective_from"], str) else pending["effective_from"]
    before = _previous(tenant, pending["engine"], start)
    model = settings_from or before
    kept = {rate.market.lower(): rate for rate in WhatsAppRate.objects.using(P).filter(rate_card=before)} if before else {}
    with transaction.atomic(using=P):
        cards = WhatsAppRateCard.objects.using(P).filter(tenant=tenant, delivery_provider_id=pending["engine"])
        cards.filter(effective_from__lt=start).exclude(effective_until__lt=start).update(effective_until=start - timedelta(days=1))
        later = cards.filter(effective_from__gt=start).order_by("effective_from").first()
        card = WhatsAppRateCard.objects.using(P).create(
            tenant=tenant, delivery_provider_id=pending["engine"], currency=pending["currency"], effective_from=start,
            effective_until=later.effective_from - timedelta(days=1) if later else None, file_name=pending.get("file_name"), imported_by_id=user_id,
            **({name: getattr(model, name) for name in ("pricing", "markup", "other_countries", "free_messages", "platform_fee", "volume_discounts")} if model else {}))
        for row in pending["rows"]:
            prior = kept.get(row["market"].lower())
            values = {}
            for key in CATEGORIES:
                cost = Decimal(row[key]) if row[key] is not None else None
                fixed_price = (fixed or {}).get((row["market"].lower(), key), getattr(prior, f"fixed_{key}") if prior else None)
                values[f"cost_{key}"] = cost
                values[f"fixed_{key}"] = fixed_price
                values[f"price_{key}"] = _price(cost, fixed_price, card.pricing, card.markup)
            low = any(values[f"price_{k}"] is not None and values[f"cost_{k}"] is not None and values[f"price_{k}"] < values[f"cost_{k}"] for k in CATEGORIES)
            WhatsAppRate.objects.using(P).create(tenant=tenant, rate_card=card, market=row["market"], below_cost=low and below_cost, **values)
    return card


class PricingForm(forms.Form):
    pricing = forms.ChoiceField(label="Pricing Method", choices=[("MARKUP", "Markup on Cost"), ("FIXED", "Fixed Price")], widget=forms.RadioSelect,
                                help_text="Fixed Price means a price for every market and category below.")
    markup = forms.DecimalField(label="Markup", min_value=0, max_value=500, max_digits=7, decimal_places=2, required=False,
                                widget=UnfoldAdminTextInputWidget(attrs={"inputmode": "decimal"}), help_text="Percent on cost, 0 to 500. Price = cost × (1 + markup).")
    other_countries = forms.BooleanField(label="Other Countries", required=False, help_text="Numbers outside the listed markets may be sent to, at the card's Other row.")
    free_messages = forms.ChoiceField(label="Free Messages", choices=[("FREE", "Free to the workspace"), ("PLATFORM_FEE", "A platform fee a message")],
                                      widget=UnfoldAdminSelectWidget, help_text="What the workspace pays when Meta charges nothing (replies within 24 hours, ad entry points).")
    platform_fee = forms.DecimalField(label="Platform Fee", min_value=0, max_digits=12, decimal_places=4, required=False,
                                      widget=UnfoldAdminTextInputWidget(attrs={"inputmode": "decimal"}), help_text="A free message, with Platform Fee. Shown as its own line.")
    volume_discounts = forms.ChoiceField(label="Volume Discounts", choices=[("MARGIN", "Kept as Margin"), ("PASS_ON", "Passed On")], widget=UnfoldAdminSelectWidget,
                                         help_text="Meta's monthly discounts (Utility, Authentication). Estimates always use list rates.")
    effective_from = forms.DateField(label="Effective From", widget=UnfoldAdminTextInputWidget(attrs={"type": "date"}),
                                     help_text="A card in force is never changed: the new prices start on this day, today or later.")
    below_cost = forms.BooleanField(label="Below Cost on Purpose", required=False)

    def clean(self):
        data = super().clean()
        if data.get("pricing") == "MARKUP" and data.get("markup") is None:
            self.add_error("markup", "Enter the markup in percent.")
        if data.get("free_messages") == "PLATFORM_FEE" and data.get("platform_fee") is None:
            self.add_error("platform_fee", "Enter the fee a free message carries.")
        return data


def pricing_view(request, tenant_id, card_id):
    """Edit Pricing: the method, the markup, free messages and the fixed prices. On a card that has not started, in place; on one in
    force, a new card with the same costs from the date given."""
    tenant = _tenant(tenant_id)
    today = _today(tenant)
    card = get_object_or_404(WhatsAppRateCard.objects.using(P), pk=card_id, tenant=tenant)
    back = reverse("admin:tenants_tenant_whatsapp_rates", args=[tenant.pk])
    rates = list(WhatsAppRate.objects.using(P).filter(rate_card=card).order_by("market"))
    in_place = card.effective_from > today
    initial = {"pricing": card.pricing, "markup": card.markup, "other_countries": card.other_countries, "free_messages": card.free_messages,
               "platform_fee": card.platform_fee, "volume_discounts": card.volume_discounts,
               "effective_from": (card.effective_from if in_place else today + timedelta(days=1)).isoformat()}
    form = PricingForm(request.POST or None, initial=initial)
    fixed, fixed_errors = {}, []
    if request.method == "POST":
        for rate in rates:
            for key in CATEGORIES:
                raw = request.POST.get(f"fixed_{rate.pk}_{key}", "").strip()
                if raw:
                    value = _number(raw)
                    if value is None or value < 0:
                        fixed_errors.append(f"{rate.market} {key.title()}: not an amount.")
                    else:
                        fixed[(rate.market.lower(), key)] = costs.four(value)
                else:
                    fixed[(rate.market.lower(), key)] = None
    if request.method == "POST" and form.is_valid() and not fixed_errors:
        data = form.cleaned_data
        if data["pricing"] == "FIXED":
            missing = [f"{rate.market} {key.title()}" for rate in rates for key in CATEGORIES
                       if getattr(rate, f"cost_{key}") is not None and fixed.get((rate.market.lower(), key)) is None]
            if missing:
                fixed_errors.append("Fixed Price needs a price for every market and category: " + ", ".join(missing[:6]) + (" …" if len(missing) > 6 else ""))
        low = [f"{rate.market} {key.title()}" for rate in rates for key in CATEGORIES
               if fixed.get((rate.market.lower(), key)) is not None and getattr(rate, f"cost_{key}") is not None and fixed[(rate.market.lower(), key)] < getattr(rate, f"cost_{key}")]
        if low and not data["below_cost"]:
            fixed_errors.append("Below the cost: " + ", ".join(low[:6]) + ". Raise them, or tick Below Cost on Purpose.")
        if data["effective_from"] < today:
            form.add_error("effective_from", "Today or later.")
        if not fixed_errors and form.is_valid():
            settings_values = {"pricing": data["pricing"], "markup": data.get("markup") or Decimal("0"), "other_countries": data["other_countries"],
                               "free_messages": data["free_messages"], "platform_fee": data.get("platform_fee") if data["free_messages"] == "PLATFORM_FEE" else None,
                               "volume_discounts": data["volume_discounts"]}
            with transaction.atomic(using=P):
                if in_place and data["effective_from"] == card.effective_from:
                    WhatsAppRateCard.objects.using(P).filter(pk=card.pk).update(**settings_values)
                    for rate in rates:
                        values = {}
                        for key in CATEGORIES:
                            chosen = fixed.get((rate.market.lower(), key))
                            values[f"fixed_{key}"] = chosen
                            values[f"price_{key}"] = _price(getattr(rate, f"cost_{key}"), chosen, settings_values["pricing"], settings_values["markup"])
                        WhatsAppRate.objects.using(P).filter(pk=rate.pk).update(below_cost=bool(low), **values)
                else:
                    model = WhatsAppRateCard(**settings_values)
                    pending = {"engine": str(card.delivery_provider_id), "effective_from": data["effective_from"], "currency": card.currency, "file_name": card.file_name,
                               "rows": [{"market": rate.market, **{key: getattr(rate, f"cost_{key}") for key in CATEGORIES}} for rate in rates]}
                    if WhatsAppRateCard.objects.using(P).filter(tenant=tenant, delivery_provider_id=card.delivery_provider_id, effective_from=data["effective_from"]).exists():
                        form.add_error("effective_from", "A card for this account already starts on that day.")
                        return _pricing_page(request, tenant, card, rates, form, fixed_errors, back, in_place)
                    save_card(tenant, pending, request.user.pk, below_cost=bool(low), settings_from=model, fixed=fixed)
            messages.success(request, f"Pricing saved from {data['effective_from']:%d %b %Y}.")
            return redirect(back)
    return _pricing_page(request, tenant, card, rates, form, fixed_errors, back, in_place)


def _pricing_page(request, tenant, card, rates, form, fixed_errors, back, in_place):
    rows = [{"rate": rate, "cells": [{"key": key, "cost": getattr(rate, f"cost_{key}"), "fixed": request.POST.get(f"fixed_{rate.pk}_{key}") if request.method == "POST"
                                      else (getattr(rate, f"fixed_{key}") or "")} for key in CATEGORIES]} for rate in rates]
    context = {**admin.site.each_context(request), "title": f"{tenant.name} · WhatsApp Pricing", "tenant": tenant, "card": card, "form": form, "rows": rows,
               "fixed_errors": fixed_errors, "back": back, "in_place": in_place}
    return render(request, "admin/tenants/whatsapp_pricing.html", context)


# ---------------------------------------------------------------------------------------------------- Message Usage: the month's margin
def _month(request, today: date) -> date:
    raw = request.GET.get("month") or ""
    try:
        year, month = (int(part) for part in raw.split("-"))
        return date(year, month, 1)
    except ValueError:
        return today.replace(day=1)


def usage_rows(tenant, start: date, end: date) -> tuple[list[dict], dict]:
    """One row per campaign (e-receipts together) that sent a priced text in the month: units, cost, price, margin."""
    from apps.campaigns.models import Campaign
    tallies = costs.tally_sent(tenant.pk, platform=True, where="AND e.created_at >= %s AND e.created_at < %s", params=list(costs.day_bounds(tenant, start, end)),
                               extra=", e.campaign_id::text", group=", 12", split=lambda value: value)
    campaigns = {str(c["id"]): c for c in Campaign.objects.using(P).filter(tenant_id=tenant.pk, pk__in=list(tallies)).values("id", "name", "campaign_type", "channel",
                                                                                                                                 "is_journey_generated")}
    grouped = defaultdict(lambda: {"tally": None, "price": Decimal("0"), "cost": Decimal("0"), "units": defaultdict(int)})
    for pk, tally in tallies.items():
        found = campaigns.get(pk) or {}
        receipt = found.get("campaign_type") == "E_RECEIPT"
        key = "receipts" if receipt else pk
        entry = grouped[key]
        entry["name"] = "E-receipts by text" if receipt else found.get("name") or "A removed campaign"
        entry["kind"] = "all month" if receipt else ("journey" if found.get("is_journey_generated") else ({"DRIP": "drip"}.get(found.get("campaign_type")) or "campaign"))
        entry["price"] += tally.total
        entry["cost"] += tally.total_cost
        for unit, count in tally.units.items():
            entry["units"][unit] += count
    rows = []
    for entry in grouped.values():
        units = ", ".join(f"{count:,} {('parts' if unit == 'SMS' else 'MMS' if unit == 'MMS' else 'WhatsApp')}" for unit, count in entry["units"].items() if count)
        rows.append({"name": entry["name"], "kind": entry["kind"], "units": units or "—", "cost": costs.money(entry["cost"]), "price": costs.money(entry["price"]),
                     "margin": costs.money(entry["price"] - entry["cost"]), "margin_pct": margin(entry["price"], entry["cost"])})
    rows.sort(key=lambda row: -row["price"])
    total_cost, total_price = sum((r["cost"] for r in rows), Decimal("0")), sum((r["price"] for r in rows), Decimal("0"))
    return rows, {"cost": costs.money(total_cost), "price": costs.money(total_price), "margin": costs.money(total_price - total_cost),
                  "margin_pct": margin(total_price, total_cost)}


def usage_view(request):
    """Back-office → Message Usage: per tenant with rates, the month's cost, price and margin; one tenant's campaigns when chosen."""
    from apps.tenants.models import Tenant
    today = date.today()
    start = _month(request, today)
    end = costs.month_bounds(start)[1]
    priced = Tenant.objects.using(P).filter(pk__in=MessageRate.objects.using(P).values("tenant_id")) | Tenant.objects.using(P).filter(
        pk__in=WhatsAppRateCard.objects.using(P).values("tenant_id"))
    tenants = list(priced.distinct().order_by("code"))
    chosen = next((t for t in tenants if str(t.pk) == request.GET.get("tenant")), None)
    summary = []
    for tenant in tenants:
        _rows, totals = usage_rows(tenant, start, end)
        summary.append({"tenant": tenant, "currency": costs.currency(tenant), **totals})
    rows, totals = usage_rows(chosen, start, end) if chosen else ([], None)
    months = []
    cursor = today.replace(day=1)
    for _ in range(12):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    context = {**admin.site.each_context(request), "title": "Message Usage", "start": start, "months": months, "summary": summary, "chosen": chosen,
               "rows": rows, "totals": totals, "currency": costs.currency(chosen) if chosen else None}
    return render(request, "admin/tenants/message_usage.html", context)


def tenant_panel(tenant) -> dict:
    """The summary on the tenant's page."""
    today = _today(tenant)
    rates = MessageRate.objects.using(P).filter(tenant=tenant)
    current = rates.filter(effective_from__lte=today).exclude(effective_until__lt=today).count()
    future = rates.filter(effective_from__gt=today).count()
    cards = WhatsAppRateCard.objects.using(P).filter(tenant=tenant, effective_from__lte=today).exclude(effective_until__lt=today).count()
    return {"currency": costs.currency(tenant), "current": current, "future": future, "cards": cards}


def rate_urls(admin_site):
    """Mounted by the tenant admin under /admin/tenants/tenant/."""
    view = admin_site.admin_view
    return [path("message-usage/", view(usage_view), name="tenants_tenant_message_usage"),
            path("<uuid:tenant_id>/message-rates/", view(rates_view), name="tenants_tenant_message_rates"),
            path("<uuid:tenant_id>/message-rates/add/", view(rate_form_view), name="tenants_tenant_message_rate_add"),
            path("<uuid:tenant_id>/message-rates/copy/", view(copy_view), name="tenants_tenant_message_rate_copy"),
            path("<uuid:tenant_id>/message-rates/<uuid:rate_id>/", view(rate_form_view), name="tenants_tenant_message_rate_edit"),
            path("<uuid:tenant_id>/message-rates/whatsapp/", view(whatsapp_view), name="tenants_tenant_whatsapp_rates"),
            path("<uuid:tenant_id>/message-rates/whatsapp/import/", view(import_view), name="tenants_tenant_whatsapp_import"),
            path("<uuid:tenant_id>/message-rates/whatsapp/<uuid:card_id>/pricing/", view(pricing_view), name="tenants_tenant_whatsapp_pricing")]
