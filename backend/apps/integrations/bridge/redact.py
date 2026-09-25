"""What never reaches the integration log: credentials in headers, card numbers in bodies. Everything else is kept as it
was sent, because that is what makes the log useful for debugging. Bodies are capped; a capped body keeps its start
and a digest of the whole, so a payload can still be matched to what a store or a provider says it sent."""
import hashlib
import json
import re

SECRET_HEADERS = {"authorization", "x-server-api-key", "x-api-key", "x-signature", "x-postal-signature", "cookie", "set-cookie", "proxy-authorization",
                  "x-auth-token", "api-key", "apikey"}
MASK = "***"

# 13-19 digits with optional spaces or dashes between groups: what a card number looks like once it is in a payload.
# Luhn is checked so an order number or a phone number of the same length is left alone.
CARD = re.compile(r"(?<![0-9])(?:[0-9][ -]?){12,18}[0-9](?![0-9])")
CARD_FIELDS = re.compile(r"\"(card_number|cardnumber|card_no|pan|primary_account_number|cvv|cvc|cvv2|card_cvv|security_code)\"\s*:\s*\"([^\"]*)\"", re.I)


def luhn_ok(digits: str) -> bool:
    total, alternate = 0, False
    for ch in reversed(digits):
        n = ord(ch) - 48
        if alternate:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alternate = not alternate
    return total % 10 == 0


def _mask_card(match: re.Match) -> str:
    raw = match.group(0)
    digits = re.sub(r"[ -]", "", raw)
    if not luhn_ok(digits):
        return raw
    return MASK + digits[-4:]                              # the last four stay: that is how a receipt names the card


def mask_cards(text: str) -> str:
    text = CARD_FIELDS.sub(lambda m: f'"{m.group(1)}": "{MASK}"', text)
    return CARD.sub(_mask_card, text)


def headers(raw: dict | None) -> dict:
    """Header names lower-cased, secrets replaced, everything else kept."""
    out = {}
    for name, value in (raw or {}).items():
        key = str(name).lower()
        out[key] = MASK if key in SECRET_HEADERS else str(value)
    return out


def body(raw, max_bytes: int) -> tuple[str | None, int]:
    """(text to store, size in bytes of the original). None when there was no body."""
    if raw is None:
        return None, 0
    if isinstance(raw, (bytes, bytearray)):
        size = len(raw)
        text = bytes(raw).decode("utf-8", errors="replace")
    elif isinstance(raw, str):
        text = raw
        size = len(raw.encode("utf-8", errors="replace"))
    else:
        try:
            text = json.dumps(raw, default=str)
        except (TypeError, ValueError):
            text = str(raw)
        size = len(text.encode("utf-8", errors="replace"))
    text = mask_cards(text)
    if max_bytes and size > max_bytes:
        digest = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
        text = text.encode("utf-8", errors="replace")[:max_bytes].decode("utf-8", errors="ignore") + f"\n… [truncated: {size} bytes, sha256 {digest}]"
    return text, size
