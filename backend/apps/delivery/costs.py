"""What texts cost (patch 0099, docs/mockups/sms-mms-costs.html).

Two figures: the cost is what the provider charges the platform, the price is what the platform charges the workspace. The
workspace only ever sees prices: its database login may read PRICE_FIELDS of message_rate and nothing of the cost, so every
workspace read here goes through `.values()` of those columns; costs and margins are read on the platform alias (back-office).

SMS       recipients x parts each x (price a part + carrier fee a part)
MMS       recipients x (price an MMS + carrier fee an MMS)
WhatsApp  delivered messages x the price for the template's category in the recipient's market (free ones cost nothing)

A rate is never edited once in force: a new price is a new row from a date. So a text sent on a day is priced by the rate of
that day, worked out from what sms_execution already records (engine, sender number, phone number, parts, status); nothing
is stored per message except Meta's own pricing block for WhatsApp.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import connections

from . import countries

P = None                                    # read settings.PLATFORM_ALIAS at call time (tests patch it)
SETTINGS_KEY = "message_costs"              # tenant.settings: the workspace's own parameters
RATES_KEY = "message_rates"                 # tenant.settings: the platform's (currency)
PERMISSION = "cost.view"
PRICE_FIELDS = ("id", "delivery_provider_id", "sender_type", "country_code", "effective_from", "effective_until", "sms_price", "mms_price",
                "carrier_fees", "fee_part_price", "fee_mms_price")
CATEGORIES = ("MARKETING", "UTILITY", "AUTHENTICATION")
OVER_BUDGET = ("WARN", "APPROVAL", "BLOCK")
FOUR = Decimal("0.0001")
CENT = Decimal("0.01")
ZERO = Decimal("0")
BILLED_STATUSES = ("SUBMITTED", "DELIVERED", "RESPONDED")
WA_CHARGED_STATUSES = ("DELIVERED", "RESPONDED")


def platform_alias() -> str:
    return P or settings.PLATFORM_ALIAS


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def four(value) -> Decimal:
    return Decimal(value or 0).quantize(FOUR, rounding=ROUND_HALF_UP)


def marked_up(cost, percent) -> Decimal:
    return four(Decimal(cost or 0) * (1 + Decimal(percent or 0) / 100))


# ---------------------------------------------------------------------------------------------------- the tenant's parameters
def currency(tenant) -> str | None:
    return ((tenant.settings or {}).get(RATES_KEY) or {}).get("currency")


def set_currency(tenant, code: str, *, using: str) -> None:
    tenant.settings = {**(tenant.settings or {}), RATES_KEY: {**((tenant.settings or {}).get(RATES_KEY) or {}), "currency": code.upper()}}
    type(tenant).objects.using(using).filter(pk=tenant.pk).update(settings=tenant.settings)


DEFAULTS = {"approval_above": None, "monthly_budget": None, "warn_at": 80, "over_budget": "APPROVAL", "wa_countries": None, "home_country": None}


def workspace_settings(tenant) -> dict:
    stored = (tenant.settings or {}).get(SETTINGS_KEY) or {}
    out = {**DEFAULTS, **{key: stored[key] for key in DEFAULTS if key in stored}}
    for key in ("approval_above", "monthly_budget"):
        out[key] = Decimal(str(out[key])) if out[key] not in (None, "") else None
    return out


def save_workspace_settings(tenant, values: dict) -> dict:
    stored = {**((tenant.settings or {}).get(SETTINGS_KEY) or {})}
    for key in DEFAULTS:
        if key in values:
            value = values[key]
            stored[key] = str(value) if isinstance(value, Decimal) else value
    tenant.settings = {**(tenant.settings or {}), SETTINGS_KEY: stored}
    type(tenant).objects.filter(pk=tenant.pk).update(settings=tenant.settings)
    return workspace_settings(tenant)


# ---------------------------------------------------------------------------------------------------- SMS and MMS rates
@dataclass(frozen=True)
class Price:
    """The workspace's side of a rate."""
    rate_id: str
    unit: Decimal                     # a part, or an MMS
    fee: Decimal                      # the carrier fee the workspace pays with it (0 unless passed on)
    fees: str                         # PASS_ON, INCLUDED, ABSORBED
    effective_from: date
    effective_until: date | None
    cost: Decimal | None = None       # platform view only
    cost_fee: Decimal | None = None
    failed_billed: bool = True

    @property
    def each(self) -> Decimal:
        return self.unit + self.fee


