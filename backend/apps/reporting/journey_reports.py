"""The Journeys dataset in Reports: per journey per day over a period, in the workspace's time zone.

    entered      enrollments by the day they entered
    converted    enrollments by the day their goal was reached (or, without a Goal step, the day they reached an Exit), with revenue
    sent, delivered, opened, clicked, bounced   the journeys' generated campaigns' messages (mailer_execution, sms_execution), test runs left out
    held_back, failed                           message steps a customer did not get: held by governance (SKIPPED) or failed

GET /reports/journeys/ answers the totals, the day-by-day curve, a row per journey and a row per journey per day; /reports/journeys.csv
is the per-journey-per-day rows as a file. ?journey= narrows everything to one journey. Kept for 30 s like the campaigns report.
"""
import csv
import io
from datetime import date

from django.core.cache import cache

from apps.campaigns import service
from apps.tenants.models import Tenant

from .reports import COUNTS, TABLE, _conn, _rate, period, zone_of

KEYS = ("entered", "converted", "revenue", "sent", "delivered", "opened", "clicked", "bounced", "held_back", "failed")

ENTERED_SQL = """SELECT e.journey_id::text, (e.enrolled_at AT TIME ZONE %(zone)s)::date, count(*)
                   FROM journey_enrollment e WHERE e.tenant_id = %(tenant)s AND e.enrolled_at >= %(since)s AND e.enrolled_at < %(until)s GROUP BY 1, 2"""
CONVERTED_SQL = """SELECT e.journey_id::text, (e.converted_at AT TIME ZONE %(zone)s)::date, count(*), coalesce(sum(e.attributed_revenue), 0)
                     FROM journey_enrollment e WHERE e.tenant_id = %(tenant)s AND e.converted_at >= %(since)s AND e.converted_at < %(until)s GROUP BY 1, 2"""
HELD_SQL = """SELECT e.journey_id::text, (x.executed_at AT TIME ZONE %(zone)s)::date,
                     count(*) FILTER (WHERE x.execution_status = 'SKIPPED'), count(*) FILTER (WHERE x.execution_status = 'FAILED')
                FROM journey_node_execution x
                JOIN journey_enrollment e ON e.id = x.journey_enrollment_id AND e.tenant_id = x.tenant_id
                JOIN journey_node n ON n.id = x.journey_node_id
               WHERE x.tenant_id = %(tenant)s AND x.executed_at >= %(since)s AND x.executed_at < %(until)s AND n.node_family = 'COMMUNICATION'
                 AND x.execution_status IN ('SKIPPED', 'FAILED') GROUP BY 1, 2"""
JOURNEYS_SQL = "SELECT id::text, name, status, population_mode FROM journey WHERE tenant_id = %(tenant)s AND deleted_at IS NULL ORDER BY name"


def _messages_sql(family: str) -> str:
    return f"""SELECT g.journey_id::text, (coalesce(x.submitted_at, x.created_at) AT TIME ZONE %(zone)s)::date, {COUNTS[family]}
                 FROM {TABLE[family]} x
                 JOIN campaign_run r ON r.id = x.campaign_run_id
                 JOIN journey_generated_campaign g ON g.tenant_id = x.tenant_id AND g.campaign_id = x.campaign_id
                WHERE x.tenant_id = %(tenant)s AND NOT r.test_mode AND x.created_at >= %(since)s AND x.created_at < %(until)s
                GROUP BY 1, 2"""


def _blank() -> dict:
    return {key: 0 for key in KEYS}


def _rates(row: dict) -> dict:
    return {"conversion": _rate(row["converted"], row["entered"]), "delivery": _rate(row["delivered"], row["sent"]), "open": _rate(row["opened"], row["delivered"]),
            "click": _rate(row["clicked"], row["delivered"])}


