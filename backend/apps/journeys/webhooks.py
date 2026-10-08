"""The Webhook step (phase 7 of the journey gaps): a signed POST with the customer and journey context.

    config  {url, secret_enc?, label?, include_attributes?}      the secret is entered as `secret` and kept encrypted (crypto.encrypt)

The POST carries JSON (`payload`) and the headers Content-Type: application/json, X-CEP-Event, X-CEP-Delivery (one id per call),
X-CEP-Timestamp and, when the step has a secret, X-CEP-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>" with the secret>.
A 2xx answer is success; 429 and 5xx, a timeout or a connection error are temporary (the step is retried, apps.journeys.engine.retries);
any other 4xx is permanent. Every call, test calls included, is written to the integration log (system WEBHOOK, kind JOURNEY_STEP,
related_ref journey:<journey id>:<node key>:<enrollment id>), which the journey page's Webhook Calls card reads.
"""
import hashlib
import hmac
import json
import re
import uuid
from urllib.parse import urlparse

import requests
from django.utils import timezone

from apps.delivery.engine import session
from apps.integrations.bridge import logbook
from apps.platform_ops import crypto

from .engine.outcome import Done

TIMEOUT = 10
MAX_URL = 2000
MAX_RESPONSE = 1000
EVENT = "journey.step"
SYSTEM, KIND = "WEBHOOK", "JOURNEY_STEP"
URL_OK = re.compile(r"^https?://[^\s/$.?#].[^\s]*$", re.I)


def problem(config: dict) -> str | None:
    url = config.get("url")
    if not isinstance(url, str) or not url.strip():
        return "Enter the address to call."
    url = url.strip()
    if len(url) > MAX_URL or not URL_OK.match(url):
        return "The address is a full http(s) URL."
    parsed = urlparse(url)
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
        return "The address must be https (http is only allowed for localhost)."
    return None


def configured(config: dict) -> bool:
    return problem(config) is None


def clean_config(config: dict) -> dict:
    """A plain `secret` entered in the panel is kept encrypted as secret_enc; "" clears it; absent keeps what is stored."""
    cleaned = dict(config)
    if "secret" in cleaned:
        plain = cleaned.pop("secret")
        if plain is None or plain == "":
            cleaned.pop("secret_enc", None)
        elif isinstance(plain, str):
            cleaned["secret_enc"] = crypto.encrypt(plain.strip()[:200])
    if isinstance(cleaned.get("url"), str):
        cleaned["url"] = cleaned["url"].strip()
    return cleaned


def host_of(config: dict) -> str:
    try:
        return urlparse(str(config.get("url") or "")).hostname or "a webhook"
    except ValueError:
        return "a webhook"


def describe(config: dict) -> str:
    return f"Webhook: {host_of(config)}" if config.get("url") else "No address set"


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), timestamp.encode("utf-8") + b"." + body, hashlib.sha256).hexdigest()


def payload(journey, version_number: int | None, node_key: str, label: str | None, enrollment, customer: dict | None, include_attributes: bool) -> dict:
    customer = customer or {}
    attributes = customer.get("custom_attributes") or {}
    return {
        "event": EVENT, "sent_at": timezone.now().isoformat(), "delivery_id": str(uuid.uuid4()),
        "journey": {"id": str(journey.pk), "code": journey.code, "name": journey.name, "version": version_number},
        "step": {"key": node_key, "label": label},
        "customer": {"party_id": enrollment.party_id if enrollment else customer.get("party_id"), "first_name": customer.get("first_name"), "last_name": customer.get("last_name"),
                     "email": customer.get("email"), "phone": customer.get("phone"), **({"attributes": attributes} if include_attributes else {})},
        "enrollment": None if enrollment is None else {"id": str(enrollment.pk), "status": enrollment.status, "enrolled_at": enrollment.enrolled_at.isoformat() if enrollment.enrolled_at else None,
                                                       "converted_at": enrollment.converted_at.isoformat() if getattr(enrollment, "converted_at", None) else None},
    }


def _customer(tenant_id, party_id) -> dict | None:
    with session.connection().cursor() as cursor:
        cursor.execute("""SELECT party_id, first_name, last_name, lower(emails -> 0 ->> 'address'), phones -> 0 ->> 'number', custom_attributes
                            FROM customer_master WHERE tenant_id = %s AND party_id = %s""", [str(tenant_id), party_id])
        row = cursor.fetchone()
    if row is None:
        return None
    attributes = row[5]
    if isinstance(attributes, str):
        try:
            attributes = json.loads(attributes)
        except ValueError:
            attributes = {}
    return {"party_id": row[0], "first_name": row[1], "last_name": row[2], "email": row[3], "phone": row[4], "custom_attributes": attributes or {}}


