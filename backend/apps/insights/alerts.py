"""Threshold alerts (report_alert, patch 0062): a report's value, such as Delivered Rate over the report's own filters, checked
every hour or every day; an email when it crosses the threshold (once: the alert is TRIGGERED until the value is back on the
right side, then OK and armed again). The value is read with the alert owner's rights and masking, like a scheduled report,
and every check is kept (report_alert_check). The jobs process checks the alerts that are due (workers/insights_alerts.py).

    GET, POST   /insights/alerts/?report=          the alerts on a report (or all of this person's), a new one
    GET, PUT, DELETE /insights/alerts/<id>/        one, with its last checks
    POST        /insights/alerts/<id>/check/       Check Now: reads the value and acts as the schedule would
    POST        /insights/alerts/<id>/pause|resume/
"""
import json
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.delivery.engine import session
from apps.platform_ops import mail
from apps.reporting import reports
from apps.tenants import context

from . import access, catalog, pdf, runner
from .api import VIEW, _has, _q, _report_row, _tenant
from .definition import DefinitionError, validate
from .schedules import ADDRESS, MAX_RECIPIENTS, _owner_mask, next_run

OPS = {"<": "falls below", "<=": "is at or below", ">": "rises above", ">=": "is at or above"}
EVERY = ("hour", "day")
PAUSE_AFTER = 5
HISTORY = 10


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def present() -> bool:
    return access.present("report_alert")


def _met(value, op: str, threshold) -> bool | None:
    if value is None:
        return None
    v, t = float(value), float(threshold)
    return {"<": v < t, "<=": v <= t, ">": v > t, ">=": v >= t}[op]


def next_check(every: str, at: time | None, zone, after: datetime) -> datetime:
    if every == "hour":
        return (after + timedelta(hours=1)).replace(second=0, microsecond=0)
    return next_run("day", None, at or time(8, 0), zone, after)


# ---------------------------------------------------------------------------------------------------- reading the value
def read_value(tenant, owner, report: dict, measure: str) -> tuple[float | None, dict]:
    """the report's value over its own filters, as one figure: the measure's column alone, totalled by the engine"""
    dataset = catalog.dataset(tenant.pk, report["dataset_key"], True)
    if dataset is None:
        raise runner.RunRefused("FAILED", "The report's dataset is not available in this workspace.")
    raw = _json(report["definition"])
    limits = catalog.engine_of(tenant.pk)["limits"]
    try:
        whole = validate(dataset, raw, max_limit=limits["run_rows"])
        column = next(c for c in whole["columns"] if c["field"] == measure and "aggregate" in c)
        alone = validate(dataset, {"columns": [{"field": column["field"], "aggregate": column["aggregate"]}], **({"filters": raw["filters"]} if raw.get("filters") else {}),
                                   **({"derived": raw["derived"]} if raw.get("derived") else {})}, max_limit=1)
    except (DefinitionError, StopIteration):
        raise runner.RunRefused("FAILED", "The report no longer has this value.") from None
    result = runner.run(tenant, owner, dataset, alone, "run", limit=1, report_id=report["id"], report_version=report["version"], mask_pii=_owner_mask(owner))
    value = result["rows"][0][0] if result["rows"] else None
    return (float(value) if isinstance(value, (int, float, Decimal)) else None), result["columns"][0]


def _words(column: dict, value) -> str:
    return pdf._number(column, value) if value is not None else "empty"


