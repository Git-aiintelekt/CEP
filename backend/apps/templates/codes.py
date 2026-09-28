"""Barcode and QR code blocks: a dynamic image drawn from one tag's value for each recipient.

The designer writes each block as an mj-raw whose region is bracketed by two comments, the first carrying the block's
settings as JSON. mj-raw content is copied byte for byte by the compilers, so the region reaches the saved HTML intact:

    <!-- CEP:CODE {"kind":"barcode","source":"coupon_barcode_value","format":"code128","width":300,"height":80,...} -->
    ...the sample the designer shows...
    <!-- CEP:CODE_END -->

At send time the renderer replaces each region with the recipient's own code: a hosted PNG (Gmail and some Outlooks
refuse data: images) behind a signed address, so the route draws only what CEP issued, and the value printed under it
as text, which keeps the coupon usable while the inbox still hides images. A recipient with no value, or one the format
cannot carry, gets the email without the block, and the send counts it.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
from html import escape

from django.core import signing
from django.core.cache import cache

MARK = "<!-- CEP:CODE "
REGION_RE = re.compile(r"<!-- CEP:CODE (\{.*?\}) -->.*?<!-- CEP:CODE_END -->", re.DOTALL)

KINDS = ("barcode", "qr")
BARCODE_FORMATS = {"code128": "Code 128", "code39": "Code 39", "ean13": "EAN-13", "upca": "UPC-A"}
QR_LEVELS = {"L": "Low", "M": "Standard", "Q": "High", "H": "Maximum"}
ALIGNS = ("left", "center", "right")
BARCODE_WIDTH = (120, 560)
BARCODE_HEIGHT = (40, 200)
QR_SIZE = (80, 300)
QR_MAX = 1000                                           # characters: a long URL fits, a paragraph does not
CODE128_MAX = 80
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
TAG_KEY = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_.]*$")
SALT = "cep.dynamic-code"
CACHE_SECONDS = 24 * 3600
SCALE = 2                                               # the PNG is drawn at twice the size the email shows, for sharp bars
PADDING = "16px 24px"
TEXT_STYLE = "font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;letter-spacing:2px;color:#0f172a;padding-top:6px;"


# ---------------------------------------------------------------- settings
def clean(raw: dict) -> tuple[dict | None, str | None]:
    """The settings a block may carry, normalised, or the reason they cannot be used."""
    if not isinstance(raw, dict):
        return None, "The block's settings are not readable."
    kind = raw.get("kind")
    if kind not in KINDS:
        return None, "A code block must be a barcode or a QR code."
    source = str(raw.get("source") or "").strip()
    if not TAG_KEY.match(source):
        return None, f"The {label_of(kind)} block has no data source. Choose the tag its value comes from."
    config = {"kind": kind, "source": source, "text": bool(raw.get("text", True)),
              "align": raw.get("align") if raw.get("align") in ALIGNS else "center",
              "background": raw.get("background") if isinstance(raw.get("background"), str) and HEX.match(raw["background"]) else None}
    try:
        if kind == "barcode":
            config["format"] = raw.get("format") or "code128"
            if config["format"] not in BARCODE_FORMATS:
                return None, "Choose a barcode type: Code 128, Code 39, EAN-13 or UPC-A."
            config["width"], config["height"] = int(raw.get("width", 300)), int(raw.get("height", 80))
            if not BARCODE_WIDTH[0] <= config["width"] <= BARCODE_WIDTH[1] or not BARCODE_HEIGHT[0] <= config["height"] <= BARCODE_HEIGHT[1]:
                return None, f"A barcode is {BARCODE_WIDTH[0]}-{BARCODE_WIDTH[1]}px wide and {BARCODE_HEIGHT[0]}-{BARCODE_HEIGHT[1]}px tall."
        else:
            config["ecc"] = raw.get("ecc") or "M"
            if config["ecc"] not in QR_LEVELS:
                return None, "Choose an error correction level: Low, Standard, High or Maximum."
            config["size"] = int(raw.get("size", 180))
            if not QR_SIZE[0] <= config["size"] <= QR_SIZE[1]:
                return None, f"A QR code is {QR_SIZE[0]}-{QR_SIZE[1]}px square."
    except (TypeError, ValueError):
        return None, "The block's size must be a whole number of pixels."
    return config, None


def label_of(kind: str) -> str:
    return "QR code" if kind == "qr" else "barcode"


def parse(text: str) -> dict | None:
    try:
        config, _ = clean(json.loads(text))
    except ValueError:
        return None
    return config


def regions(html: str) -> list[tuple[dict | None, str | None]]:
    """Each block in a design, as (settings, None) or (None, reason)."""
    found = []
    for match in REGION_RE.finditer(html or ""):
        try:
            found.append(clean(json.loads(match.group(1))))
        except ValueError:
            found.append((None, "The block's settings are not readable."))
    return found


def problems(mjml_or_html: str) -> list[str]:
    """What save refuses: a block whose settings the email cannot use. An unpaired marker counts too."""
    text = mjml_or_html or ""
    reasons = [reason for _, reason in regions(text) if reason]
    if text.count(MARK) != text.count("<!-- CEP:CODE_END -->"):
        reasons.append("A barcode or QR code block is incomplete. Delete it and add it again.")
    return reasons


def sources(mjml_or_html: str) -> list[str]:
    """The tags the blocks read: they count as used, like a {{tag}} in the text."""
    seen: dict[str, None] = {}
    for config, _ in regions(mjml_or_html):
        if config:
            seen.setdefault(config["source"], None)
    return list(seen)


def for_text(html: str) -> str:
    """The HTML the plain-text part is made from: each block becomes its value as a tag, or nothing without the number."""
    return REGION_RE.sub(lambda m: (lambda c: f"<p>{{{{{c['source']}}}}}</p>" if c and c["text"] else "")(parse(m.group(1))), html or "")


# ---------------------------------------------------------------- values
def _digits_with_check(value: str, length: int) -> bool:
    """`length` digits and a correct GS1 check digit, or one digit fewer (the check digit is then added)."""
    if not value.isdigit() or len(value) not in (length - 1, length):
        return False
    if len(value) == length - 1:
        return True
    body, check = value[:-1], int(value[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def value_problem(config: dict, value: str) -> str | None:
    """None when the value can be drawn in the block's format, else what is wrong with it."""
    if not value:
        return "no value"
    if config["kind"] == "qr":
        return None if len(value) <= QR_MAX else f"longer than {QR_MAX} characters"
    fmt = config["format"]
    if fmt == "code128":
        ok = len(value) <= CODE128_MAX and all(32 <= ord(c) <= 126 for c in value)
        return None if ok else f"Code 128 takes up to {CODE128_MAX} plain characters"
    if fmt == "code39":
        return None if re.match(r"^[0-9A-Z \-.$/+%]{1,43}$", value.upper()) else "Code 39 takes letters, digits and - . $ / + % space"
    if fmt == "ean13":
        return None if _digits_with_check(value, 13) else "EAN-13 needs 12 digits, or 13 with a correct check digit"
    if fmt == "upca":
        return None if _digits_with_check(value, 12) else "UPC-A needs 11 digits, or 12 with a correct check digit"
    return "unknown format"


