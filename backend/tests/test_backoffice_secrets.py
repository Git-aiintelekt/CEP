"""No credential is listed, shown or edited in the back-office: every registered admin leaves out the encrypted (*_enc) and
hashed columns from its list, its form and its read-only fields. Nothing is opened or saved; the admins are asked directly."""
import pytest
from django.conf import settings
from django.contrib import admin
from django.test import RequestFactory

from apps.identity.models import AppUser

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS


def is_secret(name: str) -> bool:
    return name in ("password", "key_hash") or name.endswith("_enc")


def test_no_admin_shows_a_credential(check):
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if staff is None:
        pytest.skip("no platform administrator in this database")
    request = RequestFactory().get("/admin/")
    request.user = staff
    shown = {}
    for model, model_admin in admin.site._registry.items():
        secrets = [f.name for f in model._meta.concrete_fields if is_secret(f.name)]
        if not secrets:
            continue
        try:
            form_fields = set(model_admin.get_form(request, None).base_fields)
        except Exception:                                                     # noqa: BLE001  a form that needs a saved row
            form_fields = set()
        visible = form_fields | {str(name) for name in model_admin.get_list_display(request)} | {str(name) for name in model_admin.get_readonly_fields(request, None)}
        leaked = sorted(name for name in secrets if name in visible)
        shown[model._meta.label] = leaked
    check("there are admins of models with credentials to look at", len(shown) >= 3, sorted(shown))
    check("none of them lists, shows or edits a credential", not any(shown.values()), {label: names for label, names in shown.items() if names})
    check.done()
