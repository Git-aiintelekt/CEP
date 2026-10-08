"""Reports: the workspace over a period, campaigns compared, a CSV, and the weekly email's schedule.

    GET  /reports/summary/        ?from=YYYY-MM-DD &to=YYYY-MM-DD &channel=EMAIL|SMS      default: this month so far, in the workspace's zone
    GET  /reports/campaigns.csv   the same period as a file
    GET  /reports/compare/        ?ids=a,b[,c...]     two to six campaigns side by side
    GET  /reports/schedule/       PUT {enabled, weekday 0-6, hour 0-23, recipients: [...]}   the weekly email (reading: report.view; changing: user.admin)
    GET  /reports/journeys/       ?from &to &journey=<id>      the Journeys dataset: per journey per day (apps.reporting.journey_reports)
    GET  /reports/journeys.csv    the same rows as a file
"""
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode
from apps.reporting import journey_reports, reports
from apps.tenants import context
from apps.tenants.models import Tenant

VIEW = [IsAuthenticated, HasPermissionCode.for_("report.view")]


class ScheduleAccess(BasePermission):
    def has_permission(self, request, view):
        code = "report.view" if request.method in ("GET", "HEAD", "OPTIONS") else "user.admin"
        return HasPermissionCode.for_(code)().has_permission(request, view)


def _tenant():
    return Tenant.objects.get(pk=context.require().tenant_id)


def _dates(params) -> tuple:
    out = []
    for name in ("from", "to"):
        value = params.get(name)
        if not value:
            out.append(None)
            continue
        try:
            out.append(serializers.DateField().to_internal_value(value))
        except serializers.ValidationError:
            raise ValidationError({name: "Use a date like 2026-09-30."}) from None
    return tuple(out)


def _report(request):
    start, end = _dates(request.query_params)
    try:
        return reports.summary(_tenant(), start, end, channel=request.query_params.get("channel") or None)
    except reports.ReportError as exc:
        raise ValidationError({exc.field: str(exc)}) from None


class ReportSummaryView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(_report(request))


class ReportCsvView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        report = _report(request)
        response = HttpResponse(reports.csv_text(report), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="campaigns {report["period"]["from"]} to {report["period"]["to"]}.csv"'
        return response


def _journeys_report(request):
    start, end = _dates(request.query_params)
    try:
        return journey_reports.summary(_tenant(), start, end, journey_id=request.query_params.get("journey") or None)
    except reports.ReportError as exc:
        raise ValidationError({exc.field: str(exc)}) from None


class JourneysReportView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(_journeys_report(request))


class JourneysReportCsvView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        report = _journeys_report(request)
        response = HttpResponse(journey_reports.csv_text(report), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="journeys {report["period"]["from"]} to {report["period"]["to"]}.csv"'
        return response


class ReportCompareView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        ids = [item.strip() for item in request.query_params.get("ids", "").split(",") if item.strip()]
        try:
            return Response({"campaigns": reports.compare(ids)})
        except reports.ReportError as exc:
            raise ValidationError({exc.field: str(exc)}) from None
        except ValueError:
            raise ValidationError({"ids": "Campaign ids are UUIDs."}) from None


class ReportScheduleView(APIView):
    permission_classes = [IsAuthenticated, ScheduleAccess]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(reports.weekly_settings(_tenant()))

    @extend_schema(request=inline_serializer("WeeklyReport", {"enabled": serializers.BooleanField(required=False), "weekday": serializers.IntegerField(required=False),
                                                              "hour": serializers.IntegerField(required=False), "recipients": serializers.ListField(child=serializers.EmailField(), required=False)}),
                   responses={200: None})
    def put(self, request, version=None):
        try:
            return Response(reports.save_weekly(_tenant(), request.data))
        except reports.ReportError as exc:
            raise ValidationError({exc.field: str(exc)}) from None
