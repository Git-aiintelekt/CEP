"""WhatsApp templates: written here with the workspace's tags, reviewed by Meta, sent only once Meta approves them.

    the body          written with tags ({{first_name}} or ${FIRST_NAME}); Meta gets it with numbered variables ({{1}}, {{2}}) in
                      the order the tags first appear, a sample value for each (Meta reviews the message with them) and CEP
                      keeps what each number is filled with, and what to send when the tag is empty for someone.
    the review        Submit to Meta -> PENDING; Meta's callback (or a Sync) -> APPROVED, REJECTED with its reason, later PAUSED
                      or DISABLED for low quality. Only an APPROVED template sends. A template in review or approved is not
                      changed here: Meta sends exactly what it approved, so a change is a copy, reviewed again.
    Sync              every template of the business account: new ones (made in WhatsApp Manager) appear as templates of origin
                      META, whose numbers the workspace maps to tags; known ones take Meta's status, reason and quality.

The body is versioned like a text's (template_design_state + rendered_template_content.sms_body, in the tag form), so a
campaign run, its preview and the drip checks read it the way they read a text message.
"""
import re

import requests
from django.db import transaction
from django.db.models.functions import Now
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from api.exceptions import Conflict

from . import design
from .models import PersonalizationTag, RenderedTemplateContent, TemplateDesignState, TemplateMaster, TemplateTag, WhatsAppTemplate

NAME_RE = re.compile(r"^[a-z0-9_]{1,512}$")
NUMBER_RE = re.compile(r"\{\{\s*(\d+)\s*\}\}")
MAX_BODY, MAX_HEADER, MAX_FOOTER, MAX_BUTTON_TEXT, MAX_BUTTONS = 1024, 60, 60, 25, 10
LANGUAGES = ("en", "en_US", "en_GB", "ms", "id", "fil", "th", "vi", "zh_CN", "zh_HK", "zh_TW", "ta", "hi", "ja", "ko")
EDITABLE = ("DRAFT", "REJECTED")
MEDIA_TYPES = {"IMAGE": ("image/jpeg", "image/png"), "DOCUMENT": ("application/pdf",), "VIDEO": ("video/mp4",)}
MEDIA_MAX_BYTES = {"IMAGE": 5 * 1024 * 1024, "DOCUMENT": 100 * 1024 * 1024, "VIDEO": 16 * 1024 * 1024}


def tag_key(match) -> str:
    """{{first_name}} and ${FIRST_NAME} are the same tag."""
    return match.group(1).lower() if match.re is design.LEGACY_TAG_RE else match.group(1)


def to_meta(body: str) -> tuple[str, list[str]]:
    """-> (the body with {{1}}, {{2}} where the tags were, the tag of each number). A tag used twice keeps its number."""
    order: list[str] = []

    def number(match):
        key = tag_key(match)
        if key not in order:
            order.append(key)
        return "{{" + str(order.index(key) + 1) + "}}"
    text = design.LEGACY_TAG_RE.sub(number, body)
    return design.TAG_RE.sub(number, text), order


def to_tags(body: str, variables: list[dict]) -> str:
    """Meta's form back to tags, for the record and the previews; a number without a tag stays {{n}}."""
    def tag(match):
        index = int(match.group(1)) - 1
        key = (variables[index].get("tag") if 0 <= index < len(variables) else "") or ""
        return "{{" + key + "}}" if key else match.group(0)
    return NUMBER_RE.sub(tag, body)


def filled(body: str, values: list[str]) -> str:
    return NUMBER_RE.sub(lambda m: values[int(m.group(1)) - 1] if 0 < int(m.group(1)) <= len(values) else m.group(0), body)


# ------------------------------------------------------------------------------------------------------------ reading
def row_of(template: TemplateMaster) -> WhatsAppTemplate | None:
    return WhatsAppTemplate.objects.filter(template=template).select_related("delivery_provider", "header_media_asset").first()


