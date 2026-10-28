# Report Editor: Build Plan

Mockup (approved 2026-10-28): `docs/mockups/report-editor-workspace.html`. The first mockup, `docs/mockups/report-editor.html`, was replaced by it. Frontend only; the backend is a given API. Every control on today's editor must survive (see the mockup's "What changes" table). Run `npm run typecheck`, `npm run lint` and `npm test` from `frontend/` after each phase. Commit only when the user asks.

Today: `pages/ReportEditorPage.tsx` holds a header of eleven controls and switches between two builders, `editor/FieldWells.tsx` and `editor/Steps.tsx` (remembered in `localStorage` key `insights.editor`). Both edit one `ReportDefinition` through the helpers in `editor/definition.ts`, which stay as they are.

Decided in the mockup:
- the editor is a workspace: own bar, three docked panes (Data 248px · canvas · Build/Settings 344px), only the panes scroll;
- the side rail and the Insights side menu step aside while editing; the navy top bar stays;
- one builder replaces Field Wells and Steps: **Show**, **Split By**, **Only Include**, **Order**;
- "Report Filters" is called **Viewer Filters** in the editor;
- a new **Update Automatically** switch (on by default; off shows Run Preview).

Defaults where the mockup is silent (say if any is wrong):
- the data source cannot be changed in the editor, as today: the card shows its name and description with no ▾;
- the **Sum ▾** menu offers every calculation and every comparison the report can take today (up to six, with Target), not only the two in the mockup;
- **Discard Changes** drops the changes without asking (it is the explicit choice); leaving with ‹ while there are unsaved changes asks first, in the page;
- **See Versions** is left out of the editor (versions open from the report page); ⋯ holds Show the SQL and the version line;
- Update Automatically is remembered per browser.

## Phases

Status 2026-10-29: E1–E6 built in-session, uncommitted on `create-report-and-base-reports`. Changes made while building: the rule builder lays a rule on two lines in the narrow pane (field; then operator and value); Field Wells / Steps' layouts briefly lost a `min-h-0` that made them overlap in narrow windows (fixed in E3, deleted in E6).

| Phase | What changes | Main files |
|---|---|---|
| E1 | Workspace frame and the editor bar: hide rail and side menu, own bar, saved / unsaved state, Close / Discard Changes, Save, ‹ asks when unsaved | `pages/ReportEditorPage.tsx`, `components/AppShell.tsx`, `routes.tsx` |
| E2 | Canvas and status line: grey canvas, labelled Viewer Filters chips, the result card, empty state, status line with Update Automatically and Show the SQL | `pages/ReportEditorPage.tsx`, new `editor/PreviewStatus.tsx` |
| E3 | Data pane: data card, search, Dimensions / Measures / Custom Fields / Linked Measures, + on hover, In Use, drag, footer actions | new `editor/DataPane.tsx` |
| E4 | The builder: Show, Split By, Only Include, Order; cards with a menu, Move Up / Move Down, grip on hover in 2+ sections, drop targets | new `editor/Builder.tsx`, new `editor/BuilderCard.tsx` |
| E5 | Settings tab: Viewer Filters, Detail Report, Tooltip Report, Component; Build / Settings tabs | new `editor/EditorSettings.tsx` |
| E6 | Clean-up: delete Field Wells and Steps, the layout switch and its key, update the playground and tests | `editor/FieldWells.tsx`, `editor/Steps.tsx`, `pages/InsightsPlayground.tsx`, tests |

Build in order: every phase touches `ReportEditorPage.tsx`. Until E4 lands, the old builders keep working inside the new frame (E1–E3 put them in the middle and right panes as they are), so the editor is usable after every phase.

---

## E1 · Workspace frame and editor bar

