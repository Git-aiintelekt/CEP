# C360: the component suite and the Insights report engine

The suite is C360; today's CEP is its Engagement component and Insights is the reporting app (decided 2026-10-15;
PR product-name-c360 renames the product). This note turns the three attached
inputs into one build order: the suite mockup (`docs/mockups/ai-intelekt-suite.html`), the component paper
(`docs/SUITE_COMPONENTS.md`, branch suite-components) and the report-engine specification
(CEP_Report_Engine_Implementation_Tech_Stack_and_Deployment v1.2). It is a plan to approve, not work done.

## What is being asked for

1. The app becomes a set of components a workspace gets by subscription: today's CEP plus Insights, the
   advanced reporting tool; CRM, Sales, Purchasing, Inventory and PIM later.
2. Insights is integrated into every component as a menu item, and can also run as an app of its own.
3. A platform-admin configuration decides whether Insights runs integrated, standalone, or both.
4. The report engine must never take the other apps down with it.

## The shape, in one picture

```
Browser ──► nginx ──┬─► /                     the suite shell + component chunks (one static build)
                    ├─► /api/v1/<component>/   c360-app     (Django, today's backend)        port 8010
                    └─► /api/v1/insights/      c360-insights (Django, the report engine)      port 8012
                                                  │ read-only role, statement_timeout, row caps, per-tenant concurrency cap
                                                  ▼
                        PostgreSQL (system of record) ──logical replication──► reporting schema / instance (PostgreSQL 18)
                                                                               └─ per tenant, later: ClickHouse
c360-jobs    the scheduler as today (campaigns, journeys, attribution, ...)
c360-insights-jobs   the engine's own worker: scheduled reports, heavy exports, aggregate refreshes
```

The engine is a separate process with its own service unit, worker, database role and limits. That is what
makes "it cannot kill the other apps" true: a runaway report exhausts the engine's connections and CPU share,
not the app's. The integrated and standalone modes are two front doors on the same engine, never two engines.

## The modes and the admin configuration

| Setting (platform admin, Global parameters) | Values | Effect |
|---|---|---|
| `INSIGHTS_MODE` | `integrated` (default), `standalone`, `both` | integrated: an Insights item in each component's menu, opening the report list filtered to that component. standalone: Insights is an app in the launcher with its own navigation (Overview, Reports, Dashboards, Scheduled, Datasets). both: the two together. |
| `INSIGHTS_STANDALONE_URL` | a host or path, e.g. `insights.aiintelekt.com` or `/insights` | Where the standalone app answers. Same build, same sign-in; the shell drills into Insights on load. |
| `INSIGHTS_ENGINE_URL` | internal URL of the engine service | Where the app's nginx forwards `/api/v1/insights/`. Health is shown on the platform health page; when the engine is down, Insights pages show "Insights is not available" and every other page is untouched. |
| Per tenant: Tenant Administration → Components | Insights on or off, by plan, trial or add-on | Decides whether a workspace sees Insights at all. |
| Per tenant: Report Engine Setting (spec §7) | PostgreSQL 18 or ClickHouse, limits, freshness | Which analytics engine runs that tenant's reports. Default PostgreSQL. |

Changing the mode is a configuration change, not a deployment: the shell reads the mode with the
entitlements on sign-in.

## Build order

Each phase is a run of PRs on its own branch, deployed to dev, then to the test server, in the usual cadence.
Sizes: S = a PR or two, M = a week of PRs, L = several weeks.

### Phase A, the suite shell (M)

The mockup, built. Top bar with the app launcher, the left navigation by component (levels 1 to 3, collapsed
rail with flyouts), manifests, the `/cep/...` routes with redirects from today's addresses, `GET /me/` returning
the person's components, Tenant Administration → Components and the Component Registry in the back-office,
plans with their component sets. Today's CEP moves into `apps/cep/` with `git mv` (features, pages, help, its manifest and its routes); the design system,
the API client and auth stay as the platform layer where they are (`components/`, `lib/`, `auth/`, `shell/`). The shell
lazy-loads each component's routes module, so a component is one chunk of its own, held to a size budget by
`frontend/scripts/check-budgets.mjs` after every build.
Insights appears in the launcher and in each menu as soon as Phase B gives it a first page.

Exit: the same product, under the suite shell, with no page slower than today; NWA sees CEP and Insights.

### Phase B, the Insights engine foundation and grid reports (L; spec Phase 0 and 1)

