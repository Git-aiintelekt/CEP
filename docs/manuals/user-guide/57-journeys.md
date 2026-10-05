# Journeys

**Where:** Journeys, in the main menu. A journey's own page opens from the list.

## What this page is for

A journey follows each customer through a path you draw once: who enters, how long to wait, what to send, which way to go next. A welcome series, an abandoned-cart reminder, a birthday reward or a win-back all run as journeys. Unlike a campaign, which sends once to a list, a journey keeps working: every minute CEP enrols the customers who qualify and moves along those whose next step is due.

## Who can use it

| | |
|---|---|
| Journeys · View (`journey.view`) | See journeys, their steps and their results. Analysts have it. |
| Journeys · Create and Edit (`journey.edit`) | Create, build, test publish, duplicate, and archive a journey that is not live. |
| Journeys · Activate (`journey.activate`) | Approve a journey to go live now or later, cancel that schedule, pause, resume, and archive a live journey. |
| | Workspace Admin has all three. Campaign Manager has none by default: add them in Settings → Roles if the campaign team builds journeys. The workspace needs the Journeys feature (on for every plan unless the platform team turned it off). |

## Before the first journey

1. An email engine with a verified default sender (Settings → Sending Engines), and a texting engine if the journey sends texts.
2. A **published** template for every message the journey sends. A draft template fails the readiness check.
3. A contact list marked as a test list, for the test run.
4. For event journeys, the events arriving: purchases come from Attribution; everything else from the shop or the loyalty system (Settings → Events).

## The statuses

| Status | Means |
|---|---|
| Draft | Being built. Nobody enters. |
| Test | The test run went out; waiting for approval. |
| Approved | Approved to go live at a set time; until then you can cancel the schedule. |
| Active | Live: customers enter and move along. |
| Paused | Nobody new enters and nobody moves; everyone stays where they are until it resumes. |
| Archived | Ended for good. Its figures and history stay readable. |

## Start a journey

On the Journeys page, choose **Create Journey** (or Start from Scratch), or pick one of the ten retail starters: Welcome Series, Abandoned Cart Recovery, Post-Purchase Thank You & Review, First to Second Purchase, Win-Back Lapsed Customers, Birthday Reward, Loyalty Tier Upgrade, Coupon Expiry Reminder, Membership Anniversary and Re-Engagement / Sunset. Clicking a starter shows a read-only preview; **Copy This Template** makes it your own draft. The starter itself never changes.

The set-up asks, in two short steps:

