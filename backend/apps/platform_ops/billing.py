"""Usage metering, plan limits and monthly invoices.

  rollup_usage(month)        execution tables / lists / media -> tenant_usage (idempotent upsert; run hourly)
  quota(tenant_id)           this month's usage against the tenant's plan, for the API and both admin surfaces
  assert_can_send(tenant_id) raises Conflict when a hard-capped plan has used its messages (called on publish)
  generate_invoices(month)   DRAFT invoice per tenant: plan price + overage; ISSUED / PAID invoices are never recomputed

All of it runs on the platform connection: it reads across tenants.
"""
import math
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import connections, transaction
from django.utils import timezone

from . import params

P = settings.PLATFORM_ALIAS
MESSAGE_METRICS = ("EMAIL_SENT", "SMS_SENT", "MMS_SENT")
LABELS = {"EMAIL_SENT": "Emails sent", "SMS_SENT": "SMS parts sent", "MMS_SENT": "MMS sent", "CONTACTS": "Contacts", "STORAGE_BYTES": "Storage",
          "DELIVERABILITY_TESTS": "Deliverability tests"}


def month_start(day: date | None = None) -> date:
    return (day or timezone.now().date()).replace(day=1)


def _next_month(first: date) -> date:
    return (first + timedelta(days=32)).replace(day=1)


def _rows(sql, args=()):
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()


def rollup_usage(month: date | None = None) -> dict:
    """Recomputes one month from the source tables. Counting from the source (not incrementing) makes a re-run safe."""
    first = month_start(month)
    last = _next_month(first)
    sources = {
        # a message counts once it left the platform; SMS is billed per part, as the carriers bill it
        "EMAIL_SENT": ("SELECT tenant_id, count(*) FROM mailer_execution WHERE created_at >= %s AND created_at < %s AND status <> 'QUEUED' GROUP BY 1", True),
        "SMS_SENT": ("SELECT tenant_id, sum(COALESCE(segment_count, 1)) FROM sms_execution WHERE created_at >= %s AND created_at < %s AND status <> 'QUEUED' AND COALESCE(provider_code, '') <> 'SANDBOX_SMS' AND message_type = 'SMS' GROUP BY 1", True),
        "MMS_SENT": ("SELECT tenant_id, count(*) FROM sms_execution WHERE created_at >= %s AND created_at < %s AND status <> 'QUEUED' AND COALESCE(provider_code, '') <> 'SANDBOX_SMS' AND message_type = 'MMS' GROUP BY 1", True),
        # point-in-time measures, recorded against the current month only
        "CONTACTS": ("SELECT tenant_id, count(DISTINCT party_id) FROM contact_list_member GROUP BY 1", False),
        "STORAGE_BYTES": ("SELECT tenant_id, COALESCE(sum(byte_size), 0) FROM media_asset WHERE deleted_at IS NULL GROUP BY 1", False),
        # a test counts when it is requested: the provider bills it then, whatever comes back
        "DELIVERABILITY_TESTS": ("SELECT tenant_id, count(*) FROM deliverability_test WHERE requested_at >= %s AND requested_at < %s GROUP BY 1", True),
    }
    written = 0
    with connections[P].cursor() as cursor:
        for metric, (sql, ranged) in sources.items():
            if not ranged and first != month_start():
                continue
            cursor.execute(sql, [first, last] if ranged else [])
            for tenant_id, value in cursor.fetchall():
                cursor.execute("""INSERT INTO tenant_usage (tenant_id, period_month, metric, value) VALUES (%s, %s, %s, %s)
                                  ON CONFLICT (tenant_id, period_month, metric) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
                                  WHERE tenant_usage.value IS DISTINCT FROM EXCLUDED.value""", [tenant_id, first, metric, int(value or 0)])
                written += 1
    return {"month": first.isoformat(), "values": written}


