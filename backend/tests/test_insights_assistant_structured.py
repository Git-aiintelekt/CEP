"""Claude answers through structured outputs (output_config.format): Claude Sonnet 5.5, Opus 5.5 and Fable 5.1 refuse a forced
tool_choice (400 "tool_choice: type tool and any are not supported for this model", seen on .51 on 23 October 2026). The schema
goes closed (additionalProperties false on every object, a filter value's types spelled out), the reply is read from the text
block, a refusal or a cut-off answer says so; an older model without structured outputs keeps the forced tool. The provider is
faked."""
import json

import pytest

from apps.insights import assistant
from apps.platform_ops import crypto

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


class Answer:
    status_code, reason, ok = 200, "OK", True

    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


def _open_objects(node, path="$") -> list[str]:
    bad = []
    if isinstance(node, dict):
        if node.get("type") == "object" and node.get("additionalProperties") is not False:
            bad.append(path)
        if node == {}:
            bad.append(path + " (any value)")
        for key, value in node.items():
            bad += _open_objects(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            bad += _open_objects(value, f"{path}[{i}]")
    return bad


def test_structured_outputs(check, monkeypatch):
    sent, replies = [], []

    def fake_post(url, json=None, **kwargs):
        sent.append(json)
        return Answer(replies.pop(0))

    monkeypatch.setattr(assistant.requests, "post", fake_post)
    row = {"api_key_enc": crypto.encrypt("sk-test")}
    draft = {"kind": "draft", "name": "Sent by Campaign", "dataset": "messages", "definition": {"columns": [{"field": "campaign_name"}]}}
    replies.append({"content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": json.dumps(draft)}], "stop_reason": "end_turn",
                    "usage": {"input_tokens": 120, "output_tokens": 40}})
    reply, used = assistant.call_model("anthropic", row, "claude-sonnet-5-5", "system", "Sent by campaign", schema=assistant.schema_for(True))
    body = sent[-1]
    check("Claude Sonnet 5.5 is asked through output_config.format, never a forced tool", "tool_choice" not in body and "tools" not in body
          and body["output_config"]["format"]["type"] == "json_schema" and body["output_config"]["effort"] == "medium" and body["max_tokens"] == 16000, json.dumps(body)[:300])
    check("the schema sent is closed everywhere and types a filter's value", _open_objects(body["output_config"]["format"]["schema"]) == [],
          _open_objects(body["output_config"]["format"]["schema"]))
    check("the schema the code reads with is unchanged", "additionalProperties" not in assistant.SCHEMA)
    check("the reply is read from the text block, the thinking block skipped", reply == draft and used == {"in": 120, "out": 40}, reply)

    for stop, words in (("refusal", "declined"), ("max_tokens", "cut off")):
        replies.append({"content": [], "stop_reason": stop, "usage": {}})
        try:
            assistant.call_model("anthropic", row, "claude-opus-5-5", "system", "x")
            check(f"a {stop} stop says so", False)
        except assistant.ProviderError as exc:
            check(f"a {stop} stop says so", words in str(exc), str(exc))

    replies.append({"content": [{"type": "text", "text": "not json"}], "stop_reason": "end_turn", "usage": {}})
    check("text that is not JSON reads as an empty reply, for the retry", assistant.call_model("anthropic", row, "claude-haiku-5-5", "system", "x")[0] == {}
          and "effort" in sent[-1]["output_config"])

    replies.append({"content": [{"type": "tool_use", "input": {"kind": "question"}}], "stop_reason": "tool_use", "usage": {}})
    reply, _ = assistant.call_model("anthropic", row, "claude-sonnet-4-5", "system", "x", schema=assistant.SQL_SCHEMA, tool="write_sql")
    check("an older model without structured outputs keeps the forced tool", sent[-1]["tool_choice"] == {"type": "tool", "name": "write_sql"}
          and "output_config" not in sent[-1] and reply == {"kind": "question"}, json.dumps(sent[-1])[:200])
    check.done()