# ---------------------------------------------------------------- the signed address
def token(config: dict, value: str) -> str:
    payload = {"k": config["kind"], "v": value}
    if config["kind"] == "barcode":
        payload.update(f=config["format"], w=config["width"], h=config["height"])
    else:
        payload.update(e=config["ecc"], s=config["size"])
    # no timestamp: the same code always has the same address, so an inbox's image proxy fetches it once for everyone
    return signing.Signer(salt=SALT).sign_object(payload, compress=True)


def load(signed: str) -> dict | None:
    """The drawing a signed address stands for; None when it was not issued by this installation or was altered."""
    try:
        payload = signing.Signer(salt=SALT).unsign_object(signed)
    except signing.BadSignature:
        return None
    if payload.get("k") == "barcode":
        config, _ = clean({"kind": "barcode", "source": "x", "format": payload.get("f"), "width": payload.get("w"), "height": payload.get("h")})
    else:
        config, _ = clean({"kind": "qr", "source": "x", "ecc": payload.get("e"), "size": payload.get("s")})
    value = str(payload.get("v") or "")
    if config is None or value_problem(config, value):
        return None
    return {"config": config, "value": value}


def url(config: dict, value: str) -> str:
    from apps.platform_ops import params
    return f"{params.public_api_url()}/api/v1/public/code/{token(config, value)}.png"


