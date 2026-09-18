# Campaign send engine and delivery provider integrations

How a published campaign becomes email in inboxes, and how a third-party sending service (Postal, SendGrid, your own
SMTP server, the next one) plugs in. Code: `backend/apps/delivery/`.

## 1. The shape of it

```
 publish ─▶ campaign_run (SCHEDULED)
              │  workers.campaign.start_run        (or the dispatch-campaign-runs job, every minute)
              ▼
        engine/runs.start ──▶ engine/audience.build        campaign_list + campaign_list_member (ELIGIBLE / SUPPRESSED + reason)
              │                                            mailer_execution rows (QUEUED, idempotency key)
              ▼  batches of provider.max_batch
        workers.email.send_batch ──▶ engine/dispatch.send_batch
              │     per message:  claim ─▶ engine/render ─▶ PROVIDER ADAPTER .send() ─▶ record
              ▼
        engine/runs.finalize ──▶ campaign_run COMPLETED | FAILED, campaign COMPLETED

 provider ──HTTP callback──▶ api/v1/delivery_public.delivery_webhook
              │     adapter.verify_webhook() ─▶ adapter.parse_webhook() ─▶ [DeliveryEvent]
              ▼
        delivery_webhook_event (raw, kept) ─▶ engine/events.apply ─▶ mailer_execution status, contact_point_status, consent

 person  ──click──▶ /api/v1/public/unsubscribe/?t=<signed token> ─▶ consent_record + consent_suppression (OPTED_OUT)
```

The engine never mentions a provider by name. Everything provider-specific lives behind one interface.

## 2. The adapter contract (`apps/delivery/providers/base.py`)

| You implement | The engine gives / expects |
|---|---|
| `provider_type`, `label`, `description` | `provider_type` is the value stored in `delivery_provider.provider_type` |
| `config_fields: tuple[ConfigField, ...]` | The form shown in **Settings → Delivery**. `secret=True` fields are write-only and stored encrypted; the rest go to `delivery_provider.config` (JSON). |
| `open()` / `close()` | Called once around a batch: keep an HTTP session or an SMTP connection. |
| `send(EmailMessage) -> SendResult` | `ACCEPTED` (+ `provider_message_id`), `REJECTED` (permanent, this message only), `RETRY` (temporary). Raise `ProviderError(retryable=False)` only when nothing can be sent at all (bad key, suspended account). |
| `check() -> (ok, detail)` | The **Check** button: validate address + credential without sending. |
| `verify_webhook(headers, raw_body) -> bool` | The provider's own signature scheme. The URL already carries an unguessable token, so return `True` when the provider has none or no key is configured. |
| `parse_webhook(payload) -> list[DeliveryEvent]` | Translate the provider's vocabulary into `DELIVERED, BOUNCED (HARD/SOFT), DEFERRED, DROPPED, COMPLAINED, OPENED, CLICKED, UNSUBSCRIBED`. Fill `idempotency_key` when the provider echoes our metadata (most reliable), otherwise `provider_message_id`. |
| `max_batch`, `supports_webhooks`, `manageable` | Batch size per worker task; whether a callback address is shown; `manageable=False` for providers created by another screen (SMTP follows **Settings → Email server**). |

`EmailMessage` carries: recipient and sender (name + address), reply-to, subject, HTML and text parts, headers
(`List-Unsubscribe`, `List-Unsubscribe-Post` for marketing), `idempotency_key`
(`<tenant>:<run>:<party>:EMAIL:v<content version>`), `tag` (campaign code) and `metadata` (tenant code, run id).

### What each outcome does

| `SendResult` | `mailer_execution` | Then |
|---|---|---|
| `ACCEPTED` | `SUBMITTED`, `provider_message_id` stored, list member `SENT` | Webhooks move it on to `DELIVERED / OPENED / CLICKED / BOUNCED / COMPLAINED` |
| `REJECTED` | `FAILED` with the provider's reason | Never retried |
| `RETRY` | back to `QUEUED` | The batch is retried after 1, 5, 15, 30, 60 minutes; after 5 attempts the message is `FAILED` and copied to `dead_letter_message` |
| `ProviderError(retryable=False)` | every queued message of the run `FAILED` with the reason | The run ends `FAILED`: fix the provider, publish again |

