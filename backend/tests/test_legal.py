"""The legal line and the Terms of Use (api/v1/legal_api.py, the Legal global parameters, the back-office footer tag).

The parameters are seeded by the platform-operations layer (patch 0047) with the platform login; the API reads them through the
app's connection, which inside a rolled-back test cannot see the platform connection's writes. So the layer's seed block is run
and read back on the platform connection (which proves the SQL), and the API is tested with the parameters primed in the cache
the way a running installation holds them (apps.platform_ops.params caches them for a minute)."""
import json
from pathlib import Path

import pytest
from django.conf import settings
from django.core.cache import cache
from django.db import connections
from django.template import Context, Template
from django.test import Client
from django.utils import timezone

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

LAYER = Path(__file__).resolve().parents[2] / "database" / "CEP_Database_Schema_Platform_Operations.sql"


def seeded_legal_parameters() -> dict:
    """Runs the layer's platform_setting seed on the platform connection and returns the Legal rows it holds."""
    text = LAYER.read_text(encoding="utf-8")
    start = text.index("INSERT INTO platform_setting")
    block = text[start:text.index("ON CONFLICT (key) DO NOTHING;", start) + len("ON CONFLICT (key) DO NOTHING;")]
    with connections[settings.PLATFORM_ALIAS].cursor() as cursor:
        cursor.execute(block)
        cursor.execute("SELECT key, value, value_type, category FROM platform_setting WHERE key LIKE 'legal.%'")
        rows = cursor.fetchall()
    return {key: (json.loads(value) if isinstance(value, str) else value, kind, category) for key, value, kind, category in rows}


def test_legal_endpoint(check, fresh_cache):
    seeded = seeded_legal_parameters()
    check("the layer seeds the two Legal parameters as text, in the Legal category",
          set(seeded) == {"legal.copyright_holder", "legal.terms_of_use"} and seeded["legal.copyright_holder"][0] == "Transaction Tree"
          and all(kind == "STRING" and category == "Legal" for _value, kind, category in seeded.values())
          and "## 1. What CEP is" in seeded["legal.terms_of_use"][0] and "## 8. Contact" in seeded["legal.terms_of_use"][0], json.dumps(seeded)[:300])

    client = Client()
    cache.set("cep:params", {key: value for key, (value, _kind, _category) in seeded.items()}, 60)
    answered = client.get("/api/v1/legal/")                                       # no token, no X-Tenant
    check("the endpoint answers without a sign-in or a workspace", answered.status_code == 200, answered.status_code)
    body = answered.json()
    check("it carries the holder, the current year and the terms in Markdown",
          body["copyright_holder"] == "Transaction Tree" and body["year"] == timezone.now().year and body["terms"]["title"] == "Terms of Use"
          and body["terms"]["body"] == seeded["legal.terms_of_use"][0], json.dumps(body)[:300])

    cache.set("cep:params", {"legal.copyright_holder": "Northwind Holdings", "legal.terms_of_use": "## Our terms\n\nBe kind."}, 60)
    changed = client.get("/api/v1/legal/").json()
    check("a change in the back-office's Global parameters shows as soon as the cache turns over",
          changed["copyright_holder"] == "Northwind Holdings" and changed["terms"]["body"] == "## Our terms\n\nBe kind.", json.dumps(changed)[:300])
    rendered = Template("{% load cep_legal %}{% cep_legal as legal %}{{ legal.year }}|{{ legal.holder }}|{{ legal.terms_url }}").render(Context())
    check("the back-office footer tag names the year, the holder and the app's terms page",
          rendered.startswith(f"{timezone.now().year}|Northwind Holdings|") and rendered.endswith("/terms"), rendered)

    cache.clear()
    empty = client.get("/api/v1/legal/").json()
    check("with the cache cold the endpoint still answers with a holder and a text or nothing, never an error",
          empty["copyright_holder"] != "" and isinstance(empty["terms"]["body"], str), json.dumps(empty)[:200])
    check.done()