def _rows(tenant_id, provider_ids=None, *, platform=False) -> list[dict]:
    from .models import MessageRate
    if platform:
        rates = MessageRate.objects.using(platform_alias()).filter(tenant_id=tenant_id)
        fields = (*PRICE_FIELDS, "sms_cost", "mms_cost", "carrier_fee_part", "carrier_fee_mms", "failed_billed")
    else:
        rates = MessageRate.objects.filter(tenant_id=tenant_id)
        fields = PRICE_FIELDS
    if provider_ids is not None:
        rates = rates.filter(delivery_provider_id__in=list(provider_ids))
    return list(rates.order_by("effective_from").values(*fields))


class RateBook:
    """Every SMS and MMS rate of a workspace, picked per message: the engine, the day, then the most specific sender type and country
    (a Short Code row beats an Any row; a country row beats All Countries; the country counts for more)."""

    def __init__(self, tenant_id, *, platform: bool = False, rows: list[dict] | None = None):
        self.platform = platform
        self.rows = rows if rows is not None else _rows(tenant_id, platform=platform)
        self.by_provider = defaultdict(list)
        for row in self.rows:
            self.by_provider[str(row["delivery_provider_id"])].append(row)

    def __bool__(self):
        return bool(self.rows)

    def row(self, provider_id, sender_type: str, country: str | None, day: date) -> dict | None:
        best, best_score = None, -1
        for row in self.by_provider.get(str(provider_id), ()):
            if row["effective_from"] > day or (row["effective_until"] and row["effective_until"] < day):
                continue
            if row["sender_type"] not in ("ANY", sender_type) or (row["country_code"] and row["country_code"] != country):
                continue
            score = (2 if row["country_code"] else 0) + (1 if row["sender_type"] != "ANY" else 0)
            if score > best_score or (score == best_score and row["effective_from"] > best["effective_from"]):          # the newer of two open rates
                best, best_score = row, score
        return best

    def price(self, provider_id, sender_type: str, country: str | None, day: date, kind: str) -> Price | None:
        """kind SMS (a part) or MMS (a message); None when no rate covers it (counted as "no rate", never as 0)."""
        row = self.row(provider_id, sender_type, country, day)
        if row is None:
            return None
        mms = kind == "MMS"
        unit = row["mms_price"] if mms else row["sms_price"]
        if unit is None:
            return None
        return Price(rate_id=str(row["id"]), unit=Decimal(unit), fee=Decimal(row["fee_mms_price"] if mms else row["fee_part_price"]), fees=row["carrier_fees"],
                     effective_from=row["effective_from"], effective_until=row["effective_until"],
                     cost=Decimal(row["mms_cost"] if mms else row["sms_cost"]) if self.platform and (row["mms_cost"] if mms else row["sms_cost"]) is not None else None,
                     cost_fee=Decimal(row["carrier_fee_mms"] if mms else row["carrier_fee_part"]) if self.platform else None,
                     failed_billed=row.get("failed_billed", True))


def provider_of_sender(sender_profile) -> tuple[str | None, str]:
    """(engine id, sender type) of a sender profile."""
    if sender_profile is None:
        return None, "ANY"
    return str(sender_profile.delivery_provider_id), countries.sender_type(sender_profile.sender_id)


