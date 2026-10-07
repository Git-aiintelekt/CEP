"""Reports: the workspace over a period, campaigns compared, and the weekly email.

Figures come from the execution tables (mailer_execution, sms_execution) joined to their runs, test runs left out, and
from consent_record for unsubscribes and campaign_actual for revenue. Nothing new is collected. A period is a range of
days in the workspace's time zone; the partition key (created_at) bounds every scan. Each execution table is read once
(grouping sets give the totals, the days, the campaigns and the hours from one pass) and a summary is kept for 30 s.
"""
import csv
import io
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.utils import timezone

from apps.campaigns import service
from apps.campaigns.models import Campaign
from apps.tenants import context
from apps.tenants.models import Tenant

MAX_DAYS = 366
MIN_SENT_FOR_RATES = 50                                    # a rate over fewer sends says little
WEEKLY_KEY = "reports"
WEEKLY_DEFAULTS = {"enabled": False, "weekday": 0, "hour": 8, "recipients": [], "last_sent_on": None}


class ReportError(Exception):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def _conn():
    from django.db import connections
    return connections[context.require().db_alias]


def zone_of(tenant) -> ZoneInfo:
    try:
        return ZoneInfo(getattr(tenant, "timezone", None) or "UTC")
    except Exception:                                      # noqa: BLE001
        return ZoneInfo("UTC")


def period(start: date | None, end: date | None, zone: ZoneInfo) -> tuple[datetime, datetime, date, date]:
    """[start 00:00, end 24:00) in the zone; default: this month so far."""
    today = timezone.now().astimezone(zone).date()
    end = end or today
    start = start or end.replace(day=1)
    if end < start:
        raise ReportError("to", "The end of the period is before its start.")
    if (end - start).days >= MAX_DAYS:
        raise ReportError("to", f"A report covers up to {MAX_DAYS} days.")
    return datetime.combine(start, time.min, tzinfo=zone), datetime.combine(end + timedelta(days=1), time.min, tzinfo=zone), start, end


def _rate(part, whole) -> float:
    return round(part * 100 / whole, 1) if whole else 0.0


def _rates(row: dict) -> dict:
    return {"delivery": _rate(row["delivered"], row["sent"]), "open": _rate(row["opened"], row["delivered"]), "click": _rate(row["clicked"], row["delivered"]),
            "bounce": _rate(row["bounced"], row["sent"]), "unsubscribe": _rate(row["unsubscribed"], row["delivered"])}


COUNTS = {"EMAIL": """count(*) FILTER (WHERE x.status NOT IN ('QUEUED', 'FAILED')), count(*) FILTER (WHERE x.status IN ('DELIVERED', 'OPENED', 'CLICKED')),
                      count(*) FILTER (WHERE x.status IN ('OPENED', 'CLICKED')), count(*) FILTER (WHERE x.status = 'CLICKED'), count(*) FILTER (WHERE x.status = 'BOUNCED'),
                      count(*) FILTER (WHERE x.status = 'COMPLAINED'), count(*) FILTER (WHERE x.status = 'FAILED' AND x.not_sent_reason IS NULL)""",
          "SMS": """count(*) FILTER (WHERE x.status NOT IN ('QUEUED', 'FAILED')), count(*) FILTER (WHERE x.status IN ('DELIVERED', 'RESPONDED', 'OPTED_OUT')),
                    0::bigint, 0::bigint, 0::bigint, 0::bigint, count(*) FILTER (WHERE x.status = 'FAILED' AND x.not_sent_reason IS NULL)"""}
TABLE = {"EMAIL": "mailer_execution", "SMS": "sms_execution"}


