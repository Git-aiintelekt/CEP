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
| Specific Trigger | The list, the event (Purchase, Abandoned Cart, Birthday, No Response …), the schedule, or the change (Enters Segment, Exits Segment, Loyalty Tier, Preference Update, Address Change). Enters / Exits Segment also asks which **Segment**. |
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
| Wait | Pauses for minutes, hours, days or weeks. |
| Condition | Splits into Yes and No: made a purchase, opened an email, clicked a link, redeemed a coupon, a specific event happened (optionally within a number of days), or is in a segment. |
| Email, SMS / MMS | Sends a published template. |
| Issue Coupon | Asks C360 for a coupon for the customer. CEP makes no codes: C360 collects the request, issues the coupon and marks it done (Settings → Events → Coupon Requests for C360). The step also raises a Coupon Issue event. |
| Update Loyalty Tier | Sets the customer's tier and raises a Loyalty Tier Change event. |
| Update Segment | Adds the customer to a segment, or removes them. |
| Exit Journey | Ends the path; the customer counts as Goal Converted. End every path with one. |

**Save Draft** (top right) keeps your work; nothing saves on its own. When every step is set up, choose **Continue to Test Publish**.

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
- The Split step (more than two paths) is not offered; use Conditions.
- Saving your own journey as a template is not offered; Duplicate copies a journey within the workspace.
- Events are explained in **Events** (Settings → Events), purchases in **Attribution**.