# ---------------------------------------------------------------------------------------------------- WhatsApp rate cards
class WhatsAppBook:
    """A workspace's WhatsApp rate cards: the card of an engine on a day, and the price of a category in a country's market."""

    def __init__(self, tenant_id, *, platform: bool = False):
        from .models import WhatsAppRate, WhatsAppRateCard
        alias = platform_alias() if platform else None
        cards = WhatsAppRateCard.objects.using(alias) if alias else WhatsAppRateCard.objects
        rates = WhatsAppRate.objects.using(alias) if alias else WhatsAppRate.objects
        card_fields = ("id", "delivery_provider_id", "currency", "effective_from", "effective_until", "other_countries", "free_messages", "platform_fee")
        rate_fields = ("rate_card_id", "market", "price_marketing", "price_utility", "price_authentication")
        if platform:
            card_fields += ("pricing", "markup", "volume_discounts")
            rate_fields += ("cost_marketing", "cost_utility", "cost_authentication")
        self.platform = platform
        self.cards = list(cards.filter(tenant_id=tenant_id).order_by("effective_from").values(*card_fields))
        self.rates = defaultdict(dict)
        for rate in rates.filter(tenant_id=tenant_id).values(*rate_fields):
            self.rates[str(rate["rate_card_id"])][rate["market"]] = rate

    def __bool__(self):
        return bool(self.cards)

    def card(self, provider_id, day: date) -> dict | None:
        found = None
        for card in self.cards:
            if str(card["delivery_provider_id"]) == str(provider_id) and card["effective_from"] <= day and (not card["effective_until"] or card["effective_until"] >= day):
                found = card
        return found

    def market(self, card: dict, country: str | None) -> dict | None:
        markets = self.rates.get(str(card["id"]), {})
        name = countries.market_for(country, list(markets))
        if name is None or (name == countries.OTHER and not card["other_countries"]):
            return None
        return markets[name]

    def price(self, provider_id, country: str | None, day: date, category: str) -> tuple[Decimal | None, Decimal | None]:
        """(price, cost) of a delivered message of the category; (None, None) when no card or market covers it."""
        card = self.card(provider_id, day)
        if card is None:
            return None, None
        rate = self.market(card, country)
        if rate is None:
            return None, None
        key = (category or "MARKETING").lower()
        if key not in ("marketing", "utility", "authentication"):
            key = "marketing"
        price = rate.get(f"price_{key}")
        cost = rate.get(f"cost_{key}") if self.platform else None
        return (Decimal(price) if price is not None else None), (Decimal(cost) if cost is not None else None)

    def free_price(self, provider_id, day: date) -> Decimal:
        card = self.card(provider_id, day)
        if card and card["free_messages"] == "PLATFORM_FEE":
            return Decimal(card["platform_fee"] or 0)
        return ZERO


# ---------------------------------------------------------------------------------------------------- what was sent: the actual figures
@dataclass
class Tally:
    """Money and units, by line, for a set of sent messages."""
    units: dict = field(default_factory=lambda: defaultdict(int))          # SMS parts, MMS, WhatsApp delivered
    messages: dict = field(default_factory=lambda: defaultdict(int))
    price: dict = field(default_factory=lambda: defaultdict(Decimal))      # by line key
    cost: dict = field(default_factory=lambda: defaultdict(Decimal))
    lines: dict = field(default_factory=dict)                              # key -> {label, units, each, total}
    unpriced: int = 0                                                      # messages no rate covers
    failed_included: int = 0
    free: int = 0
    not_charged: int = 0

    @property
    def total(self) -> Decimal:
        return money(sum(self.price.values(), ZERO))

    @property
    def total_cost(self) -> Decimal:
        return money(sum(self.cost.values(), ZERO))

    def add(self, key: str, label: str, units: int, each: Decimal, cost_each: Decimal | None = None):
        line = self.lines.setdefault(key, {"label": label, "units": 0, "each": four(each), "total": ZERO})
        line["units"] += units
        line["total"] = line["total"] + Decimal(units) * each
        self.price[key] += Decimal(units) * each
        if cost_each is not None:
            self.cost[key] += Decimal(units) * cost_each

    def as_lines(self) -> list[dict]:
        return [{"label": line["label"], "units": line["units"], "each": str(line["each"]), "total": str(money(line["total"]))}
                for line in self.lines.values() if line["units"]]


SENT_SQL = """
SELECT e.delivery_provider_id::text, e.from_sender_id, e.message_type, (COALESCE(e.submitted_at, e.created_at) AT TIME ZONE 'UTC')::date AS day,
       e.status, substring(e.phone_number from 1 for 5) AS prefix, e.wa_billable, upper(COALESCE(e.wa_category, '')), COALESCE(e.wa_pricing_type, ''),
       count(*), COALESCE(sum(COALESCE(e.segment_count, 1)), 0) {extra}
  FROM sms_execution e {join}
 WHERE e.tenant_id = %s AND e.status <> 'QUEUED' AND e.not_sent_reason IS NULL AND COALESCE(e.provider_code, '') <> 'SANDBOX_SMS' {where}
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9 {group}
"""


def _sent_groups(tenant_id, *, alias: str, where: str = "", params=(), extra: str = "", join: str = "", group: str = "") -> list[tuple]:
    with connections[alias].cursor() as cursor:
        cursor.execute(SENT_SQL.format(where=where, extra=extra, join=join, group=group), [str(tenant_id), *params])
        return cursor.fetchall()


