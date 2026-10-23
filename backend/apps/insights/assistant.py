"""AI · Ask for a Report ("AI · Ask for a Report" in docs/mockups/report-builder.html): a prompt becomes a report through
Claude or OpenAI. The model receives the prompt and the catalogue of the fields this person may use (dataset and field
names, types, calculations), never customer rows, and answers through a schema-bound reply: a draft (a name, a view and
a definition, checked against the catalogue like any report built by hand and retried once with the error), one
question when the prompt has two readings, or "no field for this" with the closest prompts the catalogue can answer.
Only a draft counts against the plan's prompts a month.

The box (docs/mockups/ask-for-report-data-and-specs.html, option A) also says which data to ask about: all of it, the platform's
datasets, one Report Database (with its tables not mapped yet, apps/insights/ask_tables.py) or the uploaded files; the model then
reads only those fields. Up to five images and three documents (a spec as PDF, Word, text or Markdown, apps/insights/ask_documents.py)
go with the prompt and are never stored. A prompt may run to 100,000 characters.

    Platform:   Configuration -> AI Assistant (apps/platform_ops/admin_ai.py): ai_provider rows without a tenant, one per provider,
                the key encrypted; ai.default_model and ai.explain_allowed among the global parameters (patch 0055).
    Workspace:  Settings -> AI Assistant: tenant.settings.ai_assistant = {enabled, providers: {anthropic, openai}, explain}, and the
                workspace's own keys as ai_provider rows with its tenant_id (RLS). A workspace's own key wins over the platform's
                for that provider, and prompts on it are not limited by the plan (account OWN).
    Prompts:    ai_prompt, in the workspace (RLS), kept 90 days.

    GET  /insights/assistant/                  what this person may ask: the models, the default, the month's use, recent prompts
    POST /insights/assistant/ask/              {prompt, model, answer_to?, scope?, unmapped?, component?, progress?} (+ images, documents) -> the reply
    GET  /insights/assistant/progress/<id>/    the steps of the prompt sent with that progress id, while it runs (ask_progress.py)
    POST /insights/assistant/<id>/open/        {name?} the draft becomes a private report, opened in the editor
    GET, PUT /workspace/ai-assistant/          the workspace's switches and its own keys (user.admin)
    POST     /workspace/ai-assistant/check/    {provider} -> the workspace's own key checked
"""
import copy
import json
import re
import time
import uuid
from datetime import timedelta

import requests
from django.conf import settings
from django.db import connections
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.delivery.engine import session
from apps.insights import ask_documents, ask_progress, ask_tables, catalog, external, runner
from apps.insights.api import VIEW, _can_see_pii, _has, _q, _report_row, _serialize, _tenant, component_of
from apps.insights.definition import DefinitionError, validate
from apps.platform_ops import billing, crypto, params
from apps.reporting import reports
from apps.tenants import context

P = settings.PLATFORM_ALIAS
SETTINGS_KEY = "ai_assistant"
RETENTION_DAYS = 90
PROMPT_MAX = 100_000                                                # about 25,000 words; a longer spec goes in as a document
DEADLINE_S = 100                                                    # one prompt's calls together, inside the server's 120 s
# images sent with Ask for a Report (a sketch of the report, a screenshot of a chart or a table): read for the request, never stored
IMAGES_MAX = 5
IMAGE_BYTES_MAX = 3_750_000                                         # the providers' 5 MB limit once base64-encoded
IMAGE_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp"}
IMAGES_NOTE = ("The person attached {n} image{s} with this request: a sketch of the report they want, or a screenshot of a chart, a table or a "
               "spreadsheet. Read them for the fields, groupings, periods and view to propose; they hold no rows to use as data.")
RECENT = 8
TIMEOUT_S = 60
# Claude replies through structured outputs (output_config.format): the current models (Sonnet 5.5, Opus 5.5, Fable 5.1) refuse a
# forced tool_choice. Only older models that lack structured outputs still get the forced tool.
FORCED_TOOL_MODELS = re.compile(r"^claude-(3|sonnet-4-5|opus-4-1)")
CLAUDE_MAX_TOKENS = 16000                                           # room for adaptive thinking (always on for the 5.x models) and a full draft
CLAUDE_5 = re.compile(r"^claude-(opus|sonnet|haiku|fable)-5")       # takes output_config.effort; medium keeps a draft inside the server's time
ANY_VALUE = {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "null"},
                       {"type": "array", "items": {"anyOf": [{"type": "string"}, {"type": "number"}]}}]}

PROVIDERS = {
    "anthropic": {"name": "Claude (Anthropic)", "mark": "A", "base": "https://api.anthropic.com", "keys": "console.anthropic.com → API Keys"},
    "openai": {"name": "OpenAI", "mark": "O", "base": "https://api.openai.com", "keys": "platform.openai.com → API Keys"},
}
DEFAULT_MODELS = {"anthropic": ("claude-sonnet-5-5", "claude-haiku-5-5"), "openai": ("gpt-5", "gpt-5-mini")}
MODEL_LABELS = {"claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-haiku-5-5": "Claude Haiku 5.5", "claude-opus-5-5": "Claude Opus 5.5",
                "claude-fable-5-1": "Claude Fable 5.1", "claude-sonnet-4-5": "Claude Sonnet 4.5", "claude-haiku-4-5": "Claude Haiku 4.5",
                "gpt-5": "GPT-5", "gpt-5-mini": "GPT-5 mini", "gpt-5-nano": "GPT-5 nano", "gpt-4.1": "GPT-4.1", "gpt-4.1-mini": "GPT-4.1 mini"}
EXAMPLES = ["Which campaigns made the most revenue last month?", "Delivered rate by sending engine, by week",
            "New contacts by home store this year, with consent", "E-receipts sent per store per day, last 14 days"]

VIEWS = ("grid", "chart", "hierarchy", "pivot")
PROMPTS = {"label": "string", "prompt": "string"}
SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["draft", "question", "no_field"]},
        "name": {"type": "string", "description": "The report's name, Title Case, 60 characters at most (draft)"},
        "dataset": {"type": "string", "description": "The dataset key (draft)"},
        "view": {"type": "object", "properties": {"type": {"type": "string", "enum": list(VIEWS)}, "chart": {"type": "string", "enum": ["bar", "line", "area", "pie", "funnel", "stacked", "stacked100", "combo"]},
                                                  "across": {"type": "string", "description": "a dimension key spread across the columns (pivot) or as the series (chart)"}}},
        "definition": {"type": "object", "properties": {
            "columns": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "aggregate": {"type": "string"}, "bucket": {"type": "string"},
                                                                               "compare": {"type": "array", "items": {"type": "string", "enum": ["previous_period", "previous_year", "change_previous_period", "change_previous_year", "running_total", "percent_of_total",
                                                                                                                                "year_to_date", "quarter_to_date", "moving_average", "rank", "percent_of_target", "difference_to_target"]}},
                                                                               "target": {"type": "number", "description": "the target for percent_of_target and difference_to_target"}},
                                                       "required": ["field"]}},
            "filters": {"type": "object", "properties": {"combinator": {"type": "string", "enum": ["and", "or"]},
                                                         "rules": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "operator": {"type": "string"}, "value": {}},
                                                                                              "required": ["field", "operator"]}}}},
            "orderBy": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "direction": {"type": "string", "enum": ["asc", "desc"]}}, "required": ["field"]}},
            "limit": {"type": "integer"}}},
        "question": {"type": "string", "description": "The one question to ask (question)"},
        "answers": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "prompt": {"type": "string", "description": "the full request with this answer in it"}},
                                               "required": ["label", "prompt"]}},
        "message": {"type": "string", "description": "What the catalogue cannot answer, in one sentence, naming the closest fields (no_field)"},
        "suggestions": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "prompt": {"type": "string"}}, "required": ["label", "prompt"]}},
        "note": {"type": "string", "description": "One sentence on a part of the request or its documents the draft could not follow, or empty (draft)"},
    },
    "required": ["kind"],
}


