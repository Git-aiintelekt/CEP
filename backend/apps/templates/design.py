"""Template Studio service layer: versioned design saves, server-side MJML rendering, tag usage, activation rules.

The browser sends the GrapesJS project (editor_state) and the MJML it produces. The HTML that is stored and later
sent is rendered HERE from that MJML, so what customers receive is never whatever a client chose to post.
"""
import html as html_lib
import json
import re

import mrml
from django.db import transaction
from django.db.models import Max
from django.db.models.functions import Now
from rest_framework.exceptions import ValidationError

from api.exceptions import Conflict

from .models import PersonalizationTag, RenderedTemplateContent, TemplateDesignState, TemplateMaster, TemplateTag

TAG_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}")
DESIGNER_CHANNELS = ("EMAIL", "E_RECEIPT")
MAX_MJML_BYTES = 512 * 1024
MAX_STATE_BYTES = 3 * 1024 * 1024
GMAIL_CLIP_BYTES = 102 * 1024
UNSUBSCRIBE_TAG = "unsubscribe_url"
FORBIDDEN = (
    (re.compile(r"<\s*script\b", re.I), "Scripts are not allowed in email content."),
    (re.compile(r"<\s*mj-include\b", re.I), "mj-include is not allowed."),
    (re.compile(r"""\son[a-z]+\s*=\s*["']""", re.I), "Inline event handlers (onclick, onload, ...) are not allowed."),
    (re.compile(r"javascript\s*:", re.I), "javascript: links are not allowed."),
)


def extract_tags(*texts: str | None) -> list[str]:
    """Tag keys in order of first appearance: '{{ first_name }}' -> 'first_name'."""
    seen: dict[str, None] = {}
    for text in texts:
        for match in TAG_RE.finditer(text or ""):
            seen.setdefault(match.group(1), None)
    return list(seen)


def html_to_text(html: str) -> str:
    """Plain-text alternative part. Links keep their target, block elements become line breaks."""
    text = re.sub(r"(?is)<(script|style|head|title)\b.*?</\1>", "", html)
    text = re.sub(r"(?is)<!--.*?-->", "", text)
    text = re.sub(r"""(?is)<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""",
                  lambda m: f"{re.sub(r'<[^>]+>', '', m.group(2)).strip()} ({m.group(1)})" if m.group(2).strip() else m.group(1), text)
    text = re.sub(r"(?i)<\s*br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</\s*(p|div|tr|h[1-6]|li|table)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_lib.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def render_mjml(mjml_source: str) -> str:
    try:
        output = mrml.to_html(mjml_source)
    except Exception as exc:  # mrml raises plain exceptions with the parser message
        raise ValidationError({"mjml_source": f"The design could not be rendered: {exc}"}) from None
    return output.content if hasattr(output, "content") else str(output)


def latest_version(template: TemplateMaster) -> int:
    """The design half's own latest -- excludes receipt-layout saves, which share this template's version counter
    (the unique constraint is (template, version_number) globally) but are a sibling stream, not a design edit."""
    return TemplateDesignState.objects.filter(template=template).exclude(editor_state__kind="receipt").aggregate(v=Max("version_number"))["v"] or 0


def _next_version(template: TemplateMaster) -> int:
    """The number to insert at: the template's global max + 1, regardless of kind, so a design save and a receipt
    save on the same template can never race for the same version_number (unique per template, across both kinds)."""
    return (TemplateDesignState.objects.filter(template=template).aggregate(v=Max("version_number"))["v"] or 0) + 1


def design_payload(template: TemplateMaster, version: int | None = None) -> dict:
    """The design at `version` (default: latest) in the shape the designer loads; version 0 = nothing saved yet."""
    number = version or latest_version(template)
    state = TemplateDesignState.objects.filter(template=template, version_number=number).select_related("created_by").first()
    content = RenderedTemplateContent.objects.filter(template=template, version_number=number).first()
    if number and state is None and content is None:
        raise ValidationError({"version": f"Version {number} does not exist."})
    return {
        "template": str(template.id),
        "version_number": number if (state or content) else 0,
        "latest_version": latest_version(template),
        "editor_state": state.editor_state if state else None,
        "mjml_source": content.mjml_source if content else None,
        "html_content": content.html_content if content else None,
        "text_content": content.text_content if content else None,
        "subject_line": (content.subject_line if content else None) or "",
        "preheader": (content.preheader if content else None) or "",
        "saved_at": state.created_at if state else (content.rendered_at if content else None),
        "saved_by": state.created_by.display_name if state and state.created_by else None,
    }


def analyse(subject_line: str, preheader: str, mjml_source: str, html: str) -> dict:
    """Non-blocking findings returned with every save and re-checked by activate()."""
    used = extract_tags(subject_line, preheader, mjml_source)
    known = set(PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True, tag_key__in=used).values_list("tag_key", flat=True))
    return {
        "tags_used": used,
        "unknown_tags": [key for key in used if key not in known],
        "missing_unsubscribe": UNSUBSCRIBE_TAG not in used,
        "missing_subject": not subject_line.strip(),
        "html_bytes": len(html.encode()),
        "may_be_clipped": len(html.encode()) > GMAIL_CLIP_BYTES,
    }