def tally_sent(tenant_id, *, alias: str | None = None, platform: bool = False, where: str = "", params=(), wa_category_of=None,
               split=None, extra: str = "", join: str = "", group: str = "") -> Tally | dict:
    """Price (and with platform, cost) every message matching `where` (SQL on sms_execution e). wa_category_of(day) gives the template
    category of WhatsApp messages Meta has not reported on yet. With `split` (a function of the extra column), a dict of Tallies."""
    alias = alias or (platform_alias() if platform else connections_default())
    book = RateBook(tenant_id, platform=platform)
    wa = WhatsAppBook(tenant_id, platform=platform)
    tallies = defaultdict(Tally)
    for row in _sent_groups(tenant_id, alias=alias, where=where, params=params, extra=extra, join=join, group=group):
        provider_id, sender, kind, day, status, prefix, billable, category, pricing_type, count, parts = row[:11]
        bucket = split(row[11]) if split else None
        tally = tallies[bucket]
        country = countries.country_of(prefix + "0000000")
        tally.messages[kind] += count
        if kind == "WHATSAPP":
            charged = bool(billable) if billable is not None else status in WA_CHARGED_STATUSES
            if not charged:
                if billable is False and status in WA_CHARGED_STATUSES:
                    tally.free += count
                    fee = wa.free_price(provider_id, day)
                    if fee:
                        tally.add("wa-free", "Platform fee on free messages", count, fee)
                else:
                    tally.not_charged += count
                continue
            wanted = category if category in CATEGORIES else ((wa_category_of(day) if wa_category_of else None) or "MARKETING")
            price, cost = wa.price(provider_id, country, day, wanted)
            if price is None:
                tally.unpriced += count
                continue
            label = f"{countries.name_of(country) if country else 'Unknown country'}, {wanted.title()}"
            tally.add(f"wa:{country}:{wanted}", label, count, price, cost)
            tally.units["WHATSAPP"] += count
            continue
        unit_kind = "MMS" if kind == "MMS" else "SMS"
        price = book.price(provider_id, countries.sender_type(sender), country, day, unit_kind)
        if price is None:
            tally.unpriced += count
            continue
        if status == "FAILED":
            if not price.failed_billed:
                tally.not_charged += count
                continue
            tally.failed_included += count
        units = count if unit_kind == "MMS" else parts
        noun = "MMS" if unit_kind == "MMS" else "parts"
        tally.add(f"{unit_kind}:{price.unit}", f"{noun}", units, price.unit, price.cost)
        if price.fee:
            tally.add(f"fee:{unit_kind}:{price.fee}", "Carrier fees", units, price.fee, price.cost_fee if price.fees == "PASS_ON" else None)
        elif price.cost_fee and platform:
            tally.cost[f"fee:{unit_kind}:absorbed"] += Decimal(units) * price.cost_fee         # included or absorbed: a cost with no price line
        tally.units[unit_kind] += units
    if split:
        return dict(tallies)
    return tallies[None]


def connections_default() -> str:
    from apps.tenants import context
    ctx = context.current()
    return ctx.db_alias if ctx else "default"


def has_rates(tenant_id) -> bool:
    """Whether anything a workspace sends has a price: a rate or a WhatsApp card."""
    from .models import MessageRate, WhatsAppRateCard
    return MessageRate.objects.filter(tenant_id=tenant_id).values("id").exists() or WhatsAppRateCard.objects.filter(tenant_id=tenant_id).values("id").exists()


# ---------------------------------------------------------------------------------------------------- before the send: the estimate
EXACT_UP_TO = 50_000           # every recipient's text is filled in and counted up to this many people; above, a sample
SAMPLE = 5_000
URL_RE = re.compile(r"https?://\S+")


def _zone(tenant):
    import zoneinfo
    try:
        return zoneinfo.ZoneInfo(tenant.timezone or "UTC")
    except Exception:                                                  # noqa: BLE001  an unknown zone: UTC
        return zoneinfo.ZoneInfo("UTC")


def tenant_day(tenant) -> date:
    from django.utils import timezone
    return timezone.now().astimezone(_zone(tenant)).date()


def send_day(campaign) -> date:
    """The day an estimate prices: the scheduled day, or today."""
    if campaign.scheduled_at:
        return campaign.scheduled_at.astimezone(_zone(campaign.tenant)).date()
    return tenant_day(campaign.tenant)


def text_kind(campaign) -> str | None:
    """SMS, MMS or WHATSAPP for a text campaign; None for email."""
    from .engine.runs import text_channel
    template = campaign.template if campaign.template_id else None
    if campaign.channel == "EMAIL" or (campaign.channel == "MULTI" and (template is None or template.channel not in ("SMS", "MMS", "WHATSAPP"))):
        return None
    return text_channel(campaign, template)


