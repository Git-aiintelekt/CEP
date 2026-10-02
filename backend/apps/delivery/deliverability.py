"""Deliverability tests of a template's content: inbox previews through the workspace's Mailgun Inspect account, counted
against the plan's monthly allowance. The spam verdict and inbox placement are not run yet; a test carries their slots
so the panel already has somewhere to put them.

A test counts the moment it is requested (that is when the provider bills it). Results are fetched when the test is read
and the last look is older than POLL_AFTER; nothing runs in the background.
"""
from __future__ import annotations

from datetime import timedelta

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

FEATURE = "deliverability_tests"
POLL_AFTER = timedelta(seconds=8)
HISTORY = 20


# ---- the account
def service_for(tenant_id) -> DeliverabilityService | None:
    return DeliverabilityService.objects.filter(tenant_id=tenant_id).first()


def client_for(service: DeliverabilityService) -> InspectClient:
    # no provider_id: the account is not a delivery_provider row, so the bridge logs the calls without an integration record of its own
    return InspectClient(username=service.username or "", api_key=crypto.decrypt(service.api_key_enc) or "", region=service.region, tenant_id=str(service.tenant_id))


def check_service(service: DeliverabilityService) -> tuple[bool, str]:
    ok, detail = client_for(service).check()
    service.last_checked_at = timezone.now()
    service.last_check_ok = ok
    service.last_check_error = detail or None
    service.save(update_fields=["last_checked_at", "last_check_ok", "last_check_error"])
    return ok, detail


def service_payload(service: DeliverabilityService | None) -> dict:
    if service is None:
        return {"configured": False, "provider": PROVIDER_TYPE, "region": "US", "username": "", "has_api_key": False, "default_clients": [], "image_blocking": False,
                "is_active": False, "last_checked_at": None, "last_check_ok": None, "last_check_error": None}
    return {"configured": bool(service.api_key_enc), "provider": service.provider, "region": service.region, "username": service.username or "",
            "has_api_key": bool(service.api_key_enc), "default_clients": list(service.default_clients or []), "image_blocking": bool(service.image_blocking),
            "is_active": bool(service.is_active), "last_checked_at": service.last_checked_at, "last_check_ok": service.last_check_ok, "last_check_error": service.last_check_error}


# ---- the allowance
def allowance(tenant_id) -> dict:
    """How many tests the workspace may still run this month. limit None = unlimited; enabled False = the plan or the workspace switched it off."""
    plan = billing.plan_for(tenant_id) or {}
    limit = plan.get("max_deliverability_tests")
    used = billing.tests_this_month(tenant_id)
    left = None if limit is None else max(0, int(limit) - used)
    return {"enabled": params.enabled(tenant_id, FEATURE), "used": used, "limit": limit, "left": left, "month": billing.month_start().isoformat(),
            "plan": plan.get("name"), "configured": bool((service_for(tenant_id) or DeliverabilityService()).api_key_enc)}


def assert_can_test(tenant_id) -> DeliverabilityService:
    if not params.enabled(tenant_id, FEATURE):
        raise PermissionDenied("Deliverability tests are not included in this workspace's plan.")
    service = service_for(tenant_id)
    if service is None or not service.api_key_enc or not service.is_active:
        raise Conflict("No inbox-preview account is set up. Add the Mailgun Inspect account under Settings → Delivery → Deliverability Testing.")
    state = allowance(tenant_id)
    if state["left"] == 0:
        raise Conflict(f"This workspace has used its {state['limit']} deliverability tests for the month. Testing resumes next month, or ask for a plan upgrade.")
    return service


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
    service = assert_can_test(tenant_id)
    subject, html, version = sample_render(template)
    chosen = [str(c) for c in (clients if clients is not None else service.default_clients or []) if str(c).strip()]
    block = bool(service.image_blocking if image_blocking is None else image_blocking)
    client = client_for(service)
    try:
        provider_test_id = client.create_preview(subject=subject, html=html, clients=chosen, image_blocking=block, reference_id=f"cep:{template.pk}:{version}")
    except ProviderError as exc:
        raise Conflict(f"The test could not be started: {exc}") from exc
    finally:
        client.close()
    return DeliverabilityTest.objects.create(tenant_id=tenant_id, template=template, template_version=version, kind="PREVIEW", provider=service.provider,
                                             provider_test_id=provider_test_id, status="PENDING", subject=subject[:300], clients=chosen,
                                             summary={"clients": len(chosen) or None, "complete": 0, "failed": 0, "processing": len(chosen) or None},
                                             requested_by_id=user_id)


def refresh(test: DeliverabilityTest) -> DeliverabilityTest:
    """Fetches the provider's progress when the test is still running and the last look is old enough."""
    if test.status in ("COMPLETE", "FAILED") or not test.provider_test_id:
        return test
    now = timezone.now()
    if test.checked_at and now - test.checked_at < POLL_AFTER:
        return test
    service = service_for(test.tenant_id)
    if service is None or not service.api_key_enc:
        return test
    client = client_for(service)
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
            "requested_by": who, "requested_at": test.requested_at, "completed_at": test.completed_at,
            "previews": rows,
            # the slots the panel already shows; filled when the spam check and inbox placement arrive
            "spam": None, "placement": None}