@transaction.atomic
def save_design(template: TemplateMaster, user_id, *, editor_state, mjml_source: str, subject_line: str, preheader: str, base_version: int) -> dict:
    if template.channel not in DESIGNER_CHANNELS:
        raise Conflict("The email designer is for EMAIL and E_RECEIPT templates.")
    if template.status == "ARCHIVED" or template.deleted_at is not None:
        raise Conflict("An archived template cannot be changed.")

    errors = {}
    if len(mjml_source.encode()) > MAX_MJML_BYTES:
        errors["mjml_source"] = "The design is too large (over 512 KB of MJML)."
    if len(json.dumps(editor_state).encode()) > MAX_STATE_BYTES:
        errors["editor_state"] = "The editor state is too large (over 3 MB). Host images as assets instead of embedding them."
    for pattern, message in FORBIDDEN:
        if pattern.search(mjml_source):
            errors.setdefault("mjml_source", message)
    if errors:
        raise ValidationError(errors)

    # Lock the template row: two people saving at once get versions n+1 and a 409, never two n+1 rows.
    TemplateMaster.objects.select_for_update().get(pk=template.pk)
    current = latest_version(template)
    if base_version != current:
        raise Conflict(f"This template was saved by someone else (now at version {current}). Reload before saving again.")

    html = render_mjml(mjml_source)
    number = _next_version(template)
    TemplateDesignState.objects.create(template=template, version_number=number, editor_state=editor_state, created_by_id=user_id)
    RenderedTemplateContent.objects.create(template=template, version_number=number, subject_line=subject_line.strip() or None,
                                           preheader=preheader.strip() or None, mjml_source=mjml_source, html_content=html,
                                           text_content=html_to_text(html))

    findings = analyse(subject_line, preheader, mjml_source, html)
    # template_tag = which catalogue tags this template uses (validated against the campaign list at publish)
    tags = {tag.tag_key: tag for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True, tag_key__in=findings["tags_used"])}
    TemplateTag.objects.filter(template=template).exclude(tag_id__in=[tag.id for tag in tags.values()]).delete()
    linked = set(TemplateTag.objects.filter(template=template).values_list("tag_id", flat=True))
    TemplateTag.objects.bulk_create([
        TemplateTag(template=template, tag=tags[key], tenant_id=template.tenant_id, sequence=index, created_by_id=user_id)
        for index, key in enumerate(findings["tags_used"]) if key in tags and tags[key].id not in linked])

    TemplateMaster.objects.filter(pk=template.pk).update(updated_at=Now())     # fires the touch trigger: row_version, updated_by
    return {**design_payload(template, number), "findings": findings}


