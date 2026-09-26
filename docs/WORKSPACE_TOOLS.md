# Reports, Suppressions, Notifications, Approvals

Four workspace-level tools built on the backend first (their pages follow the reviewed page designs). Everything here is
tenant-scoped through RLS like the rest of the API.

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

## 5. Tests

Scratchpad suites, each one rolled-back transaction on the local database with email and webhooks captured:
`test_approval.py` (20), `test_reports.py` (9), `test_suppressions.py` (11), `test_ab_sendtime.py` (16).
