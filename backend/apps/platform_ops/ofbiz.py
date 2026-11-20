"""Single sign-on and single logout from OFBiz iCRM ("Open CEP" under Campaign).

OFBiz sends the token of iCRM's UtilCommon.getSSOToken, for both the launch and the logout: a Multipass token (token-app.jar,
see .multipass) sealed with TenantProperties `security` `common.site.key` and `common.api.key`. In CEP the workspace's tenant row holds
them in the column sso_config = {"is_active", "frontend_url", "secret_enc"}: secret_enc is {"site_key", "api_key", "time_zone", "roles"} (the
same two keys, the iCRM server's time zone, and the role names), encrypted by the application. One iCRM system per workspace:
another system gets its own workspace (tenant row, code) and its own sso_config. frontend_url is the address this workspace's
CEP opens at (sign-on redirects land there); empty, the platform.frontend_url parameter applies.

getSSOToken's fields: user_login_id (-> claim sub), email, expires ("yyyy-MM-dd HH:mm" in iCRM time, common.token.expiry.min,
default 5 minutes), version, tenant_id (common.site.tenantId: not checked, since the keys already tie the token to this
workspace). It has no jti or audience: the link works until it expires, and the same token serves launch and logout.
Optional fields, checked when present: aud, exp, jti, party_id, next.
"Open CEP" sends getCepSSOToken's token: the same, plus cep_role (the user's iCRM CEP security group: MARKETING_ADMIN,
CAMPAIGN_MANAGER or ANALYST) and display_name. iCRM owns the login and the role; CEP keeps only the email, name and role.

  link_for(...)   -> the workspace's keys, iCRM time zone and roles, or None when "Open CEP" is off for it
  frontend_url(.) -> the address the workspace's sign-on redirects go to

  verify(...)     -> the token's claims, or OfbizError with a sentence for the login page
  find_user(...)  -> the active CEP user of this workspace with the token's email (logout: never created)
  provision(...)  -> launch: that user, created on the first visit (no password), with exactly the role iCRM sent
  hand_off(...)   -> a one-time code the /launch page exchanges for the tokens with take(...); no browser binding, since
                     the sign-in starts in OFBiz, not in a CEP tab
  sign_out(...)   -> the user signed out of OFBiz: every CEP session opened from OFBiz before now ends
  signed_out(...) -> is this token from an OFBiz launch the user has since signed out of?

A session opened from OFBiz carries the claim `ofbiz` (the launch time), lives at most SESSION from the launch, and skips
CEP's MFA: OFBiz has already signed the user in. The cache must be the shared Redis cache, so every worker sees a logout.
"""
import json
import logging
import re
import secrets
import time
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db import connections, router
from django.core.cache import cache
from rest_framework.exceptions import AuthenticationFailed

from . import crypto, params
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
COLUMN = "sso_config"
# cep_role -> CEP role name; the workspace's "roles": {code: role name} adds to it or renames
DEFAULT_ROLES = {"MARKETING_ADMIN": "Marketing Admin", "CAMPAIGN_MANAGER": "Campaign Manager", "ANALYST": "Analyst"}
FRONTEND_URL = re.compile(r"^https?://[^/\s]+$")             # the address only: no path, no trailing slash
SEALED_PREFIX = "gAAAAA"                                    # every Fernet token starts so; a secret seeded by SQL does not

INVALID_LINK = "This link is invalid or has expired. Open CEP again from OFBiz."
USED_LINK = "This link was already used. Open CEP again from OFBiz."
NO_ROLE = "You don't have a CEP role in iCRM. Ask your administrator to give you one, then open CEP again."


class OfbizError(Exception):
    """Carries a message that is safe to show on the login page."""


class OfbizSignedOut(AuthenticationFailed):
    """401 titled exactly "Ofbiz Signed Out": the frontend does not retry it with a refresh."""
    default_detail = "Ofbiz Signed Out"
    default_code = "ofbiz_signed_out"


def signed_out_error() -> OfbizSignedOut:
    return OfbizSignedOut("You signed out of OFBiz. Open CEP again from OFBiz.")


