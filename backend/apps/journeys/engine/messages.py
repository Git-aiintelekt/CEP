"""Send message steps (EMAIL, SMS, MMS), through the campaign send engine and nothing else.

    config: {template_id, sender_profile_id?, solicitation_type?: MARKETING | TRANSACTIONAL, name?}

Each step has one generated campaign a day (journey_generated_campaign: campaign_type JOURNEY, is_journey_generated). The
customers who reach the step are added to the campaign's waiting run (journey_generated_campaign_run): a JOURNEY_INSTANCE
run whose audience is a hidden contact list of just those people (status DRAFT, is_master false, so it never shows in the
list pages or pickers). The dispatch-campaign-runs job starts the run like any other: the campaign list is frozen, every
governance rule applies (consent, suppression, blocked addresses, frequency caps, quiet hours), and the messages go out.
Once a run has started, the next customer to arrive opens the next run, with a list of its own.

The customer waits on the step until the run has judged them, then moves on either way: SUCCESS when the message was
queued, SKIPPED (with the suppression reason) when governance held it back, FAILED when the run could not send at all.
"""
import uuid
from datetime import datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.campaigns.models import Campaign, CampaignList, CampaignListMember, CampaignRun, ContactListCampaign
from apps.contact_lists.models import ContactList, ContactListMember
from apps.delivery.models import SenderProfile
from apps.templates.models import TemplateMaster

from ..models import JourneyGeneratedCampaign, JourneyGeneratedCampaignRun
from .outcome import Done, Hold

LOOK_AGAIN = timedelta(minutes=1)
GIVE_UP = timedelta(days=1)                              # a run that has not started after a day (a paused campaign, a broken sender) is a failure
SENDER_CHANNEL = {"EMAIL": ("EMAIL",), "SMS": ("SMS",), "MMS": ("MMS", "SMS")}
STARTED = ("SENDING", "COMPLETED", "FAILED", "CANCELLED", "PAUSED")


def _campaign(node, enrollment, config) -> Campaign | Done:
    """Today's generated campaign for this step, made on first use."""
    today = timezone.localdate()
    link = JourneyGeneratedCampaign.objects.select_related("campaign").filter(journey_node=node, generation_date=today).first()
    if link is not None:
        return link.campaign
    template = TemplateMaster.objects.filter(tenant_id=enrollment.tenant_id, pk=config.get("template_id"), deleted_at__isnull=True).first() \
        if config.get("template_id") else None
    if template is None:
        return Done("FAILED", {"reason": "The step's template does not exist (any more)."})
    if template.status == "ARCHIVED" or template.channel != node.node_type:
        return Done("FAILED", {"reason": f"The template is archived or not a {node.node_type} template."})
    senders = SenderProfile.objects.filter(tenant_id=enrollment.tenant_id, deleted_at__isnull=True, channel__in=SENDER_CHANNEL[node.node_type])
    sender = senders.filter(pk=config["sender_profile_id"]).first() if config.get("sender_profile_id") else senders.order_by("-is_default", "created_at").first()
    if sender is None:
        return Done("FAILED", {"reason": f"There is no {node.node_type.lower()} sender to send from."})
    journey = enrollment.journey
    solicitation = "TRANSACTIONAL" if str(config.get("solicitation_type") or "").upper() == "TRANSACTIONAL" else "MARKETING"
    try:
        with transaction.atomic():                       # savepoint: two passes making today's campaign at once
            campaign = Campaign.objects.create(
                tenant_id=enrollment.tenant_id, name=f"{journey.name}: {config.get('name') or node.node_key} ({today:%d %b %Y})"[:200],
                campaign_type="JOURNEY", channel=node.node_type, status="PRODUCTION_PUBLISHED", solicitation_type=solicitation, template=template,
                sender_profile=sender, origin_journey=journey, is_journey_generated=True, owner_user_id=journey.owner_user_id,
                code=f"JRN-{today:%Y%m%d}-{uuid.uuid4().hex[:8].upper()}", published_at=timezone.now(),
                description=f"Sent by the journey {journey.name} ({journey.code}), step {node.node_key}.")
            JourneyGeneratedCampaign.objects.create(journey=journey, journey_node=node, campaign=campaign, tenant_id=enrollment.tenant_id, generation_date=today)
    except IntegrityError:
        return JourneyGeneratedCampaign.objects.select_related("campaign").get(journey_node=node, generation_date=today).campaign
    return campaign


