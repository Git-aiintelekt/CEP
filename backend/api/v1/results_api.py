"""The Results API: campaign results for other systems (iCRM, a BI tool, a data warehouse). Read-only, an API key with
the scope results:read, one workspace a key. Figures: apps/reporting/results.py; per-recipient rows:
apps/reporting/result_rows.py.

Each endpoint is an integration of the workspace (Settings -> Integrations: Results: Campaigns, Results: Sends,
Results: Recipients, Results: Suppressions): its own calls-per-minute limit, a pause switch, and every call in the log with the key that made
it. A person's session is never enough, whatever their role: only a key of this workspace with the scope reads results.

    GET /results/campaigns/          every campaign that sent in the window, with its totals, held-back people and money
    GET /results/campaigns/<id>/     one campaign and its sends
    GET /results/runs/               every send in the window (a drip message, an occurrence, a journey's or e-receipt's run)
    GET /results/messages/           one row a recipient a send, and one a person held back: by send day, or what changed since
    GET /results/suppressions/       who must not be contacted (unsubscribed, replied STOP, a blocked address), by party ID: whole, or what changed since

The totals' window is sent_from .. sent_to (whole days in the workspace's time zone): no further back than
results.KEEP_MONTHS, at most results.SPAN_DAYS days a call; left out, the latest of them. Recipient rows go back
result_rows.KEEP_DAYS days. Nothing personal is answered: a customer is a party ID, never an address, a number or a name.

The lists answer JSON, or CSV with ?format=csv (the same rows, one header line; the next page's address is in the Link
header, as it is for JSON).
"""
import csv
import io
import json
import uuid
from datetime import date, datetime

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound, Throttled, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.utils.encoders import JSONEncoder
from rest_framework.utils.urls import replace_query_param
from rest_framework.views import APIView

from apps.campaigns.models import Campaign
from apps.integrations.bridge import logbook
from apps.integrations.bridge.inbound import InboundLogMixin
from apps.reporting import result_rows, result_suppressions, results
from apps.tenants import context

SCOPE = logbook.RESULTS_SCOPE
BUSY_RETRY_SECONDS, SLOW_RETRY_SECONDS = 2, 60
PAGE_SIZE, MAX_PAGE_SIZE = 200, 500
CHANNELS = {choice for choice, _ in Campaign.Channel.choices}
TYPES = {choice for choice, _ in Campaign.CampaignType.choices}

FORMAT_PARAMETER = OpenApiParameter("format", str, enum=["json", "csv"], description="json unless given. csv: the same rows with one header line; the next page is in the Link header.")
WINDOW_PARAMETERS = [
    OpenApiParameter("sent_from", date, description=f"First day of the window (YYYY-MM-DD, the workspace's time zone). No earlier than {results.KEEP_MONTHS} months ago. "
                                                    f"Left out, {results.SPAN_DAYS} days up to sent_to."),
    OpenApiParameter("sent_to", date, description=f"Last day of the window, at most {results.SPAN_DAYS} days from sent_from. Left out, {results.SPAN_DAYS} days from sent_from, or today."),
]
LIST_PARAMETERS = [
    *WINDOW_PARAMETERS,
    OpenApiParameter("channel", str, enum=sorted(CHANNELS)),
    OpenApiParameter("campaign_type", str, enum=sorted(TYPES)),
    OpenApiParameter("page_size", int, description=f"Rows a page: {PAGE_SIZE} unless given, at most {MAX_PAGE_SIZE}."),
    OpenApiParameter("offset", int, description="Set by the `next` address; a consumer follows `next` until it is null."),
    FORMAT_PARAMETER,
]
MESSAGE_PARAMETERS = [
    OpenApiParameter("sent_from", date, description=f"Read by send day: the first day (YYYY-MM-DD, the workspace's time zone), no earlier than {result_rows.KEEP_DAYS} days ago."),
    OpenApiParameter("sent_to", date, description=f"Read by send day: the last day, at most {results.SPAN_DAYS} days from sent_from."),
    OpenApiParameter("changed_since", datetime, description="Read by change instead: the rows whose result moved since this moment (ISO 8601 with its zone, e.g. 2026-11-26T08:00:00Z). "
                                                            "Pass the `as_of` of the previous read. Not together with sent_from or sent_to."),
    OpenApiParameter("campaign", str, description="A campaign's id: only its rows."),
    OpenApiParameter("run", str, description="A send's id: only its rows."),
    OpenApiParameter("channel", str, enum=list(result_rows.CHANNELS)),
    OpenApiParameter("status", str, enum=list(result_rows.STATUSES)),
    OpenApiParameter("page_size", int, description=f"Rows a page: {result_rows.PAGE} unless given, at most {result_rows.MAX_PAGE}."),
    OpenApiParameter("cursor", str, description="Set by the `next` address; a consumer follows `next` until it is null."),
    FORMAT_PARAMETER,
]

