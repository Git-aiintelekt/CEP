"""Journey module API. Extends the plain journey CRUD that was already there.

    GET    /journeys/                          POST /journeys/ {name, population_mode, ..., starter?}: creates version 1
                                               (the starter's graph, or a lone Start step); code is generated when blank.
                                               Each row also carries computed channels/trigger_family/needs_attention/
                                               step_count/step_types/entry_rule; the page also carries total
                                               (every live journey, unfiltered)
                                               (apps/journeys/listing.py, phase 6c's List page); list accepts
                                               ?channel=EMAIL|SMS|MMS &trigger_family=... &needs_attention=true on top
                                               of the usual ?status= &search=
    GET    /journeys/stats/                    the List page's former 4 stat cards (apps/journeys/listing.py; the page no
                                               longer calls it since 2026-10-05)
    GET    /journeys/{id}/versions/            every version, newest first
    POST   /journeys/{id}/versions/            {from_version?}: a new DRAFT copied from that version (default: the newest)
    GET    /journeys/{id}/versions/{n}/        the version with its graph        DELETE: a draft that is not version 1
    PUT    /journeys/{id}/versions/{n}/graph/  {row_version, graph}: the whole graph of a DRAFT version at once (apps/journeys/graph.py)
    GET    /journeys/{id}/performance/         ?date_from= &date_to=  the rollup row and per-step counts (journey_*_analytical)
    GET    /journeys/{id}/executions/          ?node_id= &outcome= &party_id= &date_from= &date_to=  the fact rows, newest first
    GET    /journey-starters/                  the starter gallery (the same set for every tenant), with category, goal,
                                               step_count and channels per starter
    GET    /journey-templates/                 (unused by the UI since 2026-10-05, when Save as Template was dropped)
                                               the workspace's saved templates (?category= &search=), each with used_count,
                                               created_by_name, step_count and channels
    POST   /journey-templates/                 {journey_id, version_number, name, category, description}: snapshots that
                                               version's graph and the journey's setup and goal
    PATCH  /journey-templates/{id}/            {row_version, name?, description?, category?}: 409 when row_version is stale
    DELETE /journey-templates/{id}/            soft delete; journeys made from it keep working
    POST /journeys/ also takes template (a saved template's id) in place of starter; either one sets the new journey's
    source_template / source_starter_key, and source_name on the read says which ("From {name}" on the canvas).

    GET    /journeys/{id}/versions/{n}/readiness/     the 4 Test Publish checks (apps/journeys/publish.py)
    POST   /journeys/{id}/versions/{n}/test-publish/  {population}: a real, synchronous send to the chosen test population
    POST   /journeys/{id}/versions/{n}/approve/       {schedule_at?}: activate now, or schedule (journey.activate)

    POST   /journeys/{id}/pause/            Active -> Paused (journey.activate)
    POST   /journeys/{id}/resume/           Paused -> Active (journey.activate)
    POST   /journeys/{id}/duplicate/        clones the journey + its current version's graph as a new DRAFT journey
    GET    /journeys/{id}/audience/         Journey Details' Setup card: source lists, eligible pool, enrollment rate
    GET    /journeys/{id}/enrollment-trend/ 6 weekly buckets of Enrolled / Goal Converted / Exited Early
    GET    /journeys/{id}/campaigns/        the Generated Campaigns table: one row per JourneyGeneratedCampaign
    GET    /journeys/{id}/activity/         a derived timeline from version history and the journey's own status
                                            (all five, apps/journeys/details.py and apps/journeys/lifecycle.py, phase 6d)

Needs journey.edit and the workspace's journeys feature; approve/pause/resume additionally need journey.activate.
"""
import uuid
from datetime import date, datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.journeys import details, graph, lifecycle, listing, publish, starters
from apps.journeys.models import Journey, JourneyNode, JourneyTemplate, JourneyVersion
from apps.platform_ops import params
from apps.reporting.models import JourneyExecutionMasterAnalytical, JourneyMasterAnalytical
from apps.tenants import context

from . import serializers as s
from . import views

DEFAULT_WINDOW_DAYS = 30


def _user_id(request):
    return None if hasattr(request.user, "has_scope") else request.user.id


