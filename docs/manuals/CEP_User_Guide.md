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
- Sending Engines and Senders
  - What this page is for
  - Who can use it
  - The fields and controls
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

A new workspace begins at **Settings → Set-Up**: seven steps, each opening the page that does it, read from the workspace so the page always knows what is done. The chapters for those pages are the ones to read first: Users and Roles, Sending Engines, Suppressions, Contact Lists, Notifications and Approvals.

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
| Set Up Your Workspace | For administrators until the workspace is ready: how many of the seven set-up steps are done and what comes next. | Continue Set-Up opens Settings → Set-Up. Hide Until Later on that page hides the card. |

### Marketing Performance

| Control | What it is | What it changes |
|---|---|---|
| Campaigns | A searchable pick of campaigns. Empty means every campaign. | Every card below reads only those campaigns. One campaign picked turns the page into that campaign's own picture. |
| Channel | All Channels, Email, SMS, MMS. | Every card below. Open Rate reads *not tracked* for texts, which have no opens. |
| Period | Last 7, 30 or 90 Days. | Every card below, and the comparison: each figure is shown against the same length of time before it. |
| Delivered | Messages delivered in the period, with the change against the period before. | |
| Open Rate | Opens over delivered, email only; the change in points. | |
| Click Rate | Clicks over delivered; the change in points. | |
| Conversions | Conversions attributed to the campaigns, with the share of clicks that converted. | Reads 0 until the attribution feed fills the campaigns' actuals. |
| Attributed Revenue | Revenue attributed to the campaigns, against the sum of their revenue targets when they have one. | *Not set up* until attribution is in place; Set Up leads there for administrators. |
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
- Revenue, conversions and ROI depend on the attribution feed that fills each campaign's actuals. Until it runs they read zero or *not set up*.
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
| Match Your Columns | One choice per column of the file | What each column means: Email, Mobile number, First name, Last name, Postal code, Loyalty ID, Loyalty tier, Last order date, Email consent date, Text consent date, or *keep as a custom value*. CEP guesses from the headers; confirm or correct. | The required column must be matched. A consent date column becomes an opt-in for people CEP has no answer for. Any other column is kept on the person's list entry under its header and can be used as a tag in a template (coupon columns feed the barcode and QR code blocks). |
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
| The table | Campaign Name (with Continue Setup for an unfinished draft), Type, Channel, Status, Triggered By, Audience, Next Send (the day and the time in the campaign's zone; *local time* when the send follows each recipient's clock), Created. Sort by the column headers. | |
| Row actions | Pause, Resume or Approve beside the menu when the status allows; the menu: Continue Setup or Edit, View Journey for a journey campaign, View Results, Clone, Pause, Resume, Cancel Schedule, Archive, Unarchive. | Each action is only offered when the campaign's status allows it and you have the permission. |
| Select | The checkbox per row, or every campaign on the page. | Shows the bulk bar: Clone, Pause, Resume, Archive for the selection. Campaigns that cannot take the action are skipped and named. |
| Rows per Page, Previous, Next | Pages of 50 by default. | |
| The calendar | Monday first, previous and next month, Today; a bar per campaign coloured by status (green going out or sent, amber paused or test published, red failed or cancelled, grey a draft that plans a date); more than three on a day fold into *+n more*. | A bar opens the campaign. |

### A campaign's page

| Control | What it is | What it changes |
|---|---|---|
| The header | The name, its status, channel and type chips, Manual or Journey, the code (copies on click), the description. | |
| The main button | What the campaign most needs next: Continue Setup for an unfinished draft, Production Publish once a test has been sent, Resume when paused. | Opens the set-up at the right step, or acts at once. |
| Clone, More Actions | Clone makes "Copy of …" with the settings, lists, exclusions and targets, never the runs or results. More Actions: Edit Campaign, Send a Test, Production Publish, Pause, Cancel Schedule, Archive, Unarchive, View Results, as the status allows. | |
| Overview | The headline figures (audience, sent, delivery rate, opens and clicks or replies and STOPs, conversions), the campaign's facts (purpose, owner, template, sender, tags), when and how it goes out, its dates, its targets, and a preview of the message. | Edit on a card opens the set-up at the step that owns it. |
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

**Where:** Campaigns → Create Campaign, then the five steps; Edit Campaign on a campaign's page opens the same steps.

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
| Campaign Type | Regular Marketing (one-time or scheduled), Drip (a series of runs on a pattern), E-Receipt (a receipt sent per purchase), Other (service or legal notices). Fixed once saved. | Which steps and schedule choices follow: a drip has steps instead of one time; an e-receipt has no audience or schedule, the point of sale triggers each send. |
| Channel | Email, SMS, MMS, or Multiple Channels. For a receipt: email, or a text receipt for registers that ask for SMS. Fixed once saved. | Which templates and senders are offered, how the audience is judged (email consent and addresses, or text consent and numbers), and what the message can carry. |
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
| When to Send | Send immediately, Schedule (Send At), or Recurring: Repeats (daily, weekly with Days of the Week, monthly with Day of the Month), At, Ends (never, on a Last Day, after a Number of Sends). A drip: Each Step Goes Out At and a label per step; Day 0 goes out when you publish. | The run or runs. Send times are clock times in the campaign's time zone. |
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

**Send a series.** Drip on Create Campaign. On Review & Publish give each step its day and label; publishing plans every run at once, day 0 now.

**Send at everyone's 10 a.m.** Tick Send at Each Recipient's Local Time and set Send At to 10:00. The step says how many people have a known zone; the others get 10:00 in the campaign's zone.

**Test two subject lines.** On the Test step switch on Test a Second Subject Line, write B, keep the sample at 20 percent and the decision at four hours, save. The Performance tab shows A and B side by side once the run starts.

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
| A template's card | Name, channel, status, when it was last used and by which campaign. | Opens the editor. |
| Card menu | Preview, Rename, Duplicate (a draft copy of the latest version), Delete. | Delete is refused while a campaign uses the template. |
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
| Features | Barcode and QR Code blocks need **dynamic_codes**; the Deliverability tab needs **deliverability_tests** and a Mailgun Inspect account under Settings. |

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

Run Inbox Previews renders the last saved version in real email clients through the workspace's Mailgun Inspect account, chosen under Settings → Sending → Deliverability Testing. Every test of the template is listed on the left; a result shows the renders grouped by client kind, a render opens full size. Tests count against the plan's monthly allowance, which Settings → Plan & Usage shows. Unsaved changes are not in a test: save first.

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