SUPPRESSION_PARAMETERS = [
    OpenApiParameter("changed_since", datetime, description="Only the rows that changed since this moment (ISO 8601 with its zone), a lifted one with `active` false. "
                                                            "Pass the `as_of` of the previous read. Left out: every row that holds now."),
    OpenApiParameter("channel", str, enum=list(result_suppressions.CHANNELS), description="PHONE: blocked numbers only."),
    OpenApiParameter("origin", str, enum=["cep", "all"], description="cep (unless given): what CEP learned first. all: also what the customer system itself sent CEP."),
    OpenApiParameter("page_size", int, description=f"Rows a page: {result_suppressions.PAGE} unless given, at most {result_suppressions.MAX_PAGE}."),
    OpenApiParameter("cursor", str, description="Set by the `next` address; a consumer follows `next` until it is null."),
    FORMAT_PARAMETER,
]

COUNTS = ("audience", "held_back", "queued", "not_sent", "sent", "failed", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed", "replied")
RATES = ("delivery", "open", "click", "bounce", "unsubscribe")
MONEY = ("currency", "revenue", "orders", "conversions", "message_cost", "offer_cost", "contribution", "roi", "computed_at")
FIGURE_COLUMNS = (*(f"counts_{name}" for name in COUNTS), *(f"rates_{name}" for name in RATES), "held_back_reasons", "first_sent_at", "last_sent_at", "last_activity_at")
CAMPAIGN_COLUMNS = ("id", "code", "name", "campaign_type", "channel", "status", "journey_id", *FIGURE_COLUMNS, *(f"money_{name}" for name in MONEY))
RUN_COLUMNS = ("id", "campaign_id", "campaign_code", "channel", "campaign_type", "run_number", "run_type", "status", "label", "scheduled_at", "started_at", "completed_at",
               *FIGURE_COLUMNS)


# ---------------------------------------------------------------------------------------------------- what an answer looks like
def _shape(name: str, fields: dict) -> type[serializers.Serializer]:
    """For the OpenAPI document only: each made once, so its name describes one component."""
    return type(name, (serializers.Serializer,), fields)


def _figures() -> dict:
    return {
        "counts": ResultCounts(), "rates": ResultRates(),
        "held_back": serializers.DictField(child=serializers.IntegerField(), help_text="People the audience rules left out before a message was made, by reason (NO_CONSENT, UNSUBSCRIBED, FREQUENCY_CAP ...)."),
        "first_sent_at": serializers.DateTimeField(allow_null=True), "last_sent_at": serializers.DateTimeField(allow_null=True),
        "last_activity_at": serializers.DateTimeField(allow_null=True, help_text="The latest delivery, open, click, reply or unsubscribe counted here."),
    }


def _campaign() -> dict:
    return {"id": serializers.UUIDField(), "code": serializers.CharField(), "name": serializers.CharField(), "campaign_type": serializers.CharField(),
            "channel": serializers.CharField(), "status": serializers.CharField(), "journey_id": serializers.UUIDField(allow_null=True), **_figures(),
            "money": ResultMoney(allow_null=True)}


def _envelope() -> dict:
    return {"as_of": serializers.DateTimeField(), "window": ResultWindow(), "count": serializers.IntegerField(), "next": serializers.URLField(allow_null=True)}


ResultCounts = _shape("ResultCounts", {name: serializers.IntegerField() for name in COUNTS})
ResultRates = _shape("ResultRates", {name: serializers.FloatField(help_text="A percentage with one decimal.") for name in RATES})
ResultMoney = _shape("ResultMoney", {
    "currency": serializers.CharField(allow_null=True), "revenue": serializers.FloatField(allow_null=True), "orders": serializers.IntegerField(allow_null=True),
    "conversions": serializers.IntegerField(allow_null=True), "message_cost": serializers.FloatField(allow_null=True), "offer_cost": serializers.FloatField(allow_null=True),
    "contribution": serializers.FloatField(allow_null=True), "roi": serializers.FloatField(allow_null=True), "computed_at": serializers.DateTimeField()})
ResultWindow = _shape("ResultWindow", {
    "sent_from": serializers.DateField(), "sent_to": serializers.DateField(), "timezone": serializers.CharField(),
    "earliest": serializers.DateField(help_text="The first day that may be read."), "max_days": serializers.IntegerField(help_text="The most days one call may cover.")})
ResultRun = _shape("ResultRun", {
    "id": serializers.UUIDField(), "campaign_id": serializers.UUIDField(), "campaign_code": serializers.CharField(), "channel": serializers.CharField(),
    "campaign_type": serializers.CharField(), "run_number": serializers.IntegerField(), "run_type": serializers.CharField(), "status": serializers.CharField(),
    "label": serializers.CharField(allow_null=True), "scheduled_at": serializers.DateTimeField(allow_null=True), "started_at": serializers.DateTimeField(allow_null=True),
    "completed_at": serializers.DateTimeField(allow_null=True), **_figures()})
ResultCampaign = _shape("ResultCampaign", _campaign())
ResultCampaignDetail = _shape("ResultCampaignDetail", {"as_of": serializers.DateTimeField(), "window": ResultWindow(), **_campaign(), "runs": ResultRun(many=True)})
ResultCampaignPage = _shape("ResultCampaignPage", {**_envelope(), "results": ResultCampaign(many=True)})
ResultRunPage = _shape("ResultRunPage", {**_envelope(), "results": ResultRun(many=True)})
ResultRecipient = _shape("ResultRecipient", {
    "id": serializers.CharField(help_text="The row's own identifier, stable: E-… an email, T-… a text or WhatsApp message, H-… a person held back."),
    "campaign_id": serializers.UUIDField(), "campaign_code": serializers.CharField(), "run_id": serializers.UUIDField(allow_null=True), "channel": serializers.CharField(),
    "party_id": serializers.CharField(), "status": serializers.ChoiceField(choices=result_rows.STATUSES),
    "reason": serializers.CharField(allow_null=True, help_text="Why a message failed, bounced or was not sent, or why a person was held back. Addresses and numbers in it are masked."),
    **{name: serializers.DateTimeField(allow_null=True) for name in ("sent_at", "delivered_at", "opened_at", "clicked_at", "bounced_at")},
    "bounce_type": serializers.CharField(allow_null=True),
    **{name: serializers.DateTimeField(allow_null=True) for name in ("complained_at", "unsubscribed_at", "replied_at", "failed_at")},
    "variant": serializers.CharField(allow_null=True), "changed_at": serializers.DateTimeField()})
ResultRecipientPage = _shape("ResultRecipientPage", {
    "as_of": serializers.DateTimeField(help_text="Pass it as changed_since on the next read by change."), "window": ResultWindow(required=False),
    "changed_since": serializers.DateTimeField(required=False), "next": serializers.URLField(allow_null=True), "results": ResultRecipient(many=True)})


ResultSuppression = _shape("ResultSuppression", {
    "id": serializers.CharField(help_text="The row's own identifier, stable: C-… what the person decided, B-… a blocked address or number."),
    "party_id": serializers.CharField(), "channel": serializers.ChoiceField(choices=result_suppressions.CHANNELS),
    "reason": serializers.CharField(help_text="UNSUBSCRIBED, OPTED_OUT (a STOP reply), SUPPRESSED, HARD_BOUNCE, SOFT_BOUNCE_THRESHOLD, INVALID, COMPLAINT, MANUAL, GLOBAL_SUPPRESSION_LIST, DND_REGISTRY."),
    "source": serializers.CharField(allow_null=True, help_text="How it came about: UNSUBSCRIBE_LINK, SMS_STOP, PREFERENCE_CENTER, CSR, IMPORT, the sending engine's name ..."),
    "campaign_id": serializers.UUIDField(allow_null=True, help_text="The campaign whose message the person unsubscribed through, where one is known."),
    "since": serializers.DateTimeField(), "active": serializers.BooleanField(help_text="False: it was lifted. Only a read by change answers lifted rows."),
    "changed_at": serializers.DateTimeField()})
ResultSuppressionPage = _shape("ResultSuppressionPage", {
    "as_of": serializers.DateTimeField(help_text="Pass it as changed_since on the next read."), "changed_since": serializers.DateTimeField(required=False),
    "left_out": _shape("ResultSuppressionLeftOut", {"without_party_id": serializers.IntegerField(help_text="Blocked addresses with no customer behind them: they cannot be answered.")})(required=False),
    "next": serializers.URLField(allow_null=True), "results": ResultSuppression(many=True)})


# ---------------------------------------------------------------------------------------------------- CSV
def _cell(value):
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return JSONEncoder().default(value)
    if isinstance(value, str) and value[:1] in "=+-@":
        return "'" + value                                  # a spreadsheet must never read a value as a formula
    return value


def _flat(row: dict) -> dict:
    """A row with its nested figures side by side: counts_sent, rates_open, money_revenue, and the held-back reasons in one cell."""
    flat = {}
    for key, value in row.items():
        if key == "held_back":
            flat["held_back_reasons"] = ";".join(f"{reason}={count}" for reason, count in (value or {}).items())
        elif key in ("counts", "rates", "money"):
            for name in {"counts": COUNTS, "rates": RATES, "money": MONEY}[key]:
                flat[f"{key}_{name}"] = (value or {}).get(name)
        else:
            flat[key] = value
    return flat


class ResultsCSV(BaseRenderer):
    """A list's rows as CSV, the columns the view names (`csv_columns`). Anything else (a refusal) stays a problem document."""
    media_type = "text/csv"
    format = "csv"
    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        about = renderer_context or {}
        columns = getattr(about.get("view"), "csv_columns", None)
        if not isinstance(data, dict) or "results" not in data or not columns:
            if about.get("response") is not None:
                about["response"]["Content-Type"] = "application/problem+json"
            return json.dumps(data, cls=JSONEncoder).encode()
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(columns)
        for row in data["results"]:
            flat = _flat(row)
            writer.writerow([_cell(flat.get(column)) for column in columns])
        return out.getvalue().encode()


# ---------------------------------------------------------------------------------------------------- who may read, and how
class ResultsKey(BasePermission):
    """An API key made in this workspace, holding results:read. Row-level security already hides a key from every other
    workspace; the workspace is compared here as well, so the rule does not rest on one mechanism."""
    message = "Results are read with an API key of this workspace that has the scope results:read."

    def has_permission(self, request, view):
        key, ctx = request.user, context.current()
        return bool(hasattr(key, "has_scope") and ctx is not None and str(getattr(key, "tenant_id", "")) == str(ctx.tenant_id) and key.has_scope(SCOPE))


class ResultsTookTooLong(APIException):
    status_code = 504
    default_detail = "The results took too long to work out and the read was stopped. Ask for fewer days, or try again later."
    default_code = "results_too_slow"


class ResultsView(InboundLogMixin, APIView):
    """A Results endpoint: its own integration record (limit, pause, log), a key of this workspace, and an answer no
    proxy or browser may keep. A list's next page is in the Link header too, whatever the format."""
    permission_classes = [IsAuthenticated, ResultsKey]
    integration_system = logbook.RESULTS_SYSTEM

    @property
    def integration_per_minute(self) -> int:
        return logbook.RESULTS[self.integration_kind]["per_minute"]

    def integration_record(self, tenant_id):
        return logbook.results_integration(tenant_id, self.integration_kind)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        if response.status_code == ResultsTookTooLong.status_code:
            response["Retry-After"] = str(SLOW_RETRY_SECONDS)
        data = getattr(response, "data", None)
        if isinstance(data, dict) and "results" in data:
            response["X-As-Of"] = JSONEncoder().default(data["as_of"])
            if data.get("next"):
                response["Link"] = f'<{data["next"]}>; rel="next"'
        return response


class ResultsListView(ResultsView):
    renderer_classes = [JSONRenderer, ResultsCSV]


def _guarded(read):
    """A read's refusals in the API's words: a parameter at fault, a workspace already reading, a query stopped."""
    try:
        return read()
    except results.ResultsError as exc:
        raise ValidationError({exc.field: str(exc)}) from None
    except results.Busy:
        raise Throttled(wait=BUSY_RETRY_SECONDS, detail="Another read of this workspace's results is being worked out.") from None
    except results.TooSlow:
        raise ResultsTookTooLong() from None


def _day(params, name: str) -> date | None:
    raw = (params.get(name) or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({name: "A date as YYYY-MM-DD."}) from None


def _moment(params, name: str) -> datetime | None:
    raw = (params.get(name) or "").strip().replace(" ", "+")       # a + that was not escaped in the address arrives as a space
    if not raw:
        return None
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        moment = None
    if moment is None or moment.tzinfo is None:
        raise ValidationError({name: "A moment with its time zone, as 2026-11-26T08:00:00Z."})
    return moment


def _id(params, name: str) -> str | None:
    raw = (params.get(name) or "").strip()
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw))
    except ValueError:
        raise ValidationError({name: "An id as CEP gave it."}) from None


