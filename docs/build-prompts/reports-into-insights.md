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

## R3 · Compare from the tile, links and help (built)

No database change. Branch `reports-into-insights-r3`.

Engine (any dashboard can use these; the pack is the first to):
- **Ticking.** A grid tile may carry `tick`: the column ticked, the report to open, the question of that report the ticked values
  answer, optionally its period question, a label, and the least and the most lines (1 to 20). Each line gets a checkbox; the
  tile's header gets a button with the label and the count, on between the least and the most. It opens the report with the
  ticked values picked and the tile's own dates as its period. Saving checks that the tile's report groups by the column, and
  that the report opened asks for several values of it (`dashboards.py`, `ResultGrid.tsx`, `TileCard.tsx`, `tileActions.ts`).
- **Names that lead somewhere.** A grid tile's run says which campaign or journey is behind each name of a Campaign or Journey
  column of the platform's own datasets (`entity_links.py`, one query a tile). The grid shows an arrow after the name; it opens
  the campaign or the journey in Engagement. A name two campaigns share has no arrow: its line counts both.
- **Empty words.** A grid, chart, hierarchy or pivot tile may carry `empty`: a title, a sentence, and a button to a page of the
  app. It shows in place of the view when the period has no line.

The pack (version 2: its dashboard changed; reports unchanged):
- Campaigns in the Period: tick two to six, **Compare Campaigns** opens the pack's Compare Campaigns report with them. Empty:
  "No Campaign Sent in This Period", "Results show here from the first send. Try a longer period, or send a campaign.",
  **Go to Campaigns**.
- A workspace that added version 1 keeps its dashboard as it is (a pack never changes what was added); adding the pack again
  makes new copies. No workspace on .51 or .68 had added it when this was built.

Links to `/reports`:
- Home's opportunity card (View Insight) and the weekly email's Open Reports lead to the dashboard when the workspace has
  Engagement, Insights and a dashboard the whole workspace can open; otherwise to `/reports` as before.
- The dashboard's help icon opens a new chapter, **Engagement Overview: Campaign and Journey Results**
  (`docs/manuals/user-guide/59a-engagement-overview.md`), filed after the Insights chapter. The Reports chapter stays for the
  old page and says at its top where Reports leads once it is marked Insights ↗.

**Where this differs from the plan, and what is not built** (raised, not decided):
- **The name is not itself the link.** On a dashboard a click on a value filters the other tiles; a campaign's name already does
  that. So the name keeps that click and an arrow after it opens the campaign. Making the name the link would take the filter
  away from that column.
- The Reports help chapter is not rewritten: the old page is still there for workspaces without the dashboard, so it keeps its
  chapter until R4 retires the page.
- The four key figures say "0" and "—" when nothing was sent; the mockup's small lines under them ("Nothing sent yet") are not
  built. The two charts say "Nothing to show yet." rather than drawing a flat line.
- In a grid with ticks or name links, the name's column is half as wide again as the others and the others may narrow to 100
  pixels (120 elsewhere), so a name with its arrow stays readable at a normal window width. Other grids are unchanged.
- The dashboard editor's Add panel cannot set ticking or empty words by hand yet; the pack sets them, and the editor keeps them.
- A campaign or journey deleted since has no arrow. A ticked campaign that drops out of the rows (a new period) is no longer
  counted.

## R4 · The weekly email, and retiring the old page

- Each workspace's weekly report email (Schedule Report) is recreated once as an Insights schedule of the dashboard.
- Old and new figures compared per workspace over the same period; differences listed and explained.
- The old page is removed for workspaces with the dashboard only on the user's word. What a workspace without Insights
  keeps is decided then.

## Open questions (raised, not built)

- Should the old page tell an administrator that Engagement Reports can be added in Insights? Not in the mockup.
- A workspace with Engagement but no Insights: keep the old page for good, or give it Insights' engine without the app (Option B's way)?
