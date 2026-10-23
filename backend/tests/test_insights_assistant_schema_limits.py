"""Claude's structured outputs allow 24 optional properties and 16 union-typed ones across a request's schemas; above that the API
answers 400 ("Schemas contains too many optional parameters (32) ... limit: 24", seen on .51 on 23 October 2026 with Ask About on a
database and its tables not mapped yet). Every schema is sent with all its properties required, an optional choice offering "",
and the model told to leave what does not apply empty; the empties are dropped before the reply is read, so a draft reads the
same either way. The provider is faked."""
import json

import pytest

from apps.insights import ai_report, assistant
from apps.platform_ops import crypto

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

OPTIONAL_MAX, UNION_MAX = 24, 16
SCHEMAS = {"report": assistant.schema_for(False), "report on tables not mapped yet": assistant.schema_for(True), "sql": assistant.SQL_SCHEMA,
           "explain": ai_report.EXPLAIN_SCHEMA}


def _count(node) -> tuple[int, int]:
    """(optional properties, union-typed properties) as the API counts them: every property not in required, every anyOf or type array"""
    optional = unions = 0
    if isinstance(node, dict):
        required = set(node.get("required") or [])
        for name, sub in (node.get("properties") or {}).items():
            optional += name not in required
            unions += isinstance(sub, dict) and ("anyOf" in sub or isinstance(sub.get("type"), list))
        for value in node.values():
            o, u = _count(value)
            optional, unions = optional + o, unions + u
    elif isinstance(node, list):
        for value in node:
            o, u = _count(value)
            optional, unions = optional + o, unions + u
    return optional, unions


def test_every_schema_sent_is_within_the_limits(check):
    for name, schema in SCHEMAS.items():
        optional, unions = _count(assistant.strict_schema(schema))
        check(f"{name}: no optional property and at most {UNION_MAX} unions as sent", optional == 0 and unions <= UNION_MAX, (optional, unions))
    check("before, the report schema with tables not mapped yet had more optional properties than the API takes",
          _count(SCHEMAS["report on tables not mapped yet"])[0] > OPTIONAL_MAX, _count(SCHEMAS["report on tables not mapped yet"]))
    sent = assistant.strict_schema(SCHEMAS["report"])
    check("an optional choice offers an empty value; a required one does not",
          "" in sent["properties"]["view"]["properties"]["type"]["enum"] and "" not in sent["properties"]["kind"]["enum"])
    check("the schema the code reads with keeps its optional properties", assistant.SCHEMA["required"] == ["kind"])
    check.done()


def test_empty_values_are_dropped(check):
    sparse = {"kind": "draft", "name": "Sent by Status", "dataset": "messages", "view": {"type": "chart", "chart": "pie"},
              "definition": {"columns": [{"field": "channel"}, {"field": "sent", "aggregate": "sum"}],
                             "filters": {"combinator": "and", "rules": [{"field": "sent", "operator": ">", "value": 0}]}}}
    full = {"kind": "draft", "name": "Sent by Status", "dataset": "messages", "view": {"type": "chart", "chart": "pie", "across": ""},
            "definition": {"columns": [{"field": "channel", "aggregate": "", "bucket": "", "compare": [], "target": 0},
                                       {"field": "sent", "aggregate": "sum", "bucket": "", "compare": [], "target": 0}],
                           "filters": {"combinator": "and", "rules": [{"field": "sent", "operator": ">", "value": 0}]}, "orderBy": [], "limit": 0},
            "question": "", "answers": [], "message": "", "suggestions": [], "note": "", "tables": [],
            "new_dataset": {"label": "", "source": "", "joins": [], "fields": []}}
    check("a reply with every field present reads as the same reply without the empty ones", assistant.without_empty(full) == sparse,
          json.dumps(assistant.without_empty(full)))
    check("a filter's value of 0 is kept; a target or limit of 0 is not",
          assistant.without_empty({"value": 0, "target": 0, "limit": 0, "n": 0}) == {"value": 0, "n": 0})
    check("empty items leave a list", assistant.without_empty({"points": ["One finding", "", "Another"]}) == {"points": ["One finding", "Another"]})
    check.done()


def test_the_request_asks_for_empty_values(check, monkeypatch):
    sent = []

    class Answer:
        status_code, reason, ok = 200, "OK", True

        def json(self):
            return {"content": [{"type": "text", "text": json.dumps({"kind": "question", "question": "Which period?", "answers": [{"label": "A", "prompt": "a"}, {"label": "B", "prompt": "b"}],
                                                                       "name": "", "dataset": "", "note": "", "message": "", "suggestions": []})}],
                    "stop_reason": "end_turn", "usage": {"input_tokens": 10, "output_tokens": 5}}

    monkeypatch.setattr(assistant.requests, "post", lambda url, json=None, **kwargs: sent.append(json) or Answer())
    reply, _ = assistant.call_model("anthropic", {"api_key_enc": crypto.encrypt("sk-test")}, "claude-sonnet-5-5", "The rules.", "Revenue last month", schema=assistant.schema_for(True))
    body = sent[-1]
    check("the system prompt says every field is present, empty when it does not apply", body["system"] == f"The rules.\n\n{assistant.EMPTY_NOTE}")
    check("the schema sent has every property required", _count(body["output_config"]["format"]["schema"])[0] == 0)
    check("the reply comes back without the empty fields", reply == {"kind": "question", "question": "Which period?", "answers": [{"label": "A", "prompt": "a"}, {"label": "B", "prompt": "b"}]}, reply)
    check.done()
