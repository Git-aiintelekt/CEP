"""Scheduled delivery (Phase E, option 1 of docs/mockups/insights-scheduled-delivery.html): a report emailed on a schedule,
every day, every weekday, weekly on a day or monthly on a day, at a time in the workspace's zone, to a list of addresses,
as Excel, CSV or PDF (a dashboard as PDF, on its saved period), with a subject and a note. Sent through the workspace's
own mail server, built by the engine with the rights and masking of whoever scheduled it, each sending recorded
(report_delivery) and audited (kind "delivery"); three failures in a row pause the schedule.

    GET, POST            /insights/schedules/                  the schedules this person may see (own; all for report.admin); a new one
    GET, PUT, DELETE     /insights/schedules/<id>/
    POST                 /insights/schedules/<id>/pause/, /resume/
    POST                 /insights/schedules/<id>/test/        send it now, to the person asking
"""
import csv
import io
import json
import re
from datetime import date, datetime, time, timedelta
from datetime import timezone as utc_zone
from zoneinfo import ZoneInfo

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.engine import session
from apps.insights import catalog, excel, runner
from apps.insights.api import VIEW, _has, _q, _report_row, _tenant
from apps.insights.definition import DefinitionError, validate
from apps.platform_ops import mail
from apps.reporting import reports
from apps.tenants import context

EVERY = ("day", "weekday", "week", "month")
FORMATS = ("xlsx", "csv", "pdf")
MAX_RECIPIENTS = 20
PAUSE_AFTER = 3
ADDRESS = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---------------------------------------------------------------------------------------------------- when
def next_run(every: str, on_day: int | None, at: time, zone: ZoneInfo, after: datetime) -> datetime:
    """The first moment after `after` the schedule falls on, in the workspace's zone, as an aware UTC datetime."""
    local = after.astimezone(zone)
    day = local.date()
    for _ in range(0, 40):
        candidate = datetime.combine(day, at, tzinfo=zone)
        fits = (every == "day" or (every == "weekday" and day.weekday() < 5) or (every == "week" and day.isoweekday() == int(on_day or 1))
                or (every == "month" and day.day == int(on_day or 1)))
        if fits and candidate > local:
            return candidate.astimezone(utc_zone.utc)
        day += timedelta(days=1)
    raise ValueError("no next run within forty days")


def words(row: dict) -> str:
    at = row["at_time"].strftime("%H:%M") if isinstance(row["at_time"], time) else str(row["at_time"])[:5]
    every = row["every"]
    if every == "week":
        return f"Every {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][int(row['on_day'] or 1) - 1]} at {at}"
    if every == "month":
        n = int(row["on_day"] or 1)
        return f"Monthly on the {n}{'th' if 11 <= n <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')} at {at}"
    return f"Every {'weekday' if every == 'weekday' else 'day'} at {at}"


# ---------------------------------------------------------------------------------------------------- rows
def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _schedule_row(schedule_id, request=None) -> dict:
    rows = _q("""SELECT s.id::text, s.kind, s.item_id::text, s.owner_user_id::text, u.display_name AS owner_name, s.every, s.on_day, s.at_time, s.format, s.recipients, s.subject, s.note,
                        s.status, s.failures, s.last_sent_at, s.last_outcome, s.last_detail, s.next_run_at, s.row_version, s.created_at, s.updated_at,
                        COALESCE(r.name, d.name) AS item_name, r.view_type, COALESCE(r.deleted_at, d.deleted_at) AS item_deleted_at
                   FROM report_schedule s LEFT JOIN app_user u ON u.id = s.owner_user_id LEFT JOIN report r ON r.id = s.item_id AND s.kind = 'report'
                   LEFT JOIN dashboard d ON d.id = s.item_id AND s.kind = 'dashboard'
                  WHERE s.id = %s AND s.deleted_at IS NULL""", [str(schedule_id)])
    if not rows:
        raise NotFound("No such schedule.")
    row = rows[0]
    if request is not None and not _may_see(request, row):
        raise NotFound("No such schedule.")
    return row


