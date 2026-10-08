# CEP User Guide

For everyone who signs in to a workspace. Built from `docs/manuals/user-guide`; edit the chapters there, not this file.

## Contents

- Welcome to CEP
  - How the guide is organised
  - Help inside the app
  - Three ideas that run through everything
  - Statuses you will meet
  - Where to start
- Home
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Contact Lists
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Campaigns
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Campaign Set-Up
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - A Drip Campaign
  - What happens behind the scenes
  - Things to know
- Templates and Content
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- The Email Designer
  - What this page is for
  - Who can use it
  - The workspace, piece by piece
  - The blocks
  - Personalization
  - Preview mode
  - Deliverability mode
  - Saving, versions and activating
  - Examples
  - Things to know
- Setting Up a New Workspace
  - What this is
  - Who does it
  - The path, from the email
  - The Set-Up page's controls
  - What happens behind the scenes
  - Things to know
- Sending Engines and Senders
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Users
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Roles
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Tags
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Security
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Approvals
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Plan & Usage
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Email Server
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Notifications
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Suppressions
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Preference Centre
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Consent Policy
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Integrations
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- API Keys
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- POS Receipts
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Account Security
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Attribution
  - What is attribution
  - Who can use it
  - How to configure attribution
  - How to use it in real time
  - What happens behind the scenes
  - Things to know
- Journeys
  - What is a journey
  - How to set up journeys
  - How to build a new journey
  - How to edit a journey
  - The journey's page
  - What happens behind the scenes
  - Things to know
- Events
  - What this page is for
  - Who can use it
  - The fields and controls
  - The event types
  - How to
  - What happens behind the scenes
  - Things to know

---

# Welcome to CEP

CEP is the Customer Engagement Platform: the place where a marketing team keeps its contacts, designs emails and texts, sends campaigns and reads what came back. This guide is for the people who sign in to a workspace: administrators who set it up, marketers who run campaigns, and anyone who reads the reports.

A second guide, the Platform Guide, is for the platform team who run the back-office: creating workspaces, plans, features and the platform's own settings. If you were invited to a workspace, you only need this one.

## How the guide is organised

Every page of the app has a chapter, and every chapter has the same shape:

- **What this page is for.** One paragraph on the job the page does.
- **Who can use it.** The permission a role needs, and the feature the workspace needs switched on.
- **The fields and controls.** A table of everything on the page: what each field or button is, and what it changes elsewhere in CEP. That is the part to read when a setting is unclear.
- **How to.** The everyday tasks, step by step.
- **What happens behind the scenes.** The business flow: what CEP does with what you entered, and where it shows up later.
- **Things to know.** The limits and the consequences worth remembering.

## Help inside the app

- **The help icon** beside a page's title opens that page's chapter in a panel, so the guide is one click away from the page it describes. Close it with the cross or the Escape key.
- **The small information icon** beside a field opens a note on that one field: what it is and what it affects.
- **The keyboard icon** in the header lists the keyboard shortcuts. Pressing `?` on any page does the same.

## Three ideas that run through everything

**Workspace.** Your company's own area of CEP. Everything you see belongs to one workspace: its users, roles, lists, templates, campaigns and settings. The workspace code (for example `NWA`) appears in the sign-in screen and in every address CEP gives you to register with other systems.

**Roles and permissions.** What a person may do is set by their role. A role is a set of permissions such as *campaign.edit* or *user.admin*. The chapter for each page names the permission it needs. If a page refuses you, it says which permission to ask an administrator for.

**Features.** Some parts of CEP are switched on per workspace by the platform team: texts, MMS, e-receipts, journeys, A/B testing, API access, the preference centre, barcodes. A page that belongs to a feature that is off is simply not shown, and its chapter says which feature to ask for.

## Statuses you will meet

| Status | Where | Meaning |
|---|---|---|
| Draft | campaigns, lists | Being prepared; nothing has been sent and nothing is live. |
| Test Published | campaigns | Published to test lists only. Production lists cannot be attached. |
| Production Published | campaigns | Published to real people; a scheduled run will go out. |
| Scheduled | campaigns | A production campaign with a run waiting for its time. |
| Active, Sending, Preparing | campaigns | Live right now: a run is building its audience or sending. |
| Completed | campaigns | The run finished. |
| Verified, Not Verified Yet, Verification Failed | senders | Whether a sender address or number has proven it can send. |

## Where to start

A new workspace begins with the chapter **Setting Up a New Workspace**: from the invitation email and the first sign-in through the seven set-up steps to the first production send. **Settings → Set-Up** is the page that walks them, read from the workspace so it always knows what is done. The chapters for the pages it opens come next: Users and Roles, Sending Engines, Suppressions, Contact Lists, Notifications and Approvals.

---

# Home

**Where:** Home in the main navigation, and the CEP mark at the top of the rail.

## What this page is for

Home is the marketing command centre: how the workspace's campaigns are doing, what needs a decision, and the quickest way to start something new. Every figure on it is read live from the same reports and campaigns the other pages show, filtered by the campaigns, channel and period you choose at the top of Marketing Performance. Nothing is entered on Home; it is the place to look first in the morning.

## Who can use it

| | |
|---|---|
| Permission | Everyone who can sign in sees Home. Each card needs the permission of what it reads: the figures, Marketing Performance, Top Campaigns, Governance and the funnel need `report.view`; Needs Attention and Recent Campaigns need `campaign.view`; the set-up card is for administrators (`user.admin`). A card the viewer may not read is left out and the rest close the gap. |
| Features | Active Journeys needs the **journeys** feature; E-Receipts needs **ereceipt**; the SMS and MMS choices in the channel filter need **sms** and **mms**. |

## The fields and controls

### The top of the page

| Control | What it is | What it changes |
|---|---|---|
| The greeting | Good morning, afternoon or evening in the workspace's time zone, with your first name. | Nothing. |
| Create New | Campaign, Template, Contact List, and Journey where journeys are on: one tile each, only the ones you may create. | Opens the Create Campaign pop-up, the New Template page, the contact list wizard. |
| Needs Attention | One card per thing to act on: campaigns with delivery failures in the last week, campaigns waiting for a production publish, campaigns waiting for approval; red first, then amber, then the rest; three cards until View All. An opportunity card from the funnel takes one slot when there is one. | Each card's link opens the campaign list filtered to those campaigns. The section is left out when there is nothing to act on. |
| Set Up Your Workspace | For administrators until the workspace is ready: how many of the seven set-up steps are done and what comes next. | Continue Set-Up opens Settings → Set-Up (the chapter Setting Up a New Workspace walks the whole path). Hide Until Later on that page hides the card. |

### Marketing Performance

| Control | What it is | What it changes |
|---|---|---|
| Campaigns | A searchable pick of campaigns. Empty means every campaign. | Every card below reads only those campaigns. One campaign picked turns the page into that campaign's own picture. |
| Channel | All Channels, Email, SMS, MMS. | Every card below. Open Rate reads *not tracked* for texts, which have no opens. |
| Period | Last 7, 30 or 90 Days. | Every card below, and the comparison: each figure is shown against the same length of time before it. |
| Delivered | Messages delivered in the period, with the change against the period before. | |
| Open Rate | Opens over delivered, email only; the change in points. | |
| Click Rate | Clicks over delivered; the change in points. | |
| Conversions | Conversions attributed to the campaigns, with the share of clicks that converted. | Reads 0 until attribution is on (Settings → Attribution) and orders arrive. |
| Attributed Revenue | Revenue attributed to the campaigns, against the sum of their revenue targets when they have one. | *Not set up* until attribution is on; Set Up Attribution opens Settings → Attribution for administrators. |
| Campaign ROI | Attributed revenue over campaign cost, with a benchmark word. | *Unavailable* when no campaign in the period has a cost. |

### The cards

| Card | What it shows | Where it leads |
|---|---|---|
| Top and Bottom Campaigns | The campaigns of the period ranked by revenue against target, or by click rate when attribution is not set up; the best and the weakest. | A row opens the campaign. |
| Attributed Revenue vs. Campaign Cost | Revenue as bars and cost as a line per day (per week over a longer period), in total or by campaign, with the target pace when the campaigns have revenue targets. | The Revenue View switch. |
| Engagement Funnel | Delivered, opened, clicked and converted for one channel, with the drop-off between each step. | The channel switch; the funnel feeds the opportunity card in Needs Attention. |
| Channel Snapshot | One line per channel: sent, delivered, the rates. | |
| Next 7 Days | A day picker and the sends scheduled on the day picked, in the campaign's own time zone, journey runs included. | A send opens its campaign. |
| Active Journeys | Each active or paused journey: people in flight, entered, and the conversion; a journey whose last run failed says so. | Opens Journeys. |
| Recent Campaigns | The campaigns changed most recently, with their status and headline figures; sort by Most Recent or Best, filter by status. | A row opens the campaign. |
| Governance | People contacted in the period, and the people held back by reason: frequency cap, no consent, the suppression list; frequency-cap compliance as a bar. | |
| E-Receipts | Receipts sent, their open rate, offer clicks and revenue from receipt offers. The marketing figures above leave receipts out. | |

## How to

**See one campaign's picture.** Pick it under Campaigns. The figures, the revenue chart and the funnel read that campaign alone, and Needs Attention shows only its own alerts.

**Compare this month with last.** Set Period to Last 30 Days. Every figure's change chip is against the 30 days before.

**Act on an alert.** Press the card's link: Review Failures, Publish or Review. The campaign list opens already filtered to those campaigns.

**Start something.** Create New → Campaign opens the Create Campaign pop-up; Template opens New Template; Contact List opens the wizard.

## What happens behind the scenes

1. Home asks for the period's report summary and the one before it, the overview (alerts, revenue and cost, governance, journeys) in one request, the calendar for the week ahead and the recently changed campaigns. The summary and the overview are kept for 30 seconds on the server, so a second look within that time is cheap.
2. A request the viewer may not make hides its card instead of showing an error; a request that fails shows the card with Try Again.
3. The figures are the report's figures: the same numbers as Reports and each campaign's Performance tab, so a number on Home can always be traced to its campaign.

## Things to know

- Home is a reading, not a ledger: figures lag by up to 30 seconds and e-receipts are kept apart from marketing figures.
- Revenue, conversions and ROI come from the orders the shop sends, credited to campaigns every five minutes (see Attribution). Until attribution is on they read zero or *not set up*.
- The page keeps your filters only while you stay on it; the next visit starts at every campaign, all channels, the last 30 days.

---

# Contact Lists

**Where:** Contact Lists in the main navigation, and **Contact Lists → Uploads**.

## What this page is for

A contact list is a reusable audience: the people a campaign is sent to. Lists come from a file you upload, from an audience your data team defined in the BI tool, or from a copy of another list. A campaign never reads a list while it sends: when a run starts, the attached lists are merged into the campaign's own frozen copy, so you can change a list at any time without changing a send that was already built.

The page shows every list of the workspace with its size and where it is used, and starts the wizard that creates one.

## Who can use it

| | |
|---|---|
| Permission | `list.view` to see lists and their people; `list.edit` to create, edit, clone, archive and delete; `list.import` to upload a file; `consent.edit` to approve or refuse a list that waits for approval. |
| Features | Always on. A list *for texts* only matters when the workspace has the **sms** feature. |

## The fields and controls

### The page

