# Reports

**Where:** Reports, in the main menu.

## What this page is for

Reports shows how the workspace performed over a period, from the figures CEP already records: sends, deliveries, opens, clicks, bounces, complaints, unsubscribes and attributed revenue. Nothing is collected here that the campaigns and journeys do not already keep. Two datasets share the page: **Campaigns** (the default) and **Journeys**.

## Who can use it

Anyone whose role carries Reports · View (`report.view`). Scheduling the weekly email needs User Admin (`user.admin`). The Journeys dataset is offered when the workspace has the Journeys feature.

## The fields and controls

| Control | What it does |
|---|---|
| Dataset | **Campaigns** or **Journeys**. The period applies to both; the other controls change with the dataset. |
| Period | This Month, Last 7 Days, Last Month, or Custom (a start and an end date, in the workspace's time zone). |
| Channel (Campaigns) | All Channels, Email or SMS. |
| Journey (Journeys) | Every Journey, or one journey of the workspace. |
| Export CSV | The dataset being shown as a file: the campaigns of the period, or every journey's every day. |
| Schedule Report (Campaigns, administrators) | The weekly email: the day, the hour and who receives it. |

### The Campaigns dataset

Four tiles (Sent, Delivered, Opened, Clicked, each with its rate and a note), **Sent and Opened by Day** (Sent and Delivered for SMS), **Best and Worst** (the highest open rate, the highest click rate, the most unsubscribes, the best send hour, over campaigns with at least 50 sends) and **Campaigns in the Period**, one row per campaign that sent anything, with a checkbox to pick two to six and **Compare** them side by side.

### The Journeys dataset

| Part | What it shows |
|---|---|
| Entered | Customers who entered a journey in the period, and how many journeys had any activity. |
| Converted | Customers whose goal was reached in the period (or, in a journey without a Goal step, who reached an Exit), the conversion rate over those entered, and the attributed revenue. |
| Messages Sent | The journeys' messages sent in the period, with the delivered rate and how many a step held back (consent, suppressions, caps, quiet hours) or failed. |
| Opened | The open rate over those delivered, and the click rate. |
| Entered and Converted by Day | The daily curve for the period. |
| Journeys in the Period | One row per journey: its status, entered, converted (with the rate), revenue, sent, delivered, open and click rates, held back and failed. The name opens the journey's page. |

The CSV has a finer grain than the table: one row per journey per day, with every figure above, and a total line.

## How to

1. **Read a month.** Leave Period on This Month; switch Dataset to Journeys to see the journeys' side of the same month.
2. **Follow one journey.** On the Journeys dataset choose it under Journey; every tile, the curve and the CSV narrow to it.
3. **Keep the numbers.** Export CSV while the period and the filter are set; the file is named for the dataset and the period.

## What happens behind the scenes

The Campaigns dataset reads the execution tables once per channel for the period and keeps the answer for 30 seconds. The Journeys dataset reads enrollments (entered by the day they entered, converted by the day the goal was reached, with their revenue), the journeys' generated campaigns' messages (test runs left out) and the message steps that were held back or failed, in the workspace's time zone, and keeps the answer for 30 seconds as well. A journey deleted since stays out of the figures.

## Things to know

- Rates over fewer than 50 sends are left out of Best and Worst.
- The Journeys dataset counts a message on the day it was sent, an entry on the day the customer entered, and a conversion on the day the goal event arrived, so the three can fall on different days for the same customer.
- Held back is the message steps governance stopped (no consent, a suppression, a frequency cap, quiet hours); the journey page's Customers card can list the customers behind each reason.
- The weekly email carries the Campaigns dataset.
