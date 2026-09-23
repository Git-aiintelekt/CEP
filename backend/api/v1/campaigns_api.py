"""Campaign module API (BRD v0.9 sections 6.3, 7, 15). Extends the campaign endpoints that were already there.

    GET    /campaigns/                     ?search= &type= &channel= &status= &date_from= &date_to= &date_field=created|scheduled
                                           &triggered_by=manual|journey &tag= &ordering= &page= &page_size=   (archived hidden unless status=ARCHIVED)
    POST   /campaigns/                     create (DRAFT)            PATCH / PUT  while it is a draft or test published
    DELETE /campaigns/{id}/                archives: a campaign is never deleted
    POST   /campaigns/{id}/test-publish/   {to: [addresses], user_ids: [internal users]}: a test Run, nothing counted
    POST   /campaigns/{id}/publish/        production publish: validates, creates the Run(s), schedules or starts the send
    POST   /campaigns/{id}/pause/  resume/  cancel-schedule/  clone/  archive/  unarchive/
    POST   /campaigns/bulk/                {action: archive|clone, ids: [...]}
    GET    /campaigns/{id}/preview/        ?party_id= : the content as that customer would get it
    GET    /campaigns/{id}/lists/          POST {contact_list, role}       DELETE /campaigns/{id}/lists/{list_id}/
    GET    /campaigns/{id}/audience/       merged, de-duplicated, minus excluded lists, with today's governance picture
    GET    /campaigns/audience-estimate/   the same for lists that are not saved yet: ?include=a,b &exclude=c &channel= &solicitation_type=
    GET    /campaigns/{id}/audience/export/   CSV of the frozen Campaign List (or of the estimate, before the first send)
    GET    /campaigns/{id}/runs/           GET /campaigns/{id}/runs/{run_id}/
    GET    /campaigns/{id}/metrics/        GET /campaigns/{id}/metrics/timeseries/?bucket=hour|day
    GET    /campaigns/{id}/activity/       what happened to it, newest first
    GET    /campaigns/form-options/        owners, tags in use, time zones: what the form's dropdowns need
    GET    /campaigns/{id}/checklist/      what stands between the campaign and a production publish
"""
import csv
import logging
import re
import tempfile

from django.db import transaction
from django.db.models import Count, Exists, IntegerField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.http import FileResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_field
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.campaigns import service
from apps.campaigns.models import Campaign, CampaignActivityLog, CampaignList, CampaignRun, CampaignTarget, ContactListCampaign
from apps.contact_lists.models import ContactList
from apps.identity.models import AppUser
from apps.platform_ops import billing
from apps.templates import design
from apps.templates.models import PersonalizationTag, RenderedTemplateContent, TemplateMaster
from apps.tenants import context

from . import serializers as s
from . import views

log = logging.getLogger("cep.campaigns")
TARGET_FIELDS = ("target_revenue", "target_opens", "target_clicks", "target_conversions", "target_redemptions", "planned_cost", "planned_offer_cost", "notes")
STATUS_LABEL = {"SCHEDULED": "Scheduled", **dict(Campaign.Status.choices)}
TAG_RE = re.compile(r"^[\w .&/+-]{1,40}$")


class CampaignPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class TargetsSerializer(serializers.ModelSerializer):
    class Meta:
        model = CampaignTarget
        fields = TARGET_FIELDS
        extra_kwargs = {name: {"required": False, "allow_null": True} for name in TARGET_FIELDS}

    def validate(self, attrs):
        negative = [name for name, value in attrs.items() if name != "notes" and value is not None and value < 0]
        if negative:
            raise serializers.ValidationError({name: "Enter zero or more." for name in negative})
        return attrs