def sender_for(campaign, kind: str):
    """The campaign's sender, or the workspace's default sender of the channel (MMS falls back to SMS)."""
    from .models import SenderProfile
    if campaign.sender_profile_id:
        return campaign.sender_profile
    channels = ["WHATSAPP"] if kind == "WHATSAPP" else (["MMS", "SMS"] if kind == "MMS" else ["SMS"])
    senders = list(SenderProfile.objects.filter(tenant_id=campaign.tenant_id, channel__in=channels, deleted_at__isnull=True).order_by("-is_default", "created_at"))
    for channel in channels:
        for sender in senders:
            if sender.channel == channel:
                return sender
    return None


def _people(campaign, include, exclude):
    """(total who can receive it, rows): rows are (party_id, phone, first, last, custom_attributes, the list member's values), every
    one up to EXACT_UP_TO people and a sample above. The same people the Estimated Recipients panel counts."""
    from apps.campaigns import service
    from apps.tenants import context
    links = list(campaign.contact_list_campaigns.all()) if include is None and campaign.pk else []
    include = [str(i) for i in include] if include is not None else [str(link.contact_list_id) for link in links if link.role == "INCLUDE"]
    exclude = [str(i) for i in exclude] if exclude is not None else [str(link.contact_list_id) for link in links if link.role == "EXCLUDE"]
    marketing = getattr(campaign, "solicitation_type", "MARKETING") == "MARKETING"
    params = {"tenant": str(context.require().tenant_id), "include": include or [""], "exclude": exclude or [""]}
    sendable = "j.status = 'MARKETABLE'" if marketing else "j.status NOT IN ('BLOCKED', 'NO_PHONE')"
    head = service.AUDIENCE_BASE + f", judged AS ({service.TEXT_JUDGED})"
    with service._conn().cursor() as cursor:
        cursor.execute(head + f" SELECT count(*) FROM judged j WHERE {sendable}", params)
        total = cursor.fetchone()[0]
        limit = "" if total <= EXACT_UP_TO else f" ORDER BY md5(j.party_id) LIMIT {SAMPLE}"
        cursor.execute(head + f""" SELECT j.party_id, j.address, j.first_name, j.last_name, cm.custom_attributes,
                                          (SELECT m.custom_attributes FROM contact_list_member m WHERE m.tenant_id = %(tenant)s AND m.party_id = j.party_id
                                              AND m.contact_list_id::text = ANY(%(include)s) ORDER BY m.added_at DESC LIMIT 1)
                                     FROM judged j LEFT JOIN customer_master cm ON cm.tenant_id = %(tenant)s AND cm.party_id = j.party_id
                                    WHERE {sendable}{limit}""", params)
        rows = cursor.fetchall()
    return total, rows


def _as_json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return {}
    return value or {}


def _phone_country(phone: str | None, home: str | None) -> str | None:
    if phone and phone.strip().startswith("+"):
        return countries.country_of(phone)
    return home or countries.country_of(phone)


def _scaled(value, scale: Decimal) -> int:
    return int((Decimal(value) * scale).to_integral_value())


def estimate(campaign, include=None, exclude=None) -> dict:
    """What the campaign will cost the workspace, from the people who can receive it today and each one's own text. Missing set-up
    is not an error: {"available": False, "reason": ...} says what is missing."""
    from apps.templates.models import RenderedTemplateContent
    tenant = campaign.tenant
    kind = text_kind(campaign)
    if kind is None:
        return {"available": False, "reason": "Costs are worked out for texts: SMS, MMS and WhatsApp."}
    if campaign.campaign_type in ("DRIP", "E_RECEIPT", "WARM_UP") or campaign.is_journey_generated:
        return {"available": False, "reason": "Drips, journeys and e-receipts are counted in the month's spend as they send."}
    sender = sender_for(campaign, kind)
    if sender is None:
        return {"available": False, "reason": "Choose a sender to see the price."}
    provider_id, sender_kind = provider_of_sender(sender)
    day = send_day(campaign)
    template = campaign.template if campaign.template_id else None
    content = RenderedTemplateContent.objects.filter(template_id=template.pk).order_by("-version_number").first() if template else None
    base = {"available": True, "currency": currency(tenant), "channel": kind, "price_date": day.isoformat(), "sender": sender.display_name,
            "from_price": content is None}
    if kind == "WHATSAPP":
        return _estimate_whatsapp(campaign, include, exclude, base, provider_id, day, template)
    return _estimate_text(campaign, include, exclude, base, kind, provider_id, sender_kind, day, content)