def check(tenant, row: dict, *, trigger: str = "schedule") -> dict:
    """reads the value, emails on the way into TRIGGERED, records the check and moves the alert on; inside session.tenant_scope"""
    from apps.identity.models import AppUser
    now = timezone.now()
    zone = reports.zone_of(tenant)
    owner = AppUser.objects.filter(pk=row["owner_user_id"], is_active=True, deleted_at__isnull=True).first()
    value, met, notified, outcome, detail, column = None, None, False, "FAILED", None, {"label": row["measure"], "format": None}
    try:
        if owner is None:
            raise runner.RunRefused("REFUSED", "Whoever made this alert is no longer in the workspace.")
        report = _q("SELECT id::text, name, dataset_key, definition, version FROM report WHERE id = %s AND deleted_at IS NULL", [row["report_id"]])
        if not report:
            raise runner.RunRefused("FAILED", "The report behind this alert is gone.")
        value, column = read_value(tenant, owner, report[0], row["measure"])
        met = _met(value, row["op"], row["threshold"])
        outcome = "OK"
        if met and row["state"] != "TRIGGERED":
            words = f"{column['label']} {OPS[row['op']]} {_words(column, row['threshold'])}: it is {_words(column, value)}."
            context_ = {"title": f"{row['name'] or report[0]['name']}: {column['label']} {OPS[row['op']]} {_words(column, row['threshold'])}", "words": words,
                        "report_name": report[0]["name"], "report_link": f"/insights/reports/{report[0]['id']}", "alerts_link": "/insights/scheduled",
                        "checked": now.astimezone(zone).strftime("%d %B %Y, %H:%M").lstrip("0"), "owner": row.get("owner_name") or "someone in the workspace"}
            notified = mail.send("report_alert", _json(row["recipients"]), context_, subject=context_["title"], tenant_id=tenant.pk)
            if not notified:
                detail = "The workspace's mail server did not take the email."
    except runner.RunRefused as exc:
        outcome, detail = exc.outcome, exc.reason
    except Exception as exc:                                        # noqa: BLE001  one alert's trouble is recorded, never raised into the job
        detail = str(exc)[:300]
    state = "TRIGGERED" if met else ("OK" if met is False else row["state"])
    with session.tx():
        _q("INSERT INTO report_alert_check (tenant_id, alert_id, trigger, value, met, notified, outcome, detail) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
           [str(tenant.pk), row["id"], trigger, value, met, notified, outcome, (detail or "")[:300] or None])
        failures = 0 if outcome == "OK" else int(row["failures"]) + 1
        paused = failures >= PAUSE_AFTER
        moved = next_check(row["every"], row["at_time"], zone, now) if trigger == "schedule" else row["next_check_at"]
        _q("""UPDATE report_alert SET state = %s, last_value = %s, last_checked_at = %s, last_fired_at = CASE WHEN %s THEN %s ELSE last_fired_at END, last_detail = %s,
                                      failures = %s, status = %s, next_check_at = %s, updated_at = now() WHERE id = %s""",
           [state, value, now, notified, now, (detail or "")[:300] or None, failures, "PAUSED" if paused else row["status"], moved, row["id"]])
    return {"outcome": outcome, "value": value, "value_words": _words(column, value), "met": met, "notified": notified, "state": state, "detail": detail}


def due(now: datetime) -> list[dict]:
    return [_row(r["id"]) for r in _q("SELECT id::text FROM report_alert WHERE status = 'ACTIVE' AND deleted_at IS NULL AND next_check_at <= %s ORDER BY next_check_at", [now])]


# ---------------------------------------------------------------------------------------------------- rows
def _row(alert_id) -> dict:
    rows = _q("""SELECT a.id::text, a.report_id::text, a.owner_user_id::text, u.display_name AS owner_name, a.name, a.measure, a.op, a.threshold, a.every, a.at_time,
                        a.recipients, a.status, a.state, a.last_value, a.last_checked_at, a.last_fired_at, a.last_detail, a.failures, a.next_check_at, a.row_version,
                        r.name AS report_name, r.definition, r.dataset_key
                   FROM report_alert a LEFT JOIN app_user u ON u.id = a.owner_user_id LEFT JOIN report r ON r.id = a.report_id AND r.deleted_at IS NULL
                  WHERE a.id = %s AND a.deleted_at IS NULL""", [str(alert_id)])
    if not rows:
        raise NotFound("No such alert.")
    return rows[0]


def _measure_label(row: dict) -> str:
    try:
        dataset = catalog.dataset(context.require().tenant_id, row["dataset_key"], True)
        column = next((c for c in _json(row["definition"])["columns"] if c["field"] == row["measure"] and c.get("aggregate")), None)
        field = next((f for f in dataset["fields"] if f["key"] == row["measure"]), None) if dataset else None
        return (column or {}).get("label") or (field or {}).get("label") or row["measure"]
    except Exception:                                               # noqa: BLE001  a label is never worth a failed list
        return row["measure"]


