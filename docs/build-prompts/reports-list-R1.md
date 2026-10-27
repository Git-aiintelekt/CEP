# Build prompt: Reports list redesign, Phase R1 (tabs, filters and one flat table)

You are working in the CEP repo (`frontend/` only; do not touch `backend/` or `database/`). Read `CLAUDE.md` first and invoke the `cep-design` skill before writing UI.

## Goal
Redesign **Insights → Reports** (`frontend/src/apps/insights/pages/ReportListPage.tsx`, route `/insights/reports`) to match the approved mockup **`docs/mockups/reports-list-b.html`** (direction B). Open it in a browser and use it as the visual reference. Build it in the app's own components and Tailwind tokens. Never copy the mockup's raw hex values or its CSS.

This phase covers the page header, the tabs, the filter line and the table. **Not in this phase:** the ⋯ row menu (Phase R2) and the Recently Viewed strip (Phase R3). Leave both out entirely, with no placeholders.

## What to build

### 1. Header
- Use the existing `PageHeader` (`components/ResourceList.tsx`) with its `PageHelp`.
- Title: **Reports**, with the total count as a small count badge beside it (as on other list pages, if a pattern exists).
- Description: "Every report you can open, yours and the ones shared with you."
- Actions, right-aligned, only for people who can create (`report.edit` or `report.admin`, as today):
  - **Ask AI** (secondary button, Sparkles icon): navigates to `/insights/ai-reports`. Show it only when the AI Reports menu item would show. Copy the exact condition the Insights menu uses for the `ai: true` item in `apps/insights/manifest.ts` and wherever that flag is evaluated.
  - **New Report** (primary button, Plus icon): unchanged behaviour, including carrying `?component=` into `/insights/reports/new`.

### 2. Tabs
- Use the shared `components/Tabs.tsx`.
- Three tabs, each with its count: **All Reports**, **My Reports**, **Shared With Me**.
  - My Reports: `owner_user_id === principal.id`. Get `principal` from `useAuth()` the way `pages/ScheduledPage.tsx` does.
  - Shared With Me: every report the person can open that they don't own.
- Counts come from the loaded list, after the filters below are applied, so the tab counts and the table always agree.
- Keep the tab in the URL as `?tab=mine` or `?tab=shared`. All Reports has no param.

### 3. Filter line (one row, wraps on narrow screens)
Use the shared `components/FilterChip.tsx` (`FilterChip`, `SingleSelectMenu`, `ClearFiltersLink`). Look at how the campaigns list (`pages/ListPages.tsx`, or wherever `FilterChip` is used today) wires them up, and copy that pattern. In order:
1. **Search**: the sunken search field the page has today. Placeholder "Search reports". It keeps passing `q` to `useReports`.
2. **Folder**: All Folders, each folder from `useFolders()`, then **No Folder** (`folder=none`, as today). Show each folder's report count if the existing component supports a trailing detail; otherwise leave counts out. Hide the chip when the workspace has no folders, as today.
3. **Component**: All Components, then the same component list the page builds today (catalog order, only components with datasets or reports). Keep `?component=`: other menus link to it.
4. **Dataset**: every dataset in `useCatalog()` that has at least one report in the list. Pass `dataset` to `useReports` (the API already accepts it).
5. **Owner**: the distinct `owner_name`s in the list, sorted A–Z. Filter on the client.
6. **Favourites**: an on/off chip with a star icon. When on, it shows only `favourite` reports. It combines with any tab.
7. `ClearFiltersLink`: shown only when at least one filter (not the tab) is set. It clears them all.
8. Right-aligned: "18 of 48 reports" (shown / total). Show it only when filtered.

A chip that's set shows its value in the label (e.g. "Dataset: Messages"), as `FilterChip` does elsewhere. Every filter lives in the URL (`folder`, `component`, `dataset`, `owner`, `fav=1`), so a link reproduces the view.

### 4. Table: one flat list, no group rows
Remove the Favourites group and the per-component group rows. Use the shared `components/DataTable.tsx` if it supports what follows; otherwise keep a plain table styled like other list tables. Card wrapper, 1px hairlines, no shadows.