def header_link(template: TemplateMaster) -> str | None:
    """The public address of a media header's file: what Meta fetches for each message."""
    row = row_of(template)
    media = row.header_media_asset if row and row.header_type in MEDIA_TYPES else None
    return (getattr(media, "cdn_url", None) or media.public_url or None) if media else None


def findings(row: WhatsAppTemplate | None, body: str) -> dict:
    """What Meta would refuse, found before submitting: Meta's own review rules that can be checked here."""
    meta_body, order = to_meta(body)
    stripped = body.strip()
    starts = bool(re.match(r"^(\{\{[^}]*\}\}|\$\{[^}]*\})", stripped))
    ends = bool(re.search(r"(\{\{[^}]*\}\}|\$\{[^}]*\})[.!?]?$", stripped))
    known = {tag.tag_key.strip("{} ") for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True)}
    words = len(re.findall(r"\w+", NUMBER_RE.sub("", meta_body)))
    return {
        "characters": len(meta_body), "max_characters": MAX_BODY, "tags_used": order,
        "unknown_tags": [key for key in order if key not in known] if row is None or row.origin == "CEP" else [],
        "starts_or_ends_with_tag": stripped != "" and (starts or ends),
        "adjacent_tags": bool(re.search(r"\}\}\s*(\{\{|\$\{)", stripped)),
        "too_many_tags": bool(order) and words < 3 * len(order),     # Meta: too many variables for the length of the message
        "missing_opt_out": row is not None and row.category == "MARKETING" and not re.search(r"\bstop\b", (body + " " + (row.footer_text or "") + " "
                                                                                                         + " ".join(b.get("text", "") for b in row.buttons or [])), re.I),
    }


def payload(template: TemplateMaster) -> dict:
    row = row_of(template)
    content = RenderedTemplateContent.objects.filter(template=template).order_by("-version_number").first()
    body = (content.sms_body if content else None) or (to_tags(row.body, row.variables) if row else "")
    media = row.header_media_asset if row else None
    return {
        "template": str(template.pk), "name": template.name, "status": template.status, "version_number": content.version_number if content else 0,
        "engine": str(row.delivery_provider_id) if row and row.delivery_provider_id else None,
        "engine_name": row.delivery_provider.name if row and row.delivery_provider_id else None,
        "meta_name": row.meta_name if row else "", "language": row.language if row else "en", "category": row.category if row else "MARKETING",
        "header_type": row.header_type if row else "NONE", "header_text": (row.header_text if row else None) or "",
        "header_media": {"id": str(media.pk), "url": media.public_url, "file_name": media.file_name, "mime_type": media.mime_type, "byte_size": media.byte_size} if media else None,
        "body": body, "meta_body": row.body if row else to_meta(body)[0], "footer_text": (row.footer_text if row else None) or "", "buttons": row.buttons if row else [],
        "variables": row.variables if row else [], "origin": row.origin if row else "CEP",
        "meta_status": row.meta_status if row else "DRAFT", "meta_reason": row.meta_reason if row else None, "meta_quality": row.meta_quality if row else None,
        "meta_template_id": row.meta_template_id if row else None, "submitted_at": row.submitted_at if row else None, "decided_at": row.decided_at if row else None,
        "synced_at": row.synced_at if row else None, "editable": row is None or (row.origin == "CEP" and row.meta_status in EDITABLE),
        "row_version": row.row_version if row else 0, "findings": findings(row, body),
    }


# ------------------------------------------------------------------------------------------------------------ saving
def _engine(engine_id):
    from apps.delivery.models import DeliveryProvider
    engine = DeliveryProvider.objects.filter(pk=engine_id, deleted_at__isnull=True, channel="WHATSAPP").first() if engine_id else None   # RLS: this tenant only
    if engine_id and engine is None:
        raise ValidationError({"engine": "Choose one of this workspace's WhatsApp numbers."})
    return engine


