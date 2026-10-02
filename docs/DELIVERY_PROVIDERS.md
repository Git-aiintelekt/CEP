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
| `config_fields: tuple[ConfigField, ...]` | The form shown in **Settings → Sending engines**. `secret=True` fields are write-only and stored encrypted; the rest go to `delivery_provider.config` (JSON). |
| `open()` / `close()` | Called once around a batch: keep an HTTP session or an SMTP connection. |
| `send(EmailMessage) -> SendResult` | `ACCEPTED` (+ `provider_message_id`), `REJECTED` (permanent, this message only), `RETRY` (temporary). Raise `ProviderError(retryable=False)` only when nothing can be sent at all (bad key, suspended account). |
| `check() -> (ok, detail)` | The **Check** button: validate address + credential without sending. |
| `verify_webhook(headers, raw_body) -> bool` | The provider's own signature scheme. The URL already carries an unguessable token, so return `True` when the provider has none or no key is configured. |
| `parse_webhook(payload) -> list[DeliveryEvent]` | Translate the provider's vocabulary into `DELIVERED, BOUNCED (HARD/SOFT), DEFERRED, DROPPED, COMPLAINED, OPENED, CLICKED, UNSUBSCRIBED`. Fill `idempotency_key` when the provider echoes our metadata (most reliable), otherwise `provider_message_id`. |
| `max_batch`, `supports_webhooks`, `manageable` | Batch size per worker task; whether a callback address is shown; `manageable=False` for providers created by another screen (SMTP follows **Settings → Email server**). |

`EmailMessage` carries: recipient and sender (name + address), reply-to, subject, HTML and text parts, headers
(`List-Unsubscribe`, `List-Unsubscribe-Post` for marketing), `attachments` (receipts), `idempotency_key`
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
| `SMTP` | The workspace's own mail server via `mail_server` (never the platform's); one connection per batch; own `Message-ID` | none (bounces arrive as mail at the From address) | encrypted in `mail_server` | Switched on with **Settings → Email server → Offer this server as a campaign sender**. 5xx recipient = rejected, 4xx = retry. |
| `POSTAL` | `POST {endpoint}/api/v1/send/message`, header `X-Server-API-Key`, one recipient per call; the `tag` is a compact JSON map of the message (`x` our execution id, `c` campaign code, `u` purpose marketing / transactional / receipt, `p` party, `n` receipt number, `s` store, `r` run, `t` workspace), trimmed from the end to fit Postal's 250 characters; Postal echoes it on every event (`message.tag`, or `original_message.tag` on a bounce), the callback is matched on `x` before any other id, and the integration log's callback row carries the send's own reference (`receipt:<number>`, `mailer_execution:<id>`). Each callback's own `uuid` is stored as `provider_event_id`; Postal retries a callback on anything but a 2xx, so a second arrival of the same event is kept as a `DUPLICATE` row and not applied again, and opens and clicks are counted once (patch 0021) | `MessageSent, MessageDelayed, MessageDeliveryFailed, MessageBounced, MessageHeld, MessageLoaded, MessageLinkClicked` | API key | Optional `webhook_public_key` (PEM): `X-Postal-Signature` (RSA-SHA1 over the raw body) is verified. Postal answers HTTP 200 for application errors; `InvalidServerAPIKey` / `ServerSuspended` stop the run. |
| `SENDGRID` | `POST {api_base}/v3/mail/send`, bearer key; our id travels as `custom_args.cep_id`, the campaign code as category | Event Webhook: `delivered, bounce (type blocked = soft), deferred, dropped, spamreport, open, click, unsubscribe` | API key with *Mail Send* | Optional `webhook_public_key`: Signed Event Webhook (ECDSA P-256 over timestamp + body) is verified. `api_base` for the EU region. |

## 5. Credentials

* Entered in the product → encrypted with `FIELD_ENCRYPTION_KEY` into `delivery_provider.secret_enc`. Write-only in the
  API (`has_secret` tells the form one is stored); never in the audit trail, never in an export.
