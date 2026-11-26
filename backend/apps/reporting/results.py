"""Campaign results for other systems (the Results API, api/v1/results_api.py).

What each campaign and each of its sends did, counted over the messages created in a window of days: whole days in the
workspace's time zone, no further back than WINDOW_DAYS. The window bounds every scan by the partition key (created_at),
so an e-receipt or journey campaign that never ends is read a month at most, never whole. Each execution table is read
once, grouped by campaign and send; a campaign's figures are the sum of its sends'. Test sends never count, and nothing
personal is read: no address, no number, no name.

The figures follow the campaign's own Results tab (apps/campaigns/service.metrics): rates are of what was delivered,
a message CEP chose not to send is not_sent and never failed. Held back are the people the audience rules left out
before any message was made (apps/delivery/engine/audience.py), by reason. Money is the campaign's latest attribution
rollup (campaign_actual), for the campaign as a whole whatever the window.
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.utils import timezone

from apps.campaigns import service
from apps.delivery.engine import session
from apps.tenants.models import Tenant

WINDOW_DAYS = 30
COUNT_KEYS = ("messages", "queued", "not_sent", "failed", "sent", "delivered", "opened", "clicked", "bounced", "complained", "replied", "opted_out")

MESSAGES = {
    "EMAIL": """SELECT x.campaign_id::text, x.campaign_run_id::text, count(*), count(*) FILTER (WHERE x.status = 'QUEUED'),
                       count(*) FILTER (WHERE x.not_sent_reason IS NOT NULL), count(*) FILTER (WHERE x.status = 'FAILED' AND x.not_sent_reason IS NULL),
                       count(*) FILTER (WHERE x.status NOT IN ('QUEUED', 'FAILED')), count(*) FILTER (WHERE x.status IN ('DELIVERED', 'OPENED', 'CLICKED')),
                       count(*) FILTER (WHERE x.status IN ('OPENED', 'CLICKED')), count(*) FILTER (WHERE x.status = 'CLICKED'),
                       count(*) FILTER (WHERE x.status = 'BOUNCED'), count(*) FILTER (WHERE x.status = 'COMPLAINED'), 0::bigint, 0::bigint,
                       min(x.submitted_at), max(x.submitted_at),
                       max(GREATEST(x.created_at, x.submitted_at, x.delivered_at, x.opened_at, x.clicked_at, x.bounced_at, x.complained_at))
                  FROM mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id
                 WHERE x.tenant_id = %(tenant)s AND NOT r.test_mode AND x.created_at >= %(since)s AND x.created_at < %(until)s
                 GROUP BY 1, 2""",
    # a WhatsApp message's "opened" is Meta's read report; a text has no opens, clicks, bounces or complaints
    "TEXT": """SELECT x.campaign_id::text, x.campaign_run_id::text, count(*), count(*) FILTER (WHERE x.status = 'QUEUED'),
                      count(*) FILTER (WHERE x.not_sent_reason IS NOT NULL), count(*) FILTER (WHERE x.status = 'FAILED' AND x.not_sent_reason IS NULL),
                      count(*) FILTER (WHERE x.status NOT IN ('QUEUED', 'FAILED')), count(*) FILTER (WHERE x.status IN ('DELIVERED', 'RESPONDED', 'OPTED_OUT')),
                      count(*) FILTER (WHERE x.read_at IS NOT NULL), 0::bigint, 0::bigint, 0::bigint,
                      count(*) FILTER (WHERE x.status IN ('RESPONDED', 'OPTED_OUT')), count(*) FILTER (WHERE x.status = 'OPTED_OUT'),
                      min(x.submitted_at), max(x.submitted_at),
                      max(GREATEST(x.created_at, x.submitted_at, x.delivered_at, x.responded_at, x.read_at, x.failed_at))
                 FROM sms_execution x JOIN campaign_run r ON r.id = x.campaign_run_id
                WHERE x.tenant_id = %(tenant)s AND NOT r.test_mode AND x.created_at >= %(since)s AND x.created_at < %(until)s
                GROUP BY 1, 2""",
}
HELD_BACK = """SELECT l.campaign_id::text, l.campaign_run_id::text, m.suppression_reason, count(*)
                 FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id LEFT JOIN campaign_run r ON r.id = l.campaign_run_id
                WHERE m.tenant_id = %(tenant)s AND m.suppression_reason IS NOT NULL AND m.created_at >= %(since)s AND m.created_at < %(until)s
                  AND NOT COALESCE(r.test_mode, FALSE)
                GROUP BY 1, 2, 3"""
UNSUBSCRIBED = """SELECT campaign_id::text, campaign_run_id::text, count(*), max(occurred_at) FROM consent_record
                   WHERE tenant_id = %(tenant)s AND action = 'OPT_OUT' AND campaign_id IS NOT NULL AND occurred_at >= %(since)s AND occurred_at < %(until)s
                   GROUP BY 1, 2"""


class ResultsError(Exception):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def zone_of(tenant) -> ZoneInfo:
    try:
        return ZoneInfo(getattr(tenant, "timezone", None) or "UTC")
    except Exception:                                      # noqa: BLE001
        return ZoneInfo("UTC")


def window(sent_from: date | None, sent_to: date | None, zone: ZoneInfo) -> tuple[datetime, datetime, date, date]:
    """[sent_from 00:00, sent_to 24:00) in the zone. Left out: the whole of what may be read, WINDOW_DAYS back to today."""
    today = timezone.now().astimezone(zone).date()
    earliest = today - timedelta(days=WINDOW_DAYS)
    first, last = sent_from or earliest, min(sent_to or today, today)
    if first < earliest:
        raise ResultsError("sent_from", f"Results go back {WINDOW_DAYS} days: no earlier than {earliest.isoformat()}.")
    if last < first:
        raise ResultsError("sent_to", "The end of the window is before its start.")
    return datetime.combine(first, time.min, tzinfo=zone), datetime.combine(last + timedelta(days=1), time.min, tzinfo=zone), first, last


def _blank() -> dict:
    return {**dict.fromkeys(COUNT_KEYS, 0), "consent_opt_outs": 0, "held_back": {}, "first_sent_at": None, "last_sent_at": None, "last_activity_at": None}


def _earliest(a, b):
    return min((value for value in (a, b) if value is not None), default=None)


def _latest(a, b):
    return max((value for value in (a, b) if value is not None), default=None)


def _add(into: dict, part: dict) -> None:
    for key in (*COUNT_KEYS, "consent_opt_outs"):
        into[key] += part[key]
    for reason, count in part["held_back"].items():
        into["held_back"][reason] = into["held_back"].get(reason, 0) + count
    into["first_sent_at"] = _earliest(into["first_sent_at"], part["first_sent_at"])
    into["last_sent_at"] = _latest(into["last_sent_at"], part["last_sent_at"])
    into["last_activity_at"] = _latest(into["last_activity_at"], part["last_activity_at"])


def _figures(raw: dict) -> dict:
    """What a consumer reads for a campaign or a send: counts, rates of what was delivered, and who was held back."""
    held = dict(sorted(raw["held_back"].items()))
    held_total = sum(held.values())
    unsubscribed = max(raw["consent_opt_outs"], raw["opted_out"])            # a STOP reply is an unsubscribe even before its consent record
    counts = {"audience": raw["messages"] + held_total, "held_back": held_total, "queued": raw["queued"], "not_sent": raw["not_sent"], "sent": raw["sent"],
              "failed": raw["failed"], "delivered": raw["delivered"], "opened": raw["opened"], "clicked": raw["clicked"], "bounced": raw["bounced"],
              "complained": raw["complained"], "unsubscribed": unsubscribed, "replied": raw["replied"]}
    rate = service.rate
    return {"counts": counts,
            "rates": {"delivery": rate(counts["delivered"], counts["sent"]), "open": rate(counts["opened"], counts["delivered"]), "click": rate(counts["clicked"], counts["delivered"]),
                      "bounce": rate(counts["bounced"], counts["sent"]), "unsubscribe": rate(unsubscribed, counts["delivered"])},
            "held_back": held, "first_sent_at": raw["first_sent_at"], "last_sent_at": raw["last_sent_at"], "last_activity_at": raw["last_activity_at"]}


def _number(value, places: int = 2):
    return None if value is None else round(float(value), places)


def collect(tenant, sent_from: date | None = None, sent_to: date | None = None) -> dict:
    """{"as_of", "window", "campaigns": [...], "runs": [...]}: every campaign and send with a message or a held-back person
    in the window, the latest first. Kept for service.RESULTS_CACHE_TTL seconds, so the pages of one read agree."""
    tenant = tenant if isinstance(tenant, Tenant) else Tenant.objects.get(pk=tenant)
    zone = zone_of(tenant)
    since, until, first_day, last_day = window(sent_from, sent_to, zone)
    cache_key = f"cep:results_api:{tenant.pk}:{first_day}:{last_day}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    as_of = timezone.now()
    args = {"tenant": str(tenant.pk), "since": since, "until": until}
    by_run: dict[tuple, dict] = {}                         # (campaign, run): a held-back list made before its run exists has run None
    with session.tx(), session.connection().cursor() as cursor:
        for statement in MESSAGES.values():
            cursor.execute(statement, args)
            for campaign_id, run_id, *numbers, first_sent, last_sent, activity in cursor.fetchall():
                _add(by_run.setdefault((campaign_id, run_id), _blank()),
                     {**dict(zip(COUNT_KEYS, (int(n) for n in numbers))), "consent_opt_outs": 0, "held_back": {}, "first_sent_at": first_sent, "last_sent_at": last_sent,
                      "last_activity_at": activity})
        cursor.execute(HELD_BACK, args)
        for campaign_id, run_id, reason, count in cursor.fetchall():
            slot = by_run.setdefault((campaign_id, run_id), _blank())
            slot["held_back"][reason] = slot["held_back"].get(reason, 0) + int(count)
        in_window = {campaign_id for campaign_id, _ in by_run}
        cursor.execute(UNSUBSCRIBED, args)
        for campaign_id, run_id, count, latest in cursor.fetchall():
            if campaign_id not in in_window:
                continue                                   # an unsubscribe from a message older than the window
            slot = by_run.setdefault((campaign_id, run_id) if (campaign_id, run_id) in by_run else (campaign_id, None), _blank())
            slot["consent_opt_outs"] += int(count)
            slot["last_activity_at"] = _latest(slot["last_activity_at"], latest)
        by_campaign: dict[str, dict] = {}
        for (campaign_id, _), raw in by_run.items():
            _add(by_campaign.setdefault(campaign_id, _blank()), raw)
        ids, run_ids = list(by_campaign), [run_id for _, run_id in by_run if run_id]
        about, about_run, money = {}, {}, {}
        if ids:
            cursor.execute("""SELECT id::text, code, name, campaign_type, channel, status, origin_journey_id::text FROM campaign
                               WHERE tenant_id = %(tenant)s AND id::text = ANY(%(ids)s)""", {**args, "ids": ids})
            about = {row[0]: dict(zip(("id", "code", "name", "campaign_type", "channel", "status", "journey_id"), row)) for row in cursor.fetchall()}
            cursor.execute("""SELECT DISTINCT ON (campaign_id) campaign_id::text, attributed_revenue, attributed_orders, attributed_conversions, actual_delivery_cost, offer_cost,
                                     campaign_contribution, campaign_roi, computed_at
                                FROM campaign_actual WHERE tenant_id = %(tenant)s AND campaign_id::text = ANY(%(ids)s) ORDER BY campaign_id, computed_at DESC""", {**args, "ids": ids})
            for campaign_id, revenue, orders, conversions, message_cost, offer_cost, contribution, roi, computed_at in cursor.fetchall():
                money[campaign_id] = {"revenue": _number(revenue), "orders": orders, "conversions": conversions, "message_cost": _number(message_cost),
                                      "offer_cost": _number(offer_cost), "contribution": _number(contribution), "roi": _number(roi, 4), "computed_at": computed_at}
        if run_ids:
            cursor.execute("""SELECT id::text, run_number, run_type, status, sequence_label, scheduled_at, started_at, completed_at FROM campaign_run
                               WHERE tenant_id = %(tenant)s AND id::text = ANY(%(ids)s) AND NOT test_mode""", {**args, "ids": run_ids})
            about_run = {row[0]: dict(zip(("id", "run_number", "run_type", "status", "label", "scheduled_at", "started_at", "completed_at"), row)) for row in cursor.fetchall()}
    from apps.delivery import costs
    currency = costs.currency(tenant)
    campaigns = [{**about[campaign_id], **_figures(raw), "money": ({"currency": currency, **money[campaign_id]} if campaign_id in money else None)}
                 for campaign_id, raw in by_campaign.items() if campaign_id in about]
    runs = [{**about_run[run_id], "campaign_id": campaign_id, "campaign_code": about[campaign_id]["code"], "channel": about[campaign_id]["channel"],
             "campaign_type": about[campaign_id]["campaign_type"], **_figures(raw)}
            for (campaign_id, run_id), raw in by_run.items() if run_id in about_run and campaign_id in about]
    floor = datetime.min.replace(tzinfo=ZoneInfo("UTC"))
    campaigns.sort(key=lambda row: (row["last_sent_at"] or row["last_activity_at"] or floor, row["code"]), reverse=True)
    runs.sort(key=lambda row: (row["started_at"] or row["scheduled_at"] or floor, row["campaign_code"], row["run_number"]), reverse=True)
    result = {"as_of": as_of, "window": {"sent_from": first_day, "sent_to": last_day, "timezone": zone.key, "days_kept": WINDOW_DAYS}, "campaigns": campaigns, "runs": runs}
    cache.set(cache_key, result, service.RESULTS_CACHE_TTL)
    return result