def post(tenant_id, config: dict, body: dict, related_ref: str, attempt: int = 1) -> dict:
    """One signed POST, logged. -> {ok, status, retry, error, duration_ms, delivery_id}"""
    url = str(config.get("url") or "").strip()
    raw = json.dumps(body, separators=(",", ":"), default=str).encode("utf-8")
    timestamp = str(int(timezone.now().timestamp()))
    headers = {"Content-Type": "application/json", "User-Agent": "CEP-Journeys/1.0", "X-CEP-Event": EVENT, "X-CEP-Delivery": body.get("delivery_id") or str(uuid.uuid4()),
               "X-CEP-Timestamp": timestamp}
    secret = crypto.decrypt(config.get("secret_enc")) if config.get("secret_enc") else None
    if secret:
        headers["X-CEP-Signature"] = sign(secret, timestamp, raw)
    watch = logbook.Stopwatch()
    outcome: dict
    try:
        response = requests.post(url, data=raw, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as error:
        outcome = {"ok": False, "status": None, "retry": True, "error": f"{type(error).__name__}: {str(error)[:200]}", "duration_ms": watch.ms(), "delivery_id": headers["X-CEP-Delivery"]}
        logbook.record(tenant_id=tenant_id, integration=None, direction="OUT", kind=KIND, system=SYSTEM, method="POST", url=url, outcome="ERROR", related_ref=related_ref,
                       request_headers=headers, request_body=raw, error_class=type(error).__name__, error_message=str(error), attempt=attempt, duration_ms=outcome["duration_ms"])
        return outcome
    status = response.status_code
    ok = 200 <= status < 300
    retry = status == 429 or status >= 500
    outcome = {"ok": ok, "status": status, "retry": retry, "error": None if ok else f"The endpoint answered {status}", "duration_ms": watch.ms(), "delivery_id": headers["X-CEP-Delivery"],
               "response": response.text[:MAX_RESPONSE]}
    logbook.record(tenant_id=tenant_id, integration=None, direction="OUT", kind=KIND, system=SYSTEM, method="POST", url=url, outcome="OK" if ok else "RETRY" if retry else "REJECTED",
                   related_ref=related_ref, request_headers=headers, request_body=raw, response_status=status, response_headers=dict(response.headers),
                   response_body=response.content, attempt=attempt, duration_ms=outcome["duration_ms"])
    return outcome


def run(node, state, enrollment) -> Done:
    """The step: POST the customer and journey context; temporary trouble is retried, a refusal is recorded and the customer carries on."""
    config = node.config or {}
    found = problem(config)
    if found:
        return Done("FAILED", {"reason": found})
    journey = enrollment.journey
    customer = _customer(enrollment.tenant_id, enrollment.party_id)
    attempt = ((state.state_data.get("retry") or {}).get("attempts") or 0) + 1 if (state.state_data.get("retry") or {}).get("step") == node.node_key else 1
    body = payload(journey, getattr(node.journey_version, "version_number", None), node.node_key, config.get("label"), enrollment, customer, bool(config.get("include_attributes")))
    outcome = post(enrollment.tenant_id, config, body, f"journey:{journey.pk}:{node.node_key}:{enrollment.pk}", attempt=attempt)
    result = {"url": config.get("url"), "status": outcome["status"], "duration_ms": outcome["duration_ms"], "delivery_id": outcome["delivery_id"]}
    if outcome["ok"]:
        return Done(result=result)
    return Done("FAILED", {**result, "reason": outcome["error"]}, retry=outcome["retry"])


def test_call(journey, config: dict) -> dict:
    """Send a Test Call: a sample customer, the same headers and signature, logged like a real call."""
    found = problem(config)
    if found:
        return {"ok": False, "status": None, "error": found, "duration_ms": 0}
    sample = {"party_id": "sample-customer", "first_name": "Sample", "last_name": "Customer", "email": "sample@example.com", "phone": "+10000000000",
              "custom_attributes": {"loyalty_tier": "GOLD"}}
    body = payload(journey, None, "test", config.get("label") or "Test call", None, sample, bool(config.get("include_attributes")))
    body["event"] = "journey.test"
    outcome = post(journey.tenant_id, config, body, f"journey:{journey.pk}:test", attempt=1)
    return {key: outcome.get(key) for key in ("ok", "status", "error", "duration_ms", "response")}


CALLS_SQL = """
SELECT id, started_at, url, response_status, outcome, error_message, attempt, duration_ms, related_ref
  FROM integration_log
 WHERE tenant_id = %(tenant)s AND system = %(system)s AND related_ref LIKE %(prefix)s
 ORDER BY started_at DESC, id DESC LIMIT %(limit)s"""


def calls(journey, limit: int = 50) -> list[dict]:
    """The journey's last webhook calls, newest first, from the integration log."""
    with session.connection().cursor() as cursor:
        cursor.execute(CALLS_SQL, {"tenant": str(journey.tenant_id), "system": SYSTEM, "prefix": f"journey:{journey.pk}:%", "limit": max(1, min(int(limit), 200))})
        rows = cursor.fetchall()
    found = []
    for log_id, started_at, url, status, outcome, error, attempt, duration_ms, related_ref in rows:
        parts = (related_ref or "").split(":")
        found.append({"id": log_id, "called_at": started_at, "url": url, "status": status, "outcome": outcome, "error": error, "attempt": attempt, "duration_ms": duration_ms,
                      "node_key": parts[2] if len(parts) > 2 else None, "enrollment_id": parts[3] if len(parts) > 3 else None, "test": len(parts) > 2 and parts[2] == "test"})
    return found
