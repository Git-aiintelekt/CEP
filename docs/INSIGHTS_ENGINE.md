# The Insights report engine: how it runs

Insights (the reporting app, suite component `insights`) runs reports through the backend's `apps/insights`. The
engine can run inside the app process or as a process of its own; the second is what keeps a runaway report from
taking the other apps down with it. Both run the same code (`docs/C360_INSIGHTS_SUITE_PLAN.md`, Phase B).

## What protects the other apps either way

Every report runs in one short read-only transaction as the `cep_reporting` role (SELECT on the reporting views and
the tables beneath them, nothing else), with the workspace's row-level setting, a statement timeout, a row cap per kind
(preview, run, export) and a per-workspace cap on concurrent reports. The limits come from `report_engine_setting`
(Tenant Administration → Report Engines) over the defaults in `apps/insights/catalog.py`. Every preview, run and
export is audited in `report_run_audit`; a timeout or a refusal is a plain 422 to the person.

## The engine as its own service

The same codebase, with the settings module `config.settings.insights`, mounts only the Insights routes and the health
check (`config/urls_insights.py`). The unit is `deploy/cep-insights.service`; it runs beside `cep-backend` and `cep-jobs`
on the dev server 10.0.0.51 since 15 October 2026 (a user unit, port 8012, log `/app/cep/insights.log`; 8020 is taken
by a Docker container there). On 10.0.0.56 it would be a system unit with `User=`, the log under `/var/log/cep`
(SELinux refuses an append log under `/opt`) and `CEP_SETTINGS_BASE` set to the base the app process runs with.

nginx sends the Insights routes there and everything else to the app. The block goes before the general API block in
**every** server block that proxies the API (on the dev server both the 443 block and the 8443 Cloudflare tunnel origin):

```nginx
location ~ ^/api/v1/insights(/|$) {
    proxy_pass http://127.0.0.1:8012;
    proxy_http_version 1.1;
    proxy_read_timeout 120s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ~ ^/(api|admin|healthz|static|media)(/|$) { proxy_pass http://127.0.0.1:8010; ... }
```

Check it after a reload: a request to `/api/v1/insights/catalog/` with an `X-Tenant` header answers 401 and appears in
`insights.log`, not `backend.log`; `/api/v1/journeys/` does the opposite. A deploy restarts `cep-insights` with the
other two units (`systemctl --user restart cep-backend cep-jobs cep-insights`).

The app process keeps the same routes, so an installation without the second service needs no nginx change at all;
the global parameter `insights.engine_url` records the engine's address for operators and the platform health page to
come, and no code reads it yet.

## How Insights is offered (platform admin → Global Parameters)

| Parameter | Values | Effect |
|---|---|---|
| `insights.mode` | `integrated` (default), `standalone`, `both` | integrated: an Insights item in each component's menu opening the list on that component's reports; standalone: Insights only as an app of its own in the launcher; both. |
| `insights.standalone_path` | `/insights` | Where the standalone app answers on this host. |
| `insights.engine_url` | an internal URL, or empty | The engine service, when there is one (informational until the health page probes it). |

A workspace sees Insights at all only when Tenant Administration → Components has it on (every plan includes it since
patch 0048; it is released as Beta in patch 0049).

## The four views