def _buttons(items) -> list[dict]:
    out, errors = [], []
    for index, item in enumerate(items or []):
        kind = str(item.get("type") or "").upper()
        text = " ".join(str(item.get("text") or "").split())
        if kind not in ("URL", "QUICK_REPLY", "PHONE_NUMBER"):
            errors.append(f"Button {index + 1}: choose a link, a quick reply or a phone number.")
            continue
        if not text or len(text) > MAX_BUTTON_TEXT:
            errors.append(f"Button {index + 1}: a label of 1 to {MAX_BUTTON_TEXT} characters.")
        button = {"type": kind, "text": text}
        if kind == "URL":
            button["url"] = str(item.get("url") or "").strip()
            if not button["url"].startswith("https://"):
                errors.append(f"Button {index + 1}: the link must start with https://.")
        if kind == "PHONE_NUMBER":
            button["phone"] = str(item.get("phone") or "").strip()
            if not re.match(r"^\+[1-9][0-9]{7,14}$", button["phone"]):
                errors.append(f"Button {index + 1}: the number with country code, e.g. +6568124400.")
        out.append(button)
    if len(out) > MAX_BUTTONS:
        errors.append(f"At most {MAX_BUTTONS} buttons.")
    if sum(b["type"] == "URL" for b in out) > 2:
        errors.append("At most 2 link buttons.")
    if sum(b["type"] == "PHONE_NUMBER" for b in out) > 1:
        errors.append("At most 1 phone button.")
    if errors:
        raise ValidationError({"buttons": errors})
    return out


