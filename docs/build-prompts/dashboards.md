# Dashboards redesign: build prompt

Approved mockup: `docs/mockups/dashboards.html` (2026-10-29). **Status: D1–D7 built 2026-10-30 (uncommitted).** Built phase by phase, D1 to D7, in `frontend/src/apps/insights/`. Frontend only: anything the API cannot give goes in `docs/requests/backend-dashboard-templates.md`. Every live feature stays (CLAUDE.md, "A restyle keeps every live feature"). Run `npm run typecheck`, `npm run lint` and `npm test` from `frontend/` at the end of each phase. Commit only when asked.

## Built differently from the first plan

- **Duplicate** names the copy “Copy of {name}”, as Reports does.
- **Grid packs in lines** (each line as tall as its tallest tile), not by filling gaps, so a page of rows converts exactly.
- **+ Add** opens the panel at once (in D4 it was a menu of Report Tile / Text / Button). The panel stays open after adding.
- **Phone Preview** is offered in Grid too, not only on a free canvas.
- Tiles refused as busy (the workspace's limit of four runs at once) are tried again up to four times.
- The tile's line names the report only when the tile's title differs from it.

## Defaults taken where the mockup is silent

- **Sizes replace row layouts.** In Grid mode every tile has a size; Free Canvas stays for exact placing. Headline numbers stay ordinary tiles (no forced first row).
- **Grid is stored as canvas cells.** The API keeps `rows` (widths 1, 2, 3, 4, 2-1) or `canvas` + `cells` (12 columns, x/y/w/h); it has no room for a Grid flag. So Grid saves `canvas: true` with cells packed left to right, top to bottom, with no gaps. On opening, a page is Grid when it has rows, or when its cells equal their own packing; anything else is Free Canvas. Rows convert with the existing `rowsToCells`.
- **Sizes:** Small ¼ (3 columns), One Third (4), Medium ½ (6), Two Thirds (8), Wide ¾ (9), Full Width (12). One Third and Two Thirds are added so today's “Three across” and “Wide and narrow” rows keep their shape. Tall doubles the tile's usual height (`startSize`).
- **Templates:** the pack catalogue gives only the dashboards' names (`BasePack.contents.dashboards`). Until the backend request lands, a card shows the name, the pack's channel tag and a generic tile picture, with no tile count. Use This Template opens Add Base Reports on that pack: adding a ready-made dashboard means adding its pack.
- **Who can open it** (Only Me / The Workspace), today a select in the editor bar, goes on the editor's settings line.
- **Duplicate** has no endpoint: get the dashboard, create one named “{name} (Copy)”, then update it with the layout, period and comparison. Saved views, comments and schedules are not copied.
- **Export CSV** on a tile is built in the browser from the tile's result rows. **Show the Numbers** opens the tile's rows as a table in a dialog.

## D1 · The list, laid out like Journeys

`pages/DashboardListPage.tsx`, with the Journeys list as the pattern (`apps/cep/features/journeys/JourneysPage.tsx`, `templates/JourneyTemplatesPanel.tsx`, `templates/TemplateCards.tsx`).

- Header: “Dashboards” and **Create Dashboard** (was New Dashboard), the same create call. No description line.
- **Dashboard Templates**: the blue band (`bg-band`) with Start from Scratch first, then a card per dashboard in the packs this workspace is offered (`baseReportsApi.list`). Each card has a channel tag, a small tile picture, the name, a round arrow and one line: the pack's name, or “Added {date}” when that pack is in `added`. No View More while the cards fit; show the first four and a View More only if there are more. Hide the band for people who cannot create a dashboard.
- A card opens a read-only preview pop-up: the name, the pack, what adding it brings (the pack's datasets, reports and dashboards) and **Use This Template**, which opens `BaseReportsDialog` with that pack chosen. Give the dialog an optional `pack` prop.
- **Your Dashboards** with its count, then `SearchField`, `FilterChip`s Owner, Shared and Favourites, and Clear Filters, with the filters in the URL (the list filter pattern). A list / grid switch at the right, remembered like Journeys.
- The table in a card: Title Case headers, the star in the first column, the name and description, Tiles, Owner, Shared, Changed, then a ⋯: Open, Edit, Duplicate, Share, Add to / Remove From Favourites, Delete (Edit and Delete only with `can_edit`, Share only with `can_share`). Favourites are no longer grouped on top.
- Grid view: a card per dashboard with the name, description, owner, sharing tag and Changed.
- Empty states: no dashboards yet, and nothing matching the filters (with Clear Filters).

## D2 · A dashboard's header and control line

`pages/DashboardPage.tsx`, `dashboards/PeriodBar.tsx`, `dashboards/SlicerBar.tsx`, `dashboards/SavedViews.tsx`.

- ‹ Dashboards above the name; the description below it, or the tile count and period words when there is none.
- “Updated {n} ago” with Refresh (refetches every tile). **Share** and **Edit** as buttons. The ⋯ keeps Comments (with its count), Schedule, Export PDF, Export PowerPoint, Embed on Another Site and Delete. The schedule banner stays.
- Page tabs stay above the control line.
- One control line: the period as one popover (quick choices left, a calendar right, Apply), Compare With Previous Period, a hairline, the slicer chips, the chips a tile click adds, and **View: Default ▾** at the right (saved views: apply, save, delete, as today).

## D3 · Tiles

`dashboards/TileCard.tsx`, `dashboards/WordTiles.tsx`.

- Drop the grey kind word. Under the title, a small line that says what the tile reads: “Own dates · last 90 days” when the report keeps its own dates, “Click a bar to filter the other tiles” when it filters the others, else the report's name.
- A ⋯ on report tiles: Open the Report, Show the Numbers, Export CSV, Comment (the comment count shows on the tile, as today). Drill, cross-filtering and “sliced” notes stay.

## D4 · The editor frame

`pages/DashboardEditorPage.tsx`, `routes.tsx` (under `<AppShell workspace />`, like the report editor).

- The bar: ‹, the name, the save state (“Saved · Version n” or **Unsaved Changes**), Close or **Discard Changes**, **Save**. Leaving with changes asks first (`useLeaveGuard`, with the message “Your changes to {name} will be lost.”). Save stores a new version and returns to the dashboard, as Done does today.
- The settings line: Period, Compare, **Slicers · n** (a popover holding today's `SlicerEditor`), Theme, Who Can Open It, the **Grid / Free Canvas** switch, Phone Preview (Free Canvas only, as today) and **+ Add** at the right.
- Page tabs with + Add Page (ten at most). Renaming and removing a page move to a ⋯ on the chosen tab.

## D5 · Grid with tile sizes

`dashboards/canvas.ts` (a pure `pack` and `isPacked`, with tests), `dashboards/DashboardBody.tsx`, `dashboards/CanvasBody.tsx`.

- The page as it will look, on the grey canvas with a faint 4-column guide behind it. No row controls and no arrows.
- Hovering or choosing a tile shows its toolbar: drag, size ▾ (the six sizes and Tall, with the current one ticked), edit (text and button tiles, or the tile's report settings), duplicate, remove. Dragging reorders; the tiles flow again.
- A dashed **+ Add a Tile** box in the next free place opens the Add panel.
- Keyboard: the toolbar's buttons are reachable by Tab; Move Earlier / Move Later in the size menu stand in for dragging.
- Free Canvas works as today. Switching Free Canvas back to Grid packs the tiles in reading order.

## D6 · The Add panel

A right side panel replacing `AddTileDialog` and `WordTileDialog` (344px, like the report editor's Build pane).

- “Add to the Dashboard”, ✕. Report / Text / Button choice.
- Report: search, the reports grouped by folder, then Show It As (its views and, for a number, Figure with the measure) and Size. **Add to {page name}**.
- Text and Button: today's fields (`WordTileDialog`'s), plus Size. Editing a text or button tile opens the same panel with its fields filled in, and the button says Save Changes.
- The new tile lands in the next free place and is chosen, so its toolbar shows.

## D7 · Clean-up, tests, docs

- Delete `AddTileDialog.tsx` and `WordTileDialog.tsx` once nothing imports them, and the row layout controls in `DashboardBody`. Keep `cellsToRows` only if something still needs it.
- Tests: the list (band, preview, Use This Template, count, filters in the URL, ⋯ actions, Duplicate's calls, grid switch), the header and control line, tile lines and ⋯, the editor bar and leave dialog, sizes and packing (including rows converting, and a moved Free Canvas staying Free Canvas), the Add panel. Update `/dev/dashboard` (`?edit=1`) to the new editor.
- Update the Insights help chapter where it names Add Tile, Done or row layouts.
- Write `docs/requests/backend-dashboard-templates.md` (below) if not already done.
