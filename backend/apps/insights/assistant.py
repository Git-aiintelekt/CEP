"""AI · Ask for a Report ("AI · Ask for a Report" in docs/mockups/report-builder.html): a prompt becomes a report through
Claude or OpenAI. The model receives the prompt and the catalogue of the fields this person may use (dataset and field
names, types, calculations), never customer rows, and answers through a schema-bound reply: a draft (a name, a view and
a definition, checked against the catalogue like any report built by hand and retried once with the error), one
question when the prompt has two readings, or "no field for this" with the closest prompts the catalogue can answer.
Only a draft counts against the plan's prompts a month.

    Platform:   Configuration -> AI Assistant (apps/platform_ops/admin_ai.py): ai_provider rows, one per provider, the key
                encrypted; ai.default_model and ai.explain_allowed among the global parameters (patch 0055).
    Workspace:  Settings -> AI Assistant: tenant.settings.ai_assistant = {enabled, providers: {anthropic, openai}, explain}.
    Prompts:    ai_prompt, in the workspace (RLS), kept 90 days.

    GET  /insights/assistant/                  what this person may ask: the models, the default, the month's use, recent prompts
    POST /insights/assistant/ask/              {prompt, model, answer_to?} -> the reply
    POST /insights/assistant/<id>/open/        the draft becomes a private report, opened in the editor
    GET, PUT /workspace/ai-assistant/          the workspace's switches (user.admin)
"""
import json
import time
import uuid
from datetime import timedelta

import requests
from django.conf import settings
from django.db import connections
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.permissions import HasPermissionCode, SameTenant
from apps.delivery.engine import session
from apps.insights import catalog, runner
from apps.insights.api import VIEW, _can_see_pii, _has, _q, _report_row, _serialize, _tenant
from apps.insights.definition import DefinitionError, validate
from apps.platform_ops import billing, crypto, params
from apps.reporting import reports
from apps.tenants import context

P = settings.PLATFORM_ALIAS
SETTINGS_KEY = "ai_assistant"
RETENTION_DAYS = 90
PROMPT_MAX = 1000
RECENT = 8
TIMEOUT_S = 60

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
        "view": {"type": "object", "properties": {"type": {"type": "string", "enum": list(VIEWS)}, "chart": {"type": "string", "enum": ["bar", "line", "area"]},
                                                  "across": {"type": "string", "description": "a dimension key spread across the columns (pivot) or as the series (chart)"}}},
        "definition": {"type": "object", "properties": {
            "columns": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "aggregate": {"type": "string"}, "bucket": {"type": "string"}}, "required": ["field"]}},
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
    },
    "required": ["kind"],
}


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


def providers() -> dict[str, dict]:
    """every provider row by key, the key decrypted (never serialised)"""
    if not table_present():
        return {}
    with connections[P].cursor() as cursor:
        cursor.execute("""SELECT provider, api_key_enc, model_reports, model_fast, is_active, last_checked_at, last_check_ok, last_check_error, updated_at
                            FROM ai_provider""")
        names = [c[0] for c in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    return {row["provider"]: row for row in rows if row["provider"] in PROVIDERS}


def active_providers() -> dict[str, dict]:
    return {key: row for key, row in providers().items() if row["is_active"] and row["api_key_enc"]}


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
                            "label": model_label(model), "note": note})
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
    """Counted live: the allowance is checked before every prompt. Only drafts count."""
    with connections[P].cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.ai_prompt') IS NOT NULL")
        if not cursor.fetchone()[0]:
            return 0
        cursor.execute("SELECT count(*) FROM ai_prompt WHERE tenant_id = %s AND counted AND created_at >= %s", [str(tenant_id), billing.month_start()])
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
def offer(tenant, request) -> dict:
    """The box's state: the models the person may pick (the platform's switched-on providers the workspace allows), the default,
    the month's use; or why the box is not there."""
    rows = active_providers()
    mine = workspace_settings(tenant)
    allowed = {k: v for k, v in rows.items() if mine["providers"].get(k, True)}
    models = models_of(allowed)
    if not (_has(request, "report.edit") or _has(request, "report.admin")):
        return {"enabled": False, "reason": "no_right", "models": [], "default_model": None, "usage": None}
    if not rows:
        return {"enabled": False, "reason": "no_provider", "models": [], "default_model": None, "usage": None}
    if not mine["enabled"]:
        return {"enabled": False, "reason": "workspace_off", "models": [], "default_model": None, "usage": None}
    if not models:
        return {"enabled": False, "reason": "no_provider_allowed", "models": [], "default_model": None, "usage": None}
    use = allowance(tenant.pk)
    return {"enabled": True, "reason": None, "models": models, "default_model": default_model(models), "usage": {**use, "words": usage_words(use)},
            "examples": EXAMPLES}


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


