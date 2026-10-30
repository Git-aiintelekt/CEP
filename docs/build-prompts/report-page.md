# Report Page: Build Plan

Mockup (approved 2026-10-28): `docs/mockups/report-page.html`. Frontend only; the backend is a given API. Every control on today's page must survive (see the mockup's "What changes" table). Run `npm run typecheck`, `npm run lint` and `npm test` from `frontend/` after each phase. Commit only when the user asks.

Open questions, built with these defaults until the user says otherwise:
- a filter change runs the report at once (no Run Report button);
- the view keeps the word **Grid**;
- orders with no campaign are labelled **Not Credited** (only where the result has an empty dimension value; the cell shows that word in Grid, Pivot, Hierarchy and the chart axis);
- summary figures are the report's own measures, at most four, no owner choice yet;
- Highlights are written by rules when the AI add-on is off.

On hold: "change vs previous period" on the figures. A report run returns no previous value today; it needs a backend request (like `docs/requests/backend-recently-viewed.md`). Don't build it.

## Phases

| Phase | What changes | Main files |
|---|---|---|
| P1 | Chart bars: at most 56px wide, 2px top corners (fixes the pills and the giant circle) | `components/charts/series.tsx` |
| P2 | Header: back arrow, description, "Updated … ago" + Refresh, Details drawer | `pages/ReportViewerPage.tsx`, new `components/ReportDetailsDrawer.tsx` |
| P3 | Filters as chips that run at once | `components/ParameterBar.tsx` |
| P4 | One toolbar inside the result card, the same slots in every view | `components/ReportViews.tsx` (`ViewBar`, `ReportResult` footer) |
| P5 | Summary figures + What This Means line | new `components/ReportSummary.tsx` |
| P6 | Highlights card + Explain With AI | new `components/highlights.ts`, `components/ReportHighlights.tsx` |

P1 stands alone. P2 to P6 all touch `ReportViewerPage.tsx`; build them in order. `ViewBar` and `ParameterBar` are also used by `ReportEditorPage.tsx` (and `ParameterBar` by `EmbedPage.tsx` / `TileCard.tsx`); the editor gets the same new toolbar and chips, and the embed and tile keep working.

---

## P1 · Chart bars

`BarSeries` in `components/charts/series.tsx` draws every bar as a pill (`barPath`, radius = half the width). A wide bar becomes a circle (Contacts by Region, Sends by Channel).

- Bars: width at most 56px (keep the 4px gap and the ~78% group), corners 2px at the top only, square on the axis. Negative bars: 2px at the bottom.
- The stacked rects (line ~114) get the same 2px on the top segment only.
- Dashboards use the same parts, so they get the fix too. Check `/dev/dashboard` and a report chart in the app.
- Tests: update any that assert the pill path; add one that a single-category bar is no wider than 56px.

## P2 · Header and Report Details

In `ReportViewerPage.tsx`:
- Breadcrumb line goes; a 32px round back-arrow link to `/insights/reports` sits before the title (aria-label "Back to Reports").
- The description (`report.data.description`) always shows under the title. It no longer gives way to the run line. Nothing shown when empty.
- Right of the title: "Updated {relative time from `ran_at`}" (helper text). Hovering shows `runWords(info)` and the version, e.g. "Live data · ran in 8 ms · version 2". Then a round Refresh icon button (aria-label "Refresh", same mutation as today), a round "i" Details button, and ⋯ More Actions.
- Component and Folder selects leave the header and move into the drawer.
- More Actions: add "Report Details" (opens the drawer) and "Help With Reports" (opens today's `PageHelp`), and keep every other row as it is.
- New `components/ReportDetailsDrawer.tsx` on the shared `Drawer`, title "Report Details". Sections, divided by hairlines:
  1. Description, with an Edit link (editors only, to `/edit`).
  2. Owner · Data (dataset label) · Folder (`FolderSelect`) · Component (`ComponentSelect inline`). The two selects only when `can_edit`; else plain text.
  3. Shared With ("Only you" / "Shared") + Share link · Schedule (words or "Not scheduled") + Schedule link · Alerts + Add link · Comments count + Open link. Each link opens the dialog the page already has.
  4. Version + See Versions link · Last Edited (date and name, from the newest version) · Created · Last Run (`runWords`).
- Tests: back link, description shown, Refresh still refreshes, drawer opens from both the "i" and More Actions, Folder/Component change from the drawer, links open the right dialogs.

## P3 · Filter chips

Replace the boxed form in `ParameterBar.tsx` with one line of `FilterChip`s, the list pages' pattern (`components/FilterChip.tsx`).
- One chip per parameter: "{Label}" when unanswered; "{Label}: {value}" in the set style when answered. Period is always set (it is required); it shows "Period: Last Year".
- Menus: list parameters use `MultiSelectMenu` / `SingleSelectMenu` as the answer type needs. Yes/No uses a single-select. Period uses a single-select of today's choices plus Custom Range. Custom Range shows two date fields in the menu with an Apply button. Text and number answers get a small field with Apply.
- The Period chip's tooltip and its menu show the dates in full: "29 Oct 2025 to 28 Oct 2026" (fix today's "28 Oct to 28 Oct 2026", which drops the start year).
- Changing a chip runs the report at once (`onRun`). There is no Run Report button. While `running`, show "Updating…" with a small spinner at the line's right. Clear Filters appears when any optional answer is set.
- Required parameters still unanswered: the chip shows a required mark and the result area keeps today's "Choose X above" message. `missing` (the 422 detail) shows under the line.
- The editor's preview uses the same chips. `EmbedPage` and `TileCard` keep working (check their tests).
- Tests: chip labels, auto-run on change, custom range, required waiting state, editor preview still runs.