@transaction.atomic
def save(template: TemplateMaster, user_id, *, data: dict) -> dict:
    """A new version of a WhatsApp template written here. `data`: engine, meta_name, language, category, header_type, header_text,
    header_media, body, footer_text, buttons, samples {tag: value}, fallbacks {tag: value}, base_version."""
    from apps.media.models import MediaAsset, TemplateMediaAsset
    if template.channel != "WHATSAPP":
        raise Conflict("The WhatsApp editor is for WhatsApp templates.")
    if template.status == "ARCHIVED" or template.deleted_at is not None:
        raise Conflict("An archived template cannot be changed.")
    TemplateMaster.objects.select_for_update().get(pk=template.pk)
    row = row_of(template)
    if row is not None and row.origin == "META":
        return save_mapping(template, row, data)
    if row is not None and row.meta_status not in EDITABLE:
        raise Conflict(f"Meta {'is reviewing' if row.meta_status == 'PENDING' else 'approved'} this template, so it cannot change: "
                       "Meta sends exactly what it reviewed. Copy it to make a changed version.")
    current = design.latest_content_version(template)
    if int(data.get("base_version") or 0) != current:
        raise Conflict(f"This template was saved by someone else (now at version {current}). Reload before saving again.")

    errors = {}
    meta_name = str(data.get("meta_name") or "").strip()
    if not NAME_RE.match(meta_name):
        errors["meta_name"] = "Lower-case letters, digits and underscores only, e.g. back_in_stock."
    language = str(data.get("language") or "en")
    if language not in LANGUAGES:
        errors["language"] = "Choose one of the languages offered."
    category = str(data.get("category") or "MARKETING")
    if category not in ("MARKETING", "UTILITY"):
        errors["category"] = "Choose Marketing or Utility."
    header_type = str(data.get("header_type") or "NONE")
    header_text = " ".join(str(data.get("header_text") or "").split())
    media = None
    if header_type not in ("NONE", "TEXT", "IMAGE", "DOCUMENT", "VIDEO"):
        errors["header_type"] = "Choose no header, text, a picture, a document or a video."
    elif header_type == "TEXT" and not (0 < len(header_text) <= MAX_HEADER):
        errors["header_text"] = f"A header of 1 to {MAX_HEADER} characters."
    elif header_type == "TEXT" and (design.TAG_RE.search(header_text) or design.LEGACY_TAG_RE.search(header_text)):
        errors["header_text"] = "The header is the same for everyone: put tags in the body."
    elif header_type in MEDIA_TYPES:
        media = MediaAsset.objects.filter(pk=data.get("header_media"), deleted_at__isnull=True).first() if data.get("header_media") else None
        if media is None:
            errors["header_media"] = "Choose the file the header shows."
        elif media.mime_type not in MEDIA_TYPES[header_type]:
            errors["header_media"] = {"IMAGE": "A picture header must be JPEG or PNG.", "DOCUMENT": "A document header must be a PDF.", "VIDEO": "A video header must be MP4."}[header_type]
        elif media.byte_size > MEDIA_MAX_BYTES[header_type]:
            errors["header_media"] = f"WhatsApp takes at most {MEDIA_MAX_BYTES[header_type] // (1024 * 1024)} MB for this header."
    body = str(data.get("body") or "").replace("\r\n", "\n").strip()
    meta_body, order = to_meta(body)
    found = findings(None, body)
    if not body:
        errors["body"] = "Write the message."
    elif len(meta_body) > MAX_BODY:
        errors["body"] = f"At most {MAX_BODY} characters."
    elif found["unknown_tags"]:
        errors["body"] = "Unknown tags: " + ", ".join("{{" + key + "}}" for key in found["unknown_tags"])
    elif found["starts_or_ends_with_tag"]:
        errors["body"] = "Meta refuses a message that starts or ends with a tag: put words before the first and after the last."
    elif found["adjacent_tags"]:
        errors["body"] = "Meta refuses two tags side by side: put a word between them."
    footer = " ".join(str(data.get("footer_text") or "").split())
    if len(footer) > MAX_FOOTER:
        errors["footer_text"] = f"At most {MAX_FOOTER} characters."
    samples, fallbacks = data.get("samples") or {}, data.get("fallbacks") or {}
    variables = [{"tag": key, "sample": " ".join(str(samples.get(key) or "").split())[:200], "fallback": " ".join(str(fallbacks.get(key) or "").split())[:200]} for key in order]
    missing = [v["tag"] for v in variables if not v["sample"]]
    if missing and "body" not in errors:
        errors["samples"] = "Meta reviews the message with a sample of each tag: " + ", ".join("{{" + key + "}}" for key in missing)
    try:
        buttons = _buttons(data.get("buttons"))
    except ValidationError as exc:
        errors.update(exc.detail)
        buttons = []
    engine = _engine(data.get("engine"))
    if errors:
        raise ValidationError(errors)
    clash = WhatsAppTemplate.objects.filter(delivery_provider=engine, meta_name=meta_name, language=language).exclude(template=template).first()
    if clash is not None:
        raise ValidationError({"meta_name": f"“{clash.template.name}” already has this name in this language on that number."})

    fields = {"delivery_provider": engine, "meta_name": meta_name, "language": language, "category": category, "header_type": header_type,
              "header_text": header_text if header_type == "TEXT" else None, "header_media_asset": media, "body": meta_body, "footer_text": footer or None,
              "buttons": buttons, "variables": variables, "meta_status": "DRAFT", "meta_reason": row.meta_reason if row else None}
    if row is None:
        row = WhatsAppTemplate.objects.create(template=template, tenant_id=template.tenant_id, origin="CEP", **fields)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
        row.row_version += 1
        row.save()
    WhatsAppTemplate.objects.filter(pk=row.pk).update(updated_at=Now())

    number = current + 1
    TemplateDesignState.objects.create(template=template, version_number=number, created_by_id=user_id,
                                       editor_state={"kind": "whatsapp", "channel": "WHATSAPP", "media_asset_id": str(media.pk) if media else None})
    RenderedTemplateContent.objects.create(template=template, version_number=number, sms_body=body, text_content=body)
    _link_tags(template, order, user_id)
    stale = TemplateMediaAsset.objects.filter(template=template)
    (stale.exclude(media_asset_id=media.pk) if media else stale).delete()
    if media and not TemplateMediaAsset.objects.filter(template=template, media_asset=media).exists():
        TemplateMediaAsset.objects.create(template=template, media_asset=media, tenant_id=template.tenant_id)
    TemplateMaster.objects.filter(pk=template.pk).update(updated_at=Now())
    return payload(template)


