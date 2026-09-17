"""Sign-in and account security.

  POST /auth/token/                 password sign-in. Answers tokens, OR {mfa_required, mfa_token}, OR 403 sso_required
  POST /auth/mfa/verify/            second step: mfa_token + code -> tokens
  GET  /auth/mfa/  POST setup|confirm|disable     a user's own authenticator enrolment
  GET  /auth/options/               public: does this workspace use SSO / require MFA (drives the login page)
  GET  /auth/sso/start/  /callback/ OpenID Connect
  POST /auth/support-session/end/   platform staff ends a "sign in as" session early

CepJWTAuthentication is where the two restricted kinds of token are enforced, for every endpoint at once:
  * a support session (claim `imp`) is read-only unless opened for writing, never touches users / roles / keys /
    security, and dies the moment it is ended or expires;
  * a user who must enrol MFA first (claim `mfa_setup`) can reach only the enrolment endpoints and /me.
"""
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import authenticate
from django.core.signing import BadSignature, TimestampSigner
from django.db import connections
from django.http import HttpResponseRedirect
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.identity.models import AppUser
from apps.platform_ops import mfa, params, sso
from apps.platform_ops.models import SupportAccessLog, TenantIdentityProvider
from apps.tenants.models import Tenant

mfa_signer = TimestampSigner(salt="cep.mfa.pending")


# ------------------------------------------------------------------------------------------------------------ policy
def tenant_requires_mfa(tenant_id) -> bool:
    settings_json = Tenant.objects.filter(pk=tenant_id).values_list("settings", flat=True).first() or {}
    return bool((settings_json.get("security") or {}).get("require_mfa"))


def mfa_required_for(user) -> bool:
    return tenant_requires_mfa(user.tenant_id) or (user.is_staff and bool(params.get("security.mfa_required_for_staff", True)))


def identity_provider(tenant_id):
    return TenantIdentityProvider.objects.filter(tenant_id=tenant_id, is_active=True).first()


def issue_tokens(user, *, mfa_setup: bool = False) -> dict:
    refresh = RefreshToken.for_user(user)
    if mfa_setup:
        refresh["mfa_setup"] = True                        # copied into every access token made from this refresh token
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    return {"access": str(refresh.access_token), "refresh": str(refresh), "mfa_setup_required": mfa_setup}


class LoginThrottle(AnonRateThrottle):
    rate = "20/min"


# ------------------------------------------------------------------------------------------------------------ password sign-in
class PublicAuthView(APIView):
    """No authenticators run here, and DRF turns AuthenticationFailed into 403 when none can name a challenge: keep it 401."""
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get_authenticate_header(self, request):
        return 'Bearer realm="api"'


