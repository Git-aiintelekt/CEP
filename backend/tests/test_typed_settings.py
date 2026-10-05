"""The typed Global parameters form. Reads the real parameters, never writes: the form's assembled value is what is checked.

Converted from the verification script of the same name; every change is rolled back (tests/conftest.py)."""
import pytest
from django import forms
from django.contrib import admin
from django.test import RequestFactory
from apps.identity.models import AppUser
from apps.platform_ops import typed_values as tv
from apps.platform_ops.admin import MEMBER, NEW_KEY, NEW_VALUE, PlatformSettingAdmin
from apps.platform_ops.models import PlatformSetting
from apps.tenants import context

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_typed_settings(check):
    """The typed Global parameters form. Reads the real parameters, never writes: the form's assembled value is what is checked."""
    check("scalars: text stays text, numbers parse, yes/no in several spellings, empties and mistakes are told apart",
          tv.parse_scalar("STRING", " hello ") == "hello" and tv.parse_scalar("INTEGER", "72") == 72 and tv.parse_scalar("DECIMAL", "0.5") == 0.5
          and tv.parse_scalar("DECIMAL", "3") == 3 and tv.parse_scalar("BOOLEAN", "Yes") is True and tv.parse_scalar("BOOLEAN", "off") is False
          and tv.parse_scalar("INTEGER", "") is None and tv.parse_scalar("STRING", "") == "")
    try:
        tv.parse_scalar("INTEGER", "seventy"); bad_int = None
    except tv.ValueProblem as p:
        bad_int = str(p)
    try:
        tv.parse_scalar("BOOLEAN", "maybe"); bad_bool = None
    except tv.ValueProblem as p:
        bad_bool = str(p)
    check("a wrong number or yes/no is refused in words", bad_int == "A whole number, such as 72." and bad_bool == "Yes or no.", f"{bad_int} | {bad_bool}")
    check("a list is one per line or comma separated, blanks dropped", tv.parse_lines("a@x.com\n\n b@x.com, c@x.com ") == ["a@x.com", "b@x.com", "c@x.com"] and tv.parse_lines("") == [])
    check("key: value lines become an object with loose values; JSON is still accepted on the add form",
          tv.parse_object_lines("start: 21:00\nend: 08:00\nlimit: 60\nopen: yes\nnone: null") == {"start": "21:00", "end": "08:00", "limit": 60, "open": True, "none": None}
          and tv.parse_typed("OBJECT", '{"GROWTH": 600}') == {"GROWTH": 600} and tv.parse_typed("LIST", "a, b") == ["a", "b"] and tv.parse_typed("BOOLEAN", "no") is False)
    check("the list column reads as words, never JSON",
          tv.describe("LIST", []) == "none" and tv.describe("LIST", ["a@x.com", "b@x.com"]) == "a@x.com, b@x.com" and tv.describe("BOOLEAN", False) == "No"
          and tv.describe("OBJECT", {"start": "21:00", "end": "08:00"}) == "start: 21:00, end: 08:00" and tv.describe("STRING", "") == "—" and tv.describe("INTEGER", 240) == "240")

    # ---- the form against the real parameters, read only
    tok = context.set_platform(True)
    user = AppUser.objects.filter(is_staff=True).order_by("created_at").first()
    ma = PlatformSettingAdmin(PlatformSetting, admin.site)
    request = RequestFactory().get("/admin/platform_ops/platformsetting/"); request.user = user

    def form_for(setting, changes=None):
        Form = ma.get_form(request, setting)
        data = {"category": setting.category, "description": setting.description}
        for name, field in Form.base_fields.items():
            if name in data or name in ("key", "value_type"):
                continue
            initial = field.initial
            if isinstance(field, forms.BooleanField):
                if initial:
                    data[name] = "on"
            elif initial is not None:
                data[name] = str(initial)
        data.update(changes or {})
        form = Form(data=data, instance=setting)
        return form

    settings = list(PlatformSetting.objects.order_by("key"))
    same, differ = 0, []
    for setting in settings:
        form = form_for(setting)
        if form.is_valid() and form.assembled == setting.value:
            same += 1
        else:
            differ.append((setting.key, form.errors.as_text()[:80], getattr(form, "assembled", None)))
    check(f"every real parameter round-trips through its typed form unchanged ({same} of {len(settings)})", same == len(settings) and not differ, str(differ[:3]))

    fieldsets = ma.get_fieldsets(request, PlatformSetting.objects.get(key="messaging.sms_quiet_hours"))
    check("an object's keys are the form's fields, plus room for a new one; a plain value has one box",
          fieldsets[1][1]["fields"] == (f"{MEMBER}end", f"{MEMBER}start", NEW_KEY, NEW_VALUE) or fieldsets[1][1]["fields"] == (f"{MEMBER}start", f"{MEMBER}end", NEW_KEY, NEW_VALUE),
          str(fieldsets[1][1]["fields"]))
    check("a plain value has one box", ma.get_fieldsets(request, PlatformSetting.objects.get(key="alerts.renotify_minutes"))[1][1]["fields"] == ("typed_value",))

    quiet = PlatformSetting.objects.get(key="messaging.sms_quiet_hours")
    edited = form_for(quiet, {f"{MEMBER}end": "07:30"})
    check("editing one key of an object keeps the others", edited.is_valid() and edited.assembled == {"start": "21:00", "end": "07:30"}, f"{edited.errors.as_text()} {getattr(edited, 'assembled', None)}")
    added = form_for(quiet, {NEW_KEY: "days", NEW_VALUE: "5"})
    check("a new key is added with a loosely read value", added.is_valid() and added.assembled == {"start": "21:00", "end": "08:00", "days": 5})
    nameless = form_for(quiet, {NEW_VALUE: "5"})
    check("a new value without a name is refused", not nameless.is_valid() and "Name the value" in nameless.errors.as_text())

    limits = PlatformSetting.objects.get(key="integrations.inbound_per_minute")
    edited = form_for(limits, {f"{MEMBER}STARTER": "90"})
    check("a numeric member stays a number; a null member stays null", edited.is_valid() and edited.assembled["STARTER"] == 90 and edited.assembled["ENTERPRISE"] is None and edited.assembled["GROWTH"] == 600, str(getattr(edited, "assembled", None)))

    recipients = PlatformSetting.objects.get(key="alerts.recipients")
    edited = form_for(recipients, {"typed_value": "ops@example.com\nyou@example.com"})
    check("a list is typed one per line", edited.is_valid() and edited.assembled == ["ops@example.com", "you@example.com"])
    mfa = PlatformSetting.objects.get(key="security.mfa_required_for_staff")
    on = form_for(mfa, {"typed_value": "on"}); off = form_for(mfa); off.data.pop("typed_value", None)
    check("a switch is a boolean both ways", on.is_valid() and on.assembled is True and off.is_valid() and off.assembled is False)
    minutes = PlatformSetting.objects.get(key="alerts.renotify_minutes")
    bad = form_for(minutes, {"typed_value": "soon"})
    empty = form_for(minutes, {"typed_value": ""})
    check("a number box refuses words and an empty number", not bad.is_valid() and not empty.is_valid() and "Type the value" in empty.errors.as_text(), f"{bad.errors.as_text()[:60]} | {empty.errors.as_text()[:60]}")

    AddForm = ma.get_form(request, None)
    new = AddForm(data={"key": "alerts.digest_hour", "category": "Alerts", "description": "When the daily digest goes", "value_type": "INTEGER", "raw": "7"})
    check("the add form reads one text box by the kind chosen", new.is_valid() and new.assembled == 7, new.errors.as_text()[:80])
    new_list = AddForm(data={"key": "alerts.cc", "category": "Alerts", "description": "x", "value_type": "LIST", "raw": "a@x.com\nb@x.com"})
    new_obj = AddForm(data={"key": "x.y", "category": "X", "description": "x", "value_type": "OBJECT", "raw": "start: 09:00\nend: 17:00"})
    new_bad = AddForm(data={"key": "x.z", "category": "X", "description": "x", "value_type": "INTEGER", "raw": "lots"})
    check("… a list, an object as key: value lines, and a mistake in words", new_list.is_valid() and new_list.assembled == ["a@x.com", "b@x.com"] and new_obj.is_valid() and new_obj.assembled == {"start": "09:00", "end": "17:00"}
          and not new_bad.is_valid() and "whole number" in new_bad.errors.as_text())
    context.reset_platform(tok)
    check.done()
