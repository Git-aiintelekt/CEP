"""Deliverability tests of a template's content: inbox previews through a Mailgun Inspect account. The spam verdict and
inbox placement are not run yet; a test carries their slots so the panel already has somewhere to put them.

Which account (account_for): the workspace's own when it has one, otherwise the platform's (back-office -> Configuration ->
Mailgun Inspect, the row without a tenant). Tests on the platform's account count against the plan's monthly number plus
the tests the platform team added for the month (tenant_quota_grant); a workspace paying Mailgun itself is not limited
by C360, its count is shown for information. A test remembers its account, so its results are read from the same one.

A test counts the moment it is requested (that is when the provider bills it). Results are fetched when the test is read
and the last look is older than POLL_AFTER; nothing runs in the background.
"""
from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from api.exceptions import Conflict
from apps.delivery.inspect import PROVIDER_TYPE, InspectClient
from apps.delivery.models import DeliverabilityService, DeliverabilityTest
from apps.delivery.providers.base import ProviderError
from apps.platform_ops import billing, crypto, params
from apps.templates import design
from apps.templates.models import PersonalizationTag, RenderedTemplateContent, TemplateMaster

from .engine.render import modern_tags, with_preheader

P = settings.PLATFORM_ALIAS
FEATURE = "deliverability_tests"
OWN, PLATFORM = "OWN", "PLATFORM"
POLL_AFTER = timedelta(seconds=8)
HISTORY = 20


# ---- the account
def service_for(tenant_id) -> DeliverabilityService | None:
    """The workspace's own row: its own account, or only its choice of clients while it uses the platform's. Scoped to the
    workspace itself, so the back-office (no workspace selected) reads it too."""
    from apps.delivery.engine import session
    with session.tenant_scope(tenant_id), session.tx():
        return DeliverabilityService.objects.filter(tenant_id=tenant_id).first()


def platform_service() -> DeliverabilityService | None:
    return DeliverabilityService.objects.using(P).filter(tenant_id__isnull=True).first()


def usable(service: DeliverabilityService | None) -> bool:
    return service is not None and bool(service.api_key_enc) and bool(service.is_active)


def account_for(tenant_id) -> tuple[DeliverabilityService | None, str | None]:
    """(the account a test runs through, OWN | PLATFORM), or (None, None) when there is neither."""
    own = service_for(tenant_id)
    if usable(own):
        return own, OWN
    platform = platform_service()
    if usable(platform):
        return platform, PLATFORM
    return None, None


def preferences(tenant_id) -> tuple[list[str], bool]:
    """The clients a test renders in and image blocking: the workspace's choice, else the platform account's defaults."""
    for row in (service_for(tenant_id), platform_service()):
        if row is not None and (row.default_clients or row.api_key_enc):
            return list(row.default_clients or []), bool(row.image_blocking)
    return [], False


def client_for(service: DeliverabilityService, tenant_id=None) -> InspectClient:
    # no provider_id: the account is not a delivery_provider row, so the bridge logs the calls without an integration record of its own
    return InspectClient(username=service.username or "", api_key=crypto.decrypt(service.api_key_enc) or "", region=service.region,
                         tenant_id=str(tenant_id or service.tenant_id or ""))


def check_service(service: DeliverabilityService) -> tuple[bool, str]:
    ok, detail = client_for(service).check()
    service.last_checked_at = timezone.now()
    service.last_check_ok = ok
    service.last_check_error = detail or None
    service.save(update_fields=["last_checked_at", "last_check_ok", "last_check_error"], using=P if service.tenant_id is None else None)
    return ok, detail


