"""Time-based one-time passwords (RFC 6238: what Google Authenticator, Microsoft Authenticator, 1Password ... implement).

No third-party dependency: TOTP is HMAC-SHA1 over a 30-second counter. The secret is stored encrypted
(app_user.mfa_secret_enc); recovery codes are stored as SHA-256 hashes and each works once; an accepted code's
time-step is remembered so the same six digits cannot be replayed inside their 30 seconds.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from django.conf import settings

from . import crypto

STEP, DIGITS, WINDOW = 30, 6, 1                           # accept the previous and next step: phones drift


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % 10 ** DIGITS).zfill(DIGITS)


def code_at(secret: str, at: float | None = None) -> str:
    return _code(secret, int((at or time.time()) // STEP))


def matching_counter(secret: str, code: str, at: float | None = None) -> int | None:
    code = (code or "").replace(" ", "")
    if not (code.isdigit() and len(code) == DIGITS):
        return None
    now = int((at or time.time()) // STEP)
    for counter in range(now - WINDOW, now + WINDOW + 1):
        if hmac.compare_digest(_code(secret, counter), code):
            return counter
    return None


def otpauth_uri(secret: str, email: str) -> str:
    issuer = settings.EMAIL_PRODUCT_NAME
    return f"otpauth://totp/{quote(issuer)}:{quote(email)}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={DIGITS}&period={STEP}"


def new_recovery_codes(count: int = 10) -> tuple[list[str], list[str]]:
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(count)]
    return codes, [_hash(code) for code in codes]


def _hash(code: str) -> str:
    return hashlib.sha256(code.strip().lower().encode()).hexdigest()


# ---- operations on a user ------------------------------------------------------------------------------------------
def begin(user) -> dict:
    """Stores a fresh, unconfirmed secret. MFA stays off until confirm() sees a valid code from the authenticator."""
    secret = new_secret()
    user.mfa_secret_enc = crypto.encrypt(secret)
    user.mfa_confirmed_at = None
    user.save(update_fields=["mfa_secret_enc", "mfa_confirmed_at"])
    return {"secret": secret, "otpauth_uri": otpauth_uri(secret, user.email)}


def confirm(user, code: str) -> list[str] | None:
    from django.utils import timezone
    secret = crypto.decrypt(user.mfa_secret_enc)
    counter = matching_counter(secret, code) if secret else None
    if counter is None:
        return None
    codes, hashes = new_recovery_codes()
    user.mfa_enabled, user.mfa_confirmed_at, user.mfa_recovery_hashes, user.mfa_last_counter = True, timezone.now(), hashes, counter
    user.save(update_fields=["mfa_enabled", "mfa_confirmed_at", "mfa_recovery_hashes", "mfa_last_counter"])
    return codes


def verify(user, code: str) -> bool:
    """A TOTP code (not replayable) or an unused recovery code (consumed)."""
    if not user.mfa_enabled or not user.mfa_secret_enc:
        return False
    counter = matching_counter(crypto.decrypt(user.mfa_secret_enc), code)
    if counter is not None:
        if user.mfa_last_counter is not None and counter <= user.mfa_last_counter:
            return False
        user.mfa_last_counter = counter
        user.save(update_fields=["mfa_last_counter"])
        return True
    hashed = _hash(code or "")
    if hashed in (user.mfa_recovery_hashes or []):
        user.mfa_recovery_hashes = [item for item in user.mfa_recovery_hashes if item != hashed]
        user.save(update_fields=["mfa_recovery_hashes"])
        return True
    return False


def disable(user) -> None:
    user.mfa_enabled, user.mfa_secret_enc, user.mfa_confirmed_at, user.mfa_recovery_hashes, user.mfa_last_counter = False, None, None, [], None
    user.save(update_fields=["mfa_enabled", "mfa_secret_enc", "mfa_confirmed_at", "mfa_recovery_hashes", "mfa_last_counter"])