*Delivered first (PR insights-foundation, 2026-10-16):* patch 0049 (the catalogue, a workspace's reports, the engine
setting, the reporting views, the `cep_reporting` role, the Insights parameters, `report.edit` / `report.admin`, Insights
released as Beta), `apps/insights` (catalogue, definition validation, the PostgreSQL compiler, the runner with its limits,
audit and cache, the API, the back-office admins), the engine as a service of its own (`config.settings.insights`,
`docs/INSIGHTS_ENGINE.md`), and the first pages: Reports list grouped by component, New Report from a dataset, the grid
viewer on AG Grid Community with CSV export, and the Report Editor with both options of docs/mockups/report-builder.html
(decided 2026-10-16: both): Field Wells and Steps are two ways of building one definition, switched in the editor's
header and remembered per browser, with the shared filter builder and the live grid preview. *Then (2026-10-15):* the
engine runs as its own process on the dev server, `cep-insights` on port 8012 with nginx sending `/api/v1/insights/` to
it in both server blocks (`deploy/cep-insights.service`, `docs/INSIGHTS_ENGINE.md`). *Next in Phase B:* PII masking by
role in the grid, and the chart, hierarchy and pivot views.

- The `c360-insights` service: a second Django process from the same codebase (`config.settings.insights`),
  mounting only the reports apps, with its own unit, worker, log and read-only reporting role. nginx routes
  `/api/v1/insights/`. Statement timeout, preview and export row caps, a per-tenant concurrency cap and a
  shared result cache (the database cache table; Redis where present).
- The semantic catalogue in PostgreSQL: ReportDataset, ReportField, ReportDatasetSource, Report, ReportVersion,
  ReportFolder, ReportShare, ReportRunAudit, ReportEngineSetting (spec §8), as SQL patches in
  `database/components/insights/`, with tenant_id and row-level security like every other table.
- The engine-neutral query compiler with the PostgreSQL dialect first (spec §10), fed from a reporting schema
  on the CEP database for dev and test (the smallest deployment in spec §7), and a separate reporting
  instance for production.
- The first datasets: the ones Reports already has (Messages, Attributed Orders, E-Receipts, Contacts,
  Journeys), registered by the CEP component's manifest.
- The pages: Report List, Report Editor (dataset explorer, fields, filters, group, sort, preview), Report
  Viewer on AG Grid Community, streamed CSV export; the admin Report Engine Settings screen.
- The platform-admin mode settings above, and the "Insights is not available" state.

Exit: an authorised person creates, saves, shares and runs a grid report on NWA's data in both modes; a
runaway report times out in the engine while campaigns keep sending.

### Phase C, charts and dashboards (M; spec Phase 2)

Apache ECharts views, dashboards on react-grid-layout with a shared date filter, folders, favourites, version
history, run audit views, aggregate tables refreshed by the engine's worker.

### Phase D, pivot, hierarchy, XLSX (M; spec Phase 3)

Server-side pivots with ROLLUP and GROUPING SETS, dnd-kit zones, hierarchy datasets, XlsxWriter export.

### Phase E, scheduling, PDF, the engine switch (M; spec Phase 4)

Scheduled delivery through the engine's worker, WeasyPrint PDF, ClickHouse as a second dialect with the
per-tenant switch workflow (backfill, reconcile, activate, roll back), legacy ingestion pipelines one source
at a time.

## What stays out of the first release

Free-form SQL, external warehouses, embedded BI products, mixing engines within a tenant, the visual print
template designer, and the CRM, Sales, Purchasing, Inventory and PIM components themselves (the shell is built
so each is a folder added later).

## Environments

| | Dev 10.0.0.51 | Test 10.0.0.56 | Production |
|---|---|---|---|
| Engine service | `cep-insights` unit beside `cep-backend` and `cep-jobs` | the same, as system units | its own host or container |
| Analytics data | reporting schema on the dev database | reporting schema on the test database | separate PostgreSQL 18 instance; ClickHouse per tenant when needed |
| Mode | both | both | per the platform admin |

## Decisions taken on 2026-10-15

1. **Naming.** The suite is **C360**. Today's CEP is the **Engagement** component (the rail shows the C360 mark
   with "Engagement" beside it); the reporting app is **Insights**, so its full name is C360 Insights. The
   platform speaks of itself as C360 in every message.
2. **Plans.** Insights is included from the start, not an add-on.
3. **Dashboards** ship in Phase C.
4. **The standalone address** is `/insights` on the same host.