def save_mapping(template: TemplateMaster, row: WhatsAppTemplate, data: dict) -> dict:
    """A template made in WhatsApp Manager: Meta owns its words; the workspace says which tag fills each number."""
    tags = data.get("variable_tags") or []
    fallbacks = data.get("fallbacks") or {}
    known = {tag.tag_key.strip("{} ") for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True)}
    variables, errors = [], []
    for index, variable in enumerate(row.variables or []):
        key = str(tags[index] if index < len(tags) else variable.get("tag") or "").strip().strip("{}$ ").lower()
        if key and key not in known:
            errors.append(f"{{{{{index + 1}}}}}: there is no tag {key}.")
        variables.append({**variable, "tag": key, "fallback": " ".join(str(fallbacks.get(str(index + 1)) or variable.get("fallback") or "").split())[:200]})
    media = row.header_media_asset
    if row.header_type in MEDIA_TYPES and data.get("header_media"):
        from apps.media.models import MediaAsset
        media = MediaAsset.objects.filter(pk=data["header_media"], deleted_at__isnull=True).first()
        if media is None or media.mime_type not in MEDIA_TYPES[row.header_type]:
            raise ValidationError({"header_media": "Choose a file of the header's kind."})
    if errors:
        raise ValidationError({"variable_tags": errors})
    row.variables = variables
    row.header_media_asset = media
    row.row_version += 1
    row.save(update_fields=["variables", "header_media_asset", "row_version"])
    number = design.latest_content_version(template) + 1
    body = to_tags(row.body, variables)
    TemplateDesignState.objects.create(template=template, version_number=number, editor_state={"kind": "whatsapp", "channel": "WHATSAPP", "origin": "META"})
    RenderedTemplateContent.objects.create(template=template, version_number=number, sms_body=body, text_content=body)
    _link_tags(template, [v["tag"] for v in variables if v["tag"]], None)
    return payload(template)


def _link_tags(template, keys: list[str], user_id) -> None:
    tags = {tag.tag_key.strip("{} "): tag for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True)}
    wanted = [tags[key] for key in keys if key in tags]
    TemplateTag.objects.filter(template=template).exclude(tag_id__in=[tag.pk for tag in wanted]).delete()
    linked = set(TemplateTag.objects.filter(template=template).values_list("tag_id", flat=True))
    TemplateTag.objects.bulk_create([TemplateTag(template=template, tag=tag, tenant_id=template.tenant_id, sequence=index, created_by_id=user_id)
                                     for index, tag in enumerate(wanted) if tag.pk not in linked])


# ------------------------------------------------------------------------------------------------------------ Meta's review
def definition(row: WhatsAppTemplate, header_handle: str | None = None) -> dict:
    """What Meta's message_templates call takes for this template."""
    components = []
    if row.header_type == "TEXT":
        components.append({"type": "HEADER", "format": "TEXT", "text": row.header_text})
    elif row.header_type in MEDIA_TYPES:
        components.append({"type": "HEADER", "format": row.header_type, "example": {"header_handle": [header_handle]}})
    body = {"type": "BODY", "text": row.body}
    if row.variables:
        body["example"] = {"body_text": [[v["sample"] for v in row.variables]]}
    components.append(body)
    if row.footer_text:
        components.append({"type": "FOOTER", "text": row.footer_text})
    if row.buttons:
        components.append({"type": "BUTTONS", "buttons": [{"type": b["type"], "text": b["text"], **({"url": b["url"]} if b["type"] == "URL" else {}),
                                                            **({"phone_number": b["phone"]} if b["type"] == "PHONE_NUMBER" else {})} for b in row.buttons]})
    return {"name": row.meta_name, "language": row.language, "category": row.category, "components": components}


