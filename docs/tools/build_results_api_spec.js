/** Builds docs/guides/CEP_Results_API_Integration_Spec.docx: the specification an integration team works from to read campaign
 * results out of CEP. Run from the repository root: node docs/tools/build_results_api_spec.js */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function loadDocx() {
  try { return require('docx') } catch { /* fall through to the global folder */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'docx'))
}
const docx = loadDocx()

const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat, AlignmentType, PageBreak } = docx

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'docs', 'guides', 'CEP_Results_API_Integration_Spec.docx')
const FONT = 'Calibri'
const INK = '1F2440'
const MUTED = '555B6E'
const CONTENT_WIDTH = 9360
const VERSION = '1.0'

function runs(text, base = {}) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) return new TextRun({ text: part.slice(2, -2), bold: true, font: FONT, ...base })
    if (part.startsWith('`') && part.endsWith('`')) return new TextRun({ text: part.slice(1, -1), font: 'Consolas', size: (base.size ?? 21) - 1, ...base })
    return new TextRun({ text: part, font: FONT, ...base })
  })
}

const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: FONT })] })
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: FONT })] })
const p = (text) => new Paragraph({ children: runs(text), spacing: { after: 120, line: 276 } })
const note = (text) => new Paragraph({ children: runs(text, { size: 20, color: MUTED }), spacing: { after: 120 }, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C9CDD8', space: 8 } } })
const bullets = (items) => items.map((item) => new Paragraph({ children: runs(item), numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 } }))
let numberInstance = 0
const numbered = (items) => { numberInstance += 1; return items.map((item) => new Paragraph({ children: runs(item), numbering: { reference: 'numbers', level: 0, instance: numberInstance }, spacing: { after: 60 } })) }
const code = (text) => [...text.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 17 })], shading: { type: ShadingType.CLEAR, fill: 'F3F4F8', color: 'auto' }, spacing: { after: 0 }, indent: { left: 180 }, keepLines: true })),
  new Paragraph({ spacing: { after: 140 } })]
const pageBreak = () => new Paragraph({ children: [new PageBreak()] })

function table(header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0)
  const dxa = widths.map((w) => Math.round((w / total) * CONTENT_WIDTH))
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9CDD8' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const cell = (text, index, isHeader) => new TableCell({
    width: { size: dxa[index], type: WidthType.DXA }, borders, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: 'EEF1F8', color: 'auto' } : undefined,
    children: [new Paragraph({ children: runs(text, { size: 19, bold: isHeader || undefined }), spacing: { after: 0 } })],
  })
  return [new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: dxa,
    rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, i, true)) }), ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((c, i) => cell(c, i, false)) }))],
  }), new Paragraph({ spacing: { after: 160 } })]
}

const children = []
const add = (...items) => items.flat().forEach((item) => children.push(item))

const CAMPAIGN_ROW = `{
  "id": "0b6f6c5e-3d0a-4c58-9a51-6f0c1d2e7a10",
  "code": "CMP-2026-0142",
  "name": "Weekend Offer",
  "campaign_type": "REGULAR_MARKETING",
  "channel": "EMAIL",
  "status": "COMPLETED",
  "journey_id": null,
  "counts": {
    "audience": 6446, "held_back": 206, "queued": 0, "not_sent": 0,
    "sent": 6012, "failed": 228, "delivered": 5871, "opened": 2204,
    "clicked": 512, "bounced": 141, "complained": 3,
    "unsubscribed": 18, "replied": 0
  },
  "rates": {
    "delivery": 97.7, "open": 37.5, "click": 8.7,
    "bounce": 2.3, "unsubscribe": 0.3
  },
  "held_back": { "FREQUENCY_CAP": 61, "NO_CONSENT": 97, "UNSUBSCRIBED": 48 },
  "first_sent_at": "2026-11-21T02:00:00Z",
  "last_sent_at": "2026-11-21T02:14:09Z",
  "last_activity_at": "2026-11-26T08:41:55Z",
  "money": {
    "currency": "SGD", "revenue": 18420.5, "orders": 96,
    "conversions": 88, "message_cost": 12.02, "offer_cost": null,
    "contribution": 18408.48, "roi": 1532.4875,
    "computed_at": "2026-11-26T08:00:04Z"
  }
}`

