# Campaign Set-Up

**Where:** Campaigns → **Create Campaign** (also on Home) opens the Create Campaign pop-up; then the five steps (four for a drip: see A Drip Campaign below). On a campaign's page, **Continue Setup** or **Edit Campaign** opens the same steps. Inside the steps, the pencil beside the campaign's name (**Edit Details**) reopens the pop-up, and **Save and Close** keeps the draft and leaves.

## What this page is for

The set-up is where a campaign is defined: who it is for, what it says, a test, the targets it is measured against, and when and how it goes out. It starts with the Create Campaign pop-up (the basics), then five steps: Audience, Content, Test, Targets, Review & Publish. Continue checks the step you are on and saves, so a draft can be left at any step and picked up where it stopped. Nothing is sent to customers until Publish to Production.

## Who can use it

| | |
|---|---|
| Permission | `campaign.edit` for the set-up; `campaign.publish` for the publish itself; `campaign.approve` to approve when the workspace asks for approvals. Someone without `campaign.edit` sees the campaign page with a note that the set-up is unfinished. Create a Journey Instead needs `journey.edit`; Add Contact List's Upload New and From an Audience or a Clone need `list.edit`; New Template needs `template.edit`; New Sender needs `provider.edit`. |
| Features | A channel is offered only when the workspace has its feature: **email**, **sms**, **mms**, **whatsapp**. Multiple Channels needs at least two of email, SMS and MMS. Create a Journey Instead needs **journeys**. |

## The fields and controls

### Create Campaign (the basics)

The same pop-up opens as **Edit Details** for a saved campaign, with **Save** in place of **Create Campaign**.