def system_prompt(datasets: list[dict], zone: str, today) -> str:
    return f"""You turn a person's request into a report definition for CEP Insights, a reporting tool. Reply only through the propose_report schema.

Rules:
- Use only the datasets and fields listed in the catalogue, by their keys. Never invent a dataset, a field, an operator or an aggregate. One dataset per report.
- A report is grouped when it has a measure: every dimension column is a group-by key. A date dimension may carry a bucket (day, week, month, quarter, year). A measure column needs an aggregate the field allows.
- Filters: {{"combinator": "and" | "or", "rules": [{{"field", "operator", "value"}}]}} with an operator the field allows. Dates are written YYYY-MM-DD. "between" takes [from, to]; "last_days" takes a number of days; "in" takes a list; "is_null" and "is_not_null" take no value.
- The view: grid (one row per group), chart (bar, line or area over a date or a dimension; "across" names the series dimension when there is one), hierarchy (dimensions nested, with totals), pivot ("across" names the dimension spread across the columns). "Months across" or "by X across" means a pivot across that dimension.
- Sort by the first measure descending unless the person asks otherwise; limit 500 unless asked.
- If the request needs data no field holds, answer kind "no_field": one sentence saying what is missing and which fields come closest, and up to three suggestions, each a complete request the catalogue can answer.
- If the request has two readings that change the result (which period, which measure, which dataset), ask ONE question (kind "question") with two to four short answers; each answer's "prompt" is the full request with that answer in it. Do not ask when the reading is clear.
- Otherwise answer kind "draft" with a name in Title Case (60 characters at most), the dataset key, the view and the definition.
- Today is {today.isoformat()} in the {zone} time zone. "Last month" is the previous calendar month; "this year" starts on 1 January; "last 30 days" is last_days 30.

Catalogue:
{catalogue_words(datasets)}"""


def _key_of(row: dict) -> str:
    return crypto.decrypt(row["api_key_enc"]) or ""