def blockers(template: TemplateMaster) -> dict:
    """What stops a WhatsApp template from being used by a campaign."""
    row = row_of(template)
    if row is None or not row.body.strip():
        return {"body": "Write and save the message first."}
    if row.meta_status != "APPROVED":
        return {"meta": {"DRAFT": "Submit it to Meta: WhatsApp sends only templates Meta approved.", "PENDING": "Meta is still reviewing it.",
                         "REJECTED": "Meta rejected it: change it and submit it again.", "PAUSED": "Meta paused it for low quality.",
                         "DISABLED": "Meta disabled it."}[row.meta_status]}
    if any(not v.get("tag") for v in row.variables or []):
        return {"variables": "Say which tag fills each of Meta's numbers."}
    if row.header_type in MEDIA_TYPES and row.header_media_asset_id is None:
        return {"header_media": "Choose the file the header shows: Meta sends it with every message."}
    return {}


def submit(template: TemplateMaster, user_id=None) -> dict:
    """Sends the template to Meta for review. The call to Meta happens outside any transaction; the answer is stored after it."""
    from apps.delivery.engine import session
    from apps.delivery.providers import ProviderError, registry
    with session.tx():
        row = row_of(template)
        if row is None or row.origin != "CEP":
            raise Conflict("Only a template written here can be submitted; one made in WhatsApp Manager is reviewed there.")
        if row.meta_status not in EDITABLE:
            raise Conflict("Meta has this template already." if row.meta_status != "PENDING" else "Meta is reviewing it already.")
        if row.delivery_provider is None:
            raise ValidationError({"engine": "Choose the WhatsApp number it is for."})
        problems = {key: value for key, value in findings(row, to_tags(row.body, row.variables)).items()
                    if key in ("unknown_tags", "starts_or_ends_with_tag", "adjacent_tags") and value}
        if problems:
            raise ValidationError({"body": "Fix the message before submitting it."})
        engine, media = row.delivery_provider, row.header_media_asset
    with registry.for_provider(engine) as adapter:
        try:
            handle = None
            if row.header_type in MEDIA_TYPES:
                if media is None or not media.public_url:
                    raise ValidationError({"header_media": "The header's file has no public address."})
                handle = adapter.upload_sample(requests.get(media.public_url, timeout=60).content, media.mime_type, media.file_name)
            wanted = definition(row, handle)
            # a rejected template keeps its id at Meta: the changed one is an edit of it, not a second template of the same name
            answer = adapter.edit_template(row.meta_template_id, wanted) if row.meta_template_id else adapter.create_template(wanted)
        except ProviderError as exc:
            with session.tx():
                WhatsAppTemplate.objects.filter(pk=row.pk).update(meta_reason=str(exc)[:1000], updated_at=Now())
            raise ValidationError({"meta": f"Meta did not take it: {exc}"}) from None
    status = {"APPROVED": "APPROVED", "REJECTED": "REJECTED"}.get(str(answer.get("status") or "").upper(), "PENDING")
    with session.tx():
        now = timezone.now()
        WhatsAppTemplate.objects.filter(pk=row.pk).update(meta_template_id=str(answer.get("id") or "") or None, meta_status=status, meta_reason=None,
                                                          category=str(answer.get("category") or row.category).upper() if str(answer.get("category") or row.category).upper()
                                                          in ("MARKETING", "UTILITY", "AUTHENTICATION") else row.category,
                                                          submitted_at=now, decided_at=now if status != "PENDING" else None, updated_at=Now())
        if status == "APPROVED":
            TemplateMaster.objects.filter(pk=template.pk, status="DRAFT").update(status="ACTIVE", updated_at=Now())
        return payload(TemplateMaster.objects.get(pk=template.pk))


