# Jobs, Alerts and System Checks

**Where:** Operations → Job runs; Overview → Alerts; the home page's System checks and Scheduled jobs.

## What this is for

Everything CEP does on a timer, and how you know it is working: seventeen scheduled jobs with their runs, fifteen system checks, and the alerts raised when a check fails or a job breaks.

## Who can use it

Every staff account reads; acknowledging an alert needs change rights.

## The jobs

| Job | Does | Every |
|---|---|---|
| outbox-relay | Publishes domain events to the stream. | 5 min |
| ensure-monthly-partitions | Creates next months' partitions for every tenant. | 13 h |
| apply-partition-retention | Drops or detaches expired partitions. | 49 h |
| rollup-usage | Meters messages, contacts and storage per tenant. | 3 h |
| evaluate-alerts | Runs the health checks and notifies on changes. | 20 min |
| generate-invoices | Drafts last month's invoices. | 32 days |
| run-tenant-operations | Executes requested exports, moves and offboardings. | 30 min |
| dispatch-campaign-runs | Starts campaign runs that are due and closes finished ones. | 10 min (every minute on the scheduler) |
| plan-recurring-runs | Plans the next send of recurring campaigns. | 30 min |
| refresh-audience-lists | Brings contact lists that follow an audience in line with it. | 3 h |
| process-list-imports | Reads, checks and imports uploaded contact list files. | 10 min |
| rollup-integration-metrics | Rolls the integration log up into per-minute figures and prunes both. | 20 min |
| decide-ab-winners | Chooses the subject-line winner of runs whose decision time has come. | 10 min |
| send-weekly-reports | Emails the weekly report to workspaces that asked for one. | 3 h |
| probe-uptime | Calls the uptime targets and alerts when one goes down or comes back. | 10 min (every minute on the scheduler) |
| prune-observability | Removes errors, request figures and uptime probes past their retention. | 49 h |
| attribute-orders | Credits the orders workspaces sent to campaigns and writes each campaign's revenue, cost and ROI (workspaces with attribution on). | 30 min (every 5 minutes on the scheduler) |
| enroll-journey-customers | Enrols the customers who meet a live journey's entry: list members, events (sent, from orders, from tracking), segment changes. A Fixed journey closes after its first pass. | 10 min (every minute on the scheduler) |
| advance-journey-customers | Moves journey customers whose next step is due: waits, conditions, messages (through a daily campaign per step), coupon requests, tier and segment changes. | 10 min (every minute on the scheduler) |
| activate-scheduled-journeys | Takes journeys approved for a later time live once it comes, retiring the older live version. | 10 min (every minute on the scheduler) |
| rollup-journey-analytics | Rolls journey enrolments and steps into the Performance figures. | 49 h (nightly) |

The cadence is how late a job may be before it reads overdue; the scheduler runs most of them more often. Two chatty jobs (the outbox relay and the list imports) record only failures and one success a minute.

## The checks

| Check | What it looks at |
|---|---|
| Database | The pool database answers. |
| Tenant isolation | The application role and row-level security are in place. |
| Migrations | Nothing unapplied. |
| Partitions | Every tenant has partitions for the months ahead. |
| Event outbox | Events are being relayed, not piling up. |
| Failed messages | Dead letters, messages that failed for good. |
| Cache | The cache answers (throttles and breakers live in it). |
| Background workers | Workers are alive. |
| Configuration | The settings an installation needs are set, the public address among them. |
| Email | The platform's mail server's last test. |
| Secrets at rest | The encryption key is set, so credentials can be stored. |
| Tenant operations | No operation stuck. |
| Integrations | No circuit open for long. |
| Errors | No error new or returning in the last hour, and no error repeating fast. See Errors, Uptime and Tenant Performance. |
| Uptime | Every uptime target answers. |

## The fields and controls

| Control | What it is |
|---|---|
| Job runs | Started, job, status (Succeeded, Failed, Running), duration, worker, the error's first line; filter by status and job. A run opens with its result or its full error. |
| Alerts | Opened, check, severity, summary, notifications sent, state; Acknowledge. |
| Home → System checks, Scheduled jobs | The live picture: *n of 15 fine*, *n of 17 on time*. |

## How to

**A job is overdue.** Home says so. Job runs → filter by the job: a failed run shows the error; no run at all means the scheduler or a worker is not running. Restart the worker; the next pass catches up (runs are idempotent).

**Stop the noise from a known problem.** Alerts → the alert → Acknowledge. It stays open and resolves itself when the check passes.

## What happens behind the scenes

Every job records a run with its result or error. The evaluate-alerts job compares the checks and the job report with the open alerts: a new problem opens one alert and notifies `alerts.recipients` and the webhook; a lasting one is notified again every `alerts.renotify_minutes`; a problem that went away resolves its alert with a notice.

## Things to know

- A job shown *off* is deliberately not scheduled in this installation and never alerts.
- Without a message broker one scheduler process runs every job in turn; with Celery the workers listen on their queues.
