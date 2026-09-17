"""Application-side encryption for the few secrets that must live in the database (TOTP secrets, IdP client secrets).

Key: FIELD_ENCRYPTION_KEY (a Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
Several keys separated by commas are accepted: the first encrypts, all decrypt, which is how a key is rotated.
Without one the key is derived from SECRET_KEY, so development works out of the box; production must set its own.
"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings


def _fernet() -> MultiFernet:
    configured = [key.strip() for key in (getattr(settings, "FIELD_ENCRYPTION_KEY", "") or "").split(",") if key.strip()]
    keys = configured or [base64.urlsafe_b64encode(hashlib.sha256(("cep-field:" + settings.SECRET_KEY).encode()).digest()).decode()]
    return MultiFernet([Fernet(key) for key in keys])


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        raise ValueError("A stored secret cannot be decrypted: FIELD_ENCRYPTION_KEY changed without keeping the old key.") from None


def uses_derived_key() -> bool:
    return not (getattr(settings, "FIELD_ENCRYPTION_KEY", "") or "").strip()
