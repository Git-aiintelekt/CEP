"""Three helpers around a report: Show the SQL, Explain This Report and Change with a Prompt.

    POST /insights/reports/sql/                  {dataset, definition}: the SQL the engine runs for it, with the values written in (builders)
    POST /insights/reports/<id>/explain/         {model, drill?}: what the report's rows say, in a few sentences, from the model
    POST /insights/assistant/change/             {dataset, definition, prompt, model}: the definition changed as asked, checked like any

Show the SQL runs nothing. Explaining sends the model the report's name, its columns and up to 100 of the rows the person
sees (masked columns left out); it needs the platform's ai.explain_allowed and the workspace's Explain switch (Settings -> AI
Assistant), and counts as a prompt like a draft. Changing sends the catalogue of the report's dataset and the definition,
never rows, and counts when it gives a changed report.
"""
import json
import time
from datetime import date, datetime
from decimal import Decimal

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reporting import reports

from . import access, assistant, catalog, compiler, derived, links, runner
from .api import VIEW, _can_see_pii, _has, _report_row, _tenant, _validated
from .definition import DefinitionError, validate

EXPLAIN_ROWS = 100
EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "Two or three sentences: what the rows show, with the figures that matter"},
        "points": {"type": "array", "items": {"type": "string"}, "description": "Up to four findings, one sentence each: the biggest, the smallest, a change, an outlier"},
        "caution": {"type": "string", "description": "One sentence on what the rows cannot tell (a short period, capped rows, masked columns), or empty"},
    },
    "required": ["summary"],
}


# ---------------------------------------------------------------------------------------------------- Show the SQL
def _literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    if isinstance(value, (datetime, date)):
        return "'" + value.isoformat() + "'"
    if isinstance(value, (list, tuple)):
        return "(" + ", ".join(_literal(v) for v in value) + ")"
    return "'" + str(value).replace("'", "''") + "'"


def readable(compiled: compiler.Compiled) -> str:
    """the statement with its values written in, for reading only (the engine binds them)"""
    sql = compiled.sql
    if isinstance(compiled.params, dict):
        for name, value in compiled.params.items():
            sql = __import__("re").sub(r"\{" + name + r":[^}]+\}", lambda _m, v=value: _literal(v), sql)
        return sql
    parts = [part.replace("%%", "%") for part in sql.split("%s")]       # the statement's own escaped percent signs, not the values'
    out = [parts[0]]
    for i, part in enumerate(parts[1:]):
        out.append(_literal(compiled.params[i]) if i < len(compiled.params) else "%s")
        out.append(part)
    return "".join(out)


def statements(tenant, user, dataset: dict, definition: dict, *, limit: int) -> list[dict]:
    """the report's statements as the engine would run them for this person: the rows, then the linked dataset's when there is one"""
    engine = catalog.engine_of(tenant.pk)
    zone = reports.zone_of(tenant).key
    dialect = runner._dialect_of(dataset, engine)
    try:
        restricted, limited = access.restrict(tenant.pk, user, dataset, definition)
    except access.AccessError as exc:
        raise ValidationError({"definition": str(exc)}) from None
    shaped = derived.augment(dataset, restricted)
    out = [{"label": dataset["label"], "dialect": dialect, "sql": readable(compiler.compile(shaped, restricted, str(tenant.pk), zone, limit=limit, dialect=dialect)),
            **({"access": limited} if limited else {})}]
    if restricted.get("blend"):
        other = catalog.dataset(tenant.pk, restricted["blend"]["dataset"], True)
        if other is not None:
            other_definition, _ = links.other_definition(dataset, restricted)
            other_definition, _ = access.restrict(tenant.pk, user, other, other_definition)
            out.append({"label": other["label"], "dialect": dialect,
                        "sql": readable(compiler.compile(derived.augment(other, other_definition), other_definition, str(tenant.pk), zone, limit=limit * 4, dialect=dialect))})
    return out


