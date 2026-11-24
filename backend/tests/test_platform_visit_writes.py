"""Switch Workspace, writing (found on .68, 24 Nov 2026): a platform administrator visiting a workspace creates a campaign owned by
themselves and uploads a list. Their app_user row belongs to their own workspace, so the visited workspace's row-level security
hides it: the owner was refused ("Choose an active user of this workspace", 400) and the upload failed after it was stored (500,
reading the uploader's name through record.created_by). Names now come by id through apps.identity.names, and a visitor may own
what they create.

The visitor is made inside the test's rolled-back transaction on the platform connection, so nothing here writes a row that
points at them from the workspace's connection (that insert would wait for the platform transaction forever). Rolled back."""
from types import SimpleNamespace

import pytest
from django.conf import settings
from django.db import connections
from rest_framework import serializers

from api.v1.campaigns_api import CampaignSerializer
from apps.campaigns.models import Campaign
from apps.contact_lists.models import ContactListImport
from apps.identity import names
from apps.identity.models import AppUser
from apps.tenants import context

from .test_platform_visits import _platform_admin

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _in_workspace(tenant_id):
    token = context.set_current(str(tenant_id), "default")
    with connections["default"].cursor() as cursor:
        cursor.execute("SELECT set_config('app.current_tenant', %s, false)", [str(tenant_id)])
    return token


def test_a_visitor_s_name_and_ownership(check, admin_email):
    staff = _platform_admin()
    token = context.set_platform(True)
    member = AppUser.objects.using(settings.PLATFORM_ALIAS).get(email=admin_email)
    context.reset_platform(token)
    token = _in_workspace(member.tenant_id)
    try:
        upload = ContactListImport(tenant_id=member.tenant_id, created_by_id=staff.pk)
        hidden = False
        try:
            upload.created_by                                                  # what the upload's answer did: the 500 on .68
        except AppUser.DoesNotExist:
            hidden = True
        check("inside the workspace, the visitor's own row is hidden (the cause of the 500)", hidden)
        check("their name still reads by id, for an upload, a campaign's owner and directly",
              names.label_of(upload, "created_by") == "Platform Tester"
              and CampaignSerializer().get_owner_name(Campaign(tenant_id=member.tenant_id, owner_user_id=staff.pk)) == "Platform Tester"
              and names.label(staff.pk) == "Platform Tester" and names.email(staff.pk) == "platform.test@example.com",
              names.label_of(upload, "created_by"))
        check("a workspace user's name reads as before; no one reads as nothing", names.label(member.pk) == (member.display_name or member.email) and names.label(None) is None)

        visiting = CampaignSerializer(context={"request": SimpleNamespace(platform_visit={"id": "v"}, user=staff)})
        check("a visiting administrator may own the campaign they create", visiting.validate_owner_user(staff) is staff)
        plain = CampaignSerializer(context={"request": SimpleNamespace(user=member)})
        try:
            plain.validate_owner_user(staff)
            refused = False
        except serializers.ValidationError:
            refused = True
        check("outside a visit, someone of another workspace is still refused as owner", refused)
        try:
            visiting.validate_owner_user(AppUser(pk=member.pk, tenant_id=staff.tenant_id, is_active=True))
            other_refused = False
        except serializers.ValidationError:
            other_refused = True
        check("and in a visit only the visitor themselves, not anyone of another workspace", other_refused)
    finally:
        context.reset(token)
    check.done()