def plan_for(tenant_id) -> dict | None:
    rows = _rows("""SELECT p.code, p.name, p.max_messages_per_month, p.max_contacts, p.max_users, p.max_storage_gb, p.monthly_price, p.currency,
                           p.overage_per_1k_messages, p.overage_per_1k_contacts, s.status, p.id
                      FROM tenant_subscription s JOIN subscription_plan p ON p.id = s.plan_id
                     WHERE s.tenant_id = %s AND s.status <> 'CANCELLED' ORDER BY s.started_at DESC LIMIT 1""", [str(tenant_id)])
    if not rows:
        return None
    keys = ("code", "name", "max_messages", "max_contacts", "max_users", "max_storage_gb", "monthly_price", "currency", "overage_messages", "overage_contacts", "subscription_status")
    plan = dict(zip(keys, rows[0]))
    plan["max_deliverability_tests"] = _tests_allowance(rows[0][-1])
    return plan


def _tests_allowance(plan_id):
    """The plan's deliverability-test allowance; None (unlimited) when the column is not there yet (a deploy ahead of patch 0030)."""
    from django.db import ProgrammingError
    try:
        with transaction.atomic(using=P):
            return _rows("SELECT max_deliverability_tests_per_month FROM subscription_plan WHERE id = %s", [plan_id])[0][0]
    except ProgrammingError:
        return None


def usage_for(tenant_id, month: date | None = None) -> dict:
    return {metric: int(value) for metric, value in _rows("SELECT metric, value FROM tenant_usage WHERE tenant_id = %s AND period_month = %s", [str(tenant_id), month_start(month)])}


def _meter(label, used, limit, overage_price, unit=""):
    warn_at = int(params.get("billing.usage_warning_percent", 80))
    percent = None if not limit else round(used * 100 / limit, 1)
    state = "ok"
    if limit and used >= limit:
        state = "over" if overage_price is not None else "blocked"
    elif percent is not None and percent >= warn_at:
        state = "warning"
    return {"label": label, "used": used, "limit": limit, "percent": percent, "state": state, "unit": unit,
            "overage": overage_price is not None, "overage_price_per_1k": float(overage_price) if overage_price is not None else None}


def tests_this_month(tenant_id, account: str | None = None) -> int:
    """Counted live (not from the hourly rollup), because the allowance is checked before every test. account PLATFORM: only
    the tests run through the platform's Mailgun account, the ones the plan limits."""
    if account:
        return _rows("SELECT count(*) FROM deliverability_test WHERE tenant_id = %s AND requested_at >= %s AND account = %s",
                     [str(tenant_id), month_start(), account])[0][0]
    return _rows("SELECT count(*) FROM deliverability_test WHERE tenant_id = %s AND requested_at >= %s", [str(tenant_id), month_start()])[0][0]


def added_tests(tenant_id, month: date | None = None) -> int:
    """Deliverability tests the platform team added to the workspace for the month (tenant_quota_grant); they end with it."""
    return int(_rows("""SELECT COALESCE(sum(amount), 0) FROM tenant_quota_grant
                         WHERE tenant_id = %s AND metric = 'DELIVERABILITY_TESTS' AND period_month = %s AND removed_at IS NULL""",
                     [str(tenant_id), month_start(month)])[0][0])


def _tests_meter(tenant_id) -> dict:
    """Deliverability tests: the platform's account counts against the plan + the month's added tests; a workspace on its own
    account shows its count without a limit. The note says where the number comes from."""
    from apps.delivery import deliverability
    state = deliverability.allowance(tenant_id)
    meter = _meter("Deliverability tests this month", state["used"], state["limit"], None)
    meter["note"] = state["note"]
    return meter


def quota(tenant_id) -> dict:
    """What Settings -> Plan and usage shows, and what publish checks."""
    plan = plan_for(tenant_id)
    used = usage_for(tenant_id)
    messages = sum(used.get(metric, 0) for metric in MESSAGE_METRICS)
    users = _rows("SELECT count(*) FROM app_user WHERE tenant_id = %s AND is_active AND deleted_at IS NULL", [str(tenant_id)])[0][0]
    storage_gb = round(used.get("STORAGE_BYTES", 0) / 1024 ** 3, 3)
    limits = plan or {}
    meters = [
        _meter("Messages this month", messages, limits.get("max_messages"), limits.get("overage_messages")),
        _meter("Contacts", used.get("CONTACTS", 0), limits.get("max_contacts"), limits.get("overage_contacts")),
        _meter("Active users", users, limits.get("max_users"), None),
        _meter("Storage", storage_gb, limits.get("max_storage_gb"), None, "GB"),
        _tests_meter(tenant_id),
    ]
    return {"month": month_start().isoformat(),
            "plan": {"code": plan["code"], "name": plan["name"], "monthly_price": float(plan["monthly_price"] or 0), "currency": plan["currency"],
                     "status": plan["subscription_status"]} if plan else None,
            "meters": meters,
            "breakdown": {LABELS[m]: used.get(m, 0) for m in MESSAGE_METRICS},
            "can_send": meters[0]["state"] != "blocked"}