def schema_for(unmapped: bool) -> dict:
    """the reply's schema; with a database's tables not mapped yet, a draft may carry a new dataset, or ask for tables' columns"""
    if not unmapped:
        return SCHEMA
    properties = {**SCHEMA["properties"], "kind": {"type": "string", "enum": ["draft", "question", "no_field", "need_tables"]},
                  "new_dataset": ask_tables.NEW_DATASET,
                  "tables": {"type": "array", "items": {"type": "string"}, "description": f"The tables whose columns you need (need_tables), {ask_tables.TABLES_MAX} at most"}}
    return {**SCHEMA, "properties": properties}


SCOPES = ("all", "platform", "uploads")


def scoped(datasets: list[dict], scope: str) -> list[dict]:
    """the datasets the box asks about: all, the platform's, the uploaded files', or one database's (db:<id>)"""
    if scope == "all":
        return datasets
    if scope == "platform":
        return [d for d in datasets if not d.get("external") and d.get("kind") != "upload"]
    if scope == "uploads":
        return [d for d in datasets if d.get("kind") == "upload"]
    return [d for d in datasets if (d.get("database") or {}).get("id") == scope[3:]]


def valid_scope(scope: str) -> str:
    scope = scope or "all"
    if scope in SCOPES:
        return scope
    if scope.startswith("db:"):
        try:
            return f"db:{uuid.UUID(scope[3:])}"
        except ValueError:
            pass
    raise ValidationError({"scope": "All, the platform's datasets, one of your databases or the uploaded files."})


class AssistantError(Exception):
    """Why the assistant cannot answer, for the person."""


class ProviderError(AssistantError):
    """The provider refused or failed."""


# ---------------------------------------------------------------------------------------------------- the platform's providers
_TABLE_SEEN = False


def table_present() -> bool:
    """ai_provider exists (patch 0055); checked until seen once, so a server deployed before its patch keeps working."""
    global _TABLE_SEEN
    if _TABLE_SEEN:
        return True
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.ai_provider') IS NOT NULL")
        _TABLE_SEEN = bool(cursor.fetchone()[0])
    return _TABLE_SEEN


COLUMNS = "provider, api_key_enc, model_reports, model_fast, is_active, last_checked_at, last_check_ok, last_check_error, updated_at"