| Control | What it is | What it changes |
|---|---|---|
| Total Lists, Total Contacts, Attached to Live Campaigns | The counts for the workspace: lists, distinct people across them, and lists attached to a campaign that is published to production or sending now. | Nothing; a reading. |
| Search | Filters the table by name as you type. | |
| Type | Production or Test. | A campaign published to production refuses a Test list. Keep real sends and rehearsals apart with it. |
| Source | Upload, BI or Extraction, Cloned. | |
| Uploads | Opens the Uploads page: every file upload of the workspace with its progress, who started it, Continue, Cancel and its report. | |
| Create List | Opens the wizard. | |
| The table | Name and description; **For** (Email, Texts, Email and Texts); the number of people; the source; the type; how many campaigns it is attached to and how many of those are live; when it changed. A note under the name when the list waits for approval or was refused. | |
| Row menu | **Open** the list, **Clone** it (asks for the copy's name), **Delete** it. | Delete is refused while the list is attached to a campaign: archive it from its page instead. Deleting removes its people from the list, never from CEP. |

### The wizard: Upload a File

| Step | Field or control | What it is | What it changes |
|---|---|---|---|
| New Contact List | Upload a File / BI or Extraction Tool / Clone a List | Where the people come from. | The steps that follow. |
| Add Your File | List Name | The list's name, up to 200 characters. | How it is listed everywhere, including a campaign's Send To table. |
| | Description | Optional. Shown under the name in the table. | |
| | What the List Is For | Email, Texts, or Email and Texts. | Which column the file must have (an email address, a mobile number, or both), how a new person is recognised, and how each row is judged (email consent and address status, or text consent and the number's standing). Changed later on the list's Edit Details. |
| | Type | Production or Test. | See Type above. |
| | CSV File | The file: CSV only, up to 50 MB and 250,000 rows, comma, semicolon, tab or pipe separated, UTF-8 or Windows-1252. **Download Sample CSV** gives a file with the recognised columns in the right shape. | The file is stored privately, read in the background and deleted as soon as its rows are staged. |
| Match Your Columns | One choice per column of the file | What each column means: Email, Mobile number, First name, Last name, Postal code, Loyalty ID, Loyalty tier, Last order date, Time zone, Email consent date, Text consent date, or *keep as a custom value*. CEP guesses from the headers; confirm or correct. | The required column must be matched. A consent date column becomes an opt-in for people CEP has no answer for. Any other column is kept on the person's list entry under its header and can be used as a tag in a template (coupon columns feed the barcode and QR code blocks). Time zone is the person's own, an IANA name such as America/Chicago; journeys that wait until a time of day use it, and a name that is not recognised is left out. |
| Where Did These People Agree? | Consent Basis | Signed up on our website or app; Enrolled in store or in the loyalty programme; Asked us directly; Existing customers under implied consent. A bought or rented list is not allowed. | Recorded on every consent written from the file and on the list's compliance record. A Texts or Email-and-Texts list cannot use implied consent: marketing texts need an express opt-in. |
| | Where the Consent Was Collected | Optional, up to 300 characters: a form name, a store, a campaign. | Kept as the evidence, so the proof can be found later. |
| | The attestation | A sentence the uploader confirms in their own name, worded by the workspace (Settings → Consent Policy). | The import cannot be applied without it. Who confirmed it, and when, is kept. |
| Review Before Importing | The report | How many rows will be imported and how many are held back (no address, not a valid address, the same address earlier in the file, and under a strict policy, no consent date); how many people are new to CEP and how many it already knows; and how the imported people would be judged by a marketing send today: can receive, unsubscribed, bounced, complained, blocked, invalid, suppressed, no consent on record. | Nothing yet. **Import** starts the import; **Continue in the background** closes the wizard and leaves it running. |
| List Created | Where the list is, and what to do next. | | |

The other two sources are shorter: **BI or Extraction Tool** asks for the audience (the list then follows the audience: who leaves is removed and who joins is added, hourly and on *Refresh now*), **Clone a List** asks for the list to copy and the copy's name.

### The Uploads page

| Control | What it is | What it changes |
|---|---|---|
| The list of uploads | Newest first: file, list, who started it, status and progress. | |
| Continue | Opens the wizard again at the step an upload is waiting on (matching, consent, review). | |
| Cancel | Stops an upload that has not been applied. | The file and the staged rows are discarded. An import that is already adding people finishes. |
| Report | The review figures of any upload that was checked, and **Download the row-by-row report**: a CSV with every line of the file, whether it was imported or held back and why, how the person was recognised, and their marketing email status. | |
| Open the list | | |

The upload button in the header shows the uploads running on every page and raises an alert when one finishes, fails, or waits for a review.

## How to

**Upload a file.** Contact Lists → Create List → Upload a File → name the list, say what it is for, choose Production or Test, add the file. Match the columns and confirm. Say where the people agreed and confirm the attestation. Read the review, then Import. The list is a draft until the import is applied; leaving the wizard before that deletes the draft.

**Prepare a file that imports cleanly.** Use Download Sample CSV as the model: a header row, one person per row, dates as `YYYY-MM-DD`, mobile numbers with the country code (`+14045550101`). Put an email consent date and a text consent date in for everyone who gave one: without a date, a new person has no consent on record and marketing sends leave them out.

**Keep a do-not-contact list first.** Before the first upload, import the people who opted out elsewhere under Settings → Suppressions. Then no upload can ever reach them.

**Approve a list that waits.** When the workspace's Consent Policy asks for approval before the first send, a fresh upload sets its list to *awaiting approval* and every campaign holds its people back as *in a list awaiting approval*. Someone with `consent.edit` opens the list and presses Approve, or Refuse with a note.

**Reuse a list on several campaigns.** Attach it in each campaign's Send To step. The list's page names every campaign it is on, and warns before an edit when one of them is live.

## What happens behind the scenes

1. **The file is stored and queued**, never processed inside your request. Reading, checking and importing run in the background, in chunks, at most a few uploads at a time across the whole platform and never two of the same workspace at once, so one large file cannot slow everyone down. The page keeps showing progress; a hidden browser tab stops asking.
2. **Reading** stages every row and guesses the columns from the headers.
3. **Checking** holds back rows without a usable address, rows whose address appears earlier in the file, and, under a strict policy, rows without a consent date. Everyone else is matched to a person CEP knows (by loyalty ID first, then by address or number) or marked as new. Each importable row is judged exactly as a marketing send would judge that person today, with the send engine's own rules, so a word means the same at upload and in a campaign's results.
4. **The declaration** is recorded: the basis, where it was collected, who attested and when.
5. **Importing** creates the new people, adds everyone with a usable address to the list (whatever their status: people resubscribe, addresses get unblocked, and the send engine decides again for real at every run), writes an opt-in for a consent date only where CEP had no answer, and never overrides an unsubscribe. The list becomes active; under an approval policy it waits for approval first.
6. **The compliance record** on the list's page shows, for as long as the list exists: the source, every upload with its declaration, the approval, the policy as it stands today and today's consent by channel.

## Things to know

- Uploading someone does not give consent. Only a consent date in the file, a sign-up through a CEP form or a preference page, or a record from your other systems does.
- The review's numbers add up: rows in the file = held back + ready; ready = added + already in the list. The row-by-row report is the audit trail of an upload.
- Lists are never deleted while a campaign uses them; archive instead. People are never deleted from CEP by a list action.
- A Test list cannot go to production. Make the real list a Production one from the start, or clone it.
- Excel files are not accepted; save as CSV first.

---

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

---

# Campaign Set-Up

**Where:** Campaigns → Create Campaign, then the five steps (four for a drip: see A Drip Campaign below); Edit Campaign on a campaign's page opens the same steps.

## What this page is for

The set-up is where a campaign is defined: who it is for, what it says, a test, the targets it is measured against, and when and how it goes out. It starts with the Create Campaign pop-up (the basics), then five steps: Audience, Content, Test, Targets, Review & Publish. Continue checks the step you are on and saves, so a draft can be left at any step and picked up where it stopped. Nothing is sent until Review & Publish.

## Who can use it

| | |
|---|---|
| Permission | `campaign.edit` for the set-up; `campaign.publish` for the publish itself; `campaign.approve` to approve when the workspace asks for approvals. Someone without `campaign.edit` sees the campaign page with a note that the set-up is unfinished. |
| Features | The SMS and MMS channels need **sms** and **mms**; E-Receipt needs **ereceipt**; the subject line test needs **ab_testing**. |

## The fields and controls

### Create Campaign (the basics)

| Field | What it is | What it changes |
|---|---|---|
| Campaign Name | An internal name, unique among the workspace's live campaigns. | How the campaign is listed everywhere, including reports and Home. |
| Campaign Type | Regular Marketing (one-time or scheduled), Drip (several messages on a timetable, everyone starting together), E-Receipt (a receipt sent per purchase), Other (service or legal notices). Fixed once saved. Picking Drip shows when a journey suits better, with Create a Journey Instead. | Which steps follow: a drip has Audience, Drip Campaign Setup, Targets and Test & Publish; an e-receipt has no audience or schedule, the point of sale triggers each send. |
| Channel | Email, SMS, MMS, or Multiple Channels (not for a drip: a drip uses one channel). For a receipt: email, or a text receipt for registers that ask for SMS. Fixed once saved. | Which templates and senders are offered, how the audience is judged (email consent and addresses, or text consent and numbers), and what the message can carry. |
| Message Purpose | Marketing, transactional, service or legal. | Which consent and frequency rules apply: marketing needs an opt-in and an unsubscribe link and counts against frequency limits; the others skip the consent rules but never a blocked address. |
| Owner | You, unless changed; Change opens a searchable list of users. | Who is told about the campaign's runs and failures, and whose it is under Mine. |
| Tags | Free words. | A filter on the Campaigns page. |
| Code (Optional) | Capitals, digits and hyphens; made automatically when left blank. | The short handle used in reports, the API and the engine's logs. |
| Description | What the campaign is for. | Shown on the campaign's page. |

### Step 1: Audience

| Control | What it is | What it changes |
|---|---|---|
| Send To | A checkbox per contact list, with one to select every list shown; Add a List opens the picker with search and filters, and the same wizard as Contact Lists for a file upload or an audience. | The included lists. At the run they are merged, one entry per person. An uploaded list waits for a confirmation before it is attached; a vetted list is attached at once. |
| Keep people out of this campaign | The lists to exclude. A list is included or excluded, never both. | Their people are left out whatever other list they are on. |
| In Your Lists, Unique People, Estimated Recipients | The estimate as of today: everyone in the lists, after duplicates and exclusions, and after today's governance check with the reasons people are left out. | A reading. The real decision is made again when the run starts. |

### Step 2: Content

| Control | What it is | What it changes |
|---|---|---|
| Template | The templates of the campaign's channel, with search and a preview of the one picked. Only an active template can be published. | The message. |
| Subject Line and Preheader (email) | The campaign's own, or the template's when left blank. Edit the Template's copies the template's text in; Use the Template's empties the field. The inbox row shows the result with sample values. | Only the campaign changes, never the template. |
| Filed Under | The preference-centre topic the campaign belongs to. Needed to publish. | People who unticked the topic on the preference page are left out of this campaign. |
| Send From | The sender: a name and address, or a number, on an engine. New Sender adds one here. | Only a verified sender can publish to production; test sends work from any. |

### Step 3: Test

| Control | What it is | What it changes |
|---|---|---|
| Preview | The message with the catalogue's sample values, or as one customer of the audience would get it; desktop and mobile; click to see it large. | |
| Send a Test | Addresses or colleagues; Send Test sends the real message marked as a test. With a subject line test on, each address gets both, marked [TEST A] and [TEST B]. | Moves a draft to Test Published. A test counts in nothing. |
| Test a Second Subject Line (email) | Switch on, write B (A is the subject line above), choose the Sample (10 to 50 percent of the audience, split between A and B), Winner Decided By (open rate or click rate) and Decide After (30 minutes to 7 days); Save Subject Test. | At the send the sample goes out split, the rest wait; when the time comes the better subject wins and the rest go with it. Fewer than 20 people: everyone gets A. |

### Step 4: Targets (optional, Skip for Now)

| Field | What it is | What it changes |
|---|---|---|
| Target Revenue, Conversions, Opens, Clicks, Offer Redemptions | What the campaign is meant to achieve. | Home's Attributed Revenue reads against the revenue target; Top Campaigns ranks by revenue against target; the Performance tab shows progress. |
| Planned Campaign Cost | Creative, sending and agency costs. | Campaign ROI and the cost line on Home. |
| Planned Offer Cost | Discounts and rewards you expect to give away. | Total Planned Spend and Planned Return. |
| Notes | Anything the targets need explaining. | Shown on the campaign's page. |

### Step 5: Review & Publish

| Control | What it is | What it changes |
|---|---|---|
| The summary card | Names anything unfinished: the checklist's problems, no test sent, no targets, each with the way to it. | |
| When to Send | Send immediately, Schedule (Send At), or Recurring: Repeats (daily, weekly with Days of the Week, monthly with Day of the Month), At, Ends (never, on a Last Day, after a Number of Sends). A drip has no When to Send: its start date and times are on the Drip Campaign Setup step. | The run or runs. Send times are clock times in the campaign's time zone. |
| Time Zone | The campaign's zone; the workspace's unless changed. | The clock the times above are read in, daylight saving included. |
| Send at Each Recipient's Local Time | The same clock time in each recipient's own zone, from their address or a time zone attribute. The step says how many people have a known zone. | Each message waits for its own time; people without a zone get the campaign's time. |
| Apply Corporate Frequency Limits | On unless switched off. Marketing only. | Off lifts the frequency cap for this campaign and writes a warning to the activity log. Consent, unsubscribes and blocked addresses always apply. |
| Messages per Hour, at Most | Optional. | Stored and shown; not enforced yet. |
| Summary and Checklist | Everything chosen with Edit links, and the pre-publish checklist: template active with content, an unsubscribe link in a marketing email, a verified sender, a production list, a future time. | |
| Approval | When the workspace requires approvals: Ask for Approval with a note to the approver; an approver sees Approve or Send Back. | Production Publish waits until approved. |
| Test Publish, Production Publish | Test sends to colleagues; Production asks once more, then creates the runs. | |

## How to

**Set up a one-time email.** Create Campaign → Regular Marketing, Email, Marketing → Audience: tick the list → Content: pick the template, write the subject line, choose the sender → Test: send yourself a test → Targets: Skip for Now or enter the revenue target → Review & Publish: Send immediately or Schedule → Production Publish.

**Rehearse without sending to anyone.** Attach a Test list, send tests to colleagues, publish to test. A test publish moves the status and sends nothing to real people.

**Send a series.** Drip on Create Campaign → Audience: tick the list → Drip Campaign Setup: build message 1, then Add Message (a copy of the last keeps the header and footer), give each its day and subject, choose the start date, the send time and the zone, and the sender → Targets → Test & Publish: Send All as a Test, check each message, then Publish to Production.

**Send at everyone's 10 a.m.** Tick Send at Each Recipient's Local Time and set Send At to 10:00. The step says how many people have a known zone; the others get 10:00 in the campaign's zone.

**Test two subject lines.** On the Test step switch on Test a Second Subject Line, write B, keep the sample at 20 percent and the decision at four hours, save. The Performance tab shows A and B side by side once the run starts.

## A Drip Campaign

A drip sends several messages on a timetable to one audience on one channel. Everyone on the campaign list starts together on the start date; each message goes on its day (Day 0 is the start date) at the series time, or at its own time.

| Step | What you do there |
|---|---|
| Audience | As for any campaign. The note says how a drip audience works: people added to the lists after message 1 don't join, and consent and frequency limits are checked again before each message. |
| Drip Campaign Setup | The messages as a timeline of cards, in day order, with the gap between them. Open a card to set its name (it names the template copy too), its day, its own send time, the template (Choose from Gallery, Edit Template, Change), the subject line and preheader (email) or the text (SMS, MMS), and the A/B subject test (one message per drip, email only). Add Message starts from a copy of the last message, a template from the gallery, or a blank one; Copy as Next Message does the same from the open one; Remove Message asks first. Series at a Glance holds the start date, the send time and the time zone, what the series adds up to and a calendar; Sender (and Topic) are set once for every message. Changing the date, time or zone moves every message's date but never changes the messages. Continue lists the messages that still need something, with Show First Problem. |
| Targets | As for any campaign; the targets are for the drip as a whole. |
| Test & Publish | Preview each message (as a sample customer, on desktop or mobile). Send All as a Test sends every message now, one after another, to the people you pick; each subject starts with its place: "[Test 2 of 3 · would send Day 3]" for email, "[Test 2/3 · Day 3]" for texts, and the A/B message sends both subjects. A message edited after its test says Changed since the test; Resend it. The Review Timeline shows each message's date, subject and reach, with warnings for messages closer than two days, frequency limits and quiet hours. Before You Publish lists what's left; Publish to Production plans every message at once. |

Each message has its own copy of its template ("Loyalty Welcome Series · 2 of 4"), so editing one never changes another. From the editor, Back to Drip Campaign Setup returns to the message. A message's own subject line is what it sends; its template copy needs none.

Once published, the campaign page shows the Series Timeline: each message Sent with its figures, Sending, Next Up, Scheduled, On Hold, Cancelled or Failed, and who was skipped and why (View People lists them). Pause holds the waiting messages; Resume first shows when the missed ones will go. Stop Remaining Messages cancels the rest for good (to send again, clone it). A failed message nobody received can be retried. Clone asks for the copy's name and start date and opens its Drip Campaign Setup step.

**Not in the first version:** people can't join a drip after it starts (no rolling entry), conversions and revenue aren't split by message, there's no view of where one person is in the series, test recipients can't be saved as a list, and a change can't be applied to every message at once.

## What happens behind the scenes

1. Continue validates the step and saves the draft; the API's field messages land on the same fields and the step that holds the first one opens. A save against an older version is refused and the page offers to reload.
2. The set-up remembers how far it got: an unfinished draft opens at the next step and the steps ahead stay closed, so the publish cannot be reached early.
3. The audience estimate runs the send engine's own governance order as of today; the frozen list at the run is the record of what a send used.
4. Production Publish runs the checklist, records who published, asks for approval when the workspace requires it, and creates the runs the dispatcher will start on time.

## Things to know

- Type and channel are fixed once the campaign exists; make a new campaign to change them.
- A Test list blocks a production publish; an unverified sender blocks it too, while test sends still work.
- A campaign's own subject line never changes the template; other campaigns on the same template keep theirs.
- The hourly limit is not enforced yet; pace a send with the engine's Messages per Minute.
- A drip's messages can't change once it is published, and their templates are locked (read-only, not deletable) until it finishes or is stopped.

---

# Templates and Content

**Where:** Templates in the main navigation; a template opens in its own editor: the email designer, the message editor for texts, or the receipt editor.

## What this page is for

A template is the content a campaign sends: an email design, a text message, or an e-receipt. The Templates page is the library: start a new one from a channel or from a CEP preset, and find, rename, duplicate or preview the ones you have. Each channel has its own editor, full-screen, with versions kept on every save. A campaign picks a template on its Content step; a template is used by any number of campaigns and changing it changes what those campaigns send from then on.

## Who can use it

| | |
|---|---|
| Permission | `template.edit` to create, edit and activate; without it the library is read-only and previews still work. |
| Features | SMS and MMS templates need **sms** and **mms**; E-Receipt needs **ereceipt**; the Barcode and QR Code blocks need **dynamic_codes**. |

## The fields and controls

### The Templates page

| Control | What it is | What it changes |
|---|---|---|
| Start a new message | One card per channel you may use: Email, E-Receipt, SMS, MMS. | Opens New Template for that channel. |
| Your Templates | Search, a tab per channel, a Status filter (Draft, Active, Archived). | The library below. |
| A template's card | Name, channel, status, when it was last used and by which campaign. A drip message's template says which message it is ("Loyalty Welcome Series · Message 2 of 4"); a drip's templates sit together by name, and carry Locked while the drip is live. | Opens the editor. |
| Card menu | Preview, Rename, Duplicate (a draft copy of the latest version), Delete. | Delete is refused while a campaign uses the template, and while a drip uses it for a message ("This Template Is in Use", with the way to the campaign). |
| Starting Point gallery | CEP's presets by category. A preset opens in a read-only preview first. | Copy This Template makes it yours as a new draft; the preset itself never changes. |

### New Template

| Field | What it is | What it changes |
|---|---|---|
| Name | Up to 200 characters. | How it is listed, and what a campaign's Content step shows. |
| Channel | Email (the drag-and-drop designer), E-Receipt (the receipt editor), SMS (the message editor with part counting), MMS (text plus one picture). Fixed once created. | Which editor opens and which campaigns can use it. |
| Description | What the template is for. | Shown in the library. |
| Starting Point | Blank, or one of the starters. | Version 1 of the design. |

A new template is a draft. Activate it from its editor when it is ready; only an active template can be published in a campaign.

### The email designer

The short tour; the chapter The Email Designer has every block and setting, and worked examples.

| Control | What it is | What it changes |
|---|---|---|
| Subject, Preheader | The template's subject line and the text an inbox shows after it. | The campaign uses them unless it writes its own. A missing subject blocks Activate. |
| The palette | Structure (one to four columns), Content (Heading, Text, Image, Button, Divider, Spacer, Social, Header, Footer, Custom HTML), Commerce (Product Card, Coupon, Barcode and QR Code where the feature is on). Drag a block onto the canvas or focus a tile and press Enter. | The design. |
| The canvas | The email as it will render, with desktop and phone views; a block selected shows its settings in the panel. | |
| The settings panel | Per block: text, links, images, colours, fonts, alignment; Margin and Padding; Border and Shadow; Hide on Phones and Hide on Desktop; a barcode or QR code's source tag, format and size. | Written into the email's MJML, the format the server renders to HTML. |
| Tags | The workspace's personalization tags, inserted at the cursor as {{first_name}} and the like. Unsubscribe URL, current year, today, campaign name and email are always available. | Filled in per recipient at send time. |
| Links | Every link in the design, checked for an address. | A missing or bad address is listed before Activate. |
| Errors | Findings: unknown tags, a missing subject, no unsubscribe link, HTML over Gmail's 102 KB clip limit. | Warnings on Save; blockers on Activate. A marketing campaign cannot publish without the unsubscribe link. |
| Preview, Send a Test | The compiled email with sample values, desktop and mobile; a test to your own address. | |
| Save, Activate | Save writes version n+1 and never overwrites an earlier one; Activate makes the template usable by campaigns. | A save on top of someone else's newer version is refused and the page offers to reload. |
| History | Every version with who saved it and when; open one and save to make it the newest. | |
| Code | The MJML source, for reading or pasting a block of raw markup. | |

### The message editor (SMS, MMS)

| Control | What it is | What it changes |
|---|---|---|
| The message | The text, with live counting of characters and parts: a text over 160 GSM characters, or 70 with an emoji or an accented letter, is sent as more than one part and the carrier bills each. | What is sent. |
| Insert Personalization Tag | A tag at the cursor. | Filled in per recipient; the counter uses the sample value. |
| Picture (MMS) | One image, uploaded here, with a public address the aggregator fetches. | |
| The preview | The message in a phone frame as the sender's number. | |
| STOP line | A marketing text must tell people how to opt out. | The aggregator refuses a marketing text without one. |
| Save, Activate, Version History | As in the designer. | |

### The receipt editor

| Control | What it is | What it changes |
|---|---|---|
| Presentation | Compact, Standard, Itemized, Store Register, or Custom HTML. | The shape of the receipt inside the email. |
| Receipt Sections | Order header, Customer & fulfillment, Items, Totals, Payment, Loyalty, Returns & support: each on or off (some are fixed), each with its own switches: the order number, date, store and receipt ID; the address shown; the item columns and row height; the totals rows and a savings callout; the payment method, always masked to the last four digits; points and tier progress; the policy text and an in-store return barcode. | What the point of sale's transaction is laid out as, at send time. |
| Show Inside Email Shell | Whether the receipt sits inside the outer email design. | |
| The outer design | The email around the receipt: brand header, marketing block, button, image, divider, footer, in the same designer. | |
| Sample Transaction | A POS or eCommerce sample to preview with; desktop and mobile; Send a Test. | |
| Checks | What a receipt needs before Activate. | |

## How to

**Make an email from a preset.** Templates → scroll to Starting Point → open a preset → Copy This Template → name it → the designer opens with the copy; change the text and images, Save, Activate.

**Personalize.** Put the cursor in a text block, open Tags, pick First Name. The canvas shows the sample value; each recipient gets their own.

**Add a coupon with a barcode.** Commerce → Barcode; in the settings pick the source tag (for example the coupon code uploaded with the list) and the format. The sent email carries each recipient's own code; a recipient without a value gets the email without the block.

**Hide a block on phones.** Select it → Hide on Phones. The phone view of the canvas shows the result.

**Go back to an earlier version.** History → open the version → Save. It becomes the newest version; nothing is lost.

**Write a text that fits in one part.** Keep under 160 characters without emoji; the counter says how many parts the text will be sent as.

## What happens behind the scenes

1. The designer saves the design twice over: the editor's own state, to reopen exactly as left, and the MJML source. The server renders the HTML from the MJML, derives the text part, and checks the design (tags, subject, unsubscribe link, size). The browser never supplies the final HTML.
2. Every save is a new version in the template's history; Activate marks the template usable by campaigns.
3. At send time the engine fills the tags from the workspace's tag catalogue, the recipient's list columns and the customer record, draws each barcode and QR code, puts the campaign's subject and preheader in when it has its own, and for a receipt lays out the transaction the point of sale sent into the receipt slot.
4. Images are uploaded once per workspace and served from the media store, never embedded in the email.

## Things to know

- Changing a template changes what every campaign using it sends from then on. Duplicate when a campaign must keep its own version.
- A drip gives every message its own copy of a template, so a drip's messages never change other campaigns. Opened from the Drip Campaign Setup step the editor says which message it is, keeps the subject on the message (read-only here), and leads Back to Drip Campaign Setup. While the drip is live the copy is locked: the preview and the editor say "Used by a live drip (…). It can't be changed until the drip finishes or is stopped." and open read-only.
- Only an active template can be published; a draft can be previewed and test sent.
- A marketing email must carry the unsubscribe link; the designer blocks Activate without it and the campaign cannot publish.
- Outlook for Windows ignores shadows; the field says so.
- A text template cannot have a subject line; a campaign on it cannot either.

---

# The Email Designer

**Where:** Templates → an email template, or New Template → Email. Full screen, with Back to Templates at the top left.

## What this page is for

The designer is where an email template is built: the subject line and preheader, and the design as blocks dragged onto a canvas. Everything is edited visually; the designer writes the email's source (MJML, a mark-up made for email) and the server renders the HTML every inbox gets, so what the canvas shows is what is sent. Every save is a version, nothing is overwritten, and a template is a draft until Activate makes it usable by campaigns.

This chapter is the long form. The Templates and Content chapter covers the library, the text message editor and the receipt editor.

## Who can use it

| | |
|---|---|
| Permission | `template.edit` to edit, save and activate. Without it a template opens read-only: the canvas can be browsed and the Preview used, nothing can be changed. |
| Features | Barcode and QR Code blocks need **dynamic_codes**; the Deliverability tab needs **deliverability_tests** and a Mailgun Inspect account: CEP's, or your own under Settings. |

## The workspace, piece by piece

| Part | What it is | What it changes |
|---|---|---|
| The top bar | Back to Templates, the template's name and status, the three modes (Content, Preview, Deliverability) and History. | The mode you work in. |
| Subject | The subject line, with a tag picker and an emoji picker beside it; the counter turns amber past 60 characters (inboxes cut it there) and the field stops at 300; a hint appears when a word is one spam filters dislike. | The subject every campaign on this template sends, unless the campaign writes its own. Empty, it blocks Activate. |
| Preheader | The text an inbox shows after the subject, with the same pickers; amber past 90 characters. | Hidden text at the top of the email that inboxes show in the list. Optional. |
| Blocks (left rail) | The palette: Structure, Content, Brand and Commerce blocks, with a search. Drag a tile onto the canvas, or focus a tile and press Enter to add it below the selected block. | The design. |
| Assets | The workspace's image library: upload (PNG, JPEG, GIF, WebP, up to 5 MB), search, and pick a picture for the selected Image block. The same file uploaded twice is kept once. | The images the design uses. |
| Layers | The tree of what is on the canvas: sections, columns and blocks, with their names. Select, rename, reorder, hide on canvas. | A quick way to reach a block buried in a layout. |
| Tags | The workspace's personalization tags with their sample values. A tag inserts at the cursor while text is being edited; otherwise it is copied. | `{{tag}}` tokens filled in per recipient at send time. |
| The canvas | The email as it renders, desktop or phone width, with the selected block outlined. Click a block to select it, drag to move it, double-click text to edit it with the formatting toolbar. | |
| The settings panel (right) | The selected block's settings in three groups: Content, Layout, Appearance. Every field is listed under the block types below. | The block. |
| The footer | The note: errors that must be fixed, warnings that are advisory, or No errors; **Save**; **Activate** (draft only, with the reason when it cannot). | |
| Errors and Links pills | The findings on the design, each leading to the field or block concerned; every link in the design with its address and what is wrong with it. | |

## The blocks

| Group | Block | What it is | Settings that matter |
|---|---|---|---|
| Structure | One, Two, Three, Four Columns | A section with that many columns. Everything else goes into a column. | Section: Email Width, Padding, Full Width, Background Color, Corner Radius. Column: Width, Padding, Vertical Alignment, Background Color, Corner Radius. |
| Structure | Spacer, Divider | Empty vertical space; a line. | Height; Width, Alignment, Line Color, Line Width. |
| Content | Heading, Text | Rich text with the toolbar: bold, italic, links, lists, tags. | Alignment, Padding, Font Family, Font Size, Font Weight, Line Height, Text Color, Background Color (the cell behind the text). A link inside text gets Link Color and Underline. |
| Content | Image | A picture from the image library or uploaded now (PNG, JPEG, GIF, WebP, up to 5 MB). | Image, Alt Text (describe it for people who cannot see it; a missing alt is a finding), Link, Alignment, Width, Height, Max Height, Padding, Corner Radius. |
| Content | Button | A call to action. | Label, Link, Alignment, Width, Height, Margin (space outside), Padding (space inside), Font, Background Color, Text Color, Corner Radius. |
| Content | Custom HTML | Raw HTML you write, for things the blocks cannot do. It is sent as written, so keep to email-safe tables. | HTML, Width, Alignment, Margin, Padding, Background Color. |
| Brand | Header | Your wordmark, an optional tagline, on a brand bar. | Wordmark Text, Tagline, Alignment, Brand Bar Color. |
| Brand | Social Links | Icons for the networks you add, in a row or a column, with or without labels. | Add a Network, then per network: Network, Link, Label, Icon Size, Icon Background, Icon Corner Radius. |
| Brand | Footer | The address, the unsubscribe link and the small print. | The sender address and the legal text. The unsubscribe link must stay for marketing mail. |
| Commerce | Product Card | Image, name, price and a button for one product. | Image with Alt Text, Ratio, the text and the button's label and destination. |
| Commerce | Coupon | A headline, body text and a treatment for an offer, with the coupon tags ready to use. | Headline, Body (with quick tags for the coupon code), Alignment, Treatment. |
| Commerce | Barcode, QR Code | A code drawn per recipient from a tag's value, the coupon code uploaded with the list for example. | Source tag; barcode Format (Code 128, Code 39, EAN-13, UPC-A), Width, Height; QR Error Correction (Low, Standard, High, Maximum), Size; the value printed under the code; Alignment; Background. |

Settings every block shares, in Layout: **Margin** (space outside the block), **Padding** (space inside), **Hide on Phones** and **Hide on Desktop**. In Appearance, where the block allows it: Background Color, Border Width, Border Style, Border Color, Shadow (Outlook for Windows drops shadows; the field says so), Corner Radius. Lengths take px, %, em and rem and settle on px.

## Personalization

- Tags come from the workspace's catalogue (Settings → Tags): first name, last name, loyalty tier and so on, the three coupon tags, and the system tags that are always there: unsubscribe URL, current year, today, the campaign's name, the recipient's email.
- Insert one from the toolbar while editing text, from the Tags panel, or from the picker beside Subject and Preheader. Type it as `{{first_name}}` if you prefer.
- The canvas and the Preview show each tag's sample value; the sent email has the recipient's own, or the tag's default when the person has none. A tag that is not in the catalogue is a finding on Save.
- The coupon tags (`coupon_code`, `coupon_barcode_value`, `coupon_qr_value`) are filled from columns of the same names in the contact list's upload, so an offer can be unique per person.

## Preview mode

| Control | What it is |
|---|---|
| Preview As | Sample Values (the catalogue's samples), Full Profile (a complete customer), Empty Profile (a customer with nothing filled in, to see the defaults). |
| Device | Desktop (680 px) or Mobile (375 px). |
| Client | Generic, Gmail, Outlook, Apple Mail: the inbox row above the email shows the subject and preheader cut where that client cuts them, and the email is rendered with that client's quirks. |
| Appearance | Light or Dark: how the email looks in a dark-mode inbox. |
| Send a Test | The email, as previewed, to your own address or the addresses you type. |

## Deliverability mode

Run Inbox Previews renders the last saved version in real email clients through CEP's Mailgun Inspect account, or the workspace's own one under Settings → Sending Engines → Deliverability Testing. Every test of the template is listed on the left; a result shows the renders grouped by client kind, a render opens full size. Through CEP's account, tests count against the plan's monthly number plus any tests added for the month, which Settings → Plan & Usage shows; through your own, they are not limited. Unsaved changes are not in a test: save first.

## Saving, versions and activating

- **Save** writes version n+1. The designer also saves a draft by itself 30 seconds after the last edit, unless the template is read-only, an older version is on the canvas, or the last save was refused.
- **History** lists every version with who saved it and when. Open one to look at it: the strip says *You are looking at version n*; saving from there makes it the newest version, nothing is lost; Back to Latest returns.
- **A conflict**: when someone else saved a newer version, the strip says so and offers Load Latest Version. Nothing is sent until you do.
- **Activate** runs the blockers: a subject line, the design saved at least once, an unsubscribe link for marketing mail, images with an alt text and no placeholder images, the HTML under Gmail's 102 KB clip limit. A template with an error cannot be activated; warnings are advisory. Once active, campaigns can pick it and publish.
- **Leaving** with unsaved changes asks first.

## Examples

### A welcome email from a starter

1. Templates → Email → name it *Welcome to Northwind* → Starting Point: Welcome email → Create.
2. Subject: `Welcome, {{first_name}}` from the tag picker; Preheader: *Your first order ships free this month.*
3. Select the Header block → Wordmark Text: Northwind Apparel → Brand Bar Color: your navy.
4. Double-click the hero text → write the welcome in two short sentences; keep the heading one line.
5. Select the Button → Label: Start Shopping → Link: your shop's address; Appearance → Background Color: Blue 600.
6. Preview → Client: Gmail → check the inbox row reads well cut at 100 characters; Device: Mobile → check the button is reachable with a thumb.
7. Send a Test to yourself, then Save and Activate. The campaign's Content step now offers it.

### A sale announcement with a personal coupon

1. New Template → Email → Starting Point: Sale announcement.
2. Drag a **Coupon** block under the hero. Headline: *20% off this weekend*; Body: insert the `coupon_code` tag from the quick tags, so each person sees their own code; Treatment: dashed.
3. Drag a **Barcode** block under the coupon. Source: `coupon_barcode_value`; Format: Code 128; the value under the code on. The canvas shows the sample value's bars; the sent email draws each recipient's.
4. Upload the contact list with columns named `coupon_code` and `coupon_barcode_value`; the list's people carry them.
5. A recipient with no code gets the email without the barcode block; the run's completion message says how many.
6. Preview As → Empty Profile shows what a person without a code sees. Save, Activate.

### A two-column newsletter with a phone layout

1. New Template → Email → Blank. Add a **Header**, then a **Two Columns** section.
2. Into the left column drag an **Image** (upload the cover picture; Alt Text: what it shows), into the right a **Heading** and a **Text**.
3. Below, a **Three Columns** section with a **Product Card** in each: image, name, price, Button → Destination: the product's page.
4. Switch the canvas to the phone. The columns stack; if the picture should come after its text on a phone, select the section → Layout → stacking: reverse. If the three cards are too much on a phone, select the third card → Hide on Phones.
5. Add a **Spacer** (Structure) between sections rather than padding on every block: one place to tune the rhythm.
6. Footer: keep the unsubscribe link; add Social Links (Brand) with your networks.
7. Preview → Appearance: Dark → check the header's wordmark is still readable on the dark bar. Save, Activate.

### Reusing a design

Duplicate from the library makes a draft copy of the latest version; change the copy and activate it. The original and the campaigns on it are untouched. For a seasonal variant, History on the copy still shows where it came from.

## Things to know

- The subject and preheader on the template are defaults: a campaign can write its own on its Content step without touching the template.
- Marketing mail must carry the unsubscribe link; the Footer block has it. Remove it and Activate refuses, and a marketing campaign cannot publish.
- Images are stored once per workspace and served from the media store; the same file uploaded twice is kept once.
- Email clients differ: Outlook for Windows has no shadows and no media queries (the phone rules use its own mechanism), Gmail clips emails over 102 KB. The Preview's clients show the common cases.
- A text template has no designer: SMS and MMS open the message editor, e-receipts the receipt editor.

---

# Setting Up a New Workspace

**Where:** Settings → Workspace → Set-Up. The first sign-in of an administrator lands here while the workspace is not ready, and Home keeps a card pointing back until it is.

## What this is

The platform team creates the workspace and sends its first administrator an email with a one-time password link and the set-up list. From that email to the first production send is one path, and this chapter walks it: choosing a password, the first sign-in, the Set-Up page that knows what is done, the seven steps in order, a rehearsal with a test campaign, and the first real send. Nothing in it is a new form: every step opens the Settings page that does it, and those pages have their own chapters.

## Who does it

| | |
|---|---|
| Permission | The first administrator holds the Workspace Admin role, which has every permission including `user.admin`. Anyone with `user.admin` sees the Set-Up page. |
| Features | Step 5 (texts) reads as not available without the **sms** feature; the API Keys link under step 7 needs **api_access**. The platform team switches features on per workspace. |

## The path, from the email

### Before the first sign-in

1. **The email.** It names the workspace and its code (for example `NWA`), carries the password link and lists the set-up steps. The link is one-time: if it was used or has expired, ask the platform team, or any administrator who already has access, for a new one (Settings → Users → Password Link).
2. **Choose a password.** The link opens the password page; choose one and continue to the sign-in.
3. **Sign in.** The workspace code, your email and the password. When the workspace requires multi-factor authentication, the next screen walks you through it before anything else: scan the code with an authenticator app, type the six digits, store the recovery codes.
4. **You land on Set-Up.** An administrator whose workspace is not ready lands here instead of Home: *Welcome, {name}. Let's set up {CODE}.* with step 1 already done. Everyone else, and every later sign-in, lands on Home, where a card says how far the set-up is until the workspace is ready.

### The seven steps, in order

| # | Step | What to do | Done when |
|---|---|---|---|
| 1 | Choose your password and sign in | Done by reading this. Account Security sets up your own second step. | You are signed in. |
| 2 | Invite your team and give them roles | Users → Add User: email, name, a role. Three roles are ready: Workspace Admin, Campaign Manager, Analyst; Roles adds narrower ones, for example an approver. Each person gets their own password link. | At least one other active user with a role. |
| 3 | Add an email engine | Sending Engines → Add Engine: Postal or SendGrid with its address and key → Check. Then Copy Webhook URL and register the address with the provider, so deliveries and bounces come back. | An active email engine whose last Check passed. |
| 4 | Add an email sender and verify it | Sending Engines → Add Sender on the engine: the From name and address on a domain the engine may send for → Verify; the message arrives in your own inbox. Tick Default. | A verified email sender. |
| 5 | Add a text engine and a sender number (optional) | Sending Engines → Add Engine: Digivize with its keys and brand, or the Sandbox to rehearse without an aggregator → a sender with the number → Verify by a text. | An active text engine with a verified number. Optional. |
| 6 | Import your do-not-contact list, then your first contact list | Suppressions → Import the opt-outs from your previous system first, so no upload can reach them. Then Contact Lists → Create List → Upload a File: name it, say what it is for, match the columns, declare where the people agreed, review, import. | A production list with people. |
| 7 | Decide who is told, and who approves (optional) | Notifications: the addresses or chat webhook that hear about failed sends. Approvals: whether a second person signs off before a production publish. API Keys: a key with `receipts:send` when the point of sale will send receipts. | A recipient, or approvals on, or a key. Optional. |

**Ready** means steps 1, 2, 3, 4 and 6 are done. The Home card goes, and the page stays under Settings with the optional steps still listed.

### Before the first real send

Worth setting while the workspace is quiet, each with its own chapter:

- **Consent Policy** (Settings → Audience): what an upload does with people without a consent date, whether text lists need a text consent date, approval before a fresh list's first send, and the sentence uploaders confirm.
- **Preference Centre**: switch on when customers should choose topics; add the topics first and put `{{preference_url}}` in the templates' footer.
- **Email Server**: your own SMTP server for password links and notifications, so they come from your domain.
- **Tags**: the workspace's own personalization tags beyond the platform's catalogue.
- **Security**: require multi-factor authentication for everyone, or sign in through your identity provider.
- **Templates**: copy a preset, put your brand on it, Activate.

### The rehearsal, then production

1. **A test campaign.** Campaigns → Create Campaign → Regular Marketing, Email, Marketing → a Test list (Contact Lists lets you make one from a file of colleagues) → the template → Send a Test to yourself → Test Publish. A test publish sends to nobody real and counts in nothing.
2. **The first production send.** The same campaign with the production list attached, the sender verified, a subject line, the topic when the preference centre is on → Review & Publish → Production Publish. The checklist on that step names anything missing.
3. **Watch it land.** The campaign's Performance tab and Recipients show each message's story as the engine calls back; Home's Needs Attention raises a failed run; Settings → Integrations keeps every call.

## The Set-Up page's controls

| Control | What it is | What it changes |
|---|---|---|
| The heading | *Welcome, {name}. Let's set up {CODE}.* on a brand-new workspace; *Set Up Your Workspace* afterwards. Under it the workspace's name, plan and time zone. | |
| Hide Until Later / Show on Home Again | Hides the Home card, or brings it back. | The Home card and the first-sign-in landing. The page itself stays. |
| n of 7 done, the meter | How many steps are done. | |
| A step's row | Its number (blue for the next one, amber when it needs attention, a tick when done), its name, a sentence read from the workspace, a hint while it is the next step, a status tag (Done, Not verified, Not checked), and the buttons to the page that does it. | |
| The callout | Which steps make the workspace ready, or that it is ready. | |

## What happens behind the scenes

Every load reads the users and roles, the engines and their last check, the senders, the suppressions and lists, the notification settings, the approval switch and the API keys, and decides each step from them; nothing is ticked by hand. The dismissal of the Home card is the only thing the page stores. The platform team sees the same readiness from their side, so they know when a workspace is sending.

## Things to know

- Until an email engine has been checked and a sender verified, test sends work and production publishing does not.
- A password link is one-time; a new one replaces the old.
- The optional steps never hold the workspace back, and the page keeps listing them until they are done.

---

# Sending Engines and Senders

**Where:** Settings → Sending → Sending Engines.

## What this page is for

Nothing leaves CEP without an engine. An engine is the service that actually delivers your messages: a Postal or SendGrid account for email, Digivize for texts, your own mail server, or the Sandbox that sends nothing while you try things out. A sender is the name and address (or the number) your messages come from, on one of those engines. This page is where both are added, checked and kept healthy, and where the engine is told how to report deliveries back to CEP.

A campaign picks a sender when it is set up; the sender decides the engine. Until a workspace has a checked email engine and a verified sender, test sends work but nothing can be published to production.

## Who can use it

| | |
|---|---|
| Permission | `provider.edit`. Without it the page says so and names the permission to ask for. Settings as a whole needs `user.admin`. |
| Features | Email engines are always offered. Text engines (Digivize, Sandbox) need the **sms** feature; MMS needs **mms** as well. The platform team switches features on per workspace. |

## The fields and controls

### The engines table

| Control | What it is | What it changes |
|---|---|---|
| Provider | The engine's name, its channel tag (Email or Texts) and **Default** when it is the one new senders are offered first. Under it, the engine type and its address, and *separate key for receipts* when a second credential is stored. | Nothing by itself; it is the row's identity. |
| State | **Not Checked Yet** until the first Check; **Checked** with the date and time when the last Check passed; **Check Failed** when it did not; **Switched Off** when *In Use* is unticked. | Set-Up counts an email engine as done only when it reads Checked. A switched-off engine is skipped by every send. |
| Callbacks | **Copy Webhook URL** copies the engine's callback address, the address the provider must post delivery results to. **Rotate Address** makes a fresh address and retires the old one at once. Under them: when the last callback arrived and how many came in the last 24 hours, or a warning that none ever has. | Without a registered callback address CEP sends but never learns what happened: no delivered, bounced, opened or clicked counts, and bounced addresses are not blocked. Rotating means registering the new address with the provider again. |
| Check | Asks the provider to confirm the address and the credential without sending anything. With two keys on a Postal engine it checks both and names the one refused. | Sets State to Checked or Check Failed with the provider's own words. |
| Edit | Opens the engine's form. | |
| Remove | Deletes the engine after a confirmation. | Its senders are removed with it. A campaign that used one of them has to be given another sender before it can publish. |
| Add Engine | Opens the form for a new engine. | |

### The engine form (Add Engine, Edit)

| Field | What it is | What it changes |
|---|---|---|
| Engine | The engine type: *Email · Postal*, *Email · SendGrid*, *Texts · Digivize*, *Texts · Sandbox (sends nothing)*. The type is fixed once saved. *Email · SMTP (your mail server)* is not offered here: it is switched on from Settings → Email Server with *Offer this server as a campaign sender*. | Decides which fields follow, whether the engine reports callbacks, and the channel its senders belong to. |
| Name | How the engine is listed in this workspace, for example *Postal (marketing)* or *Texts (short code 55123)*. | Shown on every sender and in Set-Up. |
| The engine's own fields | What the type needs to connect. They are listed per type below. A field marked as a key or secret is write-only: once saved it is never shown again, and the form says *stored*; leave it empty to keep it, type a new one to replace it. | The credential and address CEP uses on every send. |
| Messages per Minute | An optional pace. Empty means as fast as the provider accepts. | Spreads a run over time. Use it when the provider has a rate limit or when a slow ramp is wanted for a new sending domain. |
| Default Engine for Email / Texts | One engine per channel is the default. | The one offered first when a sender is added. It does not change existing senders. |
| In Use | Whether the engine may send. | Unticked: State reads Switched Off and every send that would use it fails at once with that reason. Tick it again to resume. |

### Fields per engine type

**Postal**

| Field | What it is | What it changes |
|---|---|---|
| Postal Address | The base address of your Postal installation, for example `https://postal.example.com`. | Where every send and every Check goes. |
| Server API Key | Postal → your mail server → Credentials → type API. | Carries campaigns, and everything else until a transactional key is set. |
| Transactional Server API Key | Optional. The API key of a second Postal mail server. | Receipts and other transactional email go through that server in their own lane, so they never queue behind a campaign, and each server keeps its own sending reputation. Both servers post to the same callback address. *Remove* drops it. |
| Webhook Public Key | Optional. The PEM public key of the Postal installation. | Callbacks are then checked against Postal's signature as well as the address's own token. |

**SendGrid**

| Field | What it is | What it changes |
|---|---|---|
| API Key | SendGrid → Settings → API keys. It needs the *Mail Send* permission. | Used on every send and Check. |
| API Address | Optional. Empty means the global region; EU subusers use `https://api.eu.sendgrid.com`. | Where the calls go. |
| Event Webhook Verification Key | Optional. SendGrid → Mail settings → Event Webhook → Signed Event Webhook. | Callbacks are then verified against SendGrid's signature. |

**Digivize (texts)**

| Field | What it is | What it changes |
|---|---|---|
| API Address | Optional. Empty means Digivize's standard address; the sandbox has its own. | Where every send goes. |
| Batch Send Path | Optional. The path of the batch request, when Digivize gives one that differs from the standard. | Used in batch send mode. |
| API Key | Digivize's `api_key`. | Travels with every call. |
| Secret Key | Digivize's `secret_key`. Write-only. | Signs every call; a wrong key fails Check. |
| Brand ID | The brand's number at Digivize, for example `3`. A name is refused. | Every text is sent under this brand. |
| Send Mode | `single` (the default): one request per text. `batch`: one request per identical text with a list of recipients, once Digivize provides the batch route. | How a run's messages are grouped. |
| Message Type | `marketing` (the default) or `transactional`. | Digivize applies its own rules per type; a marketing text without a STOP line is refused by Digivize. |
| Callback Address to Send | Optional. Paste this engine's own callback address (Copy Webhook URL). | Digivize is asked to post delivery results there with every send. |
| Webhook Secret | Optional. The secret given to Digivize for the callback. | Results are then verified; empty, the address's own token is the check. |

**Sandbox (sends nothing)**

| Field | What it is | What it changes |
|---|---|---|
| Numbers to Refuse | Comma-separated numbers. | Sending to them fails for good, as an invalid number would: for rehearsing failures. |
| Numbers that Fail Temporarily | Comma-separated numbers. | Sending to them asks for a retry, as a busy aggregator would. |

The Sandbox accepts every text and sends none, and is not metered against the plan. Use it to try text campaigns before an aggregator is connected.

### The senders table

| Control | What it is | What it changes |
|---|---|---|
| Sender | The display name, the channel tag and **Default** when it is the one a new campaign is offered first. Under it, the address or the number and the engine it sends through. | The From line (email) or the number (texts) on every message of a campaign that uses it. |
| Status | **Not Verified Yet**, **Verified**, or **Verification Failed**. | Only a verified sender can publish to production. Test sends work from any sender. |
| Verify / Verify Again | Email: sends a real message from the address to your own sign-in email. Texts: asks for a mobile number (with the country code) and sends it a text. Accepted by the engine = Verified. | Sets the status. |
| Edit | Opens the sender's form. | |
| Remove | Deletes the sender after a confirmation. | A campaign that used it needs another sender before it can publish. |
| Add Sender | Opens the form for a new sender; needs an engine first. | |

### The sender form (Add Sender, Edit)

| Field | What it is | What it changes |
|---|---|---|
| Sends Through | The engine this sender uses. | The channel of the sender (email or texts) and which account delivers its messages. |
| From Name (email) / Name (texts) | Email: the name shown in the inbox, for example *Northwind Rewards*. Texts: how the sender is listed in campaigns, for example *Northwind texts*. | The name on every message, or the label in the campaign's sender list. |
| From Address (email) | The address messages come from. It must belong to a domain the engine is allowed to send for. | Changing it needs a new verification. The engine's domain checks (SPF, DKIM) decide whether inboxes trust it. |
| Reply-To Address (email) | Optional. Where replies go when it is not the From address. | The Reply-To header on every message. |
| Sender Number (texts) | The number texts come from: a short code (`55123`), a long number with the country code (`+14045550155`) or an alphanumeric sender id where the aggregator allows one. | The number on every text; replies and STOP messages come back to it. |
| Default | One sender per channel is the default. | Offered first when a campaign is set up. |

### Deliverability Testing

| Control | What it is | What it changes |
|---|---|---|
| Provided by CEP | Shown when your tests run through CEP's Mailgun Inspect account: this month's tests against your total, and where the total comes from (your plan's number, plus any tests the platform team added for the month). | |
| Edit Clients | The default clients every test renders in (webmail, desktop apps, phones and tablets) and whether to render with images blocked. Leave every client unchecked for the service's own default set. | |
| Use Your Own Mailgun Account / Set Up Mailgun Inspect | Region (US or EU), your Inspect account's username and an API key (write-only, stored encrypted). Check Connection confirms them. | Your tests run through your own account, and CEP does not limit them. |
| Edit | Your own account's settings and its default clients. | |
| Stop Using My Own Account | Removes your account; past results stay. | Tests go back to CEP's account, within your plan. Shown as Remove when CEP's account is not available. |
| The status | Not Checked Yet, Checked, Check Failed, Switched Off. | |

Mailgun Inspect Basic covers client previews; the spam verdict and inbox placement show as not in your plan until they exist. Through CEP's account, tests count against your plan's monthly number plus the tests added for the month (added tests end with the month); through your own, they are counted under Plan & Usage for information only.

## How to

**Connect an email engine.** Add Engine → choose the type → name it → paste the address and the key → Add Engine. Press **Check** on its row and wait for *Checked*. Then **Copy Webhook URL** and register that address with the provider (Postal: the mail server's Webhooks; SendGrid: Mail settings → Event Webhook). Within a day the Callbacks column should show callbacks arriving.

**Add and verify a sender.** Add Sender → pick the engine → the from name and address → tick Default if it is the usual one → Add Sender. Press **Verify** and look for the message in your own inbox: when the engine accepts it, the status reads Verified. For texts, Verify asks for a mobile number to text.

**Keep receipts out of the campaign queue (Postal).** Edit the engine and enter the API key of a second Postal mail server as the Transactional Server API Key. Receipts and transactional campaigns then use it in their own lane. One engine, one callback address, two keys.

**Replace a leaked key.** Edit the engine, type the new key over the stored one, save, press Check. For the callback address, press **Rotate Address** and register the new address with the provider; the old one answers nothing from the moment you rotate.

**Try texts without an aggregator.** Add the Sandbox engine and a sender on it. Text campaigns then run end to end and nothing is sent. The Sandbox can even play back deliveries and STOP replies when a developer posts to its callback address.

## What happens behind the scenes

1. **Publishing** a campaign attaches the sender you chose; the sender names the engine.
2. **At the run's time** CEP builds the audience, leaves out the people it must (no consent, unsubscribed, bounced, over the frequency cap, and so on), and hands the messages to the engine in batches, paced by Messages per Minute.
3. **The engine answers** per message: accepted (CEP records the engine's message id), rejected (failed, never retried) or try again (retried after 1, 5, 15, 30 and 60 minutes; after five attempts it fails). A refused key or a suspended account stops the whole run with that reason.
4. **The engine calls back** to the callback address as things happen: delivered, bounced, deferred, dropped, complained, opened, clicked, unsubscribed. CEP keeps every callback and moves the message's status forward. A hard bounce or a complaint blocks the address for every future campaign; a complaint or an unsubscribe also records an opt-out.
5. **Texts** follow the same path with their own vocabulary: delivered or failed receipts, and replies. A STOP reply opts the number out of every kind of campaign and blocks it; START lifts the block.

The campaign's **Recipients** tab shows each message's story, and **Check with the Engine** on a row asks Postal directly what became of it.

## Things to know

- A sent message with no delivered time, and *No callback has ever arrived* on the engine, means the callback address is not registered with the provider. The send worked; the news is not coming back.
- Verification is per address. Changing a sender's From Address resets it to Not Verified Yet.
- Removing an engine removes its senders. Switch it off instead when you may need it again.
- Keys are stored encrypted and are never shown, exported or written to the audit trail.
- The platform's own mail server (used for password links and notifications) is never a campaign engine. Your workspace's own mail server can be, from Settings → Email Server.

---

# Users

**Where:** Settings → Workspace → Users.

## What this page is for

Who can sign in to the workspace, with which roles. People are invited by email with a one-time password link; they choose a password and sign in. Users are deactivated, never deleted, so everything they created keeps its author.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |
| Features | Always on. A column reads SSO when the workspace signs people in through its identity provider (Settings → Security). |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | User (name and email, *you* on your own row), Roles, Status (Active or Deactivated), Sign-In (when they last signed in; *No password yet* until the password link is used; the provider's name for single sign-on accounts). | |
| Add User | Opens the form. | |
| Edit | The name and the roles. The email address is the sign-in name and cannot be changed. | |
| Password Link | Makes a one-time link to choose a password, sends it by email when the workspace has a mail server, and shows it to copy otherwise. For a new user, for someone who forgot, or when a link expired. | The previous link stops working. |
| Deactivate / Reactivate | Takes the sign-in away or gives it back. Nobody can deactivate themselves. | A deactivated user is left out of every count and every notification; their campaigns and templates stay. |

### The user form

| Field | What it is | What it changes |
|---|---|---|
| Email | The sign-in name. Must not exist in the workspace. | Where the password link goes. Fixed once created. |
| Name | Shown wherever the person appears: owner of a campaign, author of a template, the approver. | |
| Roles | One or more of the workspace's roles. Without a role the user can sign in but sees nothing. | What the person may do. The permissions of all their roles add up. |

## How to

**Invite someone.** Add User → email, name, tick a role → Add. The password link goes by email when the workspace has a mail server; otherwise copy it from the Password Link dialog and send it yourself.

**Someone forgot their password.** Password Link on their row. The link is one-time and expires; an older link stops working.

**Someone leaves.** Deactivate. Their campaigns keep their name as owner; reassign the live ones from each campaign's Edit Details.

## What happens behind the scenes

1. Adding a user creates the account with no password and a one-time link. The workspace's own mail server carries the email when one is entered under Settings → Email Server; the platform's server otherwise; with no server at all the link is shown to copy.
2. The first sign-in of an administrator lands on Settings → Set-Up while the workspace is not ready.
3. When Security requires multi-factor authentication, a new user is asked to set it up on their first sign-in, before anything else.

## Things to know

- The workspace's plan caps the number of active users; Settings → Plan & Usage shows the count against the limit.
- A single sign-on account has no password link: the identity provider signs it in.
- Roles are defined on the Roles page; this page only assigns them.

---

# Roles

**Where:** Settings → Workspace → Roles.

## What this page is for

A role is a named set of permissions. A user with the role may do what its permissions allow, and a user with several roles may do the union of them. Three roles come with every workspace: Workspace Admin (everything, including users, roles and API keys), Campaign Manager (builds and publishes campaigns, lists and templates) and Analyst (read-only with reports). Add your own for narrower jobs.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | Role (name and description), Permissions (how many of the catalogue), Users (how many hold it). | |
| New Role, Edit | The form: Name, Description, and a checkbox per permission, grouped by area. | |
| Delete | Removes a role nobody holds. A role with users is refused. | |

### The permissions

| Permission | What it allows |
|---|---|
| campaign.view | See campaigns, their results, recipients and activity. |
| campaign.edit | Create, edit, clone and archive campaigns; send tests; ask for approval. |
| campaign.publish | Publish to production, pause, resume, cancel a schedule, choose a subject test's winner. |
| campaign.approve | Approve or send back a campaign when the workspace requires approvals. Never for the person who asked. |
| journey.view, journey.edit, journey.activate | See, build and switch on journeys (with the journeys feature). |
| template.view, template.edit | See templates; create, edit, activate and delete them. |
| list.view, list.edit, list.import | See lists and their people; create, edit, clone and archive lists; upload files. |
| consent.edit | Approve or refuse a list that waits for approval; block and unblock addresses under Suppressions. |
| governance.edit | Change the frequency policies. |
| provider.edit | Sending engines, senders, integrations and deliverability testing. |
| report.view | Reports, Home's figures, Governance. |
| user.admin | Settings as a whole: users, roles, tags, security, approvals, notifications, the plan, API keys, the consent policy, the preference centre, POS receipts. |

## How to

**Make an approver who cannot publish.** New Role → *Approver* → tick campaign.view and campaign.approve → Create. Give it to the people who sign off.

**Let the store team upload lists only.** New Role → list.view, list.edit, list.import. They see Contact Lists and nothing else.

## What happens behind the scenes

Every API request checks the permission the endpoint needs against the union of the user's roles; a page without the permission says which one to ask for. Changing a role takes effect at the user's next request, no sign-out needed.

## Things to know

- Settings needs user.admin as a whole; a role with provider.edit alone cannot open Sending Engines through the menu, though the API allows it.
- The three starting roles can be edited and renamed like any other; the Workspace Admin role is what the first administrator holds.

---

# Tags

**Where:** Settings → Workspace → Tags.

## What this page is for

Tags are the words a template fills in for each person: `{{first_name}}`, `{{store_name}}`, `{{coupon_code}}`. The platform's own catalogue is inherited by every workspace and the same everywhere; this page shows it, and adds the workspace's own tags: a static text, or a value read from the customer record, a list upload column, the campaign, the run, a receipt or a store.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` to open Settings; the tags themselves are read with `template.edit` wherever the designer offers them. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Offered In | All, Email, SMS, MMS, E-Receipt: the channel filter. | The table. |
| The table | Tag (the key and its label), Reads From, Type, Offered In, Sample, Origin (Platform or Workspace). | |
| Add Tag, Edit, Remove | For the workspace's own tags. A platform tag is read-only here and changed by the platform team. | |

### The tag form

| Field | What it is | What it changes |
|---|---|---|
| Tag Key | The word inside the braces: lower-case letters, digits and underscores. | How the tag is typed in a template. Fixed once created. |
| Label | What the tag picker shows. | |
| Reads From | Where the value comes from at send time: a source (customer record, list upload column, campaign, run, system, receipt, store) or a static value. | |
| Data Point, Key | For a source: the data point, and for a list column or an attribute, the key that completes the path. | The value each recipient gets. |
| Static Value | The same text for everyone. | |
| Type | Text, Number, Date, True/False. | How the value is formatted. |
| Default Value | Used when the source is empty for a person. | What a person without the value sees. |
| Sample Value | Shown in previews, the designer's canvas and test sends. | |
| Offered In | The channels whose editors list the tag. | |
| Description | A line for whoever picks it. | |

## How to

**Add a tag from an upload column.** Add Tag → key `loyalty_tier`, label *Loyalty Tier* → Reads From: list upload column → Key: the column's header → Default: *Member* → Sample: *Gold* → Add. Upload lists with that column; every template can use the tag.

**A tag for one campaign's offer.** A static tag `offer_ends` with the date; change its value for the next campaign.

## What happens behind the scenes

At send time the engine fills each tag from its source: the workspace's catalogue, the list member's uploaded columns, the customer's attributes, then the default. A tag a template uses that is not in the catalogue is a finding on save. When the platform team changes a platform tag, every workspace's copy follows; a workspace tag with the same key is left alone.

## Things to know

- The coupon tags (`coupon_code`, `coupon_barcode_value`, `coupon_qr_value`) feed the designer's Barcode and QR Code blocks from list columns of the same names.
- Removing a tag does not change saved templates; they keep the token and the designer reports it as unknown.

---

# Security

**Where:** Settings → Workspace → Security.

## What this page is for

How people sign in to the workspace: whether everyone must use multi-factor authentication, single sign-on through your identity provider, and the record of every time platform support acted inside the workspace.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |
| Features | Single sign-on needs the **sso** feature. |

## The fields and controls

### Multi-Factor Authentication

| Control | What it is | What it changes |
|---|---|---|
| Require for Everyone | Everyone signs in with a code from an authenticator app. | People who have not set it up are asked to on their next sign-in, before anything else; nobody can turn their own off while it is required. Single sign-on users are covered by the identity provider. Refused until you have set it up yourself. |

### Single Sign-On (OpenID Connect)

| Field | What it is | What it changes |
|---|---|---|
| Name on the Sign-In Button | For example Okta, Microsoft, Google Workspace. | The button on the sign-in page. |
| Issuer | The https address of your OpenID Connect provider. Checked when you save. | Where sign-ins go. |
| Client ID, Client Secret | From the application registered at the provider. The secret is stored encrypted and never shown again; leave it empty to keep it. | |
| Allowed Email Domains | Only addresses on these domains may sign in; empty means any address the provider vouches for. | |
| Role for New Accounts | The role an account created on first sign-in gets. | Needed when accounts are created on first sign-in. |
| Use Single Sign-On | Shows the button. | |
| Create Accounts on First Sign-In | Otherwise only people added under Users can sign in. | |
| Require Single Sign-On | Passwords stop working for everyone except administrators, who keep theirs for the day the provider is unreachable. | |

### Support Access

| Column | What it is |
|---|---|
| When, Support Person, Acted As, Reason, Access (read-only or could change), Ended | Every support session platform staff opened into this workspace, acting as one of its users, with when it ended or that it is open now. |

## How to

**Require a second step for everyone.** Set up your own under Account Security first (the account menu), then switch Require for Everyone on. From the next sign-in everyone without it is walked through the set-up.

**Sign in with your company's identity provider.** Register CEP as an application at the provider, paste the issuer, client id and secret, add your domain, choose the role new accounts get, switch Use Single Sign-On on and try it from another browser before you Require it.

## What happens behind the scenes

The issuer's configuration is fetched when you save, so a wrong address is refused at once. A sign-in through the provider creates or matches the account by email, within the allowed domains. A support session is recorded with who, as whom, why, read-only or not, and when it ended; a banner shows while one is open.

## Things to know

- Keep one administrator with a password while single sign-on is required: it is the way in when the provider is down.
- Multi-factor authentication for yourself is under the account menu → Account Security; this page only sets the rule for the workspace.

---

# Approvals

**Where:** Settings → Workspace → Approvals.

## What this page is for

Whether a campaign needs a second person's approval before it can be published to production, and who can give it. With approvals on, a campaign's Review & Publish step asks for approval and the approvers see it under Campaigns → Awaiting Approval.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` for the switch; approving needs `campaign.approve` on a role. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Require Approval Before a Production Publish | The switch. Refused until at least one user can approve. | Production Publish answers *not approved* until an approver has approved; the pre-publish checklist gains an *Approved for production* line. |
| Who Can Approve | Every active user whose role carries campaign.approve. | Add the permission to a role under Roles to add a person here. |
| Waiting | How many campaigns wait, with a link to the list. | |

## How to

**Switch approvals on.** Roles → give campaign.approve to the approvers' role → here, switch on. From then on a Request Approval card appears on every campaign's Review & Publish step.

**Approve.** Campaigns → Awaiting Approval → open the campaign → Approve, or Send Back with a note saying what to change. The person who asked can never approve their own.

## What happens behind the scenes

Asking emails every approver; the decision goes back to the person who asked. Any change to the campaign, its lists or its targets after a request withdraws the request or the approval, with a note in the activity log, so what is approved is what is published.

## Things to know

- Test publishing never needs approval.
- Switching approvals off leaves pending requests where they are; the campaigns can simply be published.

---

# Plan & Usage

**Where:** Settings → Workspace → Plan & Usage.

## What this page is for

What the workspace's plan allows and how much of it this month has used: messages, contacts, active users, storage, deliverability tests; the messages by channel; and the invoices the platform has issued. Plans and limits are changed by the platform team; this page is the reading.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The plan | Its name and status; the month shown. | |
| Messages this month | Sent messages against the plan's limit; *Then … per 1,000* when the plan allows overage, *Hard limit* when it does not. | At a hard limit sends stop until the next month or a plan change. |
| Contacts | People in the workspace against the limit. | |
| Active users | Against the plan's limit; Users refuses a new one past it. | |
| Storage | Media and files, in GB. | |
| Deliverability tests this month | Inbox previews run against the total, with where it comes from under the meter: the plan's number plus any tests the platform team added for the month. Through your own Mailgun account, not limited. | A spent total refuses the next test until next month, or until the platform team adds tests. |
| Messages by Channel | Email, SMS, MMS this month. | |
| Invoices | Number, period, plan, amounts, status, issued and due dates. An invoice appears shortly after the end of each month. | |

## How to

**See whether a big send fits.** Compare the campaign's estimated recipients with what is left under Messages this month. A plan with overage sends and bills the extra; a hard limit stops the run when it is reached.

**Ask for more.** The platform team changes the plan or its limits; the figures here follow within the hour.

## What happens behind the scenes

Usage is rolled up hourly from the sends, the contacts and the files; the meters are read from that roll-up, so a send from a minute ago may not show yet. The invoice is raised by the platform at month end from the same figures.

## Things to know

- The Sandbox text engine is not metered: trying text campaigns on it costs nothing against the plan.
- E-receipts count as messages.

---

# Email Server

**Where:** Settings → Sending → Email Server.

## What this page is for

The workspace's own SMTP server. It carries the messages the platform sends to your people (password links, notifications, the weekly report), and, if you offer it, your campaigns. Campaign email otherwise goes through the sending engines. Until a server is entered, the platform's own server carries the platform's messages with the platform's From address.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Outgoing Email | The status line: the platform's server until you enter your own; *no mail server* when the platform has none either, and password links then have to be copied and sent by hand. | |
| Server, Port, Security | The host (for example smtp.office365.com), the port, and none, STARTTLS or SSL. | Where every message goes. |
| Username, Password | Often the full email address; empty for a server that needs no sign-in. The password is stored encrypted and never shown again; empty keeps the stored one. Many providers want an app password rather than the account's. | |
| From Address, From Name, Reply-To Address | What your people see; the address must be one the server is allowed to send as. | The From line on password links, notifications and, when offered, campaigns. |
| Offer as a Campaign Sender | Adds this server as a sending engine (SMTP) with a sender made from the From address. | Campaigns can pick that sender; the engine reports no callbacks (bounces arrive as mail at the From address). |
| Send a Test Message | To an address you type, with the saved settings. | Verifies the campaign sender when one was offered. |
| Remove | Forgets the server. | The platform's server takes over the platform's messages; the SMTP engine and its sender go. |

## How to

**Use your Microsoft 365 or Google Workspace account.** Server, port 587, STARTTLS, the mailbox's address and an app password, the From address the mailbox owns → Save → Send a Test Message to yourself.

**Send small campaigns through it.** Tick Offer as a Campaign Sender → Save → Send a Test Message, which verifies the sender. The engine appears under Sending Engines, read-only there; the sender appears in a campaign's Send From.

## What happens behind the scenes

Each message opens one connection to the server; a batch of campaign mail reuses it. A recipient the server refuses outright fails; a temporary refusal is retried. Nothing from your server is ever carried through the platform's.

## Things to know

- Mailbox providers rate-limit SMTP; for volume, a sending engine (Postal, SendGrid) is the right tool, and this server is for the platform's own messages.
- The password is write-only: to replace it, type the new one; to keep it, leave the field empty.

---

# Notifications

**Where:** Settings → Sending → Notifications.

## What this page is for

Who is told when something happens: a send completed or failed, an approval was asked for or decided, a sending engine is in trouble, a subject test chose its winner, the weekly report. Three channels: the campaign's owner by email, fixed recipient addresses, and a chat webhook (Slack, Teams, anything that takes a text message).

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Events | A row per event with a checkbox per channel: Owner by Email, Recipients by Email, Webhook. | Who hears about each event. |
| Email Addresses | Up to 20, separated by commas. | They get the events ticked under Recipients by Email. |
| Webhook URL | The chat webhook's address; *Working* once a test reached it, *Not Tested* before. | The events ticked under Webhook are posted there as a message. |
| Save | | |
| Send a Test Message | One message by every channel that is set, with the saved settings, and records when the webhook last worked. | |

### The events

| Event | When | Default channels |
|---|---|---|
| Send completed | A run finished, with sent and failed counts. | owner, webhook |
| Send failed | A run could not start, or nothing went out. | owner, recipients, webhook |
| Approval requested | Someone asked for approval. Every approver is always emailed; this adds the recipients and the webhook. | webhook |
| Approved or sent back | The decision, to the person who asked. | owner |
| Sending engine trouble | A circuit opened on an engine after repeated failures. | recipients, webhook |
| A/B winner chosen | The subject test's winner, with the two rates. | owner |
| Weekly report | Monday 08:00 in the workspace's zone, the last 7 days. | recipients |

## How to

**Get failures in a Slack channel.** Make an incoming webhook in Slack, paste its address, tick Webhook on Send failed and Sending engine trouble, Save, Send a Test Message.

**Keep marketing ops informed.** Put the shared mailbox under Email Addresses and tick Recipients by Email on the events that matter.

## What happens behind the scenes

Notifications are prepared inside the work they report on and sent after it, so a failed notification never fails a send. Email goes through the workspace's own mail server when one is entered, the platform's otherwise. An integration's Email Alerts switch under Integrations decides whether that engine's trouble reaches these channels.

## Things to know

- The campaign's owner is set on its Edit Details; a campaign without an owner has nobody to email under Owner.
- The weekly report's own recipients and schedule live under Reports.

---

# Suppressions

**Where:** Settings → Audience → Suppressions.

## What this page is for

Everyone the workspace must not send to, in one list: people who unsubscribed or replied STOP, addresses that bounced, people who complained, and addresses or numbers blocked by you. A blocked address is left out of every audience from then on, whatever list it is on. The page shows the counts by reason, lets you search, unblock where that is allowed, and import a do-not-contact list before the first campaign.

## Who can use it

| | |
|---|---|
| Permission | `campaign.view` to read; `consent.edit` to unblock and import. Settings as a whole needs `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The counts | Per reason, with this week's additions; each is a filter. | |
| Channel | All, Email, Phone. | The table. |
| Reason | Every Reason, Unsubscribed, Bounced, Complained, Blocked by You. | The table. |
| Search | An address, a number or a customer id. | |
| The table | The contact, the person behind it, the reason in words, the source (an unsubscribe link, a STOP reply, the engine's bounce, an import, a request by phone), since when. 25 a page. | |
| Unblock | Undoes a bounce or a block you made, after a confirmation. A complaint or an unsubscribe cannot be undone here: the person has to opt in again themselves. | The address is reachable again from the next run. |
| Export CSV | The filtered rows as a file. | |
| Import | Paste Addresses (one per line or comma-separated, up to 5,000) or Upload CSV (any cell that looks like an address or a number, up to 5 MB), with a Note for the consent record: a legal hold list, a request by phone. | Every address and number is blocked, matched to the person when the address is on file. The result says what was invalid and what was already blocked. |

## How to

**Import a do-not-contact list first.** Before the first upload, Import → Upload CSV → the list from your previous system → Note: *Opt-outs carried over from …* → Import. No campaign can reach them, even if a later list contains them.

**A customer asks by phone never to be emailed.** Import → Paste Addresses → the address → Note: *Request by phone, 3 Oct*.

**An address bounced wrongly.** Reason: Bounced → search → Unblock. The next run includes the person again.

## What happens behind the scenes

The list reads two records: what happened to an address or number (a hard bounce, repeated soft bounces, a complaint, a block) and what the person decided (unsubscribed, STOP). At every run the audience builder leaves out everyone on it, and the campaign's Recipients → Blocked & Unsubscribed shows the ones among that campaign's people. A ten-digit North American number pasted without a country code is read as +1.

## Things to know

- Uploading a list never adds anyone back: the suppression wins over any list membership.
- Unsubscribes and complaints are the person's decision; only they can reverse them, on the preference page or by opting in through your forms.

---

# Preference Centre

**Where:** Settings → Audience → Preference Centre.

## What this page is for

A page where a customer chooses which channels and topics they receive, reached from a link in your emails. Off by default: then only the unsubscribe link exists. Switched on, every marketing email can carry `{{preference_url}}`, campaigns are filed under topics, and a person who unticks a topic is left out of its campaigns.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. The topic a campaign is filed under is chosen with `campaign.edit` on its Content step. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Offer a Preference Centre | The switch. | Off: only the unsubscribe link; the tag resolves to it; topics and words are kept. On: the page is live and campaigns need a topic. |
| In Your Templates | The tag `{{preference_url}}` with Copy. | The person's own page at send time; the unsubscribe page while the centre is off, so an email never carries a dead link. |
| Last 30 Days | Page opened, topics unticked, unsubscribed from the page, opted in again. | |
| Topics | A table: name and description, channels, Opted Out (people who unticked it), Shown or Hidden, Edit. Add Topic opens the form. | |
| The topic form | Name (as shown on the page), Description (one line under it), Offered On (Email, Texts), Shown to Customers. Remove warns how many campaigns are filed under it. | A hidden topic stays on campaigns but not on the page. Removing a topic takes it off the page and the set-up's choices; a campaign filed under it is told at publish. |
| Page | Brand Name (blank = the workspace's), Heading, Email Description, Text Messages Description, Footer (your postal address satisfies the sender-identification rule), Privacy Notice Link (https), Let People Opt In Again, Save, Open Preview. | The words on the customer's page. With opting in again off, a switched-off channel is shown locked with the date. |

## How to

**Switch it on.** Add the topics (for example *Rewards and offers*, *New arrivals*, *Store events*), write the page's words, Save, Open Preview; then the switch. Put `{{preference_url}}` in the footer of your templates.

**File a campaign.** On the campaign's Content step, Filed Under → the topic. Needed to publish while the centre is on.

## What happens behind the scenes

The link carries a signed token naming the workspace, the person and the send; the page needs no sign-in and shows the masked address, an Email switch, a Texts switch when a mobile number is on file, a checkbox per shown topic, *Receipts and order updates* locked on, Save Preferences and *Unsubscribe from all marketing messages*. Channel changes are consent records; topic choices are kept per person, and the audience builder leaves out people who unticked the campaign's topic, counted as *Opted Out of This Topic*. A test send's link opens the page as a preview that saves nothing.

## Things to know

- The unsubscribe link stays required in marketing email whether the centre is on or off.
- While a topic has no shown entry the page offers the channels only, and campaigns need no topic.

---

# Consent Policy

**Where:** Settings → Audience → Consent Policy.

## What this page is for

How contacts come in. Every upload declares where its people agreed and the uploader confirms it in their own name; this page decides what happens to people without a consent date, whether a text list needs a text consent date for every number, whether a fresh upload must be approved before any campaign sends to it, the consent lifetime, and the sentence the uploader confirms. The send engine still decides for real at send time.

## Who can use it

| | |
|---|---|
| Permission | Read by anyone who uploads lists (the wizard shows the consequence); changed with `user.admin`. Approving lists needs `consent.edit`. |

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| People Without Consent | *Import and hold back until they confirm* (the default) or *Refuse the row*. | Hold back: a new person without a consent date is imported and left out of marketing sends as *No consent on record* until they opt in. Refuse: the row is held back at the review as *No consent date* and listed in the row-by-row report. |
| Texts Need a Consent Date | A Texts or Email-and-Texts list cannot import a number without a text consent date in the file. | Marketing texts need an express opt-in; a number without one is held back as *No text consent date*. |
| Approval Before First Send | A new upload must be approved by someone with Consent · Edit before any campaign sends to its list. | The list reads *awaiting approval*; every campaign holds its people back as *in a list awaiting approval* until Approve. |
| Consent Lifetime | How long implied consent lasts without a purchase: 12, 24 or 36 months. | Kept on the compliance record; the reminder before it lapses is still to come. |
| Attestation Wording | The sentence the uploader confirms on the Consent step, up to 300 characters; `{workspace}` becomes the workspace's name. Shown on every compliance record. | |

## How to

**Tighten before a regulated campaign.** Set People Without Consent to Refuse and Approval Before First Send on. Uploads then reach a campaign only clean and approved.

**Word the attestation for your lawyers.** Save Wording with the sentence they gave you; the Consent step shows it from the next upload.

## What happens behind the scenes

The declaration (basis, where it was collected, who attested, when) is recorded on the upload and on every consent written from the file. The list's compliance record shows the source, every upload with its declaration, the approval, the policy as it stands today and today's consent by channel, rebuilt on every read.

## Things to know

- Changing the policy changes future uploads only; lists already imported keep what was recorded for them.
- A bought or rented list is never an allowed basis; the wizard refuses it.

---

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

---

# API Keys

**Where:** Settings → Integrations → API Keys.

## What this page is for

Keys for systems that call CEP's API: the point of sale sending receipts, a web shop, a data warehouse. Each key has a name, the scopes it may use, optionally the addresses it may call from and an expiry. The key is shown once, when it is created.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |
| Features | **api_access**. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | Key (name and the visible prefix), Scopes, Allowed From, Status (Active, Expired, Revoked), Last Used, Expires. | |
| New API Key | The form below; then *Copy the Key Now*, shown once. | |
| Revoke | Stops the key at once. | The caller gets 401 from the next call. |

### The form

| Field | What it is | What it changes |
|---|---|---|
| Name | The system that will use it, for example *POS integration*. | |
| Scopes | Give the key only what it needs: `receipts:send` (the point of sale and the web shop), `orders:ingest` (the shop's orders, for attribution), `events:ingest` (the shop's and the loyalty system's events, for journeys), `coupons:issue` (C360 answering journeys' coupon requests), `lists:write`, `scores:write`, `customers:read`, `consent:write`. | What the key may call. |
| Allowed IP Addresses | Optional addresses or CIDR ranges. Empty means any address. | A call from elsewhere is refused. |
| Expires | Optional, your local time. | The key stops at that moment. |

## How to

**A key for the point of sale.** New API Key → *POS integration* → tick `receipts:send` → the stores' outbound address under Allowed IP Addresses → Create → copy the key into the register software now; it is never shown again. The POS Receipts page says which headers to send it in.

**Rotate a key.** Create the new one, switch the caller over, Revoke the old one. The call log shows which key each call used.

## What happens behind the scenes

Only a hash of the key is stored; the prefix identifies it in the log. Each key has its own pace limit, and every answer carries the rate-limit headers so the caller can slow itself down. A revoked or expired key stops the caller at once.

## Things to know

- A key belongs to this workspace only; the caller also names the workspace with the X-Tenant header.
- Keys are never written to the audit trail or an export.

---

# POS Receipts

**Where:** Settings → Integrations → POS Receipts.

## What this page is for

E-receipts from the point of sale: which e-receipt campaign renders them, what to tell the register software, the stores the transactions come from, and the trail of what was received. The point of sale posts each transaction as a TransactionTree (TTDR 3.2.2) document; CEP validates it, renders the receipt on the campaign's template and sends it through the campaign's sender and engine. Nothing about the transaction or the customer is kept, only the trail.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` to open Settings; the trail is read with `campaign.view`. |
| Features | **ereceipt**; text receipts need **sms** as well. |

## The fields and controls

### E-Receipt Campaign

| Field | What it is | What it changes |
|---|---|---|
| Email Receipt | The published e-receipt campaign that renders the email receipt. Needed when more than one is published. | Sent when the transaction's EntryType asks for email. |
| Returns and Exchanges | Optional: another campaign for refunds. Empty uses the same campaign. | A return renders as a refund: negative amounts, the tender as a refund. |
| Text Receipt | An e-receipt campaign on the SMS channel. | Sent when EntryType asks for a text. Empty: no text receipts. |
| Phone Numbers Are From | US, CA or none. | A ten-digit number from a register is read with +1; numbers sent with a country code are used as sent. |

### Tell the Point of Sale

| Item | What it is |
|---|---|
| Endpoint | The address to POST to, as application/xml or the form field XmlInput, with Copy. |
| Headers | `X-Tenant-Key` with the workspace code and `accessTokenKey` with the API key, or `Authorization: Bearer`. |
| API Key | One with the scope `receipts:send`, made under API Keys. |
| Answers | The XML answers: S100 email receipt sent, S101 accepted but no email address, S102 already received, S103 text receipt sent, S104 printed with no e-receipt, S105 text asked for but not sent, and the E-codes for refused documents. |
| What triggers a receipt | The transaction's EntryType: EMAIL, BOTH, ALL and every value naming EMAIL send the email; SMS values send the text; PRINT, NOPRINT, PUSH and NONE send nothing. |

### Stores

| Control | What it is | What it changes |
|---|---|---|
| The table | The stores: number, name, address, return policy, In Use. | The store's name and address on the receipt; the return policy in its Returns & support section. |
| Add Store, Edit | Number, name, address lines, phone, return policy, In Use. | |
| Import CSV | A file of stores. | |

### Received from the Point of Sale

| Control | What it is |
|---|---|
| Answer, Transaction ID | Filters by the code answered and the transaction number. |
| The table | Every transaction received: when, store, transaction, what was answered, the receipt's status. A row opens the call in the log with the document as received, masked. |

## How to

**Connect a register.** API Keys → a key with `receipts:send` → here, copy the endpoint and give the register software the endpoint, the two headers and the key → publish an e-receipt campaign → choose it under Email Receipt → add the stores → run one test transaction and find it under Received.

**A store prints when it should email.** Received → Answer: S104. The register sends an EntryType without EMAIL; the store's register settings are the fix.

## What happens behind the scenes

The document is checked against the TTDR schema; the merchant, store, register, transaction number and date make the transaction unique, so a register that retries gets S102 and nothing is sent twice. The receipt is rendered with the receipt, store and transaction tags and the campaign's receipt layout, sent through the campaign's engine, recorded as a message under the campaign's run of the day with callbacks like any other, and answered in the same call. A text receipt goes the same way through the text engine.

## Things to know

- A paused POS integration answers E503 to every register; nothing is queued.
- A receipt to a blocked address is refused with its reason in the answer; the trail keeps it.
- With Count Store Sales on under Settings → Attribution, each transaction also becomes an order credited to a campaign: the amount without tax, the customer, the store and its promotion codes. Off (the default), nothing about a transaction is kept but the trail.

---

# Account Security

**Where:** The account menu at the top right → Account Security.

## What this page is for

Your own second step when you sign in: a six-digit code from an authenticator app on your phone. Set it up here, keep the recovery codes, and turn it off when it is not required.

## Who can use it

| | |
|---|---|
| Permission | Everyone, for their own account. When Settings → Security requires it for everyone, it cannot be turned off. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Turn On | Shows a QR code to scan with Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar, and the key to type when scanning is not possible. | |
| Code | The six digits the app shows, to confirm. | Multi-factor authentication is on from the next sign-in. |
| Recovery codes | Ten one-time codes shown once, to sign in when the phone is lost. Store them somewhere safe. | |
| The status | Since when, and how many recovery codes are left; a warning when two or fewer remain. | |
| Turn Off | With the current code. Refused while the workspace requires it. | To get a new set of recovery codes, turn it off and on again. |

## How to

**Set it up.** Turn On → scan → type the code → store the recovery codes → Done. Sign out and in again to see the second step.

**Lost the phone.** Sign in with a recovery code, then turn it off and on again with the new phone.

## What happens behind the scenes

The code is time-based (TOTP); the secret is stored encrypted. A recovery code works once. When the workspace requires it, a user without it is walked through this set-up on their next sign-in before anything else; single sign-on users are covered by the identity provider instead.

## Things to know

- Nobody can set it up for you, and support cannot read your codes; a lost phone and lost recovery codes mean an administrator sends a new password link and you set it up afresh.

---

# Attribution

**Where:** Settings → Integrations → Attribution.

## What is attribution

Attribution answers one question: **which campaign earned this order?** The shop sends CEP its orders (and the point of sale its store sales, if you choose). CEP matches each order to the customer, looks back at what it sent that customer, and credits the order to one campaign. Adding those orders up gives each campaign its **revenue**, and with its cost, its **ROI**.

CEP credits an order to the first of these that applies:

1. **A campaign code.** The order carries the campaign's code (for example CMP-2026-0042), as `campaign_code` or as one of its coupon codes. That campaign gets it, whatever else happened.
2. **The latest click** on a campaign's link by that customer within the **Click Window** (7 days by default).
3. **The latest open** of a marketing email within the **Open Window** (1 day by default).
4. **The latest text** delivered to that customer within the **Text Window** (1 day by default). Text links are not tracked yet, so delivery stands in for a click.

One campaign gets the whole amount (this is called *last touch*). An order that matches none of these is **Not Credited**, and the page says why. A refund follows its original order and takes the money back from the same campaign.

Until attribution is on, every revenue figure in CEP reads *Not Set Up*: Home's Attributed Revenue, Campaign ROI, Marketing Performance and Top Campaigns, each campaign's revenue against its target, the Reports revenue column, and the e-receipts' Revenue from Receipt Offers.

## Who can use it

| | |
|---|---|
| Permission | Read with `report.view`; changed with `user.admin`. The shop sends orders with an API key that has the scope `orders:ingest`. |

## How to configure attribution

**1. Make a key for the shop.** Settings → API Keys → New Key, with the scope `orders:ingest`. Copy it: it is shown once.

**2. Switch it on.** Settings → Attribution → **Attribution** on. From now on the shop's orders are accepted (while it is off they are refused with 409), and every campaign that has ever sent gets figures within five minutes, 0 until its first order.

**3. Choose the windows.** Each saves as you change it.

| Setting | Choices | Means |
|---|---|---|
| Click Window | 1, 3, 7, 14 or 30 days | How long after a click the click still earns an order. |
| Open Window | Opens Do Not Count, 1, 2, 3 or 7 days | How long an open of a marketing email earns an order when there was no click. Scanner opens and receipts never count. |
| Text Window | Texts Do Not Count, 1, 2, 3 or 7 days | How long a delivered marketing text earns an order when there was no click or open. |

**4. Count store sales** (shown when the workspace has POS Receipts). Switch **Count Store Sales** on and every transaction the point of sale posts also becomes an order: the amount without tax and shipping, the customer, the store and its promotion codes. Returns become refunds; employee sales are left out.

**5. Enter the send costs.** **Send Costs**: what 1,000 delivered emails and 1,000 delivered texts cost you, then **Save Costs**. A campaign's cost is then its delivered messages at these rates plus its offer cost, and ROI, contribution and cost per conversion follow. Left empty, ROI uses each campaign's planned cost.

**6. Connect the shop.** Give the shop's developer the endpoint, the headers and the example under **Send Orders from the Shop**:

```
POST /api/v1/orders/
Authorization: Bearer <the API key>
X-Tenant: <the workspace code>

{"order_id": "W-100235", "amount": 129.50, "currency": "USD",
 "email": "jane@example.com", "ordered_at": "2026-10-04T14:30:00Z",
 "coupon_codes": ["FALL20"], "channel": "ONLINE"}
```

Each order needs `order_id` and `amount` (revenue to count, 0 or more) and names the customer by `party_id`, `email` or `phone`. Optional: `ordered_at` (defaults to now), `currency`, `channel` (ONLINE, STORE, APP, PHONE or OTHER), `campaign_code`, `coupon_codes`, `store_number`, `items`. A refund is `"type": "REFUND"` with the positive amount and `original_order_id`. Up to 500 at once as `{"orders": [...]}`.

## How to use it in real time

### What happens to an order, minute by minute

| When | What you see |
|---|---|
| The shop posts the order | The answer says Accepted, Duplicate (the same order was already received; it counts once) or Rejected with the field at fault. Every call is in Settings → Integrations' call log. |
| Within a minute | The order is in **Latest Orders** as **Waiting**. It also raises a Purchase event (and First Purchase for a customer's first order), so a journey that starts on a purchase enrols the customer within a minute. |
| One to five minutes later | The attribute-orders job credits it: **Credited** with the campaign and how (Campaign Code, Click, Open, Text), or **Not Credited** with the reason. It waits a minute after an order arrives so a click still on its way from the sending engine is counted. |
| Within five minutes | The campaign's figures are rewritten: revenue net of refunds, orders, buyers, cost, contribution, ROI. Home, the campaign's page and Reports show them on their next refresh. |

### Check that it works: one test order

1. Pick a customer you emailed recently who clicked the email (your own test address is best).
2. Post one order for them with the shop's key, using their email address and a small amount, for example with Postman or curl.
3. Within a minute it is in **Latest Orders** as Waiting; within five it reads **Credited** with that campaign and **Click**.
4. Open the campaign: its revenue now includes the amount. Home's Attributed Revenue includes it too.
5. Post the same order again: the answer says Duplicate, and nothing is counted twice. To remove the test amount, post a refund for it (`"type": "REFUND"`, `original_order_id`).

### Watch the orders as they come in

**Latest Orders** shows the newest 50: when, the order, the amount, and the campaign credited with how, or why none. Filter **State** by **Credited**, **Not Credited** or **Waiting**; **Search** by order, email or campaign.

**Last 30 Days** sums them up: orders, revenue net of refunds, the revenue credited and the share of orders credited, orders not credited and waiting, credit by Campaign Code, Click, Open and Text, and the **Top Campaigns**.

### Read the results

| Where | What it shows |
|---|---|
| Home | Attributed Revenue, Campaign ROI (revenue per $1 spent), Marketing Performance (attributed revenue and campaign cost per day or week, with the target pace), Top Campaigns. |
| A campaign's page | Its Revenue and Conversions, against the targets set in its setup. |
| Reports | The revenue column per campaign. |
| E-Receipts on Home | Revenue from Receipt Offers (store sales credited to e-receipt campaigns). |
| Journeys | Purchase and First Purchase events start journeys and answer a Condition's "Made a Purchase". |

### Day-to-day tasks

**Credit a promotion outright.** Give the campaign's code (on the campaign's page) to the shop as the coupon, or have the shop send it as `campaign_code`. An order carrying it is credited to that campaign whatever the customer clicked.

**Find out why an order earned nothing.** Latest Orders → State: **Not Credited**. The reason is under each order: no customer CEP knows, no click, open or text within the windows, or a refund whose order was not credited.

**Change a window.** It applies to new orders. **Recalculate** (in Last 30 Days) judges the last 400 days of orders again under the current windows and rewrites every campaign's figures.

**Stop counting.** Switch Attribution off. New orders are refused (409) and revenue reads *Not Set Up* again; orders already received are kept.

## What happens behind the scenes

The attribute-orders job runs every five minutes. It finds the customer: the customer id, or whoever CEP emailed at the address or texted at the number in the last 120 days. It credits the order as above, then writes each campaign's actuals: revenue net of refunds, orders, buyers (distinct people, plus orders without a person), delivery cost, contribution (revenue minus cost), ROI (revenue over cost), revenue per delivered message and cost per buyer.

## Things to know

- Last touch is easy to explain and to check against the shop, but it gives no credit to the campaigns earlier in a customer's path.
- Revenue counts on the campaign whenever the order happens, so a campaign's figures grow for as long as its clicks are in the window.
- CEP keeps the amount, the customer, the store and the codes of an order, not its items or payment.
- An order for a customer CEP never emailed or texted, and with no customer id it knows, is Not Credited: there is nobody to match.

---

# Journeys

**Where:** Journeys, in the main menu; a new one also from the **+ Journey** button on Home. A journey's own page opens from the list.

## What is a journey

A journey is an automated path that each customer walks on their own. You draw it once: **who enters**, then the **steps** they go through (wait, check something, send an email or a text, issue a coupon, change their tier or segment) and where the path **ends**. From then on CEP runs it for every customer who qualifies, one at a time, at their own pace.

A campaign sends one message to a list at one moment. A journey keeps working: a customer who abandons a cart this afternoon gets the reminder an hour later, a customer whose birthday is next week gets the reward seven days before it, and a new loyalty member gets the welcome series over their first two weeks, without anyone pressing Send.

Typical retail journeys: Welcome Series, Abandoned Cart Recovery, Post-Purchase Thank You & Review, First to Second Purchase, Win-Back Lapsed Customers, Birthday Reward, Loyalty Tier Upgrade, Coupon Expiry Reminder, Membership Anniversary and Re-Engagement / Sunset. Each is offered as a starter you can copy.

### The parts of a journey

| Part | What it is |
|---|---|
| Entry | What makes a customer enter: membership of a **customer list**, an **event** (a purchase, an abandoned cart, No Response …), a **date or time** (a schedule, or a date on the customer's record such as a birthday), joining or leaving a **segment**, or an **attribute change** (loyalty tier, preferences, address). |
| Population | **Fixed** (who qualifies at launch, then closed), **Continuously Qualifying** or **Event Triggered** (keeps letting newcomers in). |
| Re-entry | Whether the same customer can go through again: **Never**, **After X Days**, or **Every Qualifying Event**. Nobody is ever in the same journey twice at once. |
| Steps | Wait, Condition (Yes / No), Email, SMS / MMS, Issue Coupon, Update Loyalty Tier, Update Segment, Exit Journey. |
| Goal | A customer who reaches an **Exit Journey** step counts as **Goal Converted**. |
| Version | Every change to a published journey is a new version; one version is live at a time. |

### The statuses

| Status | Means |
|---|---|
| Draft | Being built. Nobody enters. |
| Test | The test run went out; waiting for approval. |
| Approved | Approved to go live at a set time; until then the schedule can be cancelled. |
| Active | Live: customers enter and move along. |
| Paused | Nobody new enters and nobody moves; everyone waits where they are until it resumes. |
| Archived | Ended for good. Its figures and history stay readable. |

## How to set up journeys

Do this once for the workspace, before the first journey.

| Permission | Allows |
|---|---|
| Journeys · View (`journey.view`) | See journeys, their steps and results. |
| Journeys · Create and Edit (`journey.edit`) | Create, build, test publish, duplicate, and archive a journey that is not live. |
| Journeys · Activate (`journey.activate`) | Approve (now or later), cancel a schedule, pause, resume, and archive a live journey. |

1. **Give people the rights** above in Settings → Roles. Workspace Admin has all three and Analyst has View. Campaign Manager has none by default: add them if your campaign team builds journeys. The workspace needs the Journeys feature (the Journeys menu item shows only when it is on); the platform team switches it on or off on the workspace's page in the back-office.
2. **Sending.** An email engine with a verified default sender (Settings → Sending Engines), and a texting engine if journeys send texts.
3. **Templates.** A **published** template for every message a journey sends. A draft template fails the readiness check.
4. **A test list.** A contact list marked as a test list, holding your own team, for the test run.
5. **What journeys react to.**
   - **Purchases:** switch on Attribution and have the shop send its orders (see Attribution). Every order then raises a Purchase event, and a customer's first one also a First Purchase.
   - **Other events** (abandoned cart, birthday, tier change, address change …): the shop, the loyalty system and C360 send them to CEP with an API key that has the scope `events:ingest` (Settings → API Keys, then Settings → Events for the address and an example).
   - **Coupons:** the Issue Coupon step asks C360 for the coupon. C360 needs an API key with the scope `coupons:issue` to collect and answer those requests.
   - **Dates on customer records** (for Date / Time entries): C360 sends them as custom attributes, for example `birth_date`.
   - Email opens and clicks, text replies, No Response, preference-centre saves and tier changes made by a journey need nothing: CEP raises them itself.

## How to build a new journey

### 1. Start

On the Journeys page, choose **Create Journey**, or **Start from Scratch** in the blue Journey Templates panel, or pick a starter there (**View More** shows all ten). Clicking a starter shows a read-only preview of its steps; **Copy This Template** opens the set-up already filled in. The starter itself never changes.

### 2. Set up: name and entry (step 1 of 2)

| Field | What to choose |
|---|---|
| Journey Name | A name unique in the workspace, for example *Welcome Series — New Loyalty Members*. |
| What Qualifies a Customer to Enter This Journey? | **Customer List**, **Event**, **Date / Time** or **Segment or Customer Change**. |
| Specific Trigger | The list, the event (Purchase, Abandoned Cart, Birthday, No Response …), the schedule, or the change (Enters Segment, Exits Segment, Loyalty Tier, Preference Update, Address Change, Customer Attribute Matches). Enters / Exits Segment also asks which **Segment**. |
| Customer Record Matches | For **Customer Attribute Matches**: the conditions a customer's record must meet to enter (see *Conditions* below), for example Customer Status is New. Everyone whose record matches enters, each once; with Every Qualifying Event, again when their record changes. A grey line says how many would enter now. |
| Only Customers Where (Optional) | Conditions that narrow any trigger: a customer the trigger would admit enters only if their record matches, for example Country is United States and Email Consent is Opted In. |
| Description (Optional) | What the journey is for; shown on its page. |

**Date / Time entries** add their own fields under Specific Trigger, and a grey line reads the result back ("Every Monday at 9:00 AM, the members of VIP Customers enter"):

| Specific Trigger | Asks for | Who enters, and when |
|---|---|---|
| Daily | At (a time); Who Enters (a customer list or a segment) | The members, every day at that time. |
| Weekly | On (one or more weekdays); At; Who Enters | The members, on those days at that time. |
| Monthly | Day of the Month (1 to 28, or Last Day); At; Who Enters | The members, once a month. |
| On a Specific Date | Date; At; Who Enters | The members, once. |
| On a Date Attribute | Date (a date on the customer's record, with how many customers have it); When (on the day, or 1 to 90 days before or after); At; Repeat (Every Year or Once); Only Customers In (optional) | Each customer on their own date. Every Year matches the day and month (birthdays, anniversaries; 29 February counts on 28 February in other years); Once matches the full date (a renewal date). |

Times are the workspace's time zone. Each moment fires once: a journey that goes live after this week's moment waits for the next one.

Choose **Next**.

### 3. Set up: population and re-entry (step 2 of 2)

| Field | What to choose |
|---|---|
| Population | **Fixed**: who qualifies on the first pass after go-live, then nobody new. **Continuously Qualifying**: new matches keep joining. **Event Triggered**: customers enter the moment the event arrives. |
| Re-Entry | **Never**: once through, never again. **After X Days**: eligible again after the number of days you enter in **Days Before Re-Entry**, counted from when they finished or exited. **Every Qualifying Event** (offered when a starter uses it): again each time the trigger happens. |

Choose **Create Journey**. The journey is created as a Draft and the builder opens.

### 4. Build the steps

The canvas shows the Entry at the top. Use the **+** between steps to add one; click a step to set it up in the panel on the right, then **Save Step**. A step still to set up is marked **Needs Setup**. The step's **⋮** menu duplicates or deletes it. **Journey Settings** on the left shows the entry, population and re-entry; **Edit Setup** there reopens the set-up.

| Step | What it does |
|---|---|
| Wait | **For a Duration**: minutes, hours, days or weeks. **Until a Time of Day**: the customer continues at that time, in their own time zone (the `timezone` attribute on their record, from C360 or the upload's Time zone column) or the workspace's, on any day or only on the days you pick. **Until a Date on the Record**: a date on the customer's record (a renewal date, a birthday) with an offset ("3 days before") and a time; choose whether a customer whose date has passed, or who has none, continues at once or leaves the journey (exited early, with the reason). |
| Condition | Splits into Yes and No on conditions you build (see *Conditions* below): the customer's record, this journey's messages and earlier Conditions, events, lists and segments. Optionally give the step a name, shown on its card. **Match on Entry** under the builder says how many customers in the journey would answer Yes right now. |
| Email, SMS / MMS | Sends a published template. |
| Issue Coupon | Asks C360 for a coupon for the customer. CEP makes no codes: C360 collects the request, issues the coupon and marks it done (Settings → Events → Coupon Requests for C360). The step also raises a Coupon Issue event. |
| Update Loyalty Tier | Sets the customer's tier and raises a Loyalty Tier Change event. |
| Update Segment | Adds the customer to a segment, or removes them. |
| Exit Journey | Ends the path; the customer counts as Goal Converted. End every path with one. |

**Save Draft** (top right) keeps your work; nothing saves on its own. When every step is set up, choose **Continue to Test Publish**.

#### Conditions

The same builder writes a Condition step, the Customer Attribute Matches trigger and the Only Customers Where filters. Each row is a field, how to compare it, and a value; **All** means every row must hold, **Any** that one is enough; **Add Group** nests one All / Any group inside the rule. A sentence under the builder reads the whole condition back. A rule holds at most 20 conditions.

| Fields | Compared with |
|---|---|
| Customer: first name, last name, email address, phone number, country, state, city, postal code, source system, record updated, last purchase date, number of purchases, and every custom attribute on the records (with its values to pick from when there are few) | Text: is, is not, is any of, is none of, contains, does not contain, starts with, is set, is not set. Numbers: equals, does not equal, is at least, is at most, is between. Dates: is within the last N days, is more than N days ago, is before, is after, is between. A custom attribute is read as text, a number or a date by the comparison you choose. |
| This Journey (Condition steps only): each Email or SMS step, any message of the journey, each other Condition | A message: was sent, was delivered, was opened, was clicked, bounced, was delivered and not opened, was not sent. A Condition: answered Yes, answered No. Only sends after the customer entered count. |
| Events: the types seen in the last 90 days and the standard ones, or any type you name | Happened, did not happen; optionally within the last N days (otherwise since the customer entered the journey, or ever at entry), and filters on the event's own data (store is Lakeside, amount is at least 100). |
| Lists and segments | Is in, is not in. |

### 5. Test publish

Choose the **Test Population**: a **Random Sample of Live Audience** (up to 200 customers who would enter now) or a **Specific Test List**. Four **Readiness Checks** must pass:

| Check | Passes when |
|---|---|
| Entry rules configured | The journey has a complete entry. |
| All canvas steps configured | Every step has its settings and every path ends. |
| Templates ready | Every message step's template is published. |
| Governance rules satisfied | Always passes; it lists the frequency caps that apply ("Emails: at most 3 in 7 days") and that texts wait out quiet hours. A customer over a cap is held back, not sent. |

**Run Test Publish**, then **Send Test**. The test **sends real messages** to that population (Waits are skipped), so use the test list. The results show who got what, and how many were held back and why. Test customers leave the journey when the test ends and can still enter it for real later.

### 6. Approve and go live

**Approve & Activate →** (needs Activate). Choose **Activate Immediately** or **Schedule for Later** (a date and a time), then **Activate Journey** or **Schedule Journey**. A scheduled journey reads *Approved* until its time; **Cancel Schedule** on its page takes it back to Test.

From then on CEP enrols qualifying customers every minute. Watch them arrive on the journey's page.

## How to edit a journey

**A draft or tested journey.** **Edit Journey** on its page opens the builder on the same version. Change steps, **Save Draft**, and run Test Publish again before approving.

**The entry, population or re-entry.** In the builder, **Edit Setup** (or **Back to Setup**). On a draft everything can change. On a live journey the entry can change (as part of a new version); population and re-entry stay as they are, because they belong to the journey.

**A live journey (a new version).**
1. **Edit Journey.** The builder says the version is live. Make your changes and **Save Draft**: they are saved as the next version, and the live version keeps running untouched.
2. On the journey's page a notice says the new version is a draft; **Test Publish Version N** opens its test. Test customers already inside the live version are skipped.
3. Approve it. **Now**: new customers enter the new version at once; customers already inside finish the version they started. **Later**: the live version keeps running until that time, the page shows the date, and **Cancel Schedule** keeps the live version and leaves the new one tested, to approve again. A paused journey's new version keeps the journey paused until you resume it.

The **Versions** card lists every version with its status; the running one is tagged **Live**, a waiting one **Scheduled**.

**Goal and Exit Criteria.** On the journey's page, in Setup, the pencil beside each note edits it in place; **Save** keeps it.

**Pause, resume, end or copy.**
- **Pause Journey**: nobody new enters and nobody moves; **Resume Journey** carries on where everyone was.
- **Archive Journey**, then confirm: nobody new enters, everyone still inside leaves (counted as exited), its versions are retired and any scheduled start is dropped. It can't be undone. Archiving a live, paused or scheduled journey needs Activate.
- **Duplicate**: a new draft copy of the journey, to start again or try a variant.

## The journey's page

| Part | What it shows |
|---|---|
| Header | Status, trigger, channels, and the actions your rights allow. |
| Notices | Draft, paused, scheduled, or a new version waiting for its test or approval. |
| Performance | Enrolled, In Journey, Goal Converted and Exited Early, with the weekly Enrollment Over Time. A Draft shows dashes. |
| Setup | The trigger, Goal, Exit Criteria, re-entry, and the audience: source lists, eligible pool, enrolment rate. |
| Versions | Every version, newest first, with its status and when it went live. |
| Generated Campaigns | Each message step sends through a campaign, one per step per day. Open one to see its recipients and results. |
| Activity | Who created, tested, approved, paused or archived it, and when. |

## What happens behind the scenes

Four jobs run journeys. Every minute: **enroll-journey-customers** enters the customers who meet a live journey's entry (events of the last seven days at most, up to 5,000 per journey per pass; Date / Time schedules whose moment has come); **advance-journey-customers** moves those whose next step is due; **activate-scheduled-journeys** takes approved journeys live when their time comes. Nightly, **rollup-journey-analytics** writes the Performance figures.

Only customers in the customer records enter, since a message to someone unknown could never go out. Message steps send through the normal send engine, so consent, suppressions, the preference centre, frequency caps and quiet hours all apply as they do to campaigns.

## Things to know

- **No Response** means a customer sent at least 3 marketing emails in the last 30 days who opened, clicked and replied to none of them (security scanners left out). CEP raises it at most once in 30 days per customer, while a live journey starts from it.
- Attribute changes enter on events: **Loyalty Tier** on a Loyalty Tier Change (from the Update Loyalty Tier step, or sent by the loyalty system), **Preference Update** on a preference-centre save that changed something, **Address Change** on the event C360 sends.
- The dates for **On a Date Attribute** come from customer records' custom attributes holding a date (YYYY-MM-DD); CEP has no birthday field of its own. If no record holds a date yet, the Date list says so.
- A Fixed journey is closed to newcomers after its first pass, even if more customers would qualify later.
- A customer's time zone is the `timezone` custom attribute on their record, an IANA name such as America/Chicago; C360 can send it, and the upload template has a Time zone column. A record without one, or with a name CEP does not know, waits in the workspace's time zone. Test Publish skips every wait.
- A Condition saved before the builder (made a purchase, opened an email, and so on) keeps working as it was; opening it shows the same check as a rule, which is saved in the new form when you save the step.
- The Split step (more than two paths) is not offered; use Conditions.
- Saving your own journey as a template is not offered; Duplicate copies a journey within the workspace.
- Events are explained in **Events** (Settings → Events), purchases in **Attribution**.

---

# Events

**Where:** Settings → Integrations → Events.

## What this page is for

What happened to a customer: a purchase, an abandoned cart, a birthday, a tier change. The shop and the loyalty system send events to CEP, and CEP raises some itself. A journey whose entry is an event enrols the customer within a minute, and a Condition step can check for one. This page shows what arrived, how to send events, and the coupon requests journeys leave for C360.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. The shop and the loyalty system send events with an API key that has the scope `events:ingest`; C360 reads and answers coupon requests with a key that has `coupons:issue`. The workspace needs the Journeys feature; without it events are refused. |

## The fields and controls

| Part | What it shows |
|---|---|
| Last 7 Days | How many events arrived, by type, and when the last one came. Events naming a customer CEP does not have yet are counted separately: they enter journeys once the customer arrives from C360, within seven days of the event. |
| Raised by CEP Itself | **Purchase** and **First Purchase** from every order Attribution receives (and every store sale, when Attribution counts them); **Coupon Issue** from every Issue Coupon step; **Loyalty Tier Change** from every Update Loyalty Tier step that changes the tier; **Preference Update** from every preference-centre save that changes a channel or a topic; **No Response** for lapsed engagers (below); **Email Open/Click** and **SMS Response**, read from CEP's own tracking (security scanners left out). These need nothing sent. |
| Send Events | The endpoint, the headers, the key's scope and how many keys have it, and one event as an example. |
| Coupon Requests for C360 | How many requests are waiting, issued and failed, and how C360 reads and answers them. |
| Latest Events | The newest 50 events, sent or raised by CEP: when it arrived, the event and its id, the customer, the source and when it happened. Filter by type; search by customer, event id or source. Opens, clicks and text replies are not listed here. |

## The event types

Customer Creation (`CUSTOMER_CREATED`), Welcome (`WELCOME`), Birthday (`BIRTHDAY`), Anniversary (`ANNIVERSARY`), Purchase (`PURCHASE`), First Purchase (`FIRST_PURCHASE`), Category Purchase (`CATEGORY_PURCHASE`), Abandoned Cart (`CART_ABANDON`), Coupon Issue (`COUPON_ISSUED`), Coupon Redemption (`COUPON_REDEEMED`), Segment Inception (`SEGMENT_INCEPTION`), Segment Change (`SEGMENT_CHANGE`), Loyalty Tier Change (`LOYALTY_TIER_CHANGE`), Preference Update (`PREFERENCE_UPDATE`), Address Change (`ADDRESS_CHANGE`), No Response (`NO_RESPONSE`), Email Open/Click (`EMAIL_ENGAGEMENT`) and SMS Response (`SMS_RESPONSE`). Any other name in capitals and underscores (for example `STORE_VISIT`) is accepted too.

A journey's **Attribute Change** entry reads these: Loyalty Tier on `LOYALTY_TIER_CHANGE`, Preference Update on `PREFERENCE_UPDATE`, Address Change on `ADDRESS_CHANGE`. CEP does not keep a history of customer records, so the loyalty system sends the tier changes it makes, and C360 sends `ADDRESS_CHANGE` when an address changes (the new address in `payload`).

**No Response** is raised by CEP for a customer sent at least 3 marketing emails (not receipts) in the last 30 days who opened, clicked and replied to none of them, security scanners left out. One per customer in 30 days, and only while a live journey starts from it (checked every 15 minutes).

## How to

**Connect the shop or the loyalty system.**
1. Settings → API Keys → New Key, with the scope `events:ingest`. Copy the key; it is shown once.
2. Give the developer the endpoint, the key and the example from Send Events.
3. Each event needs `event_type` and the customer by `party_id`, `email` or `phone` (an email or number must match a customer). Add `event_id` so an event sent twice counts once; `occurred_at` defaults to now; `payload` holds the details (for example the cart's value).
4. The first events appear in Latest Events within a minute.

**Let C360 fulfil coupons.**
1. A key with the scope `coupons:issue`.
2. C360 calls `GET /api/v1/coupon-issuances/` for the waiting requests (the customer, the coupon, the journey).
3. For each, it issues the coupon and calls `PATCH /api/v1/coupon-issuances/<id>/` with `{"status": "ISSUED", "external_code": "…"}`, or `"FAILED"` with a `note`.

**Check that an abandoned-cart journey will fire.** Latest Events → Type: Abandoned Cart. If nothing is there, the shop is not sending; if the customer reads *Not in the customer records yet*, the customer has not arrived from C360.

## What happens behind the scenes

Events arrive at `POST /api/v1/events/`, one at a time or up to 500 as `{"events": [...]}`. Each comes back Accepted, Duplicate (the same `event_id` from the same source was already received) or Rejected with the reason (an unknown type format, no customer, an email or number that matches nobody, a time more than a day ahead or more than 400 days back). A call where every event is rejected answers 400. Every call is in Settings → Integrations' call log.

The enrol job reads events every minute. An event counts for a journey that was live when it happened, at most seven days back.

## Things to know

- CEP keeps the event's type, customer, time, source, id and payload (up to 8,000 characters), not more.
- CEP never makes coupon codes; C360 does.
