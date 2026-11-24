"""What texts cost, for the workspace (apps/delivery/costs.py): Settings → Message Costs, the price line on a text template, a campaign's
estimate before it goes out and its actual cost after. Prices only: costs and margins stay in the back-office. Money is shown to
people whose role carries cost.view (View Message Costs); the limits are set by a workspace administrator (user.admin)."""
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.cache import cache
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.campaigns.models import Campaign
from apps.delivery import costs, countries
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.identity.models import Role
from apps.tenants import context
from apps.tenants.models import Tenant

VIEW = [IsAuthenticated, HasPermissionCode.for_(costs.PERMISSION)]


class SeesOrAdmin(BasePermission):
    """Reading: View Message Costs or a workspace administrator. Changing the limits: a workspace administrator."""

    def has_permission(self, request, view):
        user = request.user
        if getattr(user, "is_platform_admin", False):
            return True
        if hasattr(user, "has_scope"):
            return user.has_scope("user:admin") or (request.method == "GET" and user.has_scope("cost:view"))
        codes = user.permission_codes()
        return "user.admin" in codes or (request.method == "GET" and costs.PERMISSION in codes)


def _tenant() -> Tenant:
    return Tenant.objects.get(pk=context.require().tenant_id)


def _money(value) -> str | None:
    return None if value is None else str(costs.four(value))


# ---------------------------------------------------------------------------------------------------- the prices a workspace sees
def text_prices(tenant, day: date) -> list[dict]:
    """One row per SMS / MMS sender: today's price and the next one when a change is coming."""
    book = costs.RateBook(tenant.pk)
    if not book:
        return []
    out = []
    senders = SenderProfile.objects.filter(tenant_id=tenant.pk, channel__in=("SMS", "MMS"), deleted_at__isnull=True).select_related("delivery_provider").order_by("-is_default", "display_name")
    for sender in senders:
        provider_id, kind = costs.provider_of_sender(sender)
        row = book.row(provider_id, kind, None, day)
        later = [r for r in book.by_provider.get(provider_id, ()) if r["effective_from"] > day and r["sender_type"] in ("ANY", kind) and not r["country_code"]]
        nxt = min(later, key=lambda r: r["effective_from"]) if later else None
        countries_priced = sorted({r["country_code"] for r in book.by_provider.get(provider_id, ()) if r["country_code"]})
        if row is None and nxt is None and not countries_priced:
            continue
        shown = lambda r: None if r is None else {"effective_from": r["effective_from"], "effective_until": r["effective_until"], "sms": _money(r["sms_price"]),  # noqa: E731
                                                  "mms": _money(r["mms_price"]), "fee_part": _money(r["fee_part_price"]), "fee_mms": _money(r["fee_mms_price"]),
                                                  "fees": r["carrier_fees"]}
        out.append({"sender_id": str(sender.pk), "sender": sender.display_name, "number": sender.sender_id, "channel": sender.channel, "is_default": sender.is_default,
                    "engine": sender.delivery_provider.name, "sender_type": costs_label(kind), "current": shown(row), "next": shown(nxt),
                    "countries": [{"code": code, "name": countries.name_of(code)} for code in countries_priced]})
    return out


def costs_label(kind: str) -> str:
    return countries.SENDER_TYPE_LABELS.get(kind, kind)


def contacts_by_market(tenant, markets: list[str]) -> dict:
    """How many of the workspace's people have a number in each market (their primary number's country)."""
    key = f"cep:msgcost:contacts:{tenant.pk}"
    by_prefix = cache.get(key)
    if by_prefix is None:
        from apps.campaigns import service
        with service._conn().cursor() as cursor:
            cursor.execute("""SELECT substring(ph.number from 1 for 5), count(*) FROM customer_master cm
                                CROSS JOIN LATERAL (SELECT p ->> 'number' AS number FROM jsonb_array_elements(cm.phones) p
                                                     ORDER BY COALESCE((p ->> 'is_primary')::boolean, FALSE) DESC LIMIT 1) ph
                               WHERE cm.tenant_id = %s AND ph.number LIKE '+%%' GROUP BY 1""", [str(tenant.pk)])
            by_prefix = dict(cursor.fetchall())
        cache.set(key, by_prefix, 600)
    out = {}
    for prefix, count in by_prefix.items():
        market = countries.market_for(countries.country_of(prefix + "0000000"), markets)
        if market:
            out[market] = out.get(market, 0) + count
    return out