Columns:
| Column | Content |
|---|---|
| (no header text, `sr-only` "Favourite") | The existing `FavouriteStar`. |
| **Name** (sortable) | A 32px rounded square in the subtle fill holding a 16px view icon (lucide: `Table2` grid, `ChartColumn` chart, `Sheet` pivot, `ListTree` hierarchy; pick sensible icons for Key Influencers and Decomposition Tree). The icon's accessible label is the view name, from the current `VIEW_LABEL` map. Then the name as the link to `/insights/reports/:id`, then the existing `AiPill` when `ai`. Under the name, one 12px line: component name · dataset label · folder name (or "No folder"), on one line with an ellipsis. Don't use the description here. |
| **Owner** (sortable) | `owner_name`, or "—". |
| **Access** | 16px icon + word. `visibility === 'WORKSPACE'` → Building2 icon, "Everyone". PRIVATE and `shared` → Users icon, "Shared". PRIVATE and not shared → Lock icon, "Private". (The API sends no share count, so it's "Shared", not "Shared · 3".) |
| **Schedule** | Join `useSchedules({})` on `kind === 'report' && item_id === report.id`. Active schedule: CalendarClock icon in the action colour plus a short rhythm and the recipient count, e.g. "Mondays · 4", "Daily · 2", "Monthly · 6". Build the rhythm from `every` and `on_day` the way the Scheduled page or the schedule line already words it; reuse that helper if there is one. Paused: the same text in Gray 800 with "Paused". None: a Gray 400 "—". If the schedules request fails or is forbidden, show "—" for all rows and never block the table. |
| **Last Run** (sortable, the default, newest first) | `formatDateTime(last_run_at)`, or a Gray 400 "Never run". |

- **Sorting:** click a header to sort on the client: Name (A–Z), Owner (A–Z), Last Run (newest first, Never run last). Show the arrow on the active column. Keep it in the URL as `?sort=name|owner|last_run` and `&dir=asc|desc`.
- **Column headers:** Title Case, 13px medium, Gray 900, on the table-header fill. Not uppercase as today.
- **Rows:** 56px tall, hover on the row-hover token, the name link underlines on hover.
- **Width:** the table takes the full content width. Give Owner, Access, Schedule and Last Run fixed widths, so Name gets the rest and names stay on one line at 1440px with the Insights menu open.
- **Pages:** 20 rows a page, with "Rows 1–20 of 48", Rows per page (20 / 50 / 100, remembered in localStorage inside try/catch), and Previous / page numbers / Next. Reuse the pager the Insights grid already uses (search `ResultGrid.tsx` or `components/` for "Rows per page") rather than writing a new one.

### 5. States
- Loading, error and empty keep the existing `Spinner`, `ErrorState` and `EmptyState`.
- Empty wording per case:
  - **All Reports, no filters, can create:** "No Reports Yet". Hint: "Pick a dataset and choose what to show, or describe the report and let AI draft it." Ask AI (when available) and New Report buttons in the empty state.
  - **All Reports, no filters, can't create:** keep today's "Nobody has shared a report with the workspace yet."
  - **My Reports, empty:** "No Reports of Yours Yet", with the same hint and buttons.
  - **Shared With Me, empty:** "Nothing Shared With You Yet". Hint: "Reports other people share with you, or with the whole workspace, appear here."
  - **Filters match nothing:** "No Reports Match These Filters", with a Clear Filters link.

## Rules
- Nothing the list shows today may be lost: the AI mark, favourites, component, folder, dataset, owner, private/shared and last run all stay. They just move.
- Title Case for labels; sentences stay sentences. Blue 600 is the only action colour. Tokens and the existing Tailwind classes only, never raw hex or palette classes. Use the `components/Form.tsx` button classes.
- Keep the page in step with the rest of the app's current theme (pill controls, 16px cards): use the same classes as neighbouring list pages.
- Few comments, clear names. Keep the file's header comment accurate.

## Tests
- Update the existing tests that cover this page: `apps/insights/Library.test.tsx` mentions Favourites; search the `apps/insights/*.test.tsx` files for "All Reports" and the group rows. Use `src/test/mockApi.ts`.
- Add tests for:
  - The tabs: Mine and Shared With Me split by owner, and the counts are right.
  - The Favourites toggle.
  - Each dropdown filter, and that it lands in the URL.
  - Clear Filters.
  - Sorting by Name and by Last Run.
  - The Access words for the three cases.
  - The Schedule column for an active schedule, a paused one, none, and a failed schedules request.
  - Each empty-state wording.
  - The Ask AI button hidden when AI is off.
  - `?component=` still filtering on first load.
- From `frontend/`, run `npm run typecheck`, `npm run lint` and `npm test`. All must pass.

## Check it
Run `npm run dev` and open `/insights/reports` (or the `/dev/...` sample route if Insights has one). Compare it side by side with `docs/mockups/reports-list-b.html` at 1440px wide with the Insights menu open, then at phone width (no horizontal page scroll; the filter line wraps).

## Report back
Report back with: the files changed, the test results, a screenshot at 1440px, and anything that didn't match the mockup or this prompt (and why).
