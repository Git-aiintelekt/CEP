"""Where a tenant stands: eight checks over what already exists, for the Readiness panel on its back-office page and the
column on the Tenants list. Read-only; every check names the page that fixes it.

    provisioned     partitions, the routing row and the starting roles (what onboard_tenant makes)
    plan            a trial or active subscription, with a billing reference
    features        the industry profile and the resolved feature switches
    administrator   an active user whose role holds user.admin
    tags            the active platform personalization tags, all present in the workspace
    consent         the consent policy chosen for the workspace (platform defaults otherwise)
    sending         the workspace's own engines and verified senders (theirs; read here, never changed)
    sso             an identity provider (optional)
"""
from django.conf import settings
from django.db import connections
from django.db.models import F
from django.urls import reverse

from apps.contact_lists import consent as consent_policy
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.identity.models import Role, UserRole
from apps.platform_ops import params
from apps.platform_ops.models import PlatformPersonalizationTag, TenantIdentityProvider
from apps.templates.models import PersonalizationTag

from .models import TenantDatabase, TenantSubscription
from .services import DEFAULT_ROLES

P = settings.PLATFORM_ALIAS
OK, WARN, TODO = "ok", "warn", "todo"


def _rows(sql, args=()):
    with connections[P].cursor() as cursor:
        cursor.execute(sql, args)
        return cursor.fetchall()


def _day(moment) -> str:
    return f"{moment.day} {moment:%b %Y}"


def _check(key, label, state, text, *, action=None, url=None, optional=False):
    return {"key": key, "label": label, "state": state, "text": text, "action": action, "url": url, "optional": optional}


