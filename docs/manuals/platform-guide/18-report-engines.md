# Report Datasets and Report Engines

**Where:** Configuration → Report Datasets, and Configuration → Report Engines.

## What these pages are for

Insights, the suite's reporting app, lets a workspace build its own reports, dashboards and scheduled deliveries on
the data the platform already keeps. Two things make that possible and both live here:

- **Report Datasets** is the catalogue: what a report can be built on (a dataset such as Messages or Attributed
  Orders), which fields each dataset offers, how each field may be filtered, grouped and totalled, how it is
  displayed, and how sensitive it is. Report authors see labels, never table or column names.
- **Report Engines** says, per workspace, which analytics engine runs its reports: **PostgreSQL**, the live reporting
  views on the workspace's own database, or **ClickHouse**, reporting tables loaded from those views. It also holds the
  workspace's query limits.

Nothing on these pages changes a workspace's data. They decide what can be reported on, where the query runs and how
much of the engine one workspace may use.

## How a report runs

A report is a definition: columns (dimensions to group by, measures to total), filters, a sort, a limit and a view.
The engine checks the definition against the catalogue, compiles it to SQL for the workspace's engine with every value
bound as a parameter and the workspace restriction always present, and runs it as one short read-only query under a
statement timeout, a row cap and a per-workspace cap on concurrent runs. Every preview, run, export and scheduled
delivery is written to the run log (Insights → Run Log in the app, for report administrators). A query that runs
too long is stopped and the person is told to narrow it; nothing else in the platform is affected. On the dev server
the engine runs as its own process, `cep-insights`, so a heavy report cannot slow the app.

## Report Datasets

| Field | Meaning |
|---|---|
| Key, label, description | How the dataset is named in the catalogue and described to authors. |
| Component | Which suite component the data belongs to (Engagement today). Reports group by it. |
| Primary key, time field | The row's identity, and the column a dashboard's period applies to. |
| Freshness policy | What the dataset promises: live, or as of a refresh. |
| Status | ACTIVE datasets are offered; anything else is hidden without being deleted. |
| Sources | One per engine: the view or table that holds the dataset on PostgreSQL and on ClickHouse. A workspace sees a dataset only when its engine has an ACTIVE source for it. |
| Fields | Each with its key, label, the column behind it, its type (string, number, date, datetime, boolean), its role (dimension or measure), the aggregates it allows (sum, count, distinct count, average, min, max), its display format (integer, decimal, money, percent, date, datetime) and its sensitivity. |

### Sensitivity