* Kept outside the database → `secret_ref = env:NAME` reads the environment variable `NAME` on the workers. Other
  schemes (a vault) plug into `registry.resolve_secret`.
* `secret_enc` wins when both are present.
* **Two credentials on one engine (patch 0020).** An adapter may declare a second secret field with
  `credential="transactional_secret"` (Postal: *Transactional server API key*). It is stored encrypted in
  `delivery_provider.transactional_secret_enc`, write-only as `transactional_secret` (`has_transactional_secret` tells the
  form; `drop_transactional_secret: true` removes it), never in the audit trail. When it is set, every message whose
  `EmailMessage.traffic` is `TRANSACTIONAL` (receipts, and campaigns whose solicitation type is not marketing) goes out
  with it: `adapter.secret_for(message)`. The integration bridge gives that traffic its own throttle lane
  (`provider:<id>:transactional`), so receipts never queue behind a campaign. Without a second credential the one key
  carries everything in one lane. **Check** tries both keys and names the one that is refused.

## 6. Callback address

```
{API_PUBLIC_URL}/api/v1/webhooks/delivery/<TENANT CODE>/<provider id>/<token>/
```

Shown per provider in **Settings → Sending engines** ("Copy Webhook URL"). The token is an HMAC of the provider id (and, once
rotated, its rotation key) with the installation's `SECRET_KEY`; the tenant code lets the request be routed before any lookup.
**Rotate Address** on the engine (`POST /delivery-providers/{id}/rotate-webhook/`, `provider.edit`) stores a fresh random
`webhook_key` in the engine's config: the old address answers 404 at once and the new one has to be registered with the
provider. The column also says when the engine last called back and how often in the last day, or that it never has. Every event is stored raw in
`delivery_webhook_event` first, then applied; the endpoint answers `200` with counts
(`received / applied / ignored / unmatched / failed`) so providers do not retry events that were understood.
A wrong token is `404`, a failed provider signature `401`.

Status only moves forward (`SUBMITTED → DELIVERED → OPENED → CLICKED`); bounces, complaints and drops override.
A hard bounce or a complaint blocks the address in `contact_point_status` (three soft bounces do too); a complaint or a
provider-side unsubscribe also records an opt-out. The next run leaves those people out with the reason shown on the
campaign page.

### 6.1 Troubleshooting a send (campaign → Recipients)

Every question about a bulk send has one place to be answered, on the campaign page:

