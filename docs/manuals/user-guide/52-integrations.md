# Integrations

**Where:** Settings → Integrations → Integrations.

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
| The card | One per integration: POS Receipts (in), and one per sending engine (out). Its health: healthy, degraded (5 percent failures or more), circuit open, paused, no calls. | |
| Calls 24 h, Failures, p95, Throttled | The last day's calls, the share that failed, the slow end of response times, the calls the pace limit held. | |
| The chart | Calls per 15 minutes over 24 hours, with the failed and throttled share; the busiest quarter hour. | |
| Email Alerts | Whether a circuit opening on this integration notifies the workspace by the channels under Notifications. | |
| View Log | The call log filtered to this integration. | |
| Pause / Resume | Pause stops the calls: the point of sale gets *paused* answers, an engine's sends wait. Resume continues and closes an open circuit at once. | |

### The call log

| Control | What it is | What it changes |
|---|---|---|
| Integration, Direction (Both, Received, Sent), Failures Only | Filters. | |
| Correlation ID or Reference | The id a caller sent, or a reference such as `receipt:R-1001` or `mailer_execution:240`: one search finds the call in, the send out and what the engine reported. | |
| The table | Time, Integration (with the direction and the reference), Call (method and address), Outcome (OK, Rejected, Retry, Error, Throttled, Breaker, Paused) and the status code. 25 a page; Rows per Page is remembered per browser. | |
| A call | Opens with its request and answer, headers and bodies, keys replaced by `***` and card numbers masked. **Retry Send** hands a failed send back to the engine; **Replay Callback** applies a received callback once more. | |

## How to

**A register says the receipt was accepted but the customer has nothing.** Search the transaction's number as `receipt:…`: the row in shows what the point of sale sent and the S-code answered; the row out shows what the engine said; a later row from the engine is the delivery or the bounce.

**An engine is failing.** The card reads degraded or circuit open and Notifications told you. Open the log with Failures Only: the engine's own words are in each answer. Fix the key or the address under Sending Engines, press Check, and Resume to close the circuit without waiting.

**Pause the point of sale during maintenance.** Pause on POS Receipts. Registers get a paused answer and nothing is lost; Resume afterwards.

## What happens behind the scenes

Each call is paced by a per-minute limit (an API key's own, the plan's inbound limit, the engine's Messages per Minute), guarded by a circuit breaker that opens after repeated failures and probes again after a cooldown, and written to the log with the request and the answer. The cards and charts read a per-minute roll-up, never the log itself. The log is kept three months.

## Things to know

- Keys and card numbers are masked in the log; everything else is stored exactly as exchanged, by design.
- Throttled calls are not failures: the caller is told to slow down and tries again.