// ---------------------------------------------------------------------------------------------------- cover
add(
  new Paragraph({ children: [new TextRun({ text: 'CEP Results API', bold: true, size: 64, font: FONT, color: INK })], spacing: { before: 2800, after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: 'Integration Specification', size: 32, font: FONT, color: INK })], spacing: { after: 240 } }),
  new Paragraph({ children: [new TextRun({ text: 'How another system (iCRM, a BI tool, a data warehouse) reads campaign results from CEP: access and security, the endpoints and their fields, limits and throttling, errors, and the load patterns CEP recommends.', size: 22, font: FONT, color: MUTED })], spacing: { after: 480, line: 300 } }),
  new Paragraph({ children: [new TextRun({ text: `Specification ${VERSION} for API version v1. Built ${new Date().toISOString().slice(0, 10)}. Covers campaign and send totals. Per-recipient rows are planned and are not part of this version.`, size: 20, font: FONT, color: MUTED })], spacing: { after: 120 } }),
  pageBreak(),
)

const CONTENTS = ['1. Purpose and Scope', '2. At a Glance', '3. Getting Access', '4. Security', '5. Making a Call', '6. The Window: Which Days a Call Reads', '7. Endpoints',
  '8. Field Reference', '9. Paging', '10. Limits and Throttling', '11. Errors', '12. Recommended Load Patterns', '13. What the CEP Side Operates', '14. Versioning',
  '15. Acceptance Checklist', 'Appendix A. Machine-Readable Description', 'Appendix B. Sample Answers']
add(h1('Contents'), ...CONTENTS.map((line) => new Paragraph({ children: [new TextRun({ text: line, font: FONT, size: 22 })], spacing: { after: 80 } })), pageBreak())

// ---------------------------------------------------------------------------------------------------- 1
add(h1('1. Purpose and Scope'),
  p('The Results API lets a system outside CEP collect what each campaign did: how many messages were sent, delivered, opened and clicked, who was held back and why, and the revenue and cost attributed to the campaign. The consuming system calls CEP; CEP never calls the consumer.'),
  p('It is written for the integration team that builds and runs the consumer, and for the CEP administrator who gives that team access.'),
  ...table(['In this version', 'Not in this version'], [
    ['Totals per campaign and per send, for email, SMS, MMS and WhatsApp.', 'One row per recipient (party ID with delivered, opened, clicked, bounced). Planned as the next version; it will be added to v1 without changing what is described here.'],
    ['Every kind of campaign: regular, drip, journey, e-receipt and warm-up.', 'Names, email addresses, phone numbers and message content. These are never answered. CEP identifies a customer by party ID only, and the consuming system holds the customer record.'],
    ['People held back by the audience rules, counted by reason.', 'Webhooks or files pushed by CEP. The consumer always pulls.'],
    ['Attributed revenue, orders, conversions, message cost, contribution and ROI.', 'Test sends. They are never counted.'],
  ], [1, 1]),
)

// ---------------------------------------------------------------------------------------------------- 2
add(h1('2. At a Glance'),
  ...table(['Item', 'Value'], [
    ['Style', 'REST over HTTPS. Read-only: every endpoint is `GET`.'],
    ['Format', 'JSON, UTF-8. Timestamps are ISO 8601 in UTC (`2026-11-21T02:00:00Z`). Days are `YYYY-MM-DD` in the workspace\'s time zone.'],
    ['Base address', '`https://<cep-host>/api/v1/`. The CEP platform team gives the host for each environment (test and production).'],
    ['Authentication', 'An API key in the `Authorization` header, with the scope `results:read`.'],
    ['Workspace', 'Named in the `X-Tenant` header. A key works in the workspace it was made in and nowhere else.'],
    ['How far back', '13 months.'],
    ['How much a call', 'At most 31 days.'],
    ['Paging', '200 rows a page unless asked otherwise, at most 500. Follow `next`.'],
    ['Rate limit', '60 calls a minute for each endpoint and workspace, at most 10 in any one second. One read is worked out at a time for a workspace.'],
    ['Freshness', 'Figures are live. An answer is kept for 30 seconds, so the pages of one read agree.'],
  ], [1, 3]),
)

// ---------------------------------------------------------------------------------------------------- 3
add(h1('3. Getting Access'),
  p('A workspace administrator in CEP makes one key for each consuming system, so that each can be limited, watched and switched off by itself.'),
  ...numbered([
    'The integration team tells the CEP administrator the name of the consuming system and the public IP addresses or ranges it will call from.',
    'In CEP the administrator opens **Settings → API Keys**, makes a new key and enters the name (for example *Data Warehouse*), the scope `results:read` and nothing else, the **Allowed IP Addresses**, and an **Expires** date.',
    'CEP shows the key once. The administrator passes it to the integration team over a channel approved for secrets. CEP keeps only a fingerprint of the key and cannot show it again.',
    'The integration team stores the key in its secret store, and receives the host and the workspace ID to use.',
    'The first call (section 15) proves the access works.',
  ]),
  note('A key carrying other scopes as well as `results:read` would let the consumer do more than read results. Give it this one scope only.'),
)

