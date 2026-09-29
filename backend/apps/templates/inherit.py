"""Platform personalization tags, inherited by every workspace (patch 0026).

The back-office keeps one catalogue (`platform_personalization_tag`); each workspace gets a copy of every active tag
in its own `personalization_tag` table, linked by `platform_tag_id`. A new workspace takes the copies at onboarding;
saving a platform tag pushes the change to every workspace. A copy is the platform's to change: the workspace API
refuses to edit or delete it. A tag the workspace made itself with the same key is left alone and reported.

Every write into a workspace's table happens inside one transaction with `app.current_tenant` set, which the audit
trigger needs and which is how RLS lets the platform connection in.
"""
from __future__ import annotations

from django.db import connections, transaction

from apps.templates.models import PersonalizationTag

COPIED = ("label", "tag_kind", "source_system", "resolution_source", "source_path", "static_value", "default_value", "format_spec",
          "data_type", "applies_to_channels", "description", "sample_value", "is_active")

INHERITED_MESSAGE = "This tag is inherited from the platform catalogue: it is changed in the back-office, not here."


def _values(tag) -> dict:
    return {name: getattr(tag, name) for name in COPIED}


def apply_to_tenant(tag, tenant_id, *, using: str, user_id=None) -> str:
    """One platform tag into one workspace: 'added', 'updated', 'unchanged', or 'kept' (the workspace's own tag wins)."""
    manager = PersonalizationTag.objects.using(using)
    existing = manager.filter(tenant_id=tenant_id, tag_key=tag.tag_key).first()
    if existing is None:
        if not tag.is_active:
            return "unchanged"
        manager.create(tenant_id=tenant_id, tag_key=tag.tag_key, platform_tag_id=tag.id, created_by_id=user_id, **_values(tag))
        return "added"
    if existing.platform_tag_id != tag.id:
        return "kept"
    changed = {name: value for name, value in _values(tag).items() if getattr(existing, name) != value}
    if not changed:
        return "unchanged"
    for name, value in changed.items():
        setattr(existing, name, value)
    existing.updated_by_id = user_id
    existing.save(using=using, update_fields=[*changed, "updated_by"])
    return "updated"


def _tenant_scope(cursor, tenant_id) -> None:
    cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])


def inherit_platform_tags(tenant_id, *, using: str, user_id=None) -> dict[str, int]:
    """Every active platform tag into one workspace (onboarding, or a repair). Counts by outcome."""
    from apps.platform_ops.models import PlatformPersonalizationTag
    counts = {"added": 0, "updated": 0, "unchanged": 0, "kept": 0}
    with transaction.atomic(using=using), connections[using].cursor() as cursor:
        _tenant_scope(cursor, tenant_id)
        for tag in PlatformPersonalizationTag.objects.using(using).filter(is_active=True).order_by("tag_key"):
            counts[apply_to_tenant(tag, tenant_id, using=using, user_id=user_id)] += 1
    return counts


def push_platform_tag(tag, *, using: str, user_id=None) -> dict[str, list[str]]:
    """One platform tag (as it is now, active or not) into every active workspace. Workspace codes by outcome."""
    from apps.tenants.models import Tenant
    outcomes: dict[str, list[str]] = {"added": [], "updated": [], "unchanged": [], "kept": []}
    for tenant in Tenant.objects.using(using).filter(status="ACTIVE").order_by("code"):
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            _tenant_scope(cursor, tenant.id)
            outcomes[apply_to_tenant(tag, tenant.id, using=using, user_id=user_id)].append(tenant.code)
    return outcomes


def workspaces_using(tag_id, *, using: str) -> int:
    return PersonalizationTag.objects.using(using).filter(platform_tag_id=tag_id).count()


def summary(outcomes: dict[str, list[str]]) -> str:
    """'3 added, 1 updated; kept their own tag: ACME' — for the back-office message."""
    parts = [f"{len(codes)} {name}" for name, codes in outcomes.items() if codes and name != "kept"]
    line = ", ".join(parts) or "nothing to change"
    if outcomes["kept"]:
        line += f"; kept their own tag with this key: {', '.join(outcomes['kept'])}"
    return line
