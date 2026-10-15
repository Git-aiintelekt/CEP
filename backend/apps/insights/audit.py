"""The run log (Phase C): every preview, run and export in the workspace from report_run_audit, for report administrators.

    GET /insights/runs/?days=7|30&outcome=OK|TIMEOUT|REFUSED|FAILED&user=<id>&q=<report name>   (kinds: preview, run, export, delivery)
        -> {"runs": [...newest first, 200 at most], "summary": {"runs", "timed_out", "refused", "failed", "median_ms"}}
"""
from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.insights.api import VIEW, _has, _q

OUTCOMES = ("OK", "TIMEOUT", "REFUSED", "FAILED")
LIMIT = 200


class RunLogView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        if not _has(request, "report.admin"):
            raise PermissionDenied("The run log is for report administrators.")
        params = request.query_params
        days = 30 if params.get("days") == "30" else 7
        since = timezone.now() - timedelta(days=days)
        filters, args = ["a.started_at >= %s"], [since]
        if params.get("outcome") in OUTCOMES:
            filters.append("a.outcome = %s"); args.append(params["outcome"])
        if params.get("user"):
            filters.append("a.user_id::text = %s"); args.append(params["user"])
        if params.get("q", "").strip():
            filters.append("(r.name ILIKE %s OR a.dataset_key ILIKE %s)"); args.extend([f"%{params['q'].strip()}%", f"%{params['q'].strip()}%"])
        where = " AND ".join(filters)
        rows = _q(f"""SELECT a.id, a.started_at, a.kind, a.outcome, a.detail, a.duration_ms, a.row_count, a.dataset_key, a.report_id::text, a.report_version,
                             r.name AS report_name, d.label AS dataset_label, a.user_id::text, u.display_name AS user_name
                        FROM report_run_audit a LEFT JOIN report r ON r.id = a.report_id LEFT JOIN report_dataset d ON d.key = a.dataset_key
                        LEFT JOIN app_user u ON u.id = a.user_id
                       WHERE {where} ORDER BY a.started_at DESC, a.id DESC LIMIT {LIMIT}""", args)
        summary = _q(f"""SELECT count(*) AS runs, count(*) FILTER (WHERE a.outcome = 'TIMEOUT') AS timed_out, count(*) FILTER (WHERE a.outcome = 'REFUSED') AS refused,
                                count(*) FILTER (WHERE a.outcome = 'FAILED') AS failed,
                                percentile_cont(0.5) WITHIN GROUP (ORDER BY a.duration_ms) FILTER (WHERE a.outcome = 'OK') AS median_ms
                           FROM report_run_audit a LEFT JOIN report r ON r.id = a.report_id WHERE {where}""", args)[0]
        people = _q(f"""SELECT DISTINCT a.user_id::text AS id, u.display_name AS name FROM report_run_audit a JOIN app_user u ON u.id = a.user_id
                         WHERE a.started_at >= %s ORDER BY u.display_name""", [since])
        return Response({"days": days, "runs": [{"id": r["id"], "started_at": r["started_at"], "kind": r["kind"], "outcome": r["outcome"], "detail": r["detail"], "duration_ms": r["duration_ms"],
                                                 "row_count": r["row_count"], "dataset": r["dataset_key"], "dataset_label": r["dataset_label"], "report_id": r["report_id"],
                                                 "report_name": r["report_name"], "report_version": r["report_version"], "user_id": r["user_id"], "user_name": r["user_name"]} for r in rows],
                         "summary": {"runs": int(summary["runs"]), "timed_out": int(summary["timed_out"]), "refused": int(summary["refused"]), "failed": int(summary["failed"]),
                                     "median_ms": (int(summary["median_ms"]) if summary["median_ms"] is not None else None)},
                         "people": people})