def _open_run(campaign, node) -> tuple[CampaignRun, ContactList] | None:
    """The campaign's run that has not started yet (locked, so it cannot start while people are added), or a new one.
    None while the newest run is being prepared: its audience is read from the attached list, which must not change under it."""
    Campaign.objects.select_for_update().get(pk=campaign.pk)             # one pass at a time opens a campaign's runs
    latest = CampaignRun.objects.select_for_update().filter(campaign=campaign).order_by("-run_number").first()
    if latest is not None and latest.status == "PREPARING":
        return None
    run = latest if latest is not None and latest.status == "SCHEDULED" else None
    link = ContactListCampaign.objects.select_related("contact_list").filter(campaign=campaign, role="INCLUDE").first()
    if run is not None and link is not None:
        return run, link.contact_list
    ContactListCampaign.objects.filter(campaign=campaign).delete()        # the previous run froze its list: the next one starts empty
    now = timezone.now()
    contact_list = ContactList.objects.create(
        tenant_id=campaign.tenant_id, name=f"{campaign.name} {now:%H:%M:%S} {uuid.uuid4().hex[:6]}"[:200], source_type="EXTRACTION",
        source_reference=f"journey:{campaign.origin_journey_id}:{node.node_key}", list_kind="STATIC", is_master=False, status="DRAFT",
        channel="EMAIL" if node.node_type == "EMAIL" else "SMS", description="Customers who reached this journey step, sent together.")
    ContactListCampaign.objects.create(campaign=campaign, contact_list=contact_list, tenant_id=campaign.tenant_id, role="INCLUDE")
    if run is None:
        number = (CampaignRun.objects.filter(campaign=campaign).order_by("-run_number").values_list("run_number", flat=True).first() or 0) + 1
        run = CampaignRun.objects.create(campaign=campaign, tenant_id=campaign.tenant_id, run_number=number, run_type="JOURNEY_INSTANCE", scheduled_at=now)
        JourneyGeneratedCampaignRun.objects.create(journey_generated_campaign=JourneyGeneratedCampaign.objects.get(campaign=campaign), campaign_run=run,
                                                   tenant_id=campaign.tenant_id, execution_window_start=now, execution_window_end=now + timedelta(seconds=1))
    return run, contact_list


def _enqueue(node, state, enrollment) -> Hold | Done:
    campaign = _campaign(node, enrollment, node.config or {})
    if isinstance(campaign, Done):
        return campaign
    opened = _open_run(campaign, node)
    if opened is None:
        return Hold(timezone.now() + LOOK_AGAIN)
    run, contact_list = opened
    if not ContactListMember.objects.filter(tenant_id=enrollment.tenant_id, contact_list=contact_list, party_id=enrollment.party_id).exists():
        ContactListMember.objects.create(contact_list=contact_list, tenant_id=enrollment.tenant_id, party_id=enrollment.party_id,
                                         membership_source="RULE", matched_by="PARTY_ID")
        ContactList.objects.filter(pk=contact_list.pk).update(member_count=contact_list.member_count + 1)
        contact_list.member_count += 1
        JourneyGeneratedCampaignRun.objects.filter(campaign_run=run).update(execution_window_end=timezone.now() + timedelta(seconds=1))
    state.state_data["pending"] = {"step": node.node_key, "run": str(run.pk), "since": timezone.now().isoformat()}
    return Hold(timezone.now() + LOOK_AGAIN)


def _verdict(pending: dict, enrollment) -> Hold | Done:
    run = CampaignRun.objects.filter(tenant_id=enrollment.tenant_id, pk=pending["run"]).first()
    if run is None:
        return Done("FAILED", {"reason": "The send was removed."})
    member = (CampaignListMember.objects.filter(tenant_id=enrollment.tenant_id, party_id=enrollment.party_id,
                                                campaign_list__in=CampaignList.objects.filter(campaign_run=run))
              .values("status", "suppression_reason").first())
    if member is not None:
        if member["status"] == "SUPPRESSED":
            return Done("SKIPPED", {"reason": member["suppression_reason"], "campaign_run": str(run.pk)}, run_id=str(run.pk))
        return Done(result={"campaign_run": str(run.pk), "campaign": str(run.campaign_id)}, run_id=str(run.pk))
    if run.status in STARTED:
        return Done("FAILED", {"reason": f"The send {run.get_status_display().lower()} without this customer.", "campaign_run": str(run.pk)}, run_id=str(run.pk))
    waiting_since = datetime.fromisoformat(pending["since"])
    if timezone.now() - waiting_since > GIVE_UP:
        return Done("FAILED", {"reason": "The send did not start within a day.", "campaign_run": str(run.pk)}, run_id=str(run.pk))
    return Hold(timezone.now() + LOOK_AGAIN)


def step(node, state, enrollment) -> Hold | Done:
    pending = state.state_data.get("pending")
    if pending and pending.get("step") == node.node_key:
        return _verdict(pending, enrollment)
    return _enqueue(node, state, enrollment)
