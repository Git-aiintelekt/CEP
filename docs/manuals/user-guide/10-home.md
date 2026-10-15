# Home

**Where:** Home in the main navigation, and the C360 mark at the top of the rail.

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
