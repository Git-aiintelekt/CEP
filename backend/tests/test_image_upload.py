"""Designer image uploads (POST /api/v1/media-assets/): the four email formats are kept with their size, anything else is refused
in words, and a damaged or oversized picture is a 400, never a 500. Written for the Pillow 13 upgrade. Local database, rolled back;
files go to a temporary folder."""
import hashlib
import io
import struct
import zlib

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from PIL import Image
from rest_framework_simplejwt.tokens import AccessToken

from apps.identity.models import AppUser
from apps.tenants import context

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def picture(fmt, size=(40, 30), colour=(37, 99, 235), **options):
    out = io.BytesIO()
    Image.new("RGB", size, colour).save(out, format=fmt, **options)
    return out.getvalue()


def png_claiming(width, height):
    """A real one-pixel PNG whose header says it is width x height: what a decompression bomb looks like before decoding."""
    data = bytearray(picture("PNG", size=(1, 1)))
    ihdr = data.index(b"IHDR")
    data[ihdr + 4:ihdr + 12] = struct.pack(">II", width, height)
    data[ihdr + 17:ihdr + 21] = struct.pack(">I", zlib.crc32(bytes(data[ihdr:ihdr + 17])))
    return bytes(data)


def test_image_upload(check, admin_email, settings, tmp_path):
    settings.MEDIA_BUCKET, settings.MEDIA_ROOT = "", tmp_path
    tok = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(tok)
    client = Client()
    headers = {"HTTP_X_TENANT": admin.tenant.code, "HTTP_AUTHORIZATION": "Bearer " + str(AccessToken.for_user(admin))}

    def upload(data, name):
        return client.post("/api/v1/media-assets/", {"file": SimpleUploadedFile(name, data)}, **headers)

    def refusal(res):
        words = res.json().get("errors", {}).get("file", "") if res.status_code == 400 else ""
        return words[0] if isinstance(words, list) else words

    for fmt, colour, mime, extension in [("PNG", (37, 99, 235), "image/png", ".png"), ("JPEG", (200, 40, 40), "image/jpeg", ".jpg"),
                                         ("GIF", (10, 160, 90), "image/gif", ".gif"), ("WEBP", (120, 60, 200), "image/webp", ".webp")]:
        data = picture(fmt, colour=colour)
        res = upload(data, f"banner.{fmt.lower()}")
        body = res.json() if res.status_code == 201 else {}
        check(f"a {fmt} is kept with its size and type", res.status_code == 201 and body.get("mime_type") == mime
              and (body.get("width_px"), body.get("height_px")) == (40, 30), (res.status_code, body))
        stored = list(tmp_path.rglob(f"*{extension}"))
        check(f"the {fmt} is stored under its checksum", len(stored) == 1 and stored[0].stem == hashlib.sha256(data).hexdigest(), stored)

    again = upload(picture("PNG"), "copy-of-banner.png")
    check("the same picture uploaded twice is the existing asset", again.status_code == 200, again.status_code)

    frames = [Image.new("RGB", (24, 24), c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]]
    animated = io.BytesIO()
    frames[0].save(animated, format="GIF", save_all=True, append_images=frames[1:], duration=200, loop=0)
    res = upload(animated.getvalue(), "spinner.gif")
    check("an animated GIF is kept", res.status_code == 201 and res.json().get("width_px") == 24, res.status_code)

    res = upload(picture("PNG", size=(600, 400), colour=(250, 250, 250), optimize=True), "hero.png")
    check("a larger optimised PNG is kept with its size", res.status_code == 201 and res.json().get("height_px") == 400, res.status_code)

    unsupported = "Use PNG, JPEG, GIF or WebP (SVG is not supported by email clients)."
    for fmt in ["BMP", "TIFF"]:
        res = upload(picture(fmt), f"scan.{fmt.lower()}")
        check(f"a {fmt} is a real image but not one email takes", res.status_code == 400 and refusal(res) == unsupported, (res.status_code, refusal(res)))
    res = upload(b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', "logo.svg")
    check("an SVG is refused as not an image", res.status_code == 400 and refusal(res) == "This file is not a valid image.", (res.status_code, refusal(res)))

    invalid = "This file is not a valid image."
    for label, data, name in [("text named .png", b"not a picture at all", "notes.png"),
                              ("PNG cut short", picture("PNG", size=(200, 200), colour=(1, 2, 3))[:60], "cut.png"),
                              ("JPEG cut short", picture("JPEG", size=(200, 200))[:120], "cut.jpg"),
                              ("empty file", b"", "empty.png")]:
        res = upload(data, name)
        check(f"a {label} is refused in words", res.status_code == 400 and refusal(res) in (invalid, "The submitted file is empty."), (res.status_code, refusal(res)))

    res = upload(png_claiming(20000, 20000), "bomb.png")
    check("a picture claiming 400 million pixels is refused, not a server error",
          res.status_code == 400 and refusal(res) == "This image has too many pixels to use in an email.", (res.status_code, refusal(res)))
    check.done()
