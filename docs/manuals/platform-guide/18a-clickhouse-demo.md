# ClickHouse Demo Workspace (City HT)

**Where:** the dev server (`cepdev.aiintelekt.com`): the workspace **CITYHT**, opened from People and Access → Users; its engine under Configuration → Report Engines.

## What this is for

Showing how fast Insights stays on a large workspace once its reports run on ClickHouse. City HT carries 25 million messages, 3 million orders, 2 million contacts and half a million journey enrolments; its saved reports over the 25 million messages answer in well under a second.

It is a demo workspace on the dev server only: nothing in it is real, and it is not on the release-test or production servers.

## What is in it

| Data | Rows | Where it lives |
|---|---|---|
| Messages (email and texts) | 25,012,727 | ClickHouse |
| Attributed orders and refunds | 3,002,188 | ClickHouse |
| Contacts | 2,001,500 | ClickHouse |
| Journey enrolments | 501,220 | ClickHouse |
| A small working sample: 1,500 customers, 5 lists, 13 campaigns over 15 months, 2 journeys, POS sales and returns uploads | thousands | PostgreSQL (and copied to ClickHouse) |
| 20 "Demo ·" reports in a Demo folder, and 2 dashboards | | PostgreSQL |

The large volume covers the last 24 months, busier towards today, on the sample's own campaigns (a weekly newsletter, seasonal email campaigns, e-receipts, two text campaigns) and journeys (Welcome Series, Win-Back), with realistic rates: about 23% of emails opened, 4.7% clicked, 1.8% bounced; 6% of orders refunded; 28% of orders credited to a campaign.

## Who can use it

Platform staff, through **Sign In As** on the workspace's one user, `demo.admin@cityht.example` (Workspace Admin). That user has no password, so nobody can sign in as it directly.

## Step by step

**1. Open the workspace**

1. In the back-office, open **People and Access → Users** and search for `demo.admin@cityht.example`.
2. Open the user and choose **Sign In as This User (support session)**.
3. Write a reason (for example *ClickHouse demo*), keep the access **read-only** unless you will change something, and confirm.
4. The app opens as City HT, with the support banner at the top.

**2. Show that the workspace runs on ClickHouse**

1. In the back-office, open **Configuration → Report Engines** and the CITYHT row: engine **clickhouse**, status **ACTIVE**, freshness **QUARTER_HOUR**.
2. In the app, every Insights report says under its title that the data is as of the last quarter hour.

**3. Run the saved reports**

1. In the app, open **Insights → Reports** and the **Demo** folder.
2. Open the reports in this order, each a different kind of question over the large data:

| Report | What it reads | First run (measured) |
|---|---|---|
| Demo · Channel Mix by Quarter | 25M messages, grouped by quarter and channel | 0.66 s |
| Demo · Email Funnel by Campaign | 25M messages: sent, delivered, opened, clicked per campaign | 0.54 s |
| Demo · Campaign Detail | 25M messages, every campaign and run | 0.80 s |
| Demo · What Drives Clicks | 25M messages, Key Influencers | 0.74 s |
| Demo · Weekly Sends vs the Week Before | 25M messages, a week-on-week comparison | 0.56 s |
| Demo · Attributed Revenue by Month | 3M orders | 0.05 s |
| Demo · Customers by State | 2M contacts | 0.03 s |
| Demo · Journey Conversion | 0.5M enrolments | 0.03 s |

3. Opening a report a second time is almost instant (1 to 2 milliseconds): that is the app's result cache, not ClickHouse. To show ClickHouse itself again, change a filter (for example the date range) and run it.

**4. Build a report live**

1. In **Insights → Reports**, start a new report on **Messages**.
2. Group by the month of **Created** and by **Channel**; add the counts of sent, opened and clicked messages.
3. Run it: 25 million messages are grouped and counted in under a second.
4. Add a filter on one campaign, or switch to a chart: each change runs again just as quickly.

**5. Open the dashboards**

1. Open **Insights → Dashboards → Demo · Marketing Command Centre**: every tile reads the large data at once.
2. **Demo · Store Performance** reads the POS uploads, which stay in PostgreSQL (see *Things to know*).

**6. Check the speed in the Run Log**

1. In the app, open **Insights → Run Log** (report administrators; the demo admin is one).
2. Each run is listed with its time and rows, so the timings can be shown rather than told.

**7. Compare with PostgreSQL (optional)**

1. In the back-office, on the CITYHT row of **Configuration → Report Engines**, press **Roll Back to PostgreSQL**.
2. Run the same report in the app: it now reads the small PostgreSQL sample only (about 12,700 messages), because the 25 million rows exist in ClickHouse alone.
3. To go back, press **Backfill ClickHouse** (it copies the small sample again; the 25 million rows stay where they are), then **Activate ClickHouse**.

**8. End the session**

Press **End session** on the support banner in the app, or let it expire.

## Things to know

- **Reconcile** on the Report Engines row shows PostgreSQL far smaller than ClickHouse. That is by design: the large volume was generated straight into ClickHouse, so the dev server's PostgreSQL disk is not filled.
- The quarter-hourly `refresh-clickhouse-reporting` job keeps copying the sample's recent changes to ClickHouse; it never removes the generated rows.
- The seven POS reports (store sales, returns, margins) read uploaded files, which Insights keeps in PostgreSQL whatever the engine; they are not part of the ClickHouse comparison.
- The back-office Security page lists `demo.admin@cityht.example` as an account that looks like a test account (Low). Accept the risk there with a reason such as *demo workspace on the dev server*.
- Campaigns cannot be sent from City HT: it has no sending engine.

## Rebuilding or removing the demo

The scripts that built it are on the dev server in `~/cep-demo` (they are never pushed to the repository); each runs with `manage.py shell -c "exec(open(...).read())"` under the production settings, from `/app/cep/backend`.

| Script | What it does |
|---|---|
| `create_cityht.py` | Creates the workspace and its demo admin; does nothing if they exist. |
| `seed_insights_demo.py` with `DEMO_TENANT=CITYHT` | The PostgreSQL sample, reports and dashboards; `DEMO_MODE=clean` removes them. |
| `cityht_backfill_vocab.py` | Copies the sample into ClickHouse (Backfill) and prints its values. |
| `cityht_generate.py` | Removes and regenerates the large volume inside ClickHouse, merges the tables and sets the engine to ClickHouse (about 90 seconds). |
| `cityht_timing.py` | Times the saved reports through the report runner. |

To remove the large volume only, roll the workspace back to PostgreSQL and delete the generated rows in ClickHouse (their ids start with `g`, `go`, `gj` and `CHT-`), as the start of `cityht_generate.py` does.

## Related chapters

Report Datasets and Report Engines (switching any workspace between PostgreSQL and ClickHouse); Tenants and People and Access
(the workspace and its user); Security (accepting the demo admin as a known risk).