// ---------------------------------------------------------------------------------------------------- 4
add(h1('4. Security'),
  h2('4.1 What CEP Enforces'),
  ...table(['Control', 'How it works'], [
    ['Encryption in transit', 'HTTPS only.'],
    ['Key', 'A long random secret. CEP stores a SHA-256 fingerprint, never the key. A wrong, revoked or expired key is answered `401`.'],
    ['Scope', 'The key must carry `results:read`. Without it the answer is `403`.'],
    ['Keys only', 'A person\'s CEP session is never accepted on these endpoints, whatever their role. Only a key reads results.'],
    ['One workspace', 'A key reads the workspace it was made in. It is invisible in every other workspace, and the workspace is compared again on every call.'],
    ['Source address', 'When the key has allowed IP addresses, a call from any other address is answered `401` even with the right key.'],
    ['Expiry and revocation', 'A key stops at its expiry date. The administrator can revoke it at any moment; the next call is refused.'],
    ['Limits', 'Each endpoint is limited for each workspace (section 10), so no consumer can load the CEP server.'],
    ['Pause switch', 'The administrator can pause an endpoint under **Settings → Integrations**. Calls are answered `503` until it is resumed.'],
    ['Call log', 'Every call is recorded with its time, the key that made it, the address asked, the answer\'s status and how long it took. Credentials are masked before a call is stored.'],
    ['No personal data', 'No name, email address, phone number or message content is answered.'],
    ['No caching by intermediaries', 'Every answer carries `Cache-Control: no-store`.'],
  ], [1, 3]),
  h2('4.2 What the Consumer Must Do'),
  ...bullets([
    'Keep the key in a secret store. Never put it in source code, a URL, a log line or a ticket.',
    'Send it only in the `Authorization` header, only over HTTPS, only to the CEP host, and check the server certificate.',
    'Call from the allowed IP addresses. Tell the CEP administrator before they change.',
    'Rotate the key at least once a year and whenever someone with access to it leaves: the administrator makes a new key, the consumer switches to it, the administrator revokes the old one.',
    'Report a suspected leak to the CEP administrator at once. Revoking takes effect on the next call.',
  ]),
)

// ---------------------------------------------------------------------------------------------------- 5
add(h1('5. Making a Call'),
  ...table(['Header', 'Required', 'Value'], [
    ['`Authorization`', 'Yes', '`Bearer ` followed by the key, for example `Bearer cep_in_...`.'],
    ['`X-Tenant`', 'Yes', 'The workspace ID, for example `CITYHT`.'],
    ['`Accept`', 'No', '`application/json`.'],
    ['`X-Correlation-Id`', 'No', 'The consumer\'s own reference for the call: 8 to 64 characters, letters, digits and `. _ : -` only. CEP answers with the same header and stores it in the call log, so both sides can find one call. Left out or not in that form, CEP makes one.'],
  ], [2, 1, 5]),
  p('Example:'),
  ...code(`curl -sS "https://<cep-host>/api/v1/results/campaigns/?sent_from=2026-11-25&sent_to=2026-11-25" \\
  -H "Authorization: Bearer $CEP_RESULTS_KEY" \\
  -H "X-Tenant: CITYHT" \\
  -H "X-Correlation-Id: dwh-load-2026-11-26-0001"`),
  p('Every answer carries these headers:'),
  ...table(['Header', 'Meaning'], [
    ['`X-RateLimit-Limit`', 'Calls allowed a minute on this endpoint.'],
    ['`X-RateLimit-Remaining`', 'Calls left in the current minute.'],
    ['`X-RateLimit-Reset`', 'Seconds until the minute starts again.'],
    ['`Retry-After`', 'On `429` and `504` only: seconds to wait before calling again.'],
    ['`X-Correlation-Id`', 'The caller\'s reference, or one CEP made.'],
    ['`Cache-Control`', '`no-store`.'],
  ], [2, 5]),
)