class SqlView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None):
        if not (_has(request, "report.edit") or _has(request, "report.admin")):
            raise PermissionDenied("Showing the SQL is for people who build reports.")
        tenant = _tenant()
        limits = catalog.engine_of(tenant.pk)["limits"]
        dataset, definition = _validated(request, request.data if isinstance(request.data, dict) else {}, max_limit=limits["run_rows"], reading=True)
        return Response({"statements": statements(tenant, request.user, dataset, definition, limit=definition.get("limit") or limits["run_rows"]),
                         "note": "The values are written in for reading; the engine sends them separately, and runs the statement read-only with a time limit."})


# ---------------------------------------------------------------------------------------------------- asking a model
def _chosen(tenant, request, model_id: str, *, need_edit: bool) -> tuple[dict, dict]:
    state = assistant.offer(tenant, request, need_edit=need_edit)
    if not state["enabled"]:
        raise assistant.AssistantError({"no_right": "Changing a report with a prompt needs the report.edit permission.", "no_provider": "No AI provider is switched on for the platform.",
                                        "workspace_off": "AI is switched off for this workspace (Settings → AI Assistant).",
                                        "no_provider_allowed": "This workspace allows no AI provider (Settings → AI Assistant)."}[state["reason"]])
    chosen = next((m for m in state["models"] if m["id"] == model_id), None) or next((m for m in state["models"] if m["id"] == state["default_model"]), None)
    if chosen is None:
        raise ValidationError({"model": "Pick one of the models offered."})
    use = state["usage"]
    if chosen["source"] == "platform" and use["limit"] is not None and use["used"] >= use["limit"]:
        raise assistant.AssistantError(f"The workspace has used its {use['limit']} prompts for {timezone.now().strftime('%B')}. Ask the platform team for more, or add your own key under Settings → AI Assistant.")
    return chosen, assistant.effective_providers(tenant)[chosen["provider"]]


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.4g}" if abs(value) < 1 else f"{value:,.2f}".rstrip("0").rstrip(".")
    if isinstance(value, Decimal):
        return _cell(float(value))
    return str(value)[:60]


def rows_text(result: dict) -> tuple[str, list[str]]:
    """the rows as a small table for the model, masked columns left out; and the labels left out"""
    keep = [i for i, c in enumerate(result["columns"]) if not c.get("masked")]
    left_out = [c["label"] for c in result["columns"] if c.get("masked")]
    lines = [" | ".join(result["columns"][i]["label"] for i in keep)]
    for row in result["rows"][:EXPLAIN_ROWS]:
        lines.append(" | ".join(_cell(row[i]) for i in keep))
    return "\n".join(lines), left_out


def written(tenant, user_id, chosen: dict, provider: dict, name: str, dataset_label: str, result: dict) -> dict:
    """the model's few sentences on the rows of a run (masked columns left out), recorded as a prompt of kind explain"""
    if not result["rows"]:
        return {"summary": "The report has no rows for its filters, so there is nothing to explain.", "points": [], "caution": "", "counted": False}
    table, left_out = rows_text(result)
    zone = reports.zone_of(tenant)
    system = f"""You explain a business report to the person who opened it, in plain words. Reply only through the explain_report schema.

Rules:
- Say what the rows show, naming the figures that matter (the largest and smallest, the total when it helps, a clear change over time).
- Use only the rows given. Do not guess causes you cannot see; say "the rows do not say why" when it matters.
- Write numbers as the rows show them. Keep the summary to three sentences and each point to one.
- Today is {timezone.now().astimezone(zone).date().isoformat()} in the {zone.key} time zone."""
    capped = " (only the first rows; the report has more)" if result.get("truncated") or len(result["rows"]) >= EXPLAIN_ROWS else ""
    user = f"""Report: {name} (dataset {dataset_label})
Rows{capped}:
{table}""" + (f"\n\nColumns left out because they hold personal data: {', '.join(left_out)}." if left_out else "")
    started = time.monotonic()
    usage = {"in": 0, "out": 0}
    try:
        reply, usage = assistant.call_model(chosen["provider"], provider, chosen["model"], system, user, schema=EXPLAIN_SCHEMA, tool="explain_report")
    except assistant.ProviderError as exc:
        assistant._record(tenant.pk, user_id, chosen, f"Explain: {name}"[:1000], "FAILED", None, str(exc), usage, int((time.monotonic() - started) * 1000), None, kind="explain")
        raise
    summary = " ".join(str(reply.get("summary") or "").split())[:1200]
    points = [" ".join(str(p).split())[:400] for p in (reply.get("points") or []) if str(p).strip()][:4]
    caution = " ".join(str(reply.get("caution") or "").split())[:400]
    outcome = "DRAFT" if summary else "FAILED"
    assistant._record(tenant.pk, user_id, chosen, f"Explain: {name}"[:1000], outcome, None, None if summary else "The model gave no summary.",
                      usage, int((time.monotonic() - started) * 1000), None, kind="explain")
    if not summary:
        raise assistant.AssistantError("The model gave no explanation. Try again, or pick another model.")
    return {"summary": summary, "points": points, "caution": caution, "counted": True,
            "model": {k: chosen[k] for k in ("id", "provider_name", "label", "source")}, "rows_sent": min(len(result["rows"]), EXPLAIN_ROWS), "left_out": left_out,
            "usage": assistant.allowance(tenant.pk)}


