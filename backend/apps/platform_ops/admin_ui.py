"""What the back-office shell shows around every page (environment label, alert badge) and the data of its home page.

The home page answers, in this order: is anything wrong, what do I usually come here to do, how big is the platform, and
what happened recently. Nothing here may raise: the home page has to open when a dependency is down, that is when it is needed.
"""
from collections import Counter

from django.conf import settings
from django.core.cache import cache
from django.db import connections
from django.urls import NoReverseMatch, reverse
from django.utils import timezone

P = settings.PLATFORM_ALIAS
SEVERITY = {"fail": ("danger", "Failing", 0), "warn": ("warning", "Attention", 1), "info": ("info", "To Do", 2)}


def environment(request):
    """UNFOLD['ENVIRONMENT']: the label next to the page title, so nobody mistakes production for a test system."""
    name = getattr(settings, "CEP_ENVIRONMENT", "") or ("Local" if settings.DEBUG else "Production")
    colour = {"production": "danger", "staging": "warning"}.get(name.lower(), "info")
    return [name, colour]


def open_alerts_badge(request):
    """The number on 'Alerts' in the navigation. Cached briefly: it is asked for on every back-office page."""
    count = cache.get("cep:admin:open-alerts")
    if count is None:
        try:
            with connections[P].cursor() as cursor:
                cursor.execute("SELECT count(*) FROM platform_alert WHERE resolved_at IS NULL")
                count = cursor.fetchone()[0]
        except Exception:
            count = 0
        cache.set("cep:admin:open-alerts", count, 30)
    return count or None


def _count_badge(key, sql):
    count = cache.get(key)
    if count is None:
        try:
            with connections[P].cursor() as cursor:
                cursor.execute(sql)
                count = cursor.fetchone()[0]
        except Exception:
            count = 0
        cache.set(key, count, 30)
    return count or None


def open_errors_badge(request):
    """The number on 'Errors': open errors new or returning in the last 24 hours."""
    return _count_badge("cep:admin:open-errors", "SELECT count(*) FROM error_group WHERE status = 'OPEN' AND last_seen > now() - interval '24 hours'")


def down_targets_badge(request):
    return _count_badge("cep:admin:down-targets", "SELECT count(*) FROM uptime_target WHERE is_active AND state = 'DOWN'")


def security_badge(request):
    """The number on 'Security': open Critical and High items on this server (Medium shows on Home as a warning)."""
    from django.core.cache import cache
    from . import security
    count = cache.get("cep:admin:security")
    if count is None:
        counts = security.open_counts()
        count = counts["CRITICAL"] + counts["HIGH"]
        cache.set("cep:admin:security", count, 60)
    return count or None


def _url(name, *args):
    try:
        return reverse(name, args=args)
    except NoReverseMatch:
        return ""


def _rows(sql, params=None):
    with connections[P].cursor() as cursor:
        cursor.execute(sql, params or [])
        return cursor.fetchall()


def _safe(fn, default):
    try:
        return fn()
    except Exception:
        return default


def first_name(request):
    user = request.user
    return (getattr(user, "display_name", "") or "").split(" ")[0] or (getattr(user, "email", "") or "").split("@")[0]


def greeting(request):
    """Server-side wording (UTC); the page rewrites it by the viewer's own clock."""
    hour = timezone.localtime().hour
    part = "Good morning" if hour < 12 else "Good afternoon" if hour < 18 else "Good evening"
    name = first_name(request)
    return f"{part}, {name}" if name else part


