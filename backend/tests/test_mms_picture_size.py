"""An MMS picture is at least 600 × 600 pixels and at most 1 MB; larger pictures are fine. Saving the template refuses a
smaller one, and a template saved with one before the rule is held back from launch with the reason. Rolled back."""
import json

import pytest
from django.db import connection, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken

from apps.campaigns.service import content_problem
from apps.delivery.engine import session
from apps.identity.models import AppUser
from apps.templates import design
from apps.templates.models import TemplateMaster
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
BODY = "ZZ: our new range is in. Reply STOP to opt out."


def test_mms_picture_size(check, admin_email):
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    tenant, code = str(admin.tenant_id), admin.tenant.code
    client = Client()
    headers = {"HTTP_X_TENANT": code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def api(method, path, body=None):
        return getattr(client, method)(path, json.dumps(body or {}), content_type="application/json", **headers)

    def sql(statement, args=None):
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [tenant])
            cursor.execute(statement, args or [])
            return cursor.fetchall() if cursor.description else None

    def picture(name, width, height, size=200_000):
        return str(sql("""INSERT INTO media_asset (tenant_id, file_name, mime_type, byte_size, width_px, height_px, storage_key, checksum_sha256, public_url, scan_status)
                          VALUES (%s, %s, 'image/png', %s, %s, %s, %s, md5(%s), %s, 'SKIPPED') RETURNING id""",
                       [tenant, name, size, width, height, name, name, f"https://cdn.zz.example/{name}"])[0][0])

    with transaction.atomic():
        template = api("post", "/api/v1/templates/", {"name": "ZZ picture size", "channel": "MMS"}).json()["id"]
        version = 0

        def save(asset):
            nonlocal version
            answer = api("post", f"/api/v1/templates/{template}/message/", {"sms_body": BODY, "subject_line": "", "media_asset": asset, "base_version": version})
            if answer.status_code == 201:
                version = answer.json()["latest_version"]
            return answer

        narrow = save(picture("zz-narrow.png", 400, 800))
        check("a picture under 600 pixels wide is refused, with its size", narrow.status_code == 400
              and "400 × 800 pixels" in str(narrow.json()) and "at least 600 × 600" in str(narrow.json()), f"{narrow.status_code} {narrow.content[:200]}")
        short = save(picture("zz-short.png", 900, 599))
        check("... and one under 600 pixels high", short.status_code == 400 and "900 × 599" in str(short.json()), f"{short.status_code} {short.content[:200]}")
        exact = save(picture("zz-exact.png", 600, 600))
        check("600 × 600 is accepted", exact.status_code == 201, f"{exact.status_code} {exact.content[:200]}")
        large = save(picture("zz-large.png", 1200, 900))
        check("a larger picture, not square, is accepted", large.status_code == 201, f"{large.status_code} {large.content[:200]}")
        heavy = save(picture("zz-heavy.png", 1200, 1200, size=1_100_000))
        check("over 1 MB is still refused", heavy.status_code == 400 and "1 MB" in str(heavy.json()), f"{heavy.status_code} {heavy.content[:200]}")

        # a template saved before the rule, with a small picture
        old = picture("zz-old.png", 320, 240)
        sql("INSERT INTO template_design_state (template_id, version_number, editor_state) VALUES (%s, %s, %s::jsonb)",
            [template, version + 1, json.dumps({"kind": "message", "channel": "MMS", "media_asset_id": old})])
        sql("INSERT INTO rendered_template_content (template_id, version_number, sms_body, text_content) VALUES (%s, %s, %s, %s)", [template, version + 1, BODY, BODY])
        with session.tenant_scope(tenant), session.tx():
            saved = TemplateMaster.objects.get(pk=template)
            blocked = design.message_blockers(saved).get("media_asset")
            launch = content_problem(saved, "MARKETING")
        check("an older template with a small picture is blocked from activating, with the reason", blocked == design.mms_too_small(320, 240) and "320 × 240" in (blocked or ""), blocked)
        check("... and from launching, with the same reason", launch == blocked, launch)
    check.done()


def test_the_size_rule(check):
    check("600 × 600 and larger pass", design.mms_too_small(600, 600) is None and design.mms_too_small(1600, 900) is None)
    check("either side under 600 fails", bool(design.mms_too_small(599, 1200)) and bool(design.mms_too_small(1200, 599)))
    check("an unknown size is not refused here", design.mms_too_small(None, None) is None)
    check.done()