class JourneySerializer(s.JourneySerializer):
    code = serializers.CharField(max_length=40, required=False, allow_blank=True,
                                 help_text="Business key, e.g. JRN-2026-00007. Generated when left blank.")
    population_mode = serializers.ChoiceField(choices=Journey.PopulationMode.choices, required=False,
                                              help_text="required unless a starter supplies it")
    starter = serializers.CharField(write_only=True, required=False, allow_blank=True,
                                    help_text="on create: key from /journey-starters/; its graph becomes version 1")
    template = serializers.UUIDField(write_only=True, required=False, allow_null=True,
                                     help_text="on create: id from /journey-templates/; its graph becomes version 1 (never with starter)")
    source_name = serializers.SerializerMethodField(help_text="the saved template's or starter's name this journey was made from")
    latest_version = serializers.IntegerField(read_only=True, default=None)
    owner_user_name = serializers.SerializerMethodField(help_text="owner_user's display name, falling back to email")
    # computed for the List page (apps.journeys.listing): not stored, filled in bulk per page by JourneyViewSet.list/retrieve,
    # from self.context['journey_row_info'] — absent (serializing outside that context) means "not computed", not "empty".
    channels = serializers.SerializerMethodField(help_text="EMAIL/SMS/MMS node types on the journey's newest version")
    trigger_family = serializers.SerializerMethodField(help_text="CUSTOMER_LIFECYCLE / SEGMENT_LOYALTY / COMMERCE_OFFER / ENGAGEMENT")
    trigger_family_label = serializers.SerializerMethodField()
    needs_attention = serializers.SerializerMethodField(help_text="most recent generated campaign run FAILED in the last 7 days")
    step_count = serializers.SerializerMethodField(help_text="every step after the entry trigger on the journey's newest version")
    step_types = serializers.SerializerMethodField(help_text="those steps' node types in canvas order (trunk, YES branch, NO branch)")
    entry_rule = serializers.SerializerMethodField(help_text="{entry_type, rule_definition} of that version's first entry rule, or null")

    class Meta(s.JourneySerializer.Meta):
        read_only_fields = s.JourneySerializer.Meta.read_only_fields + ("source_template", "source_starter_key")

    def get_source_name(self, journey) -> str | None:
        if journey.source_template_id:
            return journey.source_template.name
        starter = starters.BY_KEY.get(journey.source_starter_key or "")
        return starter["name"] if starter else None

    def get_owner_user_name(self, journey) -> str | None:
        user = journey.owner_user
        return (user.display_name or user.email) if user else None

    def _row_info(self, journey) -> dict:
        info = self.context.get("journey_row_info")
        return info.get(str(journey.pk), {}) if info else {}

    def get_channels(self, journey) -> list[str]:
        return self._row_info(journey).get("channels", [])

    def get_trigger_family(self, journey) -> str | None:
        return self._row_info(journey).get("trigger_family")

    def get_trigger_family_label(self, journey) -> str | None:
        family = self._row_info(journey).get("trigger_family")
        return listing.FAMILY_LABEL.get(family) if family else None

    def get_needs_attention(self, journey) -> bool:
        return bool(self._row_info(journey).get("needs_attention"))

    def get_step_count(self, journey) -> int:
        return self._row_info(journey).get("step_count", 0)

    def get_step_types(self, journey) -> list[str]:
        return self._row_info(journey).get("step_types", [])

    def get_entry_rule(self, journey) -> dict | None:
        return self._row_info(journey).get("entry_rule")

    def validate_name(self, value):
        value = value.strip()
        clash = Journey.objects.filter(tenant_id=context.require().tenant_id, name__iexact=value, deleted_at__isnull=True)  # == ux_journey_name_live
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Another journey already has this name.")
        return value

    def validate_code(self, value):
        value = value.strip().upper()
        if value and not s.CAMPAIGN_CODE_RE.match(value):                # same rule as ck_journey_code_format
            raise serializers.ValidationError("Use 3 to 40 capital letters, digits, - or _, starting with a letter or digit.")
        return value

    def validate(self, attrs):
        key = attrs.get("starter")
        template_id = attrs.get("template")
        if (key or template_id) and self.instance is not None:
            raise serializers.ValidationError({"starter": "A starter or template can only be chosen when the journey is created."})
        if key and template_id:
            raise serializers.ValidationError({"template": "Choose a starter or a saved template, not both."})
        if key and key not in starters.BY_KEY:
            raise serializers.ValidationError({"starter": "Unknown starter."})
        if template_id:
            template = JourneyTemplate.objects.filter(pk=template_id, tenant_id=context.require().tenant_id, deleted_at__isnull=True).first()
            if template is None:
                raise serializers.ValidationError({"template": "This template doesn't exist (any more)."})
            attrs["template"] = template
        if self.instance is None and not attrs.get("population_mode") and not key and not template_id:
            raise serializers.ValidationError({"population_mode": "This field is required."})
        return attrs

    @staticmethod
    def _next_code():
        prefix = f"JRN-{timezone.now():%Y}-"
        taken = set(Journey.objects.filter(code__startswith=prefix).values_list("code", flat=True))
        number = len(taken) + 1
        while f"{prefix}{number:05d}" in taken:
            number += 1
        return f"{prefix}{number:05d}"

    def create(self, validated_data):
        key = validated_data.pop("starter", "")
        template = validated_data.pop("template", None)
        starter = starters.BY_KEY.get(key, {})
        source = ({"population_mode": template.population_mode, "reentry_policy": template.reentry_policy,
                   "reentry_after_days": template.reentry_after_days, "goal_description": template.goal_description}
                  if template else {**starter, "goal_description": starter.get("goal")} if starter else {})
        for name in ("population_mode", "reentry_policy", "reentry_after_days", "goal_description"):
            if not validated_data.get(name) and source.get(name):
                validated_data[name] = source[name]
        if template:
            validated_data["source_template"] = template
        elif key:
            validated_data["source_starter_key"] = key
        generated = not validated_data.get("code")
        with transaction.atomic():
            for attempt in range(5):
                if generated:
                    validated_data["code"] = self._next_code()
                try:
                    with transaction.atomic():                     # savepoint: a code collision must not poison the transaction
                        journey = Journey.objects.create(**validated_data)
                    break
                except IntegrityError:
                    if not generated or attempt == 4:
                        raise serializers.ValidationError({"code": "Another journey already uses this code."}) from None
            user_id = validated_data.get("created_by_id")
            if template:
                graph.create_first(journey, user_id, template.graph)
            elif key:
                starters.apply(journey, user_id, key)
            else:
                graph.create_first(journey, user_id)
        journey.latest_version = 1
        return journey

    def update(self, instance, validated_data):
        validated_data.pop("starter", None)
        validated_data.pop("template", None)
        if "code" in validated_data and not validated_data["code"]:
            validated_data.pop("code")                             # blank on edit = keep the current code
        return super().update(instance, validated_data)


class JourneyVersionSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = JourneyVersion
        fields = ("id", "journey", "version_number", "status", "status_label", "published_at", "created_by", "created_at",
                  "updated_by", "updated_at", "row_version")
        read_only_fields = fields


class JourneyVersionDetailSerializer(JourneyVersionSerializer):
    graph = serializers.SerializerMethodField()

    class Meta(JourneyVersionSerializer.Meta):
        fields = JourneyVersionSerializer.Meta.fields + ("graph",)
        read_only_fields = fields

    def get_graph(self, version) -> dict:
        return graph.read(version)


class NewVersionSerializer(serializers.Serializer):
    from_version = serializers.IntegerField(required=False, min_value=1, help_text="version to copy; default the newest")


class GraphSaveSerializer(serializers.Serializer):
    row_version = serializers.IntegerField(help_text="the version's row_version when the canvas loaded it; 409 when stale")
    graph = serializers.JSONField(help_text="{entry_rules, nodes, connections}: see apps/journeys/graph.py")


class JourneyExecutionSerializer(serializers.ModelSerializer):
    class Meta:
        model = JourneyExecutionMasterAnalytical
        fields = ("id", "party_id", "journey", "node_id", "event_type", "campaign", "campaign_run", "channel", "outcome", "executed_at")
        read_only_fields = fields


class JourneyStarterSerializer(serializers.Serializer):
    key = serializers.CharField()
    name = serializers.CharField()
    category = serializers.CharField(help_text="LIFECYCLE / COMMERCE / LOYALTY / ENGAGEMENT")
    description = serializers.CharField()
    goal = serializers.CharField()
    step_count = serializers.IntegerField(help_text="every step after the entry trigger")
    channels = serializers.ListField(child=serializers.CharField())
    population_mode = serializers.CharField()
    reentry_policy = serializers.CharField()
    reentry_after_days = serializers.IntegerField(allow_null=True)
    graph = serializers.JSONField()


class TestPopulationSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=["RANDOM", "LIST"], default="RANDOM")
    sample_size = serializers.IntegerField(required=False, min_value=1, max_value=publish.MAX_TEST_POPULATION, default=50)
    contact_list_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)


class ReadinessItemSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    description = serializers.CharField()
    ok = serializers.BooleanField()


class ReadinessSerializer(serializers.Serializer):
    ready = serializers.BooleanField()
    items = ReadinessItemSerializer(many=True)


class ChannelResultSerializer(serializers.Serializer):
    sent = serializers.IntegerField()
    delivered = serializers.IntegerField()


class TestResultSerializer(serializers.Serializer):
    population_size = serializers.IntegerField()
    sent_to = serializers.IntegerField()
    delivered = serializers.IntegerField()
    opened = serializers.IntegerField()
    clicked = serializers.IntegerField()
    bounced = serializers.IntegerField()
    governance_flags = serializers.ListField(child=serializers.CharField())
    by_channel = serializers.DictField(child=ChannelResultSerializer(), help_text="EMAIL and/or SMS, only the channels the version's message steps use")


class ApproveSerializer(serializers.Serializer):
    schedule_at = serializers.DateTimeField(required=False, allow_null=True, default=None,
                                            help_text="omit or null to activate immediately; a future time to schedule it")


class ExecutionPagination(CursorPagination):
    page_size = 50
    max_page_size = 200
    page_size_query_param = "page_size"
    ordering = ("-executed_at", "-id")


def _window(request) -> tuple[datetime, datetime]:
    """[date_from 00:00, date_to + 1 day 00:00) in the server's zone; the last 30 days when not given."""
    def parse(name):
        value = request.query_params.get(name)
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise ValidationError({name: "Use a date like 2026-10-04."}) from None
    today = timezone.localdate()
    end = parse("date_to") or today
    start = parse("date_from") or end - timedelta(days=DEFAULT_WINDOW_DAYS - 1)
    if start > end:
        raise ValidationError({"date_from": "The start date is after the end date."})
    zone = timezone.get_current_timezone()
    return datetime.combine(start, time.min, zone), datetime.combine(end + timedelta(days=1), time.min, zone)


class JourneyStatsSerializer(serializers.Serializer):
    active_journeys = serializers.IntegerField()
    total_journeys = serializers.IntegerField()
    currently_enrolled = serializers.IntegerField()
    currently_enrolled_change_pct = serializers.FloatField(allow_null=True, help_text="week-over-week change; null when nobody was enrolled a week ago")
    completed_30d = serializers.IntegerField()
    campaign_runs_today = serializers.IntegerField()
    campaign_runs_today_by_channel = serializers.DictField(child=serializers.IntegerField())


def _bool_param(request, name: str) -> bool:
    return (request.query_params.get(name) or "").lower() in ("1", "true", "yes")


class JourneyMetricsSerializer(serializers.Serializer):
    """Journey Details' 4 metric cards (apps.journeys.details.metrics); null fields for a Draft journey."""
    enrolled = serializers.IntegerField(allow_null=True)
    in_journey = serializers.IntegerField(allow_null=True)
    goal_converted = serializers.IntegerField(allow_null=True)
    goal_converted_pct = serializers.FloatField(allow_null=True)
    exited_early = serializers.IntegerField(allow_null=True)
    exited_early_pct = serializers.FloatField(allow_null=True)


class SourceListSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()


class JourneyAudienceSerializer(serializers.Serializer):
    source_lists = SourceListSerializer(many=True)
    eligible_pool = serializers.IntegerField(allow_null=True)
    enrollment_rate_per_day = serializers.FloatField(allow_null=True)


class JourneyTrendWeekSerializer(serializers.Serializer):
    week_start = serializers.CharField()
    enrolled = serializers.IntegerField()
    goal_converted = serializers.IntegerField()
    exited_early = serializers.IntegerField()


class JourneyGeneratedCampaignRowSerializer(serializers.Serializer):
    id = serializers.CharField()
    campaign_id = serializers.CharField()
    campaign_name = serializers.CharField()
    node_key = serializers.CharField()
    node_type = serializers.CharField()
    generation_date = serializers.CharField()
    last_run_at = serializers.DateTimeField(allow_null=True)
    recipients = serializers.IntegerField()
    status = serializers.CharField(allow_null=True)


class JourneyActivityEntrySerializer(serializers.Serializer):
    event_type = serializers.CharField()
    message = serializers.CharField()
    actor_name = serializers.CharField(allow_null=True)
    occurred_at = serializers.CharField()
    version_number = serializers.IntegerField(allow_null=True)


