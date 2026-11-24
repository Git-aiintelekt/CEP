"""Receipt Layouts: the receipt inside an E-Receipt, designed once and picked by as many E-Receipt templates as want it.

A template picks one by saving a receipt version that names it (design.save_receipt with layout_id); until then it keeps its
own layout, as before. A change to a library layout reaches every template that picks it, so a save is refused while one of
them sends in a live drip, and archiving is refused while any template still picks it.
"""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from api.exceptions import Conflict

from . import design
from .models import ReceiptLayout, TemplateDesignState, TemplateMaster
from apps.identity import names

PRESETS = ("COMPACT", "STANDARD", "ITEMIZED", "REGISTER", "CUSTOM_HTML")
CONTENT_KEYS = ("sections", "custom_html", "custom_css", "item_row", "register")
MAX_NAME = 120


def templates_using(tenant_id) -> dict[str, list[TemplateMaster]]:
    """layout id -> the E-Receipt templates (not archived) whose latest receipt version picks it."""
    latest = (TemplateDesignState.objects.filter(editor_state__kind="receipt", template__tenant_id=tenant_id, template__channel="E_RECEIPT",
                                                 template__deleted_at__isnull=True)
              .exclude(template__status="ARCHIVED").order_by("template_id", "-version_number").distinct("template_id")
              .select_related("template"))
    using: dict[str, list[TemplateMaster]] = {}
    for state in latest:
        layout_id = (state.editor_state or {}).get("layout_id")
        if layout_id:
            using.setdefault(str(layout_id), []).append(state.template)
    for templates in using.values():
        templates.sort(key=lambda template: template.name.lower())
    return using


def _kind(layout: ReceiptLayout) -> str:
    return "CUSTOM_HTML" if layout.layout_preset == "CUSTOM_HTML" else "SETTINGS"


def summary(layout: ReceiptLayout, using: list[TemplateMaster]) -> dict:
    return {"id": str(layout.id), "name": layout.name, "layout_preset": layout.layout_preset, "kind": _kind(layout),
            "used_by": len(using), "version_number": layout.version_number, "updated_at": layout.updated_at,
            "updated_by": names.label_of(layout, "updated_by"), "archived": layout.archived_at is not None}


def payload(layout: ReceiptLayout, using: list[TemplateMaster] | None = None) -> dict:
    if using is None:
        using = templates_using(layout.tenant_id).get(str(layout.id), [])
    content = layout.content or {}
    return {**summary(layout, using),
            "sections": content.get("sections") or design.default_receipt_sections(),
            "custom_html": content.get("custom_html"), "custom_css": content.get("custom_css"), "item_row": content.get("item_row"),
            "register": content.get("register"),
            "templates": [{"id": str(t.id), "name": t.name, "status": t.status} for t in using]}


def listing(tenant_id, *, archived: bool = False) -> list[dict]:
    using = templates_using(tenant_id)
    layouts = (ReceiptLayout.objects.filter(tenant_id=tenant_id, archived_at__isnull=not archived)
               .select_related("updated_by").order_by("-updated_at"))
    return [summary(layout, using.get(str(layout.id), [])) for layout in layouts]


def _clean_name(tenant_id, name, exclude=None) -> str:
    name = " ".join(str(name or "").split())
    if not name:
        raise ValidationError({"name": "Give the layout a name."})
    if len(name) > MAX_NAME:
        raise ValidationError({"name": f"The name is longer than {MAX_NAME} characters."})
    taken = ReceiptLayout.objects.filter(tenant_id=tenant_id, archived_at__isnull=True, name__iexact=name)
    if exclude is not None:
        taken = taken.exclude(pk=exclude)
    if taken.exists():
        raise ValidationError({"name": "Another receipt layout has this name."})
    return name


def _clean_content(layout_preset: str, content: dict) -> dict:
    if layout_preset not in PRESETS:
        raise ValidationError({"layout_preset": "Choose a layout preset."})
    content = {key: content.get(key) for key in CONTENT_KEYS}
    sections = content["sections"] if isinstance(content["sections"], list) else []
    if not sections and layout_preset not in ("REGISTER", "CUSTOM_HTML"):
        sections = design.default_receipt_sections()
    errors, settings = design.receipt_content_errors(layout_preset, sections, content["custom_html"], content["custom_css"],
                                                     content["item_row"], content["register"] if layout_preset == "REGISTER" else None)
    if errors:
        raise ValidationError(errors)
    return {"sections": sections, "custom_html": content["custom_html"], "custom_css": content["custom_css"],
            "item_row": content["item_row"] or None, "register": settings}


