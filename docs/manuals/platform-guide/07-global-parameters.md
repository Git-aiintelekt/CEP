# Global Parameters

**Where:** Configuration → Global parameters.

## What this is for

The installation's defaults and limits, one row per parameter, read by every tenant unless the product gives a tenant its own setting. Each has a kind (text, whole number, decimal, yes/no, a list, an object) and is edited as a typed value, never as raw JSON. Secrets never live here.

## Who can use it

Platform administrators.

## The parameters

| Parameter | Kind | Default | What it changes |
|---|---|---|---|
| security.password_link_hours | number | 72 | How long a password link works. |
| security.support_access_minutes | number | 30 | How long a support session lasts. |
| security.notify_user_on_support_access | yes/no | yes | Whether the user is emailed when support signs in as them. |
| security.mfa_required_for_staff | yes/no | no | Every staff account must pass the second factor to open the back-office. |
| security.idle_timeout_minutes, security.idle_warning_seconds | number | 120, 60 | How long the app waits before warning of inactivity, and how long the warning stays before signing out. |
| billing.invoice_due_days | number | 14 | The due date of an issued invoice. |
| billing.usage_warning_percent | number | 80 | Where a usage meter turns amber. |
| alerts.recipients | list | empty | Who is emailed when a check fails or a job breaks. |
| alerts.webhook_url | text | empty | A Slack-compatible webhook for the same. |
| alerts.renotify_minutes | number | 240 | How often an open alert is notified again. |
| errors.retention_days | number | 30 | Days error occurrences are kept; a resolved error not seen for this long is removed. |
| errors.spike_per_15_minutes | number | 25 | Occurrences of one error within 15 minutes that make the Errors check fail and alert. |
| metrics.retention_days | number | 30 | Days of per-minute request figures kept for Tenant performance. |
| uptime.failures_before_alert | number | 2 | Failed probes in a row before an uptime target is down and an alert goes out. |
| uptime.retention_days | number | 90 | Days of uptime probes kept. |
| tenancy.default_industry | text | GENERIC | The profile a tenant without one follows. |
| tenancy.offboarding_export_days | number | 30 | How long an offboarding export is kept. |
| messaging.max_upload_mb | number | 5 | The largest image a designer may upload. |
| messaging.sms_quiet_hours | object | 21:00 to 08:00 | Marketing texts due in this window (the workspace's zone) wait until it opens; an empty object switches it off. |
| lists.import_max_parallel | number | 2 | Uploads processed at once across the whole platform. |
| lists.import_max_waiting_per_workspace | number | 5 | Unfinished uploads a workspace may have before a new one is refused. |
| lists.import_chunk_rows | number | 5000 | Rows per chunk of an upload. |
| integrations.inbound_per_minute | object | 60 / 600 / unlimited per plan | The inbound pace limit per plan code for the point of sale and other callers. |
| integrations.log_body_max_bytes | number | 65536 | How much of a request or answer body the call log keeps. |
| integrations.log_retention_days, integrations.metric_retention_months | number | 90, 13 | How long the call log and its roll-up are kept. |
| platform.api_public_url | text | empty | The public address callback addresses and links are built from. |

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Key, Category, Description | The identity; the category groups the list. | |
| Kind | Text, whole number, decimal, yes/no, list, object. | How Value is read. |
| Value | As it will be read: text, a number, yes or no; a list one entry per line; an object as key: value lines. | The parameter. |

## How to

**Send alerts to the on-call channel.** `alerts.recipients` → the addresses one per line; `alerts.webhook_url` → the chat webhook. The next evaluation uses them.

**Lengthen the password link for a slow customer.** `security.password_link_hours` → 168. Links made from now on last a week.

## What happens behind the scenes

Parameters are cached for a short time in every process and invalidated on save, so a change reaches the workers within minutes. A value the product does not understand is refused on save with the kind named.

## Things to know

- Keys and the platform's mail password are not parameters; they live in the environment and the mail server page.
- A workspace's own settings (its consent policy, notifications, quiet hours when a product gives one) override the parameter for that workspace only.
