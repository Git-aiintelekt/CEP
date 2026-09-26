"""Approval before a production publish (patch 0022).

A workspace switches it on in Settings → Approvals (tenant.settings.approvals.require_approval). Then a campaign goes
REQUESTED (the author asks, with a note) → APPROVED or RETURNED (someone with campaign.approve decides, never the person
who asked) and the publish endpoint refuses anything but APPROVED. A change to the campaign after the request withdraws
it: what was approved is what goes out.
"""
from django.utils import timezone

from apps.identity.models import UserRole
from apps.platform_ops import notifications
from apps.tenants.models import Tenant

from . import service
from .models import Campaign

KEY = "approvals"
PERMISSION = "campaign.approve"
REQUESTED, APPROVED, RETURNED = "REQUESTED", "APPROVED", "RETURNED"
NOTE_MAX = 1000


def required(campaign_or_tenant) -> bool:
    tenant = campaign_or_tenant if isinstance(campaign_or_tenant, Tenant) else campaign_or_tenant.tenant
    return bool((tenant.settings.get(KEY) or {}).get("require_approval"))


def set_required(tenant, value: bool) -> None:
    tenant.settings = {**tenant.settings, KEY: {**(tenant.settings.get(KEY) or {}), "require_approval": bool(value)}}
    tenant.save(update_fields=["settings"])


def is_approved(campaign) -> bool:
    return campaign.approval_status == APPROVED


def approvers(tenant_id) -> list:
    """Active users of the workspace whose roles carry campaign.approve."""
    links = (UserRole.objects.filter(role__tenant_id=tenant_id, role__deleted_at__isnull=True, role__role_permissions__permission__code=PERMISSION,
                                     user__is_active=True, user__deleted_at__isnull=True).select_related("user").order_by("user__display_name"))
    people = {}
    for link in links:
        people.setdefault(link.user_id, link.user)
    return list(people.values())


def _name(user) -> str | None:
    return (user.display_name or user.email) if user else None


def state(campaign) -> dict | None:
    """What the interface shows: None until an approval was ever asked for."""
    if not campaign.approval_status:
        return None
    return {"status": campaign.approval_status, "requested_by": str(campaign.approval_requested_by_id) if campaign.approval_requested_by_id else None,
            "requested_by_name": _name(campaign.approval_requested_by), "requested_at": campaign.approval_requested_at, "note": campaign.approval_note,
            "decided_by_name": _name(campaign.approval_decided_by), "decided_at": campaign.approval_decided_at, "decision_note": campaign.approval_decision_note}


def actions(campaign) -> list[str]:
    """Added to the campaign's actions: request_approval while it can still be asked for, approve and send_back while it waits."""
    if campaign.is_journey_generated or campaign.status not in service.EDITABLE:
        return []
    if campaign.approval_status == REQUESTED:
        return ["approve", "send_back"]
    if required(campaign) and campaign.approval_status != APPROVED:
        return ["request_approval"]
    return []


def problem(campaign) -> str | None:
    """What stands between the campaign and the publish, in words; None when nothing does."""
    if not required(campaign) or is_approved(campaign):
        return None
    if campaign.approval_status == REQUESTED:
        return f"Waiting for approval, asked {campaign.approval_requested_at:%d %b %H:%M} by {_name(campaign.approval_requested_by) or 'someone'}."
    if campaign.approval_status == RETURNED:
        return "Sent back" + (f": {campaign.approval_decision_note}" if campaign.approval_decision_note else ".") + " Change what was asked and request approval again."
    return "This workspace needs a second person to approve a production send. Request approval from the Review & Publish step."


def _actor(user):
    return None if user is None or hasattr(user, "has_scope") else user