@transaction.atomic
def create(tenant_id, user_id, *, name: str, layout_preset: str | None = None, content: dict | None = None,
           copy_from=None, from_template=None) -> dict:
    """A new layout: from the content given, a copy of another layout, or a template's own layout (Save to Library)."""
    if copy_from is not None:
        source = ReceiptLayout.objects.filter(pk=copy_from, tenant_id=tenant_id).first()
        if source is None:
            raise ValidationError({"copy_from": "That receipt layout does not exist."})
        layout_preset, content = source.layout_preset, source.content
    elif from_template is not None:
        template = TemplateMaster.objects.filter(pk=from_template, tenant_id=tenant_id, channel="E_RECEIPT", deleted_at__isnull=True).first()
        if template is None:
            raise ValidationError({"from_template": "That E-Receipt template does not exist."})
        own = design.receipt_payload(template)
        layout_preset, content = own["layout_preset"], own
    cleaned = _clean_content(layout_preset or "", content or {})
    layout = ReceiptLayout.objects.create(tenant_id=tenant_id, name=_clean_name(tenant_id, name), layout_preset=layout_preset,
                                          content=cleaned, created_by_id=user_id, updated_by_id=user_id)
    return payload(ReceiptLayout.objects.select_related("updated_by").get(pk=layout.pk), [])


@transaction.atomic
def save(layout: ReceiptLayout, user_id, *, name: str, layout_preset: str, content: dict, base_version: int) -> dict:
    """A new version of the layout, reaching every template that picks it; two people saving at once get a 409."""
    from apps.campaigns import drip
    locked = ReceiptLayout.objects.select_for_update().get(pk=layout.pk)
    if locked.archived_at is not None:
        raise Conflict("An archived receipt layout cannot be changed.")
    if base_version != locked.version_number:
        raise Conflict(f"This receipt layout was saved by someone else (now at version {locked.version_number}). Reload before saving again.")
    cleaned = _clean_content(layout_preset, content)
    using = templates_using(locked.tenant_id).get(str(locked.id), [])
    for template in using:
        drip.guard_template(template, "edit")                 # a live drip sends exactly what was tested
    ReceiptLayout.objects.filter(pk=locked.pk).update(
        name=_clean_name(locked.tenant_id, name, exclude=locked.pk), layout_preset=layout_preset, content=cleaned,
        version_number=locked.version_number + 1, row_version=locked.row_version + 1, updated_by_id=user_id, updated_at=timezone.now())
    for template in using:
        TemplateMaster.objects.filter(pk=template.pk).update(updated_at=timezone.now())
        design._drip_content_changed(template, user_id)
    return payload(ReceiptLayout.objects.select_related("updated_by").get(pk=locked.pk), using)


@transaction.atomic
def rename(layout: ReceiptLayout, user_id, name: str) -> dict:
    ReceiptLayout.objects.filter(pk=layout.pk).update(name=_clean_name(layout.tenant_id, name, exclude=layout.pk), updated_by_id=user_id,
                                                      updated_at=timezone.now(), row_version=layout.row_version + 1)
    return payload(ReceiptLayout.objects.select_related("updated_by").get(pk=layout.pk))


@transaction.atomic
def archive(layout: ReceiptLayout, user_id) -> dict:
    using = templates_using(layout.tenant_id).get(str(layout.id), [])
    if using:
        names = ", ".join(template.name for template in using[:5]) + (f" and {len(using) - 5} more" if len(using) > 5 else "")
        raise Conflict(f"Used by {names}. Pick another layout in those templates first.")
    ReceiptLayout.objects.filter(pk=layout.pk).update(archived_at=timezone.now(), updated_by_id=user_id, row_version=layout.row_version + 1)
    return payload(ReceiptLayout.objects.select_related("updated_by").get(pk=layout.pk), [])


def copy_name(tenant_id, name: str) -> str:
    """"Citi Register copy", then "Citi Register copy 2" ... a name no live layout has."""
    base = f"{name} copy"[:MAX_NAME]
    taken = {n.lower() for n in ReceiptLayout.objects.filter(tenant_id=tenant_id, archived_at__isnull=True).filter(
        Q(name__iexact=base) | Q(name__istartswith=f"{base} ")).values_list("name", flat=True)}
    if base.lower() not in taken:
        return base
    number = 2
    while f"{base} {number}".lower() in taken:
        number += 1
    return f"{base} {number}"