class JourneyViewSet(views.JourneyViewSet):
    serializer_class = JourneySerializer

    def get_queryset(self):
        qs = super().get_queryset().select_related("owner_user", "source_template").annotate(latest_version=Max("journey_versions__version_number"))
        if self.action == "list":
            ids = listing.candidate_ids(context.require().tenant_id, channel=self.request.query_params.get("channel"),
                                        trigger_family=self.request.query_params.get("trigger_family"),
                                        needs_attention=_bool_param(self.request, "needs_attention"))
            if ids is not None:
                qs = qs.filter(pk__in=ids)
        return qs

    def list(self, request, *args, **kwargs):
        """Same as ModelViewSet.list, except the page's computed fields are worked out once for the whole page
        (apps.journeys.listing.enrich) and passed to the serializer as context, not per row, and the page also carries
        `total`, the workspace's unfiltered journey count."""
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = page if page is not None else list(queryset)
        serializer = self.get_serializer(rows, many=True, context={**self.get_serializer_context(), "journey_row_info": listing.enrich(rows)})
        if page is not None:
            response = self.get_paginated_response(serializer.data)
            # every live journey in the workspace, whatever the filters: the count beside the page's "Your Journeys"
            response.data["total"] = views.JourneyViewSet.get_queryset(self).count()
            return response
        return Response(serializer.data)

    @extend_schema(request=None, responses=JourneyStatsSerializer)
    @action(detail=False, methods=["get"])
    def stats(self, request, version=None):
        """The List page's 4 stat cards (apps.journeys.listing.stats)."""
        return Response(JourneyStatsSerializer(listing.stats(context.require().tenant_id)).data)

    # ------------------------------------------------------------ lifecycle (phase 6d, Journey Details)
    @extend_schema(request=None, responses=JourneySerializer)
    @action(detail=True, methods=["post"],
            permission_classes=[IsAuthenticated, SameTenant, params.RequiresFeature.for_("journeys"), HasPermissionCode.for_("journey.activate")])
    def pause(self, request, pk=None, version=None):
        updated = lifecycle.pause(self.get_object(), _user_id(request))
        return Response(self.get_serializer(updated).data)

    @extend_schema(request=None, responses=JourneySerializer)
    @action(detail=True, methods=["post"],
            permission_classes=[IsAuthenticated, SameTenant, params.RequiresFeature.for_("journeys"), HasPermissionCode.for_("journey.activate")])
    def resume(self, request, pk=None, version=None):
        updated = lifecycle.resume(self.get_object(), _user_id(request))
        return Response(self.get_serializer(updated).data)

    @extend_schema(request=None, responses={201: JourneySerializer})
    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None, version=None):
        """Clones the journey and its current (or newest) version's graph as a new DRAFT journey (apps.journeys.lifecycle)."""
        copy = lifecycle.duplicate(self.get_object(), _user_id(request))
        copy.latest_version = 1
        return Response(self.get_serializer(copy).data, status=201)

    def _version(self, journey, number) -> JourneyVersion:
        version = JourneyVersion.objects.filter(journey=journey, version_number=number).first()
        if version is None:
            raise NotFound("This journey has no such version.")
        return version

    @extend_schema(methods=["get"], request=None, responses=JourneyVersionSerializer(many=True))
    @extend_schema(methods=["post"], request=NewVersionSerializer, responses={201: JourneyVersionDetailSerializer})
    @action(detail=True, methods=["get", "post"])
    def versions(self, request, pk=None, version=None):
        journey = self.get_object()
        if request.method == "GET":
            rows = JourneyVersion.objects.filter(journey=journey).order_by("-version_number")
            return Response(JourneyVersionSerializer(rows, many=True).data)
        if journey.status == Journey.Status.ARCHIVED:
            raise Conflict("An archived journey cannot be changed.")
        body = NewVersionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        created = graph.new_version(journey, _user_id(request), body.validated_data.get("from_version"))
        return Response(JourneyVersionDetailSerializer(created).data, status=201)

    @extend_schema(methods=["get"], request=None, responses=JourneyVersionDetailSerializer)
    @extend_schema(methods=["delete"], request=None, responses={204: None})
    @action(detail=True, methods=["get", "delete"], url_path=r"versions/(?P<number>\d+)")
    def version_detail(self, request, pk=None, number=None, version=None):
        journey = self.get_object()
        target = self._version(journey, int(number))
        if request.method == "GET":
            return Response(JourneyVersionDetailSerializer(target).data)
        if target.status != JourneyVersion.Status.DRAFT:
            raise Conflict("Only a draft version can be deleted.")
        if target.version_number == 1:
            raise Conflict("Version 1 cannot be deleted. Delete the journey instead.")
        if journey.current_version_id == target.id:
            raise Conflict("This version is the journey's current version.")
        target.delete()
        return Response(status=204)

    @extend_schema(request=GraphSaveSerializer, responses=JourneyVersionDetailSerializer)
    @action(detail=True, methods=["put"], url_path=r"versions/(?P<number>\d+)/graph")
    def save_graph(self, request, pk=None, number=None, version=None):
        journey = self.get_object()
        target = self._version(journey, int(number))
        body = GraphSaveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        saved = graph.save(target, _user_id(request), body.validated_data["graph"], body.validated_data["row_version"])
        return Response(JourneyVersionDetailSerializer(saved).data)

    @extend_schema(request=None, responses=ReadinessSerializer)
    @action(detail=True, methods=["get"], url_path=r"versions/(?P<number>\d+)/readiness")
    def readiness(self, request, pk=None, number=None, version=None):
        """The 4 Test Publish checks (apps/journeys/publish.py), without running anything."""
        journey = self.get_object()
        target = self._version(journey, int(number))
        return Response(ReadinessSerializer(publish.readiness(journey, target)).data)

    @extend_schema(request=TestPopulationSerializer, responses=TestResultSerializer)
    @action(detail=True, methods=["post"], url_path=r"versions/(?P<number>\d+)/test-publish")
    def test_publish(self, request, pk=None, number=None, version=None):
        """A real send to the chosen test population, run synchronously (apps/journeys/publish.py)."""
        journey = self.get_object()
        target = self._version(journey, int(number))
        body = TestPopulationSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        result = publish.run_test(journey, target, body.validated_data, _user_id(request))
        return Response(TestResultSerializer(result).data)

    @extend_schema(request=ApproveSerializer, responses=JourneySerializer)
    @action(detail=True, methods=["post"], url_path=r"versions/(?P<number>\d+)/approve",
            permission_classes=[IsAuthenticated, SameTenant, params.RequiresFeature.for_("journeys"), HasPermissionCode.for_("journey.activate")])
    def approve(self, request, pk=None, number=None, version=None):
        """Activate now, or schedule for later — status-gated by the same 4 readiness checks (needs journey.activate)."""
        journey = self.get_object()
        target = self._version(journey, int(number))
        body = ApproveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        updated = publish.approve(journey, target, body.validated_data.get("schedule_at"), _user_id(request))
        return Response(self.get_serializer(updated).data)

    @extend_schema(request=None, responses={200: None},
                   parameters=[OpenApiParameter("date_from", str), OpenApiParameter("date_to", str)])
    @action(detail=True, methods=["get"])
    def performance(self, request, pk=None, version=None):
        """The nightly rollup (null until it has run for this journey) and, for the window, per-step counts by outcome."""
        journey = self.get_object()
        tenant_id = context.require().tenant_id
        start, end = _window(request)
        rollup = JourneyMasterAnalytical.objects.filter(tenant_id=tenant_id, journey_id=journey.id).first()
        facts = (JourneyExecutionMasterAnalytical.objects
                 .filter(tenant_id=tenant_id, journey_id=journey.id, executed_at__gte=start, executed_at__lt=end))
        steps: dict = {}
        for row in facts.values("node_id", "outcome").annotate(events=Count("id"), customers=Count("party_id", distinct=True)):
            step = steps.setdefault(row["node_id"], {"node_id": str(row["node_id"]) if row["node_id"] else None, "events": 0, "outcomes": {}})
            step["events"] += row["events"]
            step["outcomes"][row["outcome"] or "UNKNOWN"] = {"events": row["events"], "customers": row["customers"]}
        reached = {row["node_id"]: row["customers"] for row in facts.values("node_id").annotate(customers=Count("party_id", distinct=True))}
        nodes = {node.id: node for node in JourneyNode.objects.filter(id__in=[key for key in steps if key]).select_related("journey_version")}
        for key, step in steps.items():
            node = nodes.get(key)
            step.update(customers=reached.get(key, 0), node_key=node.node_key if node else None, node_type=node.node_type if node else None,
                        version_number=node.journey_version.version_number if node else None)
        return Response({
            "window": {"date_from": start.date().isoformat(), "date_to": (end - timedelta(days=1)).date().isoformat()},
            "summary": None if rollup is None else {
                "active_enrollment_count": rollup.active_enrollment_count, "completed_count": rollup.completed_count,
                "exited_count": rollup.exited_count, "status": rollup.status, "last_refreshed_at": rollup.last_refreshed_at},
            "customers": facts.values("party_id").distinct().count(),
            "steps": sorted(steps.values(), key=lambda step: -step["customers"]),
            # Journey Details' 4 metric cards (phase 6d): read live, not from the nightly rollup above, so a
            # journey shows correct numbers before its first rollup has run.
            "metrics": details.metrics(journey),
        })

    @extend_schema(request=None, responses=JourneyExecutionSerializer(many=True),
                   parameters=[OpenApiParameter(name, str) for name in ("node_id", "outcome", "party_id", "date_from", "date_to")])
    @action(detail=True, methods=["get"])
    def executions(self, request, pk=None, version=None):
        journey = self.get_object()
        start, end = _window(request)
        rows = JourneyExecutionMasterAnalytical.objects.filter(tenant_id=context.require().tenant_id, journey_id=journey.id,
                                                               executed_at__gte=start, executed_at__lt=end)
        for name in ("node_id", "outcome", "party_id"):
            value = request.query_params.get(name)
            if value:
                if name == "node_id":
                    try:
                        uuid.UUID(value)
                    except ValueError:
                        raise ValidationError({"node_id": "Not a step id."}) from None
                rows = rows.filter(**{name: value})
        paginator = ExecutionPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response(JourneyExecutionSerializer(page, many=True).data)

    # ------------------------------------------------------------ Journey Details (phase 6d)
    @extend_schema(request=None, responses=JourneyAudienceSerializer)
    @action(detail=True, methods=["get"])
    def audience(self, request, pk=None, version=None):
        """Setup card's "Audience & enrollment": source lists, eligible pool, enrollment rate (apps.journeys.details)."""
        return Response(JourneyAudienceSerializer(details.audience(self.get_object())).data)

    @extend_schema(request=None, responses=JourneyTrendWeekSerializer(many=True))
    @action(detail=True, methods=["get"], url_path="enrollment-trend")
    def enrollment_trend(self, request, pk=None, version=None):
        """6 weekly buckets of Enrolled / Goal Converted / Exited Early, for the enrollment-over-time chart."""
        return Response(JourneyTrendWeekSerializer(details.enrollment_trend(self.get_object()), many=True).data)

    @extend_schema(request=None, responses=JourneyGeneratedCampaignRowSerializer(many=True))
    @action(detail=True, methods=["get"])
    def campaigns(self, request, pk=None, version=None):
        """The Generated Campaigns table: one row per JourneyGeneratedCampaign."""
        return Response(JourneyGeneratedCampaignRowSerializer(details.generated_campaigns(self.get_object()), many=True).data)

    @extend_schema(request=None, responses=JourneyActivityEntrySerializer(many=True))
    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None, version=None):
        """A derived timeline from version history and the journey's own status, newest first (apps.journeys.details)."""
        return Response(JourneyActivityEntrySerializer(details.activity(self.get_object()), many=True).data)


