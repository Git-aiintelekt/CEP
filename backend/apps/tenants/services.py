"""Tenant onboarding used by the platform back-office (Django Admin) and the management commands."""
import logging

from django.db import connections

from apps.tenants import context

from apps.identity.models import Permission, Role, RolePermission

from .models import TenantDatabase

log = logging.getLogger(__name__)

# The roles every new workspace starts with. Tenant administrators can change them afterwards in Settings.
DEFAULT_ROLES = {
    "Workspace Admin": ("Everything, including users, roles and API keys", None),                       # None = every permission
    "Campaign Manager": ("Builds and publishes campaigns, lists and templates",
                         ["campaign.view", "campaign.edit", "campaign.publish", "list.view", "list.edit", "list.import",
                          "template.view", "template.edit", "report.view"]),
    "Analyst": ("Read-only access with reports", ["campaign.view", "journey.view", "list.view", "template.view", "report.view"]),
}


def onboard_tenant(tenant, *, using: str, months_ahead: int = 3, user_id=None) -> dict:
    """Everything a freshly inserted tenant row needs before anyone can work in it. Idempotent.

    1. partitions for every partitioned table (fn_provision_tenant is SECURITY DEFINER)
    2. the database routing row (shared pool unless changed later)
    3. the starting roles
    4. the coupon tags barcode and QR code blocks read
    """
    with connections[using].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.id)])       # audit triggers need a tenant
        cursor.execute("SELECT fn_provision_tenant(%s::uuid, %s)", [str(tenant.id), months_ahead])
        partitions = cursor.fetchone()[0]

    TenantDatabase.objects.using(using).get_or_create(
        tenant=tenant, defaults={"isolation_mode": tenant.isolation_mode or "SHARED", "db_alias": "default", "status": "ACTIVE"})

    created_roles = []
    catalogue = {p.code: p for p in Permission.objects.using(using).all()}
    for name, (description, codes) in DEFAULT_ROLES.items():
        role, created = Role.objects.using(using).get_or_create(tenant=tenant, name=name, deleted_at=None,
                                                                defaults={"description": description, "created_by_id": user_id})
        if created:
            wanted = catalogue.values() if codes is None else [catalogue[code] for code in codes if code in catalogue]
            RolePermission.objects.using(using).bulk_create([RolePermission(role=role, permission=p) for p in wanted])
            created_roles.append(name)
    from apps.integrations.bridge import logbook
    token = context.set_current(str(tenant.id), using)
    try:
        logbook.ensure_defaults(tenant.id)                 # the POS receipts record, and one per sending engine the tenant has
    finally:
        context.reset(token)
    from django.db import transaction
    from apps.templates.starters import ensure_coupon_tags
    try:
        with transaction.atomic(using=using), connections[using].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(tenant.id)])  # the tag audit trigger needs one
            coupon_tags = ensure_coupon_tags(tenant.id, user_id, using=using)
    except Exception:                                      # noqa: BLE001  the tags can be added later; onboarding must finish
        log.exception("coupon tags not added for tenant %s", tenant.id)
        coupon_tags = 0
    return {"partition_sets": partitions, "roles": created_roles, "coupon_tags": coupon_tags}


def ensure_partitions(tenant, *, using: str, months_ahead: int = 3) -> int:
    with connections[using].cursor() as cursor:
        cursor.execute("SELECT fn_ensure_monthly_partitions(%s, %s::uuid)", [months_ahead, str(tenant.id)])
        return cursor.fetchone()[0]
