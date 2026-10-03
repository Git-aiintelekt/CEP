"""Set Up Your Workspace: the seven steps an administrator works through after the first sign-in, each read from the
workspace, never ticked by hand, with the page that does it. Ready = steps 1, 2, 3, 4 and 6. The Home card can be
hidden (tenant.settings.setup.dismissed_at); the page stays under Settings → Set-Up.

    signin          the administrator has signed in (they are reading the page)
    team            at least one other active user with a role
    email_engine    an active email engine whose last Check passed
    email_sender    a verified email sender on an active email engine
    text            (optional) an active text engine with a verified sender number
    lists           a production list with people (suppressions counted, not required)
    tell            (optional) a notification recipient, approvals on, or an API key
"""
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.campaigns import approval
from apps.contact_lists.models import ContactList
from apps.delivery.models import DeliveryProvider, SenderProfile
from apps.governance.models import ConsentSuppression
from apps.identity.models import ApiClient, AppUser, Role, UserRole
from apps.platform_ops import notifications, params

from .models import TenantSubscription

KEY = "setup"
DONE, TODO, WARN = "done", "todo", "warn"
REQUIRED = ("signin", "team", "email_engine", "email_sender", "lists")
TEXT_CHANNELS = ("SMS", "MMS")


def _day(moment, zone: str) -> str:
    try:
        moment = moment.astimezone(ZoneInfo(zone))
    except (KeyError, ValueError):
        pass
    return f"{moment.day} {moment:%b %Y}"


def _link(label, to, primary=False):
    return {"label": label, "to": to, "primary": primary}


def _step(key, label, state, text, *, links=(), why=None, tag=None, optional=False):
    return {"key": key, "label": label, "state": state, "tag": tag or ("Done" if state == DONE else None), "text": text, "why": why,
            "links": list(links), "optional": optional}


def _engine(engine) -> str:
    kind = engine["provider_type"].title()
    return engine["name"] if kind.lower() in engine["name"].lower() else f"{engine['name']} ({kind})"


def _plural(count, word, plural=None):
    return f"{count} {word if count == 1 else (plural or word + 's')}"


