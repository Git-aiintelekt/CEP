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
| Steps | Wait, Condition (Yes / No), Split, Email, SMS / MMS, Issue Coupon, Update Loyalty Tier, Update Profile, Update Segment, Add to List, Remove from List, Goal, Exit Journey. |
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
| Split | Several paths. **By an Attribute**: each customer takes the first path whose values hold their attribute's value (Home Store is Lakeside Mall → Path 1; Downtown or Airport → Path 2), everyone else the last path. **At Random**: percentages that add up to 100, chosen once per customer and kept on retry. Name each path; the names show on the canvas. |
| Update Profile | Sets any attribute on the customer's record to a value (Customer Status to Welcomed). Update Loyalty Tier stays the step for the tier. |
| Add to List, Remove from List | Changes the customer's membership of a contact list, as Update Segment does for segments. |
| Goal | The outcome the journey is for: an event (Purchase, Coupon Redemption, or any type you name), optional filters on its data (order total is at least 25), and an attribution window from entering (14 days). A customer is **converted** when the event arrives within the window: when they reach the step, or at once wherever they are in the journey. **Mark converted and exit** takes them out; **Mark converted and continue on the Reached path** opens Reached and Not Yet paths under the step (a thank-you can follow). Revenue is the matching events' amounts, as Attribution sends them. |
| Exit Journey | Ends the path. Without a Goal step, reaching an Exit counts as Goal Converted. End every path with one. |

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
- The journey page's **Suppressions** card lists customers this one journey never enters or messages; add one by email address, mobile number or customer id (a customer inside leaves at once, exited early as "Suppressed for this journey"), with a note, and remove them later. Adding and removing need the Journeys · Suppress permission; workspace suppressions and consent apply before these.
- **Export CSV** on the Customers card (Journeys · Export permission) saves the list as shown, with each customer's entry, status, where they are, conversion and exit.
- The journey page's **Customers** card lists everyone who entered, newest first, with where they are now; search by name or email, filter by status, and open a customer to see their timeline: when they entered, every step with its outcome (an email's delivered, opened and clicked moments; a held-back message's reason; a Condition's answer; the Goal), where they are waiting now, and how they left.
- **Preview Route** (top right of the builder) walks the saved draft as one customer without sending or recording anything: whether they would enter, when each wait would continue, whether each message would send under today's consent and suppressions, which way each Condition on their record answers, and where the path ends. A Condition that depends on something that has not happened yet (this journey's messages, an earlier step, the goal) asks which way to assume. Test Publish still sends real messages; Preview Route is the no-send check before it.
- A live or paused version's canvas shows on each card how many customers passed it, are waiting at it, answered Yes or No, or reached the goal, refreshed every minute.
- The journey page's Performance shows Converted (with a Goal: conversions and their revenue; without one: Exit arrivals) and **Messages, All Steps**: every message step's sent, delivered, opened, clicked, bounced, complained, unsubscribed, held back (by reason) and failed figures added up for the last 30 days. The nightly roll-up keeps the same figures per journey.
- A customer's time zone is the `timezone` custom attribute on their record, an IANA name such as America/Chicago; C360 can send it, and the upload template has a Time zone column. A record without one, or with a name CEP does not know, waits in the workspace's time zone. Test Publish skips every wait.
- A Condition saved before the builder (made a purchase, opened an email, and so on) keeps working as it was; opening it shows the same check as a rule, which is saved in the new form when you save the step.
- The Split step (more than two paths) is not offered; use Conditions.
- Saving your own journey as a template is not offered; Duplicate copies a journey within the workspace.
- Events are explained in **Events** (Settings → Events), purchases in **Attribution**.