def _estimate_whatsapp(campaign, include, exclude, out, provider_id, day, template) -> dict:
    wa = WhatsAppBook(campaign.tenant_id)
    card = wa.card(provider_id, day)
    if card is None:
        return {"available": False, "reason": "WhatsApp prices are not set up for this workspace yet."}
    category = "MARKETING"
    if template is not None:
        from apps.templates.models import WhatsAppTemplate
        category = (WhatsAppTemplate.objects.filter(template=template).values_list("category", flat=True).first() or "MARKETING").upper()
    own = workspace_settings(campaign.tenant)
    chosen = set(own["wa_countries"] or [])
    total, rows = _people(campaign, include, exclude)
    scale = Decimal(total) / Decimal(len(rows)) if rows and total > len(rows) else Decimal(1)
    markets = wa.rates.get(str(card["id"]), {})
    people, left_out, unpriced = defaultdict(int), 0, 0
    for _party, phone, *_rest in rows:
        market = countries.market_for(_phone_country(phone, own["home_country"]), list(markets))
        if market is None or (market == countries.OTHER and not card["other_countries"]):
            unpriced += 1
        elif chosen and market not in chosen:
            left_out += 1
        else:
            people[market] += 1
    lines, grand = [], ZERO
    for market, count in sorted(people.items(), key=lambda item: -item[1]):
        each = Decimal(markets[market].get(f"price_{category.lower()}") or 0)
        units = _scaled(count, scale)
        lines.append({"label": market, "units": units, "each": str(four(each)), "total": str(money(each * units))})
        grand += each * units
    recipients = _scaled(sum(people.values()), scale)
    out.update({"category": category, "recipients": recipients, "units": recipients, "unit": "messages", "parts": [], "lines": lines, "total": str(money(grand)),
                "upto": True, "per_recipient": str(four(grand / recipients)) if recipients else None, "country_not_chosen": _scaled(left_out, scale),
                "unpriced": _scaled(unpriced, scale), "exact": total <= EXACT_UP_TO, "counted": len(rows), "from_price": False})
    return out


def _estimate_text(campaign, include, exclude, out, kind, provider_id, sender_kind, day, content) -> dict:
    from apps.templates import design
    book = RateBook(campaign.tenant_id)
    if not any(book.price(provider_id, sender_kind, country, day, kind) for country in {None, *(r["country_code"] for r in book.by_provider.get(provider_id, ()))}):
        return {"available": False, "reason": f"{'MMS' if kind == 'MMS' else 'SMS'} prices are not set up for this sender yet."}
    total, rows = _people(campaign, include, exclude)
    scale = Decimal(total) / Decimal(len(rows)) if rows and total > len(rows) else Decimal(1)
    render = _text_renderer(campaign, content) if kind == "SMS" and content is not None else None
    parts_of, by_rate, unpriced, empty = defaultdict(int), {}, 0, 0
    for party, phone, first, last, attributes, pairs in rows:
        rate = book.price(provider_id, sender_kind, _phone_country(phone, None), day, kind)
        if rate is None:
            unpriced += 1
            continue
        parts = 1
        if render is not None:
            text = render(party, phone, first, last, attributes, pairs)
            if not text:
                empty += 1
                continue
            parts = design.sms_metrics(text)["segments"] or 1
        parts_of[parts] += 1
        entry = by_rate.setdefault((rate.unit, rate.fee), [0, rate])
        entry[0] += parts
    unit_word = "MMS" if kind == "MMS" else "parts"
    lines, grand, units_total = [], ZERO, 0
    for (unit, fee), (units, _rate) in by_rate.items():
        scaled = _scaled(units, scale)
        lines.append({"label": unit_word, "units": scaled, "each": str(four(unit)), "total": str(money(unit * scaled))})
        grand += unit * scaled
        if fee:
            lines.append({"label": "Carrier fees", "units": scaled, "each": str(four(fee)), "total": str(money(fee * scaled))})
            grand += fee * scaled
        units_total += scaled
    recipients = _scaled(sum(parts_of.values()), scale)
    parts = [{"parts": count, "people": _scaled(people, scale), "units": _scaled(people * count, scale)} for count, people in sorted(parts_of.items())]
    out.update({"recipients": recipients, "units": units_total, "unit": unit_word, "parts": parts if kind == "SMS" else [], "lines": lines, "total": str(money(grand)),
                "per_recipient": str(four(grand / recipients)) if recipients else None, "unpriced": _scaled(unpriced, scale), "empty": _scaled(empty, scale),
                "exact": total <= EXACT_UP_TO, "counted": len(rows), "upto": False, "from_price": kind == "SMS" and render is None})
    return out