def steps(tenant, user) -> list[dict]:
    tid = str(tenant.pk)
    zone = tenant.timezone or "UTC"
    features = params.context_for(tenant.pk).get("features") or {}
    on = lambda code: features.get(code, True)                                                      # noqa: E731
    out = []

    # ---- 1 the sign-in
    when = f"Done {_day(user.last_login, zone)}." if getattr(user, "last_login", None) else "Done just now."
    out.append(_step("signin", "Choose your password and sign in", DONE, when + " Multi-factor authentication can be turned on under Account Security.",
                     links=[_link("Account Security", "/account/security")]))

    # ---- 2 the team
    roles = list(Role.objects.filter(tenant_id=tid, deleted_at__isnull=True).order_by("name").values_list("name", flat=True))
    others = AppUser.objects.filter(tenant_id=tid, is_active=True, deleted_at__isnull=True).exclude(pk=user.pk)
    with_role = others.filter(pk__in=UserRole.objects.filter(role__tenant_id=tid, role__deleted_at__isnull=True).values("user_id"))
    team = with_role.count()
    if team:
        signed_in = with_role.filter(last_login__isnull=False).count() + 1
        out.append(_step("team", "Invite your team and give them roles", DONE,
                         f"{_plural(team + 1, 'user')} · {signed_in} signed in · roles {', '.join(roles[:4])}." + (" Approvals will need a role with campaign.approve." if roles else ""),
                         links=[_link("Users", "/settings/users")]))
    else:
        out.append(_step("team", "Invite your team and give them roles", TODO,
                         f"You are the only user. {_plural(len(roles), 'role is', 'roles are')} ready: {', '.join(roles[:4])}." if roles else "You are the only user, and no role exists yet.",
                         why="People are invited by email with a password link, as you were. Give a role to each; a role can be changed later.",
                         links=[_link("Invite Users", "/settings/users", primary=True), _link("Roles", "/settings/roles")]))

    # ---- 3 the email engine
    engines = list(DeliveryProvider.objects.filter(tenant_id=tid, deleted_at__isnull=True, is_active=True, channel="EMAIL").order_by("-is_default", "name")
                   .values("id", "name", "provider_type", "last_checked_at", "last_check_ok", "last_check_error"))
    checked = [e for e in engines if e["last_check_ok"]]
    if checked:
        engine = checked[0]
        out.append(_step("email_engine", "Add an email engine", DONE, f"{_engine(engine)} · checked {_day(engine['last_checked_at'], zone)}.",
                         links=[_link("Sending Engines", "/settings/delivery")]))
    elif engines:
        engine = engines[0]
        trouble = (f"check failed {_day(engine['last_checked_at'], zone)}: {(engine['last_check_error'] or '')[:80]}" if engine["last_checked_at"] else "not checked yet")
        out.append(_step("email_engine", "Add an email engine", WARN, f"{_engine(engine)} · {trouble}.", tag="Not checked",
                         why="Check confirms the credential. The callback address on the engine card goes to the provider, so delivery results come back.",
                         links=[_link("Check the Engine", "/settings/delivery", primary=True)]))
    else:
        out.append(_step("email_engine", "Add an email engine", TODO, "Postal, SendGrid or your own mail server. Check confirms the credential.",
                         why="Check confirms the credential. The callback address on the engine card goes to the provider, so delivery results come back.",
                         links=[_link("Sending Engines", "/settings/delivery", primary=True)]))

    # ---- 4 the email sender
    senders = list(SenderProfile.objects.filter(tenant_id=tid, deleted_at__isnull=True, channel="EMAIL", delivery_provider_id__in=[e["id"] for e in engines])
                   .order_by("-is_default", "display_name").values("display_name", "from_address", "verification_status", "is_default"))
    verified = [s for s in senders if s["verification_status"] == "VERIFIED"]
    if verified:
        sender = verified[0]
        out.append(_step("email_sender", "Add an email sender and verify it", DONE,
                         f"{sender['display_name']} <{sender['from_address']}> · verified" + (" · default." if sender["is_default"] else "."),
                         links=[_link("Senders", "/settings/delivery#senders")]))
    elif senders:
        sender = senders[0]
        out.append(_step("email_sender", "Add an email sender and verify it", WARN,
                         f"{_plural(len(senders), 'sender')}, {sender['display_name']} <{sender['from_address']}>, not verified. Test sends work from it; production does not.",
                         tag="Not verified", why="The domain must be one the engine may send for. Verify checks SPF and DKIM on the engine; it takes a minute once the DNS records are in.",
                         links=[_link("Verify Sender", "/settings/delivery#senders", primary=True)]))
    else:
        out.append(_step("email_sender", "Add an email sender and verify it", TODO, "From name and address on the engine; Verify; tick Default.",
                         why="The domain must be one the engine may send for. Verify checks SPF and DKIM on the engine; it takes a minute once the DNS records are in.",
                         links=[_link("Senders", "/settings/delivery#senders", primary=True)]))

    # ---- 5 texts (optional)
    if not on("sms"):
        out.append(_step("text", "Add a text engine and a sender number", TODO, "Texts are not switched on for this workspace; ask the platform team if you need them.", optional=True))
    else:
        text_engines = list(DeliveryProvider.objects.filter(tenant_id=tid, deleted_at__isnull=True, is_active=True, channel__in=TEXT_CHANNELS).order_by("-is_default", "name")
                            .values("id", "name", "provider_type"))
        text_verified = SenderProfile.objects.filter(tenant_id=tid, deleted_at__isnull=True, channel__in=TEXT_CHANNELS, verification_status="VERIFIED",
                                                     delivery_provider_id__in=[e["id"] for e in text_engines]).order_by("-is_default").values("display_name", "sender_id").first()
        if text_engines and text_verified:
            out.append(_step("text", "Add a text engine and a sender number", DONE,
                             f"{_engine(text_engines[0])} · {text_verified['display_name']} {text_verified['sender_id'] or ''}".rstrip() + " · verified.",
                             links=[_link("Sending Engines", "/settings/delivery")], optional=True))
        elif text_engines:
            out.append(_step("text", "Add a text engine and a sender number", WARN, f"{text_engines[0]['name']} · no verified sender number yet.", tag="No sender",
                             links=[_link("Senders", "/settings/delivery#senders")], optional=True))
        else:
            out.append(_step("text", "Add a text engine and a sender number", TODO, "Digivize, or Sandbox Texts to trial without an aggregator. Marketing texts need an opt-in and a STOP line.",
                             links=[_link("Sending Engines", "/settings/delivery")], optional=True))

    # ---- 6 suppressions and the first list
    suppressed = ConsentSuppression.objects.filter(tenant_id=tid, suppressed=True).count()
    lists = ContactList.objects.filter(tenant_id=tid, deleted_at__isnull=True, list_environment="PRODUCTION", status="ACTIVE", is_master=True).exclude(approval_status="REFUSED")
    total_lists = lists.count()
    with_people = lists.filter(member_count__gt=0).count()
    suppression_words = f"{_plural(suppressed, 'person', 'people')} suppressed" if suppressed else "No suppressions imported"
    if with_people:
        out.append(_step("lists", "Import your do-not-contact list, then your first contact list", DONE,
                         f"{suppression_words} · {_plural(total_lists, 'list')}, {with_people} with people.",
                         links=[_link("Suppressions", "/settings/suppressions"), _link("Contact Lists", "/contact-lists")]))
    else:
        list_words = "no list yet" if not total_lists else f"{_plural(total_lists, 'list')} without people yet"
        out.append(_step("lists", "Import your do-not-contact list, then your first contact list", TODO,
                         f"{suppression_words} · {list_words}. Every upload asks where its people agreed (the consent step).",
                         why="Suppressions first, so nobody who opted out elsewhere is ever contacted; then a production list with its consent basis.",
                         links=[_link("Suppressions", "/settings/suppressions"), _link("Upload a List", "/contact-lists", primary=True)]))

    # ---- 7 who is told, who approves (optional)
    emails = notifications.settings_of(tenant)["emails"]
    approvals_on = approval.required(tenant)
    keys = ApiClient.objects.filter(tenant_id=tid, revoked_at__isnull=True).count()
    words = (f"Notifications: {', '.join(emails[:2]) + (f' and {len(emails) - 2} more' if len(emails) > 2 else '') if emails else 'nobody yet'}"
             f" · Approvals: {'on' if approvals_on else 'off'} · API keys: {keys or 'none'}" + (" (needed for e-receipts from the point of sale)" if not keys and on("ereceipt") else "") + ".")
    links = [_link("Notifications", "/settings/notifications"), _link("Approvals", "/settings/approvals")] + ([_link("API Keys", "/settings/api-keys")] if on("api_access") else [])
    out.append(_step("tell", "Decide who is told, and who approves", DONE if (emails or approvals_on or keys) else TODO, words, links=links, optional=True))
    return out