def _may_see(request, row: dict) -> bool:
    return _has(request, "report.admin") or str(row["owner_user_id"]) == str(request.user.pk)


def _may_change(request, row: dict) -> bool:
    return _may_see(request, row) and (_has(request, "report.admin") or _has(request, "report.edit"))


def _serialize(row: dict) -> dict:
    return {"id": row["id"], "kind": row["kind"], "item_id": row["item_id"], "item_name": row["item_name"], "view_type": row["view_type"], "item_gone": row["item_deleted_at"] is not None,
            "owner_user_id": row["owner_user_id"], "owner_name": row["owner_name"], "every": row["every"], "on_day": row["on_day"],
            "at_time": row["at_time"].strftime("%H:%M") if isinstance(row["at_time"], time) else str(row["at_time"])[:5], "format": row["format"],
            "recipients": _json(row["recipients"]), "subject": row["subject"], "note": row["note"], "status": row["status"], "failures": row["failures"],
            "last_sent_at": row["last_sent_at"], "last_outcome": row["last_outcome"], "last_detail": row["last_detail"], "next_run_at": row["next_run_at"],
            "words": words(row), "row_version": row["row_version"], "created_at": row["created_at"], "updated_at": row["updated_at"]}


def _validated(request, body: dict, current: dict | None = None) -> dict:
    """The fields of a schedule, checked; `current` fills what the body leaves out."""
    out = {}
    every = str(body.get("every", current["every"] if current else "")).lower()
    if every not in EVERY:
        raise ValidationError({"every": "Every day, weekday, week or month."})
    out["every"] = every
    on_day = body.get("on_day", current["on_day"] if current else None)
    if every == "week":
        if on_day not in range(1, 8):
            raise ValidationError({"on_day": "A day of the week, 1 (Monday) to 7 (Sunday)."})
    elif every == "month":
        if on_day not in range(1, 29):
            raise ValidationError({"on_day": "A day of the month, 1 to 28."})
    else:
        on_day = None
    out["on_day"] = on_day
    at_raw = body.get("at_time", current["at_time"].strftime("%H:%M") if current and isinstance(current["at_time"], time) else (str(current["at_time"])[:5] if current else None))
    try:
        hours, minutes = str(at_raw).split(":")
        out["at_time"] = time(int(hours), int(minutes))
    except (ValueError, AttributeError):
        raise ValidationError({"at_time": "A time like 08:00."}) from None
    kind = str(body.get("kind", current["kind"] if current else "report"))
    fmt = str(body.get("format", current["format"] if current else ("pdf" if kind == "dashboard" else "xlsx"))).lower()
    if fmt not in FORMATS:
        raise ValidationError({"format": "Excel, CSV or PDF."})
    if kind == "dashboard" and fmt != "pdf":
        raise ValidationError({"format": "A dashboard goes as PDF."})
    out["format"] = fmt
    recipients = body.get("recipients", _json(current["recipients"]) if current else None)
    if not isinstance(recipients, list) or not recipients or len(recipients) > MAX_RECIPIENTS:
        raise ValidationError({"recipients": f"One to {MAX_RECIPIENTS} addresses."})
    cleaned = list(dict.fromkeys(str(a).strip().lower() for a in recipients if str(a).strip()))
    bad = [a for a in cleaned if not ADDRESS.match(a)]
    if bad or not cleaned:
        raise ValidationError({"recipients": f"Not an address: {', '.join(bad[:3])}." if bad else "One address at least."})
    out["recipients"] = cleaned
    subject = str(body.get("subject", current["subject"] if current else "") or "").strip()
    if len(subject) > 200:
        raise ValidationError({"subject": "A subject of up to 200 characters."})
    out["subject"] = subject or None
    note = str(body.get("note", current["note"] if current else "") or "").strip()
    if len(note) > 2000:
        raise ValidationError({"note": "A note of up to 2,000 characters."})
    out["note"] = note or None
    return out


# ---------------------------------------------------------------------------------------------------- the sending
def _owner_mask(owner) -> bool:
    codes = owner.permission_codes() if owner is not None else set()
    return not ({"report.admin", "user.admin"} & set(codes))


