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
| Campaign Type | Regular Marketing (one-time or scheduled), Drip (several messages on a timetable, everyone starting together), E-Receipt (a receipt sent per purchase), Other (service or legal notices). Fixed once saved. Picking Drip shows when a journey suits better, with Create a Journey Instead. | Which steps follow: a drip has Audience, Sequence, Targets and Test & Publish; an e-receipt has no audience or schedule, the point of sale triggers each send. |
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
| When to Send | Send immediately, Schedule (Send At), or Recurring: Repeats (daily, weekly with Days of the Week, monthly with Day of the Month), At, Ends (never, on a Last Day, after a Number of Sends). A drip has no When to Send: its start date and times are on the Sequence step. | The run or runs. Send times are clock times in the campaign's time zone. |
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

**Send a series.** Drip on Create Campaign → Audience: tick the list → Sequence: build message 1, then Add Message (a copy of the last keeps the header and footer), give each its day and subject, choose the start date, the send time and the zone, and the sender → Targets → Test & Publish: Send All as a Test, check each message, then Publish to Production.

**Send at everyone's 10 a.m.** Tick Send at Each Recipient's Local Time and set Send At to 10:00. The step says how many people have a known zone; the others get 10:00 in the campaign's zone.

**Test two subject lines.** On the Test step switch on Test a Second Subject Line, write B, keep the sample at 20 percent and the decision at four hours, save. The Performance tab shows A and B side by side once the run starts.

## A Drip Campaign

A drip sends several messages on a timetable to one audience on one channel. Everyone on the campaign list starts together on the start date; each message goes on its day (Day 0 is the start date) at the series time, or at its own time.

| Step | What you do there |
|---|---|
| Audience | As for any campaign. The note says how a drip audience works: people added to the lists after message 1 don't join, and consent and frequency limits are checked again before each message. |
| Sequence | The messages as a timeline of cards, in day order, with the gap between them. Open a card to set its name (it names the template copy too), its day, its own send time, the template (Choose from Gallery, Edit Template, Change), the subject line and preheader (email) or the text (SMS, MMS), and the A/B subject test (one message per drip, email only). Add Message starts from a copy of the last message, a template from the gallery, or a blank one; Copy as Next Message does the same from the open one; Remove Message asks first. Series at a Glance holds the start date, the send time and the time zone, what the series adds up to and a calendar; Sender (and Topic) are set once for every message. Changing the date, time or zone moves every message's date but never changes the messages. Continue lists the messages that still need something, with Show First Problem. |
| Targets | As for any campaign; the targets are for the drip as a whole. |
| Test & Publish | Preview each message (as a sample customer, on desktop or mobile). Send All as a Test sends every message now, one after another, to the people you pick; each subject starts with its place: "[Test 2 of 3 · would send Day 3]" for email, "[Test 2/3 · Day 3]" for texts, and the A/B message sends both subjects. A message edited after its test says Changed since the test; Resend it. The Review Timeline shows each message's date, subject and reach, with warnings for messages closer than two days, frequency limits and quiet hours. Before You Publish lists what's left; Publish to Production plans every message at once. |

Each message has its own copy of its template ("Loyalty Welcome Series · 2 of 4"), so editing one never changes another. From the editor, Back to Sequence returns to the message. A message's own subject line is what it sends; its template copy needs none.

Once published, the campaign page shows the Series Timeline: each message Sent with its figures, Sending, Next Up, Scheduled, On Hold, Cancelled or Failed, and who was skipped and why (View People lists them). Pause holds the waiting messages; Resume first shows when the missed ones will go. Stop Remaining Messages cancels the rest for good (to send again, clone it). A failed message nobody received can be retried. Clone asks for the copy's name and start date and opens its Sequence step.

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
