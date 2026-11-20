# Integrations

**Where:** Settings → Engagement → Integrations.

## What this page is for

Every exchange with an outside system goes through one gate: the point of sale posting receipts in, the sending engines being called out, the callbacks coming back. This page shows each integration's health and pace, lets you pause one, and keeps the call log: every request and answer in either direction, with what was sent and what came back, for the day a receipt did not arrive or an engine refused a message.

## Who can use it

| | |
|---|---|
| Permission | `provider.edit`. |

## The fields and controls

### The cards

| Control | What it is | What it changes |
|---|---|---|
| The card | One per integration: POS Receipts (in), and one per sending engine (out). Its health: healthy, degraded (5 percent failures or more), circuit open, paused, no calls; the last error under it when it is not healthy. The cards refresh every minute. | Nothing; it is a reading. Degraded or circuit open means receipts or sends through it are failing or waiting now. |
| Calls, 24 h, Failures, p95, Throttled | The last day's calls, the share that failed (amber above 0, red from 5%), the slow end of response times, the calls the pace limit held. | Nothing; a reading. Throttled calls are slowed, not lost. |
| The chart | Calls per 15 minutes over 24 hours, with the failed and throttled share; the busiest quarter hour. | Nothing; it shows when the trouble started. |
| Email Alerts | A switch per integration, on by default. Saved at once. | On: when this integration's circuit opens, the workspace is told by the channels set under Settings → Notifications. Off: this integration raises no such notification; the card still shows the trouble. The other integrations are not affected. |
| View Log | A link on the card. | Sets the call log below to this integration, with Direction Both, Failures Only off and the search cleared, starting on page 1. Changes nothing in the integration. |
| Pause / Resume | Pause asks first: *Pause {name}? …*. Resume needs no confirmation. | Pause on POS Receipts: every call from the point of sale is refused with a *paused* answer (HTTP 503) until it is resumed, so the registers try again later. Pause on an engine: every send through it waits; nothing is lost. Resume lets calls through again and closes an open circuit at once, without waiting for the cooldown. |

### The call log

| Control | What it is | What it changes |
|---|---|---|
| Integration | All Integrations (default) or one of them. | Shows only that integration's calls. |
| Direction | Both (default), Received (calls into C360, such as receipts and engine callbacks), Sent (calls C360 made to engines). | Shows only calls in that direction. |
| Failures Only | A tick box, off by default. | Shows only calls that did not succeed (rejected, error, retry, throttled, breaker or paused). |
| Correlation ID or Reference | The id a caller sent, or a reference such as `receipt:R-1001` or `mailer_execution:240`. Press Enter to search. | Shows only the calls carrying that id or reference: one search finds the call in, the send out and what the engine reported. |
| The table | Time, Integration (with the direction and the reference), Call (method and address), Outcome (OK, Rejected, Retry, Error, Throttled, Breaker, Paused) with the status code, and Duration. Newest first. | Clicking a row opens the call. |
| Rows per Page | 10, 25 (default), 50 or 100, with Previous and Next. | How many calls a page shows. Remembered in this browser. |
| A call | Opens with its outcome, status, duration and correlation id (with Copy), then What Was Sent / What Came Back (or What Was Received / What Was Answered): headers and bodies, keys replaced by `***` and card numbers masked. | **Retry Send** (a failed send) queues the message again; it goes out on the dispatcher's next pass, as a new attempt in the log. **Replay Callback** (a received callback) applies what the engine sent once more, for a callback that failed to apply; opens and clicks are counted again only if the first pass failed. |

## How to

**A register says the receipt was accepted but the customer has nothing.** Search the transaction's number as `receipt:…`: the row in shows what the point of sale sent and the S-code answered; the row out shows what the engine said; a later row from the engine is the delivery or the bounce.

**An engine is failing.** The card reads degraded or circuit open and Notifications told you. Open the log with Failures Only: the engine's own words are in each answer. Fix the key or the address under Sending Engines, press Check, and Resume to close the circuit without waiting.

**Pause the point of sale during maintenance.** Pause on POS Receipts. Registers get a paused answer and nothing is lost; Resume afterwards.

## What happens behind the scenes

Each call is paced by a per-minute limit (an API key's own, the plan's inbound limit, the engine's Messages per Minute), guarded by a circuit breaker that opens after repeated failures and probes again after a cooldown, and written to the log with the request and the answer. The cards and charts read a per-minute roll-up, never the log itself. The log is kept three months.

## Things to know

- Keys and card numbers are masked in the log; everything else is stored exactly as exchanged, by design.
- Throttled calls are not failures: the caller is told to slow down and tries again.
