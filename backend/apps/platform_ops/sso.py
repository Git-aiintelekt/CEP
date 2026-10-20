"""Single sign-on with OpenID Connect (authorization code flow + PKCE): Microsoft Entra ID, Okta, Google Workspace,
Auth0, Keycloak ... anything that publishes /.well-known/openid-configuration.

  start(...)     -> the identity provider's authorize URL (state and the PKCE verifier are kept server-side)
  complete(...)  -> the verified identity {sub, email, name} or SsoError
  resolve_user() -> the app_user that identity maps to: linked by subject, else by email, else created (JIT) if allowed
  hand_off(...)  -> a one-time code the browser exchanges for the tokens with take(...)

The sign-in is tied to the browser that started it: the login page keeps a random binding in the tab and sends it to
start(); the tokens are handed over only to a request that shows the same binding, so a link someone else started (theirs,
after their own sign-in) cannot sign this browser into their account.

The ID token's signature, issuer, audience, expiry and nonce are all checked; an email is only trusted when the provider
does not say it is unverified.
"""
import base64
import hashlib
import hmac
import secrets
from urllib.parse import urlencode

import jwt
import requests
from django.conf import settings
from django.core.cache import cache
from django.core.signing import BadSignature, TimestampSigner

from . import crypto, params

signer = TimestampSigner(salt="cep.sso.state")
TIMEOUT = 8
STATE_TTL = 600
HANDOFF_TTL = 120


class SsoError(Exception):
    """Carries a message that is safe to show on the login page."""


def redirect_uri() -> str:
    return params.public_api_url() + "/api/v1/auth/sso/callback/"


def discovery(issuer: str) -> dict:
    key = "cep:oidc:" + hashlib.sha256(issuer.encode()).hexdigest()
    document = cache.get(key)
    if document is None:
        try:
            response = requests.get(issuer.rstrip("/") + "/.well-known/openid-configuration", timeout=TIMEOUT)
            response.raise_for_status()
            document = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise SsoError("The identity provider cannot be reached. Try again, or ask your administrator to check the issuer address.") from exc
        if document.get("issuer", "").rstrip("/") != issuer.rstrip("/"):
            raise SsoError("The identity provider's configuration names a different issuer than the one configured.")
        cache.set(key, document, 3600)
    return document


def _digest(binding: str) -> str:
    return hashlib.sha256(binding.encode()).hexdigest()


def start(provider, tenant_code: str, next_path: str, binding: str) -> str:
    document = discovery(provider.issuer)
    nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    cache.set(f"cep:sso:{nonce}", {"verifier": verifier, "tenant": tenant_code, "next": next_path if next_path.startswith("/") else "/",
                                   "binding": _digest(binding)}, STATE_TTL)
    query = {"response_type": "code", "client_id": provider.client_id, "redirect_uri": redirect_uri(), "scope": provider.scopes,
             "state": signer.sign(f"{tenant_code}:{nonce}"), "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256"}
    return document["authorization_endpoint"] + "?" + urlencode(query)


def tenant_from_state(state: str) -> str | None:
    """Used by the tenant resolver: the callback URL is fixed, so the tenant travels in the signed state."""
    try:
        return signer.unsign(state or "", max_age=STATE_TTL).split(":", 1)[0]
    except BadSignature:
        return None