def call_model(provider: str, row: dict, model: str, system: str, user: str, *, timeout_s: int = TIMEOUT_S) -> tuple[dict, dict]:
    """One exchange with the provider, forced into the schema: the reply as a dict, and the usage {"in", "out"}."""
    base = PROVIDERS[provider]["base"]
    key = _key_of(row)
    try:
        if provider == "anthropic":
            body = {"model": model, "max_tokens": 2000, "system": system, "messages": [{"role": "user", "content": user}],
                    "tools": [{"name": "propose_report", "description": "A draft report, one question, or no field for this.", "input_schema": SCHEMA}],
                    "tool_choice": {"type": "tool", "name": "propose_report"}}
            response = requests.post(f"{base}/v1/messages", json=body, timeout=timeout_s,
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
            data = _json_of(response)
            reply = next((block["input"] for block in data.get("content", []) if block.get("type") == "tool_use"), None)
            usage = data.get("usage") or {}
            return reply or {}, {"in": int(usage.get("input_tokens") or 0), "out": int(usage.get("output_tokens") or 0)}
        body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "response_format": {"type": "json_schema", "json_schema": {"name": "propose_report", "schema": SCHEMA}}}
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
    return {"kind": "draft", "name": name, "dataset": dataset["key"], "dataset_label": dataset["label"], "view": definition.get("view") or {"type": "grid"},
            "definition": definition}


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
def ask(tenant, request, prompt: str, model_id: str, *, answer_to: str | None = None) -> dict:
    """The whole exchange: the allowance, the catalogue, one call (and one retry when the draft does not fit), the preview's row
    count, the row in ai_prompt. Raises AssistantError for the person; ValidationError for a bad body."""
    state = offer(tenant, request)
    if not state["enabled"]:
        raise AssistantError({"no_right": "Asking for a report needs the report.edit permission.", "no_provider": "No AI provider is switched on for the platform.",
                              "workspace_off": "AI is switched off for this workspace (Settings → AI Assistant).",
                              "no_provider_allowed": "This workspace allows no AI provider (Settings → AI Assistant)."}[state["reason"]])
    chosen = next((m for m in state["models"] if m["id"] == model_id), None)
    if chosen is None:
        raise ValidationError({"model": "Pick one of the models offered."})
    use = state["usage"]
    if use["limit"] is not None and use["used"] >= use["limit"]:
        raise AssistantError(f"The workspace has used its {use['limit']} prompts for {timezone.now().strftime('%B')}. Ask the platform team for more, or build the report in the editor.")
    row = active_providers()[chosen["provider"]]
    datasets = catalog.for_tenant(tenant.pk, _can_see_pii(request))
    limits = catalog.engine_of(tenant.pk)["limits"]
    system = system_prompt(datasets, reports.zone_of(tenant).key, timezone.now().astimezone(reports.zone_of(tenant)).date())
    started = time.monotonic()
    usage = {"in": 0, "out": 0}
    outcome, result, failure = "FAILED", None, None
    try:
        reply, used = call_model(chosen["provider"], row, chosen["model"], system, prompt)
        usage = {k: usage[k] + used[k] for k in usage}
        try:
            result = interpret(reply, datasets, max_limit=limits["run_rows"])
        except DefinitionError as exc:
            note = f"{prompt}\n\n(An earlier draft was refused: {exc.field}: {exc}. Keep to the catalogue and the rules.)"
            reply, used = call_model(chosen["provider"], row, chosen["model"], system, note)
            usage = {k: usage[k] + used[k] for k in usage}
            try:
                result = interpret(reply, datasets, max_limit=limits["run_rows"])
            except DefinitionError as exc2:
                failure = f"The model's draft did not fit the catalogue ({exc2.field}: {exc2}). Try putting the request differently."
    except ProviderError as exc:
        failure = str(exc)
    duration_ms = int((time.monotonic() - started) * 1000)
    if result is not None:
        outcome = {"draft": "DRAFT", "question": "QUESTION", "no_field": "NO_FIELD"}[result["kind"]]
        if result["kind"] == "draft":
            result["preview"] = _preview(tenant, request, datasets, result)
    prompt_id = _record(tenant.pk, request.user.pk, chosen, prompt, outcome, result, failure, usage, duration_ms, answer_to)
    return {"id": prompt_id, "kind": result["kind"] if result else "failed", "prompt": prompt, "model": {k: chosen[k] for k in ("id", "provider", "provider_name", "mark", "model", "label")},
            "duration_ms": duration_ms, "counted": outcome == "DRAFT", "message": failure, **({k: v for k, v in result.items() if k != "kind"} if result else {}),
            "usage": {**allowance(tenant.pk)}}


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


