# Delivery Warm-Up

**Where:** Settings → Engagement · Sending → Delivery Warm-Up, below Sending Engines. The Set-Up checklist's step **Warm up your domain and IP** opens it too.

## What this page is for

Inboxes such as Gmail and Outlook trust mail from a sending IP address and domain they know. A new IP or domain that sends a lot at once goes to the spam folder or is refused. The warm-up sends a little more each day, from your own lists and templates, so the inboxes learn your mail is wanted. Until it is done, every marketing email of the workspace waits for the hour's limit.

Use it for a new workspace, a new dedicated IP address, a new sending domain, or an IP or domain that sent nothing for 30 days.

## Who can use it

Anyone with Sending Engines · Edit (`provider.edit`) starts, changes, approves, pauses and stops the warm-up. Everyone sees the warm-up's campaigns in Campaigns.

## How it works

1. **The schedule.** The warm-up follows one schedule of hourly limits by warm-up age, from 20 an hour on day 0 to over 19 million an hour on day 41, about 40% more each day.
2. **Sized to your workspace plan.** The plan ends on the first day all the contacts of your workspace plan can be emailed. With 25,000 contacts the daily plan takes 15 days and the hourly plan 14; a plan without a contact limit runs the whole schedule. Moving to a bigger workspace plan later continues the warm-up down the schedule.
3. **Each hour** CEP takes the next people of the day's lists, in list order with the most engaged first (opened or clicked in the last 30, then 90 days), and sends them the day's template. Everyone in the lists is reached once before anyone twice: day 1 sends to the first people of the list, day 2 to the next ones, and so on; when the end of the list is reached, the next round starts again from the top.
4. **Never the same template twice.** Someone the warm-up reaches again gets a template they have not had: the next days' templates first, then the extra templates you choose. Someone who has had every template is skipped and counted, and the page asks you to add a template.
5. **Your campaigns go first.** Every marketing email of the workspace waits and goes out a few at a time within the hour's limit, your own campaigns before the warm-up's. The warm-up's emails fill what the hour leaves. Receipts and other transactional email never wait, but they count towards the hour.
6. **The day is judged at midnight** (your workspace's time zone). A day is healthy when bounces stay under 2% and complaints under 0.1% (a day with fewer than 50 emails: no complaint and at most one bounce).

## Starting a warm-up

| Choice | What it means |
|---|---|
| **How Mail Leaves** | **Dedicated IP**: an IP address of your own; the IP and the domain warm up together from day 0 of the schedule. **Shared IP Pool**: warm addresses shared with other workspaces; only the domain is new, so the plan starts at day 7 of the schedule. |
| **Plan** | **Hourly Plan**: the hour's limit every hour, day and night. **Daily Plan**: the same hourly limit only inside a **sending window** you choose (08:00 to 21:00 by default), so nothing goes out at night; the day's limit is the hour's times the window's hours. **The Plan, Day by Day** shows every day's limits. |
| **Lists for Every Day** | The production contact lists the warm-up sends from. Start with your most engaged list and add others on later days. |
| **Template for Every Day** | An email template with saved content. Change any day's template once the warm-up runs. |
| **Sender** | The From address for the whole warm-up. A new sender or domain would start the warm-up again. |
| **How the Day Moves On** | **Automatic**: the next day at midnight after a healthy day that sent mail. **Approve Each Step**: a healthy day offers the next one, and someone approves it. |

## While it runs

| Part of the page | What it shows or does |
|---|---|
| **Pause / Resume** | Pause stops the warm-up's own emails; your campaigns still wait for the limit. |
| **Stop** | Ends the warm-up: its waiting emails are not sent and your campaigns go out as fast as the engine sends. |
| **Ready for day N** (Approve Each Step) | **Approve Day N** raises the limit at once; **Stay on Day N** keeps today's; **Back to Day N** goes back a day. |
| **Warm-Up Day, Today's Limit, Sent Today, Workspace Plan** | Where the plan is, and today's figures. The line under them says this hour's limit, what waits from your campaigns and from the warm-up, and today's bounce and complaint rates. |
| **Day by Day** | One row per day: its date, its limit a day and an hour, its lists, its template, what went out and was opened, and its campaigns. **Change** on today's and later days changes the lists, the template and the hourly limit, for that day or for it and the days after. A change to today applies from the next hour. |
| **How It Runs** | Automatic or Approve Each Step, and the **Templates for People Reached Again**. |

Two days in a row over a limit (Automatic) go back a day and pause the warm-up, with the reason on the page. Look at the bounces and complaints of the last campaigns, then **Resume**.

## The warm-up's campaigns

Each day's warm-up emails of one template are a campaign named after the day and the template, for example **Day 9 · Mid-Season Sale**. A change of template during the day starts a new campaign, so each campaign has one template.

- In **Campaigns** they carry the **Warm-Up** marker, the type **Warm-Up** and **Triggered By: Warm-Up**. The **Triggered By** filter shows only them (**Warm-Up**) or leaves them out (**Manual**).
- Opening one shows the usual Overview, Performance and Recipients, with a strip saying which warm-up day sent it. It cannot be edited there: change its day on this page.
- Your own campaigns sent during the warm-up say in their activity that their messages go out within the warm-up's hourly limit.

## Example: a new workspace with 25,000 contacts

City HT is on the Growth plan (25,000 contacts) with a dedicated IP. They start a daily plan from 08:00 to 21:00, Automatic, with the list Members – Active and the template Welcome to City HT News.

- Day 1 sends 20 an hour, 260 in the day, to the first 260 people of Members – Active.
- Day 5 they change days 5 to 9 to the template Weekend Offer Preview and add the list Newsletter.
- On day 8 their own campaign Weekend Offer takes 2,000 of the day's 3,835; the warm-up sends the other 1,835.
- On day 12 the round reaches the end of the lists and starts again from the top: those people get Mid-Season Sale, a template they have not had.
- Day 15 sends 25,000. From day 16 there is no limit, and the Set-Up step shows Done.

## Good to know

- The warm-up holds **every** marketing email of the workspace to its limit, including campaigns from other people and journeys.
- A test send is never held.
- CEP checks the lists, the template and the limits; reverse DNS, buying IP addresses and registering with Google Postmaster Tools and Microsoft SNDS are done outside CEP.
