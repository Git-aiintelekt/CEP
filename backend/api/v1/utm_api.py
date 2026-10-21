"""UTM tracking.

  GET/PUT  /workspace/utm/                       Settings → UTM Tracking (provider.edit): channels, parameter values, your sites,
                                                 links that already have tags
  POST     /utm/preview/                         the campaign's Link Tracking card: every link of a template, its label, whether it
                                                 is tagged and the address it opens (nothing saved)
  GET/PUT  /campaigns/<id>/link-tracking/        a campaign's own choices: tagging on or off, its campaign name and tactic as sent,
                                                 link labels; with the clicks of a text campaign's short links
  GET      /l/<workspace>/<code>/                public: a short link counts the click and goes on to the tagged page
"""
import json
import re

from django.http import HttpResponse, HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.exceptions import Conflict
from api.permissions import HasPermissionCode, SameTenant
from apps.campaigns.models import Campaign
from apps.delivery import utm
from apps.delivery.engine import linktags, session
from apps.delivery.engine.dispatch_sms import text_content
from apps.templates.models import RenderedTemplateContent, TemplateMaster
from apps.tenants import context
from apps.tenants.models import Tenant

MANAGE = [IsAuthenticated, SameTenant, HasPermissionCode.for_("provider.edit")]


class ReadsUtm(BasePermission):
    """the settings are read by whoever writes campaigns or texts (the Link Tracking card, the text counter), not only by whoever manages engines"""

    def has_permission(self, request, view):
        user = request.user
        if getattr(user, "is_platform_admin", False):
            return True
        codes = user.permission_codes() if hasattr(user, "permission_codes") else set()
        return any(f"{area}.{level}" in codes for area in ("provider", "campaign", "template") for level in ("view", "edit"))
CAMPAIGNS = [IsAuthenticated, SameTenant, HasPermissionCode.for_("campaign.edit")]
FIELD_LABELS = {"campaign_name": "Campaign Name", "campaign_code": "Campaign Code", "campaign_category": "Campaign Type", "channel": "Channel",
                "link_label": "Link Label", "link_label_variant": "Link Label and A/B Variant"}


def _tenant():
    return Tenant.objects.get(pk=context.require().tenant_id)


def _payload(tenant) -> dict:
    settings = utm.settings_for(tenant.settings)
    return {**settings, "ready": linktags.ready(context.require().db_alias), "short_base": linktags.short_base(tenant.code),
            "fields": [{"key": k, "label": v} for k, v in FIELD_LABELS.items()], "by_channel": utm.BY_CHANNEL, "parameters": list(utm.PARAMS)}


class UtmSettingsView(APIView):
    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAuthenticated(), SameTenant(), ReadsUtm()]
        return [permission() for permission in MANAGE]

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(_payload(_tenant()))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        stored, errors = utm.validate(request.data if isinstance(request.data, dict) else {})
        if errors:
            raise ValidationError(errors)
        tenant = _tenant()
        tenant.settings = {**(tenant.settings or {}), "utm": stored}
        tenant.save(update_fields=["settings"])
        return Response(_payload(tenant))


def _config(data) -> dict:
    """a campaign's own choices, cleaned"""
    data = data if isinstance(data, dict) else {}
    overrides = {k: utm.slug(v) for k, v in (data.get("overrides") or {}).items() if k in ("utm_campaign", "utm_marketing_tactic") and utm.slug(v)}
    labels = {str(k)[:2100]: utm.slug(v)[:40] for k, v in (data.get("labels") or {}).items() if utm.slug(v)}
    return {"enabled": data.get("enabled", True) is not False, "overrides": overrides, "labels": labels}


class UtmPreviewView(APIView):
    """Every link of a template, as a campaign with these choices would send it. Saves nothing."""
    permission_classes = CAMPAIGNS

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        data = request.data if isinstance(request.data, dict) else {}
        template = TemplateMaster.objects.filter(pk=data.get("template_id"), deleted_at__isnull=True).first() if data.get("template_id") else None
        content = RenderedTemplateContent.objects.filter(template_id=template.pk).order_by("-version_number").first() if template else None
        channel = "SMS" if str(data.get("channel") or (template.channel if template else "EMAIL")) in ("SMS", "MMS") else "EMAIL"
        tenant = _tenant()
        settings = utm.settings_for(tenant.settings)
        config = _config(data.get("tracking"))
        campaign = Campaign(tenant_id=tenant.pk, name=str(data.get("name") or "Campaign"), code=str(data.get("code") or ""),
                            campaign_type=data.get("campaign_type") or "REGULAR_MARKETING", solicitation_type=data.get("solicitation_type") or "MARKETING",
                            channel=channel)
        values = utm.campaign_values(linktags.context_for(campaign, config["overrides"]), settings, channel)
        defaults = utm.campaign_values(linktags.context_for(campaign, {}), settings, channel)
        html = (content.html_content or "") if content is not None and channel == "EMAIL" else ""
        text = (text_content(content).text_content if channel == "SMS" else (content.text_content or "")) if content is not None else ""
        never = linktags.never_hosts()
        rows = []
        for link in utm.links(html or None, text if channel == "SMS" else None):
            key = f"{link['position']}|{link['url']}"
            label = config["labels"].get(key) or link["label"]
            state = utm.verdict(re.sub(r"\{\{[^}]*\}\}", "x", link["url"]), settings, never)      # a tag in the address: judged with a stand-in
            opens = utm.tag_url(link["url"], {**values, "utm_content": utm.content_value(settings, label, None)}, settings) if state in ("TAGGED", "OWN_TAGS") else link["url"]
            rows.append({"key": key, "position": link["position"], "url": link["url"], "text": link["text"] or link["url"], "default_label": link["label"],
                         "label": label, "verdict": state, "opens": opens,
                         "short": channel == "SMS" and state in ("TAGGED", "OWN_TAGS")})
        on = settings["sms" if channel == "SMS" else "email"]
        return Response({"channel": channel, "workspace_on": on and bool(settings["domains"]), "ready": linktags.ready(context.require().db_alias),
                         "enabled": config["enabled"], "values": values, "defaults": defaults, "links": rows,
                         "short_base": linktags.short_base(tenant.code), "has_content": content is not None})