def summary(tenant, start: date | None = None, end: date | None = None, *, channel: str | None = None) -> dict:
    tenant = tenant if isinstance(tenant, Tenant) else Tenant.objects.get(pk=tenant)
    zone = zone_of(tenant)
    since, until, first_day, last_day = period(start, end, zone)
    families = ["EMAIL", "SMS"] if not channel else [channel.upper()]
    if any(family not in TABLE for family in families):
        raise ReportError("channel", "Filter by EMAIL or SMS.")
    cache_key = f"cep:report_summary:{tenant.pk}:{first_day}:{last_day}:{channel or ''}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    args = {"tenant": str(tenant.pk), "since": since, "until": until, "zone": zone.key}
    totals = {"sent": 0, "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0, "complained": 0, "failed": 0, "unsubscribed": 0, "replied": 0}
    by_channel, days, campaigns, hours = {}, {}, {}, {}
    with _conn().cursor() as cursor:
        for family in families:
            # one pass: grouping(day, campaign, hour) is 7 for the totals, 3 for a day, 5 for a campaign, 6 for an hour
            cursor.execute(f"""SELECT grouping(x.day, x.campaign_id, x.hour), x.day, x.campaign_id::text, x.hour, min(x.submitted_at), {COUNTS[family]}
                                 FROM (SELECT (x.submitted_at AT TIME ZONE %(zone)s)::date AS day, x.campaign_id, extract(hour FROM x.submitted_at AT TIME ZONE %(zone)s)::int AS hour,
                                              x.submitted_at, x.status, x.not_sent_reason
                                         FROM {TABLE[family]} x JOIN campaign_run r ON r.id = x.campaign_run_id
                                        WHERE x.tenant_id = %(tenant)s AND NOT r.test_mode AND x.created_at >= %(since)s AND x.created_at < %(until)s) x
                                GROUP BY GROUPING SETS ((x.day), (x.campaign_id), (x.hour), ())""", args)
            by_channel[family] = {"sent": 0, "delivered": 0, "opened": 0, "clicked": 0, "bounced": 0, "complained": 0, "failed": 0}
            for group, day, pk, hour, first_sent, sent, delivered, opened, clicked, bounced, complained, failed in cursor.fetchall():
                counts = {"sent": int(sent), "delivered": int(delivered), "opened": int(opened), "clicked": int(clicked), "bounced": int(bounced), "complained": int(complained), "failed": int(failed)}
                if group == 7:
                    by_channel[family] = counts
                    for key, value in counts.items():
                        totals[key] += value
                elif group == 3 and day is not None:
                    slot = days.setdefault(day, {"day": day, "sent": 0, "delivered": 0, "opened": 0, "clicked": 0})
                    for key in ("sent", "delivered", "opened", "clicked"):
                        slot[key] += counts[key]
                elif group == 5:
                    row = campaigns.setdefault(pk, {"id": pk, "name": None, "channel": None, "campaign_type": None, "first_sent_at": None, "sent": 0, "delivered": 0,
                                                    "opened": 0, "clicked": 0, "bounced": 0, "complained": 0, "failed": 0, "unsubscribed": 0, "revenue": None, "conversions": 0})
                    row["first_sent_at"] = min(filter(None, [row["first_sent_at"], first_sent]), default=None)
                    for key, value in counts.items():
                        row[key] += value
                elif group == 6 and hour is not None and family == "EMAIL" and counts["delivered"]:
                    hours[int(hour)] = (counts["delivered"], counts["opened"])
        if campaigns:
            cursor.execute("SELECT id::text, name, channel, campaign_type FROM campaign WHERE tenant_id = %(tenant)s AND id::text = ANY(%(ids)s)", {**args, "ids": list(campaigns)})
            for pk, name, chan, kind in cursor.fetchall():
                campaigns[pk].update(name=name, channel=chan, campaign_type=kind)
        cursor.execute("""SELECT campaign_id::text, count(*) FROM consent_record WHERE tenant_id = %(tenant)s AND action = 'OPT_OUT' AND occurred_at >= %(since)s AND occurred_at < %(until)s
                          GROUP BY 1""", args)
        for pk, count in cursor.fetchall():
            totals["unsubscribed"] += int(count)
            if pk in campaigns:
                campaigns[pk]["unsubscribed"] += int(count)
        if campaigns:
            cursor.execute("""SELECT DISTINCT ON (campaign_id) campaign_id::text, attributed_revenue, attributed_conversions FROM campaign_actual
                               WHERE tenant_id = %(tenant)s AND campaign_id::text = ANY(%(ids)s) ORDER BY campaign_id, computed_at DESC""", {**args, "ids": list(campaigns)})
            for pk, revenue, conversions in cursor.fetchall():
                campaigns[pk]["revenue"] = float(revenue) if revenue is not None else None
                campaigns[pk]["conversions"] = int(conversions or 0)
    rows = sorted(campaigns.values(), key=lambda row: (row["first_sent_at"] or datetime.min.replace(tzinfo=ZoneInfo("UTC"))), reverse=True)
    for row in rows:
        row["rates"] = _rates(row)
    rated = [row for row in rows if row["sent"] >= MIN_SENT_FOR_RATES] or rows
    best_hour = max(((hour, opened, delivered) for hour, (delivered, opened) in hours.items() if delivered >= MIN_SENT_FOR_RATES), key=lambda item: item[1] / item[2], default=None)
    highlights = {"highest_open_rate": max(rated, key=lambda row: row["rates"]["open"], default=None), "highest_click_rate": max(rated, key=lambda row: row["rates"]["click"], default=None),
                  "most_unsubscribes": max(rated, key=lambda row: row["rates"]["unsubscribe"], default=None),
                  "best_send_hour": {"hour": best_hour[0], "open_rate": _rate(best_hour[1], best_hour[2])} if best_hour else None}
    revenue = [row["revenue"] for row in rows if row["revenue"] is not None]
    result = {"period": {"from": first_day, "to": last_day, "timezone": zone.key, "days": (last_day - first_day).days + 1}, "channel": channel and channel.upper(),
            "totals": {**totals, "campaigns": len(rows), "revenue": round(sum(revenue), 2) if revenue else None, "conversions": sum(row["conversions"] for row in rows)},
            "rates": _rates(totals), "by_channel": by_channel, "days": [days[key] for key in sorted(days)],
            "campaigns": rows, "highlights": {key: ({"id": value["id"], "name": value["name"], "rates": value["rates"]} if isinstance(value, dict) and "rates" in value else value)
                                              for key, value in highlights.items()}}
    cache.set(cache_key, result, service.RESULTS_CACHE_TTL)
    return result


def csv_text(report: dict) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["campaign", "channel", "type", "first_sent", "sent", "delivered", "opened", "clicked", "bounced", "complained", "failed", "unsubscribed",
                     "delivery_rate", "open_rate", "click_rate", "bounce_rate", "unsubscribe_rate", "conversions", "revenue"])
    for row in report["campaigns"]:
        name = row["name"] if not (row["name"] and row["name"][0] in "=+-@") else "'" + row["name"]
        writer.writerow([name, row["channel"], row["campaign_type"], row["first_sent_at"].isoformat(timespec="minutes") if row["first_sent_at"] else "",
                         row["sent"], row["delivered"], row["opened"], row["clicked"], row["bounced"], row["complained"], row["failed"], row["unsubscribed"],
                         row["rates"]["delivery"], row["rates"]["open"], row["rates"]["click"], row["rates"]["bounce"], row["rates"]["unsubscribe"], row["conversions"],
                         "" if row["revenue"] is None else row["revenue"]])
    totals = report["totals"]
    writer.writerow(["Total", "", "", "", totals["sent"], totals["delivered"], totals["opened"], totals["clicked"], totals["bounced"], totals["complained"], totals["failed"],
                     totals["unsubscribed"], report["rates"]["delivery"], report["rates"]["open"], report["rates"]["click"], report["rates"]["bounce"], report["rates"]["unsubscribe"],
                     totals["conversions"], "" if totals["revenue"] is None else totals["revenue"]])
    return "﻿" + out.getvalue()