def request(campaign, user, note: str = "") -> Campaign:
    if campaign.is_journey_generated:
        raise service.ActionError("A journey's campaign is approved with the journey.")
    if campaign.status not in service.EDITABLE:
        raise service.ActionError("Approval can be requested while the campaign is a draft or test published.")
    if not required(campaign):
        raise service.ActionError("This workspace does not require approval: the campaign can be published directly.")
    if campaign.approval_status == REQUESTED:
        raise service.ActionError("Approval was already requested; it is waiting for a decision.")
    if campaign.approval_status == APPROVED:
        raise service.ActionError("The campaign is already approved.")
    people = approvers(campaign.tenant_id)
    if not people:
        raise service.ActionError("Nobody in this workspace can approve yet: give a role the campaign.approve permission first (Settings → Roles).")
    actor = _actor(user)
    Campaign.objects.filter(pk=campaign.pk).update(approval_status=REQUESTED, approval_requested_by_id=getattr(actor, "pk", None), approval_requested_at=timezone.now(),
                                                   approval_note=(note or "")[:NOTE_MAX] or None, approval_decided_by_id=None, approval_decided_at=None, approval_decision_note=None)
    campaign.refresh_from_db()
    service.record(campaign, "APPROVAL_REQUESTED", "Approval requested" + (f": {note[:200]}" if note else "."), user=user)
    who = _name(actor) or "The API"
    others = [person.email for person in people if actor is None or person.pk != actor.pk]
    notifications.notify(campaign.tenant, "approval_requested", title=f"{campaign.name} is waiting for your approval",
                         lines=[f"{who} asked for approval to publish {campaign.name} to production." + (f' Note: "{note[:300]}"' if note else ""),
                                "Open the Review & Publish step to approve it or send it back."],
                         link=notifications.campaign_link(campaign.pk, setup=True), link_label="Review and Decide", to=others)
    return campaign


def _decide(campaign, user, status: str, note: str):
    if campaign.approval_status != REQUESTED:
        raise service.ActionError("There is no approval request waiting on this campaign.")
    if campaign.status not in service.EDITABLE:
        raise service.ActionError("The campaign is no longer where approval applies.")
    actor = _actor(user)
    if actor is not None and campaign.approval_requested_by_id == actor.pk:
        raise service.ActionError("You cannot approve your own campaign: someone else with the campaign.approve permission has to.")
    Campaign.objects.filter(pk=campaign.pk).update(approval_status=status, approval_decided_by_id=getattr(actor, "pk", None), approval_decided_at=timezone.now(),
                                                   approval_decision_note=(note or "")[:NOTE_MAX] or None)
    campaign.refresh_from_db()
    return actor


def approve(campaign, user, note: str = "") -> Campaign:
    actor = _decide(campaign, user, APPROVED, note)
    service.record(campaign, "APPROVED", "Approved for production" + (f": {note[:200]}" if note else "."), user=user)
    author = campaign.approval_requested_by
    notifications.notify(campaign.tenant, "approval_decided", title=f"{campaign.name} was approved",
                         lines=[f"{_name(actor) or 'The API'} approved {campaign.name} for production." + (f' Note: "{note[:300]}"' if note else ""),
                                "It can be published now. Any change to the campaign withdraws the approval."],
                         link=notifications.campaign_link(campaign.pk, setup=True), link_label="Publish", owner_email=author.email if author else None)
    return campaign


def send_back(campaign, user, note: str) -> Campaign:
    if not (note or "").strip():
        raise service.ActionError("Say what should change before sending the campaign back.")
    actor = _decide(campaign, user, RETURNED, note)
    service.record(campaign, "APPROVAL_RETURNED", f"Sent back: {note[:200]}", user=user, severity="WARNING")
    author = campaign.approval_requested_by
    notifications.notify(campaign.tenant, "approval_decided", title=f"{campaign.name} was sent back",
                         lines=[f"{_name(actor) or 'The API'} sent {campaign.name} back: \"{note[:300]}\"", "Change what was asked and request approval again."],
                         link=notifications.campaign_link(campaign.pk, setup=True), link_label="Open the Campaign", owner_email=author.email if author else None)
    return campaign


def withdraw(campaign, user, why: str) -> bool:
    """After a change to a campaign that was requested or approved: the approval no longer covers what would go out."""
    if campaign.approval_status not in (REQUESTED, APPROVED):
        return False
    was = campaign.approval_status
    Campaign.objects.filter(pk=campaign.pk).update(approval_status=None)
    campaign.approval_status = None
    service.record(campaign, "APPROVAL_WITHDRAWN", f"{'Approval' if was == APPROVED else 'The approval request'} was withdrawn: {why} Request approval again when the campaign is ready.",
                   user=user, severity="WARNING")
    return True


def awaiting(tenant_id) -> int:
    return Campaign.objects.filter(tenant_id=tenant_id, approval_status=REQUESTED, deleted_at__isnull=True, status__in=service.EDITABLE).count()
