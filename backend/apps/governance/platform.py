"""Platform governance policies (patch 0088): frequency caps the back-office applies to every workspace, to chosen ones, or to
one. Each workspace a policy applies to holds a copy in its own communication_governance_policy, linked by
platform_policy_id, so the send-time checks (apps/delivery/engine/audience*.py) read one table. A copy is the platform's
to change: the workspace's Governance page shows it locked and its API refuses to edit or remove it.

Saving a platform policy pushes it: workspaces it now applies to get or update their copy, workspaces it no longer applies
to lose theirs. Deleting it removes every copy. A new workspace takes the copies of the policies that apply to all.
Every write into a workspace's table runs with app.current_tenant set, which the audit trigger and row-level security need.
"""
from __future__ import annotations

from django.db import connections, transaction
from django.utils import timezone

from apps.governance.models import CommunicationGovernancePolicy

COPIED = ("scope", "channel", "max_messages", "period_days", "gap_hours", "applies_to", "priority", "is_active")
LOCKED_MESSAGE = "This rule is set by the platform for your workspace: it is changed in the back-office, not here."


def _tenant_scope(cursor, tenant_id) -> None:
    cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])


def _name_for(policy, tenant_id, manager, copy_id=None) -> str:
    """the platform's name, unless the workspace already has a cap of its own by that name"""
    taken = manager.filter(tenant_id=tenant_id, name=policy.name, deleted_at__isnull=True).exclude(pk=copy_id).exists()
    return f"{policy.name} (Platform)"[:200] if taken else policy.name


def apply_to_tenant(policy, tenant_id, *, using: str, user_id=None) -> str:
    """One platform policy into one workspace: 'added', 'updated', 'unchanged', 'removed' or 'none'."""
    manager = CommunicationGovernancePolicy.objects.using(using)
    copy = manager.filter(tenant_id=tenant_id, platform_policy_id=policy.pk, deleted_at__isnull=True).first()
    if not policy.applies_to_tenant(tenant_id):
        if copy is None:
            return "none"
        copy.deleted_at, copy.is_active, copy.updated_by_id = timezone.now(), False, user_id
        copy.save(using=using, update_fields=["deleted_at", "is_active", "updated_by"])
        return "removed"
    values = {name: getattr(policy, name) for name in COPIED}
    if copy is None:
        manager.create(tenant_id=tenant_id, platform_policy_id=policy.pk, name=_name_for(policy, tenant_id, manager), created_by_id=user_id, **values)
        return "added"
    changed = {name: value for name, value in values.items() if getattr(copy, name) != value}
    name = _name_for(policy, tenant_id, manager, copy.pk)
    if name != copy.name:
        changed["name"] = name
    if not changed:
        return "unchanged"
    for field, value in changed.items():
        setattr(copy, field, value)
    copy.updated_by_id = user_id
    copy.save(using=using, update_fields=[*changed, "updated_by"])
    return "updated"


def push(policy, *, using: str, user_id=None) -> dict[str, list[str]]:
    """One platform policy, as it is now, into every active workspace. Workspace codes by outcome."""
    from apps.tenants.models import Tenant
    outcomes: dict[str, list[str]] = {"added": [], "updated": [], "unchanged": [], "removed": [], "none": []}
    for tenant in Tenant.objects.using(using).filter(status="ACTIVE").order_by("code"):
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            _tenant_scope(cursor, tenant.id)
            outcomes[apply_to_tenant(policy, tenant.id, using=using, user_id=user_id)].append(tenant.code)
    return outcomes


def remove_everywhere(policy, *, using: str, user_id=None) -> list[str]:
    """The platform policy is being deleted: every workspace loses its copy (a platform rule never becomes a workspace's own)."""
    from apps.tenants.models import Tenant
    removed = []
    tenants = CommunicationGovernancePolicy.objects.using(using).filter(platform_policy_id=policy.pk, deleted_at__isnull=True).values_list("tenant_id", flat=True)
    for tenant in Tenant.objects.using(using).filter(pk__in=list(tenants)).order_by("code"):
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            _tenant_scope(cursor, tenant.id)
            CommunicationGovernancePolicy.objects.using(using).filter(tenant_id=tenant.id, platform_policy_id=policy.pk, deleted_at__isnull=True).update(
                deleted_at=timezone.now(), is_active=False, updated_by_id=user_id)
            removed.append(tenant.code)
    return removed


def inherit(tenant_id, *, using: str, user_id=None) -> int:
    """A new workspace (or a repair): every active platform policy that applies to it. How many copies were added or updated."""
    from apps.platform_ops.models import PlatformGovernancePolicy
    count = 0
    with transaction.atomic(using=using), connections[using].cursor() as cursor:
        _tenant_scope(cursor, tenant_id)
        for policy in PlatformGovernancePolicy.objects.using(using).filter(is_active=True).order_by("priority", "name"):
            if policy.applies_to_tenant(tenant_id) and apply_to_tenant(policy, tenant_id, using=using, user_id=user_id) in ("added", "updated"):
                count += 1
    return count


def summary(outcomes: dict[str, list[str]]) -> str:
    words = {"added": "added to", "updated": "updated in", "removed": "removed from", "unchanged": "already right in"}
    parts = [f"{words[key]} {', '.join(codes)}" for key, codes in outcomes.items() if codes and key in words]
    return "; ".join(parts) or "no workspace changed"
