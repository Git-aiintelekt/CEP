"""The return barcode of an e-receipt: a Code 128 image of the receipt number, served at a public address.

A data: image would be simplest, but Gmail and some Outlooks refuse them, so the receipt carries a plain <img> that
points at GET /api/v1/public/barcode/<number>.png on this installation (the public address is the platform parameter).
The image is rendered on the first request and cached for a day; the answer is marked immutable, so a mail client
that already fetched it never asks again.
"""
import io
import re
from urllib.parse import quote

from django.core.cache import cache

from apps.platform_ops import params

VALID = re.compile(r"^[A-Za-z0-9 ._#:-]{1,48}$")             # Code 128 takes any ASCII; this is what a receipt number looks like
WIDTH, HEIGHT = 480, 128                                      # the PNG: twice the 240x64 the email shows it at, for sharp bars
CACHE_SECONDS = 24 * 3600


def valid(text: str) -> bool:
    return bool(VALID.match(text or ""))


def url(text: str) -> str:
    return f"{params.public_api_url()}/api/v1/public/barcode/{quote(text, safe='')}.png"


def png(text: str) -> bytes:
    """The bars of `text` centred on a white 480x128 canvas; a long number is scaled to fit the width."""
    key = f"cep:barcode:{text}"
    found = cache.get(key)
    if found:
        return found
    import barcode as barcode_lib
    from barcode.writer import ImageWriter
    from PIL import Image
    raw = io.BytesIO()
    barcode_lib.get("code128", text, writer=ImageWriter()).write(raw, options={"module_width": 0.2, "module_height": 10.0, "quiet_zone": 1.0,
                                                                              "write_text": False, "dpi": 300})
    raw.seek(0)
    bars = Image.open(raw).convert("L")
    bars = bars.crop(bars.getbbox() or (0, 0, bars.width, bars.height))
    fit = min(1.0, (WIDTH - 24) / bars.width)
    if fit < 1.0:
        bars = bars.resize((max(1, int(bars.width * fit)), bars.height), Image.Resampling.LANCZOS)
    if bars.height != HEIGHT - 24:
        bars = bars.resize((bars.width, HEIGHT - 24), Image.Resampling.NEAREST)
    canvas = Image.new("L", (WIDTH, HEIGHT), 255)
    canvas.paste(bars, ((WIDTH - bars.width) // 2, 12))
    out = io.BytesIO()
    canvas.save(out, format="PNG", optimize=True)
    data = out.getvalue()
    cache.set(key, data, CACHE_SECONDS)
    return data