def _text_renderer(campaign, content):
    """fill(party, phone, first, last, attributes, pairs) -> the text this person would get, as the send worker makes it (short links
    counted at their short length, curly quotes made plain)."""
    from apps.campaigns import service
    from apps.templates import design
    from apps.templates.models import PersonalizationTag
    from .engine.dispatch_sms import text_content
    from .engine.linktags import Tagger, short_base
    from .engine.render import Renderer
    tags = list(PersonalizationTag.objects.filter(tenant_id=campaign.tenant_id, is_active=True, deleted_at__isnull=True))
    renderer = Renderer(campaign=campaign, run=None, content=text_content(content), tags=tags)
    tagger = Tagger(campaign, "SMS", service._conn().alias, renderer)
    short = f"{short_base(campaign.tenant.code)}/xxxxxxx/" if tagger.on else None

    def fill(party, phone, first, last, attributes, pairs):
        text = renderer.render(customer={"party_id": party, "first_name": first, "last_name": last, "custom_attributes": _as_json(attributes)},
                               member={"custom_value_pairs": _as_json(pairs)}, system={"phone": phone or ""})["text"].strip()
        if short:
            text = URL_RE.sub(short, text)
        return design.gsm_safe(text)[0]
    return fill


# ---------------------------------------------------------------------------------------------------- the month, and the limits
def month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    return start, (start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1))


def day_bounds(tenant, start: date, end: date):
    """The first and the day after the last as moments in the workspace's time zone."""
    from datetime import datetime, time
    zone = _zone(tenant)
    return datetime.combine(start, time.min, tzinfo=zone), datetime.combine(end, time.min, tzinfo=zone)


KIND_SQL = ("CASE WHEN c.campaign_type = 'E_RECEIPT' THEN 'RECEIPTS' WHEN c.is_journey_generated OR c.campaign_type IN ('JOURNEY', 'DRIP') THEN 'JOURNEYS' "
            "ELSE 'CAMPAIGNS' END")


def month_spend(tenant, day: date | None = None, *, platform: bool = False, cached: bool = True) -> dict:
    """Every text sent in the calendar month, split into campaigns, journeys and drips, and e-receipts; plus the production campaigns
    due later in the month at their stored estimate."""
    from django.core.cache import cache
    day = day or tenant_day(tenant)
    start, end = month_bounds(day)
    key = f"cep:msgcost:month:{tenant.pk}:{start.isoformat()}:{int(platform)}"
    found = cache.get(key) if cached else None
    if found is not None:
        return found
    tallies = tally_sent(tenant.pk, platform=platform, where="AND e.created_at >= %s AND e.created_at < %s", params=list(day_bounds(tenant, start, end)), extra=", " + KIND_SQL,
                         join="LEFT JOIN campaign c ON c.id = e.campaign_id AND c.tenant_id = e.tenant_id", group=", 12", split=lambda value: value)
    parts = {name: (tallies[name].total if name in tallies else ZERO) for name in ("CAMPAIGNS", "JOURNEYS", "RECEIPTS")}
    sent = money(sum(parts.values(), ZERO))
    scheduled = scheduled_estimates(tenant, start, end)
    result = {"month": start.isoformat(), "sent": str(sent), "campaigns": str(parts["CAMPAIGNS"]), "journeys": str(parts["JOURNEYS"]), "receipts": str(parts["RECEIPTS"]),
              "scheduled": str(money(scheduled)), "total": str(money(sent + scheduled)), "days_left": (end - day).days}
    if platform:
        result["cost"] = str(money(sum((tally.total_cost for tally in tallies.values()), ZERO)))
    cache.set(key, result, 120)
    return result


def scheduled_estimates(tenant, start: date, end: date) -> Decimal:
    """Production campaigns that have not started and are due in the month, at their stored estimate."""
    from django.utils import timezone
    from apps.campaigns.models import Campaign
    since, until = day_bounds(tenant, start, end)
    stored = Campaign.objects.filter(tenant_id=tenant.pk, status="PRODUCTION_PUBLISHED", scheduled_at__gte=since, scheduled_at__lt=until,
                                     scheduled_at__gt=timezone.now(), deleted_at__isnull=True).values_list("cost_estimate", flat=True)
    return sum((Decimal(str(_as_json(value).get("total") or 0)) for value in stored), ZERO)


