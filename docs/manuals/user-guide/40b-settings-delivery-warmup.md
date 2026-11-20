# Delivery Warm-Up

**Where:** Settings → Engagement · Sending → Delivery Warm-Up, below Sending Engines. The Set-Up checklist's step **Warm up your domain and IP** opens it too.

## What this page is for

Inboxes such as Gmail and Outlook trust mail from a sending IP address and domain they know. A new IP or domain that sends a lot at once goes to the spam folder or is refused. The warm-up sends a little more each day, from your own lists and templates, so the inboxes learn your mail is wanted. Until it is done, every marketing email of the workspace waits for the hour's limit.

Use it for a new workspace, a new dedicated IP address, a new sending domain, or an IP or domain that sent nothing for 30 days.

## Who can use it

| | |
|---|---|
| Permission | Sending Engines · Edit (`provider.edit`) to open this page and to start, change, approve, pause and stop the warm-up. |
| Campaigns | Everyone who can see campaigns sees the warm-up's campaigns in Campaigns. |

## The fields and controls

### Starting a warm-up

The banner at the top says what the plan is sized to: *Sized to your workspace plan: {plan}, {n} contacts*, or *Your workspace plan has no contact limit: the whole schedule, 42 days*.

| Control | What it is | What it changes |
|---|---|---|
| 1 · How Mail Leaves | **Dedicated IP** (default): an IP address of your own. **Shared IP Pool**: already warm addresses shared with other workspaces. Each card shows how many days and what limits the choice gives. | Dedicated IP warms the IP and the domain together from day 1 of the schedule (20 an hour). Shared IP Pool warms only the domain, so the plan starts a week further along the schedule (211 an hour) and ends sooner. |
| 2 · Plan | **Hourly Plan** or **Daily Plan** (default). | Hourly Plan lets the hour's limit out every hour, day and night. Daily Plan lets the same hourly limit out only inside the sending window, so nothing goes out at night; the day's limit is the hour's limit times the window's hours. |
| Sending Window From / To | Shown for the Daily Plan. Default 08:00 to 21:00, in the workspace's time zone. | Outside the window nothing held by the warm-up goes out, your own marketing campaigns included. A window that ends before it starts is refused: *The window must end after it starts, on the same day.* |
| The Plan, Day by Day | A fold-out table of every day's limit an hour and a day for the choices above. | Nothing; it shows what the choices give before you start. |
| 3 · Lists for Every Day | The workspace's active production contact lists (test and archived lists are not offered), with their member counts. At least one is needed. | The people the warm-up emails, taken in list order with the most engaged first. Start with your most engaged list and add others on later days. |
| 4 · Template for Every Day | Email templates with saved content. | The email every day sends until you change a day. |
| Sender | Email senders; an unverified one is marked *(not verified)*. Defaults to the workspace's default email sender. | The From address for the whole warm-up. It cannot be changed later: a new sender or domain would start the warm-up again. A sender not on an active engine is refused: *Choose an email sender on an active engine.* |
| 5 · How the Day Moves On | **Automatic** (default) or **Approve Each Step**. | Automatic moves to the next day at midnight after a healthy day that sent mail. Approve Each Step offers the next day and stays on the current one until someone approves it. |
| Start Warm-Up | Enabled once lists, a template, a sender and a valid window are chosen. | Starts day 1 today: from then on every marketing email of the workspace waits for the hour's limit. Refused while another warm-up runs: *A warm-up is already running. Stop it before starting another.* |

### While it runs

| Control | What it is | What it changes |
|---|---|---|
| The status tag | Warming, Paused, Warm (finished) or Stopped, with the choices made at the start and the sender. | Nothing; a reading. While Warming or Paused, every marketing email of the workspace is held to the hour's limit. |
| Pause | Shown while warming. | Stops the warm-up's own emails. Your campaigns still wait for the hour's limit. |
| Resume | Shown while paused. | The warm-up's own emails go out again, and the count of days over a limit starts again from zero. |
| Stop | Opens **Stop the Warm-Up?** | **Stop the Warm-Up** ends it: warm-up emails still waiting are not sent, and your campaigns go out as fast as the engine sends. Stopping early on a new IP or domain risks the spam folder. **Keep Warming** closes the dialog and changes nothing. |
| Ready for day N (Approve Each Step) | Shown after a healthy day. | **Approve Day N** raises the limit at once. **Stay on Day N** keeps today's limit and withdraws the offer. **Back to Day N** goes back a day, to that day's lower limit (not offered on day 1). |
| N people have had every template | Shown when people were skipped. **Add Templates** opens Templates for People Reached Again. | Adding a template lets those people be emailed again on the next round. |
| Warm-Up Day, Today's Limit, Sent Today, Workspace Plan | Where the plan is, and today's figures. The lines under them give this hour's limit, what waits from your campaigns and from the warm-up, and today's bounce and complaint rates against the limits. The page refreshes every minute. | Nothing; a reading. A bounce or complaint rate over its limit at midnight holds the day. |
| Day by Day | One row per day: its date, its limit a day and an hour, its lists, its template, what was sent and opened, and its campaigns (each opens the campaign). A held day says *Nothing sent: held* or *Over a limit: held*. | Nothing by itself; **Change** on a row changes that day. |
| Change | On today's and later days. Opens **Change Day N**. | See the Change Day dialog below. |
| How the Day Moves On (How It Runs) | Automatic or Approve Each Step. | Switches how the next days move on. Switching to Automatic withdraws a day waiting for approval; the next healthy day moves on by itself at midnight. |
| Templates for People Reached Again | *Only the days' templates* until you choose some. **Change** opens the list of email templates with saved content. | Someone reached again gets the next days' templates first, then these, in this order. Without them, someone who has had every template is skipped. |
| Start a New Warm-Up | Shown when the warm-up is Warm or Stopped. | Opens the start form again, for a new IP or domain. |