// ---------------------------------------------------------------------------------------------------- 6
add(h1('6. The Window: Which Days a Call Reads'),
  p('A call reads the messages made in a window of days. `sent_from` and `sent_to` are whole days in the workspace\'s time zone, both included.'),
  ...table(['Rule', 'Value'], [
    ['How far back', '13 months before today. An older `sent_from` is answered `400` with the earliest day allowed.'],
    ['How much a call', '31 days. A wider window is answered `400` with the latest `sent_to` allowed.'],
    ['Both left out', 'The 31 days up to today.'],
    ['Only `sent_from`', '31 days from it, or up to today if that is sooner.'],
    ['Only `sent_to`', 'The 31 days up to it.'],
  ], [1, 3]),
  p('Every answer repeats the window it read and both limits, so a consumer need not hard-code them:'),
  ...code(`"window": {
  "sent_from": "2026-10-27", "sent_to": "2026-11-26",
  "timezone": "Asia/Singapore",
  "earliest": "2025-10-26", "max_days": 31
}`),
  h2('6.1 What the Window Means for the Figures'),
  ...bullets([
    'A campaign appears in a window when it made at least one message, or held at least one person back, in those days.',
    'Its figures count **the messages made in the window**, with everything that has happened to them since (a message sent on Monday and opened on Thursday counts as opened in Monday\'s window).',
    'For a one-time campaign the window that contains its send gives the whole campaign.',
    'For a campaign that never ends (e-receipts, a journey\'s messages, a recurring campaign) the window gives those days only. Setting `sent_from` and `sent_to` to the same day gives that day.',
    '`unsubscribed` counts the unsubscribes recorded in the window. `money` is for the campaign as a whole, whatever the window.',
  ]),
)

// ---------------------------------------------------------------------------------------------------- 7
add(h1('7. Endpoints'),
  h2('7.1 Campaigns'),
  p('`GET /api/v1/results/campaigns/`'),
  p('Every campaign in the window, the latest first, each with its totals, held-back people and money.'),
  ...table(['Parameter', 'Type', 'Meaning'], [
    ['`sent_from`', 'Day', 'First day of the window (section 6).'],
    ['`sent_to`', 'Day', 'Last day of the window.'],
    ['`channel`', 'Text', 'Only campaigns of this channel: `EMAIL`, `SMS`, `MMS`, `WHATSAPP`, `MULTI`.'],
    ['`campaign_type`', 'Text', 'Only campaigns of this type: `REGULAR_MARKETING`, `DRIP`, `JOURNEY`, `E_RECEIPT`, `WARM_UP`, `OTHER`.'],
    ['`page_size`', 'Number', 'Rows a page: 200 unless given, at most 500.'],
    ['`offset`', 'Number', 'Set by the `next` address. Do not build it by hand.'],
  ], [2, 1, 5]),
  p('Answer `200`:'),
  ...code(`{
  "as_of": "2026-11-26T08:42:10.512Z",
  "window": { "sent_from": "2026-10-27", "sent_to": "2026-11-26",
              "timezone": "Asia/Singapore", "earliest": "2025-10-26", "max_days": 31 },
  "count": 37,
  "next": null,
  "results": [ { ...a campaign, see section 8.2... } ]
}`),
  h2('7.2 One Campaign'),
  p('`GET /api/v1/results/campaigns/{id}/`'),
  p('One campaign in the window, by its `id`, with each of its sends in `runs`. Takes `sent_from` and `sent_to`. Answers `404` when the campaign made no message in the window. It counts against the same limit as the campaigns list.'),
  ...code(`{
  "as_of": "...", "window": { ... },
  ...the campaign's fields, see section 8.2...,
  "runs": [ { ...a send, see section 8.6... } ]
}`),
  h2('7.3 Sends'),
  p('`GET /api/v1/results/runs/`'),
  p('Every send in the window, the latest first. A send is one drip message, one occurrence of a recurring campaign, or the single send of a one-time campaign. A journey or e-receipt campaign has one long-running send.'),
  ...table(['Parameter', 'Type', 'Meaning'], [
    ['`campaign`', 'ID', 'Only this campaign\'s sends.'],
    ['`sent_from`, `sent_to`, `channel`, `campaign_type`, `page_size`, `offset`', '', 'As for campaigns.'],
  ], [3, 1, 4]),
  p('The answer has the same envelope as the campaigns list, with sends in `results`.'),
)