def _choice(params, name: str, allowed) -> str | None:
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


def _collect(request) -> dict:
    return _guarded(lambda: results.collect(context.require().tenant_id, _day(request.query_params, "sent_from"), _day(request.query_params, "sent_to")))


def _page(request, found: dict, rows: list) -> Response:
    size, offset = _whole(request.query_params, "page_size", PAGE_SIZE, MAX_PAGE_SIZE), _whole(request.query_params, "offset", 0)
    more = replace_query_param(request.build_absolute_uri(), "offset", offset + size) if offset + size < len(rows) else None
    return Response({"as_of": found["as_of"], "window": found["window"], "count": len(rows), "next": more,
                     "results": rows[offset:offset + size]})


def _filtered(request, rows: list) -> list:
    channel, kind = _choice(request.query_params, "channel", CHANNELS), _choice(request.query_params, "campaign_type", TYPES)
    return [row for row in rows if (not channel or row["channel"] == channel) and (not kind or row["campaign_type"] == kind)]


# ---------------------------------------------------------------------------------------------------- the endpoints
class ResultsCampaignsView(ResultsListView):
    """Every campaign that sent a message, or held someone back, in the window: regular, drip, journey, e-receipt and
    warm-up campaigns alike, the latest first. A campaign that never ends is counted over the window, not its whole life."""
    integration_kind = "RESULTS_CAMPAIGNS"
    csv_columns = CAMPAIGN_COLUMNS

    @extend_schema(operation_id="results_campaigns_list", tags=["Results"], parameters=LIST_PARAMETERS, responses=ResultCampaignPage)
    def get(self, request, version=None):
        found = _collect(request)
        return _page(request, found, _filtered(request, found["campaigns"]))