class CampaignLinkTrackingView(APIView):
    permission_classes = CAMPAIGNS

    def _campaign(self, pk):
        campaign = Campaign.objects.filter(pk=pk, deleted_at__isnull=True).first()
        if campaign is None:
            raise NotFound("No such campaign.")
        return campaign

    def _clicks(self, alias, campaign_id) -> list[dict]:
        rows = linktags._rows(alias, """SELECT token, target_url, link_label, clicks, last_clicked_at FROM tracking_link
                                         WHERE campaign_id = %s ORDER BY clicks DESC, link_label""", [str(campaign_id)])
        return [{"token": r[0], "target_url": r[1], "label": r[2], "clicks": r[3], "last_clicked_at": r[4]} for r in rows]

    def _payload(self, campaign) -> dict:
        alias = context.require().db_alias
        ready = linktags.ready(alias)
        return {"ready": ready, **(linktags.campaign_config(alias, campaign.pk) if ready else {"enabled": True, "overrides": {}, "labels": {}}),
                "clicks": self._clicks(alias, campaign.pk) if ready else []}

    @extend_schema(responses={200: None})
    def get(self, request, pk=None, version=None):
        return Response(self._payload(self._campaign(pk)))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, pk=None, version=None):
        campaign = self._campaign(pk)
        alias = context.require().db_alias
        if not linktags.ready(alias):
            raise Conflict("Link tracking is switched on once patch 0070 is applied to this database.")
        config = _config(request.data)
        linktags._rows(alias, """
            INSERT INTO campaign_link_tracking (campaign_id, tenant_id, enabled, overrides, labels, updated_by, updated_at) VALUES (%s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (campaign_id) DO UPDATE SET enabled = EXCLUDED.enabled, overrides = EXCLUDED.overrides, labels = EXCLUDED.labels,
                                                    updated_by = EXCLUDED.updated_by, updated_at = now()""",
                       [str(campaign.pk), str(campaign.tenant_id), config["enabled"], json.dumps(config["overrides"]), json.dumps(config["labels"]),
                        str(request.user.pk) if request.user.pk else None])
        return Response(self._payload(campaign))


GONE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link not found</title><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#17181c;background:#fff;display:grid;place-items:center;min-height:100vh;padding:16px}
main{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#4b4f5b}</style></head>
<body><main><h1>This link is not available</h1><p>It may have been mistyped or removed. Open the latest message from the sender instead.</p></main></body></html>"""


@csrf_exempt
def short_link(request, tenant_code=None, token=None, version=None):
    """the workspace was resolved from the address (apps/tenants/resolver.py), so row-level security applies to the lookup"""
    if request.method not in ("GET", "HEAD") or context.current() is None:
        return HttpResponse(GONE, status=404, content_type="text/html; charset=utf-8")
    alias = context.require().db_alias
    if not linktags.ready(alias):
        return HttpResponse(GONE, status=404, content_type="text/html; charset=utf-8")
    with session.tx():
        if request.method == "HEAD":                                       # a link preview asking where it goes: not a click
            found = linktags._rows(alias, "SELECT target_url FROM tracking_link WHERE token = %s", [str(token or "")[:24]])
        else:
            found = linktags._rows(alias, "UPDATE tracking_link SET clicks = clicks + 1, last_clicked_at = %s WHERE token = %s RETURNING target_url",
                                   [timezone.now(), str(token or "")[:24]])
    if not found:
        return HttpResponse(GONE, status=404, content_type="text/html; charset=utf-8")
    answer = HttpResponseRedirect(found[0][0])
    answer["Cache-Control"] = "no-store"
    answer["Referrer-Policy"] = "no-referrer-when-downgrade"
    return answer
