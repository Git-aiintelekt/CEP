"""AI · Ask for a Report with longer prompts and images: the prompt keeps its line breaks up to 100,000 characters; images are read
(PNG, JPEG, GIF or WebP, whatever the file is called; at most three, none over the size limit), sent to the provider in its own
shape (Anthropic before the text, OpenAI after it) with a note saying what they are, and never kept. The provider is faked."""
import io
import json

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections
from django.test import Client
from PIL import Image
from rest_framework_simplejwt.tokens import AccessToken

from apps.identity.models import AppUser
from apps.insights import assistant
from apps.platform_ops import crypto
from apps.tenants import context
from tests.test_insights_assistant import DRAFT, _tables

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

P = settings.PLATFORM_ALIAS


def picture(kind="PNG", size=(40, 30)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (56, 99, 219)).save(out, format=kind)
    return out.getvalue()


def test_prompt_and_images(check):
    check("a prompt keeps its line breaks: spaces inside a line collapse, lines are trimmed, blank runs become one",
          assistant.clean_prompt("  Sales by store\r\n\r\n\r\n   - only   stores in Texas  \n- by month ") == "Sales by store\n\n- only stores in Texas\n- by month")
    read = assistant.read_images([SimpleUploadedFile("chart.png", picture("PNG")), SimpleUploadedFile("sketch.jpeg", picture("JPEG")), SimpleUploadedFile("scan", picture("WEBP"))])
    check("PNG, JPEG and WebP are read as what they are, whatever the file is called", [i["media_type"] for i in read] == ["image/png", "image/jpeg", "image/webp"]
          and all(i["data"] for i in read))

    def refused(files) -> str:
        try:
            assistant.read_images(files)
            return ""
        except Exception as exc:                                                   # noqa: BLE001  the ValidationError's words
            return json.dumps(getattr(exc, "detail", str(exc)), default=str)

    check("five images are taken", len(assistant.read_images([SimpleUploadedFile(f"{i}.png", picture()) for i in range(5)])) == 5)
    check("more than five images are refused", "up to 5 images" in refused([SimpleUploadedFile(f"{i}.png", picture()) for i in range(6)]))
    check("a file that is not an image is refused, named", "notes.png is not a PNG, JPEG, GIF or WebP image" in refused([SimpleUploadedFile("notes.png", b"not an image at all")]))
    big = bytes(assistant.IMAGE_BYTES_MAX + 1)
    check("an image over the limit is refused with its size", "big.png is 3.8 MB" in refused([SimpleUploadedFile("big.png", big)]))

    sent = []

    class Answer:
        status_code, reason, ok = 200, "OK", True

        def __init__(self, data):
            self.data = data

        def json(self):
            return self.data

    def fake_post(url, json=None, **kwargs):
        sent.append(json)
        if "anthropic" in url:
            return Answer({"content": [{"type": "tool_use", "input": {"kind": "question"}}], "usage": {"input_tokens": 10, "output_tokens": 2}})
        return Answer({"choices": [{"message": {"content": "{\"kind\": \"question\"}"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 2}})

    original = assistant.requests.post
    assistant.requests.post = fake_post
    try:
        row = {"api_key_enc": crypto.encrypt("sk-test")}
        assistant.call_model("anthropic", row, "claude-sonnet-5-5", "system", "Sales by store", images=read[:1])
        assistant.call_model("openai", row, "gpt-5", "system", "Sales by store", images=read[:1])
        assistant.call_model("anthropic", row, "claude-sonnet-5-5", "system", "Sales by store")
    finally:
        assistant.requests.post = original
    claude, gpt, plain = (body["messages"][-1]["content"] for body in sent)
    check("Anthropic gets the image as a base64 block before the text", [b["type"] for b in claude] == ["image", "text"] and claude[0]["source"]["media_type"] == "image/png"
          and claude[0]["source"]["data"] == read[0]["data"] and claude[1]["text"] == "Sales by store", json.dumps(claude)[:200])
    check("OpenAI gets the text, then the image as a data URL", gpt[0] == {"type": "text", "text": "Sales by store"} and gpt[1]["type"] == "image_url"
          and gpt[1]["image_url"]["url"].startswith("data:image/png;base64,"), json.dumps(gpt)[:200])
    check("without images the text goes as before, a plain string", plain == "Sales by store")
    check.done()


def test_api_with_images(check, admin_email, monkeypatch):
    if not _tables():
        pytest.skip("patch 0055 (and 0049) have not been applied to this database")
    with connections[P].cursor() as cursor:
        cursor.execute("INSERT INTO ai_provider (tenant_id, provider, api_key_enc, model_reports, model_fast, is_active) VALUES (NULL, 'anthropic', %s, 'claude-sonnet-5-5', 'claude-haiku-5-5', TRUE)", [crypto.encrypt("sk-test")])
    assistant._TABLE_SEEN = False
    calls = []

    def fake_call(provider, row, model, system, user, **kwargs):
        calls.append({"user": user, "images": kwargs.get("images") or []})
        return DRAFT, {"in": 1200, "out": 90}

    monkeypatch.setattr(assistant, "call_model", fake_call)
    monkeypatch.setattr(assistant.billing, "plan_for", lambda tenant_id: {"name": "Growth", "max_ai_prompts": 50})
    token = context.set_platform(True)
    admin = AppUser.objects.select_related("tenant").get(email=admin_email)
    context.reset_platform(token)
    client = Client(HTTP_X_TENANT=admin.tenant.code, HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(admin)))

    prompt = "Net sales by store, as in the picture:\n- one bar per store\n- last quarter"
    asked = client.post("/api/v1/insights/assistant/ask/", {"prompt": prompt, "model": "anthropic:claude-sonnet-5-5",
                                                             "images": [SimpleUploadedFile("sketch.png", picture()), SimpleUploadedFile("table.jpg", picture("JPEG"))]})
    body = asked.json()
    check("a prompt with line breaks and two images is asked: the model gets both images and a note saying what they are; the prompt keeps its lines",
          asked.status_code == 200 and body["kind"] == "draft" and body["prompt"] == prompt and [i["media_type"] for i in calls[-1]["images"]] == ["image/png", "image/jpeg"]
          and calls[-1]["user"].startswith(prompt + "\n\nThe person attached 2 images"), json.dumps(body)[:300] + " " + calls[-1]["user"][:200] if calls else str(asked.content[:300]))
    with connections["default"].cursor() as cursor:                                # the app's connection wrote it, in this test's transaction
        cursor.execute("SELECT set_config('app.current_tenant', %s, true)", [str(admin.tenant_id)])
        cursor.execute("SELECT prompt FROM ai_prompt WHERE id = %s", [body.get("id")])
        kept = cursor.fetchone()
    check("only the prompt is kept, not the images or the note", kept and kept[0] == prompt, str(kept))

    long = "Sales by store and month. " * 3800                                         # about 98,800 characters
    check("a prompt of almost 100,000 characters is taken", client.post("/api/v1/insights/assistant/ask/", {"prompt": long, "model": "anthropic:claude-sonnet-5-5"}).status_code == 200)
    over = client.post("/api/v1/insights/assistant/ask/", {"prompt": "x" * 100_001, "model": "anthropic:claude-sonnet-5-5"})
    check("over 100,000 characters is refused, saying the limit", over.status_code == 400 and "100,000 characters" in json.dumps(over.json()), str(over.content[:200]))
    fake = client.post("/api/v1/insights/assistant/ask/", {"prompt": "Sales by store", "model": "anthropic:claude-sonnet-5-5", "images": [SimpleUploadedFile("chart.png", b"<svg/>")]})
    check("a file that is not an image is refused before the model is asked", fake.status_code == 400 and "images" in fake.json().get("errors", {}) and len(calls) == 2, str(fake.content[:200]))
    check.done()