def activation_blockers(template: TemplateMaster) -> dict:
    """What stops a DRAFT template from becoming ACTIVE (usable by published campaigns)."""
    number = latest_version(template)
    content = RenderedTemplateContent.objects.filter(template=template, version_number=number).first()
    if template.channel not in DESIGNER_CHANNELS:
        return message_blockers(template)
    if content is None or not (content.html_content or "").strip():
        return {"design": "Design and save the email before activating."}
    findings = analyse(content.subject_line or "", content.preheader or "", content.mjml_source or "", content.html_content or "")
    blockers = {}
    if findings["missing_subject"]:
        blockers["subject_line"] = "Add a subject line."
    if findings["unknown_tags"]:
        blockers["tags"] = "Unknown personalization tags: " + ", ".join("{{" + key + "}}" for key in findings["unknown_tags"])
    return blockers


# =====================================================================================================================
# Receipt layout (E_RECEIPT only): the inner line-item layout. The outer shell (subject, MJML wrapper) is a Design,
# above. Both share one per-template version sequence (TemplateDesignState.version_number), so a receipt layout's own
# "latest" is the latest version whose editor_state is a receipt, not the latest version of either kind.
# =====================================================================================================================
RECEIPT_CHANNELS = ("E_RECEIPT",)
DEFAULT_RECEIPT_POLICY_TEXT = "Unworn items with tags can be returned within 30 days in store or by mail for a full refund."
MAX_CUSTOM_HTML_BYTES = 512 * 1024


def default_receipt_sections() -> list[dict]:
    """The Standard receipt: every section on. Mirrors frontend/src/features/receipt/receiptPresets.ts's standard() --
    the two must not drift, since this is what a freshly-created E_RECEIPT template's editor opens with."""
    return [
        {"key": "header", "label": "Order header", "order": 0, "locked": True, "visible": True, "data_binding": "Order.header",
         "fields": {"order_number": True, "order_date": True, "store": True, "receipt_id": True}},
        {"key": "customer_fulfillment", "label": "Customer & fulfillment", "order": 1, "locked": False, "visible": True,
         "data_binding": "Order.fulfillment", "address_mode": "AUTO", "delivery_estimate": True},
        {"key": "items", "label": "Items", "order": 2, "locked": True, "visible": True, "data_binding": "Order.lineItems[]",
         "columns": {"product_image": False, "sku": False, "quantity": True, "unit_price": True, "amount": True}, "row_height": "DEFAULT"},
        {"key": "totals", "label": "Totals", "order": 3, "locked": True, "visible": True, "data_binding": "Order.totals",
         "rows": {"subtotal": True, "discount": True, "tax": True, "shipping": True, "tip": False}, "savings_callout": True},
        {"key": "payment", "label": "Payment", "order": 4, "locked": False, "visible": True, "data_binding": "Order.payment",
         "fields": {"method": True, "authorization_time": True, "billing_address": True}},
        {"key": "loyalty", "label": "Loyalty", "order": 5, "locked": False, "visible": True, "data_binding": "Order.loyalty",
         "fields": {"points_earned": True, "points_balance": True, "tier_progress": True}},
        {"key": "support", "label": "Returns & support", "order": 6, "locked": False, "visible": True, "data_binding": None,
         "policy_text": DEFAULT_RECEIPT_POLICY_TEXT, "barcode": False},
    ]


def latest_receipt_version(template: TemplateMaster) -> int:
    return TemplateDesignState.objects.filter(template=template, editor_state__kind="receipt").aggregate(v=Max("version_number"))["v"] or 0