def service_payload(service: DeliverabilityService | None, tenant_id=None) -> dict:
    """The workspace's own account (configured: it has one), and which account its tests use: OWN, PLATFORM or none."""
    platform_ready = usable(platform_service())
    uses = OWN if usable(service) else PLATFORM if platform_ready else None
    clients, blocking = preferences(tenant_id) if tenant_id else (list((service and service.default_clients) or []), bool(service and service.image_blocking))
    if service is None:
        return {"configured": False, "provider": PROVIDER_TYPE, "region": "US", "username": "", "has_api_key": False, "default_clients": clients, "image_blocking": blocking,
                "is_active": False, "last_checked_at": None, "last_check_ok": None, "last_check_error": None, "uses": uses, "platform_available": platform_ready}
    return {"configured": bool(service.api_key_enc), "provider": service.provider, "region": service.region, "username": service.username or "",
            "has_api_key": bool(service.api_key_enc), "default_clients": clients, "image_blocking": blocking,
            "is_active": bool(service.is_active), "last_checked_at": service.last_checked_at, "last_check_ok": service.last_check_ok, "last_check_error": service.last_check_error,
            "uses": uses, "platform_available": platform_ready}


# ---- the allowance
def allowance(tenant_id) -> dict:
    """How many tests the workspace may still run this month. limit None = unlimited (an unlimited plan, or the workspace's own
    account); enabled False = the plan or the workspace switched tests off. note: where the number comes from, in words."""
    _service, account = account_for(tenant_id)
    plan = billing.plan_for(tenant_id) or {}
    plan_limit = plan.get("max_deliverability_tests")
    added = billing.added_tests(tenant_id)
    month = billing.month_start()
    own = account == OWN
    limit = None if own or plan_limit is None else int(plan_limit) + added
    used = billing.tests_this_month(tenant_id) if own else billing.tests_this_month(tenant_id, account=PLATFORM)
    left = None if limit is None else max(0, limit - used)
    plan_name = plan.get("name") or "current"
    if own:
        note = "Through your own Mailgun account: C360 does not limit them."
    elif plan_limit is None:
        note = f"Unlimited on the {plan_name} plan."
    elif added:
        last = _month_end(month)
        note = f"{int(plan_limit)} a month on the {plan_name} plan + {added} added for {month:%B}. Added tests end on {last:%b} {last.day}."
    else:
        note = f"{int(plan_limit)} a month on the {plan_name} plan."
    return {"enabled": params.enabled(tenant_id, FEATURE), "used": used, "limit": limit, "left": left, "month": month.isoformat(),
            "plan": plan.get("name"), "plan_limit": plan_limit, "added": added, "account": account, "configured": account is not None, "note": note}


def _month_end(month):
    following = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    return following - timedelta(days=1)


def assert_can_test(tenant_id) -> tuple[DeliverabilityService, str]:
    if not params.enabled(tenant_id, FEATURE):
        raise PermissionDenied("Deliverability tests are not included in this workspace's plan.")
    service, account = account_for(tenant_id)
    if service is None:
        raise Conflict("No inbox-preview account is available. Ask your platform team, or add your own Mailgun Inspect account under "
                       "Settings → Sending Engines → Deliverability Testing.")
    state = allowance(tenant_id)
    if state["left"] == 0:
        following = _month_end(billing.month_start()) + timedelta(days=1)
        source = f" ({state['plan_limit']} on the {state['plan'] or 'current'} plan + {state['added']} added)" if state["added"] else ""
        raise Conflict(f"This workspace has used all {state['limit']} deliverability tests for {billing.month_start():%B}{source}. "
                       f"More become available on {following:%b} {following.day}, or ask your platform team to add tests for this month.")
    return service, account


# ---- the content
def sample_render(template: TemplateMaster) -> tuple[str, str, int]:
    """The template's latest content with every tag filled from its sample value: what a test send would show."""
    content = RenderedTemplateContent.objects.filter(template_id=template.pk).order_by("-version_number").first()
    if content is None or not content.html_content:
        raise Conflict("Save the template's design first: there is nothing rendered to test yet.")
    tags = {tag.tag_key.strip("{} "): tag for tag in PersonalizationTag.objects.filter(tenant_id=template.tenant_id, is_active=True, deleted_at__isnull=True)}
    fill = lambda text: design.render_with_samples(modern_tags(text or ""), tags)                                 # noqa: E731
    subject = fill(content.subject_line)
    html = with_preheader(fill(content.html_content), fill(content.preheader))
    return subject, html, int(content.version_number)


