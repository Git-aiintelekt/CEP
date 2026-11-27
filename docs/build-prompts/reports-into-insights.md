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

## R2 · The missing figures

Database patch `0103_engagement_reports.sql` (applied only on the word "apply patch 0103", server by server; the ClickHouse
mirror in `apps/insights/clickhouse.py` gets the same columns).

- `reporting.rpt_messages`: `campaign_id`, `unsubscribed_n` (an opt-out recorded against the campaign by that customer),
  `send_hour` (workspace time), `journey_name` (the campaign's origin journey), and the campaign's first send.
- A campaign's **Revenue** and **Conversions** beside its message figures.
- `reporting.rpt_journey_steps` (new): message steps held back by governance or failed, per journey per day.
- Catalogue rows for the new fields; new measures Unsubscribed, Unsubscribe Rate, Held Back.
- The pack gains: First Sent, Unsub. and Revenue in Campaigns in the Period; Sent, Delivered and Held Back in Journeys in
  the Period; **Best and Worst** as in the mockup (Highest Open Rate, Highest Click Rate, Most Unsubscribes, Best Send Hour),
  which needs a four-line tile the dashboard does not have yet. The pack stays version 1: R1 and R2 ship together, before
  any server adds it.

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
