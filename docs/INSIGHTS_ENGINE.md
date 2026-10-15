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

## The analytics engine per workspace

`report_engine_setting` names the engine (PostgreSQL today, ClickHouse with Phase E), its connection profile, its
status, freshness and limits. For dev and test, the reporting views read the CEP database itself (the spec's smallest
deployment); production gets a reporting instance fed by logical replication.
