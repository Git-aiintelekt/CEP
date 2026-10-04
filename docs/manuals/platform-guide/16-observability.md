# Errors, Uptime and Tenant Performance

**Where:** Overview → Errors, Uptime, Tenant performance. A tenant's own figures are also on its page, under Tenants → the tenant → Performance.

## What this is for

Knowing that something broke before a customer says so, and seeing how each tenant is served. Errors collects every failure from three places: the API, the background jobs, and the browsers of the people using the app. Uptime calls the installation's public addresses every minute and alerts when one stops answering. Tenant performance shows each tenant's requests, response times, sends and failures side by side, worst first.

## Who can use it

Platform staff. Tenants never see these pages; their own workspace shows only its own sends and integrations.

## The fields and controls

### Errors

| Field | What it is |
|---|---|
| Error | The message, and under it the kind (the exception) and where it happened: the endpoint, the job, or the page. |
| Source | API, Job or Browser. |
| Occurrences | How many times it happened since it was first seen. Every occurrence is counted; at most ten a minute are kept with their details. |
| Tenants | How many tenants it touched. |
| First seen, Last seen | When it started and when it last happened. |
| State | Open, Regressed (resolved, then seen again), Resolved, Ignored. The list opens on Open; the filter shows the rest. |
| Resolve, Ignore, Reopen | Actions on the list and buttons on the error's page. Resolve says it is fixed: if it happens again it reopens as Regressed. Ignore keeps counting but no longer counts as a problem. |
| The error's page | The state, the count, the tenants it touched, the last 14 days as bars, a note for what was found or the ticket, and the recent occurrences with the request, the tenant, the release and the full stack. |

### Uptime

| Field | What it is |
|---|---|
| Name, Address | What is called. Three targets are made on the first run from the installation's addresses: the API's health address, the app's first page, and the back-office sign-in. Add more with Add uptime target. |
| Expected status, Expected text | A healthy answer has this status (200 by default) and, when set, contains this text. The app target expects the page's root element, so a blank server error page counts as down. |
| Timeout (ms) | A slower answer is a failure. 5,000 by default. |
| Active | Off pauses the target without losing its history. |
| State, Since | Up, Down or Not checked yet, and for how long. |
| 24 h, 7 days, 30 days | The share of probes that succeeded. |
| Probe now | Calls every active target at once, without waiting for the minute. |
| The target's page | Availability and response time (p95) for each period, and the last 30 probes with their status, time and error. |

### Tenant performance

| Field | What it is |
|---|---|
| Period | Last hour, last 24 hours or last 7 days. |
| State | Trouble, Watch or Healthy. Trouble: server errors 2% or more, p95 2.5 s or more, bounces 5% or more, complaints 0.1% or more, or integrations failing 10% or more. Watch: a quarter of those, or any open error. |
| Requests, Server errors, p95 | The tenant's API calls, the share that failed on the server (5xx), and the time 95% of them finished within. The slowest endpoint is named under the tenant. |
| Sent, Delivered, Bounced, Complaints | Email and text messages created in the period and what became of them. |
| Integrations failing | Calls to and from its integrations that failed or were refused, of all calls. |
| Errors | Error occurrences tied to the tenant, and how many distinct errors are still open. |
| The tenant's page | The same figures as tiles, requests per hour as bars (a red bar had server errors), every endpoint it used with its counts and times, failing first, and the errors it hit. |

## How to

**Someone reports "the page crashed".** Errors → filter Source: Browser → find their page. The occurrence shows their workspace, the page, the browser and the component that failed. Fix it, then Resolve: if the fix did not hold, it comes back as Regressed.

**Find out why one tenant is slow.** Tenant performance → the tenant → Endpoints. The slowest endpoints are near the top; compare with another tenant on the same route to tell the tenant's data apart from the code.

**Watch another address.** Uptime → Add uptime target → the name, the address, and the text a healthy page contains. It is probed within the minute.

**Silence a known error.** Errors → the error → Ignore. It keeps counting and you can reopen it.

## What happens behind the scenes

Every API request is timed and counted per tenant, per endpoint and per minute; each server process adds its figures to the database every 30 seconds, outside the request. Response times are kept as counts in time buckets (under 50, 100, 250, 500 ms, 1, 2.5, 5, 10 s, and above), so p95 is an estimate, interpolated inside the bucket it falls in.

Any error the API or a job logs with an exception is recorded on a connection of its own, so it is kept even when the request that raised it is rolled back. A job that fails is recorded once, as a job error. The app reports errors from the browser through a public endpoint that takes at most 30 reports a minute from one address. Errors are grouped by their kind and where they happened, with ids and numbers taken out, so one crash on many campaigns is one error.

The probe-uptime job runs every minute. A target is down after `uptime.failures_before_alert` failures in a row and up again on the first success; either change runs the alert evaluation at once, so the notice goes out within the minute rather than at the next 5-minute pass.

Two health checks feed Home and the alerts. **Errors** asks for attention when an error is new or came back in the last hour, and fails when one error happens `errors.spike_per_15_minutes` times in 15 minutes. **Uptime** fails while any target is down. Both notify through `alerts.recipients` and `alerts.webhook_url` like every other check.

The prune-observability job removes, once a day, error occurrences after `errors.retention_days`, resolved and ignored errors not seen for that long, request figures after `metrics.retention_days`, and probes after `uptime.retention_days`.

## Things to know

- Uptime probes come from the server itself. They prove the addresses answer through the public route the server can reach; an outage of the network in front of it is better caught by an outside monitor calling `/healthz` as well.
- Figures from the last 30 seconds may not be written yet. The pages keep their figures for one minute.
- A browser report has no sign-in requirement, so it can come from the sign-in page itself. It never carries form contents, only the page, the error and the browser.
- Each occurrence records the release it happened on: the server's git commit, or `CEP_RELEASE` when set.
