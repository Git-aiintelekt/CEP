"""How long a one-time password link lives: the global parameter security.password_link_hours.

Django's token generator only knows settings.PASSWORD_RESET_TIMEOUT, read at check time. That setting stays as the hard
ceiling; the parameter (changeable in the back-office without a deployment) is the effective lifetime below it."""
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import base36_to_int

from . import params

CEILING_HOURS = settings.PASSWORD_RESET_TIMEOUT // 3600


def password_link(user) -> str:
    """The one-time set-password address for a user, as the back-office and onboarding send it."""
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode
    return (f"{settings.FRONTEND_URL.rstrip('/')}/set-password?tenant={user.tenant.code}"
            f"&uid={urlsafe_base64_encode(force_bytes(user.pk))}&token={default_token_generator.make_token(user)}")


def hours() -> int:
    try:
        wanted = int(params.get("security.password_link_hours", 72))
    except (TypeError, ValueError):
        wanted = 72
    return max(1, min(wanted, CEILING_HOURS))


def check(user, token: str) -> bool:
    """Valid for Django (unused, user unchanged since, under the ceiling) AND younger than the parameter allows."""
    if not default_token_generator.check_token(user, token):
        return False
    try:
        issued = base36_to_int(token.split("-")[0])
    except ValueError:
        return False
    age = default_token_generator._num_seconds(default_token_generator._now()) - issued
    return age <= hours() * 3600