def whatsapp_prices(tenant, day: date) -> list[dict]:
    """One entry per WhatsApp engine with a rate card in force (or starting later)."""
    wa = costs.WhatsAppBook(tenant.pk)
    if not wa:
        return []
    own = costs.workspace_settings(tenant)
    chosen = own["wa_countries"] or []
    out = []
    for engine in DeliveryProvider.objects.filter(tenant_id=tenant.pk, channel="WHATSAPP", deleted_at__isnull=True).order_by("name"):
        card = wa.card(engine.pk, day) or next((c for c in wa.cards if str(c["delivery_provider_id"]) == str(engine.pk) and c["effective_from"] > day), None)
        if card is None:
            continue
        rates = wa.rates.get(str(card["id"]), {})
        contacts = contacts_by_market(tenant, list(rates))
        markets = [{"market": name, "marketing": _money(rate["price_marketing"]), "utility": _money(rate["price_utility"]),
                    "authentication": _money(rate["price_authentication"]), "contacts": contacts.get(name, 0), "chosen": not chosen or name in chosen,
                    "countries": [countries.name_of(code) for code in countries.market_members(name)]}
                   for name, rate in rates.items() if name != countries.OTHER or card["other_countries"]]
        markets.sort(key=lambda m: (-m["contacts"], m["market"]))
        out.append({"engine_id": str(engine.pk), "engine": engine.name, "currency": card["currency"], "effective_from": card["effective_from"],
                    "free_messages": card["free_messages"], "platform_fee": _money(card["platform_fee"]), "other_countries": card["other_countries"], "markets": markets,
                    "left_out_contacts": sum(m["contacts"] for m in markets if not m["chosen"])})
    return out


class MessageCostsView(APIView):
    """Settings → Message Costs: the prices (read-only), this month's spend, the limits and who sees costs."""
    permission_classes = [IsAuthenticated, SeesOrAdmin]

    def _payload(self, request, tenant):
        day = costs.tenant_day(tenant)
        texts, whatsapp = text_prices(tenant, day), whatsapp_prices(tenant, day)
        set_up = bool(texts or whatsapp)
        own = costs.workspace_settings(tenant)
        viewers = sorted(Role.objects.filter(tenant_id=tenant.pk, deleted_at__isnull=True, role_permissions__permission__code=costs.PERMISSION).values_list("name", flat=True).distinct())
        user = request.user
        can_edit = getattr(user, "is_platform_admin", False) or (not hasattr(user, "has_scope") and "user.admin" in user.permission_codes())
        return {"currency": costs.currency(tenant), "set_up": set_up, "texts": texts, "whatsapp": whatsapp,
                "settings": {**own, "approval_above": _plain(own["approval_above"]), "monthly_budget": _plain(own["monthly_budget"]),
                             "home_country_name": countries.name_of(own["home_country"]) if own["home_country"] else None},
                "month": costs.month_spend(tenant) if set_up else None, "viewers": viewers, "can_edit": can_edit,
                "countries": [{"code": code, "name": name} for code, name in countries.choices()]}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(request, _tenant()))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        tenant = _tenant()
        data, errors, values = request.data or {}, {}, {}
        for key in ("approval_above", "monthly_budget"):
            if key in data:
                raw = data[key]
                if raw in (None, ""):
                    values[key] = None
                    continue
                try:
                    amount = Decimal(str(raw).replace(",", ""))
                except InvalidOperation:
                    errors[key] = "Enter an amount, like 100.00, or leave it empty."
                    continue
                if amount <= 0 or amount > Decimal("10000000"):
                    errors[key] = "Enter an amount above 0, or leave it empty."
                    continue
                values[key] = costs.money(amount)
        if "warn_at" in data:
            try:
                warn = int(data["warn_at"])
            except (TypeError, ValueError):
                warn = -1
            if not 50 <= warn <= 100:
                errors["warn_at"] = "Enter a percent from 50 to 100."
            values["warn_at"] = warn
        if "over_budget" in data:
            if data["over_budget"] not in costs.OVER_BUDGET:
                errors["over_budget"] = "Choose Warn Only, Needs Approval or Block Publishing."
            values["over_budget"] = data["over_budget"]
        if "wa_countries" in data:
            chosen = data["wa_countries"]
            if chosen is not None and (not isinstance(chosen, list) or not all(isinstance(item, str) for item in chosen)):
                errors["wa_countries"] = "Choose the countries from the list."
            values["wa_countries"] = chosen or None
        if "home_country" in data:
            code = (data["home_country"] or "").upper() or None
            if code and code not in countries.COUNTRIES:
                errors["home_country"] = "Choose a country from the list."
            values["home_country"] = code
        if errors:
            raise ValidationError(errors)
        costs.save_workspace_settings(tenant, values)
        cache.delete_many([f"cep:msgcost:month:{tenant.pk}:{costs.month_bounds(costs.tenant_day(tenant))[0].isoformat()}:0"])
        return Response(self._payload(request, tenant))