class LoginView(PublicAuthView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(request=inline_serializer("Login", {"email": serializers.EmailField(), "password": serializers.CharField()}),
                   responses=inline_serializer("LoginResult", {"access": serializers.CharField(required=False), "refresh": serializers.CharField(required=False),
                                                               "mfa_required": serializers.BooleanField(required=False), "mfa_token": serializers.CharField(required=False),
                                                               "mfa_setup_required": serializers.BooleanField(required=False)}))
    def post(self, request, version=None):
        email, password = str(request.data.get("email") or "").strip().lower(), str(request.data.get("password") or "")
        user = authenticate(request, email=email, password=password) if email and password else None
        if user is None or not user.is_active or str(user.tenant_id) != str(request.tenant["id"]):
            raise AuthenticationFailed("No active account found with the given credentials")

        provider = identity_provider(user.tenant_id)
        if provider and provider.enforce_sso and not user.has_perm("user.admin"):
            # administrators keep a password as break-glass access for the day the identity provider is down
            raise PermissionDenied({"code": "sso_required", "detail": f"This workspace signs in with {provider.display_name}."})

        if user.mfa_enabled:
            return Response({"mfa_required": True, "mfa_token": mfa_signer.sign(str(user.pk))})
        return Response(issue_tokens(user, mfa_setup=mfa_required_for(user)))


class MfaVerifyView(PublicAuthView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(request=inline_serializer("MfaVerify", {"mfa_token": serializers.CharField(), "code": serializers.CharField()}), responses={200: None})
    def post(self, request, version=None):
        try:
            user_id = mfa_signer.unsign(str(request.data.get("mfa_token") or ""), max_age=300)
        except BadSignature:
            raise AuthenticationFailed("The sign-in took too long. Enter your password again.") from None
        user = AppUser.objects.filter(pk=user_id, is_active=True, deleted_at__isnull=True).first()
        if user is None or not mfa.verify(user, str(request.data.get("code") or "")):
            raise AuthenticationFailed("That code is not right. Codes change every 30 seconds; a recovery code works once.")
        return Response(issue_tokens(user))


# ------------------------------------------------------------------------------------------------------------ MFA enrolment
class MfaView(APIView):
    """GET status. POST {action: setup | confirm | disable}."""
    permission_classes = [IsAuthenticated]

    def _own_user(self, request):
        if hasattr(request.user, "has_scope"):
            raise PermissionDenied("API keys do not have multi-factor authentication.")
        return AppUser.objects.get(pk=request.user.pk)

    @extend_schema(responses=inline_serializer("MfaStatus", {"enabled": serializers.BooleanField(), "required": serializers.BooleanField(),
                                                              "recovery_codes_left": serializers.IntegerField(), "sso": serializers.BooleanField()}))
    def get(self, request, version=None):
        user = self._own_user(request)
        return Response({"enabled": user.mfa_enabled, "required": mfa_required_for(user), "recovery_codes_left": len(user.mfa_recovery_hashes or []),
                         "sso": user.auth_provider != "LOCAL", "confirmed_at": user.mfa_confirmed_at})

    @extend_schema(request=inline_serializer("MfaAction", {"action": serializers.ChoiceField(choices=["setup", "confirm", "disable"]),
                                                           "code": serializers.CharField(required=False)}), responses={200: None})
    def post(self, request, version=None):
        user, action, code = self._own_user(request), request.data.get("action"), str(request.data.get("code") or "")
        if action == "setup":
            if user.mfa_enabled:
                raise ValidationError({"action": "Multi-factor authentication is already on. Turn it off first to enrol a new device."})
            return Response(mfa.begin(user))
        if action == "confirm":
            codes = mfa.confirm(user, code)
            if codes is None:
                raise ValidationError({"code": "That code is not right. Check the time on your phone and try the next code."})
            return Response({"enabled": True, "recovery_codes": codes, **issue_tokens(user)})      # fresh tokens: no more mfa_setup restriction
        if action == "disable":
            if mfa_required_for(user):
                raise PermissionDenied("Your workspace requires multi-factor authentication: it cannot be turned off.")
            if not mfa.verify(user, code):
                raise ValidationError({"code": "Enter a current code from your authenticator to turn it off."})
            mfa.disable(user)
            return Response({"enabled": False})
        raise ValidationError({"action": "Use setup, confirm or disable."})


# ------------------------------------------------------------------------------------------------------------ login page options + SSO
class AuthOptionsView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    @extend_schema(responses=inline_serializer("AuthOptions", {"workspace": serializers.CharField(), "sso_enabled": serializers.BooleanField(),
                                                                "sso_enforced": serializers.BooleanField(), "sso_name": serializers.CharField(allow_null=True)}))
    def get(self, request, version=None):
        tenant_id = request.tenant["id"]
        provider = identity_provider(tenant_id) if params.enabled(tenant_id, "sso") else None
        return Response({"workspace": request.tenant["code"], "sso_enabled": provider is not None, "sso_enforced": bool(provider and provider.enforce_sso),
                         "sso_name": provider.display_name if provider else None, "mfa_required": tenant_requires_mfa(tenant_id)})


def _frontend(path: str, **fragment) -> HttpResponseRedirect:
    return HttpResponseRedirect(settings.FRONTEND_URL.rstrip("/") + path + ("#" + urlencode(fragment) if fragment else ""))


class SsoStartView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    @extend_schema(exclude=True)
    def get(self, request, version=None):
        provider = identity_provider(request.tenant["id"]) if params.enabled(request.tenant["id"], "sso") else None
        if provider is None:
            return _frontend("/login", sso_error="Single sign-on is not set up for this workspace.")
        try:
            return HttpResponseRedirect(sso.start(provider, request.tenant["code"], request.query_params.get("next") or "/"))
        except sso.SsoError as exc:
            return _frontend("/login", sso_error=str(exc))


class SsoCallbackView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    @extend_schema(exclude=True)
    def get(self, request, version=None):
        if request.query_params.get("error"):
            return _frontend("/login", sso_error=request.query_params.get("error_description") or "The identity provider cancelled the sign-in.")
        provider = identity_provider(request.tenant["id"])
        if provider is None:
            return _frontend("/login", sso_error="Single sign-on is not set up for this workspace.")
        try:
            identity = sso.complete(provider, request.query_params.get("state", ""), request.query_params.get("code", ""))
            user = sso.resolve_user(provider, identity)
        except sso.SsoError as exc:
            return _frontend("/login", sso_error=str(exc))
        # the identity provider owns the second factor for SSO users: the platform does not ask again
        tokens = issue_tokens(user)
        return _frontend("/sso/complete", access=tokens["access"], refresh=tokens["refresh"], tenant=request.tenant["code"], next=identity["next"])


class SupportSessionEndView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, version=None):
        session = getattr(getattr(request, "_request", request), "support_session", None)
        if session is None:
            raise ValidationError({"detail": "This is not a support session."})
        with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
            cursor.execute("UPDATE support_access_log SET ended_at = now() WHERE id = %s AND ended_at IS NULL", [str(session.pk)])
        return Response(status=204)
