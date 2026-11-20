# Insights admin pages: build prompt

Approved mockup: `docs/mockups/insights-admin-pages.html` (2026-10-30). **Status: A1–A7 built 2026-10-30 on branch `insights-admin-pages` (uncommitted).** Six pages under Insights: Scheduled, Uploaded Files, Shared Formulas, Benchmarks, Run Log, Usage. Build phase by phase, A1 to A7, in `frontend/src/apps/insights/`. Frontend only; the one backend ask is in `docs/requests/backend-meaning-verdict-wording.md`. Every live feature stays. Run `npm run typecheck`, `npm run lint` and `npm test` from `frontend/` at the end of each phase. Commit only when asked. Work on a new branch off the dashboards branch (`insights-dashboards`), since it uses `RowMenu` from there.

## Built differently from the first plan

- **Old frames kept where they are still used.** `ScheduleDialog` (one screen) stays for Schedule on a report's and a dashboard's page; it and `ScheduleFlow` share `ScheduleFields`. `AlertsDialog` stays on the report page; it and `AlertFlow` share `AlertFields`. `UploadReviewDialog` stays for the `/dev` data playground; the review fields are shared by `UploadFlow` and Create Report.
- **Alerts can be edited** (the API had `PUT`), so Alerts' ⋯ has Edit Alert as well as Check Now.
- **Add a Formula**: Show As sits on step 2, inside the formula editor next to the check. Sharing from Custom Fields opens on step 2.
- **Run Log** pages of 20, 50 or 100 (the shared pager); a run's reason opens on its row instead of sitting under every tag.
- **Usage**: Where adds the report's data; two reports still alike also say when each was changed.
- **Benchmarks**: the count and base are called **Counted** and **Out Of**; the band rows stack on a phone.
- Five tables outside these pages (RunDetails, AskAbout, AskForReport, SourcePicker, the formula editor's lists) still have uppercase headers; left for a later pass.

## The pattern every page follows

- Header: the title, a count badge, one primary Add button (where the page adds anything).
- Filter line: `SearchField`, `FilterChip`s, Clear Filters, all kept in the address (`useSearchParams`, as `ReportListPage`).
- The table in a card (`rounded-lg border border-line`), Title Case headers on a `bg-surface-subtle` row (`text-label font-medium text-ink-900`), as the Reports list.
- One `RowMenu` (`components/RowMenu.tsx`) per row: fixed to the screen, opens upwards near the bottom, closes on Escape, click outside, scroll or Tab. A disabled item gives its reason in `detail` ("1 report uses it").
- Pages of 25 or 50 with `Pager` (`components/ResultGrid`) once a table has more rows.
- Add and Edit use `SetupDialog` (the shared create frame: "Step n of m", the bar, Back / Next, fixed header and buttons, the body scrolls). Two steps where the mockup has them; Edit opens on the step people change most.

## Defaults taken where the mockup is silent

- **Needs Action** replaces "Act" on the Benchmarks page (the band name, the table header, the hints). Explain's verdict chip text comes from the API, so it stays "Act" until the backend ask lands.
- **Send Now** is left out (no endpoint).
- **All Datasets** on Shared Formulas lists every dataset's formulas with `useQueries` over the catalogue's datasets (one request each). The chip starts on All Datasets.
- **Usage's Where column** is filled in the browser from the reports list (folder, owner) and the dashboards list (owner); the usage endpoint gives only names.
- **Run Log** pages and exports what the endpoint returns (no server paging exists); Export CSV is built in the browser, like a tile's.
- **Upload status**: Draft reads **Needs Review**.

## A1 · The shared pieces and the broken menus

- A `useListParams(keys)` hook: read and set filters in the address, Clear Filters. Use it on all six pages.
- Replace the hand-rolled menus on Uploaded Files and Shared Formulas with `RowMenu` (this fixes the clipped last rows and the menus that never close). Benchmarks' pencil and bin, and Scheduled's Pause / Delete links, become a `RowMenu` too.
- A `listHeader` class and a `CountBadge` the six pages share (the Reports list's header row and its count).
- Tests: a ⋯ on the last row opens within the window and closes on Escape and on a click outside.

## A2 · Scheduled

- Header with **New Schedule**; tabs **Schedules · n** and **Alerts · n**.
- Filters: search, **Kind** (Reports / Dashboards), **Owner**, **Status** (Active / Paused / Failing). These replace All / Mine / Paused.
- Table: Report or Dashboard (with kind and owner), Every, As, **Recipients** as people chips (two, then "+n", all in the tooltip), Last Sent (Sent / Failed tag with the time and the reason), Next.
- ⋯: Edit Schedule, Open the Report / Dashboard, Pause or Resume, Delete. Only for whoever may change it.
- **New Schedule**, a `SetupDialog` of two steps: 1 What to Send (search reports and dashboards, pick one), 2 When and to Whom (today's `ScheduleDialog` fields, with recipients as chips, and a sentence summing it up). Split `ScheduleDialog` into its fields and a frame so the report page's Schedule and this flow share them. Edit opens on step 2.
- **Alerts tab**: the same table style (Report, Measure and Condition, Checked, Last Checked, Status) with ⋯ (Edit, Pause, Delete) and **New Alert** in two steps: 1 Pick a Report, 2 the alert's fields (from `AlertsDialog`).
- The "no mail server" state stays as a notice above the table.

## A3 · Uploaded Files

- Header **Upload a File** with the count. The page's drop box goes; dropping a file anywhere on the page opens the upload pop-up with it. A small note on the filter line says so.
- Filters: search, **Status** (Ready / Needs Review), **Used by Reports**.
- ⋯: Review Columns, New Report, Replace File…, Delete (disabled with "n reports use it").
- **Upload a File**, a `SetupDialog` of two steps: 1 Choose the File (drop or choose, the limits, the file read with a status line), 2 Review the Columns (today's `UploadReviewDialog` body, its table scrolling inside). Save, then Create a Report as today. Review Columns from the ⋯ opens step 2 alone.

## A4 · Shared Formulas

- Header **Add a Formula** with the count. The Dataset field becomes a **Dataset** chip (All Datasets first); the table gains a **Dataset** column.
- Filters: search, Dataset, **Kind** (Measure / Field), **Certified**.
- ⋯: Edit, Certify or Remove Certification, Remove (disabled with "Reports use it").
- **Add a Formula**, a wide `SetupDialog` of two steps: 1 About the Formula (Dataset, set from the chip; Kind; Name; Show As; Description), 2 The Formula (the box at full width, fields and functions beside it, the live check). Edit opens on step 2. The parts come from `SharedFormulaDialog`.

## A5 · Benchmarks

- Header **Add a Benchmark** with the count; the suggested-defaults banner on top when a pack offers them; when none is added yet and no pack offers any, an empty state that points to Add Base Reports.
- Filters: search, **Dataset**.
- Table: Measure, Dataset, Good, Watch, Needs Action (coloured tags with the unit), Judged Fairly From. ⋯: Edit, Remove.
- **Add a Benchmark**, a `SetupDialog` of two steps: 1 What to Judge (Dataset, Measure with its format said, Better When as two cards), 2 The Bands (Good and Needs Action with the measure's unit beside the number, Watch worked out, a coloured bar, the sentence, "Judge Small Numbers Fairly" folded with the count and base). Edit opens on step 2. Validation as today (Needs Action on the right side of Good; count and base together).

## A6 · Run Log and Usage

- **Run Log**: summary figures (runs, timed out, refused, failed, median time); filters in the address; Title Case headers; pages of 50; a run that did not go OK opens on its row to show why, with Open the Report; **Export CSV** of the runs shown.
- **Usage**: Period and **Kind** as chips; Most Opened names say where they live; tabs **All Openings** and **Nobody Opened**; a **Where** column (folder · owner); the Nobody Opened rows get a ⋯ (Open, Move to Folder, Delete…) using the Reports list's actions.

## A7 · Clean-up, tests, docs

- Remove the old menus, links and the old `UploadReviewDialog` / `SharedFormulaDialog` / `ScheduleDialog` frames once nothing uses them.
- Tests per page: the filters in the address, the ⋯ items and their reasons, each two-step flow (Back keeps what was typed), Edit opening on its step.
- The user guide (`docs/manuals/user-guide/59-insights.md`): Scheduled, Uploaded Files, Shared Formulas, Benchmarks, Run Log and Usage sections.