def _csv(columns: list[dict], rows: list[list]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([c["label"] + (" (masked)" if c.get("masked") else "") for c in columns])
    for row in rows:
        writer.writerow(["" if v is None else v for v in row])
    return buffer.getvalue().encode("utf-8-sig")


def _subject(row: dict, when: date) -> str:
    stamp = when.strftime("%d %b %Y").lstrip("0")
    return (row["subject"] or f"{row['item_name']} · {{date}}").replace("{date}", stamp)


def deliver(tenant, row: dict, *, to: list[str] | None = None, trigger: str = "schedule") -> dict:
    """Builds the report with its owner's rights and masking, sends it, records the delivery and moves the schedule on.
    Must run inside session.tenant_scope. `to` overrides the recipients (Send a Test Now); a test does not move the schedule."""
    from apps.identity.models import AppUser
    started = timezone.now()
    zone = reports.zone_of(tenant)
    owner = AppUser.objects.filter(pk=row["owner_user_id"]).first()
    recipients = to or _json(row["recipients"])
    outcome, detail, rows_sent, duration = "FAILED", None, None, None
    try:
        if row["item_deleted_at"] is not None or not row["item_name"]:
            raise RuntimeError("The report behind this schedule is gone.")
        today = started.astimezone(zone).date()
        when = today.strftime("%d %b %Y").lstrip("0")
        mask = _owner_mask(owner)
        if row["kind"] == "dashboard":
            from apps.insights import dashboards
            dash = _q("SELECT id::text, name, description, period, compare, layout, owner_user_id::text FROM dashboard WHERE id = %s AND deleted_at IS NULL", [row["item_id"]])
            if not dash:
                raise RuntimeError("The dashboard behind this schedule is gone.")
            dash = dash[0]
            visible = ("TRUE", []) if not mask or str(dash["owner_user_id"]) == str(row["owner_user_id"]) else ("(r.visibility = 'WORKSPACE' OR r.owner_user_id = %s)", [str(row["owner_user_id"])])
            body, mime, ext = dashboards.dashboard_pdf(tenant, owner, dash, visible_where=visible[0], visible_args=visible[1], mask=mask), "application/pdf", "pdf"
            name, data, view_type, link = dash["name"], [], "dashboard", f"/insights/dashboards/{dash['id']}"
            rows_sent_hint = len(dashboards._tiles(_json(dash["layout"])))
        else:
            report = _q("SELECT id::text, name, dataset_key, definition, version, view_type FROM report WHERE id = %s AND deleted_at IS NULL", [row["item_id"]])
            if not report:
                raise RuntimeError("The report behind this schedule is gone.")
            report = report[0]
            dataset = catalog.dataset(tenant.pk, report["dataset_key"], True)
            if dataset is None:
                raise RuntimeError("The report's dataset is not available in this workspace.")
            try:
                definition = validate(dataset, _json(report["definition"]), max_limit=catalog.engine_of(tenant.pk)["limits"]["export_rows"])
            except DefinitionError as exc:
                raise RuntimeError(f"The report no longer fits its dataset ({exc.field}: {exc}).") from None
            columns, data, totals = runner.fetch_all(tenant, owner, dataset, definition, report_id=report["id"], report_version=report["version"], mask_pii=mask, kind="delivery")
            if row["format"] == "csv":
                body, mime, ext = _csv(columns, data), "text/csv", "csv"
            elif row["format"] == "pdf":
                from apps.insights import pdf
                body, mime, ext = pdf.report(report["name"], columns, data, definition.get("view"), totals, workspace=tenant.name, when=when), "application/pdf", "pdf"
            else:
                body, mime, ext = excel.build(report["name"], columns, data, definition.get("view"), totals), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
            name, view_type, link, rows_sent_hint = report["name"], report["view_type"], f"/insights/reports/{report['id']}", len(data)
        safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in name)[:80] or "report"
        context_ = {"title": _subject(row, today), "report_name": name, "note": row["note"], "rows": rows_sent_hint, "view": view_type, "fmt": {"xlsx": "Excel", "csv": "CSV", "pdf": "PDF"}[ext],
                    "date": today.strftime("%d %B %Y").lstrip("0"), "owner": row["owner_name"] or "someone in the workspace", "schedule": words(row),
                    "report_link": link, "schedules_link": "/insights/scheduled", "is_dashboard": row["kind"] == "dashboard"}
        if not mail.send("report_delivery", recipients, context_, subject=context_["title"], tenant_id=tenant.pk, attachments=[(f"{safe}.{ext}", body, mime)]):
            raise RuntimeError("The workspace's mail server did not take the email.")
        outcome, rows_sent = "OK", rows_sent_hint
    except runner.RunRefused as exc:
        outcome, detail = exc.outcome, exc.reason
    except Exception as exc:                                        # noqa: BLE001  one schedule's trouble is recorded, never raised into the job
        detail = str(exc)[:300]
    duration = int((timezone.now() - started).total_seconds() * 1000)
    with session.tx():
        _q("INSERT INTO report_delivery (tenant_id, schedule_id, trigger, outcome, detail, recipients, row_count, duration_ms) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
           [context.require().tenant_id, row["id"], trigger, outcome, detail, len(recipients), rows_sent, duration])
        if trigger == "schedule":
            failures = 0 if outcome == "OK" else int(row["failures"]) + 1
            paused = failures >= PAUSE_AFTER
            _q("""UPDATE report_schedule SET last_sent_at = %s, last_outcome = %s, last_detail = %s, failures = %s, status = %s, next_run_at = %s, updated_at = now()
                   WHERE id = %s""",
               [started, outcome, detail, failures, "PAUSED" if paused else "ACTIVE", None if paused else next_run(row["every"], row["on_day"], row["at_time"], zone, started), row["id"]])
    return {"outcome": outcome, "detail": detail, "recipients": len(recipients), "rows": rows_sent}