def apply_update(tenant_id, engine, update: dict) -> str:
    """One of Meta's account callbacks (a template's review or quality, the number's quality). Inside the caller's transaction."""
    from apps.delivery.models import DeliveryProvider
    if update.get("kind") == "number_quality":
        config = {**(engine.config or {}), **({"wa_limit": update["limit"]} if update.get("limit") else {}), "wa_quality_event": update.get("event")}
        DeliveryProvider.objects.filter(pk=engine.pk).update(config=config)
        return "applied"
    rows = WhatsAppTemplate.objects.filter(delivery_provider=engine)
    row = rows.filter(meta_template_id=update.get("meta_template_id")).first() if update.get("meta_template_id") else None
    if row is None and update.get("name"):
        row = rows.filter(meta_name=update["name"], language=update.get("language") or "").first()
    if row is None:
        return "unmatched"
    if update["kind"] == "template_quality":
        WhatsAppTemplate.objects.filter(pk=row.pk).update(meta_quality=update.get("quality"), updated_at=Now())
        return "applied"
    status = update.get("status")
    if not status:
        return "ignored"
    WhatsAppTemplate.objects.filter(pk=row.pk).update(meta_status=status, meta_reason=update.get("reason") if status in ("REJECTED", "PAUSED", "DISABLED") else None,
                                                      meta_template_id=row.meta_template_id or update.get("meta_template_id") or None,
                                                      decided_at=timezone.now(), updated_at=Now())
    if status == "APPROVED":
        TemplateMaster.objects.filter(pk=row.template_id, status="DRAFT").update(status="ACTIVE", updated_at=Now())
    return "applied"


# ------------------------------------------------------------------------------------------------------------ Sync
def _parts(meta: dict) -> dict:
    """Meta's description of a template -> the columns of whatsapp_template."""
    parts = {"header_type": "NONE", "header_text": None, "body": "", "footer_text": None, "buttons": [], "samples": []}
    for component in meta.get("components") or []:
        kind = str(component.get("type") or "").upper()
        if kind == "HEADER":
            parts["header_type"] = str(component.get("format") or "TEXT").upper() if str(component.get("format") or "TEXT").upper() in ("TEXT", *MEDIA_TYPES) else "NONE"
            parts["header_text"] = (component.get("text") or "")[:MAX_HEADER] or None
        elif kind == "BODY":
            parts["body"] = component.get("text") or ""
            parts["samples"] = ((component.get("example") or {}).get("body_text") or [[]])[0]
        elif kind == "FOOTER":
            parts["footer_text"] = (component.get("text") or "")[:MAX_FOOTER] or None
        elif kind == "BUTTONS":
            parts["buttons"] = [{"type": str(b.get("type") or "").upper(), "text": b.get("text") or "", **({"url": b["url"]} if b.get("url") else {}),
                                 **({"phone": b["phone_number"]} if b.get("phone_number") else {})} for b in component.get("buttons") or []]
    return parts


