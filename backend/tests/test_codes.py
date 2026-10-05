"""Barcode and QR code blocks: settings, value rules, signed addresses, drawing, the renderer swap, the sample and image
routes, save checks, the coupon tags (patch 0024 and onboarding's helper) and the send's count. Local database, rolled back.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
import json
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from django.conf import settings
from django.db import connections, transaction
from django.test import Client
from rest_framework_simplejwt.tokens import AccessToken
from apps.campaigns.models import CampaignRun
from apps.delivery.engine import dispatch, runs
from apps.delivery.engine.render import Renderer
from apps.identity.models import AppUser
from apps.platform_ops import params
from apps.templates import codes, design, starters
from apps.templates.models import PersonalizationTag, TemplateMaster
from apps.tenants import context
from PIL import Image  # noqa: E402
import io  # noqa: E402

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_codes(check, tmp_path, admin_email):
    """Barcode and QR code blocks: settings, value rules, signed addresses, drawing, the renderer swap, the sample and image"""
    OUT = tmp_path / "codes_out"
    OUT.mkdir(exist_ok=True)

    BAR = {"kind": "barcode", "source": "coupon_barcode_value", "format": "code128", "width": 300, "height": 80, "text": True, "align": "center"}
    QR = {"kind": "qr", "source": "coupon_qr_value", "ecc": "M", "size": 180, "text": False, "align": "left", "background": "#fff7e6"}

    def region(config, inner="<table><tr><td>sample</td></tr></table>"):
        return f"<!-- CEP:CODE {json.dumps(config)} -->{inner}<!-- CEP:CODE_END -->"

    # ---- settings -------------------------------------------------------------------------------------------------
    config, reason = codes.clean(BAR)
    check("a barcode's settings come back normalised", config and config["format"] == "code128" and config["background"] is None and reason is None, config)
    check("no data source is refused in words", codes.clean({**BAR, "source": ""})[1] == "The barcode block has no data source. Choose the tag its value comes from.")
    check("an unknown barcode type is refused", "Code 128" in (codes.clean({**BAR, "format": "pdf417"})[1] or ""))
    check("a barcode too wide is refused", "120-560px" in (codes.clean({**BAR, "width": 900})[1] or ""))
    check("a QR code too small is refused", "80-300px" in (codes.clean({**QR, "size": 40})[1] or ""))
    check("an unknown error correction is refused", "Standard" in (codes.clean({**QR, "ecc": "Z"})[1] or ""))
    check("a size that is not a number is refused", "whole number" in (codes.clean({**BAR, "width": "wide"})[1] or ""))
    check("a bad alignment or colour falls back quietly", {"align": "center", "background": None}.items() <= codes.clean({**BAR, "align": "middle", "background": "red"})[0].items())

    # ---- values --------------------------------------------------------------------------------------------------
    bar, qr = codes.clean(BAR)[0], codes.clean(QR)[0]
    ean = {**bar, "format": "ean13"}
    upc = {**bar, "format": "upca"}
    c39 = {**bar, "format": "code39"}
    check("Code 128 takes plain text", codes.value_problem(bar, "CPN400012345678") is None)
    check("Code 128 refuses an accent and a very long value", codes.value_problem(bar, "CAFÉ") and codes.value_problem(bar, "X" * 81))
    check("EAN-13: 12 digits, or 13 with the right check digit", codes.value_problem(ean, "400638133393") is None and codes.value_problem(ean, "4006381333931") is None)
    check("EAN-13: a wrong check digit or letters are refused", codes.value_problem(ean, "4006381333932") and codes.value_problem(ean, "40063813339A"))
    check("UPC-A: 11 digits, or 12 with the right check digit", codes.value_problem(upc, "03600029145") is None and codes.value_problem(upc, "036000291452") is None)
    check("UPC-A: a wrong check digit is refused", codes.value_problem(upc, "036000291453"))
    check("Code 39 takes lower case (it is drawn upper case), refuses @", codes.value_problem(c39, "save-20") is None and codes.value_problem(c39, "a@b"))
    check("a QR code takes a URL, refuses an empty value", codes.value_problem(qr, "https://shop.example.com/c/SAVE20") is None and codes.value_problem(qr, "") == "no value")

    # ---- signed addresses ----------------------------------------------------------------------------------------
    token = codes.token(bar, "CPN400012345678")
    loaded = codes.load(token)
    check("a token comes back as the drawing it stands for", loaded and loaded["value"] == "CPN400012345678" and loaded["config"]["width"] == 300)
    check("an altered token is refused", codes.load(token[:-2] + ("AA" if token[-2:] != "AA" else "BB")) is None)
    check("a hand-made token is refused", codes.load("eyJrIjoiYmFyY29kZSJ9:abc") is None)
    check("the same code always gets the same address", codes.token(bar, "CPN1") == codes.token(bar, "CPN1") and codes.token(bar, "CPN1") != codes.token(bar, "CPN2"))
    check("the address is under the public route", codes.url(bar, "X1").startswith(params.public_api_url() + "/api/v1/public/code/") and codes.url(bar, "X1").endswith(".png"))

    # ---- drawing -------------------------------------------------------------------------------------------------

    for name, cfg, value in [("code128", bar, "CPN400012345678"), ("ean13", ean, "400638133393"), ("upca", upc, "03600029145"),
                             ("code39", c39, "SAVE-20"), ("qr", qr, "https://shop.example.com/c/SAVE20-7K3Q"), ("qr_h", {**qr, "ecc": "H", "size": 120}, "SAVE20")]:
        data = codes.png(cfg, value)
        image = Image.open(io.BytesIO(data))
        want = (cfg["width"] * 2, cfg["height"] * 2) if cfg["kind"] == "barcode" else (cfg["size"] * 2, cfg["size"] * 2)
        (OUT / f"{name}.png").write_bytes(data)
        corner = image.convert("L").getpixel((0, 0))
        check(f"{name}: a PNG at twice the size shown, white quiet zone", image.format == "PNG" and image.size == want and corner == 255, f"{image.size} corner={corner}")
    check("the same drawing is served from the cache", codes.png(bar, "CPN400012345678") == codes.png(bar, "CPN400012345678"))

    # ---- markup and regions --------------------------------------------------------------------------------------
    markup = codes.email_html(bar, 'A"<b>', src="https://x.example/c.png")
    check("the value is escaped in alt and text", 'alt="A&quot;&lt;b&gt;"' in markup and ">A&quot;&lt;b&gt;</div>" in markup, markup[:140])
    check("the image is full size with max-width for phones", 'width="300" height="80"' in markup and "max-width:100%" in markup)
    check("no number without Show number", "<div" not in codes.email_html(qr, "V", src="https://x.example/q.png"))
    check("the QR block carries its background and alignment", "background:#fff7e6" in codes.email_html(qr, "V", src="s") and 'align="left"' in codes.email_html(qr, "V", src="s"))
    html = "<p>Hi</p>" + region(BAR) + "<p>and</p>" + region(QR)
    check("sources lists each block's tag once", codes.sources(html + region(BAR)) == ["coupon_barcode_value", "coupon_qr_value"])
    check("problems: none for good blocks", codes.problems(html) == [])
    check("problems: a bad block and an unpaired marker", len(codes.problems(region({**BAR, "format": "x"}) + "<!-- CEP:CODE {} -->")) == 2, codes.problems(region({**BAR, "format": "x"}) + "<!-- CEP:CODE {} -->"))
    check("text part: the number as its tag, nothing without the number", codes.for_text(html) == "<p>Hi</p><p>{{coupon_barcode_value}}</p><p>and</p>", codes.for_text(html))

    # ---- the renderer --------------------------------------------------------------------------------------------
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    TENANT, CODE = str(admin.tenant_id), admin.tenant.code
    campaign = SimpleNamespace(tenant_id=TENANT, name="Coupon drop")
    content = SimpleNamespace(html_content="<p>Hi {{first_name}}</p>" + region(BAR) + region(QR), text_content="Hi {{first_name}}\n{{coupon_barcode_value}}", subject_line="Your coupon")
    tags = [SimpleNamespace(tag_key="coupon_barcode_value", resolution_source="CAMPAIGN_LIST_MEMBER", source_path="custom_value_pairs.coupon_barcode_value", default_value=None, format_spec=None, data_type="STRING", static_value=None),
            SimpleNamespace(tag_key="coupon_qr_value", resolution_source="CAMPAIGN_LIST_MEMBER", source_path="custom_value_pairs.coupon_qr_value", default_value=None, format_spec=None, data_type="STRING", static_value=None)]
    member = {"custom_value_pairs": {"coupon_barcode_value": "CPN4000999", "coupon_qr_value": "https://shop.example.com/c/Q1"}}
    with mock.patch.object(params, "enabled", return_value=True) as on:
        r = Renderer(campaign=campaign, run=None, content=content, tags=tags)
        out = r.render(customer={"first_name": "Aaliyah"}, member=member, system={})
        check("both blocks become the recipient's own codes", out["html"].count("/api/v1/public/code/") == 2 and "CEP:CODE" not in out["html"] and "sample" not in out["html"], out["html"][:200])
        check("the number is in the HTML, escaped once", ">CPN4000999</div>" in out["html"])
        check("nothing was left out", out["codes_left_out"] == [])
        src = out["html"].split('src="')[1].split('"')[0]
        check("the image address loads back to this recipient's value", codes.load(src.rsplit("/", 1)[1][:-4])["value"] == "CPN4000999")
        check("the text part carries the value", "CPN4000999" in out["text"])
        out2 = r.render(customer={"first_name": "Ben"}, member={"custom_value_pairs": {"coupon_barcode_value": "CPN1"}}, system={})
        check("a recipient with no QR value gets the barcode only, and it is counted", out2["html"].count("/public/code/") == 1 and out2["codes_left_out"] == ["coupon_qr_value"], out2["codes_left_out"])
        ean_content = SimpleNamespace(html_content=region({**BAR, "format": "ean13"}), text_content="", subject_line="s")
        out3 = Renderer(campaign=campaign, run=None, content=ean_content, tags=tags).render(customer={}, member={"custom_value_pairs": {"coupon_barcode_value": "12AB"}}, system={})
        check("a value the format cannot carry leaves the block out", out3["html"] == "" and out3["codes_left_out"] == ["coupon_barcode_value"])
        check("the feature is read once per renderer", on.call_count == 2, on.call_count)
        plain = Renderer(campaign=campaign, run=None, content=SimpleNamespace(html_content="<p>none</p>", text_content="", subject_line="s"), tags=tags)
        plain.render(customer={}, member={}, system={})
        check("a design without code blocks never asks for the feature", on.call_count == 2)
    with mock.patch.object(params, "enabled", return_value=False):
        off = Renderer(campaign=campaign, run=None, content=content, tags=tags).render(customer={}, member=member, system={})
        check("without the feature every block is left out and counted", "/public/code/" not in off["html"] and sorted(off["codes_left_out"]) == ["coupon_barcode_value", "coupon_qr_value"])
        tricky = {"custom_value_pairs": {"coupon_barcode_value": "{{first_name}}", "coupon_qr_value": "x"}}
    with mock.patch.object(params, "enabled", return_value=True):
        out4 = Renderer(campaign=campaign, run=None, content=SimpleNamespace(html_content=region(BAR), text_content="", subject_line="s"), tags=tags).render(customer={"first_name": "Z"}, member=tricky, system={})
        check("a value that looks like a tag is drawn as itself, not filled in", ">{{first_name}}</div>" in out4["html"], out4["html"][-80:])

    # ---- routes --------------------------------------------------------------------------------------------------
    c = Client()
    H = {"HTTP_X_TENANT": CODE, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}
    body = {"kind": "barcode", "format": "ean13", "width": 300, "height": 80, "value": "400638133393"}
    with mock.patch.object(params, "features_for", return_value={"dynamic_codes": False}):
        res = c.post("/api/v1/codes/sample/", body, content_type="application/json", **H)
        check("the sample route needs the feature", res.status_code == 403 and "Barcodes and QR codes" in res.json().get("detail", ""), res.status_code)
    with mock.patch.object(params, "features_for", return_value={"dynamic_codes": True}):
        res = c.post("/api/v1/codes/sample/", body, content_type="application/json", **H)
        check("with the feature a sample comes back as a signed address", res.status_code == 200 and res.json()["valid"] and "/public/code/" in res.json()["url"], res.content[:160])
        sample_url = res.json()["url"]
        res = c.post("/api/v1/codes/sample/", {**body, "value": "12"}, content_type="application/json", **H)
        check("a sample the format cannot carry says why", res.json() == {"valid": False, "message": "The sample value cannot be drawn: EAN-13 needs 12 digits, or 13 with a correct check digit."}, res.json())
        res = c.post("/api/v1/codes/sample/", {"kind": "qr", "size": 999, "value": "x"}, content_type="application/json", **H)
        check("a size out of range says why", res.json()["valid"] is False and "80-300px" in res.json()["message"])
    res = c.post("/api/v1/codes/sample/", body, content_type="application/json")
    check("the sample route needs sign-in", res.status_code in (401, 403, 404), res.status_code)
    path = "/api/v1/public/code/" + sample_url.split("/public/code/")[1]
    res = c.get(path)
    check("the image route draws a signed code, cached for good", res.status_code == 200 and res["Content-Type"] == "image/png" and "immutable" in res["Cache-Control"], res.status_code)
    check("the image route refuses an altered address", c.get(path.replace(".png", "x.png")).status_code == 404)

    # ---- save, the coupon tags, the send's count -----------------------------------------------------------------
    # platform context routes every model to the platform alias: the raw SQL goes there too, or the ORM waits on it
    PLATFORM = settings.PLATFORM_ALIAS
    with transaction.atomic(using=PLATFORM), transaction.atomic():
        tok = context.set_platform(True)
        with connections[PLATFORM].cursor() as cursor:
            cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [TENANT])
            sql = (Path(settings.BASE_DIR).parent / "database" / "patches" / "0024_coupon_tags_dynamic_codes.sql").read_text(encoding="utf-8")
            cursor.execute(sql)
            cursor.execute("SELECT count(*) FROM personalization_tag WHERE tag_key IN ('coupon_code', 'coupon_barcode_value', 'coupon_qr_value') AND tenant_id = %s", [TENANT])
            first = cursor.fetchone()[0]
            cursor.execute(sql)
            cursor.execute("SELECT count(*) FROM personalization_tag WHERE tag_key IN ('coupon_code', 'coupon_barcode_value', 'coupon_qr_value') AND tenant_id = %s", [TENANT])
            again = cursor.fetchone()[0]
            cursor.execute("SELECT count(*) FROM tenant")
            tenants = cursor.fetchone()[0]
            cursor.execute("SELECT count(*) FROM personalization_tag WHERE tag_key = 'coupon_qr_value'")
            everywhere = cursor.fetchone()[0]
        check("patch 0024 gives the workspace its three coupon tags, and a re-run adds none", first == 3 and again == 3, (first, again))
        check("patch 0024 reaches every workspace", everywhere == tenants, (everywhere, tenants))
        check("onboarding's helper finds nothing missing afterwards", starters.ensure_coupon_tags(TENANT) == 0)
        PersonalizationTag.objects.filter(tenant_id=TENANT, tag_key="coupon_code").delete()
        check("onboarding's helper adds back a missing one", starters.ensure_coupon_tags(TENANT) == 1)

        template = TemplateMaster.objects.filter(tenant_id=TENANT, channel="EMAIL", deleted_at__isnull=True).exclude(status="ARCHIVED").first()
        base = design.latest_version(template)
        mjml = f"<mjml><mj-body><mj-raw>{region(BAR)}</mj-raw><mj-section><mj-column><mj-text>{{{{unsubscribe_url}}}}</mj-text></mj-column></mj-section></mj-body></mjml>"
        saved = design.save_design(template, admin.pk, editor_state={}, mjml_source=mjml, subject_line="S", preheader="", base_version=base)
        check("save keeps the block in the HTML and counts its tag as used", "CEP:CODE {" in saved["html_content"] and "coupon_barcode_value" in saved["findings"]["tags_used"], saved["findings"]["tags_used"])
        check("the text part carries the block's tag, not the sample", "{{coupon_barcode_value}}" in (saved.get("text_content") or ""), (saved.get("text_content") or "")[:120])
        from rest_framework.exceptions import ValidationError
        try:
            design.save_design(template, admin.pk, editor_state={}, mjml_source=mjml.replace('"code128"', '"pdf417"'), subject_line="S", preheader="", base_version=base + 1)
            check("save refuses a block the email cannot use", False)
        except ValidationError as exc:
            check("save refuses a block the email cannot use", "barcode type" in str(exc.detail), str(exc.detail)[:160])

        run = CampaignRun.objects.filter(tenant_id=TENANT).select_related("campaign").first()
        before = runs.codes_left_out(TENANT, run.pk)
        dispatch.record_codes_left_out(TENANT, run.campaign_id, run.pk, 4, {"coupon_barcode_value": 3, "coupon_qr_value": 2})
        dispatch.record_codes_left_out(TENANT, run.campaign_id, run.pk, 1, {"coupon_qr_value": 1})
        check("the run adds up the batches' left-out recipients", runs.codes_left_out(TENANT, run.pk) == before + 5, runs.codes_left_out(TENANT, run.pk))
        context.reset_platform(tok)
        transaction.set_rollback(True, using=PLATFORM)
        transaction.set_rollback(True)

    check("the feature is off by default and named for tenant management", params.FEATURES["dynamic_codes"] == {"name": "Barcodes and QR codes", "default": False, "plan_key": "dynamic_codes"})
    check("a plan can switch it off; a tenant override switches it on", params.resolve({"features": {"dynamic_codes": True}}, {}, {})["dynamic_codes"] is True
          and params.resolve({"features": {"dynamic_codes": True}}, {"dynamic_codes": False}, {})["dynamic_codes"] is False
          and params.resolve({}, {}, {})["dynamic_codes"] is False)
    check.done()