def receipt_payload(template: TemplateMaster, version: int | None = None) -> dict:
    """The receipt layout at `version` (default: latest); version 0 = nothing saved yet, which opens on the Standard
    preset (the editor always needs a real layout to show, unlike the design half, which can start blank)."""
    latest = latest_receipt_version(template)
    number = version or latest
    state = None
    if number:
        state = TemplateDesignState.objects.filter(template=template, version_number=number, editor_state__kind="receipt").select_related("created_by").first()
        if state is None:
            raise ValidationError({"version": f"Version {number} does not exist."})
    layout = state.editor_state if state else {}
    return {
        "template": str(template.id),
        "version_number": number if state else 0,
        "latest_version": latest,
        "layout_preset": layout.get("layout_preset", "STANDARD"),
        "sections": layout.get("sections") or default_receipt_sections(),
        "custom_html": layout.get("custom_html"),
        "custom_css": layout.get("custom_css"),
        "saved_at": state.created_at if state else None,
        "saved_by": state.created_by.display_name if state and state.created_by else None,
    }


@transaction.atomic
def save_receipt(template: TemplateMaster, user_id, *, layout_preset: str, sections: list, custom_html: str | None, custom_css: str | None,
                  base_version: int) -> dict:
    if template.channel not in RECEIPT_CHANNELS:
        raise Conflict("The receipt layout is for E_RECEIPT templates.")
    if template.status == "ARCHIVED" or template.deleted_at is not None:
        raise Conflict("An archived template cannot be changed.")

    errors = {}
    if layout_preset == "CUSTOM_HTML":
        if not (custom_html or "").strip():
            errors["custom_html"] = "Write the receipt's HTML."
        elif len((custom_html or "").encode()) > MAX_CUSTOM_HTML_BYTES:
            errors["custom_html"] = "The custom HTML is too large (over 512 KB)."
        for pattern, message in FORBIDDEN:
            if pattern.search(custom_html or "") or pattern.search(custom_css or ""):
                errors.setdefault("custom_html", message)
    elif not sections:
        errors["sections"] = "Choose a layout preset."
    if errors:
        raise ValidationError(errors)

    # Same row lock as save_design(): two people saving at once get versions n+1 and a 409, never two n+1 rows.
    TemplateMaster.objects.select_for_update().get(pk=template.pk)
    current = latest_receipt_version(template)
    if base_version != current:
        raise Conflict(f"This receipt layout was saved by someone else (now at version {current}). Reload before saving again.")

    number = _next_version(template)
    state = {"kind": "receipt", "layout_preset": layout_preset, "sections": sections, "custom_html": custom_html, "custom_css": custom_css}
    TemplateDesignState.objects.create(template=template, version_number=number, editor_state=state, created_by_id=user_id)
    TemplateMaster.objects.filter(pk=template.pk).update(updated_at=Now())
    return receipt_payload(template, number)


# =====================================================================================================================
# SMS / MMS messages
# =====================================================================================================================
MESSAGE_CHANNELS = ("SMS", "MMS")
MAX_MESSAGE_CHARS = 1600                     # 10 concatenated segments: what aggregators accept at most
LONG_MESSAGE_SEGMENTS = 3
MMS_MEDIA_TYPES = ("image/jpeg", "image/png", "image/gif")          # WebP is not reliably delivered over MMS
MMS_MEDIA_WARN_BYTES = 600 * 1024            # above this some carriers transcode or drop the attachment
MMS_MEDIA_MAX_BYTES = 1024 * 1024
OPT_OUT_RE = re.compile(r"\b(stop|unsubscribe|opt[\s-]?out)\b", re.I)
URL_RE = re.compile(r"https?://\S+", re.I)

GSM7_BASIC = set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑܧ¿abcdefghijklmnopqrstuvwxyzäöñüà")
GSM7_EXTENDED = set("^{}\\[~]|€\f")          # sent as ESC + char: two septets each


