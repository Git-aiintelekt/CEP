# Journeys

**Where:** Journeys, in the main menu; a new one also from the **+ Journey** button on Home. A journey's own page opens from the list.

## What is a journey

A journey is an automated path that each customer walks on their own. You draw it once: **who enters**, then the **steps** they go through (wait, check something, send an email or a text, issue a coupon, change their record, call your system) and where the path **ends**. From then on CEP runs it for every customer who qualifies, one at a time, at their own pace.

A campaign sends one message to a list at one moment. A journey keeps working: a customer who abandons a cart this afternoon gets the reminder an hour later, a customer whose birthday is next week gets the reward seven days before it, and a new loyalty member gets the welcome series over their first two weeks, without anyone pressing Send.

### The parts of a journey

| Part | What it is |
|---|---|
| Entry | What makes a customer enter: membership of a **customer list**, an **event** (a purchase, an abandoned cart, No Response …), a **date or time** (a schedule, or a date on the customer's record such as a birthday), joining or leaving a **segment**, an **attribute change** (loyalty tier, preferences, address), or the customer's **record matching conditions** (Customer Status is New). Any entry can be narrowed with **Only Customers Where** filters. |
| Population | **Fixed** (who qualifies at launch, then closed), **Continuously Qualifying** or **Event Triggered** (keeps letting newcomers in). |
| Re-entry | Whether the same customer can go through again: **Never**, **After X Days**, or **Every Qualifying Event**. Nobody is ever in the same journey twice at once. |
| Steps | Wait, Condition (Yes / No), Split, Email, SMS / MMS, Issue Coupon, Update Loyalty Tier, Update Profile, Update Segment, Add to List, Remove from List, Webhook, Goal, Exit Journey. |
| Goal | A Goal step names the outcome (an event within a window of entering); a customer who reaches it is **converted**, with the revenue of the matching orders. Without a Goal step, reaching an **Exit Journey** step counts as Goal Converted. |
| Version | Every change to a published journey is a new version; one version is live at a time, and customers finish the version they started. |

### The statuses

| Status | Means |
|---|---|
| Draft | Being built. Nobody enters. |
| Test | The test run went out; waiting for approval. |
| Approved | Approved to go live at a set time; until then the schedule can be cancelled. |
| Active | Live: customers enter and move along. |
| Paused | Nobody new enters and nobody moves; everyone waits where they are until it resumes. |
| Archived | Ended for good. Its figures and history stay readable. |

## Before the first journey

Two sides have work to do once: the platform team in the back-office, and the workspace in the app.

### What the platform team does (back-office)

The platform team's own chapter, **Journeys** in the Platform Guide, has the details. In short:

1. **The feature.** Journeys is a feature of the workspace's industry profile and plan: the tenant's page → Industry and features → Journeys → On, and a plan that includes it. Without it the Journeys menu item is missing and events sent to the workspace are refused.
2. **The scheduler.** One scheduler process (cep-jobs) runs for the platform; it enrols and moves journey customers every minute, activates scheduled journeys and rolls up the figures nightly. Nothing in a journey moves while it is stopped.
3. **The encryption key** for secrets at rest, so a Webhook step's signing secret can be kept.
4. **C360's feeds** into the workspace's database: the customer records, segments and their memberships, coupons and loyalty tiers. CEP does not create customers from nothing: a journey can only reach a customer who is in the records.

### What the workspace does (Settings)

| Item | Where | Why |
|---|---|---|
| Rights | Settings → Roles | Journeys · View (`journey.view`) sees journeys; Journeys · Create and Edit (`journey.edit`) builds, tests, retries and skips steps, duplicates and archives drafts; Journeys · Activate (`journey.activate`) approves, schedules, pauses, resumes and archives live journeys; Journeys · Export (`journey.export`) saves the Customers card as CSV; Journeys · Suppress (`journey.suppress`) keeps named customers out of a journey. Workspace Admin has all five, Analyst has View, Campaign Manager has none by default. |
| Sending | Settings → Sending Engines | An email engine with a verified default sender, and a texting engine if journeys send texts. A message step with no sender is retried for an hour and then lands on Needs Attention. |
| Templates | Templates | A **published** template for every message a journey sends. A draft template fails the readiness check. |
| A test list | Contact Lists | A list marked as a test list, holding your own team, for Test Publish. |
| Consent and governance | Settings → Consent Policy, Suppressions, Preference Centre, Governance | Journey messages go through the same send engine as campaigns: no consent, a suppression, a topic the customer unticked, a frequency cap or quiet hours hold a message back, and the customer's timeline says why. |
| Attribution | Settings → Attribution | Switch it on and have the shop send orders: every order raises a Purchase event (a customer's first one also First Purchase), the Last Purchase Date and Number of Purchases fields fill, and a Goal counts revenue. |
| Events | Settings → API Keys, then Settings → Events | A key with the scope `events:ingest` for the shop, the app and the loyalty system; the Events page gives the endpoint and an example. |
| Coupons | Settings → API Keys | A key with the scope `coupons:issue` for C360, which collects and answers the Issue Coupon step's requests. |

## The data journeys run on

A journey reads and writes the customer's record and reacts to what happens to them. This is where each piece comes from.

| Data | Comes from | Used by |
|---|---|---|
| Customer records (name, emails, phones, address, source) | C360 syncs them into the workspace; a contact list upload adds the people CEP did not know (owned by CEP, not a C360 copy). | Who can enter at all; the Customer fields in conditions; the Webhook payload. |
| Custom attributes (loyalty tier, customer status, home store, lifetime value, any field C360 sends) | C360, as a JSON object on the record; the upload adds `loyalty_tier`, `loyalty_id`, `last_purchase_at`, `timezone`; the Update Profile and Update Loyalty Tier steps write them. | Conditions (text, number or date by the comparison), Split by an attribute, the attribute trigger, Wait Until a date on the record. |
| `timezone` (an IANA name such as America/Chicago) | C360, or the upload template's Time zone column. | Wait Until a Time of Day and Until a Date on the Record, in the customer's own time; the workspace's zone otherwise. |
| Dates on the record (YYYY-MM-DD) such as `birth_date`, `membership_date`, `renewal_date` | C360 custom attributes. | On a Date Attribute entries, Wait Until a Date on the Record, date conditions. |
| Segments and their members | C360 (audiences the data team defined). | Enters / Exits Segment entries, Is in a Segment conditions, the Update Segment step, Who Enters on a schedule. |
| Contact lists | Uploaded, cloned or made from a segment in CEP. | Customer List entries, Is in a List conditions, Add to / Remove from List steps, Who Enters on a schedule, the test list. |
| Events (purchase, abandoned cart, store visit, birthday, any type you name) | `POST /api/v1/events/` from the shop, the app, the point of sale or the loyalty system, with an `events:ingest` key; CEP raises Purchase and First Purchase from orders, Email Open/Click and SMS Response from its own tracking, No Response, Preference Update, Loyalty Tier Change and Coupon Issue itself. | Event entries, Event conditions with property filters, the Goal step. |
| Orders | `POST /api/v1/orders/` with an `orders:ingest` key, or store transactions when POS Receipts count store sales. | Purchase events, Last Purchase Date, Number of Purchases, a Goal's attributed revenue. |
| Coupons and loyalty tiers | C360 references synced into the workspace. | Issue Coupon (a request C360 fulfils through `coupons:issue`), Update Loyalty Tier. |
| Consent, suppressions, preferences | The preference centre, unsubscribe links, STOP replies, imports, Settings → Suppressions. | Whether a message step sends; Preview Route shows the verdict for one customer. |
| Your own systems | A Webhook step posts the customer and journey context to an https address of yours, signed. | Anything outside CEP: a CRM note, a ticket, a loyalty credit. |

## The ways to start a journey

**From a starter.** The Journeys page's Journey Templates panel offers ten ready-made journeys (**View More** shows them all). Clicking one shows a read-only preview of its steps; **Copy This Template** opens the set-up already filled in. Each copy is yours: the starter itself never changes. The starters' message steps have no template yet, so they open marked Needs Setup until you choose one.

| Starter | Enters on | What it does | Goal it suggests |
|---|---|---|---|
| Welcome Series | Customer Creation event | Welcome email; two days later, those who opened get Our Story; the others an SMS nudge, five days, a welcome coupon and a first-purchase email. | First purchase within 30 days |
| Abandoned Cart Recovery | Abandoned Cart event (re-entry after 7 days) | An hour later a cart reminder; a day later, those who have not bought get a coupon and an SMS with the code. | Order placed within 3 days |
| Post-Purchase Thank You & Review | Purchase event (re-entry after 30 days) | A thank-you email three days after the purchase, a review request a week later. | Review submitted |
| First to Second Purchase | First Purchase event | Two weeks later, those who have not bought again get a coupon and an email. | Second purchase within 30 days |
| Win-Back Lapsed Customers | Enters your Lapsed segment (re-entry after 180 days) | We Miss You email; a week later, buyers leave the segment, the others get a coupon, a 20% email and a last-chance SMS. | Return purchase within 21 days |
| Birthday Reward | Birthday event (re-entry after 365 days) | A birthday coupon and email; a week later, an SMS to those who have not redeemed it. | Birthday coupon redeemed |
| Loyalty Tier Upgrade | Loyalty Tier Change event (every time) | A welcome-to-your-tier email, Add to VIP, and an SMS about the perks three days later. | Tier perk used within 14 days |
| Coupon Expiry Reminder | Coupon Issue event (every time) | Eleven days later, those who have not redeemed get an SMS, then a last-day email. | Coupon redeemed before expiry |
| Membership Anniversary | Anniversary event (re-entry after 365 days) | An anniversary email and a reward coupon. | Repeat visit within 30 days |
| Re-Engagement / Sunset | No Response event (re-entry after 90 days) | A Still Want to Hear from Us email; five days later, the silent ones are added to your Sunset segment. | Opens or clicks again |

**From scratch.** **Create Journey** (or **Start from Scratch** in the panel) opens the two-step set-up with nothing filled in.

**From one of yours.** **Duplicate** on a journey's page makes a new draft copy of it, steps included, to start again or try a variant. The journeys already set up in the workspace are on the Journeys page, with their status, trigger, channels and steps; open one to see how it is built and how it is doing.

## How to build a new journey

### 1. Set up: name and entry (step 1 of 2)

| Field | What to choose |
|---|---|
| Journey Name | A name unique in the workspace, for example *Welcome Series — New Loyalty Members*. |
| What Qualifies a Customer to Enter This Journey? | **Customer List**, **Event**, **Date / Time** or **Segment or Customer Change**. |
| Specific Trigger | The list, the event, the schedule, or the change (Enters Segment, Exits Segment, Loyalty Tier, Preference Update, Address Change, Customer Attribute Matches). Enters / Exits Segment also asks which **Segment**. |
| Customer Record Matches | For **Customer Attribute Matches**: the conditions a customer's record must meet to enter (see *Conditions* below), for example Customer Status is New. Everyone whose record matches enters, each once; with Every Qualifying Event, again when their record changes. A grey line says how many would enter now. |
| Only Customers Where (Optional) | Conditions that narrow any trigger: a customer the trigger would admit enters only if their record matches, for example Country is United States and Email Consent is Opted In. |
| Description (Optional) | What the journey is for; shown on its page. |

Every way a customer can enter, and what each needs:

| Entry | Enters when | Needs |
|---|---|---|
| Customer List | A customer is on the chosen list (newcomers to the list enter on later passes unless the population is Fixed). | A list in Contact Lists, approved if the consent policy asks for it. |
| Event: Welcome, Birthday, Anniversary, First Purchase, Customer Creation, Purchase, Abandoned Cart, Coupon Issue, Coupon Redemption, Segment Inception, Loyalty Tier Change, Email Open/Click, SMS Response, No Response | That event arrives for the customer after the journey went live (within the last seven days at most). | The shop, app or loyalty system sending events; Attribution for purchases; nothing for Email Open/Click, SMS Response, No Response, Coupon Issue and Loyalty Tier Change, which CEP raises itself. |
| Date / Time: Daily, Weekly, Monthly, On a Specific Date | The schedule's moment comes, for the members of a list or a segment. | The list or segment. Times are the workspace's time zone; each moment fires once. |
| Date / Time: On a Date Attribute | A date on the customer's record is the chosen number of days away (every year, or once). | A custom attribute holding a date, for example `birth_date`; the Date list shows how many records have each. |
| Enters Segment, Exits Segment | The customer joins or leaves the segment. | The segment, synced from C360. |
| Loyalty Tier, Preference Update, Address Change | The attribute changes: a Loyalty Tier Change event, a preference-centre save that changed something, the Address Change event C360 sends. | The events behind them. |
| Customer Attribute Matches | The customer's record matches the conditions now. | The attributes the conditions name. |

**Date / Time entries** add their own fields under Specific Trigger, and a grey line reads the result back ("Every Monday at 9:00 AM, the members of VIP Customers enter"):

| Specific Trigger | Asks for | Who enters, and when |
|---|---|---|
| Daily | At (a time); Who Enters (a customer list or a segment) | The members, every day at that time. |
| Weekly | On (one or more weekdays); At; Who Enters | The members, on those days at that time. |
| Monthly | Day of the Month (1 to 28, or Last Day); At; Who Enters | The members, once a month. |
| On a Specific Date | Date; At; Who Enters | The members, once. |
| On a Date Attribute | Date (a date on the customer's record, with how many customers have it); When (on the day, or 1 to 90 days before or after); At; Repeat (Every Year or Once); Only Customers In (optional) | Each customer on their own date. Every Year matches the day and month (birthdays, anniversaries; 29 February counts on 28 February in other years); Once matches the full date (a renewal date). |

Choose **Next**.

### 2. Set up: population and re-entry (step 2 of 2)

| Field | What to choose |
|---|---|
| Population | **Fixed**: who qualifies on the first pass after go-live, then nobody new. **Continuously Qualifying**: new matches keep joining. **Event Triggered**: customers enter the moment the event arrives. |
| Re-Entry | **Never**: once through, never again. **After X Days**: eligible again after the number of days you enter in **Days Before Re-Entry**, counted from when they finished or exited. **Every Qualifying Event** (offered when a starter uses it): again each time the trigger happens. |

Choose **Create Journey**. The journey is created as a Draft and the builder opens.

### 3. Build the steps

The canvas shows the Entry at the top. Use the **+** between steps to add one; click a step to set it up in the panel on the right, then **Save Step**. A step still to set up is marked **Needs Setup**. The step's **⋮** menu duplicates or deletes it. **Journey Settings** on the left shows the entry, population and re-entry; **Edit Setup** there reopens the set-up. A Condition, Split or continuing Goal opens paths under it; a branching step cannot sit inside another step's path.

| Step | What it does |
|---|---|
| Wait | **For a Duration**: minutes, hours, days or weeks. **Until a Time of Day**: the customer continues at that time, in their own time zone (the `timezone` attribute on their record) or the workspace's, on any day or only on the days you pick. **Until a Date on the Record**: a date on the customer's record (a renewal date, a birthday) with an offset ("3 days before") and a time; choose whether a customer whose date has passed, or who has none, continues at once or leaves the journey (exited early, with the reason). |
| Condition | Splits into Yes and No on conditions you build (see *Conditions* below): the customer's record, this journey's messages and earlier Conditions, events, lists and segments, the goal. Optionally give the step a name, shown on its card. **Match on Entry** under the builder says how many customers in the journey would answer Yes right now. |
| Split | Several paths. **By an Attribute**: each customer takes the first path whose values hold their attribute's value (Home Store is Lakeside Mall → Path 1; Downtown or Airport → Path 2), everyone else the last path. **At Random**: percentages that add up to 100, chosen once per customer and kept on retry. Name each path; the names show on the canvas. |
| Email, SMS / MMS | Sends a published template through the normal send engine, as a campaign of its own (one per step per day), so consent, suppressions, caps and quiet hours apply. |
| Issue Coupon | Asks C360 for a coupon for the customer. CEP makes no codes: C360 collects the request, issues the coupon and marks it done (Settings → Events → Coupon Requests for C360). The step also raises a Coupon Issue event. |
| Update Loyalty Tier | Sets the customer's tier and raises a Loyalty Tier Change event. |
| Update Profile | Sets any attribute on the customer's record to a value (Customer Status to Welcomed). |
| Update Segment | Adds the customer to a segment, or removes them. |
| Add to List, Remove from List | Changes the customer's membership of a contact list. |
| Webhook | A signed JSON POST to an https address of yours with the customer (id, name, email, phone, and their custom attributes when asked), the journey, the step and the enrollment. A signing secret, kept encrypted and never shown again, puts `X-CEP-Signature: sha256=…` (HMAC-SHA256 over `timestamp.body`) beside `X-CEP-Timestamp` on every call; `X-CEP-Delivery` is unique per call. A 2xx answer is success; 429, 5xx, a timeout or a connection error is retried like any temporary failure; another 4xx is recorded and the customer carries on. **Send a Test Call** posts a sample customer. |
| Goal | The outcome the journey is for: an event (Purchase, Coupon Redemption, or any type you name), optional filters on its data (order total is at least 25), and an attribution window from entering (14 days). A customer is **converted** when the event arrives within the window: when they reach the step, or at once wherever they are in the journey. **Mark converted and exit** takes them out; **Mark converted and continue on the Reached path** opens Reached and Not Yet paths under the step (a thank-you can follow). Revenue is the matching events' amounts, as Attribution sends them. |
| Exit Journey | Ends the path. Without a Goal step, reaching an Exit counts as Goal Converted. End every path with one. |

**Save Draft** (top right) keeps your work; nothing saves on its own. **Preview Route** (top right) walks the saved draft as one customer without sending or recording anything: whether they would enter, when each wait would continue, whether each message would send under today's consent and suppressions, which way each Condition on their record answers, and where the path ends; a step that depends on something that has not happened yet asks which way to assume. When every step is set up, choose **Continue to Test Publish**.

#### Conditions

The same builder writes a Condition step, the Customer Attribute Matches trigger and the Only Customers Where filters. Each row is a field, how to compare it, and a value; **All** means every row must hold, **Any** that one is enough; **Add Group** nests one All / Any group inside the rule. A sentence under the builder reads the whole condition back. A rule holds at most 20 conditions.

| Fields | Compared with |
|---|---|
| Customer: first name, last name, email address, phone number, country, state, city, postal code, source system, record updated, last purchase date, number of purchases, and every custom attribute on the records (with its values to pick from when there are few) | Text: is, is not, is any of, is none of, contains, does not contain, starts with, is set, is not set. Numbers: equals, does not equal, is at least, is at most, is between. Dates: is within the last N days, is more than N days ago, is before, is after, is between. A custom attribute is read as text, a number or a date by the comparison you choose. |
| This Journey (Condition steps only): each Email or SMS step, any message of the journey, each other Condition, the goal | A message: was sent, was delivered, was opened, was clicked, bounced, was delivered and not opened, was not sent. A Condition: answered Yes, answered No. The goal: reached, not reached. Only sends after the customer entered count. |
| Events: the types seen in the last 90 days and the standard ones, or any type you name | Happened, did not happen; optionally within the last N days (otherwise since the customer entered the journey, or ever at entry), and filters on the event's own data (store is Lakeside, amount is at least 100). |
| Lists and segments | Is in, is not in. |

### 4. Test publish

Choose the **Test Population**: a **Random Sample of Live Audience** (up to 200 customers who would enter now) or a **Specific Test List**. Four **Readiness Checks** must pass:

| Check | Passes when |
|---|---|
| Entry rules configured | The journey has a complete entry, filters included. |
| All canvas steps configured | Every step has its settings and every path ends. |
| Templates ready | Every message step's template is published. |
| Governance rules satisfied | Always passes; it lists the frequency caps that apply ("Emails: at most 3 in 7 days") and that texts wait out quiet hours. A customer over a cap is held back, not sent. |

**Run Test Publish**, then **Send Test**. The test **sends real messages** to that population (Waits are skipped), so use the test list. The results show who got what, and how many were held back and why. Test customers leave the journey when the test ends and can still enter it for real later. Preview Route is the no-send check to use before this.

### 5. Approve and go live

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

## Running a journey: the journey's page

| Part | What it shows |
|---|---|
| Header | Status, trigger, channels, and the actions your rights allow. |
| Notices | Draft, paused, scheduled, or a new version waiting for its test or approval. |
| Performance | Enrolled, In Journey, Converted (with a Goal: conversions, their attributed revenue and the average per conversion; without one: Exit arrivals) and Exited Early, with the weekly Enrollment Over Time and **Messages, All Steps**: every message step's sent, delivered, opened, clicked, bounced, complained, unsubscribed, held back (by reason) and failed figures for the last 30 days. A Draft shows dashes. |
| Setup | The trigger, Goal, Exit Criteria, re-entry, and the audience: source lists, eligible pool, enrolment rate. |
| Needs Attention | Customers whose step failed for a temporary reason and is being retried (after 5, 15 and 60 minutes) or was given up on, with the reason, the tries and the next try. **Retry Now** runs the step again on the next pass; **Skip Step** records it as skipped and moves the customer on. |
| Customers | Everyone who entered, newest first, with where they are now; search by name or email, filter by status, **Export CSV**. Open a customer for their **timeline**: when they entered, every step with its outcome (an email's delivered, opened and clicked moments; a held-back message's reason; a Condition's answer; the Goal), where they are waiting now, and how they left. |
| Suppressions | Customers this one journey never enters or messages: add by email address, mobile number or customer id with a note (a customer inside leaves at once), remove later. Workspace suppressions and consent apply before these. |
| Webhook Calls | When the journey has a Webhook step: every call, test calls included, with the endpoint's answer, the try and the duration. |
| Versions | Every version, newest first, with its status and when it went live. |
| Generated Campaigns | Each message step sends through a campaign, one per step per day. Open one to see its recipients and results. |
| Activity | Who created, tested, approved, paused or archived it, and when. |

In the builder, a live or paused version's canvas shows on each card how many customers passed it, are waiting at it, answered Yes or No, or reached the goal, refreshed every minute.

## What happens behind the scenes

Four jobs run journeys. Every minute: **enroll-journey-customers** enters the customers who meet a live journey's entry (events of the last seven days at most, up to 5,000 per journey per pass; Date / Time schedules whose moment has come; attribute matches; never a customer suppressed for the journey); **advance-journey-customers** first converts anyone whose goal event arrived, then moves those whose next step is due; **activate-scheduled-journeys** takes approved journeys live when their time comes. Nightly, **rollup-journey-analytics** writes the Performance figures. One scheduler at a time works a workspace; a second one skips it.

Only customers in the customer records enter, since a message to someone unknown could never go out. Message steps send through the normal send engine, so consent, suppressions, the preference centre, frequency caps and quiet hours all apply as they do to campaigns. A step that fails for a temporary reason is tried again after 5, 15 and 60 minutes, then given up and listed under Needs Attention; a permanent failure (a missing template, a refused address) is recorded on the customer's timeline and the customer carries on.

## Things to know

- **No Response** means a customer sent at least 3 marketing emails in the last 30 days who opened, clicked and replied to none of them (security scanners left out). CEP raises it at most once in 30 days per customer, while a live journey starts from it.
- Attribute changes enter on events: **Loyalty Tier** on a Loyalty Tier Change (from the Update Loyalty Tier step, or sent by the loyalty system), **Preference Update** on a preference-centre save that changed something, **Address Change** on the event C360 sends.
- The dates for **On a Date Attribute** and **Until a Date on the Record** come from customer records' custom attributes holding a date (YYYY-MM-DD); CEP has no birthday field of its own. If no record holds a date yet, the Date list says so.
- A customer's time zone is the `timezone` custom attribute on their record, an IANA name such as America/Chicago; C360 can send it, and the upload template has a Time zone column. A record without one, or with a name CEP does not know, waits in the workspace's time zone. Test Publish skips every wait.
- A Fixed journey is closed to newcomers after its first pass, even if more customers would qualify later.
- A Condition saved before the builder (made a purchase, opened an email, and so on) keeps working as it was; opening it shows the same check as a rule, which is saved in the new form when you save the step.
- A Webhook address must be https (http only for localhost), so customer data never travels in the clear. The signing secret is kept encrypted; the Webhook Calls card never shows it.
- Saving your own journey as a template is not offered; Duplicate copies a journey within the workspace.
- Events are explained in **Events** (Settings → Events), purchases in **Attribution**, keys in **API Keys**, who may do what in **Roles**.
