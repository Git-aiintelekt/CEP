"""A workspace's time zone is chosen from a list (reference_code, code set tenant.timezone, patch 0085), shown with its
offset as it is that day; a value outside the list is kept, marked, until someone chooses a place. Rolled back."""
import re
import zoneinfo
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

import pytest
from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.contrib.auth.signals import user_logged_in
from django.test import Client, override_settings

from apps.audit.models import ReferenceCode
from apps.identity.models import AppUser
from apps.tenants import timezones
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])
P = settings.PLATFORM_ALIAS
LAYER = Path(settings.BASE_DIR).parent / "database" / "CEP_Database_Schema_Platform_Operations.sql"


def test_every_zone_in_the_layer_is_a_real_zone_listed_once(check):
    rows = re.findall(r"\('tenant\.timezone', '([^']+)', '((?:[^']|'')+)', (\d+)\)", LAYER.read_text(encoding="utf-8"))
    zones = [zone for zone, _, _ in rows]
    check("the layer lists the zones", len(rows) >= 80, str(len(rows)))
    bad = [zone for zone in zones if not timezones.is_known(zone)]
    check("each is an IANA zone this server knows", not bad, str(bad))
    check("each once, in west-to-east order", len(set(zones)) == len(zones) and [int(order) for *_, order in rows] == sorted(int(order) for *_, order in rows))
    check("New York, London, Singapore and UTC are there", {"America/New_York", "Europe/London", "Asia/Singapore", "UTC"} <= set(zones))
    check.done()


def test_the_offset_follows_summer_time(check):
    winter, summer = datetime(2026, 1, 15, tzinfo=dt_timezone.utc), datetime(2026, 7, 15, tzinfo=dt_timezone.utc)
    check("New York in winter and in summer", timezones.offset("America/New_York", winter) == "(UTC−05:00)" and timezones.offset("America/New_York", summer) == "(UTC−04:00)")
    check("half hours", timezones.offset("Asia/Kolkata", winter) == "(UTC+05:30)")
    check("an unknown zone has none", timezones.offset("Mars/Base") == "")
    check.done()


def test_the_choices_come_from_the_table_and_keep_a_value_outside_it(check):
    ReferenceCode.objects.using(P).filter(code_set=timezones.CODE_SET).delete()
    check("with no rows (before patch 0085), the short list", [zone for zone, _ in timezones.choices()] == [zone for zone, _ in timezones.FALLBACK])
    ReferenceCode.objects.using(P).create(code_set=timezones.CODE_SET, code="America/New_York", label="Eastern Time (US & Canada)", sort_order=10)
    ReferenceCode.objects.using(P).create(code_set=timezones.CODE_SET, code="Asia/Singapore", label="Singapore", sort_order=20)
    ReferenceCode.objects.using(P).create(code_set=timezones.CODE_SET, code="Europe/Kyiv", label="Kyiv", sort_order=15, is_active=False)
    listed = timezones.choices()
    check("the active rows in their order, each with its offset", [zone for zone, _ in listed] == ["America/New_York", "Asia/Singapore"]
          and listed[1][1] == "(UTC+08:00) Singapore", str(listed))
    kept = timezones.choices("EST")
    check("a workspace on EST keeps it, first and marked", kept[0] == ("EST", "EST: not in the list, choose a place") and len(kept) == 3)
    check("a listed value is not repeated", len(timezones.choices("Asia/Singapore")) == 2)
    check.done()


def test_the_tenant_form_offers_the_list(check):
    tenant = Tenant.objects.using(P).order_by("created_at").first()
    staff = AppUser.objects.using(P).filter(is_staff=True, is_platform_admin=True, is_active=True).order_by("created_at").first()
    if tenant is None or staff is None:
        pytest.skip("no tenant or platform administrator in this database")
    ReferenceCode.objects.using(P).filter(code_set=timezones.CODE_SET).delete()
    ReferenceCode.objects.using(P).create(code_set=timezones.CODE_SET, code="America/New_York", label="Eastern Time (US & Canada)", sort_order=10)
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        with override_settings(ALLOWED_HOSTS=["*"]):
            client = Client()
            client.force_login(staff)
            body = client.get(f"/admin/tenants/tenant/{tenant.pk}/change/").content.decode()
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    select = body.split('name="timezone"', 1)[-1].split("</select>", 1)[0] if 'name="timezone"' in body else ""
    check("Time Zone is a list, not a text box", "<select" in body.split('name="timezone"', 1)[0][-400:] and 'type="text" name="timezone"' not in body)
    check("it offers the table's zones with their offsets", 'value="America/New_York"' in select and "Eastern Time (US &amp; Canada)" in select)
    check("the workspace's own zone is selected", f'value="{tenant.timezone}" selected' in select, tenant.timezone)
    check.done()