def sms_metrics(text: str) -> dict:
    """Encoding and segment count the way carriers bill it. One character outside GSM-7 (a curly quote, an emoji)
    switches the whole message to UCS-2 and drops a segment from 160/153 to 70/67 characters."""
    non_gsm = [ch for ch in dict.fromkeys(text) if ch not in GSM7_BASIC and ch not in GSM7_EXTENDED]
    if non_gsm:
        units = len(text.encode("utf-16-le")) // 2                   # emoji and other astral characters count twice
        single, multi, encoding = 70, 67, "UCS-2"
    else:
        units = sum(2 if ch in GSM7_EXTENDED else 1 for ch in text)
        single, multi, encoding = 160, 153, "GSM-7"
    segments = 0 if units == 0 else 1 if units <= single else -(-units // multi)
    return {"encoding": encoding, "units": units, "segments": segments, "per_segment": single if segments <= 1 else multi,
            "non_gsm_characters": non_gsm[:20]}


def render_with_samples(text: str, tags: dict) -> str:
    """Length depends on the recipient: estimate with each tag's sample (or default) value; unknown tags stay as typed."""
    def fill(match):
        tag = tags.get(match.group(1))
        value = (tag.sample_value or tag.default_value or tag.static_value or "") if tag else ""
        return value or match.group(0)
    return TAG_RE.sub(fill, text)


def latest_content_version(template: TemplateMaster) -> int:
    """Messages (and imported templates) may have rendered content without an editor state: content is the authority."""
    content = RenderedTemplateContent.objects.filter(template=template).aggregate(v=Max("version_number"))["v"] or 0
    return max(content, latest_version(template))


def analyse_message(template: TemplateMaster, body: str, media) -> dict:
    used = extract_tags(body)
    tags = {tag.tag_key: tag for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True, tag_key__in=used)}
    metrics = sms_metrics(render_with_samples(body, tags))
    return {
        **metrics,
        "estimated": bool(used),                                     # true when tags make the length vary per recipient
        "tags_used": used,
        "unknown_tags": [key for key in used if key not in tags],
        "wrong_channel_tags": [key for key in used if key in tags and tags[key].applies_to_channels
                               and template.channel not in tags[key].applies_to_channels],
        "missing_opt_out": not OPT_OUT_RE.search(body),
        "long_message": metrics["segments"] > LONG_MESSAGE_SEGMENTS,
        "has_link": bool(URL_RE.search(body)) or any("url" in key for key in used),
        "missing_media": template.channel == "MMS" and media is None,
        "media_bytes": media.byte_size if media else None,
        "media_heavy": bool(media and media.byte_size > MMS_MEDIA_WARN_BYTES),
    }


def _message_media(state):
    from apps.media.models import MediaAsset
    asset_id = (state.editor_state or {}).get("media_asset_id") if state else None
    return MediaAsset.objects.filter(pk=asset_id, deleted_at__isnull=True).first() if asset_id else None


def message_media_url(template: TemplateMaster) -> str | None:
    """Public address of the picture of an MMS template's latest version: what the aggregator fetches."""
    state = TemplateDesignState.objects.filter(template=template).order_by("-version_number").first()
    media = _message_media(state)
    return (getattr(media, "cdn_url", None) or media.public_url or None) if media else None


def message_payload(template: TemplateMaster, version: int | None = None) -> dict:
    latest = latest_content_version(template)
    number = version or latest
    content = RenderedTemplateContent.objects.filter(template=template, version_number=number).first()
    state = TemplateDesignState.objects.filter(template=template, version_number=number).select_related("created_by").first()
    if number and content is None:
        raise ValidationError({"version": f"Version {number} does not exist."})
    media = _message_media(state)
    body = (content.sms_body if content else None) or ""
    return {
        "template": str(template.id), "channel": template.channel, "version_number": number if content else 0, "latest_version": latest,
        "sms_body": body, "subject_line": (content.subject_line if content else None) or "",
        "media_asset": {"id": str(media.id), "url": media.public_url, "file_name": media.file_name, "mime_type": media.mime_type,
                        "byte_size": media.byte_size, "width_px": media.width_px, "height_px": media.height_px} if media else None,
        "saved_at": state.created_at if state else (content.rendered_at if content else None),
        "saved_by": state.created_by.display_name if state and state.created_by else None,
        "findings": analyse_message(template, body, media),
    }


