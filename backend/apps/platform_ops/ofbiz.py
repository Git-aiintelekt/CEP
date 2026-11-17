"""Single sign-on and single logout from OFBiz iCRM ("Open CEP" under Campaign).

OFBiz sends the token of iCRM's UtilCommon.getSSOToken, for both the launch and the logout: a Multipass token (token-app.jar,
see .multipass) sealed with TenantProperties `security` `common.site.key` and `common.api.key`. In CEP the workspace's
tenant_ofbiz_link row holds {"site_key", "api_key", "time_zone"}: the same two keys and the iCRM server's time zone.

getSSOToken's fields: user_login_id (-> claim sub), email, expires ("yyyy-MM-dd HH:mm" in iCRM time, common.token.expiry.min,
default 5 minutes), version, tenant_id (common.site.tenantId: not checked, since the keys already tie the token to this
workspace). It has no jti or audience: the link works until it expires, and the same token serves launch and logout.
Optional fields, checked when present: aud, exp, jti, party_id, next.

  link_for(...)   -> the workspace's keys and iCRM time zone, or None when "Open CEP" is off for it

  verify(...)     -> the token's claims, or OfbizError with a sentence for the login page
  find_user(...)  -> the active CEP user of this workspace with the token's email (never created here)
  hand_off(...)   -> a one-time code the /launch page exchanges for the tokens with take(...); no browser binding, since
                     the sign-in starts in OFBiz, not in a CEP tab
  sign_out(...)   -> the user signed out of OFBiz: every CEP session opened from OFBiz before now ends
  signed_out(...) -> is this token from an OFBiz launch the user has since signed out of?

A session opened from OFBiz carries the claim `ofbiz` (the launch time), lives at most SESSION from the launch, and skips
CEP's MFA: OFBiz has already signed the user in. The cache must be the shared Redis cache, so every worker sees a logout.
"""
import json
import logging
import secrets
import time
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.cache import cache
from rest_framework.exceptions import AuthenticationFailed

from . import crypto
from .multipass import decoded_json, is_valid_token

log = logging.getLogger(__name__)

LAUNCH_AUDIENCE = "cep"
LOGOUT_AUDIENCE = "cep-logout"
REQUIRED_FIELDS = ["user_login_id", "email"]
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


def _stored_keys(tenant_id) -> str | None:
    """The seed puts the keys in as plain text (SQL cannot encrypt with the application key): encrypt them on first read."""
    from .models import TenantOfbizLink
    link = TenantOfbizLink.objects.filter(tenant_id=tenant_id, is_active=True).first()
    if link is None or not link.secret_enc:
        return None
    if not link.secret_enc.startswith(SEALED_PREFIX):
        plain = link.secret_enc.strip()
        TenantOfbizLink.objects.filter(tenant_id=tenant_id, secret_enc=link.secret_enc).update(secret_enc=crypto.encrypt(plain))
        return plain
    return crypto.decrypt(link.secret_enc)


def link_for(tenant_id) -> dict | None:
    stored = _stored_keys(tenant_id)
    if not stored:
        return None
    try:
        link = json.loads(stored)
        site_key, api_key, time_zone = (str(link[name]).strip() for name in ("site_key", "api_key", "time_zone"))
        ZoneInfo(time_zone)
    except (ValueError, TypeError, KeyError, ZoneInfoNotFoundError):
        log.warning("tenant_ofbiz_link of %s does not hold {\"site_key\", \"api_key\", \"time_zone\"}: run database/ofbiz_sso_seed.sql",
                    tenant_id)
        return None
    if not (site_key and api_key):
        return None
    return {"site_key": site_key, "api_key": api_key, "time_zone": time_zone}


def verify(token: str, audience: str, tenant: dict) -> dict:
    """`tenant` is request.tenant: its id finds the keys."""
    link = link_for(tenant["id"])
    if not link:
        raise OfbizError("Signing in from OFBiz is not set up. Ask your administrator.")
    data = decoded_json(link["site_key"], link["api_key"], token)
    if (not data or any(data.get(field) in (None, "") for field in REQUIRED_FIELDS) or data.get("aud", audience) != audience
            or not is_valid_token(data, leeway=LEEWAY, time_zone=link["time_zone"])):
        raise OfbizError(INVALID_LINK)
    if data.get("jti") and not cache.add(f"cep:ofbiz:jti:{data['jti']}", 1, JTI_TTL):
        raise OfbizError(USED_LINK)
    return {**data, "sub": str(data["user_login_id"]), "tenant": tenant["code"], "party_id": str(data.get("party_id") or ""),
            "email": str(data["email"]).strip().lower()}


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
