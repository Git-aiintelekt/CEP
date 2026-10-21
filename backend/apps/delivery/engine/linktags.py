"""UTM tags at send time: each campaign message's links, tagged after personalization (apps/delivery/utm.py has the rules).

  Tagger(campaign, channel, alias, renderer)   reads the workspace's settings (tenant.settings.utm) and the campaign's own
                                               choices (campaign_link_tracking); `on` is False when either is off, or before patch 0070
  tagger.email(rendered, variant)              the HTML and text parts, tagged
  tagger.sms(text)                             the text with its links tagged and shortened
  shorten(alias, tenant_id, tenant_code, campaign_id, url, label)
                                               the campaign's short link for a tagged address: one per campaign and address

A link's label (utm_content) is the campaign's own when it gave one for that position and address as written in the template,
else the link's text (an image link: its alt text), else link-N. A text's links become short links: <base>/api/v1/l/<workspace>/<code>/,
where base is the links.short_base_url parameter or the public API address; opening one counts a click and goes on to the
tagged page.
"""
from __future__ import annotations

import json
import secrets
import string
from urllib.parse import urlsplit

from django.db import connections

from apps.delivery import utm
from apps.platform_ops import params

ALPHABET = string.ascii_letters + string.digits
CATEGORY = {"REGULAR_MARKETING": "promotional", "E_RECEIPT": "transactional", "DRIP": "nurture", "JOURNEY": "lifecycle", "OTHER": "other"}


def _rows(alias: str, sql: str, args=None) -> list[tuple]:
    with connections[alias].cursor() as cursor:
        cursor.execute(sql, args or [])
        return cursor.fetchall() if cursor.description else []


def ready(alias: str) -> bool:
    """patch 0070 is in: campaign_link_tracking and tracking_link's click counts exist (asked first, so a missing one never aborts a transaction)"""
    return bool(_rows(alias, """SELECT to_regclass('public.campaign_link_tracking') IS NOT NULL
                                       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tracking_link' AND column_name = 'clicks')""")[0][0])


def short_base(tenant_code: str) -> str:
    base = str(params.get("links.short_base_url", "") or "").rstrip("/") or params.public_api_url()
    return f"{base}/api/v1/l/{tenant_code}"


def never_hosts() -> tuple[str, ...]:
    hosts = {urlsplit(params.public_api_url()).hostname, urlsplit(str(params.get("links.short_base_url", "") or "")).hostname}
    return tuple(h.lower() for h in hosts if h)


def category_of(campaign) -> str:
    if getattr(campaign, "solicitation_type", None) == "TRANSACTIONAL":
        return "transactional"
    return CATEGORY.get(getattr(campaign, "campaign_type", None) or "", "promotional")


def campaign_config(alias: str, campaign_id) -> dict:
    """{enabled, overrides, labels}; the defaults when the campaign has no row of its own"""
    found = _rows(alias, "SELECT enabled, overrides, labels FROM campaign_link_tracking WHERE campaign_id = %s", [str(campaign_id)]) if campaign_id else []
    if not found:
        return {"enabled": True, "overrides": {}, "labels": {}}
    enabled, overrides, labels = found[0]
    load = lambda value: json.loads(value) if isinstance(value, str) else (value or {})          # noqa: E731
    return {"enabled": bool(enabled), "overrides": load(overrides), "labels": load(labels)}


def context_for(campaign, overrides: dict) -> dict:
    return {"campaign_name": campaign.name, "campaign_code": campaign.code or "", "campaign_category": category_of(campaign),
            "channel": "email" if (campaign.channel or "EMAIL") in ("EMAIL", "E_RECEIPT") else "sms", "overrides": overrides}


def label_map(template_html: str | None, template_text: str | None, stored: dict) -> dict:
    """position -> the campaign's own label, for the links whose address as written still matches"""
    out = {}
    for link in utm.links(template_html, template_text):
        own = stored.get(f"{link['position']}|{link['url']}")
        if own:
            out[str(link["position"])] = utm.slug(own)[:40]
    return out


def shorten(alias: str, tenant_id, tenant_code: str, campaign_id, url: str, label: str) -> str:
    for _ in range(5):
        token = "".join(secrets.choice(ALPHABET) for _ in range(7))
        _rows(alias, """INSERT INTO tracking_link (tenant_id, campaign_id, token, target_url, link_label) VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING""", [str(tenant_id), str(campaign_id), token, url, label[:150]])
        found = _rows(alias, "SELECT token FROM tracking_link WHERE tenant_id = %s AND campaign_id = %s AND md5(target_url) = md5(%s)",
                      [str(tenant_id), str(campaign_id), url])
        if found:
            return f"{short_base(tenant_code)}/{found[0][0]}/"
    raise RuntimeError("no short link could be made")


class Tagger:
    def __init__(self, campaign, channel: str, alias: str, renderer=None, tenant_settings: dict | None = None):
        from apps.tenants.models import Tenant
        self.campaign, self.channel, self.alias = campaign, ("SMS" if channel in ("SMS", "MMS") else "EMAIL"), alias
        if tenant_settings is None:
            tenant_settings, self.tenant_code = Tenant.objects.filter(pk=campaign.tenant_id).values_list("settings", "code").first() or ({}, "")
        else:
            self.tenant_code = Tenant.objects.filter(pk=campaign.tenant_id).values_list("code", flat=True).first() or ""
        self.settings = utm.settings_for(tenant_settings)
        wanted = self.settings["sms" if self.channel == "SMS" else "email"] and bool(self.settings["domains"])
        self.on = bool(wanted and ready(alias))
        if not self.on:
            return
        config = campaign_config(alias, campaign.pk)
        self.on = config["enabled"]
        self.values = utm.campaign_values(context_for(campaign, config["overrides"]), self.settings, self.channel)
        self.labels = label_map(getattr(renderer, "html", None) if self.channel == "EMAIL" else None, getattr(renderer, "text", None), config["labels"])
        self.never = never_hosts()

    def email(self, rendered: dict, variant: str | None = None) -> dict:
        if not self.on:
            return rendered
        html = utm.tag_html(rendered["html"], self.values, self.settings, self.labels, variant, self.never)
        by_address = {}
        for link in utm.links(rendered["html"]):                              # the text part's links take their HTML twin's label
            by_address.setdefault(link["url"], self.labels.get(str(link["position"])) or link["label"])
        text = utm.tag_text(rendered["text"], self.values, self.settings, by_address, variant, never_hosts=self.never)
        return {**rendered, "html": html, "text": text}

    def sms(self, text: str) -> str:
        if not self.on:
            return text
        return utm.tag_text(text, self.values, self.settings, self.labels, None,
                            shorten=lambda url, label: shorten(self.alias, self.campaign.tenant_id, self.tenant_code, self.campaign.pk, url, label),
                            never_hosts=self.never)
