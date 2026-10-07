# Campaigns

**Where:** Campaigns in the main navigation; a campaign's own page at Campaigns → the campaign.

## What this page is for

A campaign is what is sent, to whom, when and why. Every actual send is a run of its campaign against a copy of its lists frozen when the run starts, so a recurring or drip campaign stays one campaign with many runs and its results roll up. The Campaigns page lists and plans them, as a table or a calendar; a campaign's page shows everything about one campaign: its status and the actions it allows, its performance, its audience, its content, and what every recipient's message became.

Creating and editing a campaign is the Campaign Set-Up, which has its own chapter.

## Who can use it

| | |
|---|---|
| Permission | `campaign.view` to see campaigns and their results; `campaign.edit` to create, edit, clone and archive; `campaign.publish` to publish to production, pause, resume and cancel a schedule; `campaign.approve` to approve a campaign when the workspace asks for approvals. |
| Features | Texts need **sms** (and **mms** for picture messages), e-receipt campaigns need **ereceipt**, subject line tests need **ab_testing**, journey-generated campaigns need **journeys**. |

## The fields and controls

### The Campaigns page

| Control | What it is | What it changes |
|---|---|---|
| Create Campaign | Opens the Create Campaign pop-up (see Campaign Set-Up). | |
| Upcoming campaigns | The next four scheduled sends: channel, name, the date and the time in the campaign's own time zone, recipients. | A send opens its campaign. |
| List View / Calendar View | The table, or the month with every campaign as a bar over the days it runs. | Remembered in the address, so a link keeps the view. |
| Saved views | All, Mine, Sending Today, Needs Attention, Awaiting Approval (shown to approvers and publishers), Drafts. | One click sets the filters below to that question. |
| Search | By name or code. | |
| Filters | Triggered By (manual, journey, and the owner), Status, Type, Channel, Date Created (a preset or a custom range), Tag. | The table and the calendar alike. In the calendar the month replaces the date range. |
| The table | Campaign Name (with Continue Setup for an unfinished draft), Type, Channel, Status, Triggered By, Audience, Next Send (the day and the time in the campaign's zone; *local time* when the send follows each recipient's clock), Created. Sort by the column headers. A drip adds a line under its name ("2 of 4 messages sent", "5 messages · starts Mon 26 Oct", "Stopped after 2 of 5", "3 messages · draft") and its Next Send names the message ("09:00 CT · Message 3 of 4"; "On hold" while paused). | |
| Row actions | Pause, Resume or Approve beside the menu when the status allows; the menu: Continue Setup or Edit, View Journey for a journey campaign, View Results, Clone, Pause, Resume, Cancel Schedule, Stop Remaining Messages (a running or paused drip; it asks first), Archive, Unarchive. | Each action is only offered when the campaign's status allows it and you have the permission. |
| Select | The checkbox per row, or every campaign on the page. | Shows the bulk bar: Clone, Pause, Resume, Archive for the selection. Campaigns that cannot take the action are skipped and named. |
| Rows per Page, Previous, Next | Pages of 50 by default. | |
| The calendar | Monday first, previous and next month, Today; a bar per campaign coloured by status (green going out or sent, amber paused or test published, red failed or cancelled, grey a draft that plans a date); more than three on a day fold into *+n more*. A drip is one bar with a numbered marker on each send day (filled once sent, outlined to come; hover for the message and time); a paused drip's bar stops at its last send and says On hold. The week view and the day list show each drip message on its own. | A bar opens the campaign. |

### A campaign's page

| Control | What it is | What it changes |
|---|---|---|
| The header | The name, its status, channel and type chips, Manual or Journey, the code (copies on click), the description. | |
| The main button | What the campaign most needs next: Continue Setup for an unfinished draft, Production Publish once a test has been sent, Resume when paused. | Opens the set-up at the right step, or acts at once. |
| Clone, More Actions | Clone makes "Copy of …" with the settings, lists, exclusions and targets, never the runs or results. For a drip it asks first for the copy's name and start date, copies every message with its own template copy, and opens the copy's Drip Campaign Setup step. More Actions: Edit Campaign, Send a Test, Production Publish, Pause, Cancel Schedule, Archive, Unarchive, View Results, as the status allows. | |
| Overview | The headline figures (audience, sent, delivery rate, opens and clicks or replies and STOPs, conversions), the campaign's facts (purpose, owner, template, sender, tags), when and how it goes out, its dates, its targets, and a preview of the message. A published drip shows the Series Timeline instead: each message with its state and figures, Skipped with the reasons and View People, a calendar, and the banners for scheduled, paused (who and when), stopped early and a failed message (Retry Message when nobody got it). | Edit on a card opens the set-up at the step that owns it. |
| Performance | Sent, delivered, opened, clicked, bounced, unsubscribed, complaints and conversions per run, the curve by hour or by day, and for an email campaign with a subject line test, A and B side by side with the winner and Send A / Send B to the Rest while people wait. | |
| Recipients | One row per person of a run: address or number, name, status (Queued, Sent, Delivered, Opened, Clicked, Bounced, Marked as Spam, Failed), the reason, the times, the engine's message id; filter by status, search, Export CSV. A row opens the message's timeline with every callback the engine sent, and Check with the Engine asks Postal directly. Blocked & Unsubscribed lists this campaign's people who cannot be sent to and why. | |
| Audience | The lists attached and excluded, the funnel from everyone in the lists to the estimated recipients, the reasons people are left out, system exclusions, and once sent, the frozen picture of the last send beside today's estimate; Export CSV of the frozen list with who was left out and why. | |
| Content | The template, subject line and preheader (the campaign's own or the template's), the sender, the length of a text, the receipt layout of an e-receipt, with a desktop and mobile preview. | |
| Activity Log | Who did what and what the engine did, newest first, with a filter for warnings and errors. Entries are never changed. | |

