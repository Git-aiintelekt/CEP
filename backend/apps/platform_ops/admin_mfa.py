"""Second factor for the back-office. Django Admin signs in with a session, not the API: once a staff member has enrolled
an authenticator (in the React app, Account security), every new admin session must pass it before any page opens."""
from django import forms
from django.conf import settings
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from unfold.widgets import UnfoldAdminTextInputWidget

from . import mfa

OPEN_PATHS = ("/admin/login/", "/admin/logout/", "/admin/mfa/", "/admin/jsi18n/")


class CodeForm(forms.Form):
    code = forms.CharField(label="Code from your authenticator", max_length=20,
                           widget=UnfoldAdminTextInputWidget(attrs={"autocomplete": "one-time-code", "inputmode": "numeric", "autofocus": True}))


class AdminMfaMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if (request.path.startswith("/admin/") and not request.path.startswith(OPEN_PATHS) and user is not None and user.is_authenticated
                and getattr(user, "mfa_enabled", False) and not request.session.get("cep_mfa_ok")):
            return redirect(f"/admin/mfa/?next={request.get_full_path()}")
        return self.get_response(request)


def verify_view(request):
    from django.contrib import admin
    from apps.identity.models import AppUser
    if not request.user.is_authenticated:
        return redirect("/admin/login/")
    form = CodeForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = AppUser.objects.using(settings.PLATFORM_ALIAS).get(pk=request.user.pk)
        if mfa.verify(user, form.cleaned_data["code"]):
            request.session["cep_mfa_ok"] = True
            target = request.GET.get("next") or "/admin/"
            return redirect(target if url_has_allowed_host_and_scheme(target, allowed_hosts={request.get_host()}) else "/admin/")
        form.add_error("code", "That code is not right. Codes change every 30 seconds; a recovery code works once.")
    return render(request, "admin/mfa.html", {**admin.site.each_context(request), "title": "Two-step verification", "form": form})
