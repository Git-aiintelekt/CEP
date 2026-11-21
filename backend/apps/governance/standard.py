"""The standard governance every installation starts with, as HubSpot, Klaviyo and Braze recommend it.

Two levels:
  PLATFORM   the platform's own outer limit, applied to every workspace and locked there: at most one marketing message per
             channel per day, so nobody is sent a burst.
  WORKSPACE  the usual marketing caps, and Unengaged Contacts at 180 days and 5 emails, added to each workspace as its OWN rules,
             which it may change, switch off or remove.

`apply()` makes both: it creates the platform standards that do not exist yet and pushes them, then gives each workspace the
workspace standards for the channels it does not cap yet. Running it again changes nothing. Onboarding calls `for_new_workspace()`.
"""
from __future__ import annotations

from datetime import time

from django.db import connections, transaction

PLATFORM = [
    {"name": "Platform Standard: Email, 1 per Day", "scope": "CHANNEL", "channel": "EMAIL", "max_messages": 1, "period_days": 1, "priority": 10},
    {"name": "Platform Standard: Text, 1 per Day", "scope": "CHANNEL", "channel": "SMS", "max_messages": 1, "period_days": 1, "priority": 10},
    {"name": "Platform Standard: WhatsApp, 1 per Day", "scope": "CHANNEL", "channel": "WHATSAPP", "max_messages": 1, "period_days": 1, "priority": 10},
    # texts 08:00 to 21:00 every day: the quiet hours 21:00 to 08:00 that US texting rules expect, which messaging.sms_quiet_hours held before
    {"name": "Platform Standard: Text Send Window, 08:00-21:00", "scope": "CHANNEL", "channel": "SMS", "max_messages": 1, "period_days": 1, "priority": 10,
     "window_start": time(8, 0), "window_end": time(21, 0), "window_days": [1, 2, 3, 4, 5, 6, 7]},
]
WORKSPACE = [
    {"channel": "EMAIL", "max_messages": 3, "period_days": 7},
    {"channel": "SMS", "max_messages": 4, "period_days": 30},
    {"channel": "WHATSAPP", "max_messages": 2, "period_days": 7},
    {"channel": "ALL", "max_messages": 5, "period_days": 7},
]
# Gap Between Messages: the hours a workspace's gap starts at when it is switched on (Klaviyo's Smart Sending: 16 for email, 24 for texts)
GAPS = {"EMAIL": 16, "SMS": 24, "WHATSAPP": 24}


def _own_channels(tenant_id, using: str) -> set[str]:
    """the channels the workspace already caps itself (ALL for a cap on every channel together)"""
    from apps.governance.models import CommunicationGovernancePolicy
    rows = CommunicationGovernancePolicy.objects.using(using).filter(tenant_id=tenant_id, deleted_at__isnull=True, platform_policy_id__isnull=True, gap_hours__isnull=True, window_start__isnull=True, blackout_from__isnull=True, unengaged_days__isnull=True)
    return {"ALL" if row.scope == "GLOBAL" else (row.channel or "EMAIL") for row in rows}


def workspace_caps(tenant_id, *, using: str = "default", user_id=None) -> list[str]:
    """The workspace standards for the channels the workspace does not cap yet, as its own caps. The rules added, in words.
    Runs in the caller's tenant context."""
    from apps.governance import workspace
    from apps.governance.models import CommunicationGovernancePolicy
    have, added = _own_channels(tenant_id, using), []
    for cap in WORKSPACE:
        if cap["channel"] in have:
            continue
        values = workspace._clean(cap)
        CommunicationGovernancePolicy.objects.using(using).create(tenant_id=tenant_id, name=workspace._name(tenant_id, values, using=using), applies_to="MARKETING",
                                                                 priority=100, created_by_id=user_id, **values)
        added.append(workspace.rule(values["max_messages"], values["period_days"], values["channel"]))
    if not CommunicationGovernancePolicy.objects.using(using).filter(tenant_id=tenant_id, deleted_at__isnull=True, platform_policy_id__isnull=True,
                                                                     unengaged_days__isnull=False).exists():
        from apps.governance import unengaged
        fields = {"scope": "CHANNEL", "channel": "EMAIL", "max_messages": 1, "period_days": 1,
                  "unengaged_days": unengaged.RECOMMENDED_DAYS, "unengaged_min_emails": unengaged.RECOMMENDED_EMAILS}
        if _platform_allows(tenant_id, using, fields):
            CommunicationGovernancePolicy.objects.using(using).create(tenant_id=tenant_id, name=workspace._name(tenant_id, fields, using=using), applies_to="MARKETING",
                                                                     priority=100, created_by_id=user_id, **fields)
            added.append(unengaged.describe(fields["unengaged_days"], fields["unengaged_min_emails"]))
    return added