def summary(tenant, start: date | None = None, end: date | None = None, *, journey_id: str | None = None) -> dict:
    tenant = tenant if isinstance(tenant, Tenant) else Tenant.objects.get(pk=tenant)
    zone = zone_of(tenant)
    since, until, first_day, last_day = period(start, end, zone)
    journey_id = (journey_id or "").strip() or None
    cache_key = f"cep:report_journeys:{tenant.pk}:{first_day}:{last_day}:{journey_id or ''}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    args = {"tenant": str(tenant.pk), "since": since, "until": until, "zone": zone.key}
    cells: dict[tuple[str, date], dict] = {}

    def cell(pk, day) -> dict:
        return cells.setdefault((pk, day), _blank())

    with _conn().cursor() as cursor:
        cursor.execute(JOURNEYS_SQL, args)
        journeys = {pk: {"id": pk, "name": name, "status": status, "population_mode": mode} for pk, name, status, mode in cursor.fetchall()}
        cursor.execute(ENTERED_SQL, args)
        for pk, day, count in cursor.fetchall():
            cell(pk, day)["entered"] += int(count)
        cursor.execute(CONVERTED_SQL, args)
        for pk, day, count, revenue in cursor.fetchall():
            slot = cell(pk, day)
            slot["converted"] += int(count)
            slot["revenue"] = round(slot["revenue"] + float(revenue), 2)
        for family in ("EMAIL", "SMS"):
            cursor.execute(_messages_sql(family), args)
            for pk, day, sent, delivered, opened, clicked, bounced, _complained, failed in cursor.fetchall():
                slot = cell(pk, day)
                for key, value in (("sent", sent), ("delivered", delivered), ("opened", opened), ("clicked", clicked), ("bounced", bounced)):
                    slot[key] += int(value)
        cursor.execute(HELD_SQL, args)
        for pk, day, held, failed in cursor.fetchall():
            slot = cell(pk, day)
            slot["held_back"] += int(held)
            slot["failed"] += int(failed)

    if journey_id:
        cells = {key: value for key, value in cells.items() if key[0] == journey_id}
    totals, days, per_journey = _blank(), {}, {}
    rows = []
    for (pk, day), figures in sorted(cells.items(), key=lambda item: (item[0][1], journeys.get(item[0][0], {}).get("name") or "")):
        if pk not in journeys:                                           # a journey deleted since: its figures stay out
            continue
        for key in KEYS:
            totals[key] += figures[key]
            days.setdefault(day, {"day": day, **_blank()})[key] += figures[key]
            per_journey.setdefault(pk, {**journeys[pk], **_blank()})[key] += figures[key]
        rows.append({"journey_id": pk, "journey_name": journeys[pk]["name"], "day": day, **figures})
    for slot in list(days.values()) + list(per_journey.values()) + [totals]:
        slot["revenue"] = round(slot["revenue"], 2)
    journey_rows = sorted(per_journey.values(), key=lambda row: (-row["entered"], row["name"]))
    for row in journey_rows:
        row["rates"] = _rates(row)
    result = {"period": {"from": first_day, "to": last_day, "timezone": zone.key, "days": (last_day - first_day).days + 1}, "journey": journey_id,
              "journeys": sorted(journeys.values(), key=lambda row: row["name"]), "totals": {**totals, "journeys": len(journey_rows)}, "rates": _rates(totals),
              "days": [days[key] for key in sorted(days)], "by_journey": journey_rows, "rows": rows}
    cache.set(cache_key, result, service.RESULTS_CACHE_TTL)
    return result


def csv_text(report: dict) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["journey", "day", *KEYS])
    for row in report["rows"]:
        name = row["journey_name"] if not (row["journey_name"] and row["journey_name"][0] in "=+-@") else "'" + row["journey_name"]
        writer.writerow([name, row["day"].isoformat(), *(row[key] for key in KEYS)])
    writer.writerow(["Total", "", *(report["totals"][key] for key in KEYS)])
    return "﻿" + out.getvalue()
