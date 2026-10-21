"""UTM tags on the links of email and text campaigns (Settings → UTM Tracking, and the campaign's Link Tracking).

  settings_for(tenant_settings)        the workspace's UTM settings, filled in with the recommended defaults
  campaign_context(campaign, channel)  the values a campaign's links carry (its own overrides first)
  links(html, text)                    the links of a message: address, label (utm_content) and position
  verdict(url, settings)               TAGGED, OWN_TAGS, NOT_YOUR_SITE or NEVER (mailto:, tel:, C360's own pages)
  tag_url(url, values, settings)       the address with its tags
  tag_html(html, ...) / tag_text(...)  every eligible link of a message, tagged

Values are sent lowercase with dashes ("Fall Launch" goes out as fall-launch). Links to other sites, mailto: and tel:
links, and C360's unsubscribe and preference pages are never tagged; a link that already carries utm_ parameters keeps
them unless the workspace chose to replace them (missing parameters are added either way).
"""
from __future__ import annotations

import re
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

PARAMS = ("utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_content", "utm_term",
          "utm_source_platform", "utm_creative_format", "utm_marketing_tactic")
# what a parameter's value can be: fixed text, a campaign field, or not sent. medium and creative format follow the channel.
FIELDS = ("campaign_name", "campaign_code", "campaign_category", "channel", "link_label", "link_label_variant")
BY_CHANNEL = {"utm_medium": {"EMAIL": "email", "SMS": "sms"}, "utm_creative_format": {"EMAIL": "email", "SMS": "text"}}
RECOMMENDED = {
    "utm_source": {"kind": "text", "value": "c360"},
    "utm_campaign": {"kind": "field", "value": "campaign_name"},
    "utm_id": {"kind": "field", "value": "campaign_code"},
    "utm_content": {"kind": "field", "value": "link_label_variant"},
    "utm_term": {"kind": "none", "value": ""},
    "utm_source_platform": {"kind": "text", "value": "c360"},
    "utm_marketing_tactic": {"kind": "field", "value": "campaign_category"},
}
NEVER_WORDS = ("unsubscribe", "preference")                              # opt-out pages are never tagged, wherever they live
ANCHOR_RE = re.compile(r"""(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2([^>]*>)(.*?)</a>""", re.I | re.S)
URL_RE = re.compile(r"""https?://[^\s<>"'()]+[^\s<>"'().,;:!?]""", re.I)
TAG_RE = re.compile(r"<[^>]+>")
ALT_RE = re.compile(r"""\balt\s*=\s*(["'])(.*?)\1""", re.I | re.S)


def slug(value) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return text[:100]


def settings_for(tenant_settings: dict | None) -> dict:
    """the workspace's settings with every key present: email, sms, params, domains, keep_existing"""
    saved = ((tenant_settings or {}).get("utm") or {}) if isinstance(tenant_settings, dict) else {}
    params = {name: dict(RECOMMENDED.get(name, {"kind": "none", "value": ""})) for name in PARAMS if name not in BY_CHANNEL}
    for name, rule in (saved.get("params") or {}).items():
        if name in params and isinstance(rule, dict) and rule.get("kind") in ("text", "field", "none"):
            params[name] = {"kind": rule["kind"], "value": str(rule.get("value") or "")}
    domains = sorted({d.strip().lower().lstrip(".") for d in saved.get("domains") or [] if isinstance(d, str) and d.strip()})
    return {"email": bool(saved.get("email")), "sms": bool(saved.get("sms")), "params": params, "domains": domains,
            "keep_existing": saved.get("keep_existing", True) is not False}


def validate(data: dict) -> tuple[dict, dict]:
    """(what to store, field errors) from what Settings → UTM Tracking sends"""
    errors: dict = {}
    params = {}
    for name, rule in (data.get("params") or {}).items():
        if name not in PARAMS or name in BY_CHANNEL:
            errors[f"params.{name}"] = "Not a parameter C360 sets."
            continue
        kind, value = str((rule or {}).get("kind") or ""), str((rule or {}).get("value") or "").strip()
        if kind not in ("text", "field", "none"):
            errors[f"params.{name}"] = "Choose fixed text, a campaign field or Not Sent."
        elif kind == "text" and not slug(value):
            errors[f"params.{name}"] = "Type a value, or choose Not Sent."
        elif kind == "field" and value not in FIELDS:
            errors[f"params.{name}"] = "Choose one of the campaign fields."
        else:
            params[name] = {"kind": kind, "value": slug(value) if kind == "text" else value}
    if params.get("utm_source", {}).get("kind") == "none":
        errors["params.utm_source"] = "utm_source is required: analytics tools ignore the other tags without it."
    domains = []
    for raw in data.get("domains") or []:
        domain = str(raw or "").strip().lower().removeprefix("https://").removeprefix("http://").split("/")[0].lstrip(".")
        if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
            errors["domains"] = f"{raw} is not a domain, e.g. northwindapparel.com."
            break
        domains.append(domain)
    if (data.get("email") or data.get("sms")) and not domains:
        errors.setdefault("domains", "Add at least one of your sites: only links to them are tagged.")
    stored = {"email": bool(data.get("email")), "sms": bool(data.get("sms")), "params": params, "domains": sorted(set(domains)),
              "keep_existing": data.get("keep_existing", True) is not False}
    return stored, errors