class JourneyStarterViewSet(viewsets.ViewSet):
    """The starter gallery offered when creating a journey (the same set for every tenant)."""
    permission_classes = [IsAuthenticated, HasPermissionCode.for_("journey.edit"), params.RequiresFeature.for_("journeys")]
    serializer_class = JourneyStarterSerializer

    @extend_schema(responses=JourneyStarterSerializer(many=True))
    def list(self, request, version=None):
        return Response(starters.catalogue())


class JourneyTemplateSerializer(serializers.ModelSerializer):
    """A saved template as read: its snapshot plus who saved it and how often it has been used."""
    created_by_name = serializers.SerializerMethodField()
    used_count = serializers.IntegerField(read_only=True, default=0, help_text="journeys created from this template")
    step_count = serializers.SerializerMethodField(help_text="every step after the entry trigger")
    channels = serializers.SerializerMethodField()

    class Meta:
        model = JourneyTemplate
        fields = ("id", "name", "description", "category", "population_mode", "reentry_policy", "reentry_after_days",
                  "goal_description", "graph", "created_by", "created_by_name", "created_at", "updated_at", "row_version",
                  "used_count", "step_count", "channels")
        read_only_fields = fields

    def get_created_by_name(self, template) -> str | None:
        user = template.created_by
        return (user.display_name or user.email) if user else None

    def get_step_count(self, template) -> int:
        return starters.summary(template.graph or {})["step_count"]

    def get_channels(self, template) -> list[str]:
        return starters.summary(template.graph or {})["channels"]


