from django.contrib import admin

from apps.adminutils import ReadOnlyAdmin, register_app_models

from .models import DefinitionAuditLog


@admin.register(DefinitionAuditLog)
class DefinitionAuditLogAdmin(ReadOnlyAdmin):
    """Who changed which definition, when, and what it looked like before and after. Written by database triggers."""
    list_display = ("changed_at", "tenant", "entity_table", "action", "entity_id", "changed_by", "changed_columns")
    list_filter = ("tenant", "action", "entity_table")
    search_fields = ("entity_id", "entity_table")
    ordering = ("-changed_at",)
    date_hierarchy = None                                  # partitioned by month: a date hierarchy would scan every partition


register_app_models(__package__)