| Question | Where |
|---|---|
| What did CEP send, exactly, and what did the engine answer? | Settings → Integrations → Call Log (every call with request and answer; **Retry Send** on a failure) — and from a recipient's row, "Engine Calls" with the log reference `mailer_execution:<id>` |
| Who was it sent to and what became of each message? | Campaign → **Recipients**: one row per person of a run — address and name, status (Queued / Sent / Delivered / Opened / Clicked / Bounced / Marked as Spam / Failed), the reason text, the times, the engine's message id; filter by status, search by address, name or customer id; CSV. `GET /campaign-runs/{id}/recipients/`, `…/export.csv` |
| Why did *this* message fail, and did the engine ever confirm it? | A recipient's row opens its timeline (queued, handed to the engine, every callback the engine sent, opens and clicks with the link, the address's standing today) — `GET …/recipients/{execution_id}/` |
| What does the engine itself say about the message? | **Check with the Engine** on the row: Postal's own record, read now — status, held or not, the last delivery attempt, every attempt with the receiving server's answer (`POST …/recipients/{execution_id}/check/`, `PostalProvider.message_status`; Postal's messages API takes the numeric id the send answered with, found in the call log by the Message-ID) |
| Who on this campaign's lists cannot be sent to, why, from where, since when? | Campaign → Recipients → **Blocked & Unsubscribed**: the Suppressions rows kept to this campaign's people (attached lists and every frozen run list), with the group chips (Unsubscribed / Bounced / Complained / Blocked), channel, search and CSV — `GET /campaigns/{id}/suppressions/`, `…/export.csv` |
| Is the engine calling back at all? | Settings → Sending Engines → Callbacks: "Last received … · N in 24 h", or "No callback has ever arrived" — a dead webhook otherwise looks like a send that never delivers (`last_callback_at`, `callbacks_24h` on the provider) |

Reading the picture: a row **Sent** with no delivered time and "No callback from the engine has reached this message" while *Check with the Engine* says **Sent** = the send worked and the webhook is not registered (or points at the wrong Postal mail server). **Failed** with a reason = the engine refused the message (the reason is Postal's own words). **Bounced** / **Marked as Spam** = the callback arrived and the address is now blocked for every campaign (see Blocked & Unsubscribed).

## 7. Who is left out of a run (`engine/audience.py`)

`UNKNOWN_PARTY`, `NO_EMAIL`, `BLOCKED_ADDRESS`, `INVALID_ADDRESS`, then for marketing campaigns only `SUPPRESSED`,
`UNSUBSCRIBED`, `NO_CONSENT`, `TOPIC_OPTED_OUT` (the person unticked the campaign's topic on the preference page, while
the workspace's preference centre is on), `FREQUENCY_CAP` (active governance policies: `max_messages` within
`period_days`), and `DUPLICATE_ADDRESS`. The reason is stored on `campaign_list_member.suppression_reason` and in
`governance_evaluation_log`. Transactional, service and legal campaigns skip the consent rules but never a blocked or
invalid address.

## 8. Personalization (`engine/render.py`)

`{{tag}}` → the workspace's tag catalogue (`resolution_source` + `source_path`: customer master, campaign list member,
campaign, run, static, inner template) → the list member's uploaded columns → the customer's attributes → the tag's
default. HTML-escaped in the HTML part only. `{{unsubscribe_url}}`, `{{current_year}}`, `{{today}}`,
`{{campaign_name}}` and `{{email}}` are always available.

The subject and the preheader are the campaign's own (`campaign.subject_line` / `preheader`, patch 0025) when it has
them, else the template's. The preheader goes into the HTML part right after `<body>` as hidden text (the line an inbox
shows after the subject), with its tags filled in like the rest; before patch 0025 it was stored with the template but
never sent.

### 8.1 Barcode and QR code blocks (`apps/templates/codes.py`, patch 0024)

A dynamic image: the designer's Barcode and QR Code blocks (Commerce) draw one tag's value for each recipient. The marketer
picks the data source (a catalogue tag) and the format in the settings panel; nothing is typed as HTML.

* **In the design** a block is an `mj-raw` (`css-class="cep-code cep-code-barcode|qr"`) whose content is bracketed by
  `<!-- CEP:CODE {settings JSON} -->` and `<!-- CEP:CODE_END -->`. The compilers copy mj-raw byte for byte, so the settings
  reach the saved HTML. Between the markers is what the canvas and every preview show: the code of the tag's sample value.
  Settings: barcode `format` (`code128`, `code39`, `ean13`, `upca`), `width` 120-560 and `height` 40-200 px; QR `ecc`
  (`L` Low, `M` Standard, `Q` High, `H` Maximum) and `size` 80-300 px; `text` (the value printed under the code), `align`,
  `background`. Save refuses a block whose settings the email cannot use, and counts its source tag as used.
* **At send** `Renderer.render` replaces each region before the tags are filled: the recipient's value (the same resolution
  as `{{tag}}`) drawn as a PNG behind a signed address, `GET /api/v1/public/code/<token>.png`, centred (or aligned) in a
  full-width row with the value under it as text, since an inbox hides images until the reader allows them. The token is
  a Django `Signer` object (no timestamp): the same code always has the same address, it cannot be altered, and the route
  draws only what a send issued. Images are drawn at twice the displayed size, pure black on white with a quiet zone,
  cached for a day and served `immutable`.