Delivery is **at most once**: a message is claimed (`QUEUED → SUBMITTED`, committed) before it is handed to the provider,
so a worker that dies mid-batch cannot send anything twice. A claim that never got the provider's answer is turned into
a visible `FAILED` ("Interrupted before the provider confirmed") after 15 minutes.

## 3. Adding a provider (example: Amazon SES)

1. **One module**, `apps/delivery/providers/ses.py`:

   ```python
   from .base import ConfigField, DeliveryEvent, EmailMessage, EmailProvider, EventType, ProviderError, SendResult
   from .registry import register

   @register
   class SesProvider(EmailProvider):
       provider_type = "SES"
       label = "Amazon SES"
       description = "Amazon Simple Email Service. Callbacks through SNS."
       supports_webhooks = True
       config_fields = (
           ConfigField("region", "AWS region", placeholder="eu-west-1"),
           ConfigField("access_key_id", "Access key id"),
           ConfigField("secret_access_key", "Secret access key", secret=True),
           ConfigField("configuration_set", "Configuration set", required=False),
       )

       def send(self, message: EmailMessage) -> SendResult: ...
       def check(self) -> tuple[bool, str]: ...
       def verify_webhook(self, headers, body) -> bool: ...      # SNS message signature
       def parse_webhook(self, payload) -> list[DeliveryEvent]: ...
   ```

2. **Register the import** in `registry._load()` (`from . import postal, sendgrid, ses, smtp`).
3. **Allow the type in the database**: add `'SES'` to `ck_delivery_provider_provider_type` and
   `ck_delivery_webhook_event_provider` (section 9 of `database/CEP_Database_Schema_Platform_Operations.sql`, plus a new
   numbered patch), and to `DeliveryProvider.ProviderType` in `apps/delivery/models.py`.
4. **Test it offline** the way the existing adapters are tested: mock the HTTP session for `send` / `check`, feed real
   sample payloads to `parse_webhook`, sign a body with a generated key for `verify_webhook`.

Nothing else changes: the form in Settings, the callback address, retries, suppression, reporting and the unsubscribe
link all come from the engine.

## 4. Installed adapters

| Type | Send | Callbacks | Credential | Notes |
|---|---|---|---|---|
| `SMTP` | The workspace's mail server (or the platform's shared one) via `mail_server`; one connection per batch; own `Message-ID` | none (bounces arrive as mail at the From address) | encrypted in `mail_server` | Switched on with **Settings → Email server → Offer this server as a campaign sender**. 5xx recipient = rejected, 4xx = retry. |
| `POSTAL` | `POST {endpoint}/api/v1/send/message`, header `X-Server-API-Key`, one recipient per call | `MessageSent, MessageDelayed, MessageDeliveryFailed, MessageBounced, MessageHeld, MessageLoaded, MessageLinkClicked` | API key | Optional `webhook_public_key` (PEM): `X-Postal-Signature` (RSA-SHA1 over the raw body) is verified. Postal answers HTTP 200 for application errors; `InvalidServerAPIKey` / `ServerSuspended` stop the run. |
| `SENDGRID` | `POST {api_base}/v3/mail/send`, bearer key; our id travels as `custom_args.cep_id`, the campaign code as category | Event Webhook: `delivered, bounce (type blocked = soft), deferred, dropped, spamreport, open, click, unsubscribe` | API key with *Mail Send* | Optional `webhook_public_key`: Signed Event Webhook (ECDSA P-256 over timestamp + body) is verified. `api_base` for the EU region. |

## 5. Credentials

* Entered in the product → encrypted with `FIELD_ENCRYPTION_KEY` into `delivery_provider.secret_enc`. Write-only in the
  API (`has_secret` tells the form one is stored); never in the audit trail, never in an export.
* Kept outside the database → `secret_ref = env:NAME` reads the environment variable `NAME` on the workers. Other
  schemes (a vault) plug into `registry.resolve_secret`.
* `secret_enc` wins when both are present.

## 6. Callback address

```
{API_PUBLIC_URL}/api/v1/webhooks/delivery/<TENANT CODE>/<provider id>/<token>/
```