def _platform_allows(tenant_id, using: str, fields: dict) -> bool:
    """the recommended unengaged rule is no looser than any the platform sets (a stricter platform rule makes it pointless)"""
    from apps.governance.models import CommunicationGovernancePolicy
    platform = CommunicationGovernancePolicy.objects.using(using).filter(tenant_id=tenant_id, deleted_at__isnull=True, is_active=True, platform_policy_id__isnull=False,
                                                                         unengaged_days__isnull=False)
    return all(p.unengaged_days >= fields["unengaged_days"] and p.unengaged_min_emails >= fields["unengaged_min_emails"] for p in platform)


def platform_policies(*, using: str, user_id=None) -> list:
    """The platform standards, made where missing (all workspaces). Existing ones are left as the platform team set them."""
    from apps.platform_ops.models import PlatformGovernancePolicy
    made = []
    for spec in PLATFORM:
        policy = PlatformGovernancePolicy.objects.using(using).filter(name=spec["name"]).first()
        if policy is None:
            policy = PlatformGovernancePolicy.objects.using(using).create(applies_all=True, created_by_id=user_id, updated_by_id=user_id, **spec)
        made.append(policy)
    return made


def apply(*, using: str, user_id=None, dry_run: bool = False) -> dict:
    """Both levels on every active workspace. {platform: {name: outcomes}, workspaces: {code: [rules added]}}"""
    from apps.governance import platform
    from apps.platform_ops.models import PlatformGovernancePolicy
    from apps.tenants.models import Tenant
    report: dict = {"platform": {}, "workspaces": {}}
    tenants = list(Tenant.objects.using(using).filter(status="ACTIVE").order_by("code"))
    if dry_run:
        existing = set(PlatformGovernancePolicy.objects.using(using).values_list("name", flat=True))
        report["platform"] = {spec["name"]: "exists" if spec["name"] in existing else "would be added for all workspaces" for spec in PLATFORM}
        for tenant in tenants:
            with transaction.atomic(using=using), connections[using].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.pk)])
                have = _own_channels(tenant.pk, using)
            report["workspaces"][tenant.code] = [f"{cap['channel']} {cap['max_messages']}/{cap['period_days']}d" for cap in WORKSPACE if cap["channel"] not in have]
            with transaction.atomic(using=using), connections[using].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.pk)])
                from apps.governance.models import CommunicationGovernancePolicy
                if not CommunicationGovernancePolicy.objects.using(using).filter(tenant_id=tenant.pk, deleted_at__isnull=True, platform_policy_id__isnull=True,
                                                                                 unengaged_days__isnull=False).exists():
                    report["workspaces"][tenant.code].append("Unengaged Contacts 180 days / 5 emails")
        return report
    for policy in platform_policies(using=using, user_id=user_id):
        report["platform"][policy.name] = platform.summary(platform.push(policy, using=using, user_id=user_id))
    for tenant in tenants:
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.pk)])
            report["workspaces"][tenant.code] = workspace_caps(tenant.pk, using=using, user_id=user_id)
    return report


def for_new_workspace(tenant_id, *, using: str, user_id=None) -> dict:
    """Onboarding: the platform standards exist (made if missing), the workspace gets every platform policy that applies to it,
    and the workspace standards as its own caps."""
    from apps.governance import platform
    platform_policies(using=using, user_id=user_id)
    inherited = platform.inherit(tenant_id, using=using, user_id=user_id)
    with transaction.atomic(using=using), connections[using].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant_id)])
        own = workspace_caps(tenant_id, using=using, user_id=user_id)
    return {"platform": inherited, "own": own}