class ResultsCampaignView(ResultsView):
    """One campaign in the window, with each of its sends. 404 when it sent nothing in the window. Counted with the
    campaigns list: one limit, one pause switch."""
    integration_kind = "RESULTS_CAMPAIGNS"

    def integration_ref(self, request, body):
        return f"campaign:{self.kwargs.get('pk')}"

    @extend_schema(operation_id="results_campaign", tags=["Results"], parameters=WINDOW_PARAMETERS, responses=ResultCampaignDetail)
    def get(self, request, pk=None, version=None):
        found = _collect(request)
        campaign = next((row for row in found["campaigns"] if row["id"] == str(pk)), None)
        if campaign is None:
            raise NotFound(f"No campaign with this id sent anything in the window ({found['window']['sent_from']} to {found['window']['sent_to']}).")
        return Response({"as_of": found["as_of"], "window": found["window"], **campaign, "runs": [run for run in found["runs"] if run["campaign_id"] == str(pk)]})


class ResultsRunsView(ResultsListView):
    """Every send in the window, the latest first: one drip message, one occurrence of a recurring campaign, the single
    run of a one-time campaign. ?campaign=<id> keeps one campaign's."""
    integration_kind = "RESULTS_RUNS"
    csv_columns = RUN_COLUMNS

    @extend_schema(operation_id="results_runs_list", tags=["Results"], parameters=[*LIST_PARAMETERS, OpenApiParameter("campaign", str, description="A campaign's id: only its sends.")],
                   responses=ResultRunPage)
    def get(self, request, version=None):
        found = _collect(request)
        campaign = (request.query_params.get("campaign") or "").strip().lower()
        rows = _filtered(request, found["runs"])
        return _page(request, found, [row for row in rows if row["campaign_id"] == campaign] if campaign else rows)


