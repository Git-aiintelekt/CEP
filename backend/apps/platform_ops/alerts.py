"""Alerts: turn the health page into something that tells you, instead of something you have to look at.

evaluate() runs the health checks plus the job report. A problem opens ONE platform_alert (unique while open), is
notified at once, re-notified every `alerts.renotify_minutes` while it lasts, and resolved (with a notice) when the check
passes again. Channels: email to `alerts.recipients` and an optional Slack-compatible webhook `alerts.webhook_url`.

Sending engines add one alert per engine and check (apps/delivery/health.py). A standing one (a text engine that has never
sent a receipt) is notified once and opens acknowledged, so it is not repeated while it lasts.
"""
import logging
from datetime import timedelta

import requests
from django.conf import settings
from django.db import connections
from django.utils import timezone

from . import mail, params

log = logging.getLogger("cep.alerts")
P = settings.PLATFORM_ALIAS


def _problems() -> dict:
    """check name -> (severity, summary, detail[, standing]). 'off' (deliberately not running) is not a problem."""
    from apps import platform_health
    from . import jobs
    found = {}
    for check in platform_health.collect(include_jobs=False)["checks"]:
        if check["status"] in ("warn", "fail"):
            found[check["name"]] = ("FAIL" if check["status"] == "fail" else "WARN", check["summary"], check["detail"])
    workers_expected = not settings.DEBUG
    for job in jobs.status_report():
        if job["state"] == "failed":
            found[f"Job: {job['name']}"] = ("FAIL", f"Last run failed: {job['last_error'] or 'no message'}", job["purpose"])
        elif job["state"] == "overdue" or (job["state"] == "never" and workers_expected):
            since = f"last success {job['last_success']:%Y-%m-%d %H:%M} UTC" if job["last_success"] else "it has never succeeded"
            found[f"Job: {job['name']}"] = ("WARN", f"Overdue: {since}", job["purpose"])
    try:
        from apps.delivery import health
        found.update(health.problems())
    except Exception as exc:                               # noqa: BLE001  the engines' checks must not stop the platform's alerts
        log.error("engine health not read for alerts: %s", exc)
    try:
        from apps.delivery import stalls
        found.update(stalls.problems())
    except Exception as exc:                               # noqa: BLE001  nor the stall checks (before patch 0095 they cannot run)
        log.error("stalled sends and uploads not read for alerts: %s", exc)
    try:
        found.update(people_errors())
    except Exception as exc:                               # noqa: BLE001  nor the errors people met
        log.error("errors people met not read for alerts: %s", exc)
    return found


def people_errors() -> dict:
    """One alert per open error that people met in the last 24 hours (an ER-… answer, or a screen that failed in the browser): what
    it is, how often and for whom, the last time, where, and where to look. It closes once the error is resolved or ignored on the
    Errors page, or after 24 hours without it. FAIL from 10 times in an hour."""
    from . import observe
    found = {}
    for error in observe.people_errors():
        last = error["last"]
        times = f"{error['count']} time{'s' if error['count'] != 1 else ''} in 24 hours" + (f", {error['people']} people" if error["people"] > 1 else "")
        state = ("returned after it was resolved" if error["regressed"] else
                 "new today" if error["first_seen"] > timezone.now() - timedelta(hours=24) else "still happening")
        detail = (f"ER-{error['id']} ({error['kind']}). Last {last['at']:%d %b %H:%M} UTC"
                  + (f" in {last['workspace']}" if last["workspace"] else "") + (f", {last['who']}" if last["who"] else "")
                  + (f", {last['where']}" if last["where"] else "") + (f". Workspaces: {error['workspaces']}" if "," in error["workspaces"] else "")
                  + f". Back-office → Errors → ER-{error['id']}: the details, and a Note for Users.")
        found[f"Error ER-{error['id']} · {error['kind'].rsplit('.', 1)[-1]}"[:100]] = (
            "FAIL" if error["last_hour"] >= 10 else "WARN", f"{error['message'][:180]} · {times} · {state}", detail)
    return found


def evaluate(notify: bool = True) -> dict:
    now = timezone.now()
    renotify = timedelta(minutes=int(params.get("alerts.renotify_minutes", 240)))
    problems = _problems()
    opened, resolved, renotified = [], [], []
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT id, check_name, severity, last_notified_at, acknowledged_at FROM platform_alert WHERE resolved_at IS NULL")
        open_alerts = {name: (alert_id, severity, notified, acked) for alert_id, name, severity, notified, acked in cursor.fetchall()}

        for name, (severity, summary, detail, *rest) in problems.items():
            standing = bool(rest and rest[0])
            if name not in open_alerts:
                cursor.execute("""INSERT INTO platform_alert (check_name, severity, summary, detail, last_notified_at, notifications, acknowledged_at)
                                  VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                               [name, severity, summary, detail, now if notify else None, 1 if notify else 0, now if standing else None])
                opened.append((name, severity, summary, detail))
                continue
            alert_id, old_severity, notified, acked = open_alerts[name]
            escalated = severity == "FAIL" and old_severity == "WARN"
            due = not acked and (notified is None or now - notified >= renotify)
            again = notify and (escalated or due)
            cursor.execute("""UPDATE platform_alert SET severity = %s, summary = %s, detail = %s, last_seen_at = %s,
                                     last_notified_at = CASE WHEN %s THEN %s ELSE last_notified_at END, notifications = notifications + %s WHERE id = %s""",
                           [severity, summary, detail, now, again, now, 1 if again else 0, alert_id])
            if again:
                renotified.append((name, severity, summary, detail))

        for name, (alert_id, severity, _, _) in open_alerts.items():
            if name not in problems:
                cursor.execute("UPDATE platform_alert SET resolved_at = %s WHERE id = %s", [now, alert_id])
                resolved.append((name, severity, "Recovered", ""))

    sent = _notify(opened, renotified, resolved) if notify and (opened or renotified or resolved) else {"email": False, "webhook": False}
    return {"open": len(problems), "opened": [item[0] for item in opened], "resolved": [item[0] for item in resolved],
            "renotified": [item[0] for item in renotified], "sent": sent}


def _notify(opened, renotified, resolved) -> dict:
    failing = [item for item in opened + renotified if item[1] == "FAIL"]
    subject = (f"[C360] {len(failing)} failing: {failing[0][0]}" if failing else
               f"[C360] {len(opened + renotified)} need attention" if opened or renotified else f"[C360] recovered: {resolved[0][0]}")
    context = {"opened": opened, "renotified": renotified, "resolved": resolved, "admin_url": settings.PLATFORM_ADMIN_URL.rstrip("/") + "/admin/"}
    recipients = params.get("alerts.recipients", []) or []
    emailed = mail.send("platform_alert", recipients, context, subject=subject) if recipients else False

    hooked = False
    url = params.get("alerts.webhook_url", "")
    if url:
        lines = [f":red_circle: *{n}* {s}" if sev == "FAIL" else f":large_yellow_circle: *{n}* {s}" for n, sev, s, _ in opened + renotified]
        lines += [f":large_green_circle: *{n}* recovered" for n, _, _, _ in resolved]
        try:
            hooked = requests.post(url, json={"text": subject + "\n" + "\n".join(lines)}, timeout=5).ok
        except requests.RequestException as exc:
            log.error("alert webhook failed: %s", exc)
    return {"email": emailed, "webhook": hooked}