## P4 · One result toolbar

Rewrite `ViewBar` in `components/ReportViews.tsx` as a toolbar row inside the result card (top border-bottom hairline), with three slots:
- **Left:** the view switch (Grid, Chart, Hierarchy, Pivot, plus the analysing view when it is in use) as today's `SegmentedControl`.
- **Middle** (after a short divider; only what applies):
  - Chart: a **Chart Type** button (icon + kind name) opening a menu of all 15 kinds in three groups of five icon tiles. The groups are Compare (Bars, Lines, Area, Combo, Scatter), Parts of a Whole (Stacked, 100% Stacked, Pie, Treemap, Funnel) and More Charts (KPI Card, Gauge, Waterfall, Bubble, Map). Then **Across** when the kind takes a series, **Target** for KPI/Gauge, and **Map Of** for Map.
  - Pivot: **Across**, and **Value** when there is more than one measure.
  - Influencers / Decomposition: **Explain** / **Split** (today's measure select).
- **Right:** **Show** (sliders icon) is a menu of switches: Forecast, Flag Anomalies and Repeat By for charts; All Values and Trend Column for pivots. A count badge shows how many are on. It is left out when the view has none. Hierarchy: **Expand All** and **Collapse All** buttons move here from above the table. Then **Analyse**, a menu with Key Influencers and Decomposition Tree.
- Small pill controls (32px), one row; it wraps only when narrow.
- A footer line at the bottom of the card shows the view's hint (today's drill-down hint, e.g. "Click a bar to see the campaigns inside it; right-click for more."). Show the Numbers sits at its right for charts and the grid's pages for the grid. The `DrillBar` stays between the toolbar and the result.
- The editor's `ViewBar` keeps its Format button (`onFormat`), placed in the right slot.
- Tests: each view shows only its slots, the Chart Type menu sets every kind, the Show count, Analyse opens the views, the editor's Format button. Update the tests that look for the old chart-kind segmented control.

## P5 · Summary figures and What This Means

New `components/ReportSummary.tsx`, a card between the filter line and the result card. It is hidden while running or when the report has no measure.
- Figures: up to four, one per measure column (`aggregate` and not `compare`), in the report's order. Each card shows the label, the whole-result value (the grand entry in `result.totals` when present, else the sum of the rows for sum/count; skip measures that cannot be totalled, such as averages without a total) formatted with `formatCell`, and a small line under it: the period's dates.
- What This Means: call `insightsApi.meaning(id, params)` (react-query key `keys.meaning`). When the answer is `ready` and has a verdict, show a line under the figures: the tone tag (Good / Watch / Act, the `--tag-*` colours) + bold title + summary + a "Why it's judged this way" link that opens today's Explain panel. A figure that matches a `MeaningFigure` gets its band tag and target words in its small line. Not ready → no line, and no error shown.
- Explain stays in More Actions.
- Tests: figures from totals and from rows, no card without measures, the meaning line and figure tags, nothing when meaning is not ready.

## P6 · Highlights

New `components/highlights.ts`: pure functions that write up to four lines from a `RunResult`, with the bold part separate from the rest:
- the biggest change between the first and last date bucket when the first dimension is a date ("Revenue fell 30% from August to October");
- the top value of the main measure and the runner-up;
- the largest share when one value is over 30% of the total;
- the lowest non-zero value.
Skip a line whose figures are missing, and write nothing for one row.

New `components/ReportHighlights.tsx` card under the result card. The heading is "Highlights", with a helper "Worked out from these rows". The lines sit in two columns with a small dot each. When `useAssistant()` says Explain's AI is on, an **Explain With AI** outline button replaces the lines with the AI summary and points (today's `explain` mutation). The AI disclaimer stays, as in `ExplainPanel`. The card is hidden when there are no lines.

Tests: `highlights.test.ts` for each rule and the edge cases; the card shows and hides, and Explain With AI swaps in the AI text.

---

## Build prompt (paste per phase)

> Build phase P{n} of the report page redesign in `frontend/`, exactly as written in `docs/build-prompts/report-page.md` and shown in `docs/mockups/report-page.html`. Frontend only. Keep every existing control and test intent; update tests that look for moved controls. Tailwind tokens only, Title Case labels, Blue 600 as the only action colour, `components/Form.tsx` primitives. Run `npm run typecheck`, `npm run lint` and `npm test`, then check the page in the app on NWA (reports "Revenue by Campaign and Month", "Weekly Sends Over Time", "Contacts by Region", "Journey Conversions") and in `/dev/dashboard` for P1. Don't commit.
