"""Mailgun Inspect (the former Email on Acid): client previews of an email across inbox clients and devices.

Base:     https://api.mailgun.net (US) or https://api.eu.mailgun.net (EU), HTTP basic auth with the account's username and API key.
Clients:  GET  /v1/preview/tests/clients                       -> {"clients": {"<id>": {id, client, os, category, browser?, default, image_blocking}}}
Create:   POST /v2/preview/tests  {subject, html (base64), transfer_encoding base64, charset, clients[], image_blocking, reference_id,
                                   content_checking{all false}}  -> {"id": ...}
Progress: GET  /v1/preview/tests/<id>                            -> {completed[], processing[], bounced[]}
Results:  GET  /v1/preview/tests/<id>/results                    -> {"<client id>": {display_name, client, os, category, browser, screenshots{default,...},
                                                                     thumbnail, full_thumbnail, status Complete|Processing|Bounced|Pending}}
Every call goes through the integration bridge's logged session, like a sending engine's.
"""
from __future__ import annotations

import base64

import requests

from apps.delivery.providers.base import ProviderError

BASES = {"US": "https://api.mailgun.net", "EU": "https://api.eu.mailgun.net"}
PROVIDER_TYPE = "MAILGUN_INSPECT"
TIMEOUT = 30


class InspectClient:
    """One workspace's Inspect account. Looks like an adapter to the outbound guard, which is what logs and throttles it."""
    provider_type = PROVIDER_TYPE
    rate_limit_per_minute = None

    def __init__(self, *, username: str, api_key: str, region: str = "US", provider_id: str = "", tenant_id: str = "", provider_name: str = "Mailgun Inspect"):
        self.base = BASES.get((region or "US").upper(), BASES["US"])
        self.auth = (username or "api", api_key or "")
        self.provider_id = provider_id
        self.tenant_id = tenant_id
        self.provider_name = provider_name
        self.guard = None
        self._session = None

    def session(self):
        if self._session is None:
            from apps.integrations.bridge.outbound import Guard, LoggedSession
            if self.guard is None:
                self.guard = Guard(self)
            self._session = LoggedSession(self.guard)
            self._session.auth = self.auth
            self._session.headers.update({"Accept": "application/json"})
        return self._session

    def close(self) -> None:
        if self._session is not None:
            self._session.close()
            self._session = None

    def _call(self, method: str, path: str, **kwargs):
        try:
            response = self.session().request(method, self.base + path, timeout=TIMEOUT, **kwargs)
        except requests.RequestException as exc:
            raise ProviderError(f"Cannot reach Mailgun Inspect: {exc.__class__.__name__}: {exc}") from exc
        if response.status_code in (401, 403):
            raise ProviderError("Mailgun Inspect refused the username or API key.", retryable=False)
        if response.status_code == 402:
            raise ProviderError("Mailgun Inspect answered 402: the account's preview allowance is used up or the plan does not include this test.", retryable=False)
        if response.status_code == 404:
            raise ProviderError("Mailgun Inspect knows no such test.", retryable=False)
        if response.status_code >= 400:
            raise ProviderError(f"Mailgun Inspect answered HTTP {response.status_code}: {_detail(response)}".strip())
        try:
            return response.json() if response.content else {}
        except ValueError:
            raise ProviderError("Mailgun Inspect answered with something that is not JSON.") from None

    # ---- what the product calls
    def check(self) -> tuple[bool, str]:
        """True when the credential works; the clients call is free."""
        try:
            self.clients()
            return True, ""
        except ProviderError as exc:
            return False, str(exc)
        finally:
            self.close()

    def clients(self) -> list[dict]:
        """Every client Inspect can render in, flattened and sorted by category then name."""
        payload = self._call("GET", "/v1/preview/tests/clients")
        rows = []
        for key, item in (payload.get("clients") or {}).items():
            if not isinstance(item, dict):
                continue
            rows.append({"id": str(item.get("id") or key), "client": str(item.get("client") or key), "os": str(item.get("os") or ""),
                         "category": str(item.get("category") or ""), "browser": str(item.get("browser") or ""),
                         "default": bool(item.get("default")), "image_blocking": bool(item.get("image_blocking"))})
        return sorted(rows, key=lambda row: (row["category"], row["client"], row["os"], row["browser"]))

    def create_preview(self, *, subject: str, html: str, clients: list[str], image_blocking: bool = False, reference_id: str = "") -> str:
        # transfer_encoding says how `html` is encoded, not how to mail it: raw HTML labelled quoted-printable made Inspect
        # decode every "=" of the markup and answer 400 "error while getting html from source". Base64 carries any character.
        encoded = base64.b64encode(html.encode("utf-8")).decode("ascii")
        body = {"subject": subject or "(no subject)", "html": encoded, "charset": "utf-8", "transfer_encoding": "base64", "image_blocking": bool(image_blocking),
                "content_checking": {"link_validation": False, "image_validation": False, "accessibility": False, "code_analysis": False}}
        if clients:
            body["clients"] = list(clients)
        if reference_id:
            body["reference_id"] = reference_id[:100]
        payload = self._call("POST", "/v2/preview/tests", json=body)
        test_id = str(payload.get("id") or "")
        if not test_id:
            raise ProviderError("Mailgun Inspect accepted the test but returned no id.")
        return test_id

    def progress(self, test_id: str) -> dict:
        payload = self._call("GET", f"/v1/preview/tests/{test_id}")
        return {"completed": list(payload.get("completed") or []), "processing": list(payload.get("processing") or []), "bounced": list(payload.get("bounced") or [])}

    def results(self, test_id: str) -> dict[str, dict]:
        """Per client: what the panel shows. Screenshot addresses are Inspect's own, signed and time-limited."""
        payload = self._call("GET", f"/v1/preview/tests/{test_id}/results")
        out = {}
        for key, item in (payload or {}).items():
            if not isinstance(item, dict):
                continue
            shots = item.get("screenshots") or {}
            out[str(item.get("id") or key)] = {
                "id": str(item.get("id") or key), "name": str(item.get("display_name") or item.get("client") or key), "client": str(item.get("client") or ""),
                "os": str(item.get("os") or ""), "category": str(item.get("category") or ""), "browser": str(item.get("browser") or ""),
                "status": _status(item.get("status")), "detail": str(item.get("status_details") or ""),
                "screenshot": str(shots.get("default") or shots.get("full") or ""), "screenshot_no_images": str(shots.get("no_images") or ""),
                "thumbnail": str(item.get("thumbnail") or shots.get("thumb") or ""), "full_thumbnail": str(item.get("full_thumbnail") or ""),
            }
        return out


def _status(value) -> str:
    word = str(value or "").strip().lower()
    if word == "complete":
        return "COMPLETE"
    if word in {"bounced", "failed", "error"}:
        return "FAILED"
    if word == "processing":
        return "PROCESSING"
    return "PENDING"


def _detail(response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:160]
    if isinstance(payload, dict):
        for key in ("message", "error", "detail"):
            if payload.get(key):
                return str(payload[key])[:160]
    return str(payload)[:160]
