# Engine Health

**Where:** Overview → Engine Health. The number on the menu item counts the engines failing now. Problems also open alerts (Overview → Alerts), which are emailed to `alerts.recipients` and posted to the alert webhook. A workspace sees its own engines' health on Settings → Sending Engines.

## What this is for

Knowing when a sending engine stops working before the campaigns show it. C360 records every call to an engine (how long it took, what came back) and every callback, but a dead webhook, a refused key or a list that bounces used to be noticed only when someone looked. The check-engine-health job looks at every active engine of every workspace every 10 minutes; check-engines-daily runs each engine's Check (key and address, nothing sent) once a day.

## Who can use it

Platform staff see the page. Run Checks Now and Run Daily Check need a platform administrator.

## The checks

| Check | Looks at | Raises |
|---|---|---|
| Callbacks | The last callback from the engine and the messages sent since. | **Failing** when messages went out but the engine has not called back for `engine_health.callback_silence_minutes` (60). A message is given 10 minutes before its silence counts. |
| Refused Calls, 1 h | The last hour's calls in the integration log. | **Failing** when the key was refused (a 401 or 403 after the last good call) or the circuit breaker is open. **Attention** when more than `engine_health.rejection_rate_pct` (1%) of the calls were refused or failed. |
| API Speed, 1 h | The 95th percentile of the last hour's call times. | **Attention** above `engine_health.p95_ms` (5,000 ms). Judged from 10 calls. |
| Bounces · Complaints, 24 h | The last day's email from the engine. | **Attention** above `engine_health.hard_bounce_pct` (2%) hard bounces or `engine_health.complaint_pct` (0.1%) complaints; **Failing** at twice either. |
| Failed Texts, 24 h | The last day's text delivery receipts. | **Attention** above `engine_health.sms_failure_pct` (5%) failed; **Failing** at twice it. |
| Receipts | Texts of the last two hours still without a receipt after `engine_health.receipt_wait_minutes` (15). | **Attention** above `engine_health.missing_receipt_pct` (1%) of them. |
| Daily Check | The engine's last Check. | **Failing** when it failed. |

A rate is judged only from `engine_health.min_sample` (50) messages or calls in its window; fewer is **Quiet** and shows the counts (*1 of 1*) instead of a share, as an engine's own Check probe would otherwise read *100%*. An engine that sent nothing in a day is Quiet overall. All the lines are Global Parameters (category *Engine health*) and take effect within a minute.

**Digivize, said plainly.** Digivize accepts texts but has never posted a delivery receipt from its sandbox. A text engine that has never called back is therefore not judged on Callbacks or Receipts: it shows **No Receipts Yet**, one standing warning. Its alert opens acknowledged, is emailed once and is not repeated. The first receipt that arrives switches the real checks on by themselves.

## The page

| Part | What it shows |
|---|---|
| Run Checks Now | Runs the check-engine-health job at once. |
| Run Daily Check | Runs every active engine's Check at once (key and address, nothing sent). |
| Engines, Failing, Attention, Healthy or Quiet | The counts across every workspace. |
| Engines | One row per active engine, worst first: the workspace and engine, its health and the reason, messages sent in the last hour, the last callback, refused calls, the p95, bounces and complaints (failed texts for a text engine) and the Daily Check. A figure over its line is coloured. |
| The Lines | The thresholds in force, in words. |

## Alerts

Each failing check of an engine is one alert, named *Engine · workspace · engine · check*, for example *Engine · NWA · Postal Marketing · Callbacks*. It is notified when it opens, again every `alerts.renotify_minutes` while it lasts unless acknowledged, and resolved with a notice when the check passes. Failing checks are Failing alerts; Attention checks are warnings.

## Step by step

**An engine is Failing on Callbacks.** The engine is sending but its news is not coming back. In the provider's console check that the workspace's callback address is registered and switched on (the workspace copies it with Copy Webhook URL on Sending Engines). Postal: the mail server → Webhooks.

**An engine is Failing on Refused Calls with a refused key.** The key was revoked or replaced at the provider. The workspace enters the current key (Sending Engines → Edit) and presses Check; the health clears at once.

**Bounces need attention.** Find the campaign and list that sent the bad addresses (the workspace's run results, or the Emails Sent list under Delivery) before the next send makes the provider throttle the domain.

**Tune a line.** Configuration → Global Parameters → search `engine_health` → change the value. The next pass uses it.

## What happens behind the scenes

The job reads each workspace in its own row-level-security scope: the integration log (calls out, callbacks in, timings, status codes), the circuit breaker's state, the email and text records of the last day, and the engine's last Check. It stores one result per engine in `delivery_provider_health` (patch 0069), which this page, the workspace's page and the alert evaluator read. Before patch 0069 is applied the job skips and the page says so.