// ---------------------------------------------------------------------------------------------------- 8
add(h1('8. Field Reference'),
  h2('8.1 Envelope'),
  ...table(['Field', 'Type', 'Meaning'], [
    ['`as_of`', 'Timestamp', 'When the figures were worked out.'],
    ['`window`', 'Object', 'The days read and the two limits (section 6).'],
    ['`count`', 'Number', 'Rows in the whole answer, across all pages.'],
    ['`next`', 'Address or null', 'The next page. Null on the last page.'],
    ['`results`', 'List', 'The rows of this page.'],
  ], [2, 2, 5]),
  h2('8.2 Campaign'),
  ...table(['Field', 'Type', 'Meaning'], [
    ['`id`', 'UUID', 'CEP\'s identifier of the campaign. Stable; use it as the key.'],
    ['`code`', 'Text', 'The campaign\'s business code, as shown in CEP. Unique in the workspace.'],
    ['`name`', 'Text', 'The campaign\'s name. It can be changed in CEP.'],
    ['`campaign_type`', 'Text', '`REGULAR_MARKETING`, `DRIP`, `JOURNEY`, `E_RECEIPT`, `WARM_UP`, `OTHER`.'],
    ['`channel`', 'Text', '`EMAIL`, `SMS`, `MMS`, `WHATSAPP`, `MULTI`.'],
    ['`status`', 'Text', '`DRAFT`, `TEST_PUBLISHED`, `PRODUCTION_PUBLISHED`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`, `ARCHIVED`.'],
    ['`journey_id`', 'UUID or null', 'The journey a journey campaign belongs to.'],
    ['`counts`', 'Object', 'Section 8.3.'],
    ['`rates`', 'Object', 'Section 8.4.'],
    ['`held_back`', 'Object', 'People left out before a message was made, by reason (section 8.5). Empty when nobody was.'],
    ['`first_sent_at`, `last_sent_at`', 'Timestamp or null', 'The first and last message handed to the sending engine, among those in the window.'],
    ['`last_activity_at`', 'Timestamp or null', 'The latest delivery, open, click, reply or unsubscribe counted in the row. When it has not moved since the last read, the row\'s counts have not changed. Money has its own `computed_at`.'],
    ['`money`', 'Object or null', 'Section 8.7. Null until attribution has run for the campaign.'],
  ], [2, 2, 5]),
  h2('8.3 Counts'),
  p('All are whole numbers. A message is counted once in `queued`, `not_sent`, `failed` or `sent`. `delivered`, `opened`, `clicked`, `bounced`, `complained` and `replied` are parts of `sent`.'),
  ...table(['Field', 'Meaning'], [
    ['`audience`', 'Everyone the campaign considered: the messages made plus the people held back.'],
    ['`held_back`', 'People the audience rules left out. The total of section 8.5.'],
    ['`queued`', 'Messages waiting to be sent.'],
    ['`not_sent`', 'Messages made and then not sent by CEP\'s own choice, for example a drip stopped early. Never counted as failed.'],
    ['`sent`', 'Messages handed to the sending engine and accepted.'],
    ['`failed`', 'Messages the sending engine refused.'],
    ['`delivered`', 'Messages reported delivered. Includes those later opened, clicked or replied to.'],
    ['`opened`', 'Email: opened at least once (includes clicked). WhatsApp: read. SMS and MMS: always 0.'],
    ['`clicked`', 'Email: a link was clicked. Other channels: 0.'],
    ['`bounced`', 'Email that could not be delivered.'],
    ['`complained`', 'Email marked as spam by the recipient.'],
    ['`unsubscribed`', 'Unsubscribes and STOP replies recorded in the window.'],
    ['`replied`', 'SMS, MMS and WhatsApp: the person answered (includes STOP).'],
  ], [2, 6]),
  h2('8.4 Rates'),
  p('Percentages with one decimal, `0.0` when there is nothing to divide by. They are worked out the same way as on the campaign\'s Results tab in CEP.'),
  ...table(['Field', 'Formula'], [
    ['`delivery`', '`delivered` / `sent`'],
    ['`open`', '`opened` / `delivered`'],
    ['`click`', '`clicked` / `delivered`'],
    ['`bounce`', '`bounced` / `sent`'],
    ['`unsubscribe`', '`unsubscribed` / `delivered`'],
  ], [2, 6]),
  h2('8.5 Reasons a Person Is Held Back'),
  p('The keys of `held_back`. New reasons may be added; a consumer should store a reason it does not know rather than fail.'),
  ...table(['Reason', 'Meaning'], [
    ['`NO_CONSENT`', 'No opt-in for this channel.'],
    ['`UNSUBSCRIBED`', 'The person opted out of this channel.'],
    ['`SUPPRESSED`', 'On the workspace\'s suppression list.'],
    ['`TOPIC_OPTED_OUT`', 'The person unticked this campaign\'s topic in the preference centre.'],
    ['`UNENGAGED`', 'An unengaged-contacts rule applies to the person.'],
    ['`FREQUENCY_CAP`', 'The person has already had as many messages as the workspace\'s rules allow.'],
    ['`BLOCKED_ADDRESS`', 'The address or number is blocked (hard bounce, complaint or by hand).'],
    ['`INVALID_ADDRESS`', 'The address or number is marked not valid.'],
    ['`NO_EMAIL`', 'The customer has no address for this channel.'],
    ['`DUPLICATE_ADDRESS`', 'Another person in the same send has the same address; the first keeps it.'],
    ['`EXCLUDED_LIST`', 'The person is in a list attached to the campaign as an exclusion.'],
    ['`LIST_NOT_APPROVED`', 'The person\'s list awaits approval under the workspace\'s consent policy.'],
    ['`UNKNOWN_PARTY`', 'The list names a party that is not a customer in CEP.'],
    ['`COUNTRY_NOT_CHOSEN`', 'Text channels: the number\'s country is not one the workspace sends to.'],
  ], [2, 6]),
  h2('8.6 Send'),
  ...table(['Field', 'Type', 'Meaning'], [
    ['`id`', 'UUID', 'CEP\'s identifier of the send. Stable; use it as the key.'],
    ['`campaign_id`, `campaign_code`', 'UUID, text', 'The campaign the send belongs to.'],
    ['`channel`, `campaign_type`', 'Text', 'As on the campaign.'],
    ['`run_number`', 'Number', '1 for the campaign\'s first send, 2 for the next.'],
    ['`run_type`', 'Text', '`ONE_TIME`, `RECURRING_INSTANCE`, `DRIP_INSTANCE`, `JOURNEY_INSTANCE`, `ERECEIPT_INSTANCE`.'],
    ['`status`', 'Text', '`SCHEDULED`, `PREPARING`, `SENDING`, `PAUSED`, `COMPLETED`, `FAILED`, `CANCELLED`.'],
    ['`label`', 'Text or null', 'For example `Day 3` or `Occurrence 2`.'],
    ['`scheduled_at`, `started_at`, `completed_at`', 'Timestamp or null', 'The send\'s own times.'],
    ['`counts`, `rates`, `held_back`, `first_sent_at`, `last_sent_at`, `last_activity_at`', '', 'As on the campaign, for this send. Money is per campaign and is not on a send.'],
  ], [3, 2, 4]),
  h2('8.7 Money'),
  p('The campaign\'s latest attribution figures. CEP recomputes them on its own schedule for campaigns that sent in the last 35 days; `computed_at` says when. Amounts are numbers in the workspace\'s currency.'),
  ...table(['Field', 'Type', 'Meaning'], [
    ['`currency`', 'Text or null', 'ISO 4217 code, for example `SGD`. Null when the workspace has none set.'],
    ['`revenue`', 'Number or null', 'Revenue of the orders attributed to the campaign, net of refunds.'],
    ['`orders`', 'Number or null', 'Orders attributed to the campaign.'],
    ['`conversions`', 'Number or null', 'Distinct people who ordered.'],
    ['`message_cost`', 'Number or null', 'What the sends cost at the workspace\'s rates.'],
    ['`offer_cost`', 'Number or null', 'Cost of the offer or coupon, when the workspace records it.'],
    ['`contribution`', 'Number or null', '`revenue` less message and offer cost. Not accounting profit.'],
    ['`roi`', 'Number or null', '`revenue` divided by cost, to four decimals.'],
    ['`computed_at`', 'Timestamp', 'When these figures were worked out.'],
  ], [2, 2, 5]),
)