class ResultsMessagesView(ResultsListView):
    """One row a recipient a send, and one a person a send held back, each naming the customer by party ID. Read by send
    day (sent_from, sent_to) for a first load, or by change (changed_since = the last read's as_of) to collect only what
    moved. A page at a time: follow `next`."""
    integration_kind = "RESULTS_MESSAGES"
    csv_columns = result_rows.FIELDS

    def integration_ref(self, request, body):
        campaign = request.GET.get("campaign") or request.GET.get("run")
        return f"rows:{campaign[:60]}" if campaign else None

    @extend_schema(operation_id="results_messages_list", tags=["Results"], parameters=MESSAGE_PARAMETERS, responses=ResultRecipientPage)
    def get(self, request, version=None):
        asked = request.query_params
        found = _guarded(lambda: result_rows.read(
            context.require().tenant_id, sent_from=_day(asked, "sent_from"), sent_to=_day(asked, "sent_to"), changed_since=_moment(asked, "changed_since"),
            campaign=_id(asked, "campaign"), run=_id(asked, "run"), channel=_choice(asked, "channel", result_rows.CHANNELS),
            status=_choice(asked, "status", result_rows.STATUSES), page_size=_whole(asked, "page_size", result_rows.PAGE, result_rows.MAX_PAGE),
            cursor=(asked.get("cursor") or "").strip() or None))
        cursor, rows = found.pop("next_cursor"), found.pop("results")
        return Response({**found, "next": replace_query_param(request.build_absolute_uri(), "cursor", cursor) if cursor else None, "results": rows})