# ---------------------------------------------------------------- the email's markup
def email_html(config: dict, value: str, src: str | None = None) -> str:
    """The block as the recipient gets it: the code centred (or aligned) in a full-width row, the value under it."""
    width, height = (config["width"], config["height"]) if config["kind"] == "barcode" else (config["size"], config["size"])
    shown = escape(value, quote=True)
    background = f"background:{config['background']};" if config.get("background") else ""
    image = (f'<img src="{escape(src or url(config, value), quote=True)}" width="{width}" height="{height}" alt="{shown}" '
             f'style="display:inline-block;width:{width}px;height:{height}px;max-width:100%;border:0;outline:none;text-decoration:none;" />')
    text = f'<div style="{TEXT_STYLE}">{shown}</div>' if config["text"] else ""
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;{background}">'
            f'<tr><td align="{config["align"]}" style="padding:{PADDING};text-align:{config["align"]};">{image}{text}</td></tr></table>')


# ---------------------------------------------------------------- drawing
def png(config: dict, value: str) -> bytes:
    key = "cep:code:" + hashlib.sha256(json.dumps([config, value], sort_keys=True).encode()).hexdigest()
    found = cache.get(key)
    if found:
        return found
    data = _qr(config, value) if config["kind"] == "qr" else _barcode(config, value)
    cache.set(key, data, CACHE_SECONDS)
    return data


def _barcode(config: dict, value: str) -> bytes:
    """Bars drawn one pixel per module, then widened by a whole number of pixels: never resampled, so every bar
    stays pure black on pure white, which is what a scanner reads."""
    import barcode as barcode_lib
    from PIL import Image

    width, height = config["width"] * SCALE, config["height"] * SCALE
    fmt = config["format"]
    options = {"code39": {"add_checksum": False}}.get(fmt, {})
    text = value.upper() if fmt == "code39" else value
    if fmt in ("ean13", "upca"):
        text = text[: {"ean13": 12, "upca": 11}[fmt]]             # the library adds the check digit itself
    pattern = "".join(barcode_lib.get(fmt, text, options=options).build())    # "1" a black module, "0" a white one
    margin = 12 * SCALE                                            # a white quiet zone that dark mode cannot eat into
    per_module = max(1, (width - 2 * margin) // len(pattern))
    bar_height = height - margin                                   # half the margin above and below
    canvas = Image.new("L", (max(width, len(pattern) * per_module + 2 * margin), height), 255)
    left = (canvas.width - len(pattern) * per_module) // 2
    for index, module in enumerate(pattern):
        if module == "1":
            canvas.paste(0, (left + index * per_module, margin // 2, left + (index + 1) * per_module, margin // 2 + bar_height))
    if canvas.width != width:                                      # a value too long for the width: keep the bars, fit the frame
        canvas = canvas.resize((width, height), Image.Resampling.NEAREST)
    out = io.BytesIO()
    canvas.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _qr(config: dict, value: str) -> bytes:
    """Whole pixels a module, centred on the canvas: the quiet zone grows a little rather than the modules being stretched."""
    import segno
    from PIL import Image

    side = config["size"] * SCALE
    code = segno.make(value, error=config["ecc"].lower(), micro=False)
    modules = code.symbol_size(scale=1, border=4)[0]              # four modules of quiet zone, as the standard asks
    raw = io.BytesIO()
    code.save(raw, kind="png", scale=max(1, side // modules), border=4)
    raw.seek(0)
    drawn = Image.open(raw).convert("L")
    if drawn.width > side:                                         # more modules than pixels: a very long value at a small size
        drawn = drawn.resize((side, side), Image.Resampling.NEAREST)
    canvas = Image.new("L", (side, side), 255)
    canvas.paste(drawn, ((side - drawn.width) // 2, (side - drawn.height) // 2))
    out = io.BytesIO()
    canvas.save(out, format="PNG", optimize=True)
    return out.getvalue()