def providers() -> dict[str, dict]:
    """the platform's provider rows by key (the key stays encrypted here)"""
    if not table_present():
        return {}
    with connections[P].cursor() as cursor:
        cursor.execute(f"SELECT {COLUMNS} FROM ai_provider WHERE tenant_id IS NULL")
        names = [c[0] for c in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    return {row["provider"]: row for row in rows if row["provider"] in PROVIDERS}


def active_providers() -> dict[str, dict]:
    return {key: row for key, row in providers().items() if row["is_active"] and row["api_key_enc"]}


def own_providers(tenant_id) -> dict[str, dict]:
    """a workspace's own provider rows by key: on its own connection inside a request, on the platform's from the back-office"""
    if not table_present():
        return {}
    if context.current() is not None and not context.is_platform():
        rows = _q(f"SELECT {COLUMNS} FROM ai_provider WHERE tenant_id = %s", [str(tenant_id)])
    else:
        with connections[P].cursor() as cursor:
            cursor.execute(f"SELECT {COLUMNS} FROM ai_provider WHERE tenant_id = %s", [str(tenant_id)])
            names = [c[0] for c in cursor.description]
            rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    return {row["provider"]: row for row in rows if row["provider"] in PROVIDERS}


def effective_providers(tenant) -> dict[str, dict]:
    """the rows a workspace runs on: its own key for a provider when it has one, else the platform's when switched on and allowed"""
    mine = workspace_settings(tenant)
    own, platform = own_providers(tenant.pk), active_providers()
    out = {}
    for key in PROVIDERS:
        if key in own and own[key]["api_key_enc"] and own[key]["is_active"]:
            out[key] = {**own[key], "source": "own"}
        elif key in platform and mine["providers"].get(key, True):
            out[key] = {**platform[key], "source": "platform"}
    return out


def save_own_provider(tenant, provider: str, data: dict) -> None:
    """the workspace's own row for a provider: inserted or changed, the key encrypted; an empty key keeps the stored one"""
    current = own_providers(tenant.pk).get(provider)
    key = (data.get("api_key") or "").strip()
    if current is None and not key:
        raise ValidationError({"api_key": "Give the provider's API key."})
    models = {name: " ".join(str(data.get(name) or (current or {}).get(name) or DEFAULT_MODELS[provider][i]).split()) for i, name in enumerate(("model_reports", "model_fast"))}
    for name, value in models.items():
        if len(value) > 80 or not all(ch.isalnum() or ch in "-._:" for ch in value):
            raise ValidationError({name: "A model name: letters, digits, dots, dashes."})
    with session.tx():
        if current is None:
            _q("""INSERT INTO ai_provider (tenant_id, provider, api_key_enc, model_reports, model_fast, is_active)
                  VALUES (%s, %s, %s, %s, %s, TRUE)""", [str(tenant.pk), provider, crypto.encrypt(key), models["model_reports"], models["model_fast"]])
        else:
            sets, args = ["model_reports = %s", "model_fast = %s", "updated_at = now()", "row_version = row_version + 1"], [models["model_reports"], models["model_fast"]]
            if key:
                sets += ["api_key_enc = %s", "last_checked_at = NULL", "last_check_ok = NULL", "last_check_error = NULL"]
                args.append(crypto.encrypt(key))
            _q(f"UPDATE ai_provider SET {', '.join(sets)} WHERE tenant_id = %s AND provider = %s", [*args, str(tenant.pk), provider])


def remove_own_provider(tenant, provider: str) -> None:
    with session.tx():
        _q("DELETE FROM ai_provider WHERE tenant_id = %s AND provider = %s", [str(tenant.pk), provider])


def check_own_provider(tenant, provider: str) -> tuple[bool, str]:
    row = own_providers(tenant.pk).get(provider)
    if row is None or not row["api_key_enc"]:
        raise ValidationError({"provider": "Save the key first."})
    ok, detail = check(provider, row)
    with session.tx():
        _q("UPDATE ai_provider SET last_checked_at = %s, last_check_ok = %s, last_check_error = %s WHERE tenant_id = %s AND provider = %s",
           [timezone.now(), ok, None if ok else detail[:300], str(tenant.pk), provider])
    return ok, detail


def model_label(model: str) -> str:
    return MODEL_LABELS.get(model, model)


def models_of(rows: dict[str, dict]) -> list[dict]:
    """the models people may pick, in provider order: the reports model then the fast one of each switched-on provider"""
    out = []
    for key in PROVIDERS:
        row = rows.get(key)
        if not row:
            continue
        for model, note in ((row["model_reports"], "Best for reports"), (row["model_fast"], "Fastest")):
            if model and not any(m["id"] == f"{key}:{model}" for m in out):
                out.append({"id": f"{key}:{model}", "provider": key, "provider_name": PROVIDERS[key]["name"], "mark": PROVIDERS[key]["mark"], "model": model,
                            "label": model_label(model), "note": note, "source": row.get("source", "platform")})
    return out


def default_model(models: list[dict]) -> str | None:
    wanted = str(params.get("ai.default_model", "") or "")
    if any(m["id"] == wanted for m in models):
        return wanted
    return models[0]["id"] if models else None


def explain_allowed() -> bool:
    return bool(params.get("ai.explain_allowed", True))


# ---------------------------------------------------------------------------------------------------- the workspace's switches
WORKSPACE_DEFAULTS = {"enabled": True, "providers": {"anthropic": True, "openai": True}, "explain": True}


def workspace_settings(tenant) -> dict:
    stored = (tenant.settings or {}).get(SETTINGS_KEY) or {}
    providers_ = {**WORKSPACE_DEFAULTS["providers"], **{k: bool(v) for k, v in (stored.get("providers") or {}).items() if k in PROVIDERS}}
    return {"enabled": bool(stored.get("enabled", WORKSPACE_DEFAULTS["enabled"])), "providers": providers_, "explain": bool(stored.get("explain", WORKSPACE_DEFAULTS["explain"]))}


def save_workspace_settings(tenant, data: dict) -> dict:
    current = workspace_settings(tenant)
    for key in ("enabled", "explain"):
        if key in data:
            if not isinstance(data[key], bool):
                raise ValidationError({key: "On or off."})
            current[key] = data[key]
    if "providers" in data:
        if not isinstance(data["providers"], dict) or any(k not in PROVIDERS or not isinstance(v, bool) for k, v in data["providers"].items()):
            raise ValidationError({"providers": "On or off, per provider."})
        current["providers"] = {**current["providers"], **data["providers"]}
    tenant.settings = {**(tenant.settings or {}), SETTINGS_KEY: current}
    tenant.save(update_fields=["settings"])
    params.invalidate(tenant.pk)
    return current


# ---------------------------------------------------------------------------------------------------- the month's prompts
def prompts_this_month(tenant_id) -> int:
    """Counted live: the allowance is checked before every prompt. Only drafts on the platform's key count. Read on the workspace's
    own connection inside a request (the one the prompts are written on), on the platform connection from the back-office."""
    if context.current() is not None and not context.is_platform():
        if not _q("SELECT to_regclass('public.ai_prompt') IS NOT NULL AS present")[0]["present"]:
            return 0
        return int(_q("SELECT count(*) AS n FROM ai_prompt WHERE tenant_id = %s AND counted AND account = 'PLATFORM' AND created_at >= %s", [str(tenant_id), billing.month_start()])[0]["n"])
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.ai_prompt') IS NOT NULL")
        if not cursor.fetchone()[0]:
            return 0
        cursor.execute("SELECT count(*) FROM ai_prompt WHERE tenant_id = %s AND counted AND account = 'PLATFORM' AND created_at >= %s", [str(tenant_id), billing.month_start()])
        return int(cursor.fetchone()[0])


def allowance(tenant_id) -> dict:
    plan = billing.plan_for(tenant_id) or {}
    limit = plan.get("max_ai_prompts")
    return {"used": prompts_this_month(tenant_id), "limit": None if limit is None else int(limit), "month": billing.month_start().isoformat(),
            "plan": plan.get("name")}


def usage_words(use: dict) -> str:
    month = timezone.now().strftime("%B")
    if use["limit"] is None:
        return f"{use['used']} prompt{'' if use['used'] == 1 else 's'} used in {month}" if use["used"] else f"No limit on prompts{(' on the ' + use['plan'] + ' plan') if use.get('plan') else ''}"
    if not use["used"]:
        return f"{use['limit']} prompts a month{(' on the ' + use['plan'] + ' plan') if use.get('plan') else ''}"
    return f"{use['used']} of {use['limit']} prompts used in {month}"


# ---------------------------------------------------------------------------------------------------- what this person may ask
def offer(tenant, request, *, need_edit: bool = True) -> dict:
    """The box's state: the models the person may pick (the platform's switched-on providers the workspace allows), the default,
    the month's use; or why the box is not there."""
    mine = workspace_settings(tenant)
    effective = effective_providers(tenant)
    models = models_of(effective)
    if need_edit and not (_has(request, "report.edit") or _has(request, "report.admin")):
        return {"enabled": False, "reason": "no_right", "models": [], "default_model": None, "usage": None}
    if not active_providers() and not any(row["api_key_enc"] for row in own_providers(tenant.pk).values()):
        return {"enabled": False, "reason": "no_provider", "models": [], "default_model": None, "usage": None}
    if not mine["enabled"]:
        return {"enabled": False, "reason": "workspace_off", "models": [], "default_model": None, "usage": None}
    if not models:
        return {"enabled": False, "reason": "no_provider_allowed", "models": [], "default_model": None, "usage": None}
    use = allowance(tenant.pk)
    own = [key for key, row in effective.items() if row["source"] == "own"]
    return {"enabled": True, "reason": None, "models": models, "default_model": default_model(models), "usage": {**use, "words": usage_words(use)},
            "own": own, "examples": EXAMPLES}


def explain_state(tenant, request) -> dict:
    """whether this person may have a report explained (any reader, when the platform and the workspace allow it), and by which model"""
    if not explain_allowed() or not workspace_settings(tenant)["explain"]:
        return {"enabled": False, "model": None}
    state = offer(tenant, request, need_edit=False)
    model = next((m for m in state["models"] if m["id"] == state["default_model"]), None) if state["enabled"] else None
    return {"enabled": model is not None, "model": {"id": model["id"], "label": model["label"], "provider_name": model["provider_name"]} if model else None}


# ---------------------------------------------------------------------------------------------------- the conversation
def catalogue_words(datasets: list[dict]) -> str:
    """The catalogue as the model reads it: keys to use, labels to recognise, what each field allows. PII fields a person
    may not use are not listed, so the model cannot name them."""
    lines = []
    for d in datasets:
        lines.append(f"## dataset \"{d['key']}\" · {d['label']} ({d['component']['name']}): {d.get('description') or ''}".rstrip(": "))
        if d.get("time_field"):
            lines.append(f"   time field: {d['time_field']}")
        for f in d["fields"]:
            bits = [f"\"{f['key']}\" · {f['label']} · {f['type']} · {f['role']}"]
            if f["role"] == "measure":
                bits.append("aggregates: " + ", ".join(f["aggregates"]))
            if f.get("buckets"):
                bits.append("buckets: " + ", ".join(f["buckets"]))
            bits.append("operators: " + ", ".join(f["operators"]))
            lines.append("   - " + " · ".join(bits))
    return "\n".join(lines)


def system_prompt(datasets: list[dict], zone: str, today, tables: str = "") -> str:
    return f"""You turn a person's request into a report definition for CEP Insights, a reporting tool. Reply only through the propose_report schema.

Rules:
- Use only the datasets and fields listed in the catalogue, by their keys. Never invent a dataset, a field, an operator or an aggregate. One dataset per report.
- A report is grouped when it has a measure: every dimension column is a group-by key. A date dimension may carry a bucket (day, week, month, quarter, year). A measure column needs an aggregate the field allows.
- Filters: {{"combinator": "and" | "or", "rules": [{{"field", "operator", "value"}}]}} with an operator the field allows. Dates are written YYYY-MM-DD. "between" takes [from, to]; "last_days" takes a number of days; "in" takes a list; "is_null" and "is_not_null" take no value.
- The view: grid (one row per group), chart (bar, line or area over a date or a dimension; "across" names the series dimension when there is one; pie for shares of one measure by one dimension; funnel for stages in order; stacked or stacked100 for the parts of each bar, by the dimension across or by the measures; combo for the first measure as bars and the others as lines), hierarchy (dimensions nested, with totals), pivot ("across" names the dimension spread across the columns). "Months across" or "by X across" means a pivot across that dimension.
- A measure column may carry "compare": previous_period, previous_year, change_previous_period, change_previous_year (these four and running_total need a date dimension with a bucket in the report), running_total and percent_of_total (sum or count measures only). "vs last year", "growth", "running total" and "share" mean these; year_to_date, quarter_to_date and moving_average need the date too, rank orders the rows, and percent_of_target or difference_to_target need "target" on the column.
- A measure whose only aggregate is calc is a calculated measure (a rate, a share, an average per something): use it with aggregate "calc" when the person asks for that rate.
- Sort by the first measure descending unless the person asks otherwise; limit 500 unless asked.
- If the request needs data no field holds, answer kind "no_field": one sentence saying what is missing and which fields come closest, and up to three suggestions, each a complete request the catalogue can answer.
- If the request has two readings that change the result (which period, which measure, which dataset), ask ONE question (kind "question") with two to four short answers; each answer's "prompt" is the full request with that answer in it. Do not ask when the reading is clear.
- Otherwise answer kind "draft" with a name in Title Case (60 characters at most), the dataset key, the view and the definition.
- Today is {today.isoformat()} in the {zone} time zone. "Last month" is the previous calendar month; "this year" starts on 1 January; "last 30 days" is last_days 30.

Catalogue:
{catalogue_words(datasets) or "(no mapped dataset: use the tables below)"}{chr(10) + chr(10) + tables if tables else ""}"""


def _key_of(row: dict) -> str:
    return crypto.decrypt(row["api_key_enc"]) or ""


SQL_SCHEMA = {"type": "object", "properties": {"sql": {"type": "string", "description": "One SELECT statement, no semicolon"}, "note": {"type": "string", "description": "One sentence on an assumption made, or empty"}},
              "required": ["sql"]}


def clean_prompt(text) -> str:
    """the prompt as written, its line breaks kept: spaces inside a line collapsed, the lines trimmed, at most one empty line in a row"""
    lines = [" ".join(line.split()) for line in str(text or "").replace("\r\n", "\n").split("\n")]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def read_images(files) -> list[dict]:
    """Uploaded images as the providers take them, {media_type, data (base64)}: at most IMAGES_MAX, each a PNG, JPEG, GIF or WebP the
    image library can read (whatever its name or declared type says) and no larger than IMAGE_BYTES_MAX. ValidationError otherwise."""
    import base64
    from io import BytesIO

    from PIL import Image, UnidentifiedImageError
    files = list(files or [])
    if len(files) > IMAGES_MAX:
        raise ValidationError({"images": f"Add up to {IMAGES_MAX} images."})
    out = []
    for upload in files:
        raw = upload.read()
        name = getattr(upload, "name", "") or "the image"
        if len(raw) > IMAGE_BYTES_MAX:
            raise ValidationError({"images": f"{name} is {len(raw) / 1_000_000:.1f} MB; an image may be up to {IMAGE_BYTES_MAX / 1_000_000:.1f} MB."})
        try:
            with Image.open(BytesIO(raw)) as image:
                kind = image.format
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
            kind = None
        if kind not in IMAGE_FORMATS:
            raise ValidationError({"images": f"{name} is not a PNG, JPEG, GIF or WebP image."})
        out.append({"media_type": IMAGE_FORMATS[kind], "data": base64.b64encode(raw).decode("ascii")})
    return out


# Structured outputs allow 24 optional properties and 16 union-typed ones in a request (a 400 above that), so every property is
# sent as required: one that does not apply comes back empty ("", [], 0, or "" for a choice) and is dropped before the reply is read.
EMPTY_NOTE = 'Every field of the JSON reply is present: give a field that does not apply an empty value ("", [] or 0).'
EMPTY_NUMBERS = ("target", "limit")                                 # 0 means "not given" for these


def strict_schema(schema: dict) -> dict:
    """the schema as structured outputs take it: every object closed (additionalProperties false) with every property required, an
    optional choice offering "" as well, and a value of any type spelled out as the types a filter value can have; the schema the
    code reads with is unchanged"""
    def walk(node):
        if not isinstance(node, dict):
            return node
        if not node:                                                    # {} = any value
            return copy.deepcopy(ANY_VALUE)
        out = {k: walk(v) if k in ("items",) else v for k, v in node.items()}
        if "properties" in node:
            given = set(node.get("required") or [])
            out["properties"] = {name: walk(sub) if name in given else optional(walk(sub)) for name, sub in node["properties"].items()}
            out["required"] = list(node["properties"])
        if "anyOf" in node:
            out["anyOf"] = [walk(sub) for sub in node["anyOf"]]
        if node.get("type") == "object":
            out["additionalProperties"] = False
        return out

    def optional(node):
        if isinstance(node, dict) and isinstance(node.get("enum"), list) and "" not in node["enum"]:
            return {**node, "enum": [*node["enum"], ""]}
        return node
    return walk(copy.deepcopy(schema))


def without_empty(value, key: str | None = None):
    """a structured reply as the code reads it: the empty values strict_schema made the model give for what did not apply, left out"""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            v = without_empty(v, k)
            if v in ("", None, [], {}) or (k in EMPTY_NUMBERS and v == 0):
                continue
            out[k] = v
        return out
    if isinstance(value, list):
        return [item for item in (without_empty(v) for v in value) if item not in ("", {})]
    return value


def call_model(provider: str, row: dict, model: str, system: str, user: str, *, timeout_s: int = TIMEOUT_S, schema: dict | None = None, tool: str = "propose_report",
               images: list[dict] | None = None, documents: list[dict] | None = None) -> tuple[dict, dict]:
    """One exchange with the provider, forced into the schema: the reply as a dict, and the usage {"in", "out"}. images: read_images()'s,
    documents: ask_documents.read_documents()'s; sent before the text (Anthropic) or after it (OpenAI), as each provider takes them."""
    base = PROVIDERS[provider]["base"]
    key = _key_of(row)
    schema = schema or SCHEMA
    images = images or []
    documents = documents or []
    try:
        if provider == "anthropic":
            content = [*ask_documents.anthropic_blocks(documents), *({"type": "image", "source": {"type": "base64", "media_type": i["media_type"], "data": i["data"]}} for i in images),
                       {"type": "text", "text": user}] if images or documents else user
            body = {"model": model, "max_tokens": CLAUDE_MAX_TOKENS, "system": system, "messages": [{"role": "user", "content": content}]}
            forced = bool(FORCED_TOOL_MODELS.match(model))
            if forced:
                body.update({"max_tokens": 4000, "tools": [{"name": tool, "description": "The reply, in the shape asked for.", "input_schema": schema}],
                             "tool_choice": {"type": "tool", "name": tool}})
            else:
                body["system"] = f"{system}\n\n{EMPTY_NOTE}"
                body["output_config"] = {"format": {"type": "json_schema", "schema": strict_schema(schema)}, **({"effort": "medium"} if CLAUDE_5.match(model) else {})}
            response = requests.post(f"{base}/v1/messages", json=body, timeout=timeout_s,
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
            data = _json_of(response)
            usage = data.get("usage") or {}
            used = {"in": int(usage.get("input_tokens") or 0), "out": int(usage.get("output_tokens") or 0)}
            if data.get("stop_reason") == "refusal":
                raise ProviderError("Claude declined to answer this request. Try putting it differently.")
            if data.get("stop_reason") == "max_tokens":
                raise ProviderError("Claude's answer was cut off before it was complete. Ask for less at once.")
            if forced:
                reply = next((block["input"] for block in data.get("content", []) if block.get("type") == "tool_use"), None)
                return reply or {}, used
            text = "".join(block.get("text") or "" for block in data.get("content", []) if block.get("type") == "text")
            try:
                reply = json.loads(text) if text.strip() else {}
            except ValueError:
                reply = {}
            return without_empty(reply) if isinstance(reply, dict) else {}, used
        content = [{"type": "text", "text": user}, *ask_documents.openai_parts(documents),
                   *({"type": "image_url", "image_url": {"url": f"data:{i['media_type']};base64,{i['data']}"}} for i in images)] if images or documents else user
        body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
                "response_format": {"type": "json_schema", "json_schema": {"name": tool, "schema": schema}}}
        response = requests.post(f"{base}/v1/chat/completions", json=body, timeout=timeout_s, headers={"Authorization": f"Bearer {key}"})
        data = _json_of(response)
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "{}"
        try:
            reply = json.loads(content)
        except ValueError:
            reply = {}
        usage = data.get("usage") or {}
        return reply if isinstance(reply, dict) else {}, {"in": int(usage.get("prompt_tokens") or 0), "out": int(usage.get("completion_tokens") or 0)}
    except requests.RequestException as exc:
        raise ProviderError(f"{PROVIDERS[provider]['name']} could not be reached: {exc.__class__.__name__}.") from exc


def _json_of(response) -> dict:
    try:
        data = response.json()
    except ValueError:
        data = {}
    if response.status_code >= 400:
        detail = (data.get("error") or {}).get("message") if isinstance(data.get("error"), dict) else data.get("error")
        raise ProviderError(f"The provider answered {response.status_code}: {str(detail or response.reason)[:200]}")
    return data if isinstance(data, dict) else {}


def check(provider: str, row: dict) -> tuple[bool, str]:
    """Reaches the provider with the key and looks for the two models in its list."""
    base = PROVIDERS[provider]["base"]
    key = _key_of(row)
    try:
        if provider == "anthropic":
            response = requests.get(f"{base}/v1/models?limit=100", timeout=20, headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
        else:
            response = requests.get(f"{base}/v1/models", timeout=20, headers={"Authorization": f"Bearer {key}"})
        data = _json_of(response)
    except ProviderError as exc:
        return False, str(exc)
    except requests.RequestException as exc:
        return False, f"{PROVIDERS[provider]['name']} could not be reached: {exc.__class__.__name__}."
    listed = {item.get("id") for item in data.get("data", []) if isinstance(item, dict)}
    wanted = [m for m in (row.get("model_reports"), row.get("model_fast")) if m]
    missing = [m for m in wanted if listed and m not in listed]
    if missing:
        return True, f"Connected, but {', '.join(missing)} is not in the account's model list; check the model name."
    return True, "Connected. " + (", ".join(wanted) + " available." if wanted and listed else "")


# ---------------------------------------------------------------------------------------------------- reading the reply
def interpret(reply: dict, datasets: list[dict], *, max_limit: int) -> dict:
    """The model's reply checked: a draft's definition validated against its dataset (DefinitionError raised for the retry),
    a question with its answers, or no_field with its suggestions."""
    kind = reply.get("kind")
    if kind == "question":
        question = " ".join(str(reply.get("question") or "").split())
        answers = _prompts(reply.get("answers"), 4)
        if not question or len(answers) < 2:
            raise DefinitionError("question", "A question needs two to four answers.")
        return {"kind": "question", "question": question, "answers": answers}
    if kind == "no_field":
        message = " ".join(str(reply.get("message") or "").split()) or "No dataset holds what this asks for."
        return {"kind": "no_field", "message": message[:500], "suggestions": _prompts(reply.get("suggestions"), 3)}
    if kind != "draft":
        raise DefinitionError("kind", "Answer with a draft, a question or no_field.")
    dataset = next((d for d in datasets if d["key"] == reply.get("dataset")), None)
    if dataset is None:
        raise DefinitionError("dataset", f"Name one of the datasets: {', '.join(d['key'] for d in datasets)}.")
    raw = reply.get("definition") if isinstance(reply.get("definition"), dict) else {}
    view = reply.get("view") if isinstance(reply.get("view"), dict) else {}
    view = {k: v for k, v in view.items() if k in ("type", "chart", "across") and v}
    if view.get("type") not in VIEWS:
        view["type"] = "grid"
    raw = {**raw, "view": view}
    definition = validate(dataset, raw, max_limit=max_limit)
    name = " ".join(str(reply.get("name") or "").split())[:60] or f"{dataset['label']} report"
    note = " ".join(str(reply.get("note") or "").split())[:400]
    return {"kind": "draft", "name": name, "dataset": dataset["key"], "dataset_label": dataset["label"], "view": definition.get("view") or {"type": "grid"},
            "definition": definition, **({"note": note} if note else {})}


def _prompts(raw, most: int) -> list[dict]:
    out = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict) and str(item.get("prompt") or "").strip():
            label = " ".join(str(item.get("label") or item["prompt"]).split())[:120]
            out.append({"label": label, "prompt": " ".join(str(item["prompt"]).split())[:PROMPT_MAX]})
        if len(out) == most:
            break
    return out


# ---------------------------------------------------------------------------------------------------- asking
def ask(tenant, request, prompt: str, model_id: str, *, answer_to: str | None = None, images: list[dict] | None = None, documents: list[dict] | None = None,
        scope: str = "all", unmapped: bool = False, component: str | None = None, progress_id: str | None = None) -> dict:
    """The whole exchange: the allowance, the catalogue (the scope's datasets, and a database's tables not mapped yet when asked),
    one call (another when the model asks for tables' columns, and one retry when the draft does not fit), the preview's row count,
    the row in ai_prompt. images and documents go to the model with the prompt and are not kept. Raises AssistantError for the
    person; ValidationError for a bad body."""
    state = offer(tenant, request)
    if not state["enabled"]:
        raise AssistantError({"no_right": "Asking for a report needs the report.edit permission.", "no_provider": "No AI provider is switched on for the platform.",
                              "workspace_off": "AI is switched off for this workspace (Settings → AI Assistant).",
                              "no_provider_allowed": "This workspace allows no AI provider (Settings → AI Assistant)."}[state["reason"]])
    chosen = next((m for m in state["models"] if m["id"] == model_id), None)
    if chosen is None:
        raise ValidationError({"model": "Pick one of the models offered."})
    use = state["usage"]
    if chosen["source"] == "platform" and use["limit"] is not None and use["used"] >= use["limit"]:
        raise AssistantError(f"The workspace has used its {use['limit']} prompts for {timezone.now().strftime('%B')}. Ask the platform team for more, add your own key under Settings → AI Assistant, or build the report in the editor.")
    row = effective_providers(tenant)[chosen["provider"]]
    datasets = scoped(catalog.for_tenant(tenant.pk, _can_see_pii(request)), scope)
    images, documents = images or [], documents or []
    who = "Claude" if chosen["provider"] == "anthropic" else "OpenAI"
    progress = ask_progress.Progress(tenant.pk, request.user.pk, progress_id)
    attached = [*(f"{d['name']} ({d['pages']} pages)" if d.get("pages") else d["name"] for d in documents), *([f"{len(images)} image{'' if len(images) == 1 else 's'}"] if images else [])]
    progress.plan([*([("documents", "Read your " + " and ".join(x for x in (f"{len(documents)} document{'' if len(documents) == 1 else 's'}" if documents else "",
                                                                         f"{len(images)} image{'' if len(images) == 1 else 's'}" if images else "") if x))] if attached else []),
                   *([("tables", "Read the database's tables")] if scope.startswith("db:") and unmapped else []),
                   ("draft", f"{who} is drafting the report"), ("check", "Check the draft against your data"), ("preview", "Preview the rows")])
    if attached:
        progress.done("documents", " · ".join(attached))
    tables = None
    if scope.startswith("db:") and unmapped:
        progress.start("tables")
        try:
            tables = _tables_context(tenant, scope[3:], prompt, documents)
        except AssistantError as exc:
            progress.fail(str(exc))
            raise
        progress.done("tables", f"{tables['connection']['name']}: {len(tables['names']):,} names" + (f" · the columns of {', '.join(tables['columns'])}" if tables["columns"] else ""))
    elif not datasets:
        raise AssistantError({"platform": "No platform dataset is offered to this workspace.", "uploads": "No uploaded file is ready to report on yet (Insights → Uploaded Files)."}.get(
            scope, "This database has no mapped dataset yet: tick Also Look at Tables Not Mapped Yet, or map one under Settings → Report Databases."))
    mapped = {d["source"].split(".")[-1] for d in datasets if d.get("kind") == "table" and d.get("source")}
    limits = catalog.engine_of(tenant.pk)["limits"]
    zone = reports.zone_of(tenant)
    today = timezone.now().astimezone(zone).date()
    system = system_prompt(datasets, zone.key, today, ask_tables.words(tables, mapped) if tables else "")
    started = time.monotonic()
    usage = {"in": 0, "out": 0}
    outcome, result, failure, entry = "FAILED", None, None, None
    notes = [*([ask_documents.note(documents)] if documents else []), *([IMAGES_NOTE.format(n=len(images), s='' if len(images) == 1 else 's')] if images else [])]
    asked = "\n\n".join([prompt, *notes])
    text, retried, widened, step = asked, False, False, "draft"
    try:
        while True:
            left = DEADLINE_S - (time.monotonic() - started)
            if left < 10:
                failure = "The model took too long. Try again, or ask for less at once."
                break
            progress.start(step, chosen["label"])
            reply, used = call_model(chosen["provider"], row, chosen["model"], system, text, images=images, documents=documents, schema=schema_for(tables is not None),
                                     timeout_s=int(min(TIMEOUT_S * 1.5, left)))
            usage = {k: usage[k] + used[k] for k in usage}
            try:
                if reply.get("kind") == "need_tables":
                    wanted = [t for t in reply.get("tables") or [] if isinstance(t, str)][:ask_tables.TABLES_MAX]
                    if tables is None or widened or not wanted:
                        raise DefinitionError("kind", "Draft from the tables whose columns are listed, or answer no_field.")
                    progress.done(step, f"{who} asked for the columns of {', '.join(wanted)}")
                    progress.add("more_tables", "Read the tables asked for", before="check")
                    progress.start("more_tables")
                    tables, widened = ask_tables.more(tables, wanted), True
                    progress.done("more_tables", f"the columns of {', '.join(t for t in wanted if t in tables['columns'])}")
                    system = system_prompt(datasets, zone.key, today, ask_tables.words(tables, mapped))
                    step = "draft_tables"
                    progress.add(step, f"{who} is drafting the report from those tables", before="check")
                    continue
                progress.done(step)
                progress.start("check")
                result, entry = _read_reply(reply, datasets, tables, limits["run_rows"])
                progress.done("check", {"draft": None, "question": f"{who} asked one question first", "no_field": "No field holds this"}[result["kind"]])
                break
            except DefinitionError as exc:
                if retried:
                    failure = f"The model's draft did not fit the catalogue ({exc.field}: {exc}). Try putting the request differently."
                    break
                retried = True
                progress.done(step)
                progress.done("check", f"The first draft did not fit ({exc.field}: {exc})")
                text = f"{asked}\n\n(An earlier draft was refused: {exc.field}: {exc}. Keep to the catalogue and the rules.)"
                step = "retry"
                progress.add(step, f"{who} is trying again", before="preview")
                progress.add("check_again", "Check the new draft", before="preview")
    except ProviderError as exc:
        failure = str(exc)
    except external.ExternalError as exc:
        failure = f"The database could not be read: {exc}"
    if retried and result is not None:
        progress.start("check_again")
        progress.done("check_again")
    duration_ms = int((time.monotonic() - started) * 1000)
    if result is not None:
        outcome = {"draft": "DRAFT", "question": "QUESTION", "no_field": "NO_FIELD"}[result["kind"]]
        if result["kind"] == "draft":
            progress.start("preview")
            result["preview"] = _preview(tenant, request, [*datasets, *([entry] if entry else [])], result)
            progress.done("preview", (f"{result['preview']['rows']}{' or more' if result['preview']['more'] else ''} rows") if result["preview"] else "Not run now: the report runs in the editor")
            result["scope"] = scope
            if component:
                result["component"] = component
        else:
            progress.drop("preview")
        result["read"] = ask_documents.read_words(documents, len(images)) if documents or images else None
        progress.finish()
    else:
        progress.fail(failure or "Nothing came back.")
    prompt_id = _record(tenant.pk, request.user.pk, chosen, prompt, outcome, result, failure, usage, duration_ms, answer_to)
    return {"id": prompt_id, "kind": result["kind"] if result else "failed", "prompt": prompt, "model": {k: chosen[k] for k in ("id", "provider", "provider_name", "mark", "model", "label", "source")},
            "duration_ms": duration_ms, "counted": outcome == "DRAFT", "message": failure, **({k: v for k, v in result.items() if k not in ("kind", "map")} if result else {}),
            "steps": progress.as_list(), "usage": {**allowance(tenant.pk)}}


def _tables_context(tenant, connection_id: str, prompt: str, documents: list[dict]) -> dict:
    """the database's tables not mapped yet, as ask_tables reads them; AssistantError when the database cannot be used or read"""
    from apps.insights import databases
    if not databases._present():
        raise AssistantError("Report Databases are not set up on this installation.")
    try:
        connection = databases.connection(tenant.pk, connection_id)
        databases._usable(connection)
    except NotFound:
        raise AssistantError("That database is no longer connected.") from None
    except APIException as exc:
        raise AssistantError(str(exc.detail)) from None
    try:
        return ask_tables.context_for(connection, "\n".join([prompt, *(d.get("text") or "" for d in documents)]))
    except external.ExternalError as exc:
        raise AssistantError(f"{connection['name']} could not be read: {exc}") from None


def _read_reply(reply: dict, datasets: list[dict], tables: dict | None, max_limit: int) -> tuple[dict, dict | None]:
    """interpret(), and a draft on tables not mapped yet: its dataset built from the tables read, the fields put to their keys, and
    what Open in Editor maps kept with it ("map", stored with the draft, not sent back)"""
    if reply.get("kind") != "draft" or reply.get("dataset") != ask_tables.NEW_KEY:
        return interpret(reply, datasets, max_limit=max_limit), None
    if tables is None:
        raise DefinitionError("dataset", f"Name one of the datasets: {', '.join(d['key'] for d in datasets)}.")
    body, entry = ask_tables.build(tables, reply.get("new_dataset"))
    definition, view = ask_tables.remap(reply.get("definition") if isinstance(reply.get("definition"), dict) else {}, reply.get("view") if isinstance(reply.get("view"), dict) else {}, entry)
    result = interpret({**reply, "definition": definition, "view": view}, [*datasets, entry], max_limit=max_limit)
    shown = {k: entry[k] for k in ("key", "label", "description", "component", "primary_key", "time_field", "freshness", "fields", "kind", "database")}
    result["new_dataset"] = {**ask_tables.summary(body, tables["connection"]), "dataset": shown}
    result["map"] = {"connection_id": tables["connection"]["id"], "body": body}
    return result, entry


def _preview(tenant, request, datasets: list[dict], draft: dict) -> dict | None:
    """How many rows the draft gives, under the preview cap; nothing when the engine will not run it now."""
    dataset = next(d for d in datasets if d["key"] == draft["dataset"])
    try:
        out = runner.run(tenant, request.user, dataset, draft["definition"], "preview", limit=200, mask_pii=not _can_see_pii(request))
    except runner.RunRefused:
        return None
    except Exception:                                      # noqa: BLE001  a preview that fails does not lose the draft
        return None
    rows = len(out.get("rows") or [])
    return {"rows": rows, "more": bool(out.get("truncated"))}


def _record(tenant_id, user_id, chosen: dict, prompt: str, outcome: str, result: dict | None, failure: str | None, usage: dict, duration_ms: int, answer_to, kind: str = "report") -> str:
    prompt_id = str(uuid.uuid4())
    draft = {k: result[k] for k in ("name", "dataset", "view", "definition", "sql", "note", "scope", "map", "new_dataset", "component") if k in result} if result and result["kind"] in ("draft", "sql") else None
    reply = {k: v for k, v in (result or {}).items() if k in ("question", "answers", "message", "suggestions")} or None
    with session.tx():
        _q("DELETE FROM ai_prompt WHERE tenant_id = %s AND created_at < %s", [str(tenant_id), timezone.now() - timedelta(days=RETENTION_DAYS)])
        _q("""INSERT INTO ai_prompt (id, tenant_id, user_id, provider, model, kind, prompt, outcome, counted, account, draft, reply, detail, tokens_in, tokens_out, duration_ms, answer_to)
              VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
           [prompt_id, str(tenant_id), str(user_id), chosen["provider"], chosen["model"], kind, prompt, outcome, outcome == "DRAFT", "OWN" if chosen.get("source") == "own" else "PLATFORM",
            json.dumps(draft) if draft else None, json.dumps(reply) if reply else None, (failure or "")[:300] or None, usage["in"], usage["out"], duration_ms,
            str(answer_to) if answer_to else None])
    return prompt_id


def write_sql(tenant, request, prompt: str, model_id: str, *, dialect_name: str, schema_text: str) -> dict:
    """Write It for Me in the query window: one SELECT for the workspace's own database, from the request and the schema (table and
    column names, never rows). Checked by the query guard before it is handed back; never run here. Counts like a draft."""
    from apps.insights import external
    state = offer(tenant, request)
    if not state["enabled"]:
        raise AssistantError({"no_right": "Writing a query needs the report.edit permission.", "no_provider": "No AI provider is switched on for the platform.",
                              "workspace_off": "AI is switched off for this workspace (Settings → AI Assistant).",
                              "no_provider_allowed": "This workspace allows no AI provider (Settings → AI Assistant)."}[state["reason"]])
    chosen = next((m for m in state["models"] if m["id"] == model_id), None)
    if chosen is None:
        raise ValidationError({"model": "Pick one of the models offered."})
    use = state["usage"]
    if chosen["source"] == "platform" and use["limit"] is not None and use["used"] >= use["limit"]:
        raise AssistantError(f"The workspace has used its {use['limit']} prompts for {timezone.now().strftime('%B')}. Ask the platform team for more, or write the query by hand.")
    row = effective_providers(tenant)[chosen["provider"]]
    system = f"""You write one SQL SELECT for {dialect_name}, for a reporting tool that will run it read-only and wrap it as a subquery.

Rules:
- Use only the tables and columns listed in the schema, by their exact names. Never invent a table or a column.
- One SELECT (a WITH … SELECT is fine). No semicolon, no INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, GRANT, SET, INTO, no file or system functions, no LIMIT (the tool adds its own).
- Give every calculated column a short alias in snake_case (AS net_sales). Prefer explicit column lists to SELECT *.
- Dates: today is {timezone.now().astimezone(reports.zone_of(tenant)).date().isoformat()} in the {reports.zone_of(tenant).key} time zone; write dates as 'YYYY-MM-DD'.
- When the request is ambiguous, choose the most useful reading and say so in one sentence in "note".

Schema:
{schema_text}"""
    started = time.monotonic()
    usage = {"in": 0, "out": 0}
    sql, note, failure = None, "", None
    try:
        reply, usage = call_model(chosen["provider"], row, chosen["model"], system, prompt, schema=SQL_SCHEMA, tool="write_sql")
        candidate = str(reply.get("sql") or "").strip()
        note = " ".join(str(reply.get("note") or "").split())[:300]
        try:
            sql = external.check_sql(candidate)
        except external.ExternalError as exc:
            failure = f"The model wrote a query the window refuses ({exc}). Try putting the request differently."
    except ProviderError as exc:
        failure = str(exc)
    duration_ms = int((time.monotonic() - started) * 1000)
    result = {"kind": "sql", "sql": sql} if sql else None
    prompt_id = _record(tenant.pk, request.user.pk, chosen, prompt, "DRAFT" if sql else "FAILED", result, failure, usage, duration_ms, None, kind="sql")
    return {"id": prompt_id, "sql": sql, "note": note, "message": failure, "model": {k: chosen[k] for k in ("id", "provider", "provider_name", "mark", "model", "label", "source")},
            "duration_ms": duration_ms, "usage": allowance(tenant.pk)}


def recent(user_id) -> list[dict]:
    """this person's last prompts, newest first, with the report a draft became"""
    rows = _q("""SELECT p.id::text, p.prompt, p.provider, p.model, p.outcome, p.created_at, p.report_id::text, r.name AS report_name
                   FROM ai_prompt p LEFT JOIN report r ON r.id = p.report_id AND r.deleted_at IS NULL
                  WHERE p.user_id = %s ORDER BY p.created_at DESC LIMIT %s""", [str(user_id), RECENT])
    return [{"id": r["id"], "prompt": r["prompt"], "model": model_label(r["model"]), "provider": r["provider"], "outcome": r["outcome"], "created_at": r["created_at"],
             "report_id": r["report_id"] if r["report_name"] else None, "report_name": r["report_name"]} for r in rows]


def open_draft(tenant, request, prompt_id, name: str | None = None) -> dict:
    """The draft becomes a private report owned by the person (a first version, like New Report), remembered on the prompt."""
    rows = _q("SELECT id::text, user_id::text, outcome, draft, report_id::text FROM ai_prompt WHERE id = %s", [str(prompt_id)])
    if not rows or rows[0]["user_id"] != str(request.user.pk):
        raise NotFound("No such draft.")
    found = rows[0]
    if found["outcome"] != "DRAFT" or not found["draft"]:
        raise ValidationError({"draft": "This prompt gave no draft."})
    if found["report_id"]:
        return _serialize(_report_row(found["report_id"], request))
    draft = json.loads(found["draft"]) if isinstance(found["draft"], str) else found["draft"]
    name = " ".join(str(name or "").split())
    if len(name) > 200:
        raise ValidationError({"name": "Give the report a name of up to 200 characters."})
    if name:
        draft = {**draft, "name": name}
    if draft.get("map"):                                               # a draft on tables not mapped yet: the dataset is mapped now
        draft = {**draft, "dataset": _map_draft(tenant, request, draft["map"])}
    dataset = catalog.dataset(tenant.pk, draft["dataset"], _can_see_pii(request))
    if dataset is None:
        raise ValidationError({"draft": "The draft's dataset is no longer offered."})
    try:
        definition = validate(dataset, draft["definition"], max_limit=catalog.engine_of(tenant.pk)["limits"]["run_rows"])
    except DefinitionError as exc:
        raise ValidationError({f"definition.{exc.field}": str(exc)}) from None
    view_type = (definition.get("view") or {}).get("type", "grid")
    user_id = str(request.user.pk)
    with session.tx():
        made = _q("""INSERT INTO report (tenant_id, dataset_key, name, description, view_type, definition, owner_user_id, visibility, created_by, updated_by)
                     VALUES (%s, %s, %s, %s, %s, %s, %s, 'PRIVATE', %s, %s) RETURNING id::text""",
                  [str(tenant.pk), dataset["key"], draft["name"], None, view_type, json.dumps(definition), user_id, user_id, user_id])
        report_id = made[0]["id"]
        _q("INSERT INTO report_version (tenant_id, report_id, version, definition, view_type, note, changed_by) VALUES (%s, %s, 1, %s, %s, %s, %s)",
           [str(tenant.pk), report_id, json.dumps(definition), view_type, "Drafted by AI", user_id])
        _q("UPDATE ai_prompt SET report_id = %s WHERE id = %s", [report_id, str(prompt_id)])
        if draft.get("component") and component_of(draft["component"]):
            _q("UPDATE report SET component_key = %s WHERE id = %s", [draft["component"], report_id])
    return _serialize(_report_row(report_id, request))


def _map_draft(tenant, request, mapping: dict) -> str:
    """the draft's tables mapped as a dataset (as Map a Dataset saves one); its key"""
    from apps.insights import databases
    connection = databases.connection(tenant.pk, mapping["connection_id"])
    databases._usable(connection)
    data = databases._dataset_body(mapping["body"], None, connection["engine"])
    dataset_id = databases.create_dataset(tenant.pk, request.user.pk, connection["id"], data)
    return next(d["key"] for d in databases.datasets(tenant.pk, connection["id"]) if d["id"] == dataset_id)


# ---------------------------------------------------------------------------------------------------- the API
class AssistantView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        state = offer(tenant, request)
        return Response({**state, "recent": recent(request.user.pk) if state["enabled"] else [], "explain": explain_state(tenant, request)})


class AskView(APIView):
    permission_classes = VIEW

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        body = request.data if isinstance(request.data, dict) else {}                  # JSON, or multipart when images or documents come with it
        prompt = clean_prompt(body.get("prompt"))
        if not prompt or len(prompt) > PROMPT_MAX:
            raise ValidationError({"prompt": f"Say what you want to see, in up to {PROMPT_MAX:,} characters."})
        sent = sum(upload.size for name in ("images", "documents") for upload in request.FILES.getlist(name)) if request.FILES else 0
        if sent > ask_documents.ATTACHMENTS_BYTES_MAX:
            raise ValidationError({"documents": f"The images and documents come to {sent / 1_000_000:.1f} MB; together they may be up to {ask_documents.ATTACHMENTS_BYTES_MAX // 1_000_000} MB."})
        images = read_images(request.FILES.getlist("images")) if request.FILES else []
        documents = ask_documents.read_documents(request.FILES.getlist("documents")) if request.FILES else []
        scope = valid_scope(str(body.get("scope") or "all"))
        unmapped = str(body.get("unmapped") or "").lower() in ("1", "true", "yes")
        component = component_of(body.get("component"))
        progress_id = str(body.get("progress") or "") or None
        answer_to = body.get("answer_to")
        if answer_to is not None:
            try:
                uuid.UUID(str(answer_to))
            except ValueError:
                raise ValidationError({"answer_to": "Not a prompt."}) from None
        try:
            return Response(ask(_tenant(), request, prompt, str(body.get("model") or ""), answer_to=answer_to, images=images, documents=documents, scope=scope, unmapped=unmapped, component=component, progress_id=progress_id))
        except AssistantError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)


