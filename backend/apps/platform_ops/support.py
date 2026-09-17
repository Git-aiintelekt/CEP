"""Support access: platform staff acting as a tenant user, on the record.

Opened from the user's page in the back-office with a reason. It yields a short-lived ACCESS token only (no refresh):
read-only unless opened for writing, never able to manage users, roles, API keys or sign-in security (api.auth enforces
that for every endpoint). The tenant sees every session under Settings, and the user is emailed (parameter
security.notify_user_on_support_access).
"""
from datetime import timedelta
from urllib.parse import urlencode

from django import forms
from django.conf import settings
from django.contrib import messages
from django.shortcuts import redirect, render
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget

from . import mail, params
from .models import SupportAccessLog

P = settings.PLATFORM_ALIAS


class SupportSessionForm(forms.Form):
    reason = forms.CharField(min_length=5, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
                             help_text="Ticket number and what the customer asked for. The tenant's administrators can read this.")
    access_mode = forms.ChoiceField(choices=SupportAccessLog.Mode.choices, initial="READ", widget=UnfoldAdminSelectWidget,
                                    help_text="Read only unless the customer asked you to change something for them.")


def open_session(staff, target, reason: str, mode: str, ip: str | None = None) -> tuple[SupportAccessLog, str]:
    minutes = int(params.get("security.support_access_minutes", 30))
    expires = timezone.now() + timedelta(minutes=minutes)
    session = SupportAccessLog.objects.using(P).create(tenant_id=target.tenant_id, staff_user_id=staff.pk, target_user_id=target.pk, staff_name=staff.display_name,
                                                       reason=reason.strip(), access_mode=mode, expires_at=expires, ip_address=ip)
    token = AccessToken.for_user(target)
    token.set_exp(from_time=timezone.now(), lifetime=timedelta(minutes=minutes))
    token["imp"], token["imp_by"], token["imp_mode"] = str(session.pk), str(staff.pk), mode
    if params.get("security.notify_user_on_support_access", True):
        mail.send("support_access", target.email, subject="Support accessed your account", context={
            "name": target.display_name, "workspace": target.tenant.code, "staff": staff.display_name, "reason": reason.strip(),
            "mode": "read-only" if mode == "READ" else "read and write", "expires_at": expires})
    return session, str(token)


def admin_view(model_admin, request, object_id):
    from apps.identity.models import AppUser
    target = AppUser.objects.using(P).select_related("tenant").get(pk=object_id)
    back = redirect("admin:identity_appuser_change", object_id)
    if not request.user.is_platform_admin:
        messages.error(request, "Only platform administrators can open support sessions.")
        return back
    if not target.is_active or target.is_platform_admin or str(target.pk) == str(request.user.pk):
        messages.error(request, "Support sessions are for active tenant users other than yourself and other platform administrators.")
        return back
    form = SupportSessionForm(request.POST or None)
    link = None
    if request.method == "POST" and form.is_valid():
        session, token = open_session(request.user, target, form.cleaned_data["reason"], form.cleaned_data["access_mode"], request.META.get("REMOTE_ADDR"))
        link = settings.FRONTEND_URL.rstrip("/") + "/support-session#" + urlencode({"token": token, "tenant": target.tenant.code})
        messages.success(request, f"Support session opened until {session.expires_at:%H:%M} UTC. It is recorded and visible to the tenant.")
    context = {**model_admin.admin_site.each_context(request), "title": f"Sign in as {target.display_name}", "target": target, "form": form, "link": link,
               "minutes": int(params.get("security.support_access_minutes", 30)), "opts": model_admin.model._meta}
    return render(request, "admin/identity/support_session.html", context)