* **A missing or unusable value** (none, or one the format cannot carry: an EAN-13 needs 12 digits or 13 with the right check
  digit) leaves the block out of that recipient's email; the email still goes. Each send batch writes one
  `CODES_LEFT_OUT` activity entry (WARNING) with the count and the source tags, and the run's completion message adds
  them up: "A barcode or QR code was left out for 37 of them."
* **The feature** is `dynamic_codes` ("Barcodes and QR codes") in `platform_ops.params.FEATURES`: off by default, switched
  on per workspace in tenant management (Tenants → the workspace → Features); a plan can switch it off for all of its
  tenants with `{"dynamic_codes": false}`. Without it the designer does not offer the blocks, `POST /codes/sample/` answers
  403, and the renderer leaves any existing block out (counted like a missing value).
* **Data** comes from catalogue tags. Patch 0024 gives every workspace three list-member tags, and onboarding gives every
  new one: `coupon_code`, `coupon_barcode_value`, `coupon_qr_value` (`custom_value_pairs.*`, filled from list-upload
  columns of the same names).
* **E-receipts** (2026-09-29): the receipt designer's palette ends with the same two blocks. A receipt has no list member, so
  `POST /receipts/send/` fills the coupon tags from the receipt's own `coupon_code`, `coupon_barcode_value` and
  `coupon_qr_value` fields (`receipts.coupon_values`); the RECEIPT tags work as sources too (a barcode of `receipt_number`,
  a QR code of `order_url`). A receipt that went without a block says so in the answer: `"codes_left_out": ["coupon_qr_value"]`.
* Libraries: `python-barcode` (bars as a module pattern, painted with Pillow, never resampled) and `segno` for QR.

### 8.2 The tag catalogue and the platform's own (patch 0026)

A workspace's tags live in `personalization_tag` (API `/personalization-tags/`, permission `template.edit`). Since patch
0026 the installation also has one catalogue of its own, `platform_personalization_tag`, kept in the back-office under
**Configuration -> Personalization tags**: key, label, kind, a **data point** (where the value comes from, chosen from what
each source offers - customer record, list upload column, campaign, run, system, receipt, store - or a static value), the
default, the data type and format, the channels it is offered in, and the sample value previews show. `apps/templates/
datapoints.py` is the list of data points and the check a path is held to.

Every workspace **inherits** the catalogue: onboarding copies each active platform tag into the workspace (linked by
`personalization_tag.platform_tag_id`), and saving a platform tag pushes the change to every active workspace
(`apps/templates/inherit.py`; the row's *Apply to every workspace again* action does it by hand). A copy is the
platform's to change: the workspace API answers 403 to a PATCH or DELETE of one. A tag the workspace made itself with the
same key is left alone and named in the back-office message. Switching a platform tag off switches its copies off, which
takes them out of the designer; deleting one releases its copies, which become the workspaces' own. The patch seeds the
standard nine (first and last name, the three coupon tags, the system tags); an existing workspace gets them the first
time platform staff press *Apply*.

## 9. E-receipts (transactional, one at a time)

A receipt is not published to an audience: the point of sale or the web shop asks for each one, and gets the answer in
the same call. It goes through the campaign's sender and email engine like any other message (Postal's HTTP API,
SendGrid or SMTP), is recorded as a `mailer_execution` under the campaign's `ERECEIPT_INSTANCE` run of the day, and
provider callbacks mark it delivered / bounced like a campaign message.

```
POST /api/v1/receipts/send/          Authorization: Bearer cep_in_...   (API key with the scope receipts:send)   X-Tenant: NWA
{
  "campaign": "RCPT-STORE",                       // id or code of a PUBLISHED campaign of type E_RECEIPT
  "to": "customer@example.com", "name": "Pat Lee", "party_id": "C360-0042",          // party_id optional
  "receipt": { "number": "R-104-88213", "transaction_at": "2026-09-18T16:12:00", "currency": "USD",
               "subtotal": 84, "discount_total": -16.8, "tax_total": 5.38, "grand_total": 72.58, "tender_summary": "Visa ending 4242",
               "items": [ { "description": "Merino crew sweater", "sku": "NW-1042", "quantity": 1, "unit_price": 64 } ] },
  "store":   { "name": "Lenox Square", "address": "3393 Peachtree Rd NE, Atlanta" },
  "attachments": [ { "name": "receipt.pdf", "content_type": "application/pdf", "data": "<base64>" } ]    // optional, 5 files, 10 MB
}
```

