# Campaigns

A campaign is *what* is sent, *to whom*, *when* and *why*. Every actual send is a **run** of its campaign, against a
**Campaign List** that is frozen when the run starts. A recurring or drip campaign stays ONE campaign with many runs
(BRD 7); results roll up to the campaign, and a test publish never counts.

Source: BRD v0.9 sections 6.3, 7, 15 and Appendix A. Interface reference: <https://cep-dashboard-tau.vercel.app/> → Campaigns.

## 1. Screens

| Screen | Route | What it does |
|---|---|---|
| Campaigns | `/campaigns` | *Upcoming campaigns*, then the table: search, filters (status, topic, channel, triggered by, tag, owner, created from/to), sortable columns, pages of 50, a row action that fits the status, bulk **Clone** and **Archive** |
| Setup | `/campaigns/new`, `/campaigns/:id/edit?step=n` | seven steps, below |
| Campaign | `/campaigns/:id?tab=…` | header actions by status, and six tabs: Overview, Performance, Audience, Content, Settings, Activity Log |

### The seven steps

| # | Step | What is decided |
|---|---|---|
| 1 | Basic Info | name (unique in the workspace), code, description, type and channel (cards), message purpose, owner (defaults to the creator), tags |
| 2 | Audience | each contact list is **Send to**, **Exclude** or unused; a live estimate: merged, counted once per person, exclusions removed, today's governance check. *Create a list* opens the contact list wizard (a vetted list is attached at once, an uploaded one waits for a confirm) |
| 3 | Template | template cards that fit the channel, the sender, and a preview of the template picked (saved or not) |
| 4 | Scheduling & Delivery | send immediately / schedule / recurring (daily, weekly, monthly; ends never, on a date, after n sends) / drip series (a run per step); the campaign's time zone; frequency limits, hourly limit, recipient-local time |
| 5 | Targets & Economics | revenue, conversions, opens, clicks, redemptions; planned campaign and offer cost; notes (BRD 15) |
| 6 | Test & Preview | the message with sample values or as one customer of the audience; test publish to colleagues or typed addresses |
| 7 | Review & Publish | everything chosen, the pre-publish checklist, the audience estimate, **Publish to production** (asks once more) |

**Continue** validates the step you are on and saves the draft, so steps 6 and 7 always work on what is stored. The API's
field messages land on the same fields, and the wizard opens the step that holds the first one. A save with an older
`row_version` is refused with 409 and the page offers to reload.

### An unfinished setup opens where it stopped

`campaign.setup_step` counts the steps completed, 0 to 6 (the seventh step is the publish itself), and the API answers
`setup_complete`. **Continue** records the step as done; **Save and close** keeps the place without moving it on. The
number only moves forward: going back to an earlier step and saving does not undo the later ones.

- While a draft's setup is unfinished it has **no campaign page**: its name, *Continue setup* and *Open* in the list, and
  the address `/campaigns/:id` itself (a bookmark, a typed link) all lead to `/campaigns/:id/edit?step=<next step>`.
  The steps ahead stay closed, so the publish step cannot be reached early; *Save and close* returns to the list.
- Once the six steps are done, the campaign page opens as usual, with **Test Publish** and **Production Publish** on it.
  Publishing is not part of "complete".
- Someone without `campaign.edit` cannot use the setup: they get the campaign page with a note that the setup is not finished.
- It cannot be derived from the data (schedule, targets and test are all optional), hence the column. Its default is 6:
  campaigns that existed before, clones of finished campaigns, and campaigns an integration creates through the API
  without the setup count as complete. Anything that is no longer a draft is complete by definition.

Send times are **clock times in the campaign's time zone** (`send_timezone`, default: the workspace's), not the
browser's: `features/campaigns/zone.ts` converts, daylight saving included.

## 2. Status and actions

