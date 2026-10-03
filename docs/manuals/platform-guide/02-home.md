# The Home Page, Alerts and Usage

**Where:** Home at the top of the menu; Alerts and Usage against limits under Overview.

## What this is for

The home page is the platform's own cockpit: what needs attention right now, the quick actions, the figures, the newest tenants, the latest definition changes, the system checks and whether the scheduled jobs are on time. Alerts is the list of problems the checks raised and whether they were acknowledged; Usage against limits is every tenant's month so far, worst first.

## Who can use it

Every staff account. Acknowledging an alert needs change rights on alerts.

## The fields and controls

### Home

| Section | What it shows | Where it leads |
|---|---|---|
| Needs your attention | A failing or warning check, a failed or overdue job, the scheduler not running, an open alert, subscriptions past due, trials ending within 7 days, draft invoices to issue. | The check, the job, the alert, the subscription or invoice list. |
| Quick actions | New tenant, Find a user, Usage against limits, Invoices, Global parameters, Mail server, Move or offboard, Audit trail. | |
| Platform at a glance | Tenants, users, messages this month and the other headline numbers. | |
| Newest tenants | The latest workspaces with their status dot. | The tenant. |
| Latest changes | The newest entries of the change audit trail: who changed which definition. | The trail. |
| System checks | Database, tenant isolation, migrations, partitions, event outbox, failed messages, cache, background workers, configuration, email, secrets at rest, tenant operations, integrations; *n of 13 fine*. | |
| Scheduled jobs | Every job with its last run and whether it is on time; *n of 14 on time*. | Job runs. |

### Alerts

| Control | What it is | What it changes |
|---|---|---|
| The list | Opened at, the check, severity (fail or warn), the summary, the notifications sent, the state (Open, Acknowledged, Resolved). | |
| Acknowledge | Stops the repeated notification while the problem lasts. | The alert resolves itself when the check passes again. |

### Usage against limits

| Column | What it is |
|---|---|
| Tenant, plan, messages, contacts, users, storage, deliverability tests | This month's usage against each limit, with the share used; tenants closest to a limit first. A hard-capped plan at its message limit stops sending. |

## How to

**Start the day.** Home: anything under Needs your attention first. A red check or a failed job has its detail one click away; an open alert says what was already notified.

**See who is about to hit a limit.** Usage against limits. Warn the tenant, or change the plan under Subscriptions.

## What happens behind the scenes

The evaluate-alerts job runs the health checks and the job report every 20 minutes. A problem opens one alert, is notified at once by email to `alerts.recipients` and to the `alerts.webhook_url` chat webhook, re-notified every `alerts.renotify_minutes` while it lasts, and resolved with a notice when the check passes again. The usage figures come from the rollup-usage job, every three hours; deliverability tests are counted live.

## Things to know

- A job marked *off* is deliberately not running (no broker, a setting); it is not a problem and raises no alert.
- The home page reads live; it is not cached.
