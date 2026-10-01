# Home page: where its figures come from, and what one load costs

Home is the operating cockpit: the greeting, Create New, Needs Attention, Marketing Performance with the page-wide filters
(campaigns, channel, period), then the cards. The front end never fetches on its own; every section reads a hook on the
Home data source (`frontend/src/features/home/data/liveSource.ts`), and the page hides a card whose data the API cannot
give the viewer.

## What feeds each section

| Section | Request | Notes |
|---|---|---|
| Needs Attention | `GET /home/overview/` (`attention`) | failed production sends in the last week (ids), test-published campaigns, campaigns waiting for approval. Bounce rate, frequency cap and journey-step alerts still have no source. |
| Marketing Performance (KPIs) | `GET /reports/summary/` for the period and the one before | store revenue and a summed revenue target are not available yet, so Campaign Contribution says so |
| Top and Bottom Campaigns | the same two summaries, joined with `GET /campaigns/?status=…&page_size=200` for each campaign's target | ranks by revenue against target; by click rate when attribution is not set up |
| Attributed Revenue vs. Campaign Cost | `GET /home/overview/` (`revenue_cost`) | per campaign: attributed revenue and cost from `campaign_actual` (else the campaign's planned cost), spread over the days it sent in proportion to its sends; weekly points over a month; the target pace is the campaigns' revenue targets over the period |
| Engagement Funnel | the current period's summary | `by_channel` for the counts, the campaign rows for conversions |
| Next 7 Days | `GET /campaigns/calendar/` | journey runs arrive as journey-generated campaigns |
| Active Journeys | `GET /home/overview/` (`journeys`) | active and paused journeys with `journey_enrollment` counts: in flight (ACTIVE), entered (all), conversion (COMPLETED ÷ entered). A journey whose last run failed reads Failed with the step's channel and time. Null (card hidden) without the journeys feature. |
| Recent Campaigns | `GET /campaigns/?ordering=-updated_at&page_size=50` joined with the summary and the overview's failed ids | the other sorts are within those 50 |
| Governance | `GET /home/overview/` (`governance`) | the period's campaign lists: distinct people contacted, distinct people held back by frequency cap, no consent (no consent, unsubscribed, topic unticked) and the suppression list (suppressed, blocked, invalid address) |
| E-Receipts | the current period's summary, e-receipt campaign rows only | the marketing figures leave e-receipts out |

`GET /home/overview/?from&to&channel&campaigns=a,b` answers the four overview parts in one request. A part the viewer may
not read is null: revenue and governance need `report.view`; journeys need the journeys feature and `journey.view`.
Marketing only: e-receipt campaigns are left out, as the report leaves them out.

## Query budget

Measured on the NWA workspace (`scratchpad/measure_home.py`, rolled back), every request a fresh Home load makes,
counting SQL statements on the tenant connection.

| | Requests | SQL queries | Notes |
|---|---|---|---|
| Before (2026-10-01, design v2 release) | 8 | 78 | three campaign-list calls just for the alert counts; the report read each execution table four times |
| After, cold cache | 6 | 70 | with the three cards that were hidden before |
| After, within 30 s | 6 | 47 | the summary and the overview are kept for 30 s (`RESULTS_CACHE_TTL`) |

What changed:

- **One overview instead of three list calls.** Needs Attention read `/campaigns/` three times (view=attention, status=TEST_PUBLISHED, approval=requested), 18 queries and three round trips for three numbers. The overview counts them in two queries, and Recent Campaigns takes the failed ids from the same answer.
- **The report reads each execution table once.** `reports.summary()` ran four scans per channel (totals, per day, per campaign, per hour). One `GROUP BY GROUPING SETS ((day), (campaign), (hour), ())` pass gives all four; campaign names come from one lookup on the ids. 15 queries became 10 for the current period, 13 became 8 for the previous one.
- **30 s cache on the summary and the overview.** Home asks for the current summary from four sections (deduplicated in the browser) and again on every visit; a second load inside 30 s costs 5 queries per request instead of 10 to 19. Figures on Home are not billing-accurate, so a short lag is fine.
- **The campaign list joins the topic.** `topic_name` was one query per campaign with a topic.

Still the largest cost: the two campaign-list calls (page size 200 and 50) at 11 queries each, mostly the prefetches
every list row needs (runs, contact lists, targets). A lighter `fields=` answer for Home would take those to two or
three queries each; not done here because the Campaign filter and Top and Bottom share that list with the campaigns page.

## Sample data

`/dev/home` (dev builds only) shows the page on sample data with switches for the account state (Busy, Light, No
Attribution, No Alerts, Cards Missing) and the viewer. Cards Missing is what a viewer without `report.view` sees in a
workspace without journeys: Revenue vs. Cost, Governance and Active Journeys hidden, the rest packed two per row.