class CampaignSerializer(s.CampaignSerializer):
    excluded_lists = serializers.ListField(child=serializers.UUIDField(), required=False, write_only=True,
                                           help_text="Contact lists whose people are kept OUT of this campaign (replaces the current set).")
    targets = TargetsSerializer(required=False, allow_null=True)
    display_status = serializers.SerializerMethodField(help_text="The stored status, or SCHEDULED when production published with its next send in the future.")
    display_status_label = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField(help_text="What can be done with the campaign now: edit, clone, test_publish, publish, pause, resume, cancel_schedule, archive, unarchive, results.")
    next_run_at = serializers.SerializerMethodField()
    list_count = serializers.SerializerMethodField()
    audience_size = serializers.SerializerMethodField(help_text="People in the last frozen Campaign List; before the first send, the sum of the attached lists (not de-duplicated).")
    owner_name = serializers.SerializerMethodField()
    triggered_by = serializers.SerializerMethodField()
    setup_step = serializers.IntegerField(required=False, min_value=0, max_value=service.SETUP_STEPS,
                                          help_text="Setup steps completed (0-6). It only moves forward; left out, a new campaign counts as complete.")
    setup_complete = serializers.SerializerMethodField(help_text="False: open the setup at step setup_step + 1, not the campaign page.")

    class Meta(s.CampaignSerializer.Meta):
        read_only_fields = s.AUDIT_FIELDS + ("status", "is_journey_generated", "origin_journey", "legacy_marketing_campaign_id", "previous_status", "published_at",
                                             "completed_at", "archived_at")

    # ---- representation
    def get_display_status(self, campaign) -> str:
        return service.display_status(campaign)

    def get_display_status_label(self, campaign) -> str:
        return STATUS_LABEL.get(service.display_status(campaign), campaign.get_status_display())

    def get_actions(self, campaign) -> list[str]:
        return service.actions(campaign)

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_next_run_at(self, campaign):
        return service.next_run_at(campaign)

    def get_list_count(self, campaign) -> int:
        return sum(1 for link in campaign.contact_list_campaigns.all() if link.role == "INCLUDE")

    def get_audience_size(self, campaign) -> int | None:
        frozen = getattr(campaign, "frozen_members", None)
        if frozen:
            return frozen
        included = [link.contact_list.member_count for link in campaign.contact_list_campaigns.all() if link.role == "INCLUDE"]
        return sum(included) if included else None

    def get_owner_name(self, campaign) -> str | None:
        owner = campaign.owner_user
        return (owner.display_name or owner.email) if owner else None

    def get_setup_complete(self, campaign) -> bool:
        return service.setup_complete(campaign)

    def get_triggered_by(self, campaign) -> str:
        return "JOURNEY" if campaign.is_journey_generated else "MANUAL"

    def to_representation(self, campaign):
        data = super().to_representation(campaign)
        links = list(campaign.contact_list_campaigns.all())
        data["contact_lists"] = [str(link.contact_list_id) for link in links if link.role == "INCLUDE"]
        data["excluded_lists"] = [str(link.contact_list_id) for link in links if link.role == "EXCLUDE"]
        data["contact_list_details"] = [dict(s.AttachedContactListSerializer(link.contact_list).data, role=link.role, attached_at=link.attached_at) for link in links]
        target = next(iter(sorted((t for t in campaign.campaign_targets.all() if t.deleted_at is None), key=lambda t: t.created_at, reverse=True)), None)
        data["targets"] = TargetsSerializer(target).data if target else None
        return data

    # ---- validation
    def validate_name(self, value):
        value = super().validate_name(" ".join(value.split()))
        same = Campaign.objects.filter(tenant_id=context.require().tenant_id, name__iexact=value, deleted_at__isnull=True, is_journey_generated=False).exclude(status="ARCHIVED")
        if self.instance is not None:
            same = same.exclude(pk=self.instance.pk)
        if same.exists():
            raise serializers.ValidationError("Another campaign already has this name.")
        return value

    def validate_tags(self, value):
        if not isinstance(value, list) or len(value) > 20:
            raise serializers.ValidationError("Up to 20 tags.")
        tags = list(dict.fromkeys(" ".join(str(tag).split()) for tag in value if str(tag).strip()))
        bad = [tag for tag in tags if not TAG_RE.match(tag)]
        if bad:
            raise serializers.ValidationError(f"A tag is up to 40 letters, digits and spaces: {', '.join(bad)}")
        return tags

    def validate_owner_user(self, value):
        if value is not None and (str(value.tenant_id) != str(context.require().tenant_id) or not value.is_active or value.deleted_at is not None):
            raise serializers.ValidationError("Choose an active user of this workspace.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)

        def current(name):
            return attrs[name] if name in attrs else getattr(self.instance, name, None)

        errors = {}
        if self.instance is not None and "setup_step" in attrs:          # going back to an earlier step and saving does not undo the later ones
            attrs["setup_step"] = max(attrs["setup_step"], self.instance.setup_step)
        send_type = current("send_type") or "IMMEDIATE"
        if current("campaign_type") == "DRIP" and "send_type" not in attrs and self.instance is None:
            send_type = attrs["send_type"] = "DRIP"
        if send_type == "DRIP" and current("campaign_type") != "DRIP":
            errors["send_type"] = "A series of sends belongs to a drip campaign. Change the campaign type, or choose another send type."
        if "recurring_config" in attrs and attrs["recurring_config"] and send_type == "RECURRING":
            problem = service.validate_recurring(attrs["recurring_config"])
            if problem:
                errors["recurring_config"] = problem
        if "drip_config" in attrs and attrs["drip_config"] and send_type == "DRIP":
            problem = service.validate_drip(attrs["drip_config"])
            if problem:
                errors["drip_config"] = problem
        if "send_timezone" in attrs and attrs["send_timezone"]:
            from zoneinfo import available_timezones
            if attrs["send_timezone"] not in available_timezones():
                errors["send_timezone"] = "Not a time zone CEP knows."
        if "excluded_lists" in attrs:
            ids = list(dict.fromkeys(attrs["excluded_lists"]))
            found = {item.id: item for item in ContactList.objects.filter(id__in=ids, deleted_at__isnull=True)}
            if len(found) != len(ids):
                errors["excluded_lists"] = "One of the excluded lists no longer exists."
            attrs["excluded_lists"] = [found[i] for i in ids if i in found]
            included = {item.id for item in attrs.get("contact_lists", [])} if "contact_lists" in attrs else set(
                ContactListCampaign.objects.filter(campaign=self.instance, role="INCLUDE").values_list("contact_list_id", flat=True)) if self.instance else set()
            both = [item.name for item in attrs["excluded_lists"] if item.id in included]
            if both:
                errors["excluded_lists"] = f"A list cannot be both attached and excluded: {', '.join(both)}"
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    # ---- persistence
    def _after(self, campaign, include, exclude, targets, created: bool):
        user = self.context["request"].user
        changes = []
        if include is not None or exclude is not None:
            links = list(ContactListCampaign.objects.filter(campaign=campaign).select_related("contact_list"))
            keep_in = include if include is not None else [link.contact_list for link in links if link.role == "INCLUDE"]
            keep_out = exclude if exclude is not None else [link.contact_list for link in links if link.role == "EXCLUDE"]
            attached, detached = service.set_lists(campaign, keep_in, [item for item in keep_out if item.pk not in {i.pk for i in keep_in}])
            changes += [f"attached {name}" for name in attached] + [f"detached {name}" for name in detached]
        if targets is not None and service.upsert_targets(campaign, targets, user):
            changes.append("targets")
        return changes

    def create(self, validated_data):
        include, exclude, targets = validated_data.pop("contact_lists", None), validated_data.pop("excluded_lists", None), validated_data.pop("targets", None)
        campaign = super().create({**validated_data, "contact_lists": []})
        self._after(campaign, include or [], exclude or [], targets, created=True)
        service.record(campaign, "CREATED", f"Created as a draft ({campaign.get_campaign_type_display()}, {campaign.get_channel_display()}).", user=self.context["request"].user)
        return self._fresh(campaign.pk)

    def update(self, campaign, validated_data):
        include, exclude, targets = validated_data.pop("contact_lists", None), validated_data.pop("excluded_lists", None), validated_data.pop("targets", None)
        words = {"name": "name", "description": "description", "template": "template", "sender_profile": "sender", "scheduled_at": "schedule", "send_type": "send type",
                 "recurring_config": "recurrence", "drip_config": "series", "tags": "tags", "owner_user": "owner", "respect_governance": "governance setting",
                 "rate_limit_per_hour": "send rate", "timezone_optimization": "time zone delivery", "send_timezone": "time zone", "receipt_config": "receipt settings",
                 "solicitation_type": "message kind", "campaign_type": "type", "channel": "channel", "code": "code"}
        changed = [words[name] for name, value in validated_data.items() if name in words and getattr(campaign, name) != value]
        campaign = super().update(campaign, validated_data)
        changed += self._after(campaign, include, exclude, targets, created=False)
        if changed:
            service.record(campaign, "MODIFIED", "Changed: " + ", ".join(dict.fromkeys(changed)) + ".", user=self.context["request"].user)
        return self._fresh(campaign.pk)

    @staticmethod
    def _fresh(pk):
        """What was just written, read again: the lists and targets were changed after the instance was loaded."""
        return (Campaign.objects.select_related("template", "sender_profile", "owner_user", "tenant")
                .prefetch_related("campaign_runs", "contact_list_campaigns__contact_list", "campaign_targets").get(pk=pk))


class TestPublishSerializer(serializers.Serializer):
    to = serializers.ListField(child=serializers.CharField(max_length=254), required=False, default=list, max_length=20)
    user_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list, max_length=20)


class BulkSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["archive", "clone"])
    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False, max_length=100)


class AttachSerializer(serializers.Serializer):
    contact_list = serializers.UUIDField()
    role = serializers.ChoiceField(choices=["INCLUDE", "EXCLUDE"], default="INCLUDE")


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = CampaignActivityLog
        fields = ("id", "event_type", "severity", "message", "detail", "actor_name", "campaign_run_id", "occurred_at")


def _safe_cell(value):
    if value is None:
        return ""
    return "'" + value if isinstance(value, str) and value and value[0] in "=+-@" else value


class _Echo:
    def write(self, value):
        return value


class CampaignViewSet(views.CampaignViewSet):
    serializer_class = CampaignSerializer
    pagination_class = CampaignPagination
    filterset_fields = ["solicitation_type", "send_type"]
    ordering_fields = ["name", "campaign_type", "channel", "status", "scheduled_at", "created_at", "updated_at", "list_count", "next_run"]
    ordering = ["-created_at"]

    def get_queryset(self):
        # sub-queries, not joins: a campaign with 3 lists and 4 runs must not count 12 of anything
        attached = (ContactListCampaign.objects.filter(campaign_id=OuterRef("pk"), role="INCLUDE").values("campaign_id").annotate(n=Count("contact_list_id")).values("n")[:1])
        upcoming = CampaignRun.objects.filter(campaign_id=OuterRef("pk"), test_mode=False, status="SCHEDULED").order_by("scheduled_at").values("scheduled_at")[:1]
        frozen = CampaignList.objects.filter(campaign_id=OuterRef("pk"), status="FROZEN", campaign_run__test_mode=False).order_by("-generated_at").values("member_count")[:1]
        qs = (super().get_queryset().select_related("owner_user", "tenant").prefetch_related("campaign_targets")
              .annotate(list_count=Coalesce(Subquery(attached, output_field=IntegerField()), 0), next_run=Subquery(upcoming),
                        frozen_members=Subquery(frozen, output_field=IntegerField())))
        if self.action not in ("list", "calendar"):
            return qs
        params = self.request.query_params
        future_run = CampaignRun.objects.filter(campaign_id=OuterRef("pk"), test_mode=False, status="SCHEDULED", scheduled_at__gt=timezone.now())
        statuses = [item for item in params.get("status", "").upper().split(",") if item]
        unknown = [item for item in statuses if item not in STATUS_LABEL]
        if unknown:
            raise ValidationError({"status": f"Unknown status: {', '.join(unknown)}"})
        if statuses:
            wanted = Q()
            for item in statuses:
                if item == "SCHEDULED":
                    wanted |= Q(status="PRODUCTION_PUBLISHED") & Exists(future_run)
                elif item == "PRODUCTION_PUBLISHED":
                    wanted |= Q(status="PRODUCTION_PUBLISHED") & ~Exists(future_run)
                else:
                    wanted |= Q(status=item)
            qs = qs.filter(wanted)
        elif params.get("include_archived", "").lower() not in ("1", "true"):
            qs = qs.exclude(status="ARCHIVED")                   # archived campaigns stay out of the everyday list
        for name, column in (("type", "campaign_type"), ("campaign_type", "campaign_type"), ("channel", "channel")):
            if params.get(name):
                qs = qs.filter(**{f"{column}__in": params[name].upper().split(",")})
        if params.get("triggered_by"):
            qs = qs.filter(is_journey_generated=params["triggered_by"].lower() == "journey")
        if params.get("tag"):
            qs = qs.filter(tags__contains=[params["tag"]])
        if params.get("owner"):
            qs = qs.filter(owner_user_id=params["owner"])
        column = "scheduled_at" if params.get("date_field") == "scheduled" else "created_at"
        for name, lookup in (("date_from", "date__gte"), ("date_to", "date__lte")):
            if params.get(name) and self.action == "list":      # for the calendar the dates are its window
                try:
                    qs = qs.filter(**{f"{column}__{lookup}": serializers.DateField().to_internal_value(params[name])})
                except serializers.ValidationError as exc:
                    raise ValidationError({name: "Use a date like 2026-09-30."}) from exc
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        extra = {"tenant_id": context.require().tenant_id}
        if not hasattr(user, "has_scope"):
            extra["created_by_id"] = user.id
            if serializer.validated_data.get("owner_user") is None:
                extra["owner_user_id"] = user.id                # the owner defaults to whoever creates the campaign
        serializer.save(**extra)

    def perform_destroy(self, instance):
        """Archive over delete: nothing about a campaign is ever removed."""
        try:
            service.archive(instance, self.request.user)
        except service.ActionError as exc:
            raise Conflict(str(exc)) from exc

    def _answer(self, campaign, status=200):
        return Response(self.get_serializer(self.get_queryset().get(pk=campaign.pk)).data, status=status)

    def _act(self, fn, *args):
        try:
            return fn(*args)
        except service.ActionError as exc:
            raise Conflict(str(exc)) from exc

    # ------------------------------------------------------------ calendar
    @extend_schema(parameters=[OpenApiParameter("date_from", str, description="first day, e.g. 2026-08-01"), OpenApiParameter("date_to", str, description="last day, at most 62 days later")],
                   responses=dict)
    @action(detail=False, methods=["get"], pagination_class=None)
    def calendar(self, request, version=None):
        """The month as the calendar view draws it: one span per campaign, with its sends. Takes the list's status, type, channel, tag and owner filters; days are the workspace's."""
        from datetime import datetime, time, timedelta
        from zoneinfo import ZoneInfo
        days = {}
        for name in ("date_from", "date_to"):
            try:
                days[name] = serializers.DateField().to_internal_value(request.query_params.get(name) or "")
            except serializers.ValidationError as exc:
                raise ValidationError({name: "Use a date like 2026-09-30."}) from exc
        if not days["date_from"] <= days["date_to"] <= days["date_from"] + timedelta(days=62):
            raise ValidationError({"date_to": "Ask for up to 62 days, the last day after the first."})
        try:
            zone = ZoneInfo(getattr(request, "tenant", {}).get("timezone") or "UTC")
        except Exception:
            zone = ZoneInfo("UTC")
        start = datetime.combine(days["date_from"], time.min, tzinfo=zone)
        end = datetime.combine(days["date_to"] + timedelta(days=1), time.min, tzinfo=zone)
        campaigns = self.get_queryset().exclude(status="ARCHIVED").prefetch_related("campaign_runs")      # with the list's filters; the dates are the window here
        term = request.query_params.get("search", "").strip()
        if term:
            campaigns = campaigns.filter(Q(name__icontains=term) | Q(code__icontains=term))
        return Response({"date_from": days["date_from"], "date_to": days["date_to"], "timezone": zone.key, "spans": service.calendar_spans(campaigns, start, end)})

    # ------------------------------------------------------------ form options
    @extend_schema(responses=dict)
    @action(detail=False, methods=["get"], url_path="form-options", pagination_class=None)
    def form_options(self, request, version=None):
        from zoneinfo import available_timezones
        tenant_id = context.require().tenant_id
        owners = AppUser.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True).order_by("display_name", "email")
        tags = sorted({tag for row in Campaign.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True).values_list("tags", flat=True) for tag in (row or [])}, key=str.lower)
        return Response({"owners": [{"id": str(user.pk), "name": user.display_name or user.email, "email": user.email} for user in owners], "tags": tags,
                         "timezones": sorted(zone for zone in available_timezones() if "/" in zone and not zone.startswith(("Etc/", "posix/", "right/"))),
                         "workspace_timezone": getattr(request, "tenant", {}).get("timezone") or "UTC"})

    # ------------------------------------------------------------ publish
    def _content_problems(self, campaign, missing: dict) -> dict:
        if campaign.template_id is not None and "template" not in missing:
            content = RenderedTemplateContent.objects.filter(template_id=campaign.template_id).order_by("-version_number").first()
            body = ((content.html_content or "") + (content.sms_body or "")) if content else ""
            marketing = campaign.solicitation_type == Campaign.SolicitationType.MARKETING
            if not body.strip():
                missing["template"] = "This template has no saved content yet."
            elif marketing and campaign.template.channel == "EMAIL" and design.UNSUBSCRIBE_TAG not in design.extract_tags(body):
                missing["template"] = "Marketing email must contain the {{unsubscribe_url}} link."
            elif marketing and campaign.template.channel in design.MESSAGE_CHANNELS and not design.OPT_OUT_RE.search(body):
                missing["template"] = "Marketing text messages must say how to opt out, for example: Reply STOP to unsubscribe."
            elif campaign.template.channel == "MMS" and design.message_blockers(campaign.template).get("media_asset"):
                missing["template"] = "This MMS template has no picture."
        return missing

    @extend_schema(request=None, responses=dict)
    @action(detail=True, methods=["get"], url_path="checklist")
    def checklist(self, request, pk=None, version=None):
        """What stands between this campaign and a production publish, without publishing it."""
        campaign = self.get_object()
        problems = self._content_problems(campaign, service.publish_problems(campaign, production=True))
        tested = campaign.campaign_runs.filter(test_mode=True).exists()
        return Response({"ready": not problems, "problems": problems, "test_sent": tested,
                         "items": [{"key": key, "label": label, "ok": key not in problems, "problem": problems.get(key)}
                                   for key, label in (("template", "Template content finalized"), ("contact_lists", "Campaign List attached"), ("sender_profile", "Verified sender chosen"),
                                                      ("scheduled_at", "Send time set"), ("recurring_config", "Recurrence valid"), ("drip_config", "Series steps valid"))
                                   if key in problems or key in ("template", "contact_lists", "sender_profile")]
                                  + [{"key": "test", "label": "Test message sent and reviewed", "ok": tested, "problem": None if tested else "Send yourself a test before publishing.", "advisory": True}]})

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def publish(self, request, pk=None, version=None):
        """Production publish: validates, creates the Run(s) and schedules or starts the send. The Campaign List is frozen when a Run starts."""
        campaign = self.get_object()
        if campaign.is_journey_generated:
            raise Conflict("This campaign is generated by a journey. It is published by approving the journey.")
        if campaign.status not in self.EDITABLE:
            raise Conflict("Campaign cannot be published from its current status.")
        missing = self._content_problems(campaign, service.publish_problems(campaign, production=True))
        if missing:
            raise ValidationError(missing)
        billing.assert_can_send(campaign.tenant_id)          # 409 when a hard-capped plan has used its messages this month
        campaign.status, campaign.published_at = Campaign.Status.PRODUCTION_PUBLISHED, timezone.now()
        campaign.save(update_fields=["status", "published_at"])
        if campaign.campaign_type == Campaign.CampaignType.E_RECEIPT:
            from apps.delivery.engine import receipts             # no audience, no schedule: receipts go one by one under a run per day
            run = receipts._run_of_today(campaign.tenant_id, campaign)
            service.record(campaign, "PUBLISHED", "Production published. Receipts are sent as purchases arrive.", user=request.user, run=run)
            return Response(s.CampaignRunSerializer(run).data, status=201)
        runs = service.create_runs(campaign)
        zone = service.zone_of(campaign)
        when = [run.scheduled_at for run in runs if run.scheduled_at and run.scheduled_at > timezone.now()]
        service.record(campaign, "PUBLISHED", "Production published: " + (
            f"{len(runs)} sends planned, the first {'now' if len(when) < len(runs) else 'on ' + min(when).astimezone(zone).strftime('%d %b %Y %H:%M')}." if len(runs) > 1
            else f"scheduled for {when[0].astimezone(zone):%d %b %Y %H:%M} ({zone.key})." if when else "the send starts now."), user=request.user, run=runs[0])
        if campaign.solicitation_type == "MARKETING" and not campaign.respect_governance:
            service.record(campaign, "WARNING", "Corporate frequency limits are switched off for this marketing campaign. Consent, unsubscribes and blocked addresses still apply.",
                           user=request.user, severity="WARNING")
        for run in runs:
            if run.scheduled_at is None or run.scheduled_at <= timezone.now():
                transaction.on_commit(lambda run_id=str(run.pk): views._enqueue_run(str(campaign.tenant_id), run_id), using=context.require().db_alias)
        return Response(s.CampaignRunSerializer(runs[0]).data, status=201)

    @extend_schema(request=TestPublishSerializer, responses=dict)
    @action(detail=True, methods=["post"], url_path="test-publish")
    def test_publish(self, request, pk=None, version=None):
        """Sends the current content to internal people only. Creates a test Run; nothing counts towards the campaign's results."""
        from apps.delivery.engine import dispatch, dispatch_sms, runs as engine_runs
        from apps.delivery.providers import ProviderError
        campaign = self.get_object()
        if "test_publish" not in service.actions(campaign):
            raise Conflict("A test can be sent while the campaign is a draft or test published.")
        body = TestPublishSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        texts = engine_runs.family(campaign) == "SMS"
        people = list(AppUser.objects.filter(tenant_id=campaign.tenant_id, pk__in=body.validated_data["user_ids"], is_active=True, deleted_at__isnull=True))
        to = list(dict.fromkeys([item.strip() for item in body.validated_data["to"] if item.strip()] + ([] if texts else [user.email for user in people])))
        if not to:
            raise ValidationError({"to": "Choose at least one person, or type a mobile number with country code." if texts else "Choose at least one person or address."})
        pattern = r"^\+[1-9]\d{7,14}$" if texts else r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
        bad = [item for item in to if not re.match(pattern, item)]
        if bad:
            raise ValidationError({"to": f"Not a {'mobile number with country code (+14045550100)' if texts else 'valid email address'}: {', '.join(bad)}"})
        missing = self._content_problems(campaign, {key: value for key, value in service.publish_problems(campaign, production=False).items() if key in ("template", "sender_profile")})
        if missing:
            raise ValidationError(missing)
        run = CampaignRun.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, run_number=campaign.campaign_runs.count() + 1, run_type=CampaignRun.RunType.ONE_TIME,
                                         test_mode=True, status="SENDING", started_at=timezone.now(), sequence_label="Test")
        try:
            results = (dispatch_sms if texts else dispatch).send_test(campaign.tenant_id, campaign, to)
        except ProviderError as exc:
            CampaignRun.objects.filter(pk=run.pk).update(status="FAILED", completed_at=timezone.now())
            service.record(campaign, "WARNING", f"Test publish failed: {exc}", user=request.user, run=run, severity="ERROR")
            raise Conflict(str(exc)) from None
        accepted = sum(1 for item in results if item.get("ok"))
        CampaignRun.objects.filter(pk=run.pk).update(status="COMPLETED" if accepted else "FAILED", completed_at=timezone.now())
        if campaign.status == Campaign.Status.DRAFT and accepted:
            campaign.status = Campaign.Status.TEST_PUBLISHED
            campaign.save(update_fields=["status"])
        service.record(campaign, "TEST_PUBLISHED", f"Test sent to {accepted} of {len(to)}: {', '.join(to)}. Tests do not count towards results.", user=request.user, run=run,
                       severity="INFO" if accepted == len(to) else "WARNING", detail={"results": results})
        return Response({"run": str(run.pk), "results": results, "status": campaign.status})

    # ------------------------------------------------------------ actions
    @extend_schema(request=None, responses=CampaignSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def pause(self, request, pk=None, version=None):
        return self._answer(self._act(service.pause, self.get_object(), request.user))

    @extend_schema(request=None, responses=CampaignSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def resume(self, request, pk=None, version=None):
        campaign, run_ids = self._act(service.resume, self.get_object(), request.user)
        for run_id in run_ids:                                # the engine picks up what is still queued of each run
            transaction.on_commit(lambda run_id=run_id: views._enqueue_run(str(campaign.tenant_id), run_id), using=context.require().db_alias)
        return self._answer(campaign)

    @extend_schema(request=None, responses=CampaignSerializer)
    @action(detail=True, methods=["post"], url_path="cancel-schedule", permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def cancel_schedule(self, request, pk=None, version=None):
        return self._answer(self._act(service.cancel_schedule, self.get_object(), request.user))

    @extend_schema(request=None, responses={201: CampaignSerializer})
    @action(detail=True, methods=["post"])
    def clone(self, request, pk=None, version=None):
        copy = service.clone(self.get_object(), request.user, code=s.CampaignSerializer._next_code())
        return self._answer(copy, 201)

    @extend_schema(request=None, responses=CampaignSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None, version=None):
        return self._answer(self._act(service.archive, self.get_object(), request.user))

    @extend_schema(request=None, responses=CampaignSerializer)
    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None, version=None):
        return self._answer(self._act(service.unarchive, self.get_object(), request.user))

    @extend_schema(request=BulkSerializer, responses=dict)
    @action(detail=False, methods=["post"])
    def bulk(self, request, version=None):
        body = BulkSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        done, skipped = [], []
        for campaign in self.get_queryset().filter(pk__in=body.validated_data["ids"]):
            try:
                with transaction.atomic():
                    result = service.archive(campaign, request.user) if body.validated_data["action"] == "archive" else service.clone(
                        campaign, request.user, code=s.CampaignSerializer._next_code())
                done.append({"id": str(result.pk), "name": result.name})
            except service.ActionError as exc:
                skipped.append({"id": str(campaign.pk), "name": campaign.name, "reason": str(exc)})
        return Response({"action": body.validated_data["action"], "done": done, "skipped": skipped})

    # ------------------------------------------------------------ audience
    @extend_schema(methods=["GET"], responses=dict)
    @extend_schema(methods=["POST"], request=AttachSerializer, responses=dict)
    @action(detail=True, methods=["get", "post"], url_path="lists")
    def lists(self, request, pk=None, version=None):
        campaign = self.get_object()
        if request.method == "POST":
            if "edit" not in service.actions(campaign):
                raise Conflict("Lists can be changed while the campaign is a draft or test published.")
            body = AttachSerializer(data=request.data)
            body.is_valid(raise_exception=True)
            item = ContactList.objects.filter(pk=body.validated_data["contact_list"], tenant_id=campaign.tenant_id, deleted_at__isnull=True).first()
            if item is None or item.status != "ACTIVE":
                raise ValidationError({"contact_list": "Choose an active contact list."})
            link, created = ContactListCampaign.objects.update_or_create(campaign=campaign, contact_list=item, defaults={"tenant_id": campaign.tenant_id, "role": body.validated_data["role"]})
            if created:
                service.record(campaign, "LIST_ATTACHED", f"{'Excluded' if link.role == 'EXCLUDE' else 'Attached'} the contact list “{item.name}” ({item.member_count:,} people).", user=request.user)
        return Response(service.audience(campaign, sample=0)["lists"])

    @extend_schema(request=None, responses={204: None})
    @action(detail=True, methods=["delete"], url_path=r"lists/(?P<list_id>[0-9a-f-]{36})")
    def detach_list(self, request, pk=None, list_id=None, version=None):
        campaign = self.get_object()
        if "edit" not in service.actions(campaign):
            raise Conflict("Lists can be changed while the campaign is a draft or test published.")
        link = ContactListCampaign.objects.filter(campaign=campaign, contact_list_id=list_id).select_related("contact_list").first()
        if link is None:
            raise NotFound("This list is not attached to the campaign.")
        name = link.contact_list.name
        ContactListCampaign.objects.filter(campaign=campaign, contact_list_id=list_id).delete()
        service.record(campaign, "LIST_DETACHED", f"Detached the contact list “{name}”.", user=request.user)
        return Response(status=204)

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"])
    def audience(self, request, pk=None, version=None):
        """Merged and de-duplicated across the attached lists, minus the excluded ones, with today's governance picture and a sample."""
        campaign = self.get_object()
        data = service.audience(campaign)
        frozen = campaign.campaign_lists.filter(status="FROZEN", campaign_run__test_mode=False).order_by("-generated_at").first()
        if frozen is not None:
            from apps.delivery.engine import runs as engine_runs
            data["frozen"] = {"members": frozen.member_count, "generated_at": frozen.generated_at, **engine_runs.stats(campaign.tenant_id, frozen.campaign_run_id)["audience"]}
        return Response(data)

    @extend_schema(parameters=[OpenApiParameter("include", str), OpenApiParameter("exclude", str), OpenApiParameter("channel", str), OpenApiParameter("solicitation_type", str)], responses=dict)
    @action(detail=False, methods=["get"], url_path="audience-estimate", pagination_class=None)
    def audience_estimate(self, request, version=None):
        """For the form, before anything is saved."""
        def ids(name):
            values = [value for value in request.query_params.get(name, "").split(",") if value]
            bad = [value for value in values if not re.match(r"^[0-9a-f-]{36}$", value)]
            if bad:
                raise ValidationError({name: "Expected contact list ids."})
            return values
        draft = Campaign(channel=(request.query_params.get("channel") or "EMAIL").upper(), solicitation_type=(request.query_params.get("solicitation_type") or "MARKETING").upper())
        return Response(service.audience(draft, include=ids("include"), exclude=ids("exclude")))

    @extend_schema(responses={(200, "text/csv"): str})
    @action(detail=True, methods=["get"], url_path="audience/export")
    def audience_export(self, request, pk=None, version=None):
        """The frozen Campaign List with who was left out and why; before the first send, the estimate's people."""
        campaign = self.get_object()
        frozen = campaign.campaign_lists.filter(status="FROZEN", campaign_run__test_mode=False).order_by("-generated_at").first()
        spool = tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024, mode="w+b")
        spool.write("﻿".encode("utf-8"))
        writer = csv.writer(_Echo())
        from django.db import connections
        with connections[context.require().db_alias].cursor() as cursor:
            if frozen is not None:
                spool.write(writer.writerow(["customer_id", "first_name", "last_name", "status", "left_out_because", "source_list"]).encode("utf-8"))
                cursor.execute("""SELECT m.party_id, cm.first_name, cm.last_name, m.status, m.suppression_reason, l.name
                                    FROM campaign_list_member m LEFT JOIN customer_master cm ON cm.party_id = m.party_id AND cm.tenant_id = m.tenant_id
                                    LEFT JOIN contact_list l ON l.id = m.source_contact_list_id
                                   WHERE m.tenant_id = %s AND m.campaign_list_id = %s ORDER BY m.id""", [str(campaign.tenant_id), str(frozen.pk)])
                for row in cursor:
                    spool.write(writer.writerow([_safe_cell(cell) for cell in row]).encode("utf-8"))
            else:
                spool.write(writer.writerow(["customer_id", "address", "first_name", "last_name", "status_today"]).encode("utf-8"))
                for person in service.audience(campaign, sample=1_000_000)["sample"]:
                    spool.write(writer.writerow([_safe_cell(person[key]) for key in ("party_id", "address", "first_name", "last_name", "status_label")]).encode("utf-8"))
        spool.seek(0)
        safe = "".join(ch if ch.isalnum() or ch in "-_ " else "_" for ch in campaign.name).strip() or "campaign"
        return FileResponse(spool, as_attachment=True, filename=f"{safe} - audience.csv", content_type="text/csv; charset=utf-8")

    # ------------------------------------------------------------ content
    @extend_schema(parameters=[OpenApiParameter("party_id", str, description="a customer of the workspace; default: the catalogue's sample values"),
                               OpenApiParameter("template", str, description="a template that is chosen in the form but not saved on the campaign yet")], responses=dict)
    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None, version=None):
        from apps.customers.models import CustomerMaster
        from apps.delivery.engine.render import Renderer
        campaign = self.get_object()
        template = campaign.template
        wanted = request.query_params.get("template")
        if wanted:
            if not re.match(r"^[0-9a-f-]{36}$", wanted):
                raise ValidationError({"template": "Expected a template id."})
            template = TemplateMaster.objects.filter(pk=wanted, tenant_id=campaign.tenant_id, deleted_at__isnull=True).first()
            if template is None:
                raise NotFound("No such template in this workspace.")
        content = RenderedTemplateContent.objects.filter(template_id=template.pk).order_by("-version_number").first() if template else None
        if content is None:
            raise Conflict("This template has no saved content yet." if template else "Choose a template first.")
        tags = list(PersonalizationTag.objects.filter(tenant_id=campaign.tenant_id, is_active=True, deleted_at__isnull=True))
        party_id = request.query_params.get("party_id")
        customer, member = {}, {"custom_value_pairs": {tag.tag_key.strip("{} "): tag.sample_value for tag in tags if tag.sample_value}}
        if party_id:
            customer = CustomerMaster.objects.filter(tenant_id=campaign.tenant_id, party_id=party_id).values("party_id", "first_name", "last_name", "custom_attributes", "emails", "phones").first()
            if customer is None:
                raise NotFound("No such customer in this workspace.")
            member = {"custom_value_pairs": {}}
        if template.channel in design.MESSAGE_CHANNELS:
            from apps.delivery.engine.dispatch_sms import text_content
            shaped = text_content(content)                  # a text message is the text part only
        else:
            shaped = content
        # as one customer: the catalogue resolves the tags from that person. Otherwise: the catalogue's sample values.
        rendered = Renderer(campaign=campaign, run=None, content=shaped, tags=tags if party_id else []).render(
            customer=customer, member=member, system={"unsubscribe_url": "#unsubscribe-preview", "email": ""})
        used = sorted(set(design.extract_tags((content.html_content or "") + (content.sms_body or "") + (content.subject_line or ""))))
        return Response({"subject": rendered.get("subject"), "html": rendered.get("html"), "text": rendered.get("text") or content.sms_body, "version": content.version_number,
                         "template": template.name, "template_id": str(template.pk), "channel": template.channel, "status": template.status, "tags_used": used, "customer": party_id})

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"], url_path="sample-customers", pagination_class=None)
    def sample_customers(self, request, pk=None, version=None):
        return Response([{"party_id": person["party_id"], "name": " ".join(filter(None, [person["first_name"], person["last_name"]])) or person["party_id"], "address": person["address"]}
                         for person in service.audience(self.get_object(), sample=25)["sample"]])

    # ------------------------------------------------------------ runs, results, log
    @extend_schema(responses=s.CampaignRunSerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=None)
    def runs(self, request, pk=None, version=None):
        return Response(s.CampaignRunSerializer(self.get_object().campaign_runs.order_by("-run_number"), many=True).data)

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"], url_path=r"runs/(?P<run_id>[0-9a-f-]{36})")
    def run_detail(self, request, pk=None, run_id=None, version=None):
        from apps.delivery.engine import runs as engine_runs
        campaign = self.get_object()
        run = campaign.campaign_runs.filter(pk=run_id).first()
        if run is None:
            raise NotFound("No such run for this campaign.")
        variants = [{"variant_key": v.variant_key, "subject_line": v.subject_line, "allocation_pct": v.allocation_pct, "is_winner": v.is_winner, "winner_metric": v.winner_metric}
                    for v in run.campaign_run_variants.filter(deleted_at__isnull=True)]
        return Response({**s.CampaignRunSerializer(run).data, "variants": variants, "results": engine_runs.stats(campaign.tenant_id, run.pk)})

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"])
    def metrics(self, request, pk=None, version=None):
        return Response(service.metrics(self.get_object()))

    @extend_schema(parameters=[OpenApiParameter("bucket", str, enum=["hour", "day"])], responses=dict)
    @action(detail=True, methods=["get"], url_path="metrics/timeseries")
    def metrics_timeseries(self, request, pk=None, version=None):
        return Response(service.timeseries(self.get_object(), request.query_params.get("bucket", "hour")))

    @extend_schema(responses=ActivitySerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=None)
    def activity(self, request, pk=None, version=None):
        return Response(ActivitySerializer(self.get_object().activity.all()[:200], many=True).data)