def overview(tenant, user) -> dict:
    items = steps(tenant, user)
    by_key = {item["key"]: item for item in items}
    done = sum(1 for item in items if item["state"] == DONE)
    ready = all(by_key[key]["state"] == DONE for key in REQUIRED)
    nxt = next((key for key in REQUIRED if by_key[key]["state"] != DONE), None)
    subscription = TenantSubscription.objects.filter(tenant_id=tenant.pk).select_related("plan").order_by("-started_at").first()
    stored = (tenant.settings or {}).get(KEY) or {}
    return {
        "workspace": {"name": tenant.name, "code": tenant.code, "plan": subscription.plan.name if subscription else None, "timezone": tenant.timezone},
        "viewer": {"first_name": (user.display_name or user.email or "").split(" ")[0]},
        "steps": items, "done": done, "total": len(items), "ready": ready, "next": nxt, "dismissed": bool(stored.get("dismissed_at")),
    }


def dismiss(tenant, hidden: bool) -> None:
    """Hide the Home card (or show it again); the page itself stays under Settings."""
    current = {**((tenant.settings or {}).get(KEY) or {}), "dismissed_at": timezone.now().isoformat() if hidden else None}
    tenant.settings = {**(tenant.settings or {}), KEY: current}
    tenant.save(update_fields=["settings"])
