# Engagement Reports in Insights: build prompt

Approved mockup: `docs/mockups/reports-into-insights.html`, **Option A: Reports Opens Insights** (picked 2026-11-27).
Reports stays in Engagement's menu, marked as leading to Insights; clicking it opens the Insights app on the
**Engagement Overview** dashboard. Built phase by phase, R1 to R4, on the branch `reports-into-insights`.

## What the code showed after the mockup

Two lines of the mockup's "To Build" column were wrong, and one thing was missing from it.

- **Text messages need no new dataset.** Insights already has a **Messages** dataset over C360's own records, emails and
  texts together, with Sent, Delivered, Opened, Clicked, Bounced, Complaints, Failed and their rates. The Email Campaign
  Reports pack is a different thing: it reads a Postal database through a connection, and is not used here.
- **Journeys already has a dataset** (Journey Enrollments: Entered, Active, Converted, Revenue, Conversion Rate). What it
  lacks is the journeys' messages (Sent, Delivered) and Held Back.
- **Missing from today's datasets:** Unsubscribes, First Sent, Revenue beside a campaign's message figures, Best Send Hour,
  and the journey columns above. These need new columns in the reporting views: a database patch (R2).
- **A workspace gets the dashboard by adding a pack.** Insights makes ready-made reports as a workspace's own copies when an
  administrator adds a base pack (Insights → Reports → Base Reports). Nothing makes them by itself.

## Defaults taken where the mockup is silent

- **The old Reports page stays** for a workspace without Insights, and for one that has not added the pack yet. The menu item
  shows "Insights ↗" and opens the dashboard only when the workspace has Insights and an Engagement Overview. Nothing is
  taken away in R1 to R3.
- **An administrator adds the pack** (report.admin or user.admin), as with every base pack. It is offered only to a workspace
  with both Engagement and Insights.
- **Everyone with report.view sees it:** the pack's reports and dashboard are made visible to the workspace, as packs are today.
- **Insights' figures follow Insights' rules.** The Messages dataset counts a message by the day it was sent and as delivered
  when it has a delivery time; the old page counts by the day it was created and by status. Totals can differ by a few
  messages at a period's edges. R4 compares them per workspace before anything is retired.
- **Test sends are left out** of every report in the pack, as on the old page.
- **Period:** the dashboard opens on the last 30 days (the old page opens on the current month). **Channel** is a slicer.

## R1 · The dashboard on today's data, and the way in

No database change.

Back end (`backend/apps/insights/`):
- `base_packs/`: a pack may read the platform's own datasets. Such a pack has no `needs` (no connection, no options, no
  datasets of its own); its reports name a platform dataset by key. `base_reports.py`: `describe`, `check` and `add` work
  without a connection for it; `add` records the install with no connection.
- `base_packs/engagement.py`, key `engagement`, components `cep` + `insights`, folder **Engagement Reports**:
  - **Engagement Totals** (Messages): Sent, Delivered Rate, Open Rate, Click Rate, Delivered, Opened, Clicked, Bounced, Complaints.
  - **Sent and Opened by Day** (Messages): by day; a chart.
  - **Campaigns in the Period** (Messages): Campaign, Channel, Sent, Delivered Rate, Open Rate, Click Rate, Bounce Rate.
  - **Best Campaigns by Open Rate**, **Best Campaigns by Click Rate** (Messages): top five; charts.
  - **Compare Campaigns** (Messages): the campaigns picked in its Campaigns filter, side by side.
  - **Journeys in the Period** (Journey Enrollments): Journey, Journey Status, Entered, Converted, Conversion Rate, Revenue.
  - Dashboard **Engagement Overview**: four figures; Sent and Opened by Day beside the two Best charts; Campaigns in the
    Period; Journeys in the Period. Period last 30 days, compared with the period before. Slicer: Channel.
- `GET /insights/base-reports/`: each addition also lists the dashboards it made that still exist (id and name), so the
  front end can find Engagement Overview.

Front end:
- `apps/insights/components/BaseReportsDialog.tsx`: a pack without a connection skips the connection and options steps: what it
  brings, then Add.
- `apps/cep/manifest.ts` + `components/AppShell.tsx`: the Reports item. With Insights and an Engagement Overview it reads
  **Reports** with the marker **Insights ↗** and opens `/insights/dashboards/<id>`; otherwise it opens `/reports` as today.
- `/reports` itself is not changed.

Tests: `backend/tests/test_insights_base_reports.py` (the pack's field keys exist in the catalogue; adding it makes the
folder, seven reports and the dashboard in one transaction; a workspace without Engagement is not offered it);
`BaseReports.test.tsx`; a menu test for both states.

Done when: on a workspace with the pack added, Reports in Engagement's menu opens Engagement Overview with real figures;
on one without, Reports opens the old page.

## R2 · The missing figures (built)

**What the code showed.** Insights could already work out three of the figures with no new column: First Sent (the earliest send
of a campaign's messages in the period, a "min" total), Send Hour (a custom field of the report, `HOUR` in the workspace's own
time) and Revenue (Attributed Orders blended into the Messages report). So the patch is smaller than planned above.

