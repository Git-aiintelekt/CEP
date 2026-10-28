"""The Platform Guide in the back-office: the chapters, the renderer, the index and a chapter page, a bad address. Read-only.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.test import Client
from apps.identity.models import AppUser
from apps.platform_ops import guide

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_platform_guide(check):
    """The Platform Guide in the back-office: the chapters, the renderer, the index and a chapter page, a bad address. Read-only."""
    P = settings.PLATFORM_ALIAS
    chapters = guide.chapters()
    check("every chapter file, in reading order, the introduction first, each with its title", len(chapters) == len(list(guide.FOLDER.glob("*.md"))) and chapters[0]["slug"] == "introduction" and chapters[0]["title"] == "The CEP Platform Guide"
          and chapters[4]["slug"] == "onboarding", str([c["slug"] for c in chapters][:5]))

    html = guide.render("# Title\n\n**Where:** here, *now*. See [Users](/admin/identity/appuser/) and `user.admin`.\n\n## A section\n\n| A | B |\n|---|---|\n| one | two <b>x</b> |\n\n- first\n- second\n  more\n\n1. step\n\n> quoted\n", skip_title=True)
    check("the renderer: the title skipped, headings, bold, italics, code, links, a table, lists and a quote, with text escaped",
          "<h1>" not in html and "<h2>A section</h2>" in html and "<strong>Where:</strong>" in html and "<em>now</em>" in html and "<code>user.admin</code>" in html
          and '<a href="/admin/identity/appuser/">Users</a>' in html and "<th>A</th>" in html and "<td>two &lt;b&gt;x&lt;/b&gt;</td>" in html
          and "<li>second more</li>" in html and "<ol><li>step</li></ol>" in html and "<blockquote>quoted</blockquote>" in html, html[:300])
    check("a link to another site is not rendered as a link", "<a" not in guide.render("[x](http://evil.test/)"))

    staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    client = Client()
    client.force_login(staff)
    page = client.get("/admin/platform_ops/platformsetting/guide/")
    body = page.content.decode() if page.status_code == 200 else ""
    check("the index lists every chapter and the way in", page.status_code == 200 and body.count('class="cep-link" href="/admin/platform_ops/platformsetting/guide/') >= 16 and "Where to Start" in body, f"{page.status_code}")
    check("the sidebar offers the Platform Guide", "Platform Guide" in body and "menu_book" in body)
    page = client.get("/admin/platform_ops/platformsetting/guide/onboarding/")
    body = page.content.decode() if page.status_code == 200 else ""
    check("a chapter page renders its sections and its table", page.status_code == 200 and "<h1>Onboarding a Tenant</h1>" in body and "<h2>The seven steps</h2>" in body
          and "<th>Step</th>" in body and "Onboard CODE" in body, f"{page.status_code}")
    check("the chapter list marks the current chapter", 'aria-current="page"' in body)
    page = client.get("/admin/platform_ops/platformsetting/guide/no-such-chapter/")
    check("a chapter that does not exist is 404", page.status_code == 404, f"{page.status_code}")
    check.done()