| Field | What it is | What it changes |
|---|---|---|
| Campaign Name | Required, up to 200 characters, unique among the workspace's live campaigns. Internal: your team sees it, customers never do. | How the campaign is listed everywhere: the Campaigns list, reports and Home. |
| Campaign Type | **Regular Marketing** (one-time or scheduled; marked Most Common), **Drip** (several messages on a set schedule), **E-Receipt** (sent after a purchase), **Other** (anything the others don't cover). Choosing Drip shows when a journey suits better, with **Create a Journey Instead**, which opens Create Journey with the name and description you typed. | Which steps follow: a drip has Audience, Drip Campaign Setup, Targets and Test & Publish; an e-receipt has no Audience step and no schedule, because the point of sale triggers each send. It also sets Message Purpose until you choose one yourself. |
| Channel | **Email**, **SMS** (text up to 160 characters), **MMS** (text with an image), **WhatsApp** (a template Meta approved), **Multiple Channels**. A drip cannot use Multiple Channels or WhatsApp; an e-receipt is Email, or SMS for registers that ask for a text receipt. | Which templates and senders the Content step offers, how the audience is judged (email consent and addresses, or text consent and numbers), and what the message can carry. |
| Message Purpose | **Marketing**, **Transactional**, **Service** or **Legal**. Until you pick, it follows the type: Regular Marketing and Drip are Marketing, E-Receipt is Transactional (and cannot be changed), Other is Service. | Which consent and frequency rules apply. Marketing needs an opt-in and an unsubscribe link (or opt-out wording in a text), and counts against frequency limits. Transactional, service and legal skip the consent rules, but never a blocked or invalid address. |
| Owner | You, marked Auto-Assigned to You; **Change** opens a searchable list of the workspace's people. | Who is emailed about the campaign's runs and failures (Settings → Notifications), and whose it is in the list. |
| Description (Optional) | Up to 2,000 characters: what the campaign is for. | Shown on the campaign's page. |
| More Options · Code and tags | Folds out the two fields below. Opens by itself when one of them has a problem. | |
| Code (Optional) | Up to 40 characters: capitals, digits and hyphens. Made for you when left blank; fixed once the campaign exists. | The short handle reports, the API and the engine's call log use. A code another campaign uses is refused, naming that campaign. |
| Tags | Up to 20 words; press Enter or a comma after each. The workspace's tags are suggested as you type. | A filter on the Campaigns page. |
| Create Campaign | Saves the draft. | Opens the first step: Audience, or Content for an e-receipt. |

The type and channel can be changed on Edit Details until the content is chosen (a template or a sender; for a drip, a template on any message). After that they are shown locked, with "Fixed Once Content Is Chosen"; to change them, create a new campaign.

### Step 1: Audience

| Control | What it is | What it changes |
|---|---|---|
| Send To · Add Contact List | Opens **Add Contact List**: **Existing Lists** (search by name, filter by Type and Source, tick lists or every list shown), **Upload New** (the Contact Lists upload wizard), or **From an Audience or a Clone**. | The lists the campaign goes to. At the run they are merged, one entry per person. A list made from an audience or a clone is attached at once. |
| An uploaded list | Shown as **Needs Review** with **Confirm**, because file data isn't checked upstream. | It counts, and is attached, only once you confirm it. Leaving the step first asks: **Continue Without It** or **Confirm and Continue**. |
| The Send To table | Each list with its source and contact count; the name opens the list in a new tab; **✕** detaches it. The line under it counts the lists and contacts before duplicates and governance. | A list marked Test is flagged: fine for a test publish, refused by a production publish. |
| Don't Send To · Add List to Leave Out | The lists to exclude. A list is included or left out, never both. | Their people are left out whatever other list they are on. |
| Audience | **In Your Lists**, **Unique People** (after duplicates and excluded lists) and **Estimated Recipients** (after today's governance check), with the commonest reason people are left out and a breakdown. | A reading as of today. The real decision is made again when the run starts. |

A draft can be saved without a list; publishing needs at least one.

### Step 2: Content

| Control | What it is | What it changes |
|---|---|---|
| Use an Existing Template | The templates of the campaign's channel as cards: name, channel, status (and Meta's approval for WhatsApp), when edited and the version. A search box appears when there are more than six. **New Template** opens the template library in a new tab. | The message. A template still in Draft can be tested; a production publish needs it published first. A template of another channel is flagged and must be changed. |
| Subject Line, Preheader (email and e-receipt templates) | The campaign's own, up to 300 characters each; left blank, the template's is used. **Edit the Template's** copies the template's text in to change it; **Use the Template's** empties the field. The smiley button beside each field adds an emoji at the cursor; picked while the field is empty, it is added to the template's text, which becomes this campaign's own, so the template's emoji can be changed or added to without retyping the line. The counter marks where an inbox cuts off (60 characters for a subject, 90 for a preheader). Tags such as {{first_name}} work. **In the Inbox** shows the result with sample values. | Only this campaign's subject and preheader; the template never changes. |
| Topic · Filed Under | The preference-centre topic the campaign belongs to. Asked for marketing campaigns (not e-receipts) when the preference centre is on and has topics for the channel. Needed to publish. | People who unticked the topic on the preference page are left out of this campaign, counted as Topic Opted Out. Topics are managed under Settings → Preference Centre. |
| Sender · Send From (required) | The name and address, or the number, the message comes from; the sender brings its engine. The list starts at **Choose a Sender**. An unverified sender is marked "(not verified)"; one on the workspace's own mail server says so. **New Sender** opens Settings → Sending Engines in a new tab. | Mandatory: **Continue to Test** stays on Content and says *Choose who this campaign comes from* until one is chosen. **Save and Close** still keeps a draft without one. Only a verified sender can publish to production; test sends work from any. A sender added with New Sender is the workspace's and can be used by every campaign. |
| Preview | The chosen template, once the draft is saved, with **Open in the Designer** (or the Receipt Editor, Message Editor or WhatsApp Editor) in a new tab. | |
| Link Tracking | Shown once a template is chosen. **Tag Links in This Campaign** (on when the workspace tags the channel), **Campaign (utm_campaign)** (empty: from the campaign name), **Tactic (utm_marketing_tactic)** (From the Campaign Type, or promotional, transactional, nurture, lifecycle, retention, win-back, other), and every link with its **Label (utm_content)** and whether it is tagged. Saved on its own as you change it. | The UTM tags this campaign's links carry. Off: its links go out as written. The UTM Tracking chapter has the details. |

Both the template and the sender are needed to publish, not to save a draft. A marketing message must let people opt out: an unsubscribe link in an email, opt-out wording such as "Reply STOP" in a text, or the {{opt_out_text}} tag. The pre-publish check looks for it.

### Step 3: Test

| Control | What it is | What it changes |
|---|---|---|
| Preview | The message with the catalogue's sample values, or as one customer of the audience would get it; desktop and mobile; click to see it large. | |
| Send a Test | **People of This Workspace** (email only) to tick, and **Other Addresses** or **Mobile Numbers** (with the country code), up to 20, separated by commas; **Send Test**. Needs a template and a sender. | The real message goes out now through the campaign's sender, marked [TEST], with sample values in place of personal data. It is recorded as a test run, counts towards no result, and moves a draft to Test Published. Each address is listed as sent or not sent, with the reason. |
| Subject Line Test (email Regular Marketing and Other campaigns) | **Test a Second Subject Line** switches it on. Off by default. | With it on, each test address gets both subjects, marked [TEST A] and [TEST B]. |
| A | The subject this campaign sends: its own, or the template's. Read-only here; change it on the Content step. | Goes to half of the sample. |
| B | Required, up to 300 characters; tags work. | Goes to the other half of the sample. |
| Sample | 10 to 50 percent of the audience, in steps of 5. Default 20 percent. | The share that gets the test, half A and half B. The rest wait for the winner. With fewer than 20 people in the run there is no split: everyone gets A. |
| Winner Decided By | **Open Rate** (default) or **Click Rate**. | The measure the two subjects are compared on, per message sent. |
| Decide After | 30 minutes, 1, 2, 4 (default), 8 or 12 hours, or 1, 2, 3 or 7 days. | How long after the sample goes out the winner is chosen. If the two are within one point, A wins. The held messages then go with the winning subject. You can also pick the winner yourself on the campaign's Performance tab. |
| Save Subject Test | Saves the test. "Not saved yet." shows while it has changes. | |

### Step 4: Targets (optional, Skip for Now)

| Field | What it is | What it changes |
|---|---|---|
| Opens (not for texts), Clicks, Conversions, Offer Redemptions | What the campaign is meant to achieve. Under each, its share of the estimated recipients. | The Performance tab shows the progress against them. |
| Target Revenue | What the campaign is meant to earn. | Home reads attributed revenue against it, Top Campaigns ranks by revenue against target, and the Performance tab shows the progress. |
| Planned Campaign Cost | Creative, sending and agency costs: $500, $1,000, $2,500, or **Custom** for another amount; **Clear** empties it. | Campaign ROI and the cost line on Home. |
| Planned Offer Cost | Discounts and rewards you expect to give away, chosen the same way. | Total Planned Spend and Planned Return. |
| Notes | Up to 1,000 characters on what the targets need explaining. | Shown on the campaign's page. |
| Plan at a Glance | Projected Cost per Conversion, Target Revenue, Total Planned Spend (both costs) and Planned Return (revenue to spend). | A planning estimate, not a guaranteed outcome. |

**Skip for Now** moves on without targets; they can be filled in later.

### Step 5: Review & Publish

The step has two parts: **When and How It Goes Out**, then **Summary and Publish**. An e-receipt has no schedule: each receipt goes out when the point of sale or the web shop asks for it (with **Change the Campaign Type** if that was not meant).

| Control | What it is | What it changes |
|---|---|---|
| When to Send | **Send Immediately** (the send starts when you publish to production), **Schedule for Later** (one send at a date and time), or **Recurring** (daily, weekly or monthly). | The run or runs the publish creates. A recurring campaign stays one campaign: each occurrence is its own run. |
| Time Zone | The campaign's zone; the workspace's unless changed. The hint names the workspace's zone. | Every time on this step is a clock time in this zone, daylight saving included. The Campaigns list and Home show the send time in this zone too. |
| Send At (Schedule for Later) | The date and time; the hint gives the same moment in the workspace's zone. | When the one send starts. |
| Repeats (Recurring) | **Daily**, **Weekly** or **Monthly**. | How often a run is made. |
| Every (Recurring) | The number of days, weeks or months between runs, 1 to 52. Default 1. | Every 2 weeks, for example. |
| At (Recurring) | The time of day. | When each run starts. |
| On (Weekly) | The days of the week, Mon to Sun. | Which days a weekly campaign runs. |
| Day of the Month (Monthly) | 1 to 31. In a shorter month, the last day is used. | Which day a monthly campaign runs. |
| Ends (Recurring) | **Never (Until Paused or Archived)**, **On a Date** (with **Last Day**), or **After a Number of Sends** (with **Number of Sends**). | When the runs stop. |
| Apply Corporate Frequency Limits | On unless switched off. | Off lifts the workspace's frequency cap for this campaign, and switching it off is recorded in the activity log. Consent, unsubscribes and blocked addresses always apply to marketing; service and transactional messages may be exempt from the cap, but text unsubscribes and blocked addresses always apply. |
| Include Unengaged Contacts | Shown for marketing email. Off unless switched on. | Off: people with no click, purchase or preference visit in the Unengaged Contacts period (Settings → Governance) are left out. On: they get this campaign too, for a win-back campaign; the Summary shows **Unengaged Contacts: Included (a win-back campaign)** and publishing records it in the activity log. Texts and transactional email are never affected. |
| Send at Each Recipient's Local Time | The same clock time in each recipient's own zone, from their address (a US or Canadian state, or a country with one zone) or a time zone attribute. A line says how many people on the attached lists have a known zone. | The send starts as the first zone reaches the time and ends with the last. People without a known zone get the campaign's time. With Send Immediately, people in zones that have not reached the publish time yet get it later today. |
| Messages per Hour, at Most | Optional; blank means no limit of the campaign's own. | Stored and shown on the campaign, not enforced yet. To pace a send, set Messages per Minute on the sending engine under Settings → Sending Engines. |
| Quiet hours (note) | Shown for marketing texts. | Marketing texts are held during the workspace's quiet hours and start when they end. |
| The summary card | Names anything unfinished (the checklist's problems, no test sent, no targets), each with the way to it. | |
| Summary | Everything chosen, part by part, with an **Edit** link to each. | |
| Before You Publish | The pre-publish checklist: **Template content finalized** (a published template with content; in marketing, the unsubscribe link in an email or opt-out wording in a text; a picture in an MMS), **Campaign List attached** (a Production list), **Verified sender chosen**, and, when they need attention, **Topic chosen**, **Send time set** and **Recurrence valid**; **Approved for production** when approvals are required. **Test message sent and reviewed** is advice only. | **Publish to Production** stays greyed out until every required item is done. A missing test only warns. |
| Audience Estimate | The estimate as of today. | |
| Approval | Shown when the workspace requires approval (Settings → Approvals). **Note to the Approver**: optional, up to 500 characters, what to check or why it is ready; **Request Approval** (or **Request Approval Again** after a send-back) emails everyone who can approve. An approver sees a **Note**, which goes to the person who asked and is required to **Send Back**, and **Approve**. | Publish to Production waits until it is approved. Nobody approves their own campaign. |
| Publish to Production | Needs `campaign.publish`. Asks once more in **Publish to production?**: who it goes to, when, and a warning when no test was sent; **Not Yet** or **Publish**. | Creates the runs. After publishing the campaign can no longer be edited; it can be paused, and a scheduled send can be cancelled. |

## How to

**Set up a one-time email.** Create Campaign → name it, Regular Marketing, Email (Message Purpose becomes Marketing) → Create Campaign → Audience: Add Contact List, tick the list → Content: pick the template, check the subject line, choose the topic and the sender → Test: send yourself a test → Targets: Skip for Now or enter the revenue target → Review & Publish: Send Immediately or Schedule for Later → Publish to Production.

**Rehearse without sending to anyone.** Attach a Test list and send tests to colleagues from the Test step. A test send moves the status to Test Published and reaches nobody else.

**Send a series.** Drip on Create Campaign → Audience: tick the list → Drip Campaign Setup: build message 1, then Add Message (a copy of the last keeps the header and footer), give each its day and subject, choose the start date, the send time and the zone, and the sender → Targets → Test & Publish: Send All as a Test, check each message, then Publish to Production.

**Send every Monday at 9:00.** Review & Publish → Recurring → Repeats: Weekly, Every 1, At 09:00, On: Mon → Ends: Never (Until Paused or Archived), or After a Number of Sends.

**Send at everyone's 10 a.m.** Tick Send at Each Recipient's Local Time and set Send At to 10:00. The step says how many people have a known zone; the others get 10:00 in the campaign's zone.

**Test two subject lines.** On the Test step switch on Test a Second Subject Line, write B, keep the sample at 20 percent and the decision at four hours, and press Save Subject Test. The Performance tab shows A and B side by side once the run starts.

## A Drip Campaign

A drip sends several messages on a timetable to one audience on one channel. Everyone on the campaign list starts together on the start date; each message goes on its day (Day 0 is the start date) at the series time, or at its own time.

| Step | What you do there |
|---|---|
| Audience | As for any campaign. The note says how a drip audience works: people added to the lists after message 1 don't join, and consent and frequency limits are checked again before each message. |
| Drip Campaign Setup | The messages as a timeline of cards, in day order, with the gap between them. Open a card to set its name (it names the template copy too), its day, its own send time, the template (Choose from Gallery, Edit Template, Change), the subject line and preheader (email) or the text (SMS, MMS), and the A/B subject test (one message per drip, email only). Add Message starts from a copy of the last message, a template from the gallery, or a blank one; Copy as Next Message does the same from the open one; Remove Message asks first. Series at a Glance holds the start date, the send time and the time zone, what the series adds up to and a calendar; Sender (and Topic) are set once for every message. Changing the date, time or zone moves every message's date but never changes the messages. Continue lists the messages that still need something, with Show First Problem. |
| Targets | As for any campaign; the targets are for the drip as a whole. |
| Test & Publish | Preview each message (as a sample customer, on desktop or mobile). Send All as a Test sends every message now, one after another, to the people you pick; each subject starts with its place: "[Test 2 of 3 · would send Day 3]" for email, "[Test 2/3 · Day 3]" for texts, and the A/B message sends both subjects. A message edited after its test says Changed since the test; Resend it. The Review Timeline shows each message's date, subject and reach, with warnings for messages closer than two days, frequency limits and quiet hours. Before You Publish lists what's left; Publish to Production plans every message at once. |

When an Unengaged Contacts rule is in use, Test & Publish says so under the timeline: unengaged contacts are left out of the drip's emails ("people with no engagement in 180 days, after at least 5 marketing emails"), with the share of the workspace's email contacts that is today, or, on a new install, the day the rule starts. A drip has no Include Unengaged Contacts switch.

Each message has its own copy of its template ("Loyalty Welcome Series · 2 of 4"), so editing one never changes another. From the editor, Back to Drip Campaign Setup returns to the message. A message's own subject line is what it sends; its template copy needs none.

Once published, the campaign page shows the Series Timeline: each message Sent with its figures, Sending, Next Up, Scheduled, On Hold, Cancelled or Failed, and who was skipped and why (View People lists them). Pause holds the waiting messages; Resume first shows when the missed ones will go. Stop Remaining Messages cancels the rest for good (to send again, clone it). A failed message nobody received can be retried. Clone asks for the copy's name and start date and opens its Drip Campaign Setup step.

**Not in the first version:** people can't join a drip after it starts (no rolling entry), conversions and revenue aren't split by message, there's no view of where one person is in the series, test recipients can't be saved as a list, and a change can't be applied to every message at once.

## What happens behind the scenes

1. Continue validates the step and saves the draft; the API's field messages land on the same fields and the step that holds the first one opens. A save against an older version is refused and the page offers to reload the latest version.
2. The set-up remembers how far it got: an unfinished draft opens at the next step and the steps ahead stay closed, so the publish cannot be reached early.
3. The audience estimate runs the send engine's own governance order as of today; the frozen list at the run is the record of what a send used.
4. Production Publish runs the checklist, records who published, waits for the approval when the workspace requires one, and creates the runs the dispatcher will start on time.

## Things to know

- The type and channel are fixed once the content (a template or a sender) is chosen; until then Edit Details can change them. After that, make a new campaign.
- A Test list blocks a production publish; an unverified sender blocks it too, while test sends still work.
- A campaign's own subject line never changes the template; other campaigns on the same template keep theirs.
- The hourly limit is not enforced yet; pace a send with the engine's Messages per Minute.
- A drip's messages can't change once it is published, and their templates are locked (read-only, not deletable) until it finishes or is stopped.