### The Change Day dialog

| Control | What it is | What it changes |
|---|---|---|
| Lists | The production lists, with member counts. At least one. | Who the day emails. |
| Template | An email template with saved content. | The day's email. Someone who already had it gets the next template they have not had. |
| Hourly Limit | A whole number, at least 1, with the day's total under it. | The day's hourly limit, and so its daily limit. |
| Apply To | **Day N Only** (default) or **Days N to M**, up to the last day (*the End*). | Whether the change is for this day only or for it and every day after it up to the one you pick. |
| Save Day N / Save Days N to M | | Saves the change. A change to today applies from the next hour; what went out already stays as it was. Days already sent cannot be changed. |

The From address is not offered here: a new sender or domain would start the warm-up again.

## How to

**Start a warm-up for a new workspace.** Choose Dedicated IP, Daily Plan with the window your customers read mail in, your most engaged list, a template, the sender and Automatic → **Start Warm-Up**.

**Add a list from day 5 on.** Day by Day → day 5 → **Change** → tick the list → Apply To: the last day → **Save Days 5 to …**.

**Resume after a pause for bounces.** Look at the bounces and complaints of the last warm-up campaigns, fix the list if needed, then **Resume**.

## What happens behind the scenes

1. **The schedule.** The warm-up follows one schedule of hourly limits, from 20 an hour on its first day to over 19 million an hour on its 42nd, about 40% more each day.
2. **Sized to your workspace plan.** The plan ends on the first day all the contacts of your workspace plan can be emailed. With 25,000 contacts the daily plan takes 15 days and the hourly plan 14; a plan without a contact limit runs the whole schedule. Moving to a bigger workspace plan later continues the warm-up down the schedule.
3. **Each hour** C360 takes the next people of the day's lists, in list order with the most engaged first (opened or clicked in the last 30, then 90 days), and sends them the day's template. Everyone in the lists is reached once before anyone twice: day 1 sends to the first people of the list, day 2 to the next ones, and so on; when the end of the list is reached, the next round starts again from the top.
4. **Never the same template twice.** Someone the warm-up reaches again gets a template they have not had: the next days' templates first, then the extra templates you choose. Someone who has had every template is skipped and counted, and the page asks you to add a template.
5. **Your campaigns go first.** Every marketing email of the workspace waits and goes out a few at a time within the hour's limit, your own campaigns before the warm-up's. The warm-up's emails fill what the hour leaves. Receipts and other transactional email never wait, but they count towards the hour.
6. **The day is judged at midnight** (your workspace's time zone). A day is healthy when bounces stay under 2% and complaints under 0.1% (a day with fewer than 50 emails: no complaint and at most one bounce). Two days in a row over a limit (Automatic) go back a day and pause the warm-up, with the reason on the page.
7. **The end.** After the last day the warm-up is Warm: there is no limit any more. Your campaigns' emails still held go out at once; warm-up emails still waiting are not sent.

### The warm-up's campaigns

Each day's warm-up emails of one template are a campaign named after the day and the template, for example **Day 9 · Mid-Season Sale**. A change of template during the day starts a new campaign, so each campaign has one template.

- In **Campaigns** they carry the **Warm-Up** marker, the type **Warm-Up** and **Triggered By: Warm-Up**. The **Triggered By** filter shows only them (**Warm-Up**) or leaves them out (**Manual**).
- Opening one shows the usual Overview, Performance and Recipients, with a strip saying which warm-up day sent it. It cannot be edited there: change its day on this page.
- Your own campaigns sent during the warm-up say in their activity that their messages go out within the warm-up's hourly limit.

### Example: a new workspace with 25,000 contacts

City HT is on the Growth plan (25,000 contacts) with a dedicated IP. They start a daily plan from 08:00 to 21:00, Automatic, with the list Members – Active and the template Welcome to City HT News.

- Day 1 sends 20 an hour, 260 in the day, to the first 260 people of Members – Active.
- Day 5 they change days 5 to 9 to the template Weekend Offer Preview and add the list Newsletter.
- On day 8 their own campaign Weekend Offer takes 2,000 of the day's 3,835; the warm-up sends the other 1,835.
- On day 12 the round reaches the end of the lists and starts again from the top: those people get Mid-Season Sale, a template they have not had.
- Day 15 sends 25,000. From day 16 there is no limit, and the Set-Up step shows Done.

## Things to know

- The warm-up holds **every** marketing email of the workspace to its limit, including campaigns from other people and journeys.
- A test send is never held.
- Only one warm-up runs at a time.
- C360 checks the lists, the template and the limits; reverse DNS, buying IP addresses and registering with Google Postmaster Tools and Microsoft SNDS are done outside C360.
