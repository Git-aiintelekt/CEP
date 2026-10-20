"""Who a run was sent to, one row per recipient, and what became of each message: CEP's record (status, reason, the
provider's message id, every timestamp), the events behind it (callbacks, opens and clicks, the provider calls in the
integration log), the address's standing (blocked, unsubscribed), and — for Postal — the provider's own word on the
message, asked for on demand ("Check with Postal")."""
import csv
import io
import re

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.campaigns.models import CampaignRun
from apps.delivery.engine import runs as engine_runs, session
from apps.delivery.models import DeliveryProvider
from apps.delivery.providers import ProviderError, registry
from apps.tenants import context
from apps.spreadsheet import safe_row

VIEW = [IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.view")]
PAGE_MAX = 200
# NOT_SENT is a filter of its own: rows CEP chose not to send (not_sent_reason, patch 0044; their status stays FAILED, and FAILED leaves them out)
STATUSES = {"EMAIL": ("QUEUED", "SUBMITTED", "DELIVERED", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED", "FAILED", "NOT_SENT"),
            "SMS": ("QUEUED", "SUBMITTED", "DELIVERED", "RESPONDED", "OPTED_OUT", "FAILED", "NOT_SENT")}
SHOWN_STATUS = "CASE WHEN x.not_sent_reason IS NOT NULL THEN 'NOT_SENT' ELSE x.status END"
EMAIL_COLUMNS = """x.id, x.party_id, x.email_address AS address, x.status, x.status_reason, x.not_sent_reason, x.provider_message_id, x.attempts, x.variant_key, x.bounce_type,
                   x.created_at, x.submitted_at, x.delivered_at, x.opened_at, x.clicked_at, x.bounced_at, x.complained_at, NULL::timestamptz AS failed_at, x.send_after"""
SMS_COLUMNS = """x.id, x.party_id, x.phone_number AS address, x.status, x.status_reason, x.not_sent_reason, x.provider_message_id, x.attempts, NULL::varchar AS variant_key, NULL::varchar AS bounce_type,
                 x.created_at, x.submitted_at, x.delivered_at, NULL::timestamptz AS opened_at, NULL::timestamptz AS clicked_at, NULL::timestamptz AS bounced_at, NULL::timestamptz AS complained_at,
                 x.failed_at, x.send_after"""
FIELDS = ("id", "party_id", "address", "status", "status_reason", "not_sent_reason", "provider_message_id", "attempts", "variant_key", "bounce_type", "created_at", "submitted_at", "delivered_at",
          "opened_at", "clicked_at", "bounced_at", "complained_at", "failed_at", "send_after", "first_name", "last_name")


def _run(pk):
    run = CampaignRun.objects.select_related("campaign").filter(pk=pk, tenant_id=context.require().tenant_id).first()
    if run is None:
        raise NotFound("No such run.")
    return run


def _family(run) -> str:
    return "SMS" if engine_runs.family(run.campaign) == "SMS" else "EMAIL"


def _table(kind: str) -> tuple[str, str]:
    return ("sms_execution", SMS_COLUMNS) if kind == "SMS" else ("mailer_execution", EMAIL_COLUMNS)


def _where(kind: str, status: str | None, q: str | None) -> tuple[str, list]:
    clauses, args = ["x.tenant_id = %s AND x.campaign_run_id = %s"], []
    if status:
        wanted = [s for s in status.upper().split(",") if s in STATUSES[kind]]
        if not wanted:
            raise ValidationError({"status": f"One of {', '.join(STATUSES[kind])}."})
        clauses.append(f"{SHOWN_STATUS} = ANY(%s)")
        args.append(wanted)
    if q:
        clauses.append("(x.%s ILIKE %%s OR x.party_id ILIKE %%s OR cm.first_name ILIKE %%s OR cm.last_name ILIKE %%s)" % ("phone_number" if kind == "SMS" else "email_address"))
        args += [f"%{q}%"] * 4
    return " AND ".join(clauses), args


def rows_for(run, *, status: str | None = None, q: str | None = None, offset: int = 0, limit: int | None = 50) -> tuple[list[dict], int]:
    kind = _family(run)
    table, columns = _table(kind)
    where, extra = _where(kind, status, q)
    args = [str(run.tenant_id), str(run.pk), *extra]
    with session.connection().cursor() as cursor:
        cursor.execute(f"SELECT count(*) FROM {table} x LEFT JOIN customer_master cm ON cm.tenant_id = x.tenant_id AND cm.party_id = x.party_id WHERE {where}", args)
        total = cursor.fetchone()[0]
        cursor.execute(f"""SELECT {columns}, cm.first_name, cm.last_name FROM {table} x
                            LEFT JOIN customer_master cm ON cm.tenant_id = x.tenant_id AND cm.party_id = x.party_id
                           WHERE {where} ORDER BY x.created_at, x.id {'LIMIT %s OFFSET %s' if limit else ''}""", args + ([limit, offset] if limit else []))
        rows = [dict(zip(FIELDS, row)) for row in cursor.fetchall()]
    return rows, total


class RunRecipientsView(APIView):
    """GET /campaign-runs/{id}/recipients/?status=BOUNCED,FAILED&q=jordan&page=1&page_size=50"""
    permission_classes = VIEW

    @extend_schema(parameters=[OpenApiParameter("status", str), OpenApiParameter("q", str), OpenApiParameter("page", int), OpenApiParameter("page_size", int)], responses={200: None})
    def get(self, request, pk, version=None):
        run = _run(pk)
        try:
            page, size = max(1, int(request.query_params.get("page", 1))), min(PAGE_MAX, max(1, int(request.query_params.get("page_size", 50))))
        except ValueError:
            raise ValidationError({"page": "A whole number."}) from None
        rows, total = rows_for(run, status=request.query_params.get("status") or None, q=(request.query_params.get("q") or "").strip() or None, offset=(page - 1) * size, limit=size)
        stats = engine_runs.stats(run.tenant_id, run.pk)
        return Response({"run": {"id": str(run.pk), "run_number": run.run_number, "status": run.status, "test_mode": run.test_mode, "family": _family(run)},
                         "count": total, "page": page, "page_size": size, "results": rows, "by_status": stats["by_status"], "statuses": STATUSES[_family(run)]})


def skipped_for(run, *, reason: str | None = None, q: str | None = None, offset: int = 0, limit: int = 50) -> tuple[list[dict], int, dict]:
    """The people the run's Campaign List left out (suppression_reason set): party, name, the address or number the
    engine would have used, and the reason. -> (rows, total, {reason: count} over the whole list)."""
    from apps.delivery.engine.audience import PRIMARY_EMAIL
    from apps.delivery.engine.audience_sms import PRIMARY_PHONE
    address = PRIMARY_PHONE if _family(run) == "SMS" else PRIMARY_EMAIL
    clauses, args = ["m.tenant_id = %s AND l.campaign_run_id = %s AND m.suppression_reason IS NOT NULL"], [str(run.tenant_id), str(run.pk)]
    if reason:
        clauses.append("m.suppression_reason = ANY(%s)")
        args.append([item.strip().upper() for item in reason.split(",") if item.strip()])
    if q:
        clauses.append("(m.party_id ILIKE %s OR cm.first_name ILIKE %s OR cm.last_name ILIKE %s OR " + address + " ILIKE %s)")
        args += [f"%{q}%"] * 4
    where = " AND ".join(clauses)
    joins = """FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id AND l.tenant_id = m.tenant_id
                LEFT JOIN customer_master cm ON cm.tenant_id = m.tenant_id AND cm.party_id = m.party_id"""
    with session.connection().cursor() as cursor:
        cursor.execute(f"SELECT count(*) {joins} WHERE {where}", args)
        total = cursor.fetchone()[0]
        cursor.execute(f"""SELECT m.party_id, cm.first_name, cm.last_name, {address}, m.suppression_reason {joins}
                            WHERE {where} ORDER BY m.suppression_reason, m.party_id LIMIT %s OFFSET %s""", args + [limit, offset])
        rows = [{"party_id": party, "first_name": first, "last_name": last, "address": addr, "reason": why} for party, first, last, addr, why in cursor.fetchall()]
        cursor.execute("""SELECT m.suppression_reason, count(*) FROM campaign_list_member m JOIN campaign_list l ON l.id = m.campaign_list_id AND l.tenant_id = m.tenant_id
                           WHERE m.tenant_id = %s AND l.campaign_run_id = %s AND m.suppression_reason IS NOT NULL GROUP BY 1""", [str(run.tenant_id), str(run.pk)])
        by_reason = dict(cursor.fetchall())
    return rows, total, by_reason


class RunSkippedView(APIView):
    """GET /campaign-runs/{id}/skipped/?reason=FREQUENCY_CAP&q=jordan&page=1&page_size=50 : who the run's Campaign List left out"""
    permission_classes = VIEW

    @extend_schema(parameters=[OpenApiParameter("reason", str), OpenApiParameter("q", str), OpenApiParameter("page", int), OpenApiParameter("page_size", int)], responses={200: None})
    def get(self, request, pk, version=None):
        run = _run(pk)
        try:
            page, size = max(1, int(request.query_params.get("page", 1))), min(PAGE_MAX, max(1, int(request.query_params.get("page_size", 50))))
        except ValueError:
            raise ValidationError({"page": "A whole number."}) from None
        rows, total, by_reason = skipped_for(run, reason=request.query_params.get("reason") or None, q=(request.query_params.get("q") or "").strip() or None,
                                             offset=(page - 1) * size, limit=size)
        return Response({"run": {"id": str(run.pk), "run_number": run.run_number, "status": run.status, "test_mode": run.test_mode, "family": _family(run)},
                         "count": total, "page": page, "page_size": size, "results": rows, "by_reason": by_reason})


class RunRecipientsExportView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={(200, "text/csv"): str})
    def get(self, request, pk, version=None):
        run = _run(pk)
        rows, _ = rows_for(run, status=request.query_params.get("status") or None, q=(request.query_params.get("q") or "").strip() or None, limit=None)
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["address", "first_name", "last_name", "customer_id", "status", "reason", "provider_message_id", "attempts", "queued_at", "submitted_at", "delivered_at",
                         "opened_at", "clicked_at", "bounced_at", "complained_at", "failed_at", "bounce_type", "variant"])
        stamp = lambda value: value.isoformat(timespec="seconds") if value else ""       # noqa: E731
        for row in rows:
            writer.writerow(safe_row([row["address"], row["first_name"] or "", row["last_name"] or "", row["party_id"], row["status"], row["status_reason"] or "", row["provider_message_id"] or "",
                             row["attempts"], stamp(row["created_at"]), stamp(row["submitted_at"]), stamp(row["delivered_at"]), stamp(row["opened_at"]), stamp(row["clicked_at"]),
                             stamp(row["bounced_at"]), stamp(row["complained_at"]), stamp(row["failed_at"]), row["bounce_type"] or "", row["variant_key"] or ""]))
        response = HttpResponse("﻿" + out.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="run-{run.run_number}-recipients.csv"'
        return response


def _one(run, execution_id: int) -> dict:
    kind = _family(run)
    table, columns = _table(kind)
    with session.connection().cursor() as cursor:
        cursor.execute(f"""SELECT {columns}, cm.first_name, cm.last_name FROM {table} x
                            LEFT JOIN customer_master cm ON cm.tenant_id = x.tenant_id AND cm.party_id = x.party_id
                           WHERE x.tenant_id = %s AND x.campaign_run_id = %s AND x.id = %s""", [str(run.tenant_id), str(run.pk), execution_id])
        row = cursor.fetchone()
    if row is None:
        raise NotFound("No such recipient in this run.")
    return dict(zip(FIELDS, row))


def timeline(run, row: dict) -> dict:
    """Everything CEP knows about one message, in time order."""
    kind = _family(run)
    tenant = str(run.tenant_id)
    events: list[dict] = []
    with session.connection().cursor() as cursor:
        for column in ("created_at", "submitted_at", "delivered_at", "opened_at", "clicked_at", "bounced_at", "complained_at", "failed_at"):
            if row.get(column):
                events.append({"at": row[column], "kind": "cep", "what": {"created_at": "Queued", "submitted_at": "Handed to the engine", "delivered_at": "Delivered", "opened_at": "First open",
                                                                          "clicked_at": "First click", "bounced_at": "Bounced", "complained_at": "Marked as spam", "failed_at": "Failed"}[column],
                               "detail": row["status_reason"] if column in ("failed_at", "bounced_at") else None})
        if kind == "EMAIL":
            cursor.execute("""SELECT event_type, occurred_at, url, user_agent FROM tracking_event WHERE tenant_id = %s AND mailer_execution_id = %s ORDER BY occurred_at""", [tenant, row["id"]])
            for event_type, at, url, agent in cursor.fetchall():
                events.append({"at": at, "kind": "tracking", "what": {"OPEN": "Opened", "CLICK": "Clicked", "UNSUBSCRIBE_CLICK": "Unsubscribed"}.get(event_type, event_type), "detail": url or (agent or "")[:80] or None})
        refs = [value for value in (row.get("provider_message_id"),) if value]
        cursor.execute("""SELECT id, event_type, received_at, processing_status, raw_payload FROM delivery_webhook_event
                           WHERE tenant_id = %s AND execution_type = %s AND (execution_ref = ANY(%s) OR raw_payload::text LIKE %s) ORDER BY received_at""",
                       [tenant, "SMS" if kind == "SMS" else "MAILER", refs or [""], f'%"x": {row["id"]},%' if kind == "EMAIL" else "%nothing%"])
        callbacks = [{"id": event_id, "at": at, "kind": "callback", "what": event_type, "detail": status, "payload": payload} for event_id, event_type, at, status, payload in cursor.fetchall()]
        events += [{**c, "payload": None} for c in callbacks]
        cursor.execute("""SELECT id, started_at, direction, outcome, response_status, error_message FROM integration_log
                           WHERE tenant_id = %s AND related_ref = %s ORDER BY started_at""", [tenant, f"{'sms' if kind == 'SMS' else 'mailer'}_execution:{row['id']}"])
        log = [{"id": log_id, "at": at, "direction": direction, "outcome": outcome, "response_status": status, "error": error} for log_id, at, direction, outcome, status, error in cursor.fetchall()]
        standing = None
        if kind == "EMAIL":
            cursor.execute("""SELECT cps.blocked, cps.block_reason, cps.hard_bounce_count, cps.soft_bounce_count, cps.complaint_count, cs.consent_status, cs.opt_out_method
                                FROM (SELECT 1) one
                                LEFT JOIN contact_point_status cps ON cps.tenant_id = %s AND cps.contact_point_type = 'EMAIL' AND cps.contact_value = %s::citext
                                LEFT JOIN consent_suppression cs ON cs.tenant_id = %s AND cs.party_id = %s AND cs.channel = 'EMAIL'""",
                           [tenant, row["address"], tenant, row["party_id"]])
            blocked, reason, hard, soft, complaints, consent, method = cursor.fetchone()
            standing = {"blocked": bool(blocked), "block_reason": reason, "hard_bounces": hard or 0, "soft_bounces": soft or 0, "complaints": complaints or 0,
                        "consent": consent or "UNKNOWN", "opt_out_method": method}
    events.sort(key=lambda item: item["at"])
    return {"events": events, "callbacks": len(callbacks), "log": log, "standing": standing}


class RunRecipientView(APIView):
    """GET /campaign-runs/{id}/recipients/{execution_id}/: the message and its timeline."""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, pk, execution_id, version=None):
        run = _run(pk)
        row = _one(run, execution_id)
        return Response({"recipient": row, **timeline(run, row)})