def assert_can_send(tenant_id) -> None:
    from api.exceptions import Conflict
    state = quota(tenant_id)
    if not state["can_send"]:
        meter = state["meters"][0]
        raise Conflict(f"This workspace has used its {meter['limit']:,} messages for the month and the {state['plan']['name']} plan has no overage. "
                       "Sending resumes next month, or ask for a plan upgrade.")


def build_invoice(tenant_code: str, plan: dict, used: dict, first: date) -> dict:
    """Pure: the numbers on an invoice. Overage is charged per started block of 1,000."""
    money = lambda value: Decimal(value or 0).quantize(Decimal("0.01"))            # noqa: E731
    base = money(plan["monthly_price"])
    lines = [{"description": f"{plan['name']} plan, {first:%B %Y}", "quantity": 1, "unit_price": float(base), "amount": float(base)}]
    overage = Decimal("0.00")
    messages = sum(used.get(metric, 0) for metric in MESSAGE_METRICS)
    for label, quantity, limit, price in (("messages", messages, plan["max_messages"], plan["overage_messages"]),
                                          ("contacts", used.get("CONTACTS", 0), plan["max_contacts"], plan["overage_contacts"])):
        if limit and price is not None and quantity > limit:
            blocks = math.ceil((quantity - limit) / 1000)
            amount = money(Decimal(blocks) * Decimal(price))
            overage += amount
            lines.append({"description": f"{quantity - limit:,} {label} above the {limit:,} included ({blocks} x 1,000)", "quantity": blocks,
                          "unit_price": float(price), "amount": float(amount)})
    return {"invoice_number": f"INV-{tenant_code}-{first:%Y%m}", "base_amount": base, "overage_amount": overage, "total_amount": base + overage,
            "line_items": lines, "usage_snapshot": used}


def generate_invoices(month: date | None = None) -> dict:
    """Default: the month that just ended. Re-running refreshes DRAFTs only."""
    import json
    first = month_start(month) if month else month_start(month_start() - timedelta(days=1))
    rollup_usage(first)
    created = refreshed = skipped = 0
    for tenant_id, code in _rows("SELECT id, code FROM tenant WHERE status <> 'OFFBOARDED' AND deleted_at IS NULL"):
        plan = plan_for(tenant_id)
        if plan is None or plan["monthly_price"] is None:
            skipped += 1
            continue
        invoice = build_invoice(code, plan, usage_for(tenant_id, first), first)
        with connections[P].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])
            cursor.execute("""INSERT INTO tenant_invoice (tenant_id, invoice_number, period_month, plan_code, currency, base_amount, overage_amount,
                                                          total_amount, line_items, usage_snapshot)
                              VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                              ON CONFLICT (tenant_id, period_month) DO UPDATE
                                 SET plan_code = EXCLUDED.plan_code, base_amount = EXCLUDED.base_amount, overage_amount = EXCLUDED.overage_amount,
                                     total_amount = EXCLUDED.total_amount, line_items = EXCLUDED.line_items, usage_snapshot = EXCLUDED.usage_snapshot
                               WHERE tenant_invoice.status = 'DRAFT'
                              RETURNING (xmax = 0)""",
                           [str(tenant_id), invoice["invoice_number"], first, plan["code"], plan["currency"], invoice["base_amount"], invoice["overage_amount"],
                            invoice["total_amount"], json.dumps(invoice["line_items"]), json.dumps(invoice["usage_snapshot"])])
            row = cursor.fetchone()
        if row is None:
            skipped += 1                                   # already issued: left untouched
        elif row[0]:
            created += 1
        else:
            refreshed += 1
    return {"month": first.isoformat(), "created": created, "refreshed": refreshed, "skipped": skipped}
