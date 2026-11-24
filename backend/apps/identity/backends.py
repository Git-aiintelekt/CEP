"""Signing in when an account is Workspace ID + email (patch 0098; docs/mockups/same-user-workspaces.html, option A).

The same address may have an account in several workspaces (Staging and Production), each with its own password. A sign-in to a
workspace passes its id and finds the account there. The back-office sign-in names no workspace: it finds staff and platform
administrators only, who keep one address across the platform (a partial unique index in the database).
"""
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

from .models import AppUser


class WorkspaceBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, tenant_id=None, **kwargs):
        email = (username or kwargs.get("email") or "").strip()
        if not email or password is None:
            return None
        accounts = AppUser._default_manager.filter(email__iexact=email, deleted_at__isnull=True)
        accounts = accounts.filter(tenant_id=tenant_id) if tenant_id else accounts.filter(Q(is_staff=True) | Q(is_platform_admin=True))
        user = accounts.first()
        if user is None:
            AppUser().set_password(password)                  # the same work as a real check: the answer's timing says nothing
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