Database patch `0103_engagement_reports.sql` (applied only on the word "apply patch 0103", server by server). It replaces views
with their columns added at the end; no table is altered and no row is rewritten.

- `reporting.rpt_messages` gains `campaign_channel` (the campaign's own channel: EMAIL, SMS, MMS, MULTI), `unsubscribed_n` (an
  opt-out that this message's link or reply carried) and `journey_name` (the journey that made the campaign). A report that reads
  none of them does not pay for the joins (checked on the query plan).
- `reporting.rpt_attributed_orders` gains `campaign_channel`.
- `reporting.rpt_journey_steps` (new), dataset **Journey Messages**: a row per message a journey's campaigns sent (test runs
  left out) and a row per message step held back by governance or failed. Linked to Journey Enrollments by the journey.
- Catalogue: Campaign Channel, Journey, First Sent, Unsubscribed and Unsubscribe Rate on Messages; Campaign Channel on
  Attributed Orders; the Journey Messages fields.
- **A correction to what is there.** Messages and Attributed Orders were linked on "channel" as well as the campaign's name.
  That never matched: a message's channel is EMAIL or SMS, an order's is where it was placed (ONLINE, STORE). A report grouped
  by campaign and channel showed no revenue. They are now linked on the campaign's own channel. Only the seeded pairs change. A
  saved report that blends the two and groups by the message's Channel will ask to be grouped by Campaign Channel instead.
- The reporting role may read `consent_record`, `journey_generated_campaign`, `journey_node_execution` and `journey_node`.
- ClickHouse (`apps/insights/clickhouse.py`): the same columns and the new table; a table made earlier gains a missing column
  the next time the workspace's data is refreshed. Not run against a live ClickHouse server here.

The pack (still version 1; nine reports):
- **Campaigns in the Period**: Campaign, Channel (the campaign's), First Sent, Sent, Delivered, Open Rate, Click Rate, Unsub.,
  Revenue: the mockup's columns. One line per campaign, newest first.
- **Journeys in the Period**: Journey, Status, Entered, Converted, Conversion Rate, Revenue, Sent, Delivered, Held Back.
- **Best Campaigns by Open Rate**, **by Click Rate**, **Campaigns by Unsubscribe Rate**: the five highest. A campaign is rated
  only from 50 sends, as on the old page (the old page fell back to every campaign when none had 50; here the list is empty).
- **Open Rate by Send Hour**: emails by the hour they went out, the best hour first; an hour counts from 50 delivered.
- **Best and Worst**: four figures in a row (Highest Open Rate, Highest Click Rate, Most Unsubscribes, Best Send Hour), each
  the first line of one of the reports above: its figure, and its name under it.

Engine: a dashboard figure may read a report's first line (`line: "first"` on a figure tile) in place of the period's total.
The PDF, the slides and a tile's "Show the Numbers" print the line's name.

**A fault of R1, corrected here.** Insights gives every new report on a dataset with a campaign a Campaign filter, the latest
campaign by default. The pack's reports did not ask for campaigns themselves, so each got that filter and the dashboard would
have counted the latest campaign only. Every report on Messages now asks Campaigns with no default.

**Where this differs from the mockup, and what is not built** (raised, not decided):
- Best and Worst is four figures in a row, not one tile of four lines: a dashboard tile reads one report, and the four lines
  come from four. One tile of four lines needs a tile that reads several reports.
- The dashboard editor's Add panel cannot make a first-line figure by hand yet; the pack makes them, and the editor keeps them.
- Unsubscribes are counted on the message whose link or reply carried the opt-out, on the day it was sent. The old page counts
  an opt-out by the campaign recorded on it, on the day it happened. An opt-out with no message (the preference centre) is
  not in the dashboard's count.
- A campaign's Revenue is its orders placed in the period (Attributed Orders). The old page shows the campaign's whole
  attributed revenue whatever the period.
- In a tile of nine columns the campaign's name is cut short at a normal window width: the grid gives every column the same
  width (columns can be dragged wider). Changing the grid's widths is a change to every Insights report, so it is left.

## R3 · Compare from the tile, links and help

- Tick two to six campaigns in the Campaigns in the Period tile, then **Compare Campaigns** opens that report with them picked.
- A campaign's name in the tile opens the campaign in Engagement; a journey's name opens the journey.
- Links to `/reports` from Home, help and emails open the dashboard when the workspace has it.
- The Reports help chapter is rewritten for the dashboard and listed under Insights.
- The sparse state: "No Campaign Sent in This Period" with **Go to Campaigns**, as in the mockup.

## R4 · The weekly email, and retiring the old page

- Each workspace's weekly report email (Schedule Report) is recreated once as an Insights schedule of the dashboard.
- Old and new figures compared per workspace over the same period; differences listed and explained.
- The old page is removed for workspaces with the dashboard only on the user's word. What a workspace without Insights
  keeps is decided then.

## Open questions (raised, not built)

- Should the old page tell an administrator that Engagement Reports can be added in Insights? Not in the mockup.
- A workspace with Engagement but no Insights: keep the old page for good, or give it Insights' engine without the app (Option B's way)?