def checks(tenant) -> list[dict]:
    tid = str(tenant.pk)
    out = []

    # ---- provisioned
    partitions = _rows("SELECT count(*) FROM pg_class WHERE relispartition AND relname LIKE %s", [f"%\\_t{tenant.partition_seq}\\_%"])[0][0] if tenant.partition_seq else 0
    routing = TenantDatabase.objects.using(P).filter(tenant=tenant).first()
    roles = list(Role.objects.using(P).filter(tenant=tenant, deleted_at__isnull=True).order_by("name").values_list("name", flat=True))
    if partitions and routing and roles:
        out.append(_check("provisioned", "Provisioned", OK,
                          f"{partitions} partitions · routing row: {routing.isolation_mode.lower()} ({routing.db_alias}) · {len(roles)} role{'s' if len(roles) != 1 else ''}: {', '.join(roles[:4])}"
                          + (f" · onboarded {_day(tenant.onboarded_at)}" if tenant.onboarded_at else "")))
    else:
        gaps = [] if partitions else ["no partitions"]
        gaps += [] if routing else ["no routing row"]
        gaps += [f"no roles (onboarding makes {', '.join(DEFAULT_ROLES)})"] if not roles else []
        out.append(_check("provisioned", "Provisioned", TODO, "Nothing works in the workspace before this. " + "; ".join(gaps) + ".",
                          action="Repair Onboarding", url=reverse("admin:tenants_tenant_changelist") + f"?q={tenant.code}"))

    # ---- plan
    subscription = TenantSubscription.objects.using(P).select_related("plan").filter(tenant=tenant, status__in=["TRIAL", "ACTIVE"]).first()
    if subscription is None:
        out.append(_check("plan", "Plan", TODO, "No subscription: usage is not metered against limits and no invoice is raised.",
                          action="Add", url=reverse("admin:tenants_tenantsubscription_add") + f"?tenant={tid}"))
    else:
        words = f"{subscription.plan.name} · {subscription.status.lower()}"
        if subscription.status == "TRIAL" and subscription.trial_ends_at:
            words += f" until {_day(subscription.trial_ends_at)}"
        if subscription.billing_customer_ref:
            out.append(_check("plan", "Plan", OK, words + f" · billing reference {subscription.billing_customer_ref}",
                              action="Open", url=reverse("admin:tenants_tenantsubscription_change", args=[subscription.pk])))
        else:
            out.append(_check("plan", "Plan", WARN, words + " · billing reference missing (no invoice until it is entered)",
                              action="Open", url=reverse("admin:tenants_tenantsubscription_change", args=[subscription.pk])))

    # ---- industry and features
    stored = tenant.settings or {}
    resolved = params.context_for(tenant.pk)
    on = sorted(code for code, enabled in (resolved.get("features") or {}).items() if enabled)
    overrides = stored.get("features") or {}
    industry = stored.get("industry")
    words = f"{industry or 'Installation default'} · {len(on)} on"
    if overrides:
        names = [params.FEATURES[code]["name"] for code in overrides if code in params.FEATURES]
        words += f" · by override: {', '.join(names)}"
    out.append(_check("features", "Industry and Features", OK if industry else WARN,
                      words if industry else words + " · no industry profile chosen: the installation default applies",
                      action="Edit", url=reverse("admin:tenants_tenant_change", args=[tenant.pk]) + "#industry-and-features"))

    # ---- first administrator
    admins = list(UserRole.objects.using(P).filter(role__tenant=tenant, role__deleted_at__isnull=True, role__role_permissions__permission__code="user.admin",
                                                   user__is_active=True, user__deleted_at__isnull=True)
                  .order_by(F("user__last_login").desc(nulls_last=True), "user__created_at").values("user__display_name", "user__email", "user__last_login", "user__password").distinct())
    admins = [{"display_name": a["user__display_name"], "email": a["user__email"], "last_login": a["user__last_login"], "password": a["user__password"]} for a in admins]
    if admins:
        first = admins[0]
        signed = f"signed in {_day(first['last_login'])}" if first["last_login"] else ("password link not used yet" if not first["password"] else "never signed in")
        out.append(_check("administrator", "First Administrator", OK if first["last_login"] else WARN,
                          f"{first['display_name']} · {first['email']} · {signed}" + (f" · {len(admins)} administrators" if len(admins) > 1 else ""),
                          action="Open", url=reverse("admin:identity_appuser_changelist") + f"?tenant__id__exact={tid}"))
    else:
        out.append(_check("administrator", "First Administrator", TODO, "Nobody in the workspace holds user.admin: no one can set it up.",
                          action="Add", url=reverse("admin:identity_appuser_add") + f"?tenant={tid}"))

    # ---- personalization tags
    platform = set(PlatformPersonalizationTag.objects.using(P).filter(is_active=True).values_list("pk", flat=True))
    present = set(PersonalizationTag.objects.using(P).filter(tenant_id=tid, deleted_at__isnull=True, platform_tag_id__in=platform).values_list("platform_tag_id", flat=True))
    missing = len(platform - present)
    out.append(_check("tags", "Personalization Tags", OK if not missing else WARN,
                      f"{len(present)} of {len(platform)} platform tags present" + (f" · {missing} missing" if missing else ""),
                      action="Push Again" if missing else None, url=reverse("admin:platform_ops_platformpersonalizationtag_changelist") if missing else None))

    # ---- consent policy
    chosen = stored.get(consent_policy.KEY) or {}
    policy = consent_policy.policy_of(tenant)
    words = (f"{'Refuse' if policy['without_consent'] == consent_policy.REFUSE else 'Hold back'} without consent · texts need a date: {'on' if policy['texts_need_date'] else 'off'}"
             f" · approval before first send: {'on' if policy['approval_before_send'] else 'off'} · lifetime {policy['lifetime_months']} months")
    out.append(_check("consent", "Consent Policy", OK if chosen else WARN,
                      words if chosen else "Platform defaults: " + words.lower() + ". Nothing chosen for this workspace yet; its administrator sets it under Settings.",
                      action="Edit" if chosen else None, url=reverse("admin:tenants_tenant_change", args=[tenant.pk]) + "#settings" if chosen else None))

    # ---- the workspace's sending (theirs)
    engines = list(DeliveryProvider.objects.using(P).filter(tenant_id=tid, deleted_at__isnull=True, is_active=True).values("channel", "provider_type", "name"))
    senders = list(SenderProfile.objects.using(P).filter(tenant_id=tid, deleted_at__isnull=True).values("channel", "verification_status"))
    verified = {s["channel"] for s in senders if s["verification_status"] == "VERIFIED"}
    if not engines:
        out.append(_check("sending", "Workspace Sending", TODO, "No sending engine yet. The workspace's administrator adds them under Settings → Sending Engines.", optional=True))
    else:
        parts = []
        for engine in engines:
            channel = engine["channel"]
            parts.append(f"{channel.lower()}: {engine['provider_type'].title()}" + (" · sender verified" if channel in verified or (channel == "MMS" and "SMS" in verified) else " · no verified sender"))
        complete = all(e["channel"] in verified or (e["channel"] == "MMS" and "SMS" in verified) for e in engines)
        out.append(_check("sending", "Workspace Sending", OK if complete else WARN, " · ".join(parts) + " · theirs, read-only here", optional=True))

    # ---- single sign-on (optional)
    idp = TenantIdentityProvider.objects.using(P).filter(tenant=tenant, is_active=True).first()
    if idp:
        out.append(_check("sso", "Single Sign-On", OK, f"{idp.display_name} · {idp.protocol} · {'enforced' if idp.enforce_sso else 'optional'}", optional=True,
                          action="Open", url=reverse("admin:platform_ops_tenantidentityprovider_change", args=[idp.pk])))
    else:
        out.append(_check("sso", "Single Sign-On", TODO, "No identity provider registered: users sign in with a password.", optional=True,
                          action="Register", url=reverse("admin:platform_ops_tenantidentityprovider_add") + f"?tenant={tid}"))
    return out


def summary(items: list[dict]) -> dict:
    """done of total, and the state of the whole: ok when everything that is not optional is ok."""
    total = len(items)
    done = sum(1 for item in items if item["state"] == OK)
    required = [item for item in items if not item["optional"]]
    state = OK if all(item["state"] == OK for item in required) else (TODO if any(item["state"] == TODO for item in required) else WARN)
    return {"done": done, "total": total, "percent": int(done * 100 / total) if total else 0, "state": state}


def readiness(tenant) -> dict:
    items = checks(tenant)
    return {"items": items, **summary(items)}