class ProgressView(APIView):
    """the steps of a prompt this person sent with that progress id, while it runs"""
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None, progress_id=None):
        return Response(ask_progress.read(_tenant().pk, request.user.pk, progress_id))


class OpenDraftView(APIView):
    permission_classes = VIEW

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None, prompt_id=None):
        if not (_has(request, "report.edit") or _has(request, "report.admin")):
            raise PermissionDenied("Creating a report needs the report.edit permission.")
        body = request.data if isinstance(request.data, dict) else {}
        return Response(open_draft(_tenant(), request, prompt_id, body.get("name")), status=status.HTTP_201_CREATED)


class WorkspaceAssistantView(APIView):
    """Settings → AI Assistant: the workspace's switches, what the platform offers, and the month's use."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]

    def _payload(self, tenant) -> dict:
        rows = active_providers()
        own = own_providers(tenant.pk)
        return {**workspace_settings(tenant),
                "available": [{"key": key, "name": PROVIDERS[key]["name"], "mark": PROVIDERS[key]["mark"], "keys": PROVIDERS[key]["keys"],
                               "platform": key in rows, "platform_models": [model_label(m) for m in (rows[key]["model_reports"], rows[key]["model_fast"]) if m] if key in rows else [],
                               "own": {"configured": bool(own[key]["api_key_enc"]), "model_reports": own[key]["model_reports"], "model_fast": own[key]["model_fast"],
                                       "last_checked_at": own[key]["last_checked_at"], "last_check_ok": own[key]["last_check_ok"], "last_check_error": own[key]["last_check_error"]} if key in own else None,
                               "default_models": list(DEFAULT_MODELS[key])} for key in PROVIDERS],
                "explain_allowed": explain_allowed(), "usage": allowance(tenant.pk), "retention_days": RETENTION_DAYS}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(_tenant()))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        tenant = _tenant()
        body = request.data if isinstance(request.data, dict) else {}
        own = body.pop("own", None) if isinstance(body, dict) else None
        if own is not None:
            if not isinstance(own, dict) or any(k not in PROVIDERS or not (v is None or isinstance(v, dict)) for k, v in own.items()):
                raise ValidationError({"own": "A provider's key and models, or null to remove it."})
            for key, value in own.items():
                if value is None:
                    remove_own_provider(tenant, key)
                else:
                    save_own_provider(tenant, key, value)
        save_workspace_settings(tenant, body)
        return Response(self._payload(tenant))


class WorkspaceAssistantCheckView(APIView):
    """Check Connection on the workspace's own key."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        body = request.data if isinstance(request.data, dict) else {}
        provider = str(body.get("provider") or "")
        if provider not in PROVIDERS:
            raise ValidationError({"provider": "anthropic or openai."})
        ok, detail = check_own_provider(_tenant(), provider)
        return Response({"ok": ok, "detail": detail})