@transaction.atomic
def save_message(template: TemplateMaster, user_id, *, sms_body: str, subject_line: str, media_asset, base_version: int) -> dict:
    from apps.media.models import MediaAsset, TemplateMediaAsset
    if template.channel not in MESSAGE_CHANNELS:
        raise Conflict("The message editor is for SMS and MMS templates.")
    if template.status == "ARCHIVED" or template.deleted_at is not None:
        raise Conflict("An archived template cannot be changed.")

    errors, media = {}, None
    body = sms_body.replace("\r\n", "\n").strip()
    if not body:
        errors["sms_body"] = "Write the message."
    elif len(body) > MAX_MESSAGE_CHARS:
        errors["sms_body"] = f"A message can be at most {MAX_MESSAGE_CHARS} characters (10 segments)."
    if media_asset is not None:
        if template.channel != "MMS":
            errors["media_asset"] = "Only MMS templates can carry a picture."
        else:
            media = MediaAsset.objects.filter(pk=media_asset, deleted_at__isnull=True).first()      # RLS: this tenant only
            if media is None:
                errors["media_asset"] = "This image no longer exists."
            elif media.mime_type not in MMS_MEDIA_TYPES:
                errors["media_asset"] = "MMS pictures must be JPEG, PNG or GIF."
            elif media.byte_size > MMS_MEDIA_MAX_BYTES:
                errors["media_asset"] = "MMS pictures can be at most 1 MB; most carriers deliver up to 600 KB reliably."
    if subject_line.strip() and template.channel != "MMS":
        errors["subject_line"] = "Only MMS messages have a subject."
    if errors:
        raise ValidationError(errors)

    TemplateMaster.objects.select_for_update().get(pk=template.pk)
    current = latest_content_version(template)
    if base_version != current:
        raise Conflict(f"This template was saved by someone else (now at version {current}). Reload before saving again.")

    number = current + 1
    state = {"kind": "message", "channel": template.channel, "media_asset_id": str(media.id) if media else None}
    TemplateDesignState.objects.create(template=template, version_number=number, editor_state=state, created_by_id=user_id)
    RenderedTemplateContent.objects.create(template=template, version_number=number, sms_body=body, text_content=body,
                                           subject_line=subject_line.strip() or None)

    findings = analyse_message(template, body, media)
    tags = {tag.tag_key: tag for tag in PersonalizationTag.objects.filter(is_active=True, deleted_at__isnull=True, tag_key__in=findings["tags_used"])}
    TemplateTag.objects.filter(template=template).exclude(tag_id__in=[tag.id for tag in tags.values()]).delete()
    linked = set(TemplateTag.objects.filter(template=template).values_list("tag_id", flat=True))
    TemplateTag.objects.bulk_create([
        TemplateTag(template=template, tag=tags[key], tenant_id=template.tenant_id, sequence=index, created_by_id=user_id)
        for index, key in enumerate(findings["tags_used"]) if key in tags and tags[key].id not in linked])
    # template_media_asset = "where is this picture used?" (it blocks deleting media that a template still sends)
    stale = TemplateMediaAsset.objects.filter(template=template)
    (stale.exclude(media_asset_id=media.id) if media else stale).delete()
    if media and not TemplateMediaAsset.objects.filter(template=template, media_asset=media).exists():
        TemplateMediaAsset.objects.create(template=template, media_asset=media, tenant_id=template.tenant_id)

    TemplateMaster.objects.filter(pk=template.pk).update(updated_at=Now())
    return message_payload(template, number)


def message_blockers(template: TemplateMaster) -> dict:
    payload = message_payload(template)
    if payload["version_number"] == 0 or not payload["sms_body"].strip():
        return {"sms_body": "Write and save the message before activating."}
    findings, blockers = payload["findings"], {}
    if findings["unknown_tags"]:
        blockers["tags"] = "Unknown personalization tags: " + ", ".join("{{" + key + "}}" for key in findings["unknown_tags"])
    if findings["missing_media"]:
        blockers["media_asset"] = "An MMS template needs a picture. Use an SMS template for text only."
    return blockers