| Answer | Meaning |
|---|---|
| `201` `{status: "SUBMITTED", execution_id, provider_message_id, duplicate: false}` | accepted by the email engine |
| `200` `{..., duplicate: true}` | this receipt number was already sent: nothing was sent again (a cash register may retry freely) |
| `422` | refused for good: the address is blocked (hard bounce / complaint), or the engine rejected the message (its reason is in `detail`) |
| `424` `retryable: true` | the email engine is failing temporarily (three quick attempts were made): call again with the same number |
| `409` / `404` | the campaign is not published / not an e-receipt campaign |

* Template tags with source `RECEIPT` read `receipt.<key>` (path `receipt.number`, `receipt.grand_total` ...), source
  `STORE` reads `store.<key>`. Money fields are formatted with the receipt's currency. `{{receipt_body}}` becomes the
  line-item table (every value escaped); the text part gets the same lines as text.
* Transactional: marketing consent and frequency caps do not apply and there is no unsubscribe header. A blocked
  address is still refused.
* Idempotency key: `receipt.number`, else `receipt.order_number`, else `idempotency_key`. A failed attempt is tried
  again on the same execution row, so one receipt is always one row.
* **The receipt layout is rendered at send time.** An E-Receipt template's outer design carries a receipt slot (two
  comment markers); `engine/receipt_layout.py`, the Python twin of the editor's `receiptEmailHtml.ts`, fills the
  template's saved layout (sections and their settings, or the Standard preset) with the receipt the point of sale
  sent and puts it into the slot before the tags are filled, so the sent email is what Preview & Test showed. The
  payload maps as the editor's sample transactions do: `number` -> receipt id, `order_number`, `transaction_at` ->
  date, `store.name`, `shipping_address` / `pickup_location` / `delivery_estimate`, `items[]` (`description`, `sku`,
  `quantity`, `unit_price`, `total`, `image_url`), `subtotal`, `discount_total` (+ `discount_code`), `shipping_total`,
  `tax_total`, `tip_total`, `grand_total`, `tender_summary`, `authorized_at`, `billing_address`, `loyalty`
  (`points_earned`, `points_balance`, `tier_progress`). A Custom HTML layout goes in as it is. A design without a slot
  is used as it is, so an older template's `{{receipt_body}}` still works.
* **The return barcode** (Returns & support section, switched on in the layout) is a Code 128 image of the receipt
  number: `<img>` pointing at `GET /api/v1/public/barcode/<number>.png` on this installation (built from the public
  address), no sign-in, cached for a year, rendered with `python-barcode` + Pillow. A `data:` image would be refused
  by Gmail, which is why it is served. The editor's preview and Preview & Test show the same image.
* One Postal engine can carry both: enter the API key of a second Postal mail server as the *Transactional server API
  key* (Settings → Sending engines) and receipts go out through that server, in their own throttle lane, while
  campaigns use the first. Both servers post callbacks to the engine's one callback address. A separate engine and
  sender for receipts still works, but is no longer needed.

## 10. SMS and MMS

Texts use the same engine, run life cycle, settings screen and callback address as email. What differs:

| | Email | Texts (SMS / MMS) |
|---|---|---|
| Adapter base class | `EmailProvider`, `send(EmailMessage)` | `SmsProvider` (`channel = "SMS"`, `supports_mms`), `send(SmsMessage)`, plus `parse_inbound(payload) -> [InboundMessage]` |
| Execution table | `mailer_execution` | `sms_execution`: the exact text sent, its number of parts, the merged values, sender number, engine, the aggregator's answer |
| Sender | From name + address | `sender_id`: short code, long number (+E.164) or alphanumeric sender; verified by a text to a mobile number |
| Audience (`engine/audience_sms.py`) | see section 7 | `UNKNOWN_PARTY, NO_PHONE, INVALID_NUMBER` (no E.164 mobile, landline, fax), `BLOCKED_NUMBER`, `UNSUBSCRIBED`, then marketing only: `SUPPRESSED, NO_CONSENT, TOPIC_OPTED_OUT, FREQUENCY_CAP`, and `DUPLICATE_NUMBER` |
| Opt-out | unsubscribe link, marketing only | a STOP applies to **every** kind of campaign, and to the **number** (it is blocked even when nobody in the customer master owns it) |
| Quiet hours | none | marketing texts that are due between `messaging.sms_quiet_hours` (global parameter, workspace time zone; default 21:00-08:00, `{}` = off) stay `SCHEDULED` until the window opens |
| Receipts | delivered, bounced, opened, clicked | `DELIVERED`; `BOUNCED` HARD = the number can never receive (blocked as `INVALID`), SOFT = temporary; `DROPPED` |
| Report | opened, bounced | replied, opted out, message parts (what the carrier bills) |

**Replies (`engine/inbound.py`).** `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT, REVOKE` as the first word: opted
out of SMS and MMS (`consent_record` source `SMS_STOP`, with the text as evidence), number blocked, the message they
answered becomes `OPTED_OUT`. `START, UNSTOP, SUBSCRIBE` as the whole message: opted in again, a STOP block lifted.
`HELP, INFO`: recorded. Anything else: recorded as a reply, the message becomes `RESPONDED`. All of it is kept in
`sms_inbound_message` and shown on the campaign page. Numbers reported without `+` or without the North American
country code are matched. A repeated callback changes nothing. Confirmation and help texts are left to the aggregator.

**Engines installed for texts**