class JourneyTemplateCreateSerializer(serializers.Serializer):
    journey_id = serializers.UUIDField()
    version_number = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=200)
    category = serializers.ChoiceField(choices=JourneyTemplate.Category.choices)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class JourneyTemplateUpdateSerializer(serializers.Serializer):
    row_version = serializers.IntegerField(help_text="the template's row_version when it was loaded; 409 when stale")
    name = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    category = serializers.ChoiceField(choices=JourneyTemplate.Category.choices, required=False)


def _clean_template_name(value: str, tenant_id, exclude=None) -> str:
    value = value.strip()
    if not value:
        raise ValidationError({"name": "Give the template a name."})
    clash = JourneyTemplate.objects.filter(tenant_id=tenant_id, name__iexact=value, deleted_at__isnull=True)   # == ux_journey_template_name_live
    if exclude is not None:
        clash = clash.exclude(pk=exclude)
    if clash.exists():
        raise ValidationError({"name": "Another template already has this name."})
    return value


class JourneyTemplateViewSet(views.BaseTenantViewSet):
    """The workspace's saved journey templates. Saving snapshots a journey version; the template never changes after
    that except for its name, description and category. Delete is soft: journeys made from it keep pointing at it."""
    queryset = JourneyTemplate.objects.select_related("created_by").annotate(used_count=Count("journeys_created")).order_by("-created_at")
    serializer_class = JourneyTemplateSerializer
    permission_code = "journey.edit"
    permission_classes = [*views.BaseTenantViewSet.permission_classes, params.RequiresFeature.for_("journeys")]
    pagination_class = None
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            category = (self.request.query_params.get("category") or "").upper()
            if category:
                qs = qs.filter(category=category)
            needle = (self.request.query_params.get("search") or "").strip()
            if needle:
                qs = qs.filter(Q(name__icontains=needle) | Q(description__icontains=needle))
        return qs

    @extend_schema(request=JourneyTemplateCreateSerializer, responses={201: JourneyTemplateSerializer})
    def create(self, request, *args, **kwargs):
        body = JourneyTemplateCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        tenant_id = context.require().tenant_id
        journey = Journey.objects.filter(pk=data["journey_id"], tenant_id=tenant_id, deleted_at__isnull=True).first()
        if journey is None:
            raise ValidationError({"journey_id": "This journey doesn't exist."})
        version = JourneyVersion.objects.filter(journey=journey, version_number=data["version_number"]).first()
        if version is None:
            raise ValidationError({"version_number": "This journey has no such version."})
        snapshot = graph.clean(graph._strip_ids(graph.read(version)))
        description = (data.get("description") or "").strip() or None
        template = JourneyTemplate.objects.create(
            tenant_id=tenant_id, name=_clean_template_name(data["name"], tenant_id), description=description, category=data["category"],
            population_mode=journey.population_mode, reentry_policy=journey.reentry_policy, reentry_after_days=journey.reentry_after_days,
            goal_description=journey.goal_description, graph=snapshot, created_by_id=_user_id(request))
        return Response(self.get_serializer(self.get_queryset().get(pk=template.pk)).data, status=201)

    @extend_schema(request=JourneyTemplateUpdateSerializer, responses=JourneyTemplateSerializer)
    def partial_update(self, request, *args, **kwargs):
        template = self.get_object()
        body = JourneyTemplateUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        if str(data["row_version"]) != str(template.row_version):
            raise Conflict("Someone else changed this template after you opened it. Reload to see their changes.")
        changed = []
        if "name" in data:
            template.name = _clean_template_name(data["name"], template.tenant_id, exclude=template.pk)
            changed.append("name")
        if "description" in data:
            template.description = (data["description"] or "").strip() or None
            changed.append("description")
        if "category" in data:
            template.category = data["category"]
            changed.append("category")
        if changed:
            template.updated_by_id = _user_id(request)
            template.save(update_fields=[*changed, "updated_by"])
        # row_version / updated_at are maintained by the database trigger: return what is actually stored
        return Response(self.get_serializer(self.get_queryset().get(pk=template.pk)).data)