# ---- the tests
def start_preview(tenant_id, template: TemplateMaster, user_id, *, clients: list[str] | None = None, image_blocking: bool | None = None) -> DeliverabilityTest:
    service, account = assert_can_test(tenant_id)
    subject, html, version = sample_render(template)
    default_clients, default_blocking = preferences(tenant_id)
    chosen = [str(c) for c in (clients if clients is not None else default_clients) if str(c).strip()]
    block = bool(default_blocking if image_blocking is None else image_blocking)
    client = client_for(service, tenant_id)
    # on the shared account the workspace's code tells the tests apart in Mailgun too
    reference = f"cep:{_tenant_code(tenant_id)}:{template.pk}:{version}" if account == PLATFORM else f"cep:{template.pk}:{version}"
    try:
        provider_test_id = client.create_preview(subject=subject, html=html, clients=chosen, image_blocking=block, reference_id=reference)
    except ProviderError as exc:
        raise Conflict(f"The test could not be started: {exc}") from exc
    finally:
        client.close()
    return DeliverabilityTest.objects.create(tenant_id=tenant_id, template=template, template_version=version, kind="PREVIEW", provider=service.provider, account=account,
                                             provider_test_id=provider_test_id, status="PENDING", subject=subject[:300], clients=chosen,
                                             summary={"clients": len(chosen) or None, "complete": 0, "failed": 0, "processing": len(chosen) or None},
                                             requested_by_id=user_id)


def _tenant_code(tenant_id) -> str:
    from apps.tenants.models import Tenant
    return Tenant.objects.using(P).filter(pk=tenant_id).values_list("code", flat=True).first() or str(tenant_id)[:8]


def refresh(test: DeliverabilityTest) -> DeliverabilityTest:
    """Fetches the provider's progress when the test is still running and the last look is old enough."""
    if test.status in ("COMPLETE", "FAILED") or not test.provider_test_id:
        return test
    now = timezone.now()
    if test.checked_at and now - test.checked_at < POLL_AFTER:
        return test
    service = platform_service() if test.account == PLATFORM else service_for(test.tenant_id)     # the account that ran it
    if service is None or not service.api_key_enc:
        return test
    client = client_for(service, test.tenant_id)
    try:
        results = client.results(test.provider_test_id)
    except ProviderError as exc:
        test.checked_at = now
        if not exc.retryable:
            test.status, test.error, test.completed_at = "FAILED", str(exc), now
        test.save(update_fields=["checked_at", "status", "error", "completed_at"])
        return test
    finally:
        client.close()
    counts = {"complete": 0, "failed": 0, "processing": 0}
    for row in results.values():
        counts["complete" if row["status"] == "COMPLETE" else "failed" if row["status"] == "FAILED" else "processing"] += 1
    test.results = results
    test.summary = {"clients": len(results) or test.summary.get("clients"), **counts}
    test.checked_at = now
    if results and counts["processing"] == 0:
        test.status = "COMPLETE" if counts["complete"] else "FAILED"
        test.completed_at = now
        if test.status == "FAILED":
            test.error = "No client rendered the email. " + "; ".join(sorted({r["detail"] for r in results.values() if r.get("detail")}))[:400]
    else:
        test.status = "PROCESSING"
    test.save(update_fields=["results", "summary", "checked_at", "status", "completed_at", "error"])
    return test


def tests_for(template: TemplateMaster) -> list[DeliverabilityTest]:
    return list(DeliverabilityTest.objects.filter(template=template).select_related("requested_by").order_by("-requested_at")[:HISTORY])


def payload(test: DeliverabilityTest, *, full: bool = True) -> dict:
    rows = sorted(test.results.values(), key=lambda r: (r.get("category", ""), r.get("name", ""))) if full else []
    who = getattr(test.requested_by, "display_name", None) or getattr(test.requested_by, "email", None)
    return {"id": str(test.pk), "template": str(test.template_id), "template_version": test.template_version, "kind": test.kind, "provider": test.provider,
            "status": test.status, "subject": test.subject, "clients": list(test.clients or []), "summary": dict(test.summary or {}), "error": test.error,
            "requested_by": who, "requested_at": test.requested_at, "completed_at": test.completed_at, "account": test.account,
            "previews": rows,
            # the slots the panel already shows; filled when the spam check and inbox placement arrive
            "spam": None, "placement": None}