def attention(health, jobs, alerts):
    """Everything that wants a person, worst first. Empty = the green 'all clear' state."""
    items = []
    for check in health.get("checks", []):
        if check["status"] in ("fail", "warn") and check["name"] != "Scheduled jobs":      # jobs are listed one by one below
            items.append({"kind": check["status"], "icon": "monitor_heart", "title": check["name"], "text": check["summary"], "link": "#checks", "action": "See the Check"})
    never = [job for job in jobs if job["state"] == "never"]
    for job in jobs:
        if job["state"] == "failed":
            items.append({"kind": "fail", "icon": "error", "title": f"Job failed: {job['name']}", "text": job["last_error"] or job["purpose"],
                          "link": _url("admin:platform_ops_jobrun_changelist") + f"?job_name={job['name']}", "action": "Open the Runs"})
        elif job["state"] == "overdue":
            items.append({"kind": "warn", "icon": "schedule", "title": f"Job late: {job['name']}", "text": job["purpose"],
                          "link": _url("admin:platform_ops_jobrun_changelist") + f"?job_name={job['name']}", "action": "Open the Runs"})
    if never:
        every = len(never) == len(jobs)
        items.append({"kind": "info" if every else "warn", "icon": "schedule",
                      "title": "The scheduler is not running" if every else f"{len(never)} scheduled job{'s have' if len(never) > 1 else ' has'} never run",
                      "text": "No scheduled job has reported yet: start the Celery worker and beat." if every else ", ".join(job["name"] for job in never),
                      "link": "#jobs", "action": "See the Jobs"})
    items += _security_attention()
    by_title = {item["title"]: item for item in items}
    for alert in alerts:                                   # an alert is the record of a problem: whoever is shown the problem gets the link to it
        since = f"open since {timezone.localtime(alert.opened_at):%d %b %H:%M}" + (" · acknowledged" if alert.acknowledged_at else "")
        link = _url("admin:platform_ops_platformalert_change", alert.pk)
        item = by_title.get(alert.check_name)
        if item:
            item.update({"text": f"{item['text']} · {since}", "link": link, "action": "Open the Alert"})
        else:
            items.append({"kind": "fail" if alert.severity == "FAIL" else "warn", "icon": "notifications_active", "title": alert.check_name,
                          "text": f"{alert.summary} · {since}", "link": link, "action": "Open the Alert"})
    for item in items:
        item["label"], item["word"], item["order"] = SEVERITY[item["kind"]]
    return sorted(items, key=lambda item: item["order"])


def _security_attention():
    """one card while Security has an open Critical or High item (a warning for Medium)"""
    from . import security
    counts = security.open_counts()
    high, medium = counts["CRITICAL"] + counts["HIGH"], counts["MEDIUM"]
    if not high and not medium:
        return []
    worst = "Critical" if counts["CRITICAL"] else "High" if high else "Medium"
    total = high or medium
    return [{"kind": "fail" if high else "warn", "icon": "shield", "title": f"{total} security item{'s' if total != 1 else ''}, {worst}",
             "text": "Packages with advisories or server settings to fix on this server.", "link": _url("admin:platform_ops_securityfinding_changelist"),
             "action": "Open Security"}]


def attention_status(items):
    """The pill in the Needs Your Attention header, read off the same items listed under it."""
    kinds = {item["kind"] for item in items}
    if "fail" in kinds:
        return {"state": "fail", "label": "danger", "word": "Action needed"}
    if kinds:
        return {"state": "warn", "label": "warning", "word": "Needs attention"}
    return {"state": "ok", "label": "success", "word": "All healthy"}


def business_attention():
    """Commercial follow-ups, from the same place: past-due subscriptions, trials about to end, invoices waiting."""
    items = []
    past_due, trials = _rows("""SELECT count(*) FILTER (WHERE status = 'PAST_DUE'),
                                       count(*) FILTER (WHERE status = 'TRIAL' AND trial_ends_at BETWEEN now() AND now() + interval '7 days')
                                  FROM tenant_subscription WHERE ends_at IS NULL OR ends_at > now()""")[0]
    if past_due:
        items.append({"kind": "warn", "icon": "credit_card_off", "title": f"{past_due} subscription{'s' if past_due > 1 else ''} past due", "text": "Payment has not come through.",
                      "link": _url("admin:tenants_tenantsubscription_changelist") + "?status__exact=PAST_DUE", "action": "Review"})
    if trials:
        items.append({"kind": "info", "icon": "hourglass_bottom", "title": f"{trials} trial{'s' if trials > 1 else ''} ending within 7 days", "text": "Convert or extend them before access changes.",
                      "link": _url("admin:tenants_tenantsubscription_changelist") + "?status__exact=TRIAL", "action": "Review"})
    drafts = _rows("SELECT count(*) FROM tenant_invoice WHERE status = 'DRAFT'")[0][0]
    if drafts:
        items.append({"kind": "info", "icon": "request_quote", "title": f"{drafts} draft invoice{'s' if drafts > 1 else ''} to issue", "text": "Drafts are not visible to the workspace until issued.",
                      "link": _url("admin:platform_ops_tenantinvoice_changelist") + "?status__exact=DRAFT", "action": "Open Invoices"})
    for item in items:
        item["label"], item["word"], item["order"] = SEVERITY[item["kind"]]
    return items


