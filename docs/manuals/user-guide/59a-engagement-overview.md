# Engagement Overview: Campaign and Journey Results

**Where:** Insights → Dashboards → Engagement Overview. In Engagement's menu, **Reports** marked **Insights ↗** opens it.

## What this page is for

Engagement Overview shows how the workspace's campaigns and journeys performed over a period: what was sent, what was delivered, opened and clicked, who unsubscribed, the revenue credited to each campaign, and what each journey did. It is a dashboard of Insights, made of ordinary Insights reports, so each figure can be opened, changed, exported, scheduled and shared like any other report.

It takes the place of Engagement's own Reports page for a workspace that has both Engagement and Insights. The older page stays for a workspace without Insights, and for one that has not added the dashboard yet (see the Reports chapter).

## Who can use it

Anyone whose role carries Reports · View (`report.view`). The dashboard and its reports are shared with the whole workspace.

An administrator (Reports · Admin or User Admin) adds it once: Insights → Reports → New Report → Use Base Reports → **Engagement Reports**. That makes the dashboard and nine reports in a folder named Engagement Reports. They are the workspace's own copies and can be edited.

## The fields and controls

| Control | What it does |
|---|---|
| Period | The last 30 days when the page opens. Pick another span or a custom range; every tile follows. |
| Compare | Each key figure also shows its change against the period of the same length just before. |
| Channel | Narrows every tile to Email, SMS or MMS messages. |
| Refresh | Runs every tile again. |
| A tile's ⋯ | Open the Report, Show the Numbers, Export CSV, Comment. |
| Share, Edit | Who else can open the dashboard; change its tiles. |
| More Actions | Comments, Schedule (the dashboard by email), Export PDF and Export PowerPoint. |

### The tiles

| Tile | What it shows |
|---|---|
| Sent, Delivered, Opened, Clicked | Every email and text sent in the period, and the shares delivered, opened and clicked. Test sends are left out. |
| Sent and Opened by Day | The daily curve. |
| Best by Open Rate | The five campaigns with the highest open rate. |
| Highest Open Rate, Highest Click Rate, Most Unsubscribes, Best Send Hour | The best and the worst of the period: the campaign (or the hour) and its rate. A campaign is rated from 50 sends, an hour from 50 delivered emails. |
| Campaigns in the Period | One line per campaign that sent anything: its channel, when it first sent, sent, delivered, open rate, click rate, unsubscribes and revenue. |
| Journeys in the Period | One line per journey customers entered: its status, entered, converted, conversion rate, revenue, and its messages sent, delivered and held back. |

## How to

1. **Compare campaigns.** In Campaigns in the Period, tick two to six campaigns, then choose **Compare Campaigns** in the tile's header. The Compare Campaigns report opens with those campaigns picked, over the dashboard's dates.
2. **Open a campaign or a journey.** The arrow after a campaign's or a journey's name opens it in Engagement.
3. **Look at one campaign across the page.** Click a campaign's name: the other tiles narrow to it. Click it again, or remove it from the bar above the tiles, to see everything.
4. **Keep the numbers.** A tile's ⋯ → Export CSV for one tile; More Actions → Export PDF or Export PowerPoint for the whole dashboard.
5. **Get it by email.** More Actions → Schedule: the dashboard, on the days and to the people you choose.
6. **Change a tile.** A tile's ⋯ → Open the Report, then Edit. The report is the workspace's own copy.

## What happens behind the scenes

Each tile runs one saved report over the dashboard's period and Channel. The reports read the Messages and Journey Enrollments datasets, with Attributed Orders and Journey Messages joined in for revenue and for the journeys' messages.

## Things to know

- **A message counts on the day it was sent**, and as delivered when it has a delivery time. Engagement's older Reports page counts by the day a message was created, so the two can differ by a few messages at a period's edges.
- **Unsubscribes** are counted on the message whose link or reply carried the opt-out. An opt-out made in the preference centre, with no message behind it, is not in this count.
- **Revenue** is the orders placed in the period and credited to the campaign.
- **No Campaign Sent in This Period** means the period has no send. Try a longer period, or go to Campaigns.
- A name that two campaigns share has no arrow: its line counts both.
- Deleting the dashboard sends Reports in Engagement's menu back to Engagement's own page. Adding Engagement Reports again makes a new one.
