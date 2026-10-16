# Switching a workspace's Insights between PostgreSQL and ClickHouse

Insights runs every report of a workspace on one analytics engine: PostgreSQL (the live reporting views on the
workspace's own database) or ClickHouse (reporting tables loaded from those views). The switch is per workspace,
made in the platform back-office, and can be undone at once. This is the operator's guide; the design is in
`docs/INSIGHTS_ENGINE.md` ("ClickHouse, the second engine") and the plan in `docs/C360_INSIGHTS_SUITE_PLAN.md` (E3).

## 1. What the server needs once

The backend reads the ClickHouse connection from its environment (`/app/cep/.env` on the dev server; the same file
every unit reads). Four lines; the password is never in the repository or in a chat:

```
CLICKHOUSE_URL=http://<host>:8123        # the HTTP interface
CLICKHOUSE_USER=<user>
CLICKHOUSE_PASSWORD='<password>'
CLICKHOUSE_DATABASE=cep_reporting        # created on first use; one database for every workspace's tables
```

- An empty `CLICKHOUSE_URL` means no ClickHouse: every workspace reports on PostgreSQL and the buttons below say so.
- The user needs `CREATE`, `INSERT`, `SELECT` and `ALTER` on that database (the dev user also holds `DROP`,
  `TRUNCATE`, `OPTIMIZE`, `KILL QUERY`). Reports themselves run with `readonly=1`.
- After changing the lines, restart the three units: `systemctl --user restart cep-backend cep-jobs cep-insights`.
- The database needs patch 0053 (the catalogue's ClickHouse sources) and the earlier Insights patches 0049 to 0052.
- Check from the server that the app reaches ClickHouse:
  `manage.py shell -c "from apps.insights import clickhouse; print(clickhouse.query('SELECT version()'))"`.

The dev server (10.0.0.51) has all of this since 16 October 2026, pointing at the ClickHouse on 10.0.0.57.

## 2. Where the switch lives

Back-office → **Configuration → Report Engines** (`/admin/insights/reportenginesetting/`). One row per workspace
that has a setting; a workspace without a row reports on PostgreSQL with the default limits. The row's fields:

| Field | Values | Meaning |
|---|---|---|
| `engine` | `postgresql`, `clickhouse` | The engine the workspace is on or moving to. |
| `status` | `ACTIVE`, `MIGRATING`, `READ_ONLY` | `MIGRATING` with `clickhouse`: the tables are loading or being checked; reports **still run on PostgreSQL**. `ACTIVE`: reports run on the engine named. `READ_ONLY` counts as active for reading. |
| `freshness_sla` | `LIVE`, `QUARTER_HOUR`, `MINUTES_5`, `HOURLY`, `DAILY` | What the run line tells people ("live data", "data as of the last quarter hour"). PostgreSQL is `LIVE`; ClickHouse is `QUARTER_HOUR`, the refresh job's cadence. |
| `query_limits` | JSON | Statement timeout, preview, run and export row caps, concurrent runs; empty = the defaults in `apps/insights/catalog.py`. |
| `connection_profile` | text | A label for operators; the connection itself is the server environment. |
| `last_reconciled_at` | time | Set by Reconcile. |

The engine the reports run on **right now** is what `engine_of()` calls the `dialect`: `clickhouse` only when the
engine is ClickHouse and the status is `ACTIVE` or `READ_ONLY`; `postgresql` in every other case.

## 3. Switching a workspace to ClickHouse

Open the workspace's row (or add one) and use the buttons at the top of the page, in this order.

1. **Backfill ClickHouse.** Creates the `cep_reporting` database and the four tables if they are missing, copies
   every row of the workspace's four datasets from the PostgreSQL views (messages, attributed orders, contacts,
   journey enrolments), and sets the row to `clickhouse` + `MIGRATING`. Reports keep running on PostgreSQL. The
   message says how many rows went per dataset. A workspace of a few hundred thousand messages takes a few minutes;
   the page waits for it.
2. **Reconcile.** Counts every dataset on both engines and shows them side by side; sets `last_reconciled_at`. Green
   when they agree, amber with the differences when they do not. Differences right after a backfill mean rows
   changed in between; run Backfill again. (Rows loaded twice replace themselves: the tables are ReplacingMergeTree
   keyed by workspace and id, read `FINAL`.)
3. **Activate ClickHouse.** Sets `ACTIVE` and `freshness_sla = QUARTER_HOUR`. From the next request, the workspace's
   reports, dashboards, exports and scheduled deliveries read ClickHouse. Nothing else changes for people: the same
   pages, the same views, the same totals; the run line says "data as of the last quarter hour".

From then on the job `refresh-clickhouse-reporting` (every 15 minutes in `cep-jobs`, listed on the platform health
page) reloads the last seven days of messages, orders and enrolments and the whole of contacts for every workspace
whose engine is ClickHouse, whatever its status. Reconcile can be run at any time to compare the engines again.

## 4. Rolling back

**Roll Back to PostgreSQL** sets `postgresql` + `ACTIVE` + `LIVE`. From the next request the workspace reads the live
views again. The ClickHouse tables keep their rows (the refresh job skips the workspace once its engine is
PostgreSQL), so a later switch is Backfill, Reconcile, Activate again.

## 5. Checking it worked

- The workspace's row shows `clickhouse` / `ACTIVE` / `QUARTER_HOUR`.
- In the app, run any Insights report: the line under the title ends in "data as of the last quarter hour".
- Insights → Run Log (report administrators) lists the run with its time; a ClickHouse run on a small workspace is
  a few milliseconds.
- The platform health page shows `refresh-clickhouse-reporting` succeeding within its two-hour window.
- From the server, the same checks as the back-office buttons:
  `manage.py shell -c "from apps.delivery.engine import session; from apps.insights import clickhouse;
  tid='<tenant uuid>'; print(session.tenant_scope(tid).__enter__() and clickhouse.reconcile(tid))"` (or the
  shorter script in the project notes).

## 6. What the ClickHouse engine does not do yet

- Rows deleted in PostgreSQL stay in ClickHouse until the next full backfill.
- Changes to rows older than seven days (a message delivered late, an order re-attributed) reach ClickHouse at the
  next full backfill, not at the quarter-hour refresh. Run Backfill after a bulk correction.
- One ClickHouse database holds every workspace's rows, kept apart by the workspace column on every query, not by
  separate databases or users.
- Logical replication in place of the loader, and the legacy ingestion pipelines, are later slices of the plan.

## 7. The same, from the command line

For a scripted switch, the back-office actions call these; the sequence the dev switch used on 16 October 2026:

```python
from django.conf import settings
from django.db import connections
from apps.delivery.engine import session
from apps.insights import clickhouse

tid = "<tenant uuid>"
with session.tenant_scope(tid):
    print(clickhouse.backfill(tid))          # {'messages': 149, 'attributed_orders': 104, 'contacts': 160, 'journey_enrollments': 12}
    counts = clickhouse.reconcile(tid)       # [{'dataset': ..., 'postgresql': n, 'clickhouse': n}, ...]
if all(c["postgresql"] == c["clickhouse"] for c in counts):
    with connections[settings.PLATFORM_ALIAS].cursor() as c:
        c.execute("UPDATE report_engine_setting SET engine = 'clickhouse', status = 'ACTIVE', freshness_sla = 'QUARTER_HOUR', "
                  "last_reconciled_at = now(), updated_at = now(), row_version = row_version + 1 WHERE tenant_id = %s", [tid])
```

Rolling back by hand is the same `UPDATE` with `postgresql`, `ACTIVE`, `LIVE`.