A report is one definition shown four ways; the choice saves with the definition (`view`: the type, the chart's kind,
and for a chart or a pivot the dimension spread across) and `report.view_type` follows it. The grid is the rows as the
engine returned them (AG Grid Community). The other three are reshaped in the browser from the same grouped rows: the
**chart** (the app's chart kit) puts the first dimension along the bottom with one series per value of the dimension
across, else one per measure; the **hierarchy** folds the dimensions in their order with a subtotal per group; the
**pivot** spreads the dimension across as columns with one measure in the cells and totals on both edges. Subtotals
add sums and counts and compare minimums and maximums; an average or a distinct count cannot be combined and reads as
an em dash. They come from the rows shown, so a truncated run totals what is on the page.

## Dashboards

A dashboard (`dashboard`, `dashboard_version`, patch 0050; `apps/insights/dashboards.py`) is rows of tiles over a
workspace's reports, the layout of docs/mockups/insights-dashboards.html option 2: a row holds one to four tiles of equal
width or a wide and a narrow one, so nothing overlaps or leaves a gap. A tile is a saved report in one of its views, or
one of its totalled columns as a figure. One period at the top (7 days, 30 days, this month, the quarter, or custom)
applies to every tile as one more rule on its dataset's time field; a report with its own rule on that field keeps it
and the tile says "Own dates". Compare With Previous Period runs each figure twice and shows the change. Tiles run
through the same engine, limits, masking, cache and audit as reports (`POST /insights/dashboards/<id>/tiles/<tile>/run/`;
the editor previews a tile before it is saved through `tiles/preview/run/`). The layout and the period save as a version.

## Favourites and folders

A star on every report and dashboard (`report_favourite`, patch 0051, one row per person and item) puts it first in
the lists under Favourites. Folders (`report_folder`, from 0049; `apps/insights/library.py`) group a workspace's reports:
anyone with `report.edit` makes one, its maker or a report administrator renames or deletes it (the reports stay,
filed nowhere), and the report's owner moves it from the viewer's Folder select. The Reports list filters by folder,
or by no folder, and shows the folder under the name.

## The engine's totals

A run or a preview for a hierarchy or a pivot (the definition's view, or the `view` in the body when the viewer
switches without saving; a tile's own view) carries `totals`: the engine totals the same rows a second time with
GROUPING SETS (`compiler.compile_totals`), every prefix of the hierarchy's dimensions and the whole, or the pivot's
rows, columns and the whole. One entry per total: the dimension values kept and the measures. The views and the Excel
export take the engine's total where there is one and combine the rows shown only where there is none, so averages
and distinct counts subtotal exactly and a truncated run still totals everything. The totals are cached with the run.

## The PDF export

`GET /insights/reports/<id>/export.pdf` and `GET /insights/dashboards/<id>/export.pdf` (`apps/insights/pdf.py`, ReportLab,
pure Python: no system packages on any server, which is why it replaced WeasyPrint): the report in its saved view, or
the dashboard with its tiles on its saved period, on A4 (landscape for a wide table) with the C360 header, the
workspace and the date, a bold header row that repeats on every page, the engine's totals in bold, and page numbers. A
chart comes as bars with its numbers under it; a dashboard's figures come as boxes with their change; a tile that cannot
run says why. Export PDF sits beside the other exports on the report viewer and on the dashboard viewer.

## The Excel export

`GET /insights/reports/<id>/export.xlsx` (`apps/insights/excel.py`, XlsxWriter) is the report in its saved view as a
workbook: a pivot or a hierarchy as its reshaped sheet with its totals first (`apps/insights/shape.py`, the server's
twin of the front end's shaping) and the grouped rows as the "Rows" sheet; a grid is the "Rows" sheet alone, with a
bold frozen header, a filter, column widths and a number format per column (integers, decimals, money, percentages,
dates, and bucketed dates as months, quarters or years). Masked columns export masked. Every row up to the export cap
is fetched in pages (`runner.fetch_all`) and audited as one export. The CSV export stays as it was.

## Versions

Every save of a report's definition is a version (`report_version`), listed in the viewer's Versions drawer with who,
when and the note. Open shows a version's rows in the viewer, read-only, through a preview of its definition; Restore
(`POST /insights/reports/<id>/versions/<n>/restore/`, the owner or a report administrator) makes it the current version
again as a new version noted "Restored from version n", checked against today's catalogue like any save.

## Scheduled delivery

A report goes out by email on a schedule (`report_schedule`, `report_delivery`, patch 0052; `apps/insights/schedules.py`;
option 1 of docs/mockups/insights-scheduled-delivery.html): every day, every weekday, weekly on a day or monthly on a
day, at a time in the workspace's zone, as Excel, CSV or PDF (a dashboard as PDF, on its saved period), to up to
twenty addresses, with a subject (`{date}` is the sending date) and a note. Schedule sits on the viewer for `report.edit`; Insights → Scheduled lists the person's
schedules (every schedule for `report.admin`) with Pause, Resume and Delete; the viewer shows the schedule in a line
with Change and Pause. The job `deliver-report-schedules` (every 5 minutes, `workers/insights_delivery.py`) builds each
due report through the engine with the rights and masking of whoever scheduled it (`runner.fetch_all`, audited as a
`delivery`), sends it through the workspace's own mail server with the file attached (`mail.send` now takes
attachments; the templates are `email/report_delivery.*`), records the sending in `report_delivery`, computes the next
sending, and pauses the schedule after three failures in a row. Send a Test Now sends the email to the person asking at
once. A workspace without a mail server cannot schedule; the API says so. Schedule sits on the dashboard viewer too.

## The run log

Insights → Run Log (`report.admin`; `GET /insights/runs/`, `apps/insights/audit.py`) lists every preview, run and
export of the last 7 or 30 days from `report_run_audit`, newest first, 200 at most, with the report and its version,
the kind, who, the outcome with its reason when it is not OK, the rows and the time; filters by outcome, person and
report name; a summary of the runs, the timed-out, refused and failed ones and the median time of the good ones.
A view across workspaces in the back-office is still to come.

## The catalogue

Configuration → Report Datasets maps each dataset to its reporting view (`reporting.rpt_*`, created by patch 0049
with `security_invoker`, so row-level security applies) and lists its fields: a dimension or a measure, its type, its
aggregates, its display format and its sensitivity. A PII field is offered for building only to `report.admin` or
`user.admin`; for anyone else it is hidden from the catalogue (a draft naming it is told why), and a saved report that
has it still runs for them with that column masked, in the grid (named above it, cells `•••••`) and in the CSV export
(header `Label (masked)`). The result cache keeps masked and full results apart. CONFIDENTIAL fields are never offered.
Report authors never see table or column names.

## ClickHouse, the second engine

The operator's guide to switching a workspace, with the server settings and the back-office buttons, is
`docs/INSIGHTS_ENGINE_SWITCH.md`.

`apps/insights/clickhouse.py` talks to ClickHouse over HTTP. The connection is the workspace's profile from
Configuration → Report Engine Connections (`report_engine_connection`, patch 0054, the password encrypted) when its
Report Engines row names one, else the server environment (`CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`,
`CLICKHOUSE_DATABASE`); with neither there is no ClickHouse for that workspace. It creates the database and one
ReplacingMergeTree table per dataset in the shape of the PostgreSQL reporting view, keyed by the workspace and the
dataset's primary key with a load version, so a row loaded again replaces itself; queries read them `FINAL`. The loader
copies a workspace's rows from the PostgreSQL views in batches: everything at a backfill, the recent seven days of each
dataset (contacts whole) every quarter hour by the job `refresh-clickhouse-reporting` for workspaces on ClickHouse.
Deletions are not propagated yet. The compiler has a ClickHouse dialect (typed `{p:Type}` placeholders, `toTimeZone`
and `date_trunc` for buckets, local-day bounds as instants, `IN`, `ILIKE` without `ESCAPE`, `toIntervalDay`, `FINAL`);
grouping sets and `GROUPING()` are the same. The runner sends a read-only HTTP query with `max_execution_time`; the
audit, the cache, the masking and the totals are unchanged. The switch lives in Tenant Administration → Report Engines:
**Backfill ClickHouse** (load every dataset; the workspace is MIGRATING and its reports still run on PostgreSQL),
**Reconcile** (row counts per dataset on both engines, shown, `last_reconciled_at` set), **Activate ClickHouse** (reports
run there, freshness a quarter hour) and **Roll Back to PostgreSQL**. The catalogue's ClickHouse sources come with patch
0053. `engine_of` answers `dialect`: the engine the reports run on now.

## The analytics engine per workspace

`report_engine_setting` names the engine (PostgreSQL today, ClickHouse with Phase E), its connection profile, its
status, freshness and limits. For dev and test, the reporting views read the CEP database itself (the spec's smallest
deployment); production gets a reporting instance fed by logical replication.

## AI · Ask for a Report

`apps/insights/assistant.py` turns a prompt into a report through Claude or OpenAI (patch 0055). The platform's keys live
in `ai_provider` (Configuration → AI Assistant, encrypted); a workspace's switches in `tenant.settings.ai_assistant`; every
prompt in `ai_prompt` (RLS, kept 90 days). The model receives the prompt and the catalogue of fields the person may use
(locked PII fields are left out) and answers through a schema-bound reply (Anthropic tool use, OpenAI json_schema): a
draft, validated with `definition.validate` and retried once with the error; one question; or no_field with the closest
prompts. Only a draft counts against `subscription_plan.max_ai_prompts_per_month`. Open in Editor inserts the report and
its first version like New Report. Change with a Prompt and Explain This Report are the next slice.
## Report Databases: a workspace's own MySQL or PostgreSQL

`apps/insights/databases.py` (the API, Settings → Report Databases) and `apps/insights/external.py` (the access) let a
workspace connect its own MySQL 5.7, MySQL 8.0 or PostgreSQL database read-only and map tables or views as datasets
(patch 0056: `report_connection`, `report_dataset_custom`, both RLS, the password encrypted; `report.dataset_key` no
longer references the platform's catalogue alone). `catalog.for_tenant` appends the workspace's datasets (cached a
minute per workspace) with `external: True`, their dialect (`mysql` or `postgresql`) and their connection; the catalogue
API strips the connection. The runner picks the dialect from the dataset and reads through `external.query`: a session
opened read-only (`SET SESSION TRANSACTION READ ONLY`, `default_transaction_read_only=on`) with the workspace's statement
limit and time zone. The compiler's MySQL dialect: backticks, no workspace restriction, DATE arithmetic for buckets, LIKE,
IN with one placeholder a value, `IS NULL` ordering, and one query per grouping set joined with UNION ALL for the totals.
Test Connection reads the server's version, what the account may read and its rights (`SHOW GRANTS`; on PostgreSQL the
role's attributes, `information_schema.role_table_grants` beyond SELECT and CREATE on the schema); an account that could
write is recorded `read_only = false` and the connection cannot be used until it is fixed. `pymysql` is the MySQL client
(requirements.txt); PostgreSQL uses the psycopg Django already has. A mapped dataset may join up to five tables
(`report_dataset_custom.joins`, patch 0057: alias, table, left or inner, the alias joined to, the key pairs; each field
carries its table's alias): `compiler.join_clause` writes the FROM as the base AS t0 with each join ON its keys, every
column qualified, and `external.join_check` counts what a join does to the rows before it is added. A dataset may also be a
query (`query_sql`, patch 0058): `external.check_sql` admits one SELECT (no second statement, no write, schema or file words,
no file or system functions), `external.run_sql` runs it wrapped as `SELECT * FROM (…) AS q LIMIT n` on the read-only session and
types the result's columns, and the compiler writes `FROM (query) AS t0` with the report's own clauses around it (the query's
`%` doubled for the positional drivers). Report authors reach it from New Report → Query a Database (`QueryTargetsView`,
`QueryRunView`, `QueryDatasetView`; `assistant.write_sql` for Write It for Me); the catalogue never carries the SQL.