| Type | |
|---|---|
| `SANDBOX_SMS` | Accepts SMS and MMS and **sends nothing**: for trying text campaigns before an aggregator is connected. Not metered. Config: numbers to refuse / to fail temporarily. Simulate the aggregator by posting to its callback address: `{"events": [{"type": "delivered", "message_id": "sbx-..."}, {"type": "failed", "message_id": "...", "reason": "...", "permanent": true}, {"type": "inbound", "from": "+14045550001", "to": "55123", "text": "STOP"}]}` |
| `DIGIVIZE` | Digivize External SMS API: `POST {endpoint}{send_path}?key=&timestamp=&signature=` (default path `/api/v1/external/sms/send`, the route the sandbox and lab hosts serve; 2026-10-02 every other path answered Laravel's 419 "Your session has expired", i.e. no such API route). Send mode `single` (default): one request per text, body `{brand_id, to, message, message_type, external_ref, variable_normalization, callback_url}` (the route answers 500 to `idempotency_key`, so it is left out; a `marketing` text without a STOP keyword is refused as `COMPLIANCE_FAILED`; the reply carries `tracking_id`, `status: queued`, `contact_id`, `estimated_segments`); `batch` (when Digivize provides the batch route, set the path to it): one request per identical text with `{brand_id, message, message_type, recipients: [{to, variables, external_ref}], variable_normalization: gsm7_safe, auto_create_contacts, idempotency_key, callback_url}`. Both signed the way Digivize's own Postman pre-request script signs it: HMAC-SHA256 with the secret key over the body plus `key` and `timestamp`, top-level keys sorted, serialised like PHP's `http_build_query` (`recipients[0][to]=`, spaces `+`, `!'()*` percent-encoded, booleans `1`/`0`, nested keys in sending order). In batch mode the engine groups a run's messages by identical text (CEP personalises them) and sends up to 100 recipients per request; `external_ref` carries CEP's message id and comes back in the callback. Config: API address, send path, API key, secret key, brand ID (an integer: a name is refused), message type (marketing / transactional), send mode, the callback address, an optional webhook secret. **Check** posts a body without a number (single) or an empty batch: a refused key or signature fails it, a validation answer proves the credentials. Reply: a per-recipient list (`external_ref` / `to`, `tracking_id` / `message_id` / `id`, `status`) or a batch id. Receipts: `sms.delivered`, `sms.failed` / `undelivered` / `expired` (HARD for `invalid_number`, `landline`, `blocked`, `opted_out`, `suppressed`, else SOFT), `sms.opted_out` (HARD), a status per recipient, or a batch callback with `data.recipients[]`; matched by `external_ref`. No free-text reply webhook. Rate: 60 requests per minute per key, the engine's default; a batch is one request. MMS (`media_urls` on the batch) is unconfirmed. |

MMS needs a template with a picture that has a public address (the aggregator fetches it) and an engine with `supports_mms`.

## 11. Running it

| | |
|---|---|
| Celery queues | `campaign` (start / finalize runs), `email` and `sms` (send batches): `celery -A config worker -Q default,events,maintenance,campaign,email,sms,imports` |
| Scheduled job | `dispatch-campaign-runs` every minute: starts due runs (also the ones scheduled for later), closes finished ones. Shown on the back-office health page. |
| Without Celery | `python manage.py send_campaign_runs` (everything due) or `--run <uuid>` |
| Pace | `delivery_provider.rate_limit_per_minute` |
| Test send | **Send a test** on the campaign page / `POST /api/v1/campaigns/{id}/send-test/ {"to": [...]}`: sample values, no execution rows |
| Results | `GET /api/v1/campaign-runs/{id}/results/` and the campaign page (refreshes while a run is live) |

## 12. API summary

| Endpoint | Permission | |
|---|---|---|
| `GET /delivery-providers/catalogue/` | `provider.edit` | installed adapters and their form fields |
| `GET, POST /delivery-providers/` · `PATCH, DELETE /delivery-providers/{id}/` | `provider.edit` | `secret` and `transactional_secret` write-only, `drop_transactional_secret`; `webhook_url`, `has_secret`, `has_transactional_secret`, last check |
| `POST /delivery-providers/{id}/check/` | `provider.edit` | validates address + credential(s) |
| `GET, POST /delivery-senders/` · `PATCH, DELETE /delivery-senders/{id}/` | `provider.edit` | From name / address / reply-to per provider |
| `POST /delivery-senders/{id}/verify/` | `provider.edit` | sends a real message from the address; accepted = `VERIFIED` (required to publish) |
| `GET /sender-profiles/` | `campaign.edit` | what the campaign form lists |
| `POST /campaigns/{id}/send-test/` | `campaign.edit` | |
| `GET /campaign-runs/{id}/results/` | `campaign.view` | audience, suppression reasons, message counts |
| `POST /receipts/send/` | API key scope `receipts:send`, or `campaign.publish` | one e-receipt, idempotent on the receipt number |
| `GET /sms-inbound/?campaign=` | `campaign.view` | what people texted back, newest first |
| `POST /webhooks/delivery/<tenant>/<provider>/<token>/` | public (token + provider signature) | |
| `GET, POST /public/unsubscribe/?t=…` | public (signed token) | confirmation page, RFC 8058 one-click |
| `POST /codes/sample/` | `template.edit` + feature `dynamic_codes` | a barcode or QR code block's sample: `{valid, url}` or `{valid: false, message}` |
| `GET /public/code/<token>.png` | public (signed token) | a code block's image in a sent email |

## 13. Not in this version

* Digivize's reply and callback shapes, once a first real batch has been sent: the adapter reads the plausible fields (section 10).
* Link shortening and click tracking in texts; automatic HELP / STOP confirmation texts (left to the aggregator).
* Open pixel and click redirect of our own (`services/tracking`): opens and clicks currently come from the provider's
  tracking through webhooks, so SMTP sends report neither.
* Recurring and drip runs, journey-generated sends: the run model supports them; the engine sends `ONE_TIME` runs
  today. A/B subject lines are sent since 2026-09-27 (CAMPAIGNS.md §8).