def quick_actions():
    actions = [
        ("New Tenant", "Create a workspace and its first administrator", "add_business", _url("admin:tenants_tenant_add")),
        ("Find a User", "Reset a password, unlock, open a support session", "person_search", _url("admin:identity_appuser_changelist")),
        ("Usage Against Limits", "Every tenant's month so far, worst first", "monitoring", _url("admin:platform_ops_usage")),
        ("Invoices", "Draft, issue and mark as paid", "request_quote", _url("admin:platform_ops_tenantinvoice_changelist")),
        ("Global Parameters", "Defaults and limits for every tenant", "tune", _url("admin:platform_ops_platformsetting_changelist")),
        ("Mail Server", "The platform's SMTP and who shares it", "outgoing_mail", _url("admin:platform_ops_mailserver_changelist")),
        ("Move or Offboard", "Export, move, suspend or erase a tenant", "move_up", _url("admin:platform_ops_tenantoperation_changelist")),
        ("Audit Trail", "Who changed which definition, and when", "history", _url("admin:audit_definitionauditlog_changelist")),
    ]
    return [{"title": t, "text": d, "icon": i, "link": link} for t, d, i, link in actions if link]


KPI = {"Active Tenants": ("apartment", "workspaces in use"), "Suspended Tenants": ("block", "access switched off"), "Active Users": ("group", "people who can sign in"),
       "Active API Keys": ("vpn_key", "integrations connected"), "Campaigns Live": ("campaign", "sending or scheduled"), "Definition Changes, 24 h": ("history", "edits in the last day")}


def kpis(numbers):
    out = []
    for item in numbers:
        icon, caption = KPI.get(item["title"], ("insights", ""))
        out.append({**item, "icon": icon, "caption": caption, "href": _url(item["link"])})
    return out


def _ago(moment):
    seconds = max(0, int((timezone.now() - moment).total_seconds()))
    for size, unit in ((86400, "day"), (3600, "hour"), (60, "minute")):
        if seconds >= size:
            n = seconds // size
            return f"{n} {unit}{'' if n == 1 else 's'} ago"
    return "just now"


def recent_changes(limit=8):
    """The audit trail's last entries; a run of the same change (every sign-in touches app_user) is one line with a count."""
    rows = _rows("""SELECT a.changed_at, a.action, a.entity_table, t.code, coalesce(u.display_name, u.email), a.id
                      FROM definition_audit_log a
                      LEFT JOIN tenant t ON t.id = a.tenant_id
                      LEFT JOIN app_user u ON u.id = a.changed_by
                     WHERE a.changed_at > now() - interval '30 days'
                     ORDER BY a.changed_at DESC LIMIT 200""")
    verb = {"INSERT": "added", "UPDATE": "changed", "DELETE": "deleted"}
    out = []
    for at, action, table, code, who, pk in rows:
        key = (action, table, code, who)
        if out and out[-1]["key"] == key:
            out[-1]["count"] += 1
            continue
        if len(out) == limit:
            break
        out.append({"key": key, "count": 1, "at": at, "ago": _ago(at), "verb": verb.get(action, action.lower()), "what": table.replace("_", " "), "tenant": code,
                    "who": who or "System", "link": _url("admin:audit_definitionauditlog_change", pk),
                    "list_link": _url("admin:audit_definitionauditlog_changelist") + f"?entity_table={table}"})
    return out


def _plural(word, n):
    return word if n == 1 or word.endswith("s") else f"{word}s"


def _initials(who):
    if "@" in who:
        return who[0].upper()
    return "".join(part[0] for part in who.split()[:2]).upper() or "?"