- **Frame.** On `/insights/reports/:id/edit` the shell hides the 88px rail and the Insights side menu; the navy top bar stays. Do it with a route flag the shell reads (e.g. a `handle: { workspace: true }` or a wrapper element), not by matching the path inside `AppShell`. The page fills the height under the top bar; the body never scrolls, only the panes.
- **Editor bar** (60px, white, 1px line under it):
  - ‹ icon button "Back to Report" (`/insights/reports/:id`);
  - over the name, `Reports · {Component}` in 12px Gray 800;
  - the name: 18px semibold input, border on hover, Blue border on focus (as today, `maxLength` 200);
  - saved state beside it: grey dot + "Saved {date} · Version {n}"; once anything changes, amber dot + **Unsaved Changes** (warning text colour);
  - right: Change With AI (secondary, sparkles icon; opens today's `ChangeWithPrompt` in a popover under it), ⋯ (Show the SQL, the version line), a hairline, then **Close** (secondary) which becomes **Discard Changes** when there are unsaved changes, and **Save** (primary; disabled until something changes, and while the definition is not complete or empty, as today).
- **Leaving.** Discard Changes drops the draft and goes back to the report. ‹ (and Close) with unsaved changes opens a small in-page dialog: "Leave without saving? Your changes to {name} will be lost." Leave / Keep Editing. No `confirm()`.
- Component moves off the bar (to Settings in E5; until then keep `ComponentSelect` in ⋯).
- Tests: the bar's states (Saved → Unsaved Changes, Close → Discard Changes, Save enabled), the leave dialog, the shell hiding the rail on this route only.

## E2 · Canvas and status line

- The middle pane is the canvas: `bg-canvas` (grey), 20px 24px padding, scrolls on its own.
- **Viewer Filters** row on top when the report has any: a 12px semibold "Viewer Filters" label, then today's `ParameterBar` chips.
- The result in today's `ResultCard` with `ViewBar` (unchanged from the report page work).
- **Empty state** (no fields yet): today's Steps row-count card, reworded for the builder: the count, then "{data}, all time. Add a number under Show, or a field under Split By, to start."
- **Status line** pinned under the canvas (40px, white, 1px line above): green dot + `runWords` ("Preview · 9 rows · 71 ms · live data", or "Running…", or "Finish the rules to run"); right: **Update Automatically** switch, **Run Preview** link when it is off, **Show the SQL** (opens `SqlDialog`).
- Update Automatically off: the preview stops following the draft; Run Preview runs the current draft once. Remember the choice in `localStorage` (`insights.editor.auto`, wrapped in try/catch).
- Tests: the status line words, Update Automatically off holds the preview until Run Preview, Show the SQL opens the dialog.

## E3 · Data pane

New `editor/DataPane.tsx`, 248px, 1px line on its right.
- Head: "Data" label; the data card (database icon, the dataset's label in semibold, no ▾); "Search fields" (sunken pill).
- List, scrolling: **Dimensions**, **Measures**, then **Custom Fields** and **Linked Measures** (each heading with a + that opens today's `CustomFieldsDialog` / `LinkedMeasuresDialog`; Linked Measures only when the data has links, as today). Headings 14px semibold Gray 900.
- Rows 32px: type icon, label, the PII / SHARED marks (`SharedFieldMark`), a + on hover that adds the field where it belongs (`addField`), **In Use** in blue on fields already in the report (not clickable). Rows are draggable (`text/x-field`, as today).
- Footer: New Custom Field, Link a Measure (when the data has links).
- Search filters every group; an empty result says "No fields match “{term}”."
- Tests: + adds a measure to Show and a dimension to Split By, In Use rows, search, the two dialogs open.

## E4 · The builder

New `editor/Builder.tsx` in the right pane's Build tab, replacing Field Wells / Steps there. Each section: 14px semibold heading, a 13px Gray 800 question under it, its cards, an add link. Sections are drop targets for fields dragged from the Data pane (Blue border while over).

- **Show** — "What should the report count or add up?" One card per measure (`measures(definition)`).
  - Card: grip, type icon, label, **{Calculation} ▾** chip, ⋯, ✕.
  - The chip's menu: **Add Up As** (the field's `aggregates`, radio, `AGGREGATE_LABEL`) and **Compare With** (every `compareOptions` kind; a checkbox each, up to `MAX_COMPARISONS`; ones that cannot apply are greyed with their reason). Chosen comparisons show as small Blue 100 tokens under the card name, each with ✕; a target kind shows a Target number input under the card (today's `CompareControl` logic).
  - "+ Add a Number" opens a searchable list of unused measures.
- **Split By** — "How should it be broken down?" One card per dimension (`dimensions(definition)`).
  - Card: grip, type icon, label, bucket chip when the field has buckets (`BUCKET_LABEL`, "As Is" for none), ⋯, ✕.
  - With two or more splits and the view is Pivot or Chart: each card except the first shows **Put It: Down the Side / Across the Top** (small segmented control) mapped to `setAcross`; only one can be Across the Top.
  - "+ Add a Split" opens a searchable list of unused dimensions.
- **Only Include** — "Leave rows out, e.g. “Channel is Email”." Today's `FilterBuilder` (compact), its add link reading **Add a Rule**.
- **Order** — folded by default; the closed row reads the current setting, e.g. "Sent · Lowest First · All Rows". Open: Sort By (column + Lowest First / Highest First, `setSort`), Show (All Rows / First 100 … 5,000, `setLimit`), and today's `TopControl` (Every Value / Top N, with Others).
- **Reordering.** The grip shows only on hover, and only in a section with two or more cards. ⋯ on those cards: **Move Up** / **Move Down** (`moveField`), greyed at the ends. Cards alone in their section show neither. Dragging a card within its section reorders it too.
- Tests: rewrite the Field Wells / Steps tests against the builder (add, remove, calculation, comparisons and target, bucket, Across the Top, rules, order, Move Up / Down, drop from the Data pane).

## E5 · Settings tab

New `editor/EditorSettings.tsx`. The right pane gets two tabs, **Build** and **Settings** (44px, Blue 600 underline on the chosen one).
- Rows (44px+, icon, label, one-line helper, value + › on the right), each opening today's dialog:
  - **Viewer Filters** — "Questions people answer when they open the report", count → `ParametersDialog`;
  - **Detail Report** — "Opens when someone clicks a row", None / count → `DetailReportDialog`;
  - **Tooltip Report** — "Shows when someone points at a chart mark", only for a chart with a split, as today → `TooltipReportDialog`;
  - **Component** — `ComponentSelect` inline (moves here from ⋯).
- Rename "Report Filters" to **Viewer Filters** in the editor, the dialog title and its tests.
- Tests: each row opens its dialog and shows its count; Tooltip Report only for charts.

## E6 · Clean-up

- Delete `editor/FieldWells.tsx`, `editor/Steps.tsx`, the `Layout` switch, `readLayout` and the `insights.editor` key.
- `pages/InsightsPlayground.tsx` (`/dev/insights`) shows the builder instead of the two layouts.
- Remove `localStorage.setItem('insights.editor', …)` from DrillCompare, Formatting, SharingAccess, Insights, Gaps and Gaps2 tests and point them at the builder's labels.
- Update the file comment on `ReportEditorPage.tsx`.

## Build prompt (paste per phase)

> Build phase E{n} of the report editor redesign in `frontend/`, exactly as written in `docs/build-prompts/report-editor.md` and shown in `docs/mockups/report-editor-workspace.html`. Frontend only. Keep every existing control and test intent; update tests that look for moved controls. Tailwind tokens only, Title Case labels, Blue 600 as the only action colour, `components/Form.tsx` primitives. Run `npm run typecheck`, `npm run lint` and `npm test`, then check the editor in the app on NWA ("Weekly Sends Over Time", "Revenue by Campaign and Month", "Contacts by Region") at 1440px. Don't commit.