def due(now: datetime) -> list[dict]:
    """The active schedules whose time has come, in the current tenant scope."""
    return [_schedule_row(r["id"]) for r in _q("SELECT id::text FROM report_schedule WHERE status = 'ACTIVE' AND deleted_at IS NULL AND next_run_at <= %s ORDER BY next_run_at", [now])]


# ---------------------------------------------------------------------------------------------------- the API
class ScheduleListView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        where, args = ("TRUE", []) if _has(request, "report.admin") else ("s.owner_user_id = %s", [str(request.user.pk)])
        if request.query_params.get("item"):
            where += " AND s.item_id::text = %s"; args.append(request.query_params["item"])
        rows = _q(f"SELECT s.id::text FROM report_schedule s WHERE s.deleted_at IS NULL AND {where} ORDER BY s.created_at DESC", args)
        return Response({"schedules": [_serialize(_schedule_row(r["id"])) for r in rows], "mail_configured": mail.is_configured(context.require().tenant_id)})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        if not _has(request, "report.edit") and not _has(request, "report.admin"):
            raise PermissionDenied("Scheduling a report needs the report.edit permission.")
        body = request.data if isinstance(request.data, dict) else {}
        kind = str(body.get("kind") or "report")
        if kind not in ("report", "dashboard"):
            raise ValidationError({"kind": "A report or a dashboard."})
        if kind == "dashboard":
            from apps.insights.dashboards import _dashboard_row
            try:
                item = _dashboard_row(body.get("item_id"), request) if body.get("item_id") else None
            except NotFound:
                item = None
            if item is None:
                raise ValidationError({"item_id": "Choose one of the dashboards you can open."})
        else:
            try:
                item = _report_row(body.get("item_id"), request) if body.get("item_id") else None
            except NotFound:
                item = None
            if item is None:
                raise ValidationError({"item_id": "Choose one of the reports you can open."})
        if not mail.is_configured(context.require().tenant_id):
            raise ValidationError({"mail": "This workspace has no mail server yet (Settings → Mail Server), so nothing can be sent."})
        fields = _validated(request, body)
        tenant = _tenant()
        first = next_run(fields["every"], fields["on_day"], fields["at_time"], reports.zone_of(tenant), timezone.now())
        with session.tx():
            rows = _q("""INSERT INTO report_schedule (tenant_id, kind, item_id, owner_user_id, every, on_day, at_time, format, recipients, subject, note, next_run_at, created_by, updated_by)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [context.require().tenant_id, kind, item["id"], str(request.user.pk), fields["every"], fields["on_day"], fields["at_time"], fields["format"], json.dumps(fields["recipients"]),
                       fields["subject"], fields["note"], first, str(request.user.pk), str(request.user.pk)])
        return Response(_serialize(_schedule_row(rows[0]["id"], request)), status=status.HTTP_201_CREATED)


class ScheduleView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, schedule_id=None):
        return Response(_serialize(_schedule_row(schedule_id, request)))

    @extend_schema(responses={200: None})
    def put(self, request, version=None, schedule_id=None):
        row = _schedule_row(schedule_id, request)
        if not _may_change(request, row):
            raise PermissionDenied("Only whoever scheduled it, or a report administrator, can change it.")
        body = request.data if isinstance(request.data, dict) else {}
        if int(body.get("row_version") or 0) != row["row_version"]:
            return Response({"type": "about:blank", "title": "The schedule changed since you opened it", "status": 409, "detail": "Reload it and apply your change again."}, status=409)
        fields = _validated(request, body, current=row)
        tenant = _tenant()
        first = next_run(fields["every"], fields["on_day"], fields["at_time"], reports.zone_of(tenant), timezone.now())
        with session.tx():
            _q("""UPDATE report_schedule SET every = %s, on_day = %s, at_time = %s, format = %s, recipients = %s, subject = %s, note = %s, next_run_at = CASE WHEN status = 'ACTIVE' THEN %s ELSE next_run_at END,
                                             updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE id = %s""",
               [fields["every"], fields["on_day"], fields["at_time"], fields["format"], json.dumps(fields["recipients"]), fields["subject"], fields["note"], first, str(request.user.pk), str(schedule_id)])
        return Response(_serialize(_schedule_row(schedule_id, request)))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, schedule_id=None):
        row = _schedule_row(schedule_id, request)
        if not _may_change(request, row):
            raise PermissionDenied("Only whoever scheduled it, or a report administrator, can delete it.")
        with session.tx():
            _q("UPDATE report_schedule SET deleted_at = %s, updated_by = %s WHERE id = %s", [timezone.now(), str(request.user.pk), str(schedule_id)])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ScheduleStateView(APIView):
    """pause, or resume (the next run is recomputed from now; the failure count starts over)"""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, schedule_id=None, action=None):
        if action not in ("pause", "resume"):
            raise NotFound("Pause or resume.")
        row = _schedule_row(schedule_id, request)
        if not _may_change(request, row):
            raise PermissionDenied("Only whoever scheduled it, or a report administrator, can pause or resume it.")
        with session.tx():
            if action == "pause":
                _q("UPDATE report_schedule SET status = 'PAUSED', next_run_at = NULL, updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE id = %s", [str(request.user.pk), str(schedule_id)])
            else:
                first = next_run(row["every"], row["on_day"], row["at_time"], reports.zone_of(_tenant()), timezone.now())
                _q("UPDATE report_schedule SET status = 'ACTIVE', failures = 0, next_run_at = %s, updated_by = %s, updated_at = now(), row_version = row_version + 1 WHERE id = %s",
                   [first, str(request.user.pk), str(schedule_id)])
        return Response(_serialize(_schedule_row(schedule_id, request)))


class ScheduleTestView(APIView):
    """Send a Test Now: the email as it would go, to the person asking, at once; the schedule itself is not moved."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, schedule_id=None):
        row = _schedule_row(schedule_id, request)
        if not request.user.email:
            raise ValidationError({"to": "Your account has no email address to send the test to."})
        result = deliver(_tenant(), row, to=[request.user.email], trigger="test")
        return Response(result, status=200 if result["outcome"] == "OK" else 422)