def _opened(tenant_id, secret: str) -> str:
    """The seed puts the keys in as plain text (SQL cannot encrypt with the application key): encrypt them on first read."""
    from apps.tenants.models import Tenant
    if secret.startswith(SEALED_PREFIX):
        return crypto.decrypt(secret)
    with connections[router.db_for_write(Tenant)].cursor() as cursor:
        cursor.execute(f"UPDATE tenant SET {COLUMN} = jsonb_set({COLUMN}, '{{secret_enc}}', to_jsonb(%s::text)) "
                       f"WHERE id = %s AND {COLUMN} ->> 'secret_enc' = %s",
                       [crypto.encrypt(secret.strip()), str(tenant_id), secret])
    return secret.strip()


def link_for(tenant_id) -> dict | None:
    from apps.tenants.models import Tenant
    config = Tenant.objects.filter(pk=tenant_id).values_list(COLUMN, flat=True).first()
    if not isinstance(config, dict) or config.get("is_active") is False or not config.get("secret_enc"):
        return None
    try:
        stored = json.loads(_opened(tenant_id, str(config["secret_enc"])))
        site_key, api_key, time_zone = (str(stored[field]).strip() for field in ("site_key", "api_key", "time_zone"))
        ZoneInfo(time_zone)
        roles = stored.get("roles") or {}
    except (ValueError, TypeError, KeyError, ZoneInfoNotFoundError):
        log.warning("tenant.%s of %s does not hold {\"site_key\", \"api_key\", \"time_zone\"}: run database/ofbiz_sso_seed.sql",
                    COLUMN, tenant_id)
        return None
    if not (site_key and api_key) or not isinstance(roles, dict):
        return None
    return {"site_key": site_key, "api_key": api_key, "time_zone": time_zone,
            "roles": {**DEFAULT_ROLES, **{str(code).strip().upper(): str(role).strip() for code, role in roles.items()}}}


def frontend_url(tenant_id) -> str:
    """sso_config.frontend_url of the workspace, else the platform.frontend_url parameter (one address for every workspace)."""
    from apps.tenants.models import Tenant
    config = Tenant.objects.filter(pk=tenant_id).values_list(COLUMN, flat=True).first() if tenant_id else None
    url = str(config.get("frontend_url") or "").strip().rstrip("/") if isinstance(config, dict) else ""
    return url if FRONTEND_URL.match(url) else params.frontend_url()


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
            "email": str(data["email"]).strip().lower(), "cep_role": str(data.get("cep_role") or "").strip().upper(),
            "display_name": " ".join(str(data.get("display_name") or "").split()), "roles": link["roles"]}


def find_user(email: str, tenant_id):
    from apps.identity.models import AppUser
    return AppUser.objects.filter(tenant_id=tenant_id, email__iexact=email, is_active=True, deleted_at__isnull=True).first()


def provision(claims: dict, tenant_id):
    """Launch only, inside the request's tenant transaction (row-level security). iCRM decides who may use CEP and as what:
    no role, no entry; the user is created on the first visit and their roles are set to the one iCRM sent every time."""
    from django.db import IntegrityError, transaction

    from apps.identity.models import AppUser, Role, UserRole
    if not claims["cep_role"]:
        raise OfbizError(NO_ROLE)
    role_name = claims["roles"].get(claims["cep_role"])
    role = Role.objects.filter(tenant_id=tenant_id, name__iexact=role_name or "", deleted_at__isnull=True).first()
    if role is None:
        log.warning("OFBiz sign-in: CEP role %r (%s) does not exist in workspace %s", role_name, claims["cep_role"], tenant_id)
        raise OfbizError(f"Your iCRM role {claims['cep_role']} has no matching role in this CEP workspace. Ask your administrator.")

    user = AppUser.objects.filter(tenant_id=tenant_id, email__iexact=claims["email"]).first()      # a deleted one too: it stays out
    if user is None:
        name = claims["display_name"] or claims["email"].split("@")[0]
        try:
            with transaction.atomic():                     # savepoint: the email may belong to another workspace, hidden by RLS
                user = AppUser.objects.create(tenant_id=tenant_id, email=claims["email"], display_name=name[:200],
                                              auth_provider="LOCAL", password=None, is_active=True)
        except IntegrityError:
            raise OfbizError(f"{claims['email']} is already used in another CEP workspace. Ask your administrator.") from None
        log.info("OFBiz sign-in: created CEP user %s for OFBiz login %s", user.pk, claims["sub"])
    if not user.is_active or user.deleted_at is not None:
        raise OfbizError("Your CEP account is deactivated. Ask your administrator.")

    UserRole.objects.filter(user=user).exclude(role=role).delete()
    UserRole.objects.get_or_create(user=user, role=role)
    return user


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


