# Campaigns

A campaign is *what* is sent, *to whom*, *when* and *why*. Every actual send is a **run** of its campaign, against a
**Campaign List** that is frozen when the run starts. A recurring or drip campaign stays ONE campaign with many runs
(BRD 7); results roll up to the campaign, and a test publish never counts.

Source: BRD v0.9 sections 6.3, 7, 15 and Appendix A. Interface reference: <https://cep-dashboard-tau.vercel.app/> → Campaigns.

## 1. Screens

| Screen | Route | What it does |
|---|---|---|
| Campaigns | `/campaigns`, `/campaigns?view=calendar` | **Create Campaign**, the *List view / Calendar view* tabs, and *Upcoming campaigns* above both: the next four scheduled sends (channel icon and name, the date large, the time in the campaign's own time zone, recipients), or a line saying how a campaign gets there when nothing is scheduled. **List view:** saved views above the filters (All, Mine, Sending Today, Needs Attention, Awaiting Approval, Drafts; `?saved=`, each a query the API understands: `?view=mine|sending_today|attention`, `?approval=requested`, a status list), search, filters (status, topic, channel, triggered by, tag, owner, created from/to), sortable columns with **Next Send** (the day, and the time in the campaign's zone under it; "local time" when the send follows each recipient's clock), pages of 50, **Pause** / **Resume** / **Approve** on the row beside ⋮, a row menu that fits the status, and bulk **Clone**, **Pause**, **Resume** and **Archive** (`POST /campaigns/bulk/ {action}`; pause and resume need `campaign.publish`). **Calendar view:** the month, Monday first, with previous / next / Today; each campaign is a bar over the days it runs (a one-time send one day, a drip series or a recurrence its days, an e-receipt campaign or an open-ended recurrence to the edge of the month), coloured by status with a legend (green going out or sent, amber paused or test published, red failed or cancelled, grey a draft that plans a date); a bar opens the campaign; more than three campaigns on a day fold into *+n more*; the same search and filters apply, and the month replaces the created-date range; days are the workspace's time zone; below 768px the month is a list |
| Setup | `/campaigns/new`, `/campaigns/:id/edit?step=n` | five steps, below |
| Campaign | `/campaigns/:id?tab=…` | header actions by status, and six tabs: Overview, Performance, Audience, Content, Settings, Activity Log. **Edit** opens the setup step that belongs to the tab in view (Overview and Activity Log → Basic Info, Audience → Audience, Content → Template, Settings → Scheduling & Delivery, Performance → Targets & Economics), and leaving the setup leads back to the matching tab |

### The five steps

The setup a person sees (since 2026-09-27) is the Create Campaign pop-up (Basic Info) and then five steps: **Audience → Content →
Test → Targets → Review & Publish**. Test holds the preview and the test send, so the path to a test send is three steps;
Targets is optional and has **Skip for Now**; Review & Publish opens with a summary card naming anything unfinished (the
checklist's problems, no test sent, no targets; each with the way to it), then the schedule and delivery settings, the
summary with its Edit links, the checklist and the publish. The table below lists what is decided by the original seven
groups, which the API still counts progress in (`setup_step`: 1 created, 2 audience, 3 content, 4 the Test step passed — a
test sent or Continue, 5 Targets passed or skipped, 6 the schedule saved on Review & Publish, which completes the setup;
an e-receipt, having no schedule, is complete once its Targets step is passed).

| # | Step | What is decided |
|---|---|---|
| 1 | Basic Info | name (unique in the workspace), code, description, type and channel (cards), message purpose, owner (defaults to the creator), tags |
| 2 | Audience | a checkbox per contact list (and one to select every list shown) picks the lists the campaign is sent to; *Keep people out of this campaign* (optional) ticks lists to exclude, and a list is one or the other, never both; a live estimate: merged, counted once per person, exclusions removed, today's governance check. **Upload a CSV file** and **From an audience or a clone** open the contact list wizard itself, the same upload process as in Contact Lists (a vetted list is attached at once, an uploaded one waits for a confirm) |
| 3 | Template | template cards that fit the channel, the sender, and a preview of the template picked (saved or not); for an email, the campaign's own **subject line and preheader** (blank = the template's; *Edit the Template's* copies its text in, *Use the Template's* empties the field; an inbox row shows the result with sample values). Only the campaign changes, never the template (`campaign.subject_line`, `campaign.preheader`, patch 0025; a text campaign cannot have them) |
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
- The step list marks every completed step with a green check, whichever step is open (and says "completed" to a screen
  reader); the step in hand keeps its number until Continue records it. Review & Publish is never "done" on a draft.
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
| `GET /calendar/?date_from=&date_to=` | up to 62 days, with the list's search and filters: one span per campaign that touches the window (`start`, `end` or `ongoing`, `failed`, and its `sends` inside the window: `SENT`, `SENDING`, `WAITING`, `PLANNED` for a draft with a date, `PROJECTED` for occurrences of a recurrence that are not created yet) |
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
- Patch `0022_campaign_approval.sql`: `campaign.approval_status` (`REQUESTED`, `APPROVED`, `RETURNED`, or NULL) with who
  asked and who decided, the notes, and the `campaign.approve` permission (see WORKSPACE_TOOLS.md §4).
- Patch `0023_ab_subject_lines_send_time.sql`: `campaign.ab_config`, `campaign_run.ab_decide_at`,
  `mailer_execution.variant_key` (`A`, `B`, `HOLD`) and `send_after` on both execution tables (§8 and §9 below). The
  results of a subject test hang off `campaign_run_variant` as TD-04 planned.

## 6. Background jobs

| Job | Every | Does |
|---|---|---|
| `dispatch-campaign-runs` | 1 min | starts runs that are due (not those of a paused or archived campaign), closes finished ones |
| `plan-recurring-runs` | 5 min | creates the next occurrence of each recurring campaign, until its end date or number of sends; then completes it |
| `decide-ab-winners` | 1 min | chooses the subject-line winner of runs whose decision time has come and releases the held messages (§8) |
| `send-weekly-reports` | 15 min | the weekly report email, in each workspace's own time (WORKSPACE_TOOLS.md §1) |

A run whose messages wait (a local send time ahead, or a subject test undecided) stays `SENDING`; the dispatcher's
pass over open runs sends what has become due. Without a broker `run_scheduler` does the same in one process; with
Celery `finalize_run` hands the due batches to the workers before it tries to close the run.

A drip campaign's runs are all planned at publish (day 0 now, the others on their day at the set time); the last one
completes the campaign.

## 7. Known limits and deliberate deviations

- The Campaign List is frozen **when a run starts**, not at publish: a scheduled or recurring send uses the lists as they
  are on the day. (Appendix A says "at publish"; freezing a list weeks before a send would mail people who have since
  unsubscribed from the list.) Governance is always decided at send time either way.
- `rate_limit_per_hour` is stored and shown but **not enforced yet**. (`timezone_optimization` is: §9.)
- Every drip step uses the campaign's one template; per-step content belongs to journeys.
- Conversions and revenue come from `campaign_actual`, which the attribute-orders job fills from the orders the shop sends (Settings → Attribution); until attribution is on they read 0.
- Carrier breakdown for texts arrives with the aggregator's delivery receipts.

## 8. Subject line tests (A/B, email only)

`campaign.ab_config = {enabled, subject_b, sample_pct (10-50, default 20), metric (OPEN_RATE | CLICK_RATE),
decide_after_minutes (30 to 7 days, default 240)}`; subject A is the campaign's own subject line, else the template's. Validated on save; a text campaign
cannot have one. At the send, once the audience is queued, a sample of it is split in two by a stable hash of the
person: half get A, half B (`mailer_execution.variant_key`, `subject_line`), the rest are `HOLD` and the engine leaves
them alone; `campaign_run_variant` gets A and B with their share, `campaign_run.ab_decide_at` the decision time.
Fewer than 20 people: no split, everyone gets A, the log says so.

The decision (`decide-ab-winners`, or a person through `POST /campaigns/{id}/runs/{run_id}/choose-winner/ {variant}`,
`campaign.publish`) compares the two by the metric per message sent; a tie within one point goes to A. The winner is
marked on the variants with both figures, the held messages become the winner's subject, the activity log gets
`AB_WINNER`, the owner is told (`ab_winner` notification), and the next dispatcher pass sends the rest. The run detail
shows each variant with its subject, share, figures, `waiting_for_winner` and `decide_at`. A test send with a test on
goes to each address twice, `[TEST A]` with the template's subject and `[TEST B]` with the second one; each line of the
answer carries its `variant` and `subject` (2026-09-29).

**Screens (2026-09-29).** The Test step has a Subject Line Test card (email campaigns, not e-receipts or journey
campaigns): a switch, A as the template's subject with sample values, B, the sample (10-50%, with the number of
people it comes to), Winner Decided By and Decide After, saved with Save Subject Test (`features/campaigns/wizard/
SubjectTestCard.tsx`, defaults and wording in `features/campaigns/subjectTest.ts`). The test send says each address
gets both, and its results name the subject. Review & Publish's summary has a Subject Line line. On the campaign's
Performance tab each production run of a campaign with a test opens on A and B side by side (subject, sent, open and
click rate, the winner marked), and while the rest wait it says when the winner is chosen and offers Send A / Send B to
the Rest (`campaign.publish`, with a confirmation; `detail/SubjectTestResults.tsx`).

