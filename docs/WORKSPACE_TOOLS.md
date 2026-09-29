# Reports, Suppressions, Notifications, Approvals

Four workspace-level tools, backend first (PR #25) and their pages after, from the reviewed page designs (2026-09-29).
Everything here is tenant-scoped through RLS like the rest of the API.

| Page | Where | Who |
|---|---|---|
| Reports | `/reports`, in the main navigation after Campaigns (`features/reports/`) | `report.view`; Schedule Report needs `user.admin` |
| Suppressions | Settings → Suppressions (`pages/settings/SuppressionsPage.tsx`) | Settings is `user.admin`; Unblock and Import need `consent.edit` |
| Notifications | Settings → Notifications (`pages/settings/NotificationsPage.tsx`) | `user.admin` |
| Approvals | Settings → Approvals (`pages/settings/ApprovalsPage.tsx`), and the Approval card on the setup's Review & Publish step (`features/campaigns/wizard/ApprovalCard.tsx`) | the switch: `user.admin`; asking: `campaign.edit`; deciding: `campaign.approve`, never the person who asked |

Reports: period presets (Last 7 Days, This Month, Last Month, Custom) counted in the workspace's zone, a channel filter,
four figure tiles, sent and opened by day on the chart kit, best and worst, the campaigns with Compare (2 to 6) and
Export CSV, and the weekly schedule. Suppressions: counts per reason (each a filter), channel, reason and search
filters, 25 a page, Unblock with a confirmation, Import (paste or CSV, with a note), Export CSV. Notifications: the
event × channel matrix, recipients, the webhook; Send a Test Message uses the saved settings, so it waits for a save.
Approvals: the requirement switch (refused until someone can approve), the approvers, and a link to the campaigns
waiting (`/campaigns?saved=approval`). The Approval card offers exactly what the campaign's `actions` allow.

## 1. Reports (`report.view`)

| Endpoint | What it returns |
|---|---|
| `GET /reports/summary/?from=&to=&channel=` | The period (default: this month so far, in the workspace's zone; up to 366 days): totals and rates, figures per channel, a per-day series, one row per campaign with its rates, revenue and unsubscribes, and highlights (highest open and click rate, most unsubscribes, best send hour). |
| `GET /reports/campaigns.csv?from=&to=&channel=` | The same rows as a file, with a total line. |
| `GET /reports/compare/?ids=a,b` | Two to six campaigns side by side: each campaign's results and its day-by-day curve. |
| `GET` / `PUT /reports/schedule/` | The weekly email: `enabled`, `weekday` (0 = Monday), `hour` (workspace zone), `recipients`. Changing it needs `user.admin`. |

Figures come from `mailer_execution` and `sms_execution` joined to their runs (test runs left out), `consent_record`
for unsubscribes and `campaign_actual` for revenue; the partition key `created_at` bounds every scan. Rates over fewer
than 50 sends are not used for highlights. The `send-weekly-reports` job (every 15 minutes) emails last week's figures on
the chosen weekday once the hour has passed, once per day at most (`settings.reports.weekly.last_sent_on`), through the
notification channels below plus the schedule's own recipients.

## 2. Suppressions (read with `campaign.view`, change with `consent.edit`)

One list over two tables: `contact_point_status` (what happened to an address or number: a hard bounce, repeated soft
bounces, a complaint, a block by a person or an import, a registry) and `consent_suppression` (what the person decided:
unsubscribed, replied STOP). A complaint shows once, from the contact-point side.

| Endpoint | Does |
|---|---|
| `GET /suppressions/?channel=EMAIL\|PHONE&reason=UNSUBSCRIBED\|BOUNCED\|COMPLAINED\|BLOCKED&search=&page=&page_size=` | Rows newest first, each with the person behind it, the reason in words, the source and since when; `can_unblock` says whether Unblock is offered. |
| `GET /suppressions/summary/` | Counts by group, by channel, and this week's additions. |
| `GET /suppressions/export.csv` | The filtered rows as a file. |
| `POST /suppressions/CONTACT_POINT/{id}/unblock/` | Undoes a bounce or a block (the row keeps its history, `unblocked_at` is set). A complaint or an opt-out is refused with 409: the person has to opt in again. |
| `POST /suppressions/block/` | `{values: [...], note}` or a CSV upload (`file`): blocks every address or number (lower-cased; a bare ten-digit North American number gets +1), reason `MANUAL`, source `CSR` or `IMPORT`; matches the person when the address is on file. Up to 5,000 at a time; reports what was invalid and what was already blocked. |

A blocked address is left out of every audience from then on (the audience builder reads `contact_point_status.blocked`).

## 3. Notifications (`user.admin`; `tenant.settings.notifications`)

`GET` / `PUT /workspace/notifications/`: fixed email addresses (up to 20), a chat webhook (Slack, Teams or anything
that takes `{"text": ...}`), and an event-by-channel matrix (`owner` = the campaign's owner by email, `recipients` = the
fixed addresses, `webhook`). `POST /workspace/notifications/test/` sends a test by every configured channel and records
when the webhook last worked.

| Event | Fires from | Default |
|---|---|---|
| `send_completed` | `runs.finalize` | owner, webhook |
| `send_failed` | `runs.finalize` (nothing went out) and `runs._fail` (could not start) | owner, recipients, webhook |
| `approval_requested` | the request endpoint; every approver is always emailed | webhook |
| `approval_decided` | approve and send-back; goes to the person who asked | owner |
| `engine_trouble` | the circuit breaker opening on a sending engine | recipients, webhook |
| `ab_winner` | `abtest.decide` | owner |
| `weekly_report` | `send-weekly-reports` | recipients |

`apps.platform_ops.notifications`: `prepare()` reads the settings inside the caller's transaction, `deliver()` does
the sending after it; nothing here ever raises into the work it reports on. Email goes through `mail.send` with the
`workspace_notification` template, so the workspace's own mail server is used when it has one.

## 4. Approval before a production publish (patch 0022)

`GET` / `PUT /workspace/approvals/` (`user.admin`): `require_approval`, who can approve (every active user whose role
carries `campaign.approve`; the patch grants it to every role that holds `user.admin`), and how many campaigns wait.
Switching it on needs at least one approver.

With it on: `POST /campaigns/{id}/request-approval/ {note}` (`campaign.edit`) puts the campaign in `REQUESTED` and
emails the approvers; `POST .../approve/ {note}` or `POST .../send-back/ {note}` (`campaign.approve`; never the person
who asked) decides it; `POST .../publish/` answers 409 until the campaign is `APPROVED`, and the checklist carries an
"Approved for production" item. Any change to the campaign, its lists or its targets withdraws a request or an approval
with a note in the activity log. The campaign carries `approval` (status, who and when, notes) and
`approval_required`; its `actions` gain `request_approval`, `approve` and `send_back`; the list filters on
`?approval=requested`. Activity events: `APPROVAL_REQUESTED`, `APPROVED`, `APPROVAL_RETURNED`, `APPROVAL_WITHDRAWN`.

## 5. Preference centre (patch 0028)

A page where a person chooses which channels and topics they receive, reached from a link in an email. **Off by
default**: only the unsubscribe link exists, exactly as before. Settings → Preference Centre (`user.admin`) switches it
on and keeps the topics and the page's words while it is off.

`GET` / `PUT /workspace/preference-center/` (`user.admin`; `tenant.settings.preference_center`): `enabled`,
`brand_name` (blank = the workspace's name), `heading`, `email_description`, `sms_description`, `footer` (the postal
address belongs here), `privacy_url` (must start with `https://`), `allow_opt_in`; plus, read-only, `tag`
(`{{preference_url}}`), `preview_url` (a test-marked token: the page with nothing saved), `stats` for the last 30 days
(page opened = `tracking_event` PREFERENCE_VIEW; topics unticked; unsubscribed and opted in again = `consent_record`
rows with source `PREFERENCE_CENTER`) and `topics` (how many). Errors land on their field.

`/subscription-topics/` — `subscription_topic`: `name`, `description`, `channels` (EMAIL, SMS), `is_shown`, `sort_order`;
`code` is made from the name; each row carries `opted_out` (people who unticked it) and `campaigns` (filed under it).
Reads need `campaign.view` (the setup's Topic field) and the list answers `{enabled, results}`; writes need `user.admin`.
`DELETE` soft-deletes: the topic leaves the page and the setup's choices, and a campaign filed under it is told at
publish ("This campaign's topic was removed").

**The page** (`GET` / `POST /api/v1/public/preferences/?t=`, `api/v1/preferences_public.py`, template
`templates/public/preferences.html`): the same signed token as the unsubscribe link (workspace, contact, campaign, run,
address), no sign-in; the tenant resolver reads the workspace from the token and a bad token gets the page's own 400.
It shows the masked address, an Email switch, a Text messages switch when the customer record has a mobile number
(last four digits), one checkbox per shown topic, "Receipts and order updates" locked on, Save Preferences and
"Unsubscribe from all marketing messages". Channel changes are ordinary consent records with source
`PREFERENCE_CENTER` (`unsubscribe.opt_out` / `opt_in`, which now take the source and write `mailer_execution_id` for
email); topic choices go to `party_topic_preference` (`opted_out`, `evidence`). With `allow_opt_in` off, a switched-off
channel is shown locked with the date and a POST that ticks it is refused on the page. Opening the page records a
PREFERENCE_VIEW. While the centre is off the page says the workspace offers none and links to the unsubscribe page.
A test send's token (`unsubscribe.test_token`) opens the page in preview: nothing can be saved.

**In an email**: `{{preference_url}}` (platform tag `preference_url`, inherited by every workspace) is the person's page
at send time, or the unsubscribe link while the centre is off, so an email never carries a dead link; the unsubscribe
confirmation page offers "Or choose what you receive" while it is on. The unsubscribe link stays required in marketing
email.

**Campaigns**: `campaign.topic` (setup, Content step, shown when the centre is on and a topic fits the channel). While
the centre is on, a marketing email or text campaign cannot be published to production without a topic once the
workspace has one (`publish_problems["topic"]`, checklist item "Topic chosen"); the audience build leaves out everyone
who unticked the campaign's topic (`TOPIC_OPTED_OUT`, after the consent rules and before the frequency cap, in
`audience.py` and `audience_sms.py`), the estimate on the Audience step shows the same line, and the change log says
"topic". Switching the centre off stops the filter without deleting anyone's choice.

## 6. Tests

Scratchpad suites, each one rolled-back transaction on the local database with email and webhooks captured:
`test_approval.py` (20), `test_reports.py` (9), `test_suppressions.py` (11), `test_ab_sendtime.py` (16),
`test_preference_center.py` (28: settings, topics, the page's every state, the tag, the audience estimate, the publish
check).
