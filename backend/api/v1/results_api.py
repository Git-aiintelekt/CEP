"""The Results API: campaign results for other systems (iCRM, a BI tool, a data warehouse). Read-only JSON, an API key
with the scope results:read, one workspace a key. Figures: apps/reporting/results.py.

    GET /results/campaigns/          every campaign that sent in the window, with its totals, held-back people and money
    GET /results/campaigns/<id>/     one campaign and its sends
    GET /results/runs/               every send in the window (a drip message, an occurrence, a journey's or e-receipt's run)

The window is sent_from .. sent_to (whole days in the workspace's time zone), no further back than results.WINDOW_DAYS;
left out, all of it. Nothing personal is answered: no address, no number, no name.
"""
from datetime import date

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.utils.urls import replace_query_param
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.campaigns.models import Campaign
from apps.reporting import results
from apps.tenants import context

SCOPE = "results:read"
READ = [IsAuthenticated, SameTenant, HasPermissionCode.for_("results.read")]
PAGE_SIZE, MAX_PAGE_SIZE = 200, 500
CHANNELS = {choice for choice, _ in Campaign.Channel.choices}
TYPES = {choice for choice, _ in Campaign.CampaignType.choices}

WINDOW_PARAMETERS = [
    OpenApiParameter("sent_from", date, description=f"First day of the window (YYYY-MM-DD, the workspace's time zone). No earlier than {results.WINDOW_DAYS} days ago; left out, {results.WINDOW_DAYS} days ago."),
    OpenApiParameter("sent_to", date, description="Last day of the window. Left out, today."),
]
LIST_PARAMETERS = [
    *WINDOW_PARAMETERS,
    OpenApiParameter("channel", str, enum=sorted(CHANNELS)),
    OpenApiParameter("campaign_type", str, enum=sorted(TYPES)),
    OpenApiParameter("page_size", int, description=f"Rows a page: {PAGE_SIZE} unless given, at most {MAX_PAGE_SIZE}."),
    OpenApiParameter("offset", int, description="Set by the `next` address; a consumer follows `next` until it is null."),
]

