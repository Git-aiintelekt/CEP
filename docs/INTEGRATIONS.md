# Integration bridge

Every exchange with an outside system goes through one gate: throttled, protected by a circuit breaker, and written to a
per-tenant log with the request and the answer. Code: `backend/apps/integrations/bridge/`. Schema: section 17 of
`database/CEP_Database_Schema_Platform_Operations.sql` (patch `0019_integration_bridge.sql`).

## 1. The shape of it

```
 POS ──POST /api/v1/receipts/send/──▶ ReceiptSendView (InboundLogMixin)
        │   ApiKeyRateThrottle        api_client.rate_limit_per_minute        429 + Retry-After, X-RateLimit-*
        │   WorkspaceInboundThrottle  integration.throttle_per_minute | integrations.inbound_per_minute[plan]
        │   paused?                   503 integration_paused
        ▼
   receipts.send ─▶ adapter.send_guarded(message, related_ref="receipt:R-1001")
        │   Guard: paused → wait  ·  Breaker open → RETRY without a call  ·  throttle.wait (shared window, all workers)
        │   LoggedSession: every HTTP call → integration_log (OUT), headers redacted, card numbers masked
        ▼
   Postal / SendGrid / Digivize ──callback──▶ delivery_webhook ─▶ integration_log (IN, related_ref="provider:<id>")

   integration_log ──rollup-integration-metrics (every 5 min)──▶ integration_metric (per minute: calls, ok, rejected,
   retried, errors, throttled, p50/p95/max ms, bytes)  ──▶ Settings → Integrations, back-office Integrations, health check
```

The same `X-Correlation-Id` ties a receipt's inbound row to the outbound send it caused: the caller may send one; the
middleware mints one otherwise and every answer carries it.

## 2. Tables

| Table | What a row is |
|---|---|
| `integration` | One per tenant per outside system: `POS_RECEIPTS` (IN) or a `PROVIDER` (OUT, one per `delivery_provider`). Holds the policy: `status` ACTIVE/PAUSED, `throttle_per_minute`, `throttle_burst`, `retry_max_attempts`, `breaker_failures`, `breaker_cooldown_seconds`, `log_level` FULL/ERRORS/NONE, `log_body_max_bytes`, `log_retention_days`, plus `last_call_at`, `last_outcome`, `last_error`, `breaker_open_until`. Made lazily at the first call, or by onboarding, with the platform defaults. |
| `integration_log` | One per call in either direction. `direction`, `system`, `correlation_id`, `related_ref` (`receipt:<number>`, `mailer_execution:<id>`, `sms_execution:<id>`, `provider:<id>`), method, URL, request headers/body/bytes, response status/headers/body/bytes, `outcome`, `error_class`, `error_message`, `attempt`, `duration_ms`, `api_client_id`, `worker`. Partitioned by tenant (LIST) and month (the retention policy drops partitions older than 3 months). |
| `integration_metric` | Per integration per minute, rolled up from the log. What the status cards and charts read; the log is never scanned for a chart. |

One engine can hold two credentials (Postal: the API keys of a bulk and a transactional mail server); a message's `traffic`
(BULK for marketing campaigns, TRANSACTIONAL for receipts and non-marketing campaigns) picks the key and the throttle lane.
See `docs/DELIVERY_PROVIDERS.md` section 5.