def compare(campaign_ids: list[str]) -> list[dict]:
    """Two or more campaigns side by side: their results and their day-by-day curves."""
    ids = list(dict.fromkeys(str(item) for item in campaign_ids))
    if len(ids) < 2:
        raise ReportError("ids", "Choose at least two campaigns to compare.")
    if len(ids) > 6:
        raise ReportError("ids", "Compare up to six campaigns at a time.")
    found = {str(campaign.pk): campaign for campaign in Campaign.objects.filter(pk__in=ids, deleted_at__isnull=True)}
    missing = [item for item in ids if item not in found]
    if missing:
        raise ReportError("ids", "One of the campaigns does not exist.")
    out = []
    for item in ids:
        campaign = found[item]
        out.append({"id": item, "name": campaign.name, "channel": campaign.channel, "campaign_type": campaign.campaign_type, "status": campaign.status,
                    "published_at": campaign.published_at, "metrics": service.metrics(campaign), "days": service.timeseries(campaign, "day")["points"]})
    return out


# ---------------------------------------------------------------- the weekly email
def weekly_settings(tenant) -> dict:
    stored = (tenant.settings.get(WEEKLY_KEY) or {}).get("weekly") or {}
    return {**WEEKLY_DEFAULTS, **{key: stored[key] for key in WEEKLY_DEFAULTS if key in stored}}