class RunRecipientCheckView(APIView):
    """POST /campaign-runs/{id}/recipients/{execution_id}/check/: the provider's own record of the message, read now."""
    permission_classes = VIEW

    @extend_schema(request=None, responses={200: None})
    def post(self, request, pk, execution_id, version=None):
        run = _run(pk)
        row = _one(run, execution_id)
        provider_id = _provider_of(run, row)
        provider = DeliveryProvider.objects.filter(pk=provider_id, tenant_id=run.tenant_id).first() if provider_id else None
        if provider is None:
            raise ValidationError({"detail": "The engine that carried this message is not known."})
        adapter = registry.for_provider(provider)
        if not hasattr(adapter, "message_status"):
            raise ValidationError({"detail": f"{adapter.label} cannot be asked about a message after the send."})
        if not row.get("provider_message_id"):
            raise ValidationError({"detail": "The engine never confirmed this message, so there is nothing to look up."})
        try:
            with adapter:
                found = adapter.message_status(row["provider_message_id"], related_ref=f"mailer_execution:{row['id']}")
        except ProviderError as exc:
            raise ValidationError({"detail": str(exc)}) from None
        return Response({"provider": provider.name, "provider_type": provider.provider_type, **found})


def _provider_of(run, row):
    with session.connection().cursor() as cursor:
        cursor.execute(f"SELECT delivery_provider_id FROM {'sms_execution' if _family(run) == 'SMS' else 'mailer_execution'} WHERE tenant_id = %s AND id = %s", [str(run.tenant_id), row["id"]])
        found = cursor.fetchone()
    return found[0] if found else None