### Statuses and what they allow

| Status | Meaning | Actions |
|---|---|---|
| Draft | Being prepared. An unfinished set-up has no page yet: it opens at the step it stopped on. | Edit, Send a Test, Clone, Archive; Production Publish |
| Test Published | A test was sent to colleagues; nothing has gone to real people. | The same |
| Production Published | Published to real people. | Pause, Clone, Archive, View Results |
| Scheduled | Production published with a run waiting for its time. | Cancel Schedule, Clone, Archive |
| Active, Sending, Preparing | A run is building its audience or sending now. | Pause |
| Paused | A send stopped in progress: messages already handed to the engine still go, queued ones wait; runs that come due wait. | Resume |
| Completed | The run finished. | Clone, Archive, View Results |
| Cancelled | The schedule was cancelled. | Clone, Archive |
| Archived | Out of the everyday list, kept for reporting. Archive replaces delete. | Unarchive, Clone |

## How to

**Find what needs you.** The Needs Attention saved view lists failed, waiting and unapproved campaigns; Awaiting Approval lists what approvers must decide; Drafts lists what is unfinished.

**Pause a send that is going wrong.** Pause on the row or the page. Messages the engine already has still go out; everything queued waits until Resume.

**Stop a scheduled send.** Cancel Schedule. The campaign returns to an editable draft.

**Reuse a campaign.** Clone. Rename the copy, check its lists and schedule, publish.

**Pause, resume or stop a drip.** Pause holds every waiting message. Resume shows first what happens to the messages whose day passed while paused (they go at the next send time, one a day, and later ones move only if they must). Stop Remaining Messages cancels the rest for good; the drip is Completed, stopped early, and its templates are free again. To send it again, clone it.

**Retry a drip message that failed.** When a message failed and nobody received it, its card and banner offer Retry Message: it goes again now to the same audience.

**Approve a campaign.** When the workspace's Approvals setting is on, a campaign asks for approval on its Review & Publish step; an approver sees it under Awaiting Approval, opens it and approves or sends it back with a note. The person who asked can never be the one who approves.

**Read what happened to one person's message.** Recipients → search the address → open the row. The timeline shows when it was queued, handed to the engine, and every delivery, bounce, open and click the engine reported; Check with the Engine fetches the engine's own record.

## What happens behind the scenes

1. **Publishing** runs every check (a published template with content, an opt-out link in a marketing email, a verified sender, at least one production list, a time in the future for a schedule) and creates the run or runs: one for a one-time send, one per occurrence for a recurrence as they come due, one per step for a drip series.
2. **At the run's time** the dispatcher, which looks every minute, starts the run: the included lists are merged into the campaign's own frozen list, one entry per person, the excluded lists' people marked, and governance applied in order: bounced, complained or blocked addresses, invalid addresses, the suppression list, unsubscribes, consent, the campaign's topic, frequency limits, duplicates. Transactional, service and legal campaigns skip the consent rules but never a blocked or invalid address.
3. **Sending** hands the messages to the sender's engine in batches; a subject line test splits a sample between A and B and holds the rest until the winner is chosen; recipient-local sending holds each message until the chosen time in the person's own zone.
4. **The engine calls back** and every message's row moves forward: delivered, opened, clicked, bounced, complained. The campaign's figures, the report and Home all read those rows.
5. **The activity log** records each step, and a failed run raises a banner on the campaign and an alert on Home.

## Things to know

- The frozen list is made when a run starts, not at publish: a scheduled send uses the lists as they are on the day, and governance is always decided at send time.
- A Test list can never go to production; a test publish never counts in results.
- Pause does not recall messages the engine already accepted.
- A journey-generated campaign is read-only here; change the journey instead.
- The hourly rate limit is stored and shown but not enforced yet; the engine's Messages per Minute is.