// ---------------------------------------------------------------------------------------------------- 9
add(h1('9. Paging'),
  ...numbered([
    'Call the endpoint without `offset`.',
    'Store the rows in `results`.',
    'If `next` is not null, call that address exactly as given, with the same headers. Repeat until `next` is null.',
  ]),
  p('The pages of one read agree with each other when they are fetched within 30 seconds. A consumer that pauses longer between pages should start the read again from the first page. `count` says how many rows the whole read has.'),
)

// ---------------------------------------------------------------------------------------------------- 10
add(h1('10. Limits and Throttling'),
  p('The limits protect the CEP application server: no consumer, however it is written, can slow CEP down for the people using it.'),
  ...table(['Limit', 'Value', 'When it is reached'], [
    ['Calls a minute, for each endpoint and workspace', '60 for campaigns (list and single together), 60 for sends. The CEP platform team can set a different figure for a workspace.', '`429` with `Retry-After`: the seconds until the minute starts again.'],
    ['Calls in one second', '10.', '`429` with `Retry-After: 1`.'],
    ['Calls a minute for one key', 'None unless the CEP platform team set one on the key.', '`429` with `Retry-After`.'],
    ['Reads worked out at the same time, for one workspace', '1. A second read that needs working out waits its turn.', '`429` with `Retry-After: 2`.'],
    ['Time one read may take', '15 seconds a query.', '`504` with `Retry-After: 60`. Ask for fewer days.'],
    ['Days a call', '31.', '`400`.'],
    ['Rows a page', '500.', 'A larger `page_size` is served as 500.'],
  ], [3, 4, 3]),
  h2('10.1 What the Consumer Must Do'),
  ...bullets([
    'On `429` and `504`, wait the seconds in `Retry-After`, then repeat the same call. Do not retry sooner.',
    'Make calls one after another, not in parallel.',
    'Watch `X-RateLimit-Remaining` and slow down before it reaches 0.',
    'Do not poll more often than the data is needed. Hourly is enough for a dashboard; daily for a warehouse.',
    'Give up after a fixed number of retries (CEP suggests 5) and raise an alert instead of looping.',
  ]),
  note('All consumers of a workspace share the endpoint\'s minute. If two systems are to read at the same hour, stagger their schedules.'),
)

