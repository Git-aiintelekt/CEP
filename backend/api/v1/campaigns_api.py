"""Campaign module API (BRD v0.9 sections 6.3, 7, 15). Extends the campaign endpoints that were already there.

    GET    /campaigns/                     ?search= &type= &channel= &status= &date_from= &date_to= &date_field=created|scheduled
                                           &view=mine|sending_today|attention   (the list's saved views)
                                           &triggered_by=manual|journey &tag= &ordering= &page= &page_size=   (archived hidden unless status=ARCHIVED)
    POST   /campaigns/                     create (DRAFT)            PATCH / PUT  while it is a draft or test published
    DELETE /campaigns/{id}/                archives: a campaign is never deleted
    POST   /campaigns/{id}/test-publish/   {to: [addresses], user_ids: [internal users]}: a test Run, nothing counted; a drip tests every message, one after another
    POST   /campaigns/{id}/publish/        production publish: validates, creates the Run(s), schedules or starts the send
    POST   /campaigns/{id}/pause/  resume/  cancel-schedule/  clone/  archive/  unarchive/   (a drip that has sent can't be cancelled back to a draft)
    POST   /campaigns/{id}/stop/           a drip: cancel every unsent message for good; it is COMPLETED, stopped early (patch 0043)
    GET    /campaigns/{id}/resume-plan/    a paused drip: what Resume will do to the missed and later messages, without doing it
    POST   /campaigns/bulk/                {action: archive|clone|pause|resume, ids: [...]}
    GET    /campaigns/{id}/preview/        ?party_id= &step= : the content as that customer would get it; a drip previews one message (default the first)
    GET    /campaigns/{id}/lists/          POST {contact_list, role}       DELETE /campaigns/{id}/lists/{list_id}/
    GET    /campaigns/{id}/audience/       merged, de-duplicated, minus excluded lists, with today's governance picture; ?local_time=1 adds how many have a known time zone
    GET    /campaigns/audience-estimate/   the same for lists that are not saved yet: ?include=a,b &exclude=c &channel= &solicitation_type=
    GET    /campaigns/{id}/audience/export/   CSV of the frozen Campaign List (or of the estimate, before the first send)
    GET    /campaigns/{id}/runs/           GET /campaigns/{id}/runs/{run_id}/
    GET    /campaigns/{id}/metrics/        GET /campaigns/{id}/metrics/timeseries/?bucket=hour|day
    GET    /campaigns/{id}/activity/       what happened to it, newest first
    GET    /campaigns/form-options/        owners, tags in use, time zones: what the form's dropdowns need
    GET    /campaigns/{id}/checklist/      what stands between the campaign and a production publish (a drip: its messages ready, sendable and tested, a future start)
    POST   /campaigns/{id}/request-approval/  {note}   approve/  {note}   send-back/ {note}   (patch 0022; the workspace setting requires it)
    POST   /campaigns/{id}/runs/{run_id}/choose-winner/  {variant: A|B}   a person decides the subject-line test instead of the metric (patch 0023)
    POST   /campaigns/{id}/clone/          {scheduled_at?, name?}: a draft copy ("Copy of …" unless a name is given, checked like any name); a drip's messages
                                           come with new template copies, the start date only when given
    GET    /campaigns/{id}/steps/          a drip's messages in day order, with when each goes out, what it still needs (patch 0041) and its run with results (0042)
    POST   /campaigns/{id}/steps/          {start_from: copy|template|blank, source_step?, template?, starter?, day?, name?, consume_source?}: a message with its
                                           own template copy; consume_source soft-deletes the source when it is your own unused Draft (a preset's throwaway copy)
    PATCH  /campaigns/{id}/steps/{step_id}/   {name, day, send_time, subject_line, preheader, ab_config, template (copied in), consume_source?, row_version}
    DELETE /campaigns/{id}/steps/{step_id}/   not the last one; its own template copy goes with it
    POST   /campaigns/{id}/steps/{step_id}/copy-as-next/   a copy of that message after the last one
    POST   /campaigns/{id}/steps/{step_id}/test/   {to, user_ids}: test-send that one message again
    POST   /campaigns/{id}/steps/{step_id}/retry/   a failed message nobody received: a new run for it, now
    GET    /campaigns/{id}/steps/review/   the Test & Publish timeline: each message's time, subject, reach and warnings (TOO_CLOSE, FREQUENCY, QUIET_HOURS)
    PATCH  /campaigns/{id}/                a drip with drip_config {time} only saves the series time; the messages are never reshaped
    GET    /campaign-runs/{id}/skipped/    ?reason= &q= &page= &page_size=: the people a run skipped, with reason and address (recipients_api)

A campaign carries `paused {at, by_name}` while it is paused (patch 0044). Steps carry `text_excerpt` (SMS/MMS, first 140
characters) and their run block `not_sent`, plus `replied`/`opted_out` for texts.
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
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_field, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.campaigns import approval, drip, drip_lifecycle, drip_publish, service
from apps.campaigns.models import Campaign, CampaignActivityLog, CampaignDripStep, CampaignList, CampaignRun, CampaignTarget, ContactListCampaign
from apps.contact_lists.models import ContactList
from apps.identity.models import AppUser
from apps.platform_ops import billing
from apps.templates import design
from apps.templates.models import PersonalizationTag, RenderedTemplateContent, TemplateMaster
from apps.tenants import context

from . import serializers as s
from . import views
from apps.spreadsheet import safe_cell

log = logging.getLogger("cep.campaigns")
TARGET_FIELDS = ("target_revenue", "target_opens", "target_clicks", "target_conversions", "target_redemptions", "planned_cost", "planned_offer_cost", "notes")
STATUS_LABEL = {"SCHEDULED": "Scheduled", **dict(Campaign.Status.choices)}
TAG_RE = re.compile(r"^[\w .&/+-]{1,40}$")
CLOCK_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


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
    approval_required = serializers.SerializerMethodField(help_text="The workspace needs a second person to approve a production publish.")
    approval = serializers.SerializerMethodField(help_text="The approval request on the campaign: status REQUESTED, APPROVED or RETURNED, who asked and who decided; null before any.")
    drip_summary = serializers.SerializerMethodField(help_text="Drips only: {count, last_day, first_send_at, last_send_at, ready}; null for other campaigns.")
    drip_progress = serializers.SerializerMethodField(help_text="Drips only: {total, sent, failed, cancelled, next: {position, name, scheduled_at} | null}; null otherwise.")
    stopped_early = serializers.SerializerMethodField(help_text="A drip stopped early: {at, by_name, cancelled}; null otherwise.")
    paused = serializers.SerializerMethodField(help_text="While paused: {at, by_name} (patch 0044); null otherwise.")

    class Meta(s.CampaignSerializer.Meta):
        read_only_fields = s.AUDIT_FIELDS + ("status", "is_journey_generated", "origin_journey", "legacy_marketing_campaign_id", "previous_status", "published_at",
                                             "completed_at", "archived_at", "approval_status", "approval_requested_by", "approval_requested_at", "approval_note",
                                             "approval_decided_by", "approval_decided_at", "approval_decision_note", "stopped_at", "stopped_by",
                                             "paused_at", "paused_by")

    # ---- representation
    def get_display_status(self, campaign) -> str:
        return service.display_status(campaign)

    def get_display_status_label(self, campaign) -> str:
        return STATUS_LABEL.get(service.display_status(campaign), campaign.get_status_display())

    def get_actions(self, campaign) -> list[str]:
        return service.actions(campaign) + approval.actions(campaign)

    def get_approval_required(self, campaign) -> bool:
        return approval.required(campaign)

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_approval(self, campaign):
        return approval.state(campaign)

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_next_run_at(self, campaign):
        return service.next_run_at(campaign)

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_drip_summary(self, campaign):
        return drip.summary(campaign)

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_drip_progress(self, campaign):
        return drip_lifecycle.progress(campaign)

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_stopped_early(self, campaign):
        return drip_lifecycle.stopped_early(campaign)

    @extend_schema_field(serializers.DictField(allow_null=True))
    def get_paused(self, campaign):
        return service.paused(campaign)

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
        if current("campaign_type") == "DRIP":
            if current("channel") == "MULTI":
                errors["channel"] = "A drip uses one channel. Use a journey to mix channels."
            elif (self.instance is not None and "channel" in attrs and attrs["channel"] != self.instance.channel
                  and CampaignDripStep.objects.filter(campaign=self.instance, template__isnull=False).exists()):
                errors["channel"] = "The messages already have templates for this channel. Create a new drip to use another channel."
        if "recurring_config" in attrs and attrs["recurring_config"] and send_type == "RECURRING":
            problem = service.validate_recurring(attrs["recurring_config"])
            if problem:
                errors["recurring_config"] = problem
        self._series_time_only = False
        config = attrs.get("drip_config")
        if current("campaign_type") == "DRIP" and isinstance(config, dict) and "steps" not in config:
            # a drip's messages are rows of their own (campaign_drip_step): drip_config here carries only the series time,
            # which is merged into the stored config so the steps mirror stays exactly as it is
            if set(config) - {"time"}:
                errors["drip_config"] = "A drip's messages are set on its steps. Send only the series time here."
            elif config.get("time") is not None and not CLOCK_RE.match(str(config["time"])):
                errors["drip_config"] = "Enter the series time as HH:MM, for example 09:00."
            else:
                merged = dict(getattr(self.instance, "drip_config", None) or {})
                if config.get("time") is None:
                    merged.pop("time", None)
                else:
                    merged["time"] = str(config["time"])
                attrs["drip_config"] = merged
                self._series_time_only = True
        elif "drip_config" in attrs and attrs["drip_config"] and send_type == "DRIP":
            problem = service.validate_drip(attrs["drip_config"])
            if problem:
                errors["drip_config"] = problem
        if "send_timezone" in attrs and attrs["send_timezone"]:
            from zoneinfo import available_timezones
            if attrs["send_timezone"] not in available_timezones():
                errors["send_timezone"] = "Not a time zone C360 knows."
        if "ab_config" in attrs:
            from apps.delivery.engine import abtest
            problem = abtest.validate(attrs["ab_config"])
            if problem:
                errors["ab_config"] = problem
            elif attrs["ab_config"] and attrs["ab_config"].get("enabled") and current("channel") != "EMAIL":
                errors["ab_config"] = "A subject line test is for email campaigns: texts have no subject."
        if attrs.get("topic") is not None:
            topic = attrs["topic"]
            if str(topic.tenant_id) != context.require().tenant_id or topic.deleted_at is not None:
                errors["topic"] = "Choose one of this workspace's topics."
            elif current("channel") in ("SMS", "MMS") and "SMS" not in topic.channels or current("channel") == "EMAIL" and "EMAIL" not in topic.channels:
                errors["topic"] = f"“{topic.name}” is not offered for {'texts' if current('channel') in ('SMS', 'MMS') else 'email'}."
        for name in ("subject_line", "preheader"):                      # blank = the template's
            if name in attrs:
                attrs[name] = " ".join((attrs[name] or "").split()) or None
                if attrs[name] and current("channel") in ("SMS", "MMS"):
                    errors[name] = "A text message has no subject line or preheader."
        if current("campaign_type") == "DRIP":                        # a drip's messages carry these; empty values (the form saving everything) are fine
            sent = [name for name in ("subject_line", "preheader") if attrs.get(name)] + (["ab_config"] if (attrs.get("ab_config") or {}).get("enabled") else [])
            for name in [name for name in sent if self.instance is None or attrs[name] != getattr(self.instance, name)]:     # one saved before B2 may be sent back as it is
                errors[name] = "On a drip, set this on each message."
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
        drip.seed(campaign, self.context["request"].user)
        return self._fresh(campaign.pk)

    def update(self, campaign, validated_data):
        include, exclude, targets = validated_data.pop("contact_lists", None), validated_data.pop("excluded_lists", None), validated_data.pop("targets", None)
        words = {"name": "name", "description": "description", "template": "template", "sender_profile": "sender", "scheduled_at": "schedule", "send_type": "send type",
                 "recurring_config": "recurrence", "drip_config": "series", "tags": "tags", "owner_user": "owner", "respect_governance": "governance setting",
                 "rate_limit_per_hour": "send rate", "timezone_optimization": "time zone delivery", "send_timezone": "time zone", "receipt_config": "receipt settings",
                 "ab_config": "subject line test", "subject_line": "subject line", "preheader": "preheader", "topic": "topic",
                 "solicitation_type": "message kind", "campaign_type": "type", "channel": "channel", "code": "code"}
        changed = [words[name] for name, value in validated_data.items() if name in words and getattr(campaign, name) != value]
        before_template = campaign.template_id
        campaign = super().update(campaign, validated_data)
        reshaping = {"template", "campaign_type"} | (set() if getattr(self, "_series_time_only", False) else {"drip_config"})
        if reshaping & set(validated_data):
            drip.follow_campaign(campaign, before_template, self.context["request"].user)
        elif "name" in validated_data and campaign.campaign_type == Campaign.CampaignType.DRIP:
            drip.sync(campaign)                                      # the copies are named after the campaign: "{name} · 2 of 4"
        changed += self._after(campaign, include, exclude, targets, created=False)
        if changed:
            service.record(campaign, "MODIFIED", "Changed: " + ", ".join(dict.fromkeys(changed)) + ".", user=self.context["request"].user)
            approval.withdraw(campaign, self.context["request"].user, "the campaign was changed (" + ", ".join(dict.fromkeys(changed)) + ").")
        return self._fresh(campaign.pk)

    @staticmethod
    def _fresh(pk):
        """What was just written, read again: the lists and targets were changed after the instance was loaded."""
        return (Campaign.objects.select_related("template", "sender_profile", "owner_user", "tenant", "topic", "approval_requested_by", "approval_decided_by", "stopped_by", "paused_by")
                .prefetch_related("campaign_runs", "contact_list_campaigns__contact_list", "campaign_targets", "drip_steps__template").get(pk=pk))


class TestPublishSerializer(serializers.Serializer):
    to = serializers.ListField(child=serializers.CharField(max_length=254), required=False, default=list, max_length=20)
    user_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list, max_length=20)


class CloneSerializer(serializers.Serializer):
    scheduled_at = serializers.DateTimeField(required=False, allow_null=True, help_text="The copy's send time or start date; left out, the copy has none.")
    name = serializers.CharField(required=False, allow_blank=True, max_length=200, help_text="The copy's name; left out or blank, \"Copy of …\"")

    def validate_name(self, value):
        value = " ".join((value or "").split())
        if not value:
            return value
        # the same rules as naming a campaign (CampaignSerializer.validate_name): 3 characters, unique among live campaigns
        return CampaignSerializer.validate_name(CampaignSerializer(), value)

    def validate_scheduled_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Choose a time in the future.")
        return value


def _workspace_templates():
    return TemplateMaster.objects.filter(deleted_at__isnull=True)


class StepAddSerializer(serializers.Serializer):
    start_from = serializers.ChoiceField(choices=["copy", "template", "blank"], error_messages={"invalid_choice": "Start from a copy, a template or a blank message."})
    source_step = serializers.UUIDField(required=False, allow_null=True, help_text="start_from=copy: the message to copy; default the last one")
    template = serializers.PrimaryKeyRelatedField(queryset=_workspace_templates(), required=False, allow_null=True,
                                                  error_messages={"does_not_exist": "Choose one of this workspace's templates."}, help_text="start_from=template: copied for this message")
    starter = serializers.CharField(required=False, allow_blank=True, help_text="start_from=template: a key from /template-starters/ instead of a template")
    day = serializers.IntegerField(required=False, allow_null=True, help_text="default: the last message's day + 3", error_messages={"invalid": "Enter the day as a whole number."})
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    consume_source = serializers.BooleanField(required=False, default=False,
                                              help_text="start_from=template: soft-delete the template afterwards when it is an unused DRAFT you created (a preset saved only to start this message)")


class StepUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    day = serializers.IntegerField(required=False, error_messages={"invalid": "Enter the day as a whole number."})
    send_time = serializers.TimeField(required=False, allow_null=True, format="%H:%M", help_text="HH:MM; null = the series time")
    subject_line = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=300, trim_whitespace=False)
    preheader = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=300, trim_whitespace=False)
    ab_config = serializers.JSONField(required=False, allow_null=True)
    template = serializers.PrimaryKeyRelatedField(queryset=_workspace_templates(), required=False, allow_null=True,
                                                  error_messages={"does_not_exist": "Choose one of this workspace's templates."}, help_text="a template to copy in for this message")
    consume_source = serializers.BooleanField(required=False, default=False, help_text="with template: soft-delete it afterwards when it is an unused DRAFT you created")
    row_version = serializers.IntegerField(required=False)


class ApprovalNoteSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default="", max_length=approval.NOTE_MAX, trim_whitespace=True)


class BulkSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["archive", "clone", "pause", "resume"])
    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False, max_length=100)


class AttachSerializer(serializers.Serializer):
    contact_list = serializers.UUIDField()
    role = serializers.ChoiceField(choices=["INCLUDE", "EXCLUDE"], default="INCLUDE")


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = CampaignActivityLog
        fields = ("id", "event_type", "severity", "message", "detail", "actor_name", "campaign_run_id", "occurred_at")


_safe_cell = safe_cell


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
        qs = (super().get_queryset().select_related("owner_user", "tenant", "approval_requested_by", "approval_decided_by", "stopped_by", "paused_by").prefetch_related("campaign_targets", "drip_steps__template", drip.latest_contents_prefetch())
              .annotate(list_count=Coalesce(Subquery(attached, output_field=IntegerField()), 0), next_run=Subquery(upcoming),
                        frozen_members=Subquery(frozen, output_field=IntegerField())))
        if self.action not in ("list", "calendar"):
            return qs
        params = self.request.query_params
        future_run = CampaignRun.objects.filter(campaign_id=OuterRef("pk"), test_mode=False, status="SCHEDULED", scheduled_at__gt=timezone.now())
        # a drip that has started sending is Active, never Scheduled (drip_lifecycle.display_status)
        drip_started = Q(campaign_type="DRIP") & Exists(CampaignRun.objects.filter(campaign_id=OuterRef("pk"), test_mode=False, started_at__isnull=False))
        statuses = [item for item in params.get("status", "").upper().split(",") if item]
        unknown = [item for item in statuses if item not in STATUS_LABEL]
        if unknown:
            raise ValidationError({"status": f"Unknown status: {', '.join(unknown)}"})
        if statuses:
            wanted = Q()
            for item in statuses:
                if item == "SCHEDULED":
                    wanted |= Q(status="PRODUCTION_PUBLISHED") & Exists(future_run) & ~drip_started
                elif item == "PRODUCTION_PUBLISHED":
                    wanted |= Q(status="PRODUCTION_PUBLISHED") & ~Exists(future_run) & ~drip_started
                elif item == "ACTIVE":
                    wanted |= Q(status="ACTIVE") | (Q(status="PRODUCTION_PUBLISHED") & drip_started)
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
        if params.get("view"):
            qs = self._saved_view(qs, params["view"].lower())
        if params.get("approval"):
            wanted = params["approval"].upper()
            if wanted not in (approval.REQUESTED, approval.APPROVED, approval.RETURNED):
                raise ValidationError({"approval": "Use requested, approved or returned."})
            qs = qs.filter(approval_status=wanted, status__in=service.EDITABLE)
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

    def _saved_view(self, qs, view: str):
        """mine: owned by the signed-in person. sending_today: a send starts or runs today (workspace zone). attention: paused,
        a failed send in the last week, or waiting for approval."""
        from zoneinfo import ZoneInfo
        from apps.tenants.models import Tenant
        if view == "mine":
            user = self.request.user
            return qs.filter(owner_user_id=user.pk) if not hasattr(user, "has_scope") else qs.none()
        if view == "sending_today":
            tenant = Tenant.objects.get(pk=context.require().tenant_id)
            try:
                zone = ZoneInfo(tenant.timezone or "UTC")
            except Exception:                              # noqa: BLE001
                zone = ZoneInfo("UTC")
            start = timezone.now().astimezone(zone).replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timezone.timedelta(days=1)
            today = CampaignRun.objects.filter(campaign_id=OuterRef("pk"), test_mode=False).filter(
                Q(status="SCHEDULED", scheduled_at__gte=start, scheduled_at__lt=end) | Q(status__in=["PREPARING", "SENDING"]) | Q(started_at__gte=start, started_at__lt=end))
            return qs.filter(Exists(today))
        if view == "attention":
            failed = CampaignRun.objects.filter(campaign_id=OuterRef("pk"), test_mode=False, status="FAILED", completed_at__gte=timezone.now() - timezone.timedelta(days=7))
            return qs.filter(Q(status="PAUSED") | Q(approval_status=approval.REQUESTED, status__in=service.EDITABLE) | Exists(failed))
        raise ValidationError({"view": "Use mine, sending_today or attention."})

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
            problem = service.content_problem(campaign.template, campaign.solicitation_type)
            if problem:
                missing["template"] = problem
        return missing

    @extend_schema(request=None, responses=dict)
    @action(detail=True, methods=["get"], url_path="checklist")
    def checklist(self, request, pk=None, version=None):
        """What stands between this campaign and a production publish, without publishing it."""
        campaign = self.get_object()
        tested = campaign.campaign_runs.filter(test_mode=True).exists()
        holdup = approval.problem(campaign)
        if campaign.campaign_type == Campaign.CampaignType.DRIP:         # every message ready, sendable and tested: required, not advisory
            problems = drip_publish.problems(campaign)
            items = drip_publish.checklist_items(campaign, problems)
            if holdup:
                problems["approval"] = holdup
            return Response({"ready": not problems, "problems": problems, "test_sent": tested,
                             "items": items + ([{"key": "approval", "label": "Approved for production", "ok": holdup is None, "problem": holdup}] if approval.required(campaign) else [])})
        problems = self._content_problems(campaign, service.publish_problems(campaign, production=True))
        if holdup:
            problems["approval"] = holdup
        return Response({"ready": not problems, "problems": problems, "test_sent": tested,
                         "items": [{"key": key, "label": label, "ok": key not in problems, "problem": problems.get(key)}
                                   for key, label in (("template", "Template content finalized"), ("contact_lists", "Campaign List attached"), ("sender_profile", "Verified sender chosen"),
                                                      ("topic", "Topic chosen"), ("scheduled_at", "Send time set"), ("recurring_config", "Recurrence valid"), ("drip_config", "Series steps valid"))
                                   if key in problems or key in ("template", "contact_lists", "sender_profile")]
                                  + [{"key": "test", "label": "Test message sent and reviewed", "ok": tested, "problem": None if tested else "Send yourself a test before publishing.", "advisory": True}]
                                  + ([{"key": "approval", "label": "Approved for production", "ok": holdup is None, "problem": holdup}] if approval.required(campaign) else [])})

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def publish(self, request, pk=None, version=None):
        """Production publish: validates, creates the Run(s) and schedules or starts the send. The Campaign List is frozen when a Run starts."""
        campaign = self.get_object()
        if campaign.is_journey_generated:
            raise Conflict("This campaign is generated by a journey. It is published by approving the journey.")
        if campaign.status not in self.EDITABLE:
            raise Conflict("Campaign cannot be published from its current status.")
        drip_campaign = campaign.campaign_type == Campaign.CampaignType.DRIP
        missing = drip_publish.problems(campaign) if drip_campaign else self._content_problems(campaign, service.publish_problems(campaign, production=True))
        if missing:
            raise ValidationError(missing)
        holdup = approval.problem(campaign)
        if holdup:
            raise Conflict(holdup)
        billing.assert_can_send(campaign.tenant_id)          # 409 when a hard-capped plan has used its messages this month
        if drip_campaign:
            with transaction.atomic(using=context.require().db_alias):      # a copy that can't be activated undoes the whole publish
                activated = drip_publish.activate_copies(campaign)
            if activated:
                service.record(campaign, "MODIFIED", f"Activated the messages' templates: {', '.join(activated)}.", user=request.user)
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

    def _test_recipients(self, request, campaign) -> list[str]:
        from apps.delivery.engine import runs as engine_runs
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
        return to

    def _test_messages(self, campaign, steps, to):
        """A drip's test: each message in `steps`, one after another, to `to` (drip_publish.send_tests)."""
        sender = {key: value for key, value in service.publish_problems(campaign, production=False).items() if key == "sender_profile"}
        if sender:
            raise ValidationError(sender)
        outcome = drip_publish.send_tests(campaign, steps, to, self.request.user)
        return Response({"messages": outcome, "status": Campaign.objects.values_list("status", flat=True).get(pk=campaign.pk)})

    @extend_schema(request=TestPublishSerializer, responses=dict)
    @action(detail=True, methods=["post"], url_path=r"steps/(?P<step_id>[0-9a-f-]{36})/test")
    def test_step(self, request, pk=None, step_id=None, version=None):
        """Test-sends one message of a drip again, with the same body as test-publish."""
        campaign = self._drip()
        step = self._step(campaign, step_id)
        if "test_publish" not in service.actions(campaign):
            raise Conflict("A test can be sent while the campaign is a draft or test published.")
        return self._test_messages(campaign, [step], self._test_recipients(request, campaign))

    @extend_schema(request=None, responses={201: dict})
    @action(detail=True, methods=["post"], url_path=r"steps/(?P<step_id>[0-9a-f-]{36})/retry",
            permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def retry_step(self, request, pk=None, step_id=None, version=None):
        """A failed message nobody received is sent again: a new run for it, now (it waits while the drip is paused)."""
        campaign = self._drip()
        run = self._act(drip_lifecycle.retry, campaign, self._step(campaign, step_id), request.user)
        if campaign.status != Campaign.Status.PAUSED:
            transaction.on_commit(lambda: views._enqueue_run(str(campaign.tenant_id), str(run.pk)), using=context.require().db_alias)
        return Response(s.CampaignRunSerializer(run).data, status=201)

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"], url_path="steps/review", pagination_class=None)
    def steps_review(self, request, pk=None, version=None):
        """The Test & Publish timeline: per message its time, subject, estimated reach and warnings; and a summary."""
        return Response(drip_publish.review(self._drip()))

    @extend_schema(request=TestPublishSerializer, responses=dict)
    @action(detail=True, methods=["post"], url_path="test-publish")
    def test_publish(self, request, pk=None, version=None):
        """Sends the current content to internal people only. Creates a test Run; nothing counts towards the campaign's results."""
        from apps.delivery.engine import dispatch, dispatch_sms, runs as engine_runs
        from apps.delivery.providers import ProviderError
        campaign = self.get_object()
        if "test_publish" not in service.actions(campaign):
            raise Conflict("A test can be sent while the campaign is a draft or test published.")
        texts = engine_runs.family(campaign) == "SMS"
        to = self._test_recipients(request, campaign)
        if campaign.campaign_type == Campaign.CampaignType.DRIP:
            return self._test_messages(campaign, drip.steps_of(campaign), to)
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
        # an address counts as reached when every message to it went (two with a subject line test)
        accepted = sum(1 for address in to if all(item.get("ok") for item in results if item["to"] == address))
        CampaignRun.objects.filter(pk=run.pk).update(status="COMPLETED" if any(item.get("ok") for item in results) else "FAILED", completed_at=timezone.now())
        if campaign.status == Campaign.Status.DRAFT and any(item.get("ok") for item in results):
            campaign.status = Campaign.Status.TEST_PUBLISHED
            campaign.save(update_fields=["status"])
        service.record(campaign, "TEST_PUBLISHED", f"Test sent to {accepted} of {len(to)}: {', '.join(to)}. Tests do not count towards results.", user=request.user, run=run,
                       severity="INFO" if accepted == len(to) else "WARNING", detail={"results": results})
        return Response({"run": str(run.pk), "results": results, "status": campaign.status})

    # ------------------------------------------------------------ approval
    def _note(self, request) -> str:
        body = ApprovalNoteSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return body.validated_data["note"]

    @extend_schema(request=ApprovalNoteSerializer, responses=CampaignSerializer)
    @action(detail=True, methods=["post"], url_path="request-approval", permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.edit")])
    def request_approval(self, request, pk=None, version=None):
        """The author asks: everyone who can approve is emailed with the note."""
        return self._answer(self._act(approval.request, self.get_object(), request.user, self._note(request)))

    @extend_schema(request=ApprovalNoteSerializer, responses=CampaignSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_(approval.PERMISSION)])
    def approve(self, request, pk=None, version=None):
        return self._answer(self._act(approval.approve, self.get_object(), request.user, self._note(request)))

    @extend_schema(request=ApprovalNoteSerializer, responses=CampaignSerializer)
    @action(detail=True, methods=["post"], url_path="send-back", permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_(approval.PERMISSION)])
    def send_back(self, request, pk=None, version=None):
        """Sent back with what should change; the author is told."""
        return self._answer(self._act(approval.send_back, self.get_object(), request.user, self._note(request)))

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

    @extend_schema(request=None, responses=CampaignSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def stop(self, request, pk=None, version=None):
        """A running or paused drip: every unsent message is cancelled for good, and the drip is completed, stopped early."""
        return self._answer(self._act(drip_lifecycle.stop, self.get_object(), request.user))

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"], url_path="resume-plan", permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def resume_plan(self, request, pk=None, version=None):
        """What Resume will do to a paused drip's timetable: {missed, moved, unchanged}. Resume applies this same plan."""
        campaign = self._drip()
        if campaign.status != Campaign.Status.PAUSED:
            raise Conflict("Only a paused drip has a resume plan.")
        return Response(drip_lifecycle.public_plan(drip_lifecycle.resume_plan(campaign)))

    @extend_schema(request=CloneSerializer, responses={201: CampaignSerializer})
    @action(detail=True, methods=["post"])
    def clone(self, request, pk=None, version=None):
        body = CloneSerializer(data=request.data or {})
        body.is_valid(raise_exception=True)
        copy = service.clone(self.get_object(), request.user, code=s.CampaignSerializer._next_code(), scheduled_at=body.validated_data.get("scheduled_at"),
                             name=body.validated_data.get("name") or None)
        return self._answer(copy, 201)

    # ------------------------------------------------------------ drip messages
    def _drip(self):
        campaign = self.get_object()
        if campaign.campaign_type != Campaign.CampaignType.DRIP:
            raise Conflict("Only a drip campaign has a series of messages.")
        return campaign

    def _step(self, campaign, step_id):
        step = CampaignDripStep.objects.filter(campaign=campaign, pk=step_id).select_related("template").first()
        if step is None:
            raise NotFound("No such message in this drip.")
        return step

    @staticmethod
    def _step_answer(campaign, step, status=200):
        campaign = Campaign.objects.select_related("tenant").get(pk=campaign.pk)
        return Response(next(row for row in drip.payloads(campaign, with_tests=True) if row["id"] == str(step.pk)), status=status)

    @extend_schema(methods=["GET"], responses=dict)
    @extend_schema(methods=["POST"], request=StepAddSerializer, responses={201: dict})
    @action(detail=True, methods=["get", "post"], url_path="steps", pagination_class=None)
    def steps(self, request, pk=None, version=None):
        """A drip's messages in day order: when each goes out (scheduled_for, from the start date) and what it still needs (problems)."""
        campaign = self._drip()
        if request.method == "GET":
            return Response(drip.payloads(campaign, with_runs=True, with_tests=True))
        body = StepAddSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        values = dict(body.validated_data)
        source = self._step(campaign, values.pop("source_step")) if values.get("source_step") else None
        values.pop("source_step", None)
        consume = values.pop("consume_source", False)
        step = drip.add_step(campaign, request.user, source_step=source, consume_source_template=consume, **values)
        return self._step_answer(campaign, step, 201)

    @extend_schema(methods=["PATCH"], request=StepUpdateSerializer, responses=dict)
    @extend_schema(methods=["DELETE"], request=None, responses={204: None})
    @action(detail=True, methods=["patch", "delete"], url_path=r"steps/(?P<step_id>[0-9a-f-]{36})")
    def step_detail(self, request, pk=None, step_id=None, version=None):
        campaign = self._drip()
        step = self._step(campaign, step_id)
        if request.method == "DELETE":
            drip.remove_step(campaign, step, request.user)
            return Response(status=204)
        body = StepUpdateSerializer(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        values = dict(body.validated_data)
        row_version = values.pop("row_version", None)
        consume = values.pop("consume_source", False)
        step = drip.update_step(campaign, step, request.user, values, row_version=row_version, consume_source_template=consume)
        return self._step_answer(campaign, step)

    @extend_schema(request=None, responses={201: dict})
    @action(detail=True, methods=["post"], url_path=r"steps/(?P<step_id>[0-9a-f-]{36})/copy-as-next")
    def copy_as_next(self, request, pk=None, step_id=None, version=None):
        """The same as POST steps/ with start_from=copy from this message: it lands after the last one."""
        campaign = self._drip()
        step = drip.add_step(campaign, request.user, start_from="copy", source_step=self._step(campaign, step_id))
        return self._step_answer(campaign, step, 201)

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
        wanted = body.validated_data["action"]
        if wanted in ("pause", "resume") and not (getattr(request.user, "is_platform_admin", False) or (request.user.has_scope("campaign:publish") if hasattr(request.user, "has_scope")
                                                                                                          else "campaign.publish" in request.user.permission_codes())):
            raise PermissionDenied("Pausing and resuming need the campaign.publish permission.")
        done, skipped = [], []
        for campaign in self.get_queryset().filter(pk__in=body.validated_data["ids"]):
            try:
                with transaction.atomic():
                    if wanted == "archive":
                        result = service.archive(campaign, request.user)
                    elif wanted == "pause":
                        result = service.pause(campaign, request.user)
                    elif wanted == "resume":
                        result, run_ids = service.resume(campaign, request.user)
                        for run_id in run_ids:
                            transaction.on_commit(lambda run_id=run_id: views._enqueue_run(str(campaign.tenant_id), run_id), using=context.require().db_alias)
                    else:
                        result = service.clone(campaign, request.user, code=s.CampaignSerializer._next_code())
                done.append({"id": str(result.pk), "name": result.name})
            except service.ActionError as exc:
                skipped.append({"id": str(campaign.pk), "name": campaign.name, "reason": str(exc)})
        return Response({"action": wanted, "done": done, "skipped": skipped})

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
                approval.withdraw(campaign, request.user, f"the contact list “{item.name}” was {'excluded' if link.role == 'EXCLUDE' else 'attached'}.")
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
        approval.withdraw(campaign, request.user, f"the contact list “{name}” was detached.")
        return Response(status=204)

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"])
    def audience(self, request, pk=None, version=None):
        """Merged and de-duplicated across the attached lists, minus the excluded ones, with today's governance picture and a sample."""
        campaign = self.get_object()
        data = service.audience(campaign)
        # ?local_time=1: the count is wanted before the setting is saved (the setup shows it as the box is ticked)
        if (campaign.timezone_optimization or request.query_params.get("local_time") == "1") and not campaign.is_journey_generated:
            from apps.delivery.engine import sendtime
            from django.db import connections
            with connections[context.require().db_alias].cursor() as cursor:
                data["local_time"] = sendtime.coverage(cursor, tenant_id=campaign.tenant_id, include=[item["id"] for item in data["lists"] if item["role"] == "INCLUDE"],
                                                       exclude=[item["id"] for item in data["lists"] if item["role"] == "EXCLUDE"])
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
                               OpenApiParameter("step", str, description="a drip's message; default its first"),
                               OpenApiParameter("template", str, description="a template that is chosen in the form but not saved on the campaign yet")], responses=dict)
    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None, version=None):
        from apps.customers.models import CustomerMaster
        from apps.delivery.engine.render import Renderer
        campaign = self.get_object()
        template = campaign.template
        wanted = request.query_params.get("template")
        step = None
        if campaign.campaign_type == Campaign.CampaignType.DRIP:      # a message: its template, its subject and preheader, never the campaign's
            wanted_step = request.query_params.get("step")
            if wanted_step:
                if not re.match(r"^[0-9a-f-]{36}$", wanted_step):
                    raise ValidationError({"step": "Expected a message id."})
                step = self._step(campaign, wanted_step)
            else:
                step = next(iter(drip.steps_of(campaign)), None)
            if step is not None and not wanted:
                template = step.template if step.template_id and step.template.deleted_at is None else None
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
        rendered = Renderer(campaign=campaign, run=None, content=shaped, tags=tags if party_id else [], step=step).render(
            customer=customer, member=member, system={"unsubscribe_url": "#unsubscribe-preview", "preference_url": "#preferences-preview", "email": ""})
        own_source = step if step is not None else campaign
        own = (own_source.subject_line or "") + (own_source.preheader or "") if template.channel not in design.MESSAGE_CHANNELS else ""
        used = sorted(set(design.extract_tags((content.html_content or "") + (content.sms_body or "") + (content.subject_line or "") + (content.preheader or "") + own)))
        return Response({"subject": rendered.get("subject"), "preheader": rendered.get("preheader") or "", "html": rendered.get("html"), "text": rendered.get("text") or content.sms_body, "version": content.version_number,
                         "template": template.name, "template_id": str(template.pk), "channel": template.channel, "status": template.status, "tags_used": used, "customer": party_id,
                         "step": str(step.pk) if step is not None else None})

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
        from apps.delivery.engine import abtest
        return Response({**s.CampaignRunSerializer(run).data, "variants": abtest.summary(run), "results": engine_runs.stats(campaign.tenant_id, run.pk)})

    @extend_schema(request=inline_serializer("ChooseWinner", {"variant": serializers.ChoiceField(choices=["A", "B"])}), responses=dict)
    @action(detail=True, methods=["post"], url_path=r"runs/(?P<run_id>[0-9a-f-]{36})/choose-winner",
            permission_classes=[IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.publish")])
    def choose_winner(self, request, pk=None, run_id=None, version=None):
        """A person picks the subject line instead of waiting for the metric; the held messages go out with it."""
        from apps.delivery.engine import abtest, session as engine_session
        campaign = self.get_object()
        run = campaign.campaign_runs.filter(pk=run_id).first()
        if run is None:
            raise NotFound("No such run for this campaign.")
        try:
            with engine_session.tenant_scope(campaign.tenant_id):
                decided = abtest.decide(campaign.tenant_id, run.pk, chosen=str(request.data.get("variant", "")).upper(), user=request.user)
        except ValueError as exc:
            raise Conflict(str(exc)) from None
        return Response(decided)

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