def change_groups(changes):
    """The latest changes as one line per person, tenant and day, with what they touched, most first."""
    groups = {}
    for change in changes:
        day = timezone.localtime(change["at"]).date()
        group = groups.setdefault((change["who"], change["tenant"], day), {
            "who": change["who"], "tenant": change["tenant"], "day": day, "ago": change["ago"], "initials": _initials(change["who"]),
            "lines": [], "total": 0, "kinds": Counter()})
        group["lines"].append(change)
        group["total"] += change["count"]
        group["kinds"][change["what"]] += change["count"]
    for group in groups.values():
        group["breakdown"] = ", ".join(f"{_plural(what, n)} ({n})" if n > 1 else what for what, n in group.pop("kinds").most_common())
    return list(groups.values())


def check_summary(checks, shown=5, limit=6):
    """Checks that need a look get a row, failing first; the fine ones become chips, folded after `shown` when there are many."""
    order = {"fail": 0, "warn": 1}
    problems = sorted((check for check in checks if check["status"] in order), key=lambda check: order[check["status"]])
    fine = sorted((check for check in checks if check["status"] not in order), key=lambda check: check["status"] != "off")
    visible, hidden = (fine[:shown], fine[shown:]) if len(fine) > limit else (fine, [])
    return {"problems": problems, "chips": visible, "more": hidden, "more_healthy": all(check["status"] == "ok" for check in hidden)}


def job_summary(jobs, limit=4):
    """Late and failed jobs first, then the ones that never ran, then the ones on time; the first few, with the total."""
    order = {"failed": 0, "overdue": 0, "never": 1, "ok": 2}
    rows = sorted(jobs, key=lambda job: order.get(job["state"], 1))[:limit]
    for job in rows:
        job["last_run_ago"] = _ago(job["last_run"]) if job["last_run"] else "Never"
    return {"rows": rows, "total": len(jobs), "none_ran": bool(jobs) and all(job["state"] == "never" for job in jobs)}


def recent_tenants(limit=5):
    rows = _rows("""SELECT t.id, t.name, t.code, t.status, t.created_at, p.name, s.status, count(*) OVER ()
                      FROM tenant t
                      LEFT JOIN LATERAL (SELECT plan_id, status FROM tenant_subscription s WHERE s.tenant_id = t.id ORDER BY started_at DESC LIMIT 1) s ON true
                      LEFT JOIN subscription_plan p ON p.id = s.plan_id
                     WHERE t.deleted_at IS NULL ORDER BY t.created_at DESC LIMIT %s""", [limit])
    tenants = [{"name": name, "code": code, "active": status == "ACTIVE", "status": status.title(), "created_at": created, "plan": plan,
                "subscription": (sub or "").replace("_", " ").title(), "link": _url("admin:tenants_tenant_change", pk)}
               for pk, name, code, status, created, plan, sub, _total in rows]
    return {"rows": tenants, "total": rows[0][-1] if rows else 0}


def home(request, health, numbers, jobs, alerts):
    problems = _safe(lambda: attention(health, jobs, alerts), [])
    follow_ups = _safe(business_attention, [])
    items = problems + follow_ups
    return {
        "greeting": _safe(lambda: greeting(request), "Welcome"),
        "first_name": _safe(lambda: first_name(request), ""),
        "today": timezone.localtime(),
        "attention": items,
        "attention_status": attention_status(items),
        "problem_count": sum(1 for item in problems if item["kind"] != "info"),
        "quick_actions": _safe(quick_actions, []),
        "kpis": _safe(lambda: kpis(numbers), []),
        "change_groups": _safe(lambda: change_groups(recent_changes()), []),
        "recent_tenants": _safe(recent_tenants, {"rows": [], "total": 0}),
        "check_summary": _safe(lambda: check_summary(health.get("checks", [])), {"problems": [], "chips": [], "more": [], "more_healthy": True}),
        "job_summary": _safe(lambda: job_summary(jobs), {"rows": [], "total": 0, "none_ran": False}),
        "checks_ok": sum(1 for check in health.get("checks", []) if check["status"] in ("ok", "off")),
        "jobs_ok": sum(1 for job in jobs if job["state"] == "ok"),
    }