// ---------------------------------------------------------------------------------------------------- 11
add(h1('11. Errors'),
  p('An error is answered as `application/problem+json`: `title` and `status` always, `detail` as a sentence, or `errors` naming each field at fault.'),
  ...code(`{
  "type": "about:blank",
  "title": "Check the highlighted fields",
  "status": 400,
  "errors": { "sent_from": "Results go back 13 months: no earlier than 2025-10-26." }
}`),
  ...table(['Status', 'Meaning', 'What to do'], [
    ['`400`', 'A parameter is wrong: a day that is not `YYYY-MM-DD`, a window older than 13 months, wider than 31 days or back to front, an unknown channel or type.', 'Fix the call. `errors` names the field. Do not retry unchanged.'],
    ['`401`', 'The key is missing, wrong, revoked or expired, or the call came from an address that is not allowed.', 'Do not retry. Check the key and the source address with the CEP administrator.'],
    ['`403`', 'The key lacks `results:read`, or the caller is not an API key.', 'Do not retry. Ask the administrator for a key with the scope.'],
    ['`404`', '`Unknown tenant`: the `X-Tenant` value is not a workspace. On one campaign: it made no message in the window.', 'Check the workspace ID, or widen or move the window.'],
    ['`429`', 'A limit of section 10 was reached.', 'Wait `Retry-After` seconds and repeat.'],
    ['`503`', 'The endpoint is paused by the workspace\'s administrator, or the workspace is briefly unavailable.', 'Retry later with growing waits; ask the administrator if it lasts.'],
    ['`504`', 'The read took too long and was stopped.', 'Wait `Retry-After` seconds, then ask for fewer days.'],
    ['`500`', 'An unexpected failure in CEP. The body carries a reference.', 'Retry once after a minute; then give the reference and the `X-Correlation-Id` to the CEP team.'],
  ], [1, 5, 4]),
)

// ---------------------------------------------------------------------------------------------------- 12
add(h1('12. Recommended Load Patterns'),
  h2('12.1 Daily Load Into a Warehouse'),
  ...numbered([
    'Once a day, after midnight in the workspace\'s time zone, read `/results/runs/` and `/results/campaigns/` for a window of the last 7 days ending yesterday.',
    'Upsert by `id`. Opens, clicks and unsubscribes keep arriving for days after a send, so re-reading the last 7 days brings each row up to date.',
    'Once a week, re-read the last 35 days for `/results/campaigns/` only, so that late `money` figures are picked up.',
  ]),
  h2('12.2 Daily Figures for Campaigns That Never End'),
  p('For e-receipt and journey campaigns, call with `sent_from` and `sent_to` set to the same day, one call a day, and store one row per campaign per day. Re-read the last 7 days each night for the late opens.'),
  h2('12.3 Hourly Refresh for a Dashboard'),
  p('Once an hour, read `/results/campaigns/` with no dates (the 31 days up to today). Use `last_activity_at` to skip rows that have not moved.'),
  h2('12.4 First Load or Reload After an Outage'),
  p('Walk back in steps of 31 days from today to `window.earliest`: 14 calls for each endpoint, plus pages. Run it outside business hours.'),
  h2('12.5 Linking to the Customer Record'),
  p('This version answers no customer-level data. When per-recipient rows are added, each will carry the customer\'s party ID, the same ID iCRM holds, and no name or contact detail.'),
)

// ---------------------------------------------------------------------------------------------------- 13
add(h1('13. What the CEP Side Operates'),
  p('Each endpoint is an integration of the workspace, shown under **Settings → Integrations** as **Results: Campaigns** and **Results: Sends**. The records appear once a key has the scope `results:read`.'),
  ...table(['The workspace administrator can', 'The CEP platform team can'], [
    ['See each endpoint\'s calls, error rate, slowest answers and throttled calls for the last 24 hours.', 'Set the calls-a-minute limit and the extra burst for a workspace\'s endpoint.'],
    ['Open any call in the log: when, which key, what was asked, how it was answered.', 'Set how long call records are kept (90 days unless changed) and whether answers are stored (for a call that went well only the size is kept; for a failure the answer is kept too).'],
    ['Pause and resume an endpoint.', 'Pause and resume an endpoint for a workspace.'],
    ['Make, limit, expire and revoke the keys (Settings → API Keys).', ''],
  ], [1, 1]),
)