def _explaining(tenant) -> None:
    if not assistant.explain_allowed():
        raise assistant.AssistantError("Explaining reports is switched off for the platform.")
    switches = assistant.workspace_settings(tenant)
    if not switches["enabled"] or not switches["explain"]:
        raise assistant.AssistantError("Explaining reports is switched off for this workspace (Settings → AI Assistant).")


def default_choice(tenant) -> tuple[dict, dict]:
    """the workspace's default model for an explanation nobody asked a model for (a dashboard's summary tile), within the month's prompts"""
    _explaining(tenant)
    effective = assistant.effective_providers(tenant)
    models = assistant.models_of(effective)
    chosen = next((m for m in models if m["id"] == assistant.default_model(models)), None)
    if chosen is None:
        raise assistant.AssistantError("No AI provider is switched on for this workspace.")
    use = assistant.allowance(tenant.pk)
    if chosen["source"] == "platform" and use["limit"] is not None and use["used"] >= use["limit"]:
        raise assistant.AssistantError(f"The workspace has used its {use['limit']} prompts for {timezone.now().strftime('%B')}.")
    return chosen, effective[chosen["provider"]]


def explain(tenant, request, report: dict, dataset: dict, definition: dict, model_id: str) -> dict:
    _explaining(tenant)
    chosen, provider = _chosen(tenant, request, model_id, need_edit=False)
    try:
        result = runner.run(tenant, request.user, dataset, definition, "run", limit=EXPLAIN_ROWS, report_id=report["id"], report_version=report["version"],
                            mask_pii=not _can_see_pii(request))
    except runner.RunRefused as exc:
        raise assistant.AssistantError(exc.reason) from None
    return written(tenant, request.user.pk, chosen, provider, report["name"], dataset["label"], result)


class ExplainView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None, report_id=None):
        from . import drill
        tenant = _tenant()
        row = _report_row(report_id, request)
        run_rows = catalog.engine_of(tenant.pk)["limits"]["run_rows"]
        raw = row["definition"] if not isinstance(row["definition"], str) else json.loads(row["definition"])
        dataset, definition = _validated(request, {"dataset": row["dataset_key"], "definition": raw}, max_limit=run_rows, reading=True)
        body = request.data if isinstance(request.data, dict) else {}
        try:
            path = drill.path_body(body.get("drill"))
            below = drill.drilled(dataset, definition, path, drill.keeps_rest(body.get("drill")))
            shown = validate(dataset, below, max_limit=run_rows) if below else definition
        except (drill.DrillError, DefinitionError) as exc:
            raise ValidationError({"drill": str(exc)}) from None
        try:
            return Response(explain(tenant, request, row, dataset, shown, str(body.get("model") or "")))
        except assistant.AssistantError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)