def _record(tenant_id, user_id, chosen: dict, prompt: str, outcome: str, result: dict | None, failure: str | None, usage: dict, duration_ms: int, answer_to) -> str:
    prompt_id = str(uuid.uuid4())
    draft = {k: result[k] for k in ("name", "dataset", "view", "definition") if k in result} if result and result["kind"] == "draft" else None
    reply = {k: v for k, v in (result or {}).items() if k in ("question", "answers", "message", "suggestions")} or None
    with session.tx():
        _q("DELETE FROM ai_prompt WHERE tenant_id = %s AND created_at < %s", [str(tenant_id), timezone.now() - timedelta(days=RETENTION_DAYS)])
        _q("""INSERT INTO ai_prompt (id, tenant_id, user_id, provider, model, kind, prompt, outcome, counted, draft, reply, detail, tokens_in, tokens_out, duration_ms, answer_to)
              VALUES (%s, %s, %s, %s, %s, 'report', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
           [prompt_id, str(tenant_id), str(user_id), chosen["provider"], chosen["model"], prompt, outcome, outcome == "DRAFT",
            json.dumps(draft) if draft else None, json.dumps(reply) if reply else None, (failure or "")[:300] or None, usage["in"], usage["out"], duration_ms,
            str(answer_to) if answer_to else None])
    return prompt_id


def recent(user_id) -> list[dict]:
    """this person's last prompts, newest first, with the report a draft became"""
    rows = _q("""SELECT p.id::text, p.prompt, p.provider, p.model, p.outcome, p.created_at, p.report_id::text, r.name AS report_name
                   FROM ai_prompt p LEFT JOIN report r ON r.id = p.report_id AND r.deleted_at IS NULL
                  WHERE p.user_id = %s ORDER BY p.created_at DESC LIMIT %s""", [str(user_id), RECENT])
    return [{"id": r["id"], "prompt": r["prompt"], "model": model_label(r["model"]), "provider": r["provider"], "outcome": r["outcome"], "created_at": r["created_at"],
             "report_id": r["report_id"] if r["report_name"] else None, "report_name": r["report_name"]} for r in rows]


def open_draft(tenant, request, prompt_id) -> dict:
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
    return _serialize(_report_row(report_id, request))


# ---------------------------------------------------------------------------------------------------- the API
class AssistantView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        tenant = _tenant()
        state = offer(tenant, request)
        return Response({**state, "recent": recent(request.user.pk) if state["enabled"] else []})


class AskView(APIView):
    permission_classes = VIEW

    @extend_schema(request=None, responses={200: None})
    def post(self, request, version=None):
        body = request.data if isinstance(request.data, dict) else {}
        prompt = " ".join(str(body.get("prompt") or "").split())
        if not prompt or len(prompt) > PROMPT_MAX:
            raise ValidationError({"prompt": f"Say what you want to see, in up to {PROMPT_MAX} characters."})
        answer_to = body.get("answer_to")
        if answer_to is not None:
            try:
                uuid.UUID(str(answer_to))
            except ValueError:
                raise ValidationError({"answer_to": "Not a prompt."}) from None
        try:
            return Response(ask(_tenant(), request, prompt, str(body.get("model") or ""), answer_to=answer_to))
        except AssistantError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)


class OpenDraftView(APIView):
    permission_classes = VIEW

    @extend_schema(request=None, responses={201: None})
    def post(self, request, version=None, prompt_id=None):
        if not (_has(request, "report.edit") or _has(request, "report.admin")):
            raise PermissionDenied("Creating a report needs the report.edit permission.")
        return Response(open_draft(_tenant(), request, prompt_id), status=status.HTTP_201_CREATED)


class WorkspaceAssistantView(APIView):
    """Settings → AI Assistant: the workspace's switches, what the platform offers, and the month's use."""
    permission_classes = [IsAuthenticated, SameTenant, HasPermissionCode.for_("user.admin")]

    def _payload(self, tenant) -> dict:
        rows = active_providers()
        return {**workspace_settings(tenant),
                "available": [{"key": key, "name": PROVIDERS[key]["name"], "mark": PROVIDERS[key]["mark"],
                               "models": [model_label(m) for m in (rows[key]["model_reports"], rows[key]["model_fast"]) if m]} for key in PROVIDERS if key in rows],
                "explain_allowed": explain_allowed(), "usage": allowance(tenant.pk), "retention_days": RETENTION_DAYS}

    @extend_schema(responses={200: None})
    def get(self, request, version=None):
        return Response(self._payload(_tenant()))

    @extend_schema(request=None, responses={200: None})
    def put(self, request, version=None):
        tenant = _tenant()
        save_workspace_settings(tenant, request.data if isinstance(request.data, dict) else {})
        return Response(self._payload(tenant))
