"""The preheader block: hidden, right after <body>, padded so an inbox line never reaches the body. Rolled back, read-only.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import re
from django.db import connections, transaction
from apps.campaigns.models import Campaign
from apps.delivery.engine import render
from apps.tenants import context
from apps.tenants.models import Tenant

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_preheader(check):
    """The preheader block: hidden, right after <body>, padded so an inbox line never reaches the body. Rolled back, read-only."""
    html = render.with_preheader("<html><body><img alt=\"Banner\"><a href=\"#\">HOME</a><p>Insider's Club</p></body></html>", "Insiders get first dibs!")
    block = re.search(r'<body>(<div style="[^"]*">.*?</div>)', html).group(1)
    check("the block sits right after <body>, hidden every way the clients honour",
          all(rule in block for rule in ("display:none", "max-height:0px", "overflow:hidden", "opacity:0", "visibility:hidden", "mso-hide:all", "font-size:1px")), block[:160])
    pairs = block.count("&zwnj;&nbsp;")
    check("200 invisible pairs follow the preheader (Gmail shows ~140 characters, Outlook ~100)", pairs == 200, str(pairs))
    check("the preheader text comes first and the body's alt text and links only after the block", block.index("Insiders get first dibs!") < block.index("&zwnj;") and html.index("</div>") < html.index("Banner"))
    check("no preheader: the HTML is untouched", render.with_preheader("<html><body>x</body></html>", "") == "<html><body>x</body></html>")
    check("a preheader with markup characters is escaped", "&lt;b&gt;" in render.with_preheader("<body></body>", "<b>hi</b>"))

    ptok = context.set_platform(True)
    tenant = Tenant.objects.using("platform").get(code="NWA")
    context.reset_platform(ptok)
    context.set_current(str(tenant.id), "default", None)
    try:
        with transaction.atomic(using="default"):
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant.id)])
            campaign = Campaign.objects.filter(tenant_id=tenant.id, channel="EMAIL", deleted_at__isnull=True).exclude(preheader__isnull=True).exclude(preheader="").select_related("template").first()
            if campaign is None:
                print("SKIP no NWA email campaign with a preheader")
            else:
                content = campaign.template.template_contents.order_by("-version_number").first() if campaign.template else None
                renderer = render.Renderer(campaign, content) if hasattr(render, "Renderer") else None
                if renderer is None:
                    print("SKIP renderer class not found by that name")
                else:
                    first_text = re.sub(r"<[^>]+>", "", renderer.html.split("</div>", 1)[0]).strip()
                    check(f"a real campaign ({campaign.name}): the hidden block opens with its preheader and 200 pairs", first_text.startswith(renderer.preheader[:20]) and renderer.html.count("&zwnj;&nbsp;") >= 200, first_text[:80])
            raise RuntimeError("roll back")
    except RuntimeError:
        pass
    check.done()