def _serialize(row: dict, request=None) -> dict:
    at = row["at_time"].strftime("%H:%M") if isinstance(row["at_time"], time) else (str(row["at_time"])[:5] if row["at_time"] else None)
    label = _measure_label(row)
    threshold = float(row["threshold"])
    return {"id": row["id"], "report_id": row["report_id"], "report_name": row["report_name"], "name": row["name"], "measure": row["measure"], "measure_label": label,
            "op": row["op"], "threshold": threshold, "every": row["every"], "at_time": at, "recipients": _json(row["recipients"]), "status": row["status"], "state": row["state"],
            "last_value": float(row["last_value"]) if row["last_value"] is not None else None, "last_checked_at": row["last_checked_at"], "last_fired_at": row["last_fired_at"],
            "last_detail": row["last_detail"], "next_check_at": row["next_check_at"], "owner_user_id": row["owner_user_id"], "owner_name": row["owner_name"], "row_version": row["row_version"],
            "words": f"When {label} {OPS[row['op']]} {threshold:g}, checked {'every hour' if row['every'] == 'hour' else f'every day at {at}'}",
            **({"can_change": _may_change(request, row)} if request is not None else {})}


def _may_change(request, row: dict) -> bool:
    return _has(request, "report.admin") or str(row["owner_user_id"]) == str(request.user.pk)


def _require_present():
    if not present():
        from api.exceptions import Conflict
        raise Conflict("Alerts need database patch 0062, which is not applied yet.")


def _validated(request, body: dict, report: dict, current: dict | None = None) -> dict:
    out = {}
    definition = _json(report["definition"])
    measures = {c["field"]: c for c in definition.get("columns", []) if c.get("aggregate")}
    measure = body.get("measure", current["measure"] if current else None)
    if measure not in measures:
        raise ValidationError({"measure": "Watch one of the report's values."})
    out["measure"] = measure
    op = body.get("op", current["op"] if current else None)
    if op not in OPS:
        raise ValidationError({"op": "Below, at or below, above, or at or above."})
    out["op"] = op
    threshold = body.get("threshold", float(current["threshold"]) if current else None)
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
        raise ValidationError({"threshold": "The threshold is a number."})
    out["threshold"] = threshold
    every = body.get("every", current["every"] if current else "day")
    if every not in EVERY:
        raise ValidationError({"every": "Every hour or every day."})
    out["every"] = every
    at_raw = body.get("at_time", (current["at_time"].strftime("%H:%M") if current and isinstance(current["at_time"], time) else None) or "08:00")
    try:
        hours, minutes = str(at_raw).split(":")
        out["at_time"] = time(int(hours), int(minutes)) if every == "day" else None
    except (ValueError, AttributeError):
        raise ValidationError({"at_time": "A time like 08:00."}) from None
    recipients = body.get("recipients", _json(current["recipients"]) if current else [request.user.email])
    if not isinstance(recipients, list) or not recipients or len(recipients) > MAX_RECIPIENTS:
        raise ValidationError({"recipients": f"One to {MAX_RECIPIENTS} addresses."})
    cleaned = list(dict.fromkeys(str(a).strip().lower() for a in recipients if str(a).strip()))
    bad = [a for a in cleaned if not ADDRESS.match(a)]
    if bad or not cleaned:
        raise ValidationError({"recipients": f"Not an address: {', '.join(bad[:3])}." if bad else "One address at least."})
    builder = _has(request, "report.edit") or _has(request, "report.admin")
    if not builder and cleaned != [str(request.user.email or "").lower()]:
        raise ValidationError({"recipients": "Without the right to build reports, an alert goes to you only."})
    out["recipients"] = cleaned
    name = " ".join(str(body.get("name", current["name"] if current else "") or "").split())[:120]
    out["name"] = name or None
    return out