| Field | What it is | What it changes |
|---|---|---|
| Name | The journey's name, unique in the workspace. | |
| Entry | How customers enter: a **contact list** (its members), an **event** (for example Purchase, Abandoned Cart, Birthday, No Response), a **date or time** (a schedule, or a date on each customer's record), a **segment change** (joining or leaving a segment), or an **attribute change** (Loyalty Tier, Preference Update, Address Change). | Who is enrolled, and when. |
| Population | **Fixed**: who qualifies on the first pass after go-live, then the journey closes to newcomers. **Continuously Qualifying** and **Event Triggered**: keep enrolling as new customers qualify or new events arrive. | Whether the journey keeps growing. |
| Re-entry | **Never**, **After X Days** (since they last entered), or **Every Qualifying Event**. | Whether a customer can go through again. Nobody is ever in the same journey twice at once. |

## Date / Time entries

Choose **Date / Time**, then the Specific Trigger. The fields that follow depend on it, and a grey line under them reads the result back ("Every Monday at 9:00 AM, the members of VIP Customers enter").

| Specific Trigger | Asks for | Who enters, and when |
|---|---|---|
| Daily | At (a time); Who Enters (a customer list or a segment) | The members, every day at that time. |
| Weekly | On (one or more weekdays); At; Who Enters | The members, on those days at that time. |
| Monthly | Day of the Month (1 to 28, or Last Day); At; Who Enters | The members, once a month. |
| On a Specific Date | Date; At; Who Enters | The members, once. |
| On a Date Attribute | Date (a date on the customer's record, with how many customers have it); When (on the day, or 1 to 90 days before or after); At; Repeat (Every Year or Once); Only Customers In (optional) | Each customer on their own date. Every Year matches the day and month (birthdays, anniversaries; 29 February counts on 28 February in other years); Once matches the full date (a renewal date). |

Times are the workspace's time zone. A moment fires once: if the journey goes live after this week's moment, it waits for the next one, and a moment missed while CEP was down is not replayed (the next one fires). Re-entry (step 2) decides whether the same customers go through again: a Weekly journey with After 7 Days lets them back each week. With a Fixed population, the first moment's customers enter and the journey then closes.

The dates come from the customer records' custom attributes that hold a date (YYYY-MM-DD), as C360 sends them; CEP has no birthday field of its own. If no record holds a date yet, the Date list says so.

## Build the steps

Add steps with the **+** buttons on the canvas. Each step needs its settings before you can test publish; **Save Draft** keeps your work (nothing saves on its own).

| Step | What it does |
|---|---|
| Wait | Pauses for minutes, hours, days or weeks. |
| Condition | Splits into Yes and No: made a purchase, opened an email, clicked a link, redeemed a coupon, a specific event happened (optionally within a number of days), or is in a segment. |
| Email, SMS / MMS | Sends a published template. |
| Issue Coupon | Asks C360 for a coupon for the customer (see below). |
| Update Loyalty Tier, Update Segment | Changes the customer's tier, or adds them to or removes them from a segment. |
| Exit Journey | Ends the path. A customer who reaches an Exit counts as **Goal Converted**; end every path with one. |

**Issue Coupon.** CEP does not make coupon codes. The step leaves a request for C360, which reads the open requests, issues the coupon and marks the request done (Settings → Events → Coupon Requests for C360). The step also raises a Coupon Issue event, so another journey can start from it. A customer passing the same step again in the same enrolment asks only once.

## Test publish

**Test Publish** runs the journey on a small population first: a random sample of up to 200 qualifying customers, or a test list. Four checks must pass:

| Check | Passes when |
|---|---|
| Entry rules configured | The journey has an entry. |
| All canvas steps configured | Every step has its settings and every path ends. |
| Templates ready | Every message step's template is published. |
| Governance rules satisfied | Always passes; it tells you which frequency caps apply to the journey's messages ("Emails: at most 3 in 7 days") and that texts wait out quiet hours, 21:00 to 08:00 in the workspace's time zone. A customer over a cap is held back, not sent. |

The test **sends real messages** to that population, so use the test list. The result shows who got what, and how many were held back and why (unsubscribed, over a frequency cap, no consent, and so on).

## Approve and go live

Someone with Activate approves the tested version: **go live now**, or **at a date and time**. A scheduled journey reads *Approved* until its time; **Cancel Schedule** on the journey's page takes it back to Test, and you can approve it again for another time. Going live retires any older live version, so only one version runs at a time.

## The journey's page

| Part | What it shows |
|---|---|
| Header | Status, the trigger, the channels, and the actions your rights allow: Pause Journey / Resume Journey, Cancel Schedule, Archive Journey, Duplicate, Edit Journey. |
| Performance | Enrolled, In Journey, Goal Converted and Exited Early, with the weekly Enrollment Over Time. A Draft shows dashes. |
| Setup | The trigger, the Goal and the Exit Criteria (notes you can edit in place), re-entry, and the audience: source lists, the eligible pool and the enrolment rate. |
| Versions | Every version, newest first: its status, when it went live and when it was made. The running one is tagged **Live**. |
| Generated Campaigns | Each message step sends through a campaign, one per step per day. Open one to see its recipients and results. |
| Activity | Who created, tested, approved, paused or archived it, and when. |

## How to

**Pause a journey for a while.** Pause Journey. New customers stop entering and nobody moves; Resume Journey picks up where everyone was.

**End a journey.** Archive Journey, then confirm. Nobody new enters, everyone still in it leaves their path (counted as exited), its live and tested versions are retired and any scheduled start is dropped. It can't be undone; **Duplicate** starts the same journey again as a draft. A live, paused or scheduled journey needs Activate to archive; a draft or tested one needs Create and Edit.

**Change a live journey.**
1. Edit Journey. The builder says the version is live; Save Draft saves your changes as the next version, and the live version keeps running untouched. Population and re-entry stay as they were, since they belong to the journey.
2. On the journey's page, **Test Publish Version N** opens the new version's test. Test customers who are inside the live version are skipped.
3. Approve it. **Now**: new customers enter the new version at once, and customers already inside finish the version they started. **Later**: the live version keeps running until that time; the journey's page shows the date, and Cancel Schedule keeps the live version and leaves the new one tested, to approve again. Approving a paused journey's new version keeps the journey paused until you resume it.

**Start a journey from what the shop sends.** Choose an event entry, for example Abandoned Cart, and make sure the shop sends that event (Settings → Events). Purchases and First Purchases arrive on their own once Attribution receives the shop's orders.

## What happens behind the scenes

Four jobs run journeys. Every minute: **enroll-journey-customers** enters the customers who meet a live journey's entry (events of the last seven days at most, up to 5,000 per journey per pass); **advance-journey-customers** moves those whose next step is due; **activate-scheduled-journeys** takes approved journeys live when their time comes. Nightly, **rollup-journey-analytics** writes the Performance figures.

Only customers in the customer records enter, since a message to someone unknown could never go out. Message steps send through the normal send engine, so consent, suppressions, the preference centre, frequency caps and quiet hours all apply as they do to campaigns.

## Things to know

- Attribute changes enrol on events: **Loyalty Tier** on a Loyalty Tier Change (raised by the Update Loyalty Tier step, or sent by the loyalty system), **Preference Update** on a preference-centre save that changed something, **Address Change** on an Address Change event C360 sends. See Events.
- **No Response** means a customer sent at least 3 marketing emails in the last 30 days who opened, clicked and replied to none of them (security scanners left out). CEP raises it at most once in 30 days per customer, while a live journey starts from it.
- A customer from a Test Publish can still enter the journey for real later.
- The Split step (more than two paths) is not offered; use Conditions.
- A Fixed journey is closed to newcomers after its first pass, even if more customers would qualify later.
- Saving your own journey as a template is not offered; Duplicate copies a journey within the workspace.
- Events are explained in **Events** (Settings → Events).