def complete(provider, state: str, code: str) -> dict:
    try:
        tenant_code, nonce = signer.unsign(state or "", max_age=STATE_TTL).split(":", 1)
    except (BadSignature, ValueError):
        raise SsoError("The sign-in took too long or was tampered with. Start again.") from None
    pending = cache.get(f"cep:sso:{nonce}")
    cache.delete(f"cep:sso:{nonce}")                        # one use
    if not pending or pending["tenant"] != tenant_code:
        raise SsoError("This sign-in was already used or has expired. Start again.")

    document = discovery(provider.issuer)
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(), "client_id": provider.client_id,
            "code_verifier": pending["verifier"]}
    secret = crypto.decrypt(provider.client_secret_enc)
    if secret:
        form["client_secret"] = secret
    try:
        response = requests.post(document["token_endpoint"], data=form, timeout=TIMEOUT)
        tokens = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise SsoError("The identity provider did not answer. Try again.") from exc
    if response.status_code != 200 or "id_token" not in tokens:
        raise SsoError(f"The identity provider refused the sign-in ({tokens.get('error_description') or tokens.get('error') or response.status_code}).")

    try:
        key = jwt.PyJWKClient(document["jwks_uri"], timeout=TIMEOUT).get_signing_key_from_jwt(tokens["id_token"]).key
        algorithms = [a for a in document.get("id_token_signing_alg_values_supported", ["RS256"]) if a != "none" and not a.startswith("HS")]
        claims = jwt.decode(tokens["id_token"], key, algorithms=algorithms or ["RS256"], audience=provider.client_id,
                            issuer=document["issuer"], options={"require": ["exp", "iat", "sub"]}, leeway=60)
    except jwt.PyJWTError as exc:
        raise SsoError(f"The identity provider's answer could not be verified ({exc.__class__.__name__}).") from exc
    if claims.get("nonce") != nonce:
        raise SsoError("The identity provider's answer does not belong to this sign-in.")

    email = (claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").strip().lower()
    if "@" not in email:
        raise SsoError("The identity provider did not share an email address. Ask your administrator to release the email claim.")
    if claims.get("email_verified") is False:
        raise SsoError("Your email address is not verified with the identity provider.")
    domains = [d.lower().lstrip("@") for d in (provider.allowed_email_domains or [])]
    if domains and email.rsplit("@", 1)[1] not in domains:
        raise SsoError("Your email domain is not allowed to sign in to this workspace.")
    return {"sub": str(claims["sub"]), "email": email, "name": (claims.get("name") or email.split("@")[0])[:200], "next": pending["next"],
            "binding": pending.get("binding")}


def hand_off(tokens: dict, tenant_code: str, identity: dict) -> str:
    code = secrets.token_urlsafe(24)
    cache.set(f"cep:sso:handoff:{code}", {"access": tokens["access"], "refresh": tokens["refresh"], "tenant": tenant_code,
                                          "next": identity["next"], "binding": identity["binding"]}, HANDOFF_TTL)
    return code


def take(code: str, binding: str, tenant_code: str) -> dict | None:
    """the tokens for a one-time code, only to the browser holding the binding that started the sign-in"""
    key = f"cep:sso:handoff:{code}"
    entry = cache.get(key)
    cache.delete(key)                                       # one use, right or wrong
    if not entry or not binding or entry["tenant"] != tenant_code or not hmac.compare_digest(entry["binding"] or "", _digest(binding)):
        return None
    return entry


def resolve_user(provider, identity: dict):
    """Inside the tenant's request transaction (RLS): returns the active user or raises SsoError."""
    from django.db import IntegrityError, transaction

    from apps.identity.models import AppUser, UserRole
    user = AppUser.objects.filter(auth_provider="OIDC", external_subject_id=identity["sub"], deleted_at__isnull=True).first()
    if user is None:
        user = AppUser.objects.filter(email__iexact=identity["email"], deleted_at__isnull=True).first()
        if user is not None:                               # first SSO sign-in of an existing account: link it
            user.auth_provider, user.external_subject_id = "OIDC", identity["sub"]
            user.save(update_fields=["auth_provider", "external_subject_id"])
    if user is None:
        if not provider.jit_provisioning:
            raise SsoError("You do not have an account in this workspace yet. Ask your administrator to add you.")
        try:
            with transaction.atomic():
                user = AppUser.objects.create(tenant_id=provider.tenant_id, email=identity["email"], display_name=identity["name"],
                                              auth_provider="OIDC", external_subject_id=identity["sub"], is_active=True)
        except IntegrityError:
            raise SsoError("This email address belongs to an account in another workspace.") from None
        if provider.default_role_id:
            UserRole.objects.create(user=user, role_id=provider.default_role_id)
    if not user.is_active:
        raise SsoError("Your account is deactivated. Ask your administrator.")
    return user