COUNTS = ("audience", "held_back", "queued", "not_sent", "sent", "failed", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed", "replied")
RATES = ("delivery", "open", "click", "bounce", "unsubscribe")


def _figures() -> dict:
    """The fields of a campaign or a send, made anew for each schema: a serializer field belongs to one parent."""
    return {
        "counts": inline_serializer("ResultCounts", {name: serializers.IntegerField() for name in COUNTS}),
        "rates": inline_serializer("ResultRates", {name: serializers.FloatField(help_text="A percentage with one decimal.") for name in RATES}),
        "held_back": serializers.DictField(child=serializers.IntegerField(), help_text="People the audience rules left out before a message was made, by reason (NO_CONSENT, UNSUBSCRIBED, FREQUENCY_CAP ...)."),
        "first_sent_at": serializers.DateTimeField(allow_null=True), "last_sent_at": serializers.DateTimeField(allow_null=True),
        "last_activity_at": serializers.DateTimeField(allow_null=True, help_text="The latest delivery, open, click, reply or unsubscribe counted here."),
    }


def _run(**kwargs):
    return inline_serializer("ResultRun", {
        "id": serializers.UUIDField(), "campaign_id": serializers.UUIDField(), "campaign_code": serializers.CharField(), "channel": serializers.CharField(),
        "campaign_type": serializers.CharField(), "run_number": serializers.IntegerField(), "run_type": serializers.CharField(), "status": serializers.CharField(),
        "label": serializers.CharField(allow_null=True), "scheduled_at": serializers.DateTimeField(allow_null=True), "started_at": serializers.DateTimeField(allow_null=True),
        "completed_at": serializers.DateTimeField(allow_null=True), **_figures()}, **kwargs)


def _campaign_fields() -> dict:
    return {
        "id": serializers.UUIDField(), "code": serializers.CharField(), "name": serializers.CharField(), "campaign_type": serializers.CharField(), "channel": serializers.CharField(),
        "status": serializers.CharField(), "journey_id": serializers.UUIDField(allow_null=True), **_figures(),
        "money": inline_serializer("ResultMoney", {
            "currency": serializers.CharField(allow_null=True), "revenue": serializers.FloatField(allow_null=True), "orders": serializers.IntegerField(allow_null=True),
            "conversions": serializers.IntegerField(allow_null=True), "message_cost": serializers.FloatField(allow_null=True), "offer_cost": serializers.FloatField(allow_null=True),
            "contribution": serializers.FloatField(allow_null=True), "roi": serializers.FloatField(allow_null=True), "computed_at": serializers.DateTimeField()}, allow_null=True)}


def _window():
    return inline_serializer("ResultWindow", {"sent_from": serializers.DateField(), "sent_to": serializers.DateField(), "timezone": serializers.CharField(),
                                              "days_kept": serializers.IntegerField()})


def _page_of(name: str, rows) -> serializers.Serializer:
    return inline_serializer(name, {"as_of": serializers.DateTimeField(), "window": _window(), "count": serializers.IntegerField(),
                                    "next": serializers.URLField(allow_null=True), "results": rows})


def _day(params, name: str) -> date | None:
    raw = (params.get(name) or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({name: "A date as YYYY-MM-DD."}) from None


def _collect(request) -> dict:
    try:
        return results.collect(context.require().tenant_id, _day(request.query_params, "sent_from"), _day(request.query_params, "sent_to"))
    except results.ResultsError as exc:
        raise ValidationError({exc.field: str(exc)}) from None


def _choice(params, name: str, allowed: set) -> str | None:
    value = (params.get(name) or "").strip().upper()
    if value and value not in allowed:
        raise ValidationError({name: f"One of {', '.join(sorted(allowed))}."})
    return value or None


def _whole(params, name: str, default: int, most: int | None = None) -> int:
    raw = (params.get(name) or "").strip()
    if not raw:
        return default
    if not raw.isdigit() or (name == "page_size" and int(raw) == 0):
        raise ValidationError({name: "A whole number."})
    return min(int(raw), most) if most else int(raw)


def _page(request, found: dict, rows: list) -> Response:
    size, offset = _whole(request.query_params, "page_size", PAGE_SIZE, MAX_PAGE_SIZE), _whole(request.query_params, "offset", 0)
    more = replace_query_param(request.build_absolute_uri(), "offset", offset + size) if offset + size < len(rows) else None
    return Response({"as_of": found["as_of"], "window": found["window"], "count": len(rows), "next": more,
                     "results": rows[offset:offset + size]})


def _filtered(request, rows: list) -> list:
    channel, kind = _choice(request.query_params, "channel", CHANNELS), _choice(request.query_params, "campaign_type", TYPES)
    return [row for row in rows if (not channel or row["channel"] == channel) and (not kind or row["campaign_type"] == kind)]


class ResultsCampaignsView(APIView):
    """Every campaign that sent a message, or held someone back, in the window: regular, drip, journey, e-receipt and
    warm-up campaigns alike, the latest first. A campaign that never ends is counted over the window, not its whole life."""
    permission_classes = READ

    @extend_schema(operation_id="results_campaigns_list", tags=["Results"], parameters=LIST_PARAMETERS, responses=_page_of("ResultCampaignPage", inline_serializer("ResultCampaign", _campaign_fields(), many=True)))
    def get(self, request, version=None):
        found = _collect(request)
        return _page(request, found, _filtered(request, found["campaigns"]))


class ResultsCampaignView(APIView):
    """One campaign in the window, with each of its sends. 404 when it sent nothing in the window."""
    permission_classes = READ

    @extend_schema(operation_id="results_campaign", tags=["Results"], parameters=WINDOW_PARAMETERS, responses=inline_serializer("ResultCampaignDetail", {
        "as_of": serializers.DateTimeField(), "window": _window(), **_campaign_fields(), "runs": _run(many=True)}))
    def get(self, request, pk=None, version=None):
        found = _collect(request)
        campaign = next((row for row in found["campaigns"] if row["id"] == str(pk)), None)
        if campaign is None:
            raise NotFound(f"No campaign with this id sent anything in the window ({found['window']['sent_from']} to {found['window']['sent_to']}).")
        return Response({"as_of": found["as_of"], "window": found["window"], **campaign, "runs": [run for run in found["runs"] if run["campaign_id"] == str(pk)]})


class ResultsRunsView(APIView):
    """Every send in the window, the latest first: one drip message, one occurrence of a recurring campaign, the single
    run of a one-time campaign. ?campaign=<id> keeps one campaign's."""
    permission_classes = READ

    @extend_schema(operation_id="results_runs_list", tags=["Results"], parameters=[*LIST_PARAMETERS, OpenApiParameter("campaign", str, description="A campaign's id: only its sends.")],
                   responses=_page_of("ResultRunPage", _run(many=True)))
    def get(self, request, version=None):
        found = _collect(request)
        campaign = (request.query_params.get("campaign") or "").strip().lower()
        rows = _filtered(request, found["runs"])
        return _page(request, found, [row for row in rows if row["campaign_id"] == campaign] if campaign else rows)