# Platform administrators view and edit every workspace's sso_config (Settings -> Security -> "Open CEP" Keys).
# Read and written on the platform connection, since the workspace chosen is usually not the administrator's own.

def _platform_rows(sql: str, args=()) -> list[dict]:
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute(sql, args)
        if cursor.description is None:
            return []
        names = [c[0] for c in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


def config_workspaces() -> list[dict]:
    rows = _platform_rows(f"SELECT code, name, ({COLUMN} ->> 'secret_enc') IS NOT NULL AS configured FROM tenant "
                          "WHERE deleted_at IS NULL ORDER BY code")
    return [{"code": r["code"], "name": r["name"], "configured": bool(r["configured"])} for r in rows]


def read_config(code: str) -> dict | None:
    """The workspace's sso_config with secret_enc opened:
    {code, name, is_active, frontend_url, site_key, api_key, time_zone, roles, encrypted, problem}."""
    rows = _platform_rows(f"SELECT code, name, {COLUMN} AS config FROM tenant WHERE code = %s AND deleted_at IS NULL", [code])
    if not rows:
        return None
    config = rows[0]["config"] if isinstance(rows[0]["config"], dict) else json.loads(rows[0]["config"] or "{}")
    answer = {"code": rows[0]["code"], "name": rows[0]["name"], "is_active": config.get("is_active") is not False,
              "frontend_url": str(config.get("frontend_url") or ""), "site_key": "", "api_key": "", "time_zone": "", "roles": {}, "encrypted": False, "problem": None}
    secret = str(config.get("secret_enc") or "")
    if not secret:
        return answer
    try:
        answer["encrypted"] = secret.startswith(SEALED_PREFIX)
        stored = json.loads(crypto.decrypt(secret) if answer["encrypted"] else secret)
        answer.update(site_key=str(stored.get("site_key") or ""), api_key=str(stored.get("api_key") or ""),
                      time_zone=str(stored.get("time_zone") or ""), roles={str(k): str(v) for k, v in (stored.get("roles") or {}).items()})
    except (ValueError, TypeError, AttributeError) as exc:
        answer["problem"] = str(exc) if "FIELD_ENCRYPTION_KEY" in str(exc) else "The stored value is not valid JSON."
    return answer


def save_config(code: str, data: dict) -> dict:
    """Validates and stores {is_active, frontend_url, site_key, api_key, time_zone, roles}, the keys encrypted; returns field
    errors or {}. An empty frontend_url means the platform.frontend_url parameter."""
    errors, values = {}, {}
    for field in ("site_key", "api_key", "time_zone"):
        values[field] = str(data.get(field) or "").strip()
        if not values[field]:
            errors[field] = "Required."
    if values["time_zone"] and "time_zone" not in errors:
        try:
            ZoneInfo(values["time_zone"])
        except (ZoneInfoNotFoundError, ValueError):
            errors["time_zone"] = "Not a time zone, for example America/New_York."
    url = str(data.get("frontend_url") or "").strip().rstrip("/")
    if url and not FRONTEND_URL.match(url):
        errors["frontend_url"] = "The address only, such as https://cep.example.com (no path)."
    roles = data.get("roles") or {}
    if not isinstance(roles, dict) or any(not str(k).strip() or not str(v).strip() for k, v in roles.items()):
        errors["roles"] = "Every role needs an iCRM code and a CEP role name."
    if errors:
        return errors
    sealed = crypto.encrypt(json.dumps({**values, "roles": {str(k).strip().upper(): str(v).strip() for k, v in roles.items()}}))
    config = json.dumps({"is_active": bool(data.get("is_active", True)), "frontend_url": url, "secret_enc": sealed})
    _platform_rows(f"UPDATE tenant SET {COLUMN} = COALESCE({COLUMN}, '{{}}'::jsonb) || %s::jsonb WHERE code = %s AND deleted_at IS NULL", [config, code])
    log.info("tenant.%s of %s changed by a platform administrator", COLUMN, code)
    return {}
