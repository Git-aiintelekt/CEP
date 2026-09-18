"""Turns the saved template content into one recipient's message.

`{{tag}}` values come from the workspace's personalization tag catalogue (resolution_source + source_path), with the
catalogue's default when the source is empty. A tag that is not in the catalogue is looked up in the list member's own
columns (what the upload carried), then in the customer's attributes. Values are HTML-escaped in the HTML body and left
as they are in the subject and the text part. Inner-template tags are expanded once, before personalization.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from html import escape

from django.utils import timezone

TAG_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}")


def _dig(source, path: str):
    value = source
    for part in (path or "").split("."):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            value = getattr(value, part, None)
        if value is None:
            return None
    return value


def _format(value, tag) -> str:
    spec = (tag.format_spec or "").strip() if tag is not None else ""
    try:
        if spec and tag.data_type == "NUMBER":
            return format(float(value), spec)
        if spec and tag.data_type == "DATE":
            moment = value if isinstance(value, (date, datetime)) else datetime.fromisoformat(str(value))
            return moment.strftime(spec)
    except (ValueError, TypeError):
        pass                                                # a bad pattern must not stop a send: fall back to the plain value
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


class Renderer:
    def __init__(self, *, campaign, run, content, tags, inner_templates: dict[str, str] | None = None):
        self.campaign, self.run, self.content = campaign, run, content
        self.tags = {tag.tag_key.strip("{} "): tag for tag in tags}
        self.sources: dict = {}
        inner = inner_templates or {}
        self.html = self._expand_inner(content.html_content or "", inner)
        self.text = content.text_content or ""
        self.subject = content.subject_line or campaign.name

    def _expand_inner(self, html: str, inner: dict[str, str]) -> str:
        if not inner:
            return html
        return TAG_RE.sub(lambda m: inner.get(m.group(1), m.group(0)), html)

    def _value(self, key: str, customer: dict, member: dict, system: dict) -> str:
        tag = self.tags.get(key)
        value = None
        if key in system:
            value = system[key]
        elif tag is not None:
            source, path = tag.resolution_source, tag.source_path or key
            if source == "CUSTOMER_MASTER":
                value = _dig(customer, path)
            elif source == "CAMPAIGN_LIST_MEMBER":
                value = _dig(member, path)
                if value is None:
                    value = _dig(member.get("custom_value_pairs") or {}, path.split(".", 1)[-1])
            elif source == "CAMPAIGN":
                value = _dig(self.campaign, path)
            elif source == "CAMPAIGN_RUN":
                value = _dig(self.run, path)
            elif source == "STATIC":
                value = tag.static_value
            elif source in self.sources:                    # RECEIPT, STORE: data that arrives with a transactional send
                value = _dig(self.sources[source], path)
        if value in (None, ""):                             # not in the catalogue, or its source is empty for this person
            value = (member.get("custom_value_pairs") or {}).get(key)
        if value in (None, ""):
            value = customer.get(key) if key in ("first_name", "last_name", "party_id", "email") else (customer.get("custom_attributes") or {}).get(key)
        if value in (None, ""):
            value = tag.default_value if tag is not None else ""
        return "" if value is None else _format(value, tag)

    def render(self, *, customer: dict, member: dict, system: dict, sources: dict | None = None, html_blocks: dict | None = None) -> dict:
        """-> {'subject', 'html', 'text'} for one recipient. `system` holds the per-message values (unsubscribe_url ...),
        `sources` the data of tags resolved from RECEIPT / STORE, `html_blocks` ready-made HTML (already escaped by its
        builder, e.g. the receipt's line items) that goes into the HTML part as it is and into the text part as text."""
        self.sources = sources or {}
        blocks = html_blocks or {}
        today = timezone.localdate()
        system = {"current_year": str(today.year), "today": today.isoformat(), "campaign_name": self.campaign.name, **system}
        from apps.templates.design import html_to_text
        plain = lambda m: html_to_text(blocks[m.group(1)]) if m.group(1) in blocks else self._value(m.group(1), customer, member, system)      # noqa: E731
        safe = lambda m: blocks[m.group(1)] if m.group(1) in blocks else escape(self._value(m.group(1), customer, member, system), quote=True)  # noqa: E731
        return {"subject": " ".join(TAG_RE.sub(plain, self.subject).split())[:300], "html": TAG_RE.sub(safe, self.html), "text": TAG_RE.sub(plain, self.text)}