Outcomes: `OK`, `REJECTED` (4xx, the message's own fault), `RETRY` (5xx / timeout, retried), `ERROR`, `THROTTLED`,
`BREAKER` (refused because the circuit is open), `PAUSED`.

## 3. Throttling

Fixed windows in the Django cache (Redis), shared by every worker and API process, so a tenant's pace is the same
whether one worker or ten are sending: a per-minute counter and a per-second burst counter per scope.

| Scope | Limit | On refusal |
|---|---|---|
| `apikey:<client>` | `api_client.rate_limit_per_minute` (Settings → API keys) | 429, `Retry-After`, `X-RateLimit-Limit/Remaining/Reset` |
| `inbound:<tenant>:<kind>` | the integration's `throttle_per_minute`, else `integrations.inbound_per_minute[plan]` (Starter 60, Growth 600, Enterprise unlimited) | same |
| `provider:<engine id>` (`:transactional` appended for receipts and other transactional mail when the engine holds a second credential, patch 0020) | the integration's `throttle_per_minute`, else the engine's `rate_limit_per_minute` | the worker waits up to 5 s for room, then hands the message back as retryable with a `THROTTLED` row |

A second may carry the even pace or 10 calls, whichever is more, within the minute's limit; `throttle_burst` adds to
that. Every answer of a throttled endpoint carries the `X-RateLimit-*` headers, so an integrator can pace itself.

## 4. Circuit breaker

`breaker_failures` consecutive `RETRY`/`ERROR` outcomes open the circuit for `breaker_cooldown_seconds`: sends are handed
back as retryable at once (a `BREAKER` row, no HTTP call), `integration.breaker_open_until` mirrors it for the status
pages, and the next send after the cooldown probes the engine. A success closes it. **Resume** on the integration (tenant
Settings or back-office) closes it immediately; the back-office also has a "Close the circuit" action.

## 5. What is stored, what is masked

Bodies are stored as sent, up to `log_body_max_bytes` (default 64 KB): a longer body keeps its start and a SHA-256
digest of the whole. `Authorization`, `X-Server-API-Key`, `X-Api-Key`, `X-Signature`, cookies and the like are replaced
by `***` in headers. Card numbers (13–19 digits passing Luhn, and the JSON keys `card_number`, `pan`, `card_no`,
`cvv` and the like) are masked to `***` in bodies; nothing else is, by the product decision that the log must show
exactly what was exchanged. `log_level` `ERRORS` keeps bodies only for failed calls; `NONE` keeps nothing but updates
the last-call fields.

## 6. Where to look

| Page | Who | Shows |
|---|---|---|
| Settings → Integrations (`/settings/integrations`, permission `provider.edit`) | tenant administrator | A card per integration: health (healthy / degraded ≥5 % failures / circuit open / paused / no calls), calls, failure rate, p95, throttled, last call, effective limit; Pause / Resume. The call log with filters (integration, direction, failures only, correlation id or reference); a call opens with its request and answer. |
| Back-office → Integrations | platform staff | Every tenant's records; edit throttle, retries, breaker and log policy; pause / resume / close the circuit. |
| Back-office → Integration log | platform staff | Every call across tenants, searchable by correlation id, reference or URL. |
| Back-office home → Integrations check; `alerts` | platform staff | Warns when an integration has its circuit open or a quarter of its calls failed in the last 15 minutes. |

Endpoints: `GET /api/v1/integrations/`, `GET /api/v1/integrations/log/?integration=&direction=&outcome=&failed=1&q=&before=`
(100 rows a page, `next_before` for the next), `GET /api/v1/integrations/log/{id}/`, `GET /api/v1/integrations/{id}/metrics/?hours=`,
`POST /api/v1/integrations/{id}/pause/` and `/resume/`.

Global parameters (Configuration → Global parameters): `integrations.inbound_per_minute`, `integrations.log_body_max_bytes`,
`integrations.log_retention_days`, `integrations.metric_retention_months`.

The POS sends one receipt per call to `POST /api/v1/receipts/send/`; there is no batch endpoint, by decision.

## 7. Adding an engine to the bridge

An adapter that extends `EmailProvider` / `SmsProvider` and makes its HTTP calls through `self.new_session()` (a
`requests.Session` that logs) is covered without further work: `send_guarded()` wraps `send()` with the guard, and an
adapter that does not speak HTTP (the sandbox) still gets one synthetic `SEND` row per message. Set `related_ref`
from the caller so a row can be traced back to its message.

## 8. Not in this release

- The Digivize SMS adapter: the External API (documented at documenter.getpostman.com/view/2956319/2sBYAsyXk4) signs
  every request with HMAC-SHA256 over a canonical string that the documentation shows only for query-string requests;
  the canonical form for a JSON body has to be confirmed with Digivize before the adapter can be finished. The adapter
  skeleton is in `providers/digivize.py`, unregistered.
- Charts on the tenant page: the metrics endpoint exists; the page shows the day's figures and the log.
- On a tenant with a dedicated database, an inbound row for a 5xx answer is rolled back with the request (the pool's
  tenants write theirs through the platform connection); the server log keeps the essentials.
