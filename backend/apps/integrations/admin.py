"""Back-office: the integrations of every workspace, their policies, the call log and the per-minute figures."""
import json

from django.conf import settings
from django.contrib import admin, messages
from unfold.decorators import action, display

from apps.adminutils import BaseAdmin, ReadOnlyAdmin, register_app_models

from .bridge import logbook
from .bridge.outbound import Breaker
from .models import Integration, IntegrationLog

OUTCOME_WORD = {"OK": "OK", "RETRY": "Retrying", "THROTTLED": "Throttled", "ERROR": "Error", "BREAKER": "Circuit Open", "REJECTED": "Rejected", "PAUSED": "Paused"}
OUTCOME_LABEL = {"OK": "success", "REJECTED": "info", "RETRY": "warning", "ERROR": "danger", "THROTTLED": "warning", "BREAKER": "danger", "PAUSED": "warning"}


@admin.register(Integration)
class IntegrationAdmin(BaseAdmin):
    """Made by the platform on a workspace's first call (or its onboarding); edit the throttle, breaker and log policy here.
    Blank throttle = the plan's default for an inbound integration, the sending engine's own rate for an outbound one."""
    list_display = ("tenant", "name", "kind", "direction", "system", "show_status", "throttle_per_minute", "log_level", "last_call_at", "show_last_outcome")
    list_filter = ("kind", "direction", "system", "status", "log_level", "tenant")
    search_fields = ("name",)
    ordering = ("tenant", "direction", "name")
    actions = ("pause", "resume", "reset_breaker")
    readonly_fields = ("id", "tenant", "kind", "direction", "system", "delivery_provider", "breaker_open_until", "last_call_at", "last_outcome", "last_error",
                       "created_at", "updated_at", "row_version")
    fieldsets = (
        ("Integration", {"fields": ("tenant", "name", "kind", "direction", "system", "delivery_provider", "status", "environment")}),
        ("Throttle", {"fields": ("throttle_per_minute", "throttle_burst"),
                      "description": "Calls per minute. Blank: the plan's default (integrations.inbound_per_minute) for POS receipts, the engine's own rate for a sending engine."}),
        ("Retries and Circuit Breaker", {"fields": ("retry_max_attempts", "breaker_failures", "breaker_cooldown_seconds", "breaker_open_until"),
                                         "description": "After this many consecutive failures the engine is not called for the cooldown; sends are retried after it."}),
        ("Log", {"fields": ("log_level", "log_body_max_bytes", "log_retention_days"),
                 "description": "Card numbers and credentials are never stored, whatever the level. Bodies above the cap keep their start and a digest."}),
        ("Last Call", {"fields": ("last_outcome", "last_error")}),
        ("System", {"fields": ("id", "created_at", "updated_at", "row_version"), "classes": ("collapse",)}),
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        logbook.invalidate(obj.tenant_id, obj.kind, obj.delivery_provider_id and str(obj.delivery_provider_id))

    @display(description="Status", label={"ACTIVE": "success", "PAUSED": "warning"})
    def show_status(self, obj):
        return obj.status, obj.status.title()

    @display(description="Last Outcome", label=OUTCOME_LABEL)
    def show_last_outcome(self, obj):
        return (obj.last_outcome, OUTCOME_WORD.get(obj.last_outcome, obj.last_outcome.title())) if obj.last_outcome else ""

    @action(description="Pause: inbound answers 503, an engine's sends wait")
    def pause(self, request, queryset):
        for item in queryset.filter(status="ACTIVE"):
            self.set_fields(request, item, status="PAUSED")
            logbook.invalidate(item.tenant_id, item.kind, item.delivery_provider_id and str(item.delivery_provider_id))
        messages.warning(request, "Paused. Takes effect within a minute.")

    @action(description="Resume")
    def resume(self, request, queryset):
        for item in queryset.filter(status="PAUSED"):
            self.set_fields(request, item, status="ACTIVE")
            logbook.invalidate(item.tenant_id, item.kind, item.delivery_provider_id and str(item.delivery_provider_id))
        messages.success(request, "Resumed.")

    @action(description="Close the Circuit Now (forget the recent failures)")
    def reset_breaker(self, request, queryset):
        for item in queryset:
            Breaker({"id": str(item.pk), "tenant_id": str(item.tenant_id), "breaker_failures": item.breaker_failures,
                     "breaker_cooldown_seconds": item.breaker_cooldown_seconds}).reset()
        messages.success(request, "Circuit closed; the next call goes through.")


@admin.register(IntegrationLog)
class IntegrationLogAdmin(ReadOnlyAdmin):
    """Every call in either direction, newest first. Search by correlation id or reference to follow one receipt or one message."""
    list_display = ("started_at", "tenant", "direction", "system", "method", "show_url", "response_status", "show_outcome", "duration_ms", "related_ref")
    list_filter = ("direction", "system", "outcome", "kind", "tenant")
    search_fields = ("correlation_id", "related_ref", "url")
    ordering = ("-started_at",)
    list_per_page = 50
    readonly_fields = ("tenant", "integration", "direction", "kind", "system", "correlation_id", "related_ref", "method", "url", "show_request_headers",
                       "show_request_body", "request_bytes", "response_status", "show_response_headers", "show_response_body", "response_bytes", "outcome",
                       "error_class", "error_message", "attempt", "duration_ms", "api_client_id", "worker", "started_at")
    fields = readonly_fields

    def get_queryset(self, request):
        return super().get_queryset(request).using(settings.PLATFORM_ALIAS)

    @display(description="Address")
    def show_url(self, obj):
        return obj.url if len(obj.url) <= 80 else obj.url[:77] + "…"

    @display(description="Outcome", label=OUTCOME_LABEL)
    def show_outcome(self, obj):
        return obj.outcome, OUTCOME_WORD.get(obj.outcome, obj.outcome.title())

    @display(description="Request Headers")
    def show_request_headers(self, obj):
        return json.dumps(obj.request_headers, indent=2) if obj.request_headers else "—"

    @display(description="Request Body")
    def show_request_body(self, obj):
        return obj.request_body or "—"

    @display(description="Response Headers")
    def show_response_headers(self, obj):
        return json.dumps(obj.response_headers, indent=2) if obj.response_headers else "—"

    @display(description="Response Body")
    def show_response_body(self, obj):
        return obj.response_body or "—"


register_app_models(__package__)