Stored statuses: `DRAFT`, `TEST_PUBLISHED`, `PRODUCTION_PUBLISHED`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`, `ARCHIVED`.
**Scheduled** is not stored: it is `PRODUCTION_PUBLISHED` with a production run still waiting in the future. The API sends
it as `display_status` (+ `display_status_label`), and accepts `?status=SCHEDULED` as a filter. The labels Draft /
Test Published / Production Published / Scheduled are locked (see `CLAUDE.md`).

The API tells the pages what can be done now (`campaign.actions`); permissions decide who may ask.

| Shown as | Actions | Permission |
|---|---|---|
| Draft, Test Published | edit, test_publish, clone, archive · publish | `campaign.edit` · `campaign.publish` |
| Scheduled | cancel_schedule · clone, archive | `campaign.publish` · `campaign.edit` |
| Production Published, Active | pause · clone, archive, results | `campaign.publish` · `campaign.edit` |
| Paused | resume · clone, archive, results | same |
| Completed, Cancelled | clone, archive, results | `campaign.edit` |
| Archived | unarchive, clone | `campaign.edit` |

- **Test publish** sends the current content to internal people only, creates a test run (`test_mode`), moves a draft to
  Test Published, and records nothing as a message.
- **Production publish** runs every check (template published and with content, an opt-out in marketing messages, a
  verified sender, at least one Production list, a future time for a schedule, a valid recurrence or series) and creates
  the run(s). `GET …/checklist/` is the same validation without publishing.
- **Pause** stops a send in progress (messages already handed to the provider still go out; queued ones wait) and keeps
  runs that come due waiting. **Resume** continues where it stopped.
- **Cancel schedule** cancels the waiting run and returns the campaign to an editable draft.
- **Archive replaces delete** (`DELETE /campaigns/{id}/` archives). Archived campaigns leave the everyday list and stay
  available for reporting. Unarchive restores a draft, or Completed when it had sent.
- **Clone** copies settings, lists, exclusions and targets as "Copy of …", never the runs, results or status.
- A **journey-generated** campaign is read-only here.

## 3. Audience

`contact_list_campaign.role` is `INCLUDE` or `EXCLUDE`. At the start of a run the send engine merges the included lists
(one entry per party), marks members of excluded lists `EXCLUDED_LIST`, then applies governance in the usual order
(bounces, complaints, blocks, invalid address, suppression, unsubscribe, consent, frequency limits). The estimate in the
wizard uses the same order but is *as of today*; the frozen Campaign List is the record of what a send used.

`respect_governance = false` lifts the **corporate frequency limits only**, and only matters for marketing (other
purposes are exempt already). Consent, unsubscribes and blocked addresses always apply. Publishing a marketing campaign
with it switched off writes a WARNING to the activity log.

## 4. API

All under `/api/v1/campaigns/`, tenant-scoped, pages of 50 (`?page=`, `?page_size=` up to 200, `count` in the answer).

| Method and path | Purpose |
|---|---|
| `GET /` | list. `search`, `status` (comma-separated, `SCHEDULED` allowed; archived hidden unless asked), `type`, `channel`, `triggered_by=manual|journey`, `tag`, `owner`, `date_from`, `date_to`, `date_field=created|scheduled`, `ordering` (`name`, `campaign_type`, `channel`, `status`, `scheduled_at`, `next_run`, `created_at`, `updated_at`, `list_count`) |
| `POST /`, `GET/PATCH /{id}/`, `DELETE /{id}/` | create, read, update (drafts and test published, `row_version` lock), archive |
| `GET /form-options/` | owners, tags in use, time zones |
| `GET /audience-estimate/?include=&exclude=&channel=&solicitation_type=` | the estimate for lists that are not saved yet |
| `GET /{id}/checklist/` | what stands between the campaign and a production publish |
| `POST /{id}/test-publish/` `{to: [], user_ids: []}` | test publish |
| `POST /{id}/publish/` | production publish |
| `POST /{id}/pause/`, `/resume/`, `/cancel-schedule/`, `/clone/`, `/archive/`, `/unarchive/` | status actions; each answers the campaign |
| `POST /bulk/` `{action: archive|clone, ids: []}` | answers `done` and `skipped` (with the reason) |
| `GET/POST /{id}/lists/`, `DELETE /{id}/lists/{list_id}/` | attach (`role`) and detach one list |
| `GET /{id}/audience/`, `/audience/export/` | the picture with a sample (+ `frozen` once sent); CSV of the frozen Campaign List with who was left out and why |
| `GET /{id}/preview/?party_id=&template=`, `/sample-customers/` | the message with sample values, as one customer, or of a template not saved yet |
| `GET /{id}/runs/`, `/runs/{run_id}/` | runs; one run with its results and subject-line variants |
| `GET /{id}/metrics/`, `/metrics/timeseries/?bucket=hour|day` | counts, rates, progress against targets, breakdown by mailbox provider; the curve |
| `GET /{id}/activity/` | the activity log, newest first |

## 5. Data model (patches `0014_campaign_module.sql`, `0015_campaign_setup_progress.sql`)

Existing tables were extended rather than replaced (BRD 21).

- `campaign`: statuses `PAUSED`, `ARCHIVED`; `previous_status`, `tags`, `send_type`, `send_timezone`, `recurring_config`,
  `drip_config`, `respect_governance`, `rate_limit_per_hour`, `timezone_optimization`, `receipt_config`, `published_at`,
  `completed_at`, `archived_at`; unique live name per workspace (`ux_campaign_name_live`).
- `campaign_run`: status `PAUSED`; `sequence_label` ("Occurrence 3", "Day 7", "Test").
- `contact_list_campaign.role`; `campaign_target.planned_offer_cost`, `.notes`.
- `campaign_activity_log` (new, RLS): who did what, and what the engine did. Entries are never changed.
- Patch `0015_campaign_setup_progress.sql`: `campaign.setup_step` (0 to 6, default 6).
- Subject-line testing is future-proofed (TD-04): results hang off `campaign_run_variant`, and nothing assumes one
  subject per run.

## 6. Background jobs

| Job | Every | Does |
|---|---|---|
| `dispatch-campaign-runs` | 1 min | starts runs that are due (not those of a paused or archived campaign), closes finished ones |
| `plan-recurring-runs` | 5 min | creates the next occurrence of each recurring campaign, until its end date or number of sends; then completes it |

A drip campaign's runs are all planned at publish (day 0 now, the others on their day at the set time); the last one
completes the campaign.

## 7. Known limits and deliberate deviations

- The Campaign List is frozen **when a run starts**, not at publish: a scheduled or recurring send uses the lists as they
  are on the day. (Appendix A says "at publish"; freezing a list weeks before a send would mail people who have since
  unsubscribed from the list.) Governance is always decided at send time either way.
- `rate_limit_per_hour` and `timezone_optimization` are stored and shown but **not enforced yet**: they take effect with
  the email engine integration that follows this module. The pages say so.
- Every drip step uses the campaign's one template; per-step content belongs to journeys.
- The prototype's *Calendar view* is not built; *Upcoming campaigns* covers the near term.
- Conversions and revenue come from `campaign_actual`, which the attribution feed fills; until then they read 0.
- Carrier breakdown for texts arrives with the aggregator's delivery receipts.

## 8. Tests

- Backend: `test_campaign_module.py` (33 checks, one rolled-back transaction, real sends through the sandbox text
  engine), plus the send engine, SMS engine, contact list and legacy campaign suites.
- Frontend: `features/campaigns/campaignForm.test.ts` (time zones, schema, form ⇄ API) and `Campaigns.test.tsx` (list,
  setup, campaign page, permissions) against the in-memory API in `test/mockCampaigns.ts`.