# ---------------------------------------------------------------------------------------------------- Change with a Prompt
def change(tenant, request, dataset: dict, definition: dict, prompt: str, model_id: str) -> dict:
    chosen, provider = _chosen(tenant, request, model_id, need_edit=True)
    limits = catalog.engine_of(tenant.pk)["limits"]
    zone = reports.zone_of(tenant)
    current = {k: v for k, v in definition.items() if k in ("columns", "filters", "orderBy", "limit", "view", "derived", "top", "blend")}
    system = assistant.system_prompt([dataset], zone.key, timezone.now().astimezone(zone).date()) + f"""

You are changing an existing report, not starting one. Keep everything the request does not mention: its columns, filters, sort,
view and name. Answer kind "draft" with the whole changed definition, dataset "{dataset['key']}". Custom fields ("derived"), Top N
("top") and linked measures ("blend") in the current report are kept as they are; do not drop their columns.

The current report:
{json.dumps(current, default=str)}"""
    started = time.monotonic()
    usage = {"in": 0, "out": 0}
    result, failure = None, None
    try:
        reply, used = assistant.call_model(chosen["provider"], provider, chosen["model"], system, prompt)
        usage = {k: usage[k] + used[k] for k in usage}
        for attempt in range(2):
            try:
                result = _changed(reply, dataset, current, limits["run_rows"])
                break
            except DefinitionError as exc:
                if attempt:
                    failure = f"The change did not fit the report ({exc.field}: {exc}). Try putting it differently."
                    break
                reply, used = assistant.call_model(chosen["provider"], provider, chosen["model"], system,
                                                   f"{prompt}\n\n(An earlier answer was refused: {exc.field}: {exc}. Keep to the catalogue and the rules.)")
                usage = {k: usage[k] + used[k] for k in usage}
    except assistant.ProviderError as exc:
        failure = str(exc)
    outcome = {"draft": "DRAFT", "question": "QUESTION", "no_field": "NO_FIELD"}[result["kind"]] if result else "FAILED"
    assistant._record(tenant.pk, request.user.pk, chosen, prompt, outcome, result, failure, usage, int((time.monotonic() - started) * 1000), None, kind="change")
    if result is None:
        raise assistant.AssistantError(failure or "The model gave no change.")
    return {**result, "counted": outcome == "DRAFT", "usage": assistant.allowance(tenant.pk)}


def _changed(reply: dict, dataset: dict, current: dict, max_limit: int) -> dict:
    """the model's answer checked: a changed definition (what the model may not touch carried over), a question, or no field"""
    if reply.get("kind") in ("question", "no_field"):
        return assistant.interpret(reply, [dataset], max_limit=max_limit)
    if reply.get("kind") != "draft":
        raise DefinitionError("kind", "Answer with a draft, a question or no_field.")
    raw = reply.get("definition") if isinstance(reply.get("definition"), dict) else {}
    view = reply.get("view") if isinstance(reply.get("view"), dict) else current.get("view") or {}
    raw = {**raw, "view": {k: v for k, v in view.items() if k in ("type", "chart", "across") and v} or {"type": "grid"}}
    for key in ("derived", "top", "blend"):                          # the schema has no room for these: the current ones stay
        if current.get(key) and key not in raw:
            raw[key] = current[key]
    before = current.get("view") or {}
    for key in ("formats", "signals"):                                  # formatting and a chart's signals stay while the view does
        if before.get(key) and raw["view"].get("type") == before.get("type"):
            raw["view"][key] = before[key]
    definition = validate(dataset, raw, max_limit=max_limit)
    return {"kind": "draft", "definition": definition, "view": definition.get("view") or {"type": "grid"}}


class ChangeView(APIView):
    permission_classes = VIEW

    @extend_schema(responses={200: None})
    def post(self, request, version=None):
        body = request.data if isinstance(request.data, dict) else {}
        prompt = " ".join(str(body.get("prompt") or "").split())
        if not prompt or len(prompt) > assistant.PROMPT_MAX:
            raise ValidationError({"prompt": f"Say what to change, in up to {assistant.PROMPT_MAX} characters."})
        tenant = _tenant()
        dataset, definition = _validated(request, body, max_limit=catalog.engine_of(tenant.pk)["limits"]["run_rows"])
        try:
            return Response(change(tenant, request, dataset, definition, prompt, str(body.get("model") or "")))
        except assistant.AssistantError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