def _campaign(pk):
    from apps.campaigns.models import Campaign
    campaign = Campaign.objects.filter(pk=pk, tenant_id=context.require().tenant_id, deleted_at__isnull=True).first()
    if campaign is None:
        raise NotFound("No such campaign.")
    return campaign


class CampaignSuppressionsView(APIView):
    """GET /campaigns/{id}/suppressions/?channel=&reason=&search=&page=: who on this campaign's lists is blocked or unsubscribed,
    why, from where and since when — the Suppressions page's own rows, kept to this campaign's people."""
    permission_classes = VIEW

    @extend_schema(parameters=[OpenApiParameter("channel", str), OpenApiParameter("reason", str), OpenApiParameter("search", str), OpenApiParameter("page", int), OpenApiParameter("page_size", int)],
                   responses={200: None})
    def get(self, request, pk, version=None):
        from apps.governance import suppressions
        campaign = _campaign(pk)
        params = request.query_params
        try:
            listing = suppressions.listing(channel=params.get("channel"), group=params.get("reason"), search=params.get("search"), page=int(params.get("page", 1)),
                                           page_size=int(params.get("page_size", 50)), campaign=campaign.pk)
        except suppressions.SuppressionError as exc:
            raise ValidationError({"reason": str(exc)}) from None
        except ValueError:
            raise ValidationError({"page": "A whole number."}) from None
        return Response({**listing, "summary": suppressions.summary(campaign.pk)})


class CampaignSuppressionsExportView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={(200, "text/csv"): str})
    def get(self, request, pk, version=None):
        from apps.governance import suppressions
        campaign = _campaign(pk)
        params = request.query_params
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["contact", "channel", "reason", "source", "detail", "since", "customer_id", "name"])
        try:
            for row in suppressions.rows_for_export(channel=params.get("channel"), group=params.get("reason"), search=params.get("search"), campaign=campaign.pk):
                writer.writerow(safe_row([row["contact"], row["channel"], row["reason_label"], row["source_label"] or "", row["detail"] or "",
                                          row["since"].isoformat(timespec="minutes") if row["since"] else "", row["party_id"] or "", row["name"] or ""]))
        except suppressions.SuppressionError as exc:
            raise ValidationError({"reason": str(exc)}) from None
        response = HttpResponse("﻿" + out.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{campaign.code or campaign.pk}-blocked-and-unsubscribed.csv"'
        return response