def sync(engine, user_id=None) -> dict:
    """Every template of the engine's business account into this workspace: new ones of origin META, known ones Meta's status."""
    from apps.delivery.engine import session
    from apps.delivery.providers import registry
    with registry.for_provider(engine) as adapter:
        found = adapter.list_templates()                   # outside any transaction: no lock is held while Meta answers
    added = updated = 0
    now = timezone.now()
    with session.tx():
        for meta in found:
            name, language = str(meta.get("name") or ""), str(meta.get("language") or "en")
            if not NAME_RE.match(name):
                continue
            status = {"APPROVED": "APPROVED", "REJECTED": "REJECTED", "PENDING": "PENDING", "IN_APPEAL": "PENDING", "PAUSED": "PAUSED",
                      "DISABLED": "DISABLED", "LIMIT_EXCEEDED": "REJECTED", "DELETED": "DISABLED"}.get(str(meta.get("status") or "").upper(), "PENDING")
            category = str(meta.get("category") or "MARKETING").upper()
            category = category if category in ("MARKETING", "UTILITY", "AUTHENTICATION") else "MARKETING"
            quality = ((meta.get("quality_score") or {}).get("score")) if isinstance(meta.get("quality_score"), dict) else None
            reason = meta.get("rejected_reason") if str(meta.get("rejected_reason") or "NONE").upper() != "NONE" else None
            row = WhatsAppTemplate.objects.filter(delivery_provider=engine, meta_name=name, language=language).first()
            if row is not None:
                changed = row.meta_status != status
                WhatsAppTemplate.objects.filter(pk=row.pk).update(meta_status=status, meta_reason=reason, meta_quality=quality, category=category,
                                                                  meta_template_id=str(meta.get("id") or "") or row.meta_template_id, synced_at=now,
                                                                  decided_at=now if changed and status != "PENDING" else row.decided_at, updated_at=Now())
                if status == "APPROVED":
                    TemplateMaster.objects.filter(pk=row.template_id, status="DRAFT").update(status="ACTIVE", updated_at=Now())
                updated += 1
                continue
            parts = _parts(meta)
            numbers = sorted({int(n) for n in NUMBER_RE.findall(parts["body"])})
            variables = [{"tag": "", "sample": str(parts["samples"][n - 1]) if n - 1 < len(parts["samples"]) else "", "fallback": ""} for n in numbers]
            title = f"{name.replace('_', ' ').title()} ({language})"
            stem, suffix = title, 2
            while TemplateMaster.objects.filter(name__iexact=title, deleted_at__isnull=True).exists():
                title, suffix = f"{stem} {suffix}", suffix + 1
            template = TemplateMaster.objects.create(tenant_id=engine.tenant_id, name=title[:200], channel="WHATSAPP", created_by_id=user_id,
                                                     description="Made in WhatsApp Manager and synced from Meta.",
                                                     status="DRAFT")
            WhatsAppTemplate.objects.create(template=template, tenant_id=engine.tenant_id, delivery_provider=engine, meta_name=name, language=language, category=category,
                                            header_type=parts["header_type"], header_text=parts["header_text"], body=parts["body"], footer_text=parts["footer_text"],
                                            buttons=parts["buttons"], variables=variables, origin="META", meta_template_id=str(meta.get("id") or "") or None,
                                            meta_status=status, meta_reason=reason, meta_quality=quality, synced_at=now, decided_at=now if status != "PENDING" else None)
            TemplateDesignState.objects.create(template=template, version_number=1, editor_state={"kind": "whatsapp", "channel": "WHATSAPP", "origin": "META"})
            RenderedTemplateContent.objects.create(template=template, version_number=1, sms_body=parts["body"], text_content=parts["body"])
            added += 1
    return {"found": len(found), "added": added, "updated": updated}


def clone(source: TemplateMaster, copy: TemplateMaster) -> None:
    """The copy of a WhatsApp template is a draft written here, under a name of its own, for Meta to review again."""
    row = row_of(source)
    if row is None:
        return
    stem = row.meta_name[:500]
    name, suffix = f"{stem}_v2", 2
    while WhatsAppTemplate.objects.filter(delivery_provider=row.delivery_provider, meta_name=name, language=row.language).exists():
        suffix += 1
        name = f"{stem}_v{suffix}"
    WhatsAppTemplate.objects.create(template=copy, tenant_id=copy.tenant_id, delivery_provider=row.delivery_provider, meta_name=name, language=row.language,
                                    category=row.category if row.category != "AUTHENTICATION" else "UTILITY", header_type=row.header_type, header_text=row.header_text,
                                    header_media_asset=row.header_media_asset, body=row.body, footer_text=row.footer_text, buttons=row.buttons, variables=row.variables,
                                    origin="CEP", meta_status="DRAFT")