def _host(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def verdict(url: str, settings: dict, never_hosts: tuple[str, ...] = ()) -> str:
    """`never_hosts`: C360's own addresses (its unsubscribe and preference pages, its short links)"""
    url = (url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return "NEVER"
    host = _host(url)
    if not host or host in never_hosts or any(word in urlsplit(url).path.lower() for word in NEVER_WORDS):
        return "NEVER"
    if not any(host == d or host.endswith("." + d) for d in settings["domains"]):
        return "NOT_YOUR_SITE"
    if any(key.lower().startswith("utm_") for key, _ in parse_qsl(urlsplit(url).query, keep_blank_values=True)):
        return "OWN_TAGS"
    return "TAGGED"


def tag_url(url: str, values: dict, settings: dict) -> str:
    """the address with the values added; a link's own utm_ values are kept unless the workspace replaces them"""
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    have = {key.lower() for key, _ in query}
    if not settings["keep_existing"]:
        query = [(k, v) for k, v in query if not k.lower().startswith("utm_")]
        have = set()
    query += [(name, values[name]) for name in PARAMS if values.get(name) and name not in have]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, safe=":/@{}"), parts.fragment))


def campaign_values(context: dict, settings: dict, channel: str) -> dict:
    """the parameter values of a campaign, without utm_content (per link)"""
    out = {}
    for name in PARAMS:
        if name in BY_CHANNEL:
            out[name] = BY_CHANNEL[name][channel]
            continue
        rule = settings["params"].get(name) or {"kind": "none"}
        override = (context.get("overrides") or {}).get(name)
        if override:
            out[name] = slug(override)
        elif rule["kind"] == "text":
            out[name] = slug(rule["value"])
        elif rule["kind"] == "field" and rule["value"] not in ("link_label", "link_label_variant"):
            out[name] = slug(context.get(rule["value"]) or "")
    return out


def content_value(settings: dict, label: str, variant: str | None) -> str:
    rule = settings["params"].get("utm_content") or {"kind": "none"}
    if rule["kind"] == "text":
        return slug(rule["value"])
    if rule["kind"] != "field":
        return ""
    if rule["value"] == "link_label_variant" and variant:
        return slug(f"{label}-{variant}")
    return slug(label) if rule["value"] in ("link_label", "link_label_variant") else ""


# ------------------------------------------------------------------------------------------------ the links of a message
def _anchor_label(inner: str) -> str:
    text = " ".join(unescape(TAG_RE.sub(" ", inner)).split())
    if not text:
        alt = ALT_RE.search(inner)
        text = unescape(alt.group(2)) if alt else ""
    return text


def links(html: str | None = None, text: str | None = None) -> list[dict]:
    """every link once per position: {"url", "text", "label", "position"}. HTML anchors first, then addresses typed in text."""
    found = []
    for match in ANCHOR_RE.finditer(html or ""):
        url = unescape(match.group(3)).strip()
        found.append({"url": url, "text": _anchor_label(match.group(5))})
    if not html:
        for match in URL_RE.finditer(text or ""):
            found.append({"url": match.group(0), "text": ""})
    for position, link in enumerate(found, start=1):
        link["position"] = position
        link["label"] = slug(link["text"])[:40] or f"link-{position}"
    return found


def tag_html(html: str, values: dict, settings: dict, labels: dict, variant: str | None, never_hosts: tuple[str, ...] = ()) -> str:
    """every eligible anchor of the HTML part, tagged; `labels` maps a position to the campaign's own label for it"""
    position = 0

    def swap(match):
        nonlocal position
        position += 1
        url = unescape(match.group(3)).strip()
        if verdict(url, settings, never_hosts) not in ("TAGGED", "OWN_TAGS"):
            return match.group(0)
        label = labels.get(str(position)) or slug(_anchor_label(match.group(5)))[:40] or f"link-{position}"
        tagged = tag_url(url, {**values, "utm_content": content_value(settings, label, variant)}, settings)
        return f"{match.group(1)}{match.group(2)}{tagged.replace('&', '&amp;')}{match.group(2)}{match.group(4)}{match.group(5)}</a>"
    return ANCHOR_RE.sub(swap, html or "")


def tag_text(text: str, values: dict, settings: dict, labels: dict, variant: str | None, shorten=None, never_hosts: tuple[str, ...] = ()) -> str:
    """the addresses typed in a text (an email's plain part, or a text message), tagged; `shorten(url, label)` returns the short link"""
    position = 0

    def swap(match):
        nonlocal position
        position += 1
        url = match.group(0)
        if verdict(url, settings, never_hosts) not in ("TAGGED", "OWN_TAGS"):
            return url
        label = labels.get(url) or labels.get(str(position)) or f"link-{position}"      # an email's text part: by address
        tagged = tag_url(url, {**values, "utm_content": content_value(settings, label, variant)}, settings)
        return shorten(tagged, label) if shorten else tagged
    return URL_RE.sub(swap, text or "")
