"""Configuration -> AI Assistant (apps/platform_ops/admin_ai.py): the page, a provider saved with its key encrypted and never
shown, Check Connection with the provider faked, the defaults saved as global parameters, Remove."""
import json

import pytest
from django.conf import settings
from django.db import connections

from apps.insights import assistant

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS
PAGE = "/admin/platform_ops/mailserver/ai-assistant/"


class _Response:
    def __init__(self, status_code, body):
        self.status_code, self._body, self.reason = status_code, body, "OK" if status_code < 400 else "Bad"

    def json(self):
        return self._body


def test_office(check, monkeypatch):
    if not assistant.table_present():
        pytest.skip("patch 0055 has not been applied to this database")
    from django.contrib.auth.models import update_last_login
    from django.contrib.auth.signals import user_logged_in
    from django.test import Client

    from apps.identity.models import AppUser
    from apps.platform_ops import crypto, params

    staff = AppUser.objects.using(P).filter(is_staff=True, is_active=True, is_platform_admin=True).order_by("created_at").first() \
        or AppUser.objects.using(P).filter(is_staff=True, is_active=True).order_by("created_at").first()
    user_logged_in.disconnect(update_last_login, dispatch_uid="update_last_login")
    try:
        office = Client()
        office.force_login(staff)
        page = office.get(PAGE)
        check("the page opens with both providers not set up", page.status_code == 200 and page.content.count(b"Not Set Up") == 2 and b"Claude (Anthropic)" in page.content and b"OpenAI" in page.content, str(page.status_code))
        refused = office.post(PAGE, {"action": "save:anthropic", "anthropic-model_reports": "claude-sonnet-5-5", "anthropic-model_fast": "claude-haiku-5-5", "anthropic-is_active": "on"})
        check("saving a provider without a key is refused", refused.status_code == 200 and b"Enter the provider" in refused.content)
        saved = office.post(PAGE, {"action": "save:anthropic", "anthropic-api_key": "sk-ant-test", "anthropic-model_reports": "claude-sonnet-5-5", "anthropic-model_fast": "claude-haiku-5-5", "anthropic-is_active": "on"})
        rows = assistant.providers()
        check("the provider is saved with its key encrypted", saved.status_code == 302 and "anthropic" in rows and crypto.decrypt(rows["anthropic"]["api_key_enc"]) == "sk-ant-test"
              and rows["anthropic"]["model_reports"] == "claude-sonnet-5-5" and rows["anthropic"]["is_active"], str(saved.status_code))
        page = office.get(PAGE)
        check("the page never shows the key, says it is stored, and offers Check Connection", b"sk-ant-test" not in page.content and b"stored" in page.content and b"Check Connection" in page.content)
        kept = office.post(PAGE, {"action": "save:anthropic", "anthropic-api_key": "", "anthropic-model_reports": "claude-opus-5-5", "anthropic-model_fast": "claude-haiku-5-5", "anthropic-is_active": "on"})
        rows = assistant.providers()
        check("saving without a key keeps the stored one", kept.status_code == 302 and crypto.decrypt(rows["anthropic"]["api_key_enc"]) == "sk-ant-test" and rows["anthropic"]["model_reports"] == "claude-opus-5-5")

        seen = {}

        def fake_get(url, **kwargs):
            seen["url"], seen["headers"] = url, kwargs.get("headers") or {}
            return _Response(200, {"data": [{"id": "claude-opus-5-5"}, {"id": "claude-haiku-5-5"}]})

        monkeypatch.setattr(assistant.requests, "get", fake_get)
        checked = office.post(PAGE, {"action": "check:anthropic"})
        rows = assistant.providers()
        check("Check Connection reaches the provider with the key and records the outcome", checked.status_code == 302 and seen["headers"].get("x-api-key") == "sk-ant-test"
              and "api.anthropic.com/v1/models" in seen["url"] and rows["anthropic"]["last_check_ok"] is True and rows["anthropic"]["last_checked_at"] is not None)
        monkeypatch.setattr(assistant.requests, "get", lambda url, **kwargs: _Response(401, {"error": {"message": "invalid x-api-key"}}))
        office.post(PAGE, {"action": "check:anthropic"})
        rows = assistant.providers()
        check("a refused key is recorded with the provider's reason", rows["anthropic"]["last_check_ok"] is False and "invalid x-api-key" in rows["anthropic"]["last_check_error"])

        defaults = office.post(PAGE, {"action": "defaults", "defaults-default_model": "anthropic:claude-haiku-5-5", "defaults-explain_allowed": ""})
        params.invalidate()
        check("the defaults are saved as global parameters", defaults.status_code == 302 and params.get("ai.default_model") == "anthropic:claude-haiku-5-5" and params.get("ai.explain_allowed") is False
              and assistant.default_model(assistant.models_of(assistant.active_providers())) == "anthropic:claude-haiku-5-5", str(params.get("ai.default_model")))
        with connections[P].cursor() as cursor:
            cursor.execute("INSERT INTO ai_prompt (tenant_id, user_id, provider, model, prompt, outcome, counted) VALUES (%s, %s, 'anthropic', 'claude-haiku-5-5', 'Sent by campaign', 'DRAFT', TRUE)",
                           ["a0000000-0000-4000-8000-000000000001", str(staff.pk)])
        page = office.get(PAGE)
        check("this month's table counts the workspace's drafts by provider", page.status_code == 200 and b"NWA" in page.content, str(page.status_code))
        removed = office.post(PAGE, {"action": "remove:anthropic"})
        check("Remove deletes the provider", removed.status_code == 302 and "anthropic" not in assistant.providers())
    finally:
        user_logged_in.connect(update_last_login, dispatch_uid="update_last_login")
    check.done()