def _plain(value):
    return None if value is None else str(value)


class MessagePricesView(APIView):
    """The price line under a text template's part counter: the default sender's price for SMS and MMS, and WhatsApp by category for
    the home country (and the dearest other country)."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        day = costs.tenant_day(tenant)
        out = {"currency": costs.currency(tenant), "sms": None, "mms": None, "whatsapp": None}
        book = costs.RateBook(tenant.pk)
        if book:
            draft = Campaign(tenant=tenant, channel="SMS")
            for kind in ("SMS", "MMS"):
                sender = costs.sender_for(draft, kind)
                if sender is None:
                    continue
                provider_id, sender_kind = costs.provider_of_sender(sender)
                price = book.price(provider_id, sender_kind, None, day, kind)
                if price is not None:
                    out[kind.lower()] = {"each": _money(price.unit), "fee": _money(price.fee), "fees": price.fees, "sender": sender.display_name,
                                         "number": sender.sender_id}
        wa = costs.WhatsAppBook(tenant.pk)
        if wa:
            own = costs.workspace_settings(tenant)
            for engine_id in {str(card["delivery_provider_id"]) for card in wa.cards}:
                card = wa.card(engine_id, day)
                if card is None:
                    continue
                rates = wa.rates.get(str(card["id"]), {})
                home = own["home_country"] or "US"
                home_market = countries.market_for(home, list(rates))
                chosen = own["wa_countries"] or list(rates)
                by_category = {}
                for category in ("marketing", "utility", "authentication"):
                    others = [Decimal(rate[f"price_{category}"]) for name, rate in rates.items() if name in chosen and name != home_market and rate[f"price_{category}"] is not None]
                    home_price = rates[home_market][f"price_{category}"] if home_market else None
                    by_category[category] = {"home": _money(home_price), "others_max": _money(max(others)) if others else None}
                out["whatsapp"] = {"home_country": home, "home_name": countries.name_of(home), "market": home_market, "prices": by_category,
                                   "free_messages": card["free_messages"]}
                break
        return Response(out)


class CampaignCostView(APIView):
    """GET: what the campaign's texts actually cost so far. POST: the estimate before it goes out (body include / exclude: the lists the
    setup has chosen and not saved yet); kept on the campaign when the saved lists are used."""
    permission_classes = VIEW

    def _campaign(self, pk):
        return get_object_or_404(Campaign.objects.select_related("tenant", "template", "sender_profile"), pk=pk, tenant_id=context.require().tenant_id,
                                 deleted_at__isnull=True)

    @extend_schema(responses={200: None})
    def get(self, request, pk, version=None):
        campaign = self._campaign(pk)
        return Response({"actual": costs.campaign_actual(campaign), "estimate": costs._as_json(campaign.cost_estimate) or None})

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk, version=None):
        campaign = self._campaign(pk)
        include, exclude = request.data.get("include"), request.data.get("exclude")
        if include is not None and not isinstance(include, list) or exclude is not None and not isinstance(exclude, list):
            raise ValidationError({"include": "A list of contact list ids."})
        editable = campaign.status in ("DRAFT", "TEST_PUBLISHED")
        return Response(costs.estimate_with_check(campaign, include, exclude, store=editable and include is None))