def save_weekly(tenant, data: dict) -> dict:
    current = weekly_settings(tenant)
    if "enabled" in data:
        current["enabled"] = bool(data["enabled"])
    if "weekday" in data:
        if not isinstance(data["weekday"], int) or not 0 <= data["weekday"] <= 6:
            raise ReportError("weekday", "The weekday is 0 (Monday) to 6 (Sunday).")
        current["weekday"] = data["weekday"]
    if "hour" in data:
        if not isinstance(data["hour"], int) or not 0 <= data["hour"] <= 23:
            raise ReportError("hour", "The hour is 0 to 23, in the workspace's time zone.")
        current["hour"] = data["hour"]
    if "recipients" in data:
        from apps.platform_ops.notifications import EMAIL_RE, MAX_EMAILS
        raw = data["recipients"]
        if isinstance(raw, str):
            raw = raw.replace(";", ",").split(",")
        if not isinstance(raw, list):
            raise ReportError("recipients", "Send a list of addresses.")
        emails = list(dict.fromkeys(str(item).strip().lower() for item in raw if str(item).strip()))
        bad = [item for item in emails if not EMAIL_RE.match(item)]
        if bad:
            raise ReportError("recipients", f"Not an email address: {', '.join(bad[:3])}")
        if len(emails) > MAX_EMAILS:
            raise ReportError("recipients", f"Up to {MAX_EMAILS} addresses.")
        current["recipients"] = emails
    if current["enabled"] and not current["recipients"]:
        raise ReportError("recipients", "Add at least one address to send the weekly report to.")
    tenant.settings = {**tenant.settings, WEEKLY_KEY: {**(tenant.settings.get(WEEKLY_KEY) or {}), "weekly": current}}
    tenant.save(update_fields=["settings"])
    return current


def mark_weekly_sent(tenant, day: date) -> None:
    weekly = {**weekly_settings(tenant), "last_sent_on": day.isoformat()}
    tenant.settings = {**tenant.settings, WEEKLY_KEY: {**(tenant.settings.get(WEEKLY_KEY) or {}), "weekly": weekly}}
    tenant.save(update_fields=["settings"])


def _day(value) -> date:
    return date.fromisoformat(value) if isinstance(value, str) else value


def weekly_lines(report: dict) -> list[str]:
    totals, rates = report["totals"], report["rates"]
    lines = [f"{_day(report['period']['from']):%d %b} to {_day(report['period']['to']):%d %b}: {totals['sent']:,} sent across {totals['campaigns']} campaign{'s' if totals['campaigns'] != 1 else ''}.",
             f"Delivered {rates['delivery']}%, opened {rates['open']}%, clicked {rates['click']}%, bounced {rates['bounce']}%, unsubscribed {totals['unsubscribed']:,}."]
    if totals["revenue"] is not None:
        lines.append(f"Attributed revenue {totals['revenue']:,.2f}, conversions {totals['conversions']:,}.")
    best = report["highlights"]
    if best.get("highest_open_rate"):
        lines.append(f"Highest open rate: {best['highest_open_rate']['name']} at {best['highest_open_rate']['rates']['open']}%.")
    if best.get("most_unsubscribes") and best["most_unsubscribes"]["rates"]["unsubscribe"] > 0:
        lines.append(f"Most unsubscribes: {best['most_unsubscribes']['name']} at {best['most_unsubscribes']['rates']['unsubscribe']}%.")
    if best.get("best_send_hour"):
        lines.append(f"Best send hour: {best['best_send_hour']['hour']:02d}:00 with {best['best_send_hour']['open_rate']}% opens.")
    if not totals["sent"]:
        lines = ["Nothing was sent this week."]
    return lines
