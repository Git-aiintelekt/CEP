"""Single sign-on and single logout from OFBiz iCRM ("Open CEP" under Campaign).

OFBiz signs short HS256 tokens with the secret it shares with CEP (OFBiz TenantProperties `cep.sso.secret`; in CEP the
workspace's tenant_ofbiz_link row), issuer "ofbiz-icrm", valid 60 seconds, each `jti` usable once:

  secret_for(...) -> the workspace's secret, or None when "Open CEP" is off for it

  verify(...)     -> the token's claims, or OfbizError with a sentence for the login page
  find_user(...)  -> the active CEP user of this workspace with the token's email (never created here)
  hand_off(...)   -> a one-time code the /launch page exchanges for the tokens with take(...); no browser binding, since
                     the sign-in starts in OFBiz, not in a CEP tab
  sign_out(...)   -> the user signed out of OFBiz: every CEP session opened from OFBiz before now ends
  signed_out(...) -> is this token from an OFBiz launch the user has since signed out of?

A session opened from OFBiz carries the claim `ofbiz` (the launch time), lives at most SESSION from the launch, and skips
CEP's MFA: OFBiz has already signed the user in. The cache must be the shared Redis cache, so every worker sees a logout.
"""
import secrets
import time
from datetime import timedelta

import jwt
from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import AuthenticationFailed

from . import crypto

ISSUER = "ofbiz-icrm"
LAUNCH_AUDIENCE = "cep"
LOGOUT_AUDIENCE = "cep-logout"
REQUIRED_CLAIMS = ["exp", "iat", "jti", "sub", "party_id", "email", "tenant"]
LEEWAY = 30
JTI_TTL = 120
HANDOFF_TTL = 120
SESSION = timedelta(hours=8)
DEFAULT_NEXT = "/campaigns"
SEALED_PREFIX = "gAAAAA"                                    # every Fernet token starts so; a secret seeded by SQL does not

INVALID_LINK = "This link is invalid or has expired. Open CEP again from OFBiz."
USED_LINK = "This link was already used. Open CEP again from OFBiz."


class OfbizError(Exception):
    """Carries a message that is safe to show on the login page."""


class OfbizSignedOut(AuthenticationFailed):
    """401 titled exactly "Ofbiz Signed Out": the frontend does not retry it with a refresh."""
    default_detail = "Ofbiz Signed Out"
    default_code = "ofbiz_signed_out"


def signed_out_error() -> OfbizSignedOut:
    return OfbizSignedOut("You signed out of OFBiz. Open CEP again from OFBiz.")


def secret_for(tenant_id) -> str | None:
    """The seed puts the secret in as plain text (SQL cannot encrypt with the application key): encrypt it on first read."""
    from .models import TenantOfbizLink
    link = TenantOfbizLink.objects.filter(tenant_id=tenant_id, is_active=True).first()
    if link is None or not link.secret_enc:
        return None
    if not link.secret_enc.startswith(SEALED_PREFIX):
        plain = link.secret_enc.strip()
        TenantOfbizLink.objects.filter(tenant_id=tenant_id, secret_enc=link.secret_enc).update(secret_enc=crypto.encrypt(plain))
        return plain
    return crypto.decrypt(link.secret_enc)


def verify(token: str, audience: str, tenant: dict) -> dict:
    """`tenant` is request.tenant: its id finds the secret, its code must be the token's `tenant`."""
    secret = secret_for(tenant["id"])
    if not secret:
        raise OfbizError("Signing in from OFBiz is not set up. Ask your administrator.")
    tenant_code = tenant["code"]
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], audience=audience, issuer=ISSUER, leeway=LEEWAY,
                            options={"require": REQUIRED_CLAIMS})
    except jwt.PyJWTError:
        raise OfbizError(INVALID_LINK) from None
    if str(claims["tenant"]).strip().upper() != tenant_code.upper():
        raise OfbizError(INVALID_LINK)
    if not cache.add(f"cep:ofbiz:jti:{claims['jti']}", 1, JTI_TTL):
        raise OfbizError(USED_LINK)
    claims["email"] = str(claims["email"]).strip().lower()
    return claims


def find_user(email: str, tenant_id):
    from apps.identity.models import AppUser
    return AppUser.objects.filter(tenant_id=tenant_id, email__iexact=email, is_active=True, deleted_at__isnull=True).first()


def safe_next(next_path) -> str:
    path = str(next_path or "")
    return path if path.startswith("/") and not path.startswith("//") else DEFAULT_NEXT


def hand_off(tokens: dict, tenant_code: str, next_path) -> str:
    code = secrets.token_urlsafe(24)
    cache.set(f"cep:ofbiz:handoff:{code}", {"access": tokens["access"], "refresh": tokens["refresh"], "tenant": tenant_code,
                                            "next": safe_next(next_path)}, HANDOFF_TTL)
    return code


def take(code: str, tenant_code: str) -> dict | None:
    key = f"cep:ofbiz:handoff:{code}"
    entry = cache.get(key)
    cache.delete(key)                                       # one use, right or wrong
    if not code or not entry or entry["tenant"] != tenant_code:
        return None
    return entry


def launch_time() -> float:
    """milliseconds matter: a launch right after a logout, in the same second, must survive it"""
    return round(time.time(), 3)


def session_end(token) -> int:
    return int(token["ofbiz"] + SESSION.total_seconds())


def _cutoff_key(user_id) -> str:
    return f"cep:ofbiz:logout:{user_id}"


def sign_out(user_id) -> None:
    cache.set(_cutoff_key(user_id), time.time(), int(SESSION.total_seconds()) + JTI_TTL)


def signed_out(token) -> bool:
    launched = token.get("ofbiz")
    if not launched:
        return False                                        # password and OpenID Connect sign-ins are never affected
    cutoff = cache.get(_cutoff_key(token.get(settings.SIMPLE_JWT.get("USER_ID_CLAIM", "user_id"))))
    return cutoff is not None and launched <= cutoff