## 9. Local send times (`timezone_optimization`)

With the option on, every message of a run gets `send_after`: the campaign's wall-clock send time in the recipient's
own zone (`engine/sendtime.py`). The zone is `customer_master.custom_attributes.timezone` when a system put one there
(checked against PostgreSQL's zone names), else the state of a US or Canadian address, else the country where a country
keeps one zone; nobody's zone known = the campaign's own time; a local time already past when the run starts = now.
An immediate send works from the moment it was published. The engine claims nothing before its `send_after`; the run
stays open until the last zone has had its turn. The audience endpoint reports `local_time: {people, local_time_known}`
once the option is saved, or at once with `?local_time=1`: the Review & Publish step asks for it as soon as the box is
ticked and says "70 of 88 people have a known time zone. The other 18 get it at the chosen time in America/New_York."
(`StepSchedule.tsx`, `LocalTimeCoverage`). The review summary has a Local Time line and the campaign's Overview says
"Each recipient's own time zone".

## 10. Tests

- Backend: `test_campaign_module.py` (35 checks, one rolled-back transaction, real sends through the sandbox text
  engine), `test_ab_sendtime.py` (16: the split, the decision, a person's choice, the tie, the small audience, local send
  times), `test_approval.py` (20), plus the send engine, SMS engine, contact list and legacy campaign suites.
- Frontend: `features/campaigns/campaignForm.test.ts` (time zones, schema, form ⇄ API), `calendarMath.test.ts` (the month grid, workspace days, bar rows) and `Campaigns.test.tsx` (list,
  setup, campaign page, permissions) against the in-memory API in `test/mockCampaigns.ts`.