class ResultsSuppressionsView(ResultsListView):
    """Who must not be contacted, by party ID: everyone who unsubscribed or replied STOP, and every customer whose address
    or number is blocked. Whole, or (changed_since = the last read's as_of) only what changed, a lifted row with `active`
    false. A page at a time: follow `next`."""
    integration_kind = "RESULTS_SUPPRESSIONS"
    csv_columns = result_suppressions.FIELDS

    @extend_schema(operation_id="results_suppressions_list", tags=["Results"], parameters=SUPPRESSION_PARAMETERS, responses=ResultSuppressionPage)
    def get(self, request, version=None):
        asked = request.query_params
        found = _guarded(lambda: result_suppressions.read(
            context.require().tenant_id, changed_since=_moment(asked, "changed_since"), channel=_choice(asked, "channel", result_suppressions.CHANNELS),
            origin=_choice(asked, "origin", result_suppressions.ORIGINS) or "CEP", page_size=_whole(asked, "page_size", result_suppressions.PAGE, result_suppressions.MAX_PAGE),
            cursor=(asked.get("cursor") or "").strip() or None))
        cursor, rows = found.pop("next_cursor"), found.pop("results")
        return Response({**found, "next": replace_query_param(request.build_absolute_uri(), "cursor", cursor) if cursor else None, "results": rows})