// ---------------------------------------------------------------------------------------------------- 14
add(h1('14. Versioning'),
  ...bullets([
    'The address carries the version: `v1`.',
    'Within `v1`, CEP may add fields, endpoints, parameters and values of a list (a new channel, a new held-back reason). A consumer must ignore fields it does not know and must not fail on a new value.',
    'A field is never removed, renamed or changed in meaning within `v1`. Such a change would be a `v2` beside `v1`, announced in advance.',
  ]),
)

// ---------------------------------------------------------------------------------------------------- 15
add(h1('15. Acceptance Checklist'),
  p('Run these against the test environment before going live.'),
  ...table(['#', 'Test', 'Expected'], [
    ['1', 'Call `/results/campaigns/` with the key and the workspace ID.', '`200`, a `window` of 31 days ending today, `Cache-Control: no-store`, `X-RateLimit-Limit: 60`.'],
    ['2', 'The same call without the `Authorization` header.', '`401`.'],
    ['3', 'The same call with a key that lacks `results:read`.', '`403`.'],
    ['4', 'The same call from an address that is not allowed (when the key has allowed addresses).', '`401`.'],
    ['5', '`sent_from` 14 months ago.', '`400`; `errors.sent_from` names the earliest day.'],
    ['6', '`sent_from` and `sent_to` 40 days apart.', '`400`; `errors.sent_to` names the latest day.'],
    ['7', '`page_size=1`, then follow `next` to the end.', 'Each page has one row; the rows add up to `count`; no row twice.'],
    ['8', 'Pick a campaign in CEP and compare its Results tab with its row.', 'The counts and rates agree.'],
    ['9', '`/results/campaigns/{id}/` for that campaign.', 'The same figures, with its sends in `runs`.'],
    ['10', 'More than 60 calls to one endpoint within a minute.', '`429` with `Retry-After`; the consumer waits and goes on.'],
    ['11', 'The administrator pauses **Results: Campaigns**; call again; resume.', '`503` while paused; `200` after.'],
    ['12', 'The administrator opens **Settings → Integrations** and finds a call by its `X-Correlation-Id`.', 'The call is there, with the key that made it.'],
    ['13', 'The administrator revokes the key; call again.', '`401`.'],
  ], [1, 6, 5]),
)

// ---------------------------------------------------------------------------------------------------- appendices
add(h1('Appendix A. Machine-Readable Description'),
  p('CEP publishes an OpenAPI 3 description of its API. The Results endpoints are under the tag **Results**.'),
  ...table(['Address', 'What it is'], [
    ['`https://<cep-host>/api/v1/schema/`', 'The OpenAPI document, for generating a client or importing into Postman.'],
    ['`https://<cep-host>/api/v1/docs/`', 'The same, browsable.'],
  ], [3, 4]),
  h1('Appendix B. Sample Answers'),
  h2('B.1 A Campaign'),
  ...code(CAMPAIGN_ROW),
  h2('B.2 A Send'),
  ...code(`{
  "id": "5a1d1e1c-77b2-4f0e-8d39-2b6a4c9f1e03",
  "campaign_id": "0b6f6c5e-3d0a-4c58-9a51-6f0c1d2e7a10",
  "campaign_code": "CMP-2026-0142",
  "channel": "EMAIL",
  "campaign_type": "REGULAR_MARKETING",
  "run_number": 1,
  "run_type": "ONE_TIME",
  "status": "COMPLETED",
  "label": null,
  "scheduled_at": "2026-11-21T02:00:00Z",
  "started_at": "2026-11-21T02:00:02Z",
  "completed_at": "2026-11-21T02:14:30Z",
  "counts": { ...as B.1... },
  "rates": { ...as B.1... },
  "held_back": { "FREQUENCY_CAP": 61, "NO_CONSENT": 97, "UNSUBSCRIBED": 48 },
  "first_sent_at": "2026-11-21T02:00:00Z",
  "last_sent_at": "2026-11-21T02:14:09Z",
  "last_activity_at": "2026-11-26T08:41:55Z"
}`),
  h2('B.3 A Throttled Call'),
  ...code(`HTTP/1.1 429 Too Many Requests
Retry-After: 23
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 23
Content-Type: application/problem+json

{ "type": "about:blank", "title": "Throttled", "status": 429,
  "detail": "Request was throttled. Expected available in 23 seconds." }`),
)

const doc = new Document({
  creator: 'CEP',
  title: 'CEP Results API: Integration Specification',
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, font: FONT, color: INK }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0, keepNext: true } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: FONT, color: INK }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1, keepNext: true } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children,
  }],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer)
  console.log(`wrote ${path.relative(ROOT, OUT)} (${(buffer.length / 1024).toFixed(0)} KB)`)
})
