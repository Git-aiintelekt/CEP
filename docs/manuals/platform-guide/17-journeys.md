# Journeys

**Where:** Tenants → the workspace → Industry and features (the switch); Jobs and checks (the scheduler); the workspace's own Journeys pages (what tenants build). The User Guide's Journeys chapter is what the workspace reads.

## What this is for

Journeys are the automated, per-customer paths a workspace draws in the app: who enters, the steps they go through (waits, conditions, splits, messages, coupons, record changes, webhooks, a goal) and where the path ends. The platform team does not build journeys; it makes sure a workspace can, and that the machinery behind every workspace's journeys runs.

## Who can use it

Platform operators. Nothing here is visible to a workspace.

## What a workspace needs from the platform

| Item | Where | Notes |
|---|---|---|
| The Journeys feature | The tenant → Industry and features → Journeys → On (or Default when the industry profile has it on) | The plan has the last word: a plan whose features exclude `journeys` keeps it off for every tenant on it (Plans and billing). Without the feature the app hides the Journeys menu, the Home card, and refuses the tenant's events (`POST /api/v1/events/` answers 403). |
| Outbound webhooks | The `webhooks` feature (on by default) | The Webhook step is offered in the builder regardless; the feature governs the workspace's notification webhooks. |
| The scheduler | cep-jobs, one process for the platform (Jobs and checks) | Journeys do nothing without it: enrolment, advancement and activation run every minute, the roll-up nightly. Exactly one scheduler must work a given database: a second one skips a workspace the first holds (an advisory lock per workspace, per pass) rather than running it twice. |
| Secrets at rest | `FIELD_ENCRYPTION_KEY` on the servers (the Secrets at rest check) | A Webhook step's signing secret is encrypted with it. Without the key, secrets use a key derived from `SECRET_KEY`, which the check flags. |
| C360's feeds into the workspace database | The data team, outside CEP | `customer_master` (the customer records, with `custom_attributes` such as `loyalty_tier`, `birth_date`, `timezone`), `segment` and `customer_segment_membership`, `coupon`, `loyalty_tier`. CEP treats them as synced copies and never invents a customer: only a customer in the records can enter a journey. A contact list upload adds the people CEP did not know, owned by CEP. |
| The database layer | Patches 0045 (the Goal step: conversions, revenue, the roll-up's goal and message columns) and 0046 (per-journey suppressions, the JOURNEY list-member source, the `journey.export` and `journey.suppress` permissions) | Both are idempotent re-runs of the platform-operations layer; apply them before the code that reads them. The Needs Attention retries and the Webhook step need no patch. |

## What the workspace does itself

The workspace's administrator finishes the set-up in the app, and the User Guide's chapter walks them through it:

1. Roles: `journey.view`, `journey.edit`, `journey.activate`, `journey.export`, `journey.suppress` (Workspace Admin holds all five after patch 0046; roles that already held `journey.edit` were granted the two new ones).
2. A verified email sender and, for texts, a texting engine; published templates; a test list.
3. API keys: `events:ingest` for the systems that send events (the shop, the app, the loyalty system), `orders:ingest` for the shop's orders (Attribution), `coupons:issue` for C360 to fulfil coupon requests.
4. Consent policy, suppressions, the preference centre and frequency caps: journey messages go through the same send engine as campaigns.

## How journeys get their data

| From | Through | Used for |
|---|---|---|
| The shop, the app, the point of sale, the loyalty system | `POST /api/v1/events/` (up to 500 per call, deduplicated by `event_id`); `POST /api/v1/orders/` and POS transactions become Purchase events through Attribution | Event entries, event conditions, goals, conversions and revenue |
| C360 | Direct writes to the workspace's tables (above) | Who exists, their attributes and dates, segments, coupons, tiers |
| CEP itself | Email opens and clicks, SMS replies, No Response, Preference Update, Loyalty Tier Change, Coupon Issue | Entries and conditions that need no external sender |
| The workspace | Contact list uploads (the template has Time zone, Loyalty tier, Last order date columns) | Lists, the people CEP owns, the attributes an upload adds |
| Journeys, outward | The Webhook step: a signed JSON POST (`X-CEP-Signature`, `X-CEP-Timestamp`, `X-CEP-Delivery`) to an https address; every call in the integration log (system WEBHOOK) | The tenant's own systems |

## The jobs, and what to watch

| Job | Every | What it does |
|---|---|---|
| enroll-journey-customers | minute | Enters the customers who meet a live journey's entry: list members, events (seven days back at most, 5,000 per journey per pass), segment changes, Date / Time moments (each fires once), attribute matches; Only Customers Where filters and the journey's own suppressions apply. A Fixed journey closes after its first pass. |
| advance-journey-customers | minute | Converts anyone whose goal event arrived, then moves the customers whose next step is due. The log line's figures: moved, held, finished, busy, failed, converted, retrying, gave_up, locked. `locked` above 0 means another scheduler holds that workspace. |
| activate-scheduled-journeys | minute | Takes approved journeys live when their time comes, retiring the older live version. |
| rollup-journey-analytics | nightly | Rolls enrolments, conversions, revenue and the message counts per journey into `journey_master_analytical`. |

The jobs log (`jobs.log` on the application server) carries one line per pass with these figures. A pass that fails for a workspace is logged with the traceback and the other workspaces continue.

## Troubleshooting

| Symptom | Look at |
|---|---|
| The workspace sees no Journeys menu | The feature: the tenant's switch, then the plan's features. The app shows it from the user's next request. |
| Events are refused with 403 | The same feature, then the key's scope (`events:ingest`). |
| A customer never enters | They are not in `customer_master` (the Events page says *Not in the customer records yet*); the event is older than seven days or happened before the journey went live; the journey's population is Fixed and already closed; the customer is suppressed for the journey; the Only Customers Where filters do not match. Preview Route in the builder says which. |
| Customers stop moving | The scheduler: cep-jobs stopped, or every pass logs `locked: 1` because a second scheduler holds the workspace. |
| A step keeps failing | The journey page's Needs Attention card: the reason, the tries, Retry Now and Skip Step. A missing sender or a provider outage is temporary and retried; a missing template is permanent. |
| A Webhook step never delivers | The Webhook Calls card on the journey page (the endpoint's answer), then the integration log. http addresses are refused except localhost. |
| Converted figures look wrong | A journey without a Goal step counts Exit arrivals as converted; with one, only the goal's event within its window. The nightly roll-up lags the live page by up to a day. |

## Things to know

- A journey's message steps send through generated campaigns, one per step per day, so everything that governs a campaign send (consent, suppressions, caps, quiet hours, the preference centre) governs a journey message too.
- Test Publish sends real messages to the test population and skips waits; Preview Route sends nothing.
- Per-journey suppressions sit on top of the workspace's suppressions and consent; they never loosen them.
- The retry state lives on the customer's state record; nothing about retries needs a patch or a setting.