- **NORMAL** fields are offered to everyone with Reports · View.
- **PII** fields (a customer's identifier, an email address) can be built on only by people with Report Admin
  (`report.admin`) or User Admin (`user.admin`). Everyone else does not see them in the catalogue, and when they open
  a shared report that has such a column, its values are masked in the grid, the exports and the deliveries.
- **CONFIDENTIAL** fields are never offered.

The four datasets shipped are Messages, Attributed Orders, Contacts and Journey Enrolments. Adding a field means
adding it to the reporting view (or table) first, then here; the catalogue is cached for a minute.

## Report Engines

One row per workspace. A workspace without a row runs on PostgreSQL with the default limits.

| Field | Values | Meaning |
|---|---|---|
| Engine | `postgresql`, `clickhouse` | The engine the workspace is on, or moving to. |
| Status | `ACTIVE`, `MIGRATING`, `READ_ONLY` | With ClickHouse, `MIGRATING` means the tables are being loaded or checked and reports **still run on PostgreSQL**. `ACTIVE` means reports run on the engine named. |
| Freshness SLA | `LIVE`, `QUARTER_HOUR`, `MINUTES_5`, `HOURLY`, `DAILY` | What the line under a report's title tells people: "live data", or "data as of the last quarter hour". |
| Query limits | JSON | `statement_timeout_ms` (15,000), `preview_rows` (200), `run_rows` (5,000), `export_rows` (100,000), `concurrent` (4). Empty means these defaults. Raise them for a workspace that needs more; the limits protect everyone else. |
| Connection profile | a Report Engine Connection, or empty | The ClickHouse this workspace loads into and reads from. Empty: the server's environment. |
| Last reconciled | time | Set by Reconcile. |

### Where the ClickHouse connection comes from

**Configuration → Report Engine Connections** holds the servers the platform can point a workspace at. One row per
connection: a profile name, the engine, the URL of ClickHouse's HTTP interface, the user, the password (typed to set
or change it, stored encrypted, never shown again), the database (`cep_reporting`), a status and notes. **Test
Connection** reaches the server and shows its version; the result stays on the row. A workspace's Report Engines row
chooses one of these in **Connection profile**; from then on its backfill, refresh, reconcile and reports use that
server, so workspaces can be spread over several ClickHouse servers. A row with no profile uses the server's
environment (`CLICKHOUSE_URL`, user, password, database), set by whoever runs the server; with neither, the buttons
say so and the workspace stays on PostgreSQL. The database patches 0053 (the catalogue's ClickHouse sources) and 0054
(the connections table) must be applied. The operator's guide, with the checks to run from the server, is
`docs/INSIGHTS_ENGINE_SWITCH.md`.

### Switching a workspace to ClickHouse

Open the workspace's row and use the buttons at the top of the page, in this order.

1. **Backfill ClickHouse.** Creates the ClickHouse database and tables if they are missing, copies every row of the
   workspace's datasets from the PostgreSQL views, and sets the row to `clickhouse` + `MIGRATING`. The message says how
   many rows went per dataset. Reports keep running on PostgreSQL. A large workspace takes a few minutes; the page
   waits.
2. **Reconcile.** Counts every dataset on both engines and shows them side by side; sets Last reconciled. Green when
   they agree, amber with the differences when they do not. A difference right after a backfill means rows changed in
   between: run Backfill again. Rows loaded twice replace themselves.
3. **Activate ClickHouse.** Sets `ACTIVE` and the freshness to a quarter hour. From the next request the workspace's
   reports, dashboards, exports and scheduled deliveries read ClickHouse. People see the same pages and the same
   figures; the line under a report's title now says "data as of the last quarter hour".

From then on the job **refresh-clickhouse-reporting** (every 15 minutes; see Jobs, Alerts and System Checks) reloads
the last seven days of messages, orders and enrolments, and the whole of contacts, for every workspace whose engine
is ClickHouse. Reconcile can be run again at any time.

### Rolling back

**Roll Back to PostgreSQL** sets `postgresql` + `ACTIVE` + `LIVE`. From the next request the workspace reads the live
views again. The ClickHouse tables keep their rows, so a later switch is Backfill, Reconcile, Activate once more.

### What to know about the ClickHouse engine today

- Rows deleted in PostgreSQL stay in ClickHouse until the next Backfill.
- A change to a row older than seven days (a message delivered late, an order re-attributed) reaches ClickHouse at the
  next Backfill, not at the quarter-hour refresh. After a bulk correction, run Backfill.
- One ClickHouse database holds every workspace's rows, kept apart by the workspace column on every query.

## When something goes wrong

| What people see | Where to look | What it usually is |
|---|---|---|
| "The report took longer than 15 seconds and was stopped" | Run Log, outcome Timed Out | A report over a large dataset without a filter. Suggest a period or a filter; raise `statement_timeout_ms` only for that workspace if it is legitimate. |
| "This workspace's reports are moving to a new engine" | Report Engines, status | The row is `MIGRATING` on an engine that is not yet active. Finish the switch or roll back. |
| "Insights is not part of this workspace" | Tenant → Components | The Insights component is not on for the workspace or its plan. |
| A dataset missing from New Report | Report Datasets → Sources | No ACTIVE source for the workspace's engine. |
| A PII field missing for someone | People and Access | They lack Report Admin or User Admin; that is by design. |
| A figure differs between engines | Report Engines → Reconcile | Rows changed since the last load. Backfill. |
| Deliveries not arriving | Insights → Scheduled, the run log kind Delivery; the workspace's Mail Server | The schedule is paused after three failures, or the workspace has no mail server. |
| ClickHouse buttons say it is not configured | the server's environment | The four ClickHouse lines are missing on that server. |

## Related chapters

Jobs, Alerts and System Checks (the refresh and delivery jobs on the health page); Tenants (switching the Insights
component on for a workspace); People and Access (the Reports · View, Edit and Admin permissions).