Shown per provider in **Settings → Delivery** ("Copy webhook URL"). The token is an HMAC of the provider id with the
installation's `SECRET_KEY`; the tenant code lets the request be routed before any lookup. Every event is stored raw in
`delivery_webhook_event` first, then applied; the endpoint answers `200` with counts
(`received / applied / ignored / unmatched / failed`) so providers do not retry events that were understood.
A wrong token is `404`, a failed provider signature `401`.

Status only moves forward (`SUBMITTED → DELIVERED → OPENED → CLICKED`); bounces, complaints and drops override.
A hard bounce or a complaint blocks the address in `contact_point_status` (three soft bounces do too); a complaint or a
provider-side unsubscribe also records an opt-out. The next run leaves those people out with the reason shown on the
campaign page.

## 7. Who is left out of a run (`engine/audience.py`)

`UNKNOWN_PARTY`, `NO_EMAIL`, `BLOCKED_ADDRESS`, `INVALID_ADDRESS`, then for marketing campaigns only `SUPPRESSED`,
`UNSUBSCRIBED`, `NO_CONSENT`, `FREQUENCY_CAP` (active governance policies: `max_messages` within `period_days`), and
`DUPLICATE_ADDRESS`. The reason is stored on `campaign_list_member.suppression_reason` and in
`governance_evaluation_log`. Transactional, service and legal campaigns skip the consent rules but never a blocked or
invalid address.

## 8. Personalization (`engine/render.py`)

`{{tag}}` → the workspace's tag catalogue (`resolution_source` + `source_path`: customer master, campaign list member,
campaign, run, static, inner template) → the list member's uploaded columns → the customer's attributes → the tag's
default. HTML-escaped in the HTML part only. `{{unsubscribe_url}}`, `{{current_year}}`, `{{today}}`,
`{{campaign_name}}` and `{{email}}` are always available.

## 9. Running it

| | |
|---|---|
| Celery queues | `campaign` (start / finalize runs) and `email` (send batches): `celery -A config worker -Q default,events,maintenance,campaign,email` |
| Scheduled job | `dispatch-campaign-runs` every minute: starts due runs (also the ones scheduled for later), closes finished ones. Shown on the back-office health page. |
| Without Celery | `python manage.py send_campaign_runs` (everything due) or `--run <uuid>` |
| Pace | `delivery_provider.rate_limit_per_minute` |
| Test send | **Send a test** on the campaign page / `POST /api/v1/campaigns/{id}/send-test/ {"to": [...]}`: sample values, no execution rows |
| Results | `GET /api/v1/campaign-runs/{id}/results/` and the campaign page (refreshes while a run is live) |

## 10. API summary

| Endpoint | Permission | |
|---|---|---|
| `GET /delivery-providers/catalogue/` | `provider.edit` | installed adapters and their form fields |
| `GET, POST /delivery-providers/` · `PATCH, DELETE /delivery-providers/{id}/` | `provider.edit` | `secret` write-only; `webhook_url`, `has_secret`, last check |
| `POST /delivery-providers/{id}/check/` | `provider.edit` | validates address + credential |
| `GET, POST /delivery-senders/` · `PATCH, DELETE /delivery-senders/{id}/` | `provider.edit` | From name / address / reply-to per provider |
| `POST /delivery-senders/{id}/verify/` | `provider.edit` | sends a real message from the address; accepted = `VERIFIED` (required to publish) |
| `GET /sender-profiles/` | `campaign.edit` | what the campaign form lists |
| `POST /campaigns/{id}/send-test/` | `campaign.edit` | |
| `GET /campaign-runs/{id}/results/` | `campaign.view` | audience, suppression reasons, message counts |
| `POST /webhooks/delivery/<tenant>/<provider>/<token>/` | public (token + provider signature) | |
| `GET, POST /public/unsubscribe/?t=…` | public (signed token) | confirmation page, RFC 8058 one-click |

## 11. Not in this version

* SMS / MMS sending (the Digivize adapter): same contract, `sms_execution` instead of `mailer_execution`.
* Open pixel and click redirect of our own (`services/tracking`): opens and clicks currently come from the provider's
  tracking through webhooks, so SMTP sends report neither.
* A/B variants, recurring and drip runs, journey-generated sends: the run model supports them; the engine sends
  `ONE_TIME` runs today.