RANK = {"OK": 0, "WARN": 1, "APPROVAL": 2, "BLOCK": 3}


def check(tenant, total: Decimal, campaign=None) -> dict:
    """The workspace's limits against an estimate: OK, WARN, APPROVAL or BLOCK, and the words for it."""
    own = workspace_settings(tenant)
    total = money(total)
    cur = currency(tenant) or ""
    out = {"state": "OK", "reasons": [], "approval_above": str(own["approval_above"]) if own["approval_above"] is not None else None,
           "monthly_budget": str(own["monthly_budget"]) if own["monthly_budget"] is not None else None, "over_budget": own["over_budget"]}

    def raise_to(state, words):
        out["reasons"].append(words)
        if RANK[state] > RANK[out["state"]]:
            out["state"] = state
    if own["approval_above"] is not None and total > own["approval_above"]:
        raise_to("APPROVAL", f"The estimate, {total} {cur}, is above the approval limit of {money(own['approval_above'])} {cur}.")
    if own["monthly_budget"] is not None:
        spend = month_spend(tenant, send_day(campaign) if campaign is not None else None)
        already = Decimal(spend["total"])
        if campaign is not None and campaign.status == "PRODUCTION_PUBLISHED":
            already -= Decimal(str(_as_json(campaign.cost_estimate).get("total") or 0))
        after = money(already + total)
        out.update({"month_spent": str(money(already)), "after": str(after)})
        if after > own["monthly_budget"]:
            raise_to(own["over_budget"] if own["over_budget"] in OVER_BUDGET else "APPROVAL",
                     f"The month's spend would be {after} {cur}, over the budget of {money(own['monthly_budget'])} {cur}.")
    out["message"] = " ".join(out["reasons"])
    return out


def estimate_with_check(campaign, include=None, exclude=None, *, store: bool = False) -> dict:
    """The estimate and the limits. With store, kept on the campaign: the approval and the month's scheduled spend read it."""
    figure = estimate(campaign, include, exclude)
    if figure.get("available"):
        figure["check"] = check(campaign.tenant, Decimal(figure["total"]), campaign)
    if store and campaign.pk:
        from django.utils import timezone
        from apps.campaigns.models import Campaign
        kept = None
        if figure.get("available"):
            kept = {"total": figure["total"], "currency": figure.get("currency"), "state": figure["check"]["state"], "message": figure["check"]["message"],
                    "at": timezone.now().isoformat()}
        Campaign.objects.filter(pk=campaign.pk).update(cost_estimate=kept)
        campaign.cost_estimate = kept
    return figure


def needs_approval(campaign) -> bool:
    """The stored estimate is above the approval limit, or over a budget that needs approval."""
    return _as_json(getattr(campaign, "cost_estimate", None)).get("state") == "APPROVAL"


def blocked(campaign) -> str | None:
    stored = _as_json(getattr(campaign, "cost_estimate", None))
    return stored.get("message") if stored.get("state") == "BLOCK" else None


# ---------------------------------------------------------------------------------------------------- after the send
def campaign_actual(campaign, *, platform: bool = False) -> dict | None:
    """What a campaign's texts really cost, from the parts each used (SMS, MMS) or Meta's reports (WhatsApp); None for email or when
    nothing it sent has a price."""
    kind = text_kind(campaign)
    if kind is None:
        return None
    category = None
    if kind == "WHATSAPP" and campaign.template_id:
        from apps.templates.models import WhatsAppTemplate
        category = WhatsAppTemplate.objects.filter(template_id=campaign.template_id).values_list("category", flat=True).first()
    tally = tally_sent(campaign.tenant_id, platform=platform, where="AND e.campaign_id = %s", params=[str(campaign.pk)], wa_category_of=lambda _day: category)
    if not tally.lines and not (tally.not_charged or tally.free):
        return None
    out = {"currency": currency(campaign.tenant), "channel": kind, "total": str(tally.total), "lines": tally.as_lines(), "failed_included": tally.failed_included,
           "not_charged": tally.not_charged, "free": tally.free, "unpriced": tally.unpriced, "units": dict(tally.units), "messages": sum(tally.messages.values()),
           "sending": campaign.status in ("PRODUCTION_PUBLISHED", "ACTIVE"), "estimate": _as_json(campaign.cost_estimate).get("total")}
    if platform:
        out["cost"] = str(tally.total_cost)
    return out