# ---------------------------------------------------------------------------------------------------- the API
class AlertsView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        if not present():
            return Response({"alerts": [], "ready": False, "mail_configured": mail.is_configured(context.require().tenant_id)})
        where, args = ("TRUE", []) if _has(request, "report.admin") else ("a.owner_user_id = %s", [str(request.user.pk)])
        if request.query_params.get("report"):
            _report_row(request.query_params["report"], request)
            where += " AND a.report_id::text = %s"
            args.append(request.query_params["report"])
        rows = _q(f"SELECT a.id::text FROM report_alert a WHERE a.deleted_at IS NULL AND {where} ORDER BY a.created_at DESC", args)
        return Response({"alerts": [_serialize(_row(r["id"]), request) for r in rows], "ready": True, "mail_configured": mail.is_configured(context.require().tenant_id)})

    @extend_schema(responses={201: None})
    def post(self, request, version=None):
        _require_present()
        body = request.data if isinstance(request.data, dict) else {}
        try:
            report = _report_row(body.get("report_id"), request) if body.get("report_id") else None
        except NotFound:
            report = None
        if report is None:
            raise ValidationError({"report_id": "Choose one of the reports you can open."})
        if not mail.is_configured(context.require().tenant_id):
            raise ValidationError({"mail": "This workspace has no mail server yet (Settings → Mail Server), so no alert can be sent."})
        fields = _validated(request, body, report)
        tenant = _tenant()
        first = next_check(fields["every"], fields["at_time"], reports.zone_of(tenant), timezone.now())
        with session.tx():
            made = _q("""INSERT INTO report_alert (tenant_id, report_id, owner_user_id, name, measure, op, threshold, every, at_time, recipients, next_check_at)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text""",
                      [str(tenant.pk), report["id"], str(request.user.pk), fields["name"], fields["measure"], fields["op"], fields["threshold"], fields["every"], fields["at_time"],
                       json.dumps(fields["recipients"]), first])
        return Response(_serialize(_row(made[0]["id"]), request), status=status.HTTP_201_CREATED)


class AlertView(APIView):
    permission_classes = VIEW

    def _mine(self, request, alert_id) -> dict:
        _require_present()
        row = _row(alert_id)
        if not _may_change(request, row):
            raise NotFound("No such alert.")
        return row

    @extend_schema(responses={200: None})
    def get(self, request, version=None, alert_id=None):
        row = self._mine(request, alert_id)
        checks = _q("""SELECT checked_at, trigger, value, met, notified, outcome, detail FROM report_alert_check WHERE alert_id = %s ORDER BY checked_at DESC LIMIT %s""",
                    [row["id"], HISTORY])
        return Response({**_serialize(row, request), "checks": [{**c, "value": float(c["value"]) if c["value"] is not None else None} for c in checks]})

    @extend_schema(responses={200: None})
    def put(self, request, version=None, alert_id=None):
        row = self._mine(request, alert_id)
        body = request.data if isinstance(request.data, dict) else {}
        if int(body.get("row_version") or 0) != row["row_version"]:
            return Response({"type": "about:blank", "title": "The alert changed since you opened it", "status": 409, "detail": "Reload it and apply your change again."}, status=409)
        report = {"definition": row["definition"]}
        fields = _validated(request, body, report, current=row)
        first = next_check(fields["every"], fields["at_time"], reports.zone_of(_tenant()), timezone.now())
        with session.tx():
            _q("""UPDATE report_alert SET name = %s, measure = %s, op = %s, threshold = %s, every = %s, at_time = %s, recipients = %s, next_check_at = %s, state = 'UNKNOWN',
                                          updated_at = now(), row_version = row_version + 1 WHERE id = %s""",
               [fields["name"], fields["measure"], fields["op"], fields["threshold"], fields["every"], fields["at_time"], json.dumps(fields["recipients"]), first, row["id"]])
        return Response(_serialize(_row(row["id"]), request))

    @extend_schema(responses={204: None})
    def delete(self, request, version=None, alert_id=None):
        row = self._mine(request, alert_id)
        with session.tx():
            _q("UPDATE report_alert SET deleted_at = now() WHERE id = %s", [row["id"]])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AlertCheckView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, alert_id=None):
        row = AlertView()._mine(request, alert_id)
        result = check(_tenant(), row, trigger="now")
        return Response({**result, "alert": _serialize(_row(row["id"]), request)})


class AlertStateView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, alert_id=None, action=None):
        row = AlertView()._mine(request, alert_id)
        if action not in ("pause", "resume"):
            raise NotFound()
        tenant = _tenant()
        with session.tx():
            if action == "pause":
                _q("UPDATE report_alert SET status = 'PAUSED', updated_at = now() WHERE id = %s", [row["id"]])
            else:
                _q("UPDATE report_alert SET status = 'ACTIVE', failures = 0, next_check_at = %s, updated_at = now() WHERE id = %s",
                   [next_check(row["every"], row["at_time"], reports.zone_of(tenant), timezone.now()), row["id"]])
        return Response(_serialize(_row(row["id"]), request))


__all__ = ["AlertsView", "AlertView", "AlertCheckView", "AlertStateView", "check", "due"]
