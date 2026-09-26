"""Suppressions (Settings → Suppressions): what the engine will not send to, why, since when; unblock, block, import, export.

    GET  /suppressions/                 ?channel=EMAIL|PHONE &reason=UNSUBSCRIBED|BOUNCED|COMPLAINED|BLOCKED &search= &page= &page_size=
    GET  /suppressions/summary/         counts by reason, this week's additions
    GET  /suppressions/export.csv       the same rows, filtered the same way
    POST /suppressions/<kind>/<id>/unblock/     kind = CONTACT_POINT (a bounce or a block); an opt-out cannot be undone here
    POST /suppressions/block/           {values: [...], note} or a CSV file: blocks addresses and numbers by hand

Reading needs campaign.view (anyone who works on campaigns sees who is left out); changing needs consent.edit.
"""
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode
from apps.governance import suppressions

READ = (HasPermissionCode.for_("campaign.view")(), HasPermissionCode.for_("consent.edit")(), HasPermissionCode.for_("governance.edit")())
WRITE = HasPermissionCode.for_("consent.edit")()


class SuppressionAccess(BasePermission):
    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return any(check.has_permission(request, view) for check in READ)
        return WRITE.has_permission(request, view)


ACCESS = [IsAuthenticated, SuppressionAccess]


def _int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class SuppressionListView(APIView):
    permission_classes = ACCESS

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        params = request.query_params
        try:
            return Response(suppressions.listing(channel=params.get("channel"), group=params.get("reason"), search=params.get("search"),
                                                 page=_int(params.get("page"), 1), page_size=_int(params.get("page_size"), 50)))
        except suppressions.SuppressionError as exc:
            raise ValidationError({"reason": str(exc)}) from None


class SuppressionSummaryView(APIView):
    permission_classes = ACCESS

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(suppressions.summary())


class SuppressionExportView(APIView):
    permission_classes = ACCESS

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        import csv
        import io
        params = request.query_params
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["contact", "channel", "reason", "source", "detail", "since", "customer_id", "name", "can_unblock"])
        try:
            for row in suppressions.rows_for_export(channel=params.get("channel"), group=params.get("reason"), search=params.get("search")):
                writer.writerow([row["contact"], row["channel"], row["reason_label"], row["source_label"] or "", row["detail"] or "",
                                 row["since"].isoformat(timespec="minutes") if row["since"] else "", row["party_id"] or "", row["name"] or "", "yes" if row["can_unblock"] else "no"])
        except suppressions.SuppressionError as exc:
            raise ValidationError({"reason": str(exc)}) from None
        response = HttpResponse("﻿" + out.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="suppressions.csv"'
        return response


class SuppressionUnblockView(APIView):
    permission_classes = ACCESS

    @extend_schema(request=None, responses={200: None})
    def post(self, request, kind=None, pk=None, version=None):
        try:
            return Response(suppressions.unblock(kind.upper(), str(pk), request.user))
        except suppressions.SuppressionError as exc:
            raise Conflict(str(exc)) from None


class SuppressionBlockView(APIView):
    """Adds addresses and numbers to block: a list in the body, or a CSV file (any cell that looks like one counts)."""
    permission_classes = ACCESS
    parser_classes = [JSONParser, MultiPartParser]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        upload = request.FILES.get("file")
        if upload is not None:
            if upload.size > 5 * 1024 * 1024:
                raise ValidationError({"file": "The file is larger than 5 MB."})
            values = suppressions.values_from_upload(upload.read())
            source = "IMPORT"
        else:
            values = request.data.get("values")
            if isinstance(values, str):
                values = [item for item in values.replace(";", ",").replace("\n", ",").split(",")]
            if not isinstance(values, list) or not values:
                raise ValidationError({"values": "Send the addresses or numbers to block as a list, or upload a CSV file."})
            source = "CSR"
        try:
            outcome = suppressions.block([str(item) for item in values], user=request.user, source=source, note=str(request.data.get("note") or "")[:200])
        except suppressions.SuppressionError as exc:
            raise ValidationError({"values": str(exc)}) from None
        return Response({**outcome, "source": source})
