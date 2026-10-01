"""Turns the saved template content into one recipient's message.

`{{tag}}` values come from the workspace's personalization tag catalogue (resolution_source + source_path), with the
catalogue's default when the source is empty. A tag that is not in the catalogue is looked up in the list member's own
columns (what the upload carried), then in the customer's attributes. Values are HTML-escaped in the HTML body and left
as they are in the subject and the text part. Inner-template tags are expanded once, before personalization.

Barcode and QR code blocks (apps/templates/codes.py) are replaced first: each becomes the recipient's own code, or
nothing when the workspace does not have the feature or the recipient's value is missing or unusable; render() then
lists the blocks left out, which the send counts.

The subject and the preheader are the campaign's own when it has them (set on the setup's Content step), else the
template's. The preheader goes at the top of the HTML part as hidden text: the line an inbox shows after the subject.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from html import escape

from django.utils import timezone

TAG_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}")
# the standard templates' own spelling, ${STORE_NAME}: the same tag as {{store_name}}
LEGACY_TAG_RE = re.compile(r"\$\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}")


def modern_tags(text: str | None) -> str:
    """${STORE_NAME} written as {{store_name}}, so a template pasted from the standard set renders like one built here."""
    return LEGACY_TAG_RE.sub(lambda m: "{{" + m.group(1).lower() + "}}", text or "")
BODY_RE = re.compile(r"<body\b[^>]*>", re.IGNORECASE)
PREHEADER_STYLE = "display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;visibility:hidden;mso-hide:all;"
# After the preheader, enough invisible characters that no inbox line reaches the body's first words (image alt text, the nav links).
# Gmail shows up to ~140 characters after the subject, Outlook on the web and the phone apps ~100; each pair counts as one, so 40 left
# room for "Banner Insider's Club CTA HOME SHOP…" to follow a short preheader. 200 covers every client.
PREHEADER_FILL = "&#847;&zwnj;&nbsp;" * 200


def subject_of(campaign, content) -> str:
    """The subject as written, tags and all: the campaign's own, else the template's, else the campaign's name."""
    return (getattr(campaign, "subject_line", None) or "").strip() or (content.subject_line or "").strip() or campaign.name


def preheader_of(campaign, content) -> str:
    return (getattr(campaign, "preheader", None) or "").strip() or (getattr(content, "preheader", None) or "").strip()


def with_preheader(html: str, preheader: str) -> str:
    """The HTML with the preheader as hidden text right after <body>; tags in it are filled in with the rest."""
    if not html or not preheader:
        return html
    block = f'<div style="{PREHEADER_STYLE}">{escape(preheader, quote=False)}{PREHEADER_FILL}</div>'
    found = BODY_RE.search(html)
    return html[:found.end()] + block + html[found.end():] if found else block + html


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
        self.used: dict[str, str] = {}
        inner = inner_templates or {}
        self.preheader = preheader_of(campaign, content)
        self.html = with_preheader(self._expand_inner(content.html_content or "", inner), self.preheader)
        self.text = content.text_content or ""
        self.subject = subject_of(campaign, content)
        self.codes_on: bool | None = None                   # read once, and only for a design that has a code block

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
        shown = "" if value is None else _format(value, tag)
        self.used[key] = shown
        return shown

    def _codes(self, customer: dict, member: dict, system: dict, blocks: dict, left_out: list[str]) -> str:
        """The HTML with each code block swapped for a ready-made block of this recipient's own code, or for nothing."""
        from apps.templates import codes
        if codes.MARK not in self.html:
            return self.html
        if self.codes_on is None:
            from apps.platform_ops import params
            self.codes_on = params.enabled(self.campaign.tenant_id, "dynamic_codes")

        def swap(match):
            config = codes.parse(match.group(1))
            if config is None or not self.codes_on:
                left_out.append((config or {}).get("source") or "code")
                return ""
            value = self._value(config["source"], customer, member, system).strip()
            if codes.value_problem(config, value):
                left_out.append(config["source"])
                return ""
            key = f"cep_code_{len(blocks)}"
            blocks[key] = codes.email_html(config, value)
            return "{{" + key + "}}"
        return codes.REGION_RE.sub(swap, self.html)

    def render(self, *, customer: dict, member: dict, system: dict, sources: dict | None = None, html_blocks: dict | None = None, subject: str | None = None) -> dict:
        """-> {'subject', 'preheader', 'html', 'text', 'codes_left_out'} for one recipient. `system` holds the per-message values
        (unsubscribe_url ...), `sources` the data of tags resolved from RECEIPT / STORE, `html_blocks` ready-made HTML
        (already escaped by its builder, e.g. the receipt's line items) that goes into the HTML part as it is and into
        the text part as text. `codes_left_out` names the source tag of each code block this recipient did not get."""
        self.sources = sources or {}
        self.used = {}                                      # tag -> value of THIS recipient, for the compliance record of a text
        blocks = dict(html_blocks or {})
        today = timezone.localdate()
        system = {"current_year": str(today.year), "today": today.isoformat(), "campaign_name": self.campaign.name, **system}
        left_out: list[str] = []
        html = self._codes(customer, member, system, blocks, left_out)
        from apps.templates.design import html_to_text
        plain = lambda m: html_to_text(blocks[m.group(1)]) if m.group(1) in blocks else self._value(m.group(1), customer, member, system)      # noqa: E731
        safe = lambda m: blocks[m.group(1)] if m.group(1) in blocks else escape(self._value(m.group(1), customer, member, system), quote=True)  # noqa: E731
        return {"subject": " ".join(TAG_RE.sub(plain, modern_tags(self.subject if subject is None else subject)).split())[:300], "html": TAG_RE.sub(safe, modern_tags(html)),
                "preheader": " ".join(TAG_RE.sub(plain, modern_tags(self.preheader)).split()), "text": TAG_RE.sub(plain, modern_tags(self.text)), "codes_left_out": left_out}
