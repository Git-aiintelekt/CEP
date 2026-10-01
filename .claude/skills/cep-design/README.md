# Handoff: CEP Design System

> **designnew.md (the latest design.md) overrides this file** where they differ: page background is White (Gray 50 is removed), brand tokens are named `--brand-100/600/700/800`, navy and teal are `--color-sidebar` and `--color-wordmark-*`, and CEP's vocabulary is campaign / journey / template / contact list / audience. The nav rail has no section headings: Home, Campaigns, Journeys, Templates, Contact lists, then a divider and Settings (admins).

## Overview
CEP is a flat, data-dense enterprise design language for a multi-tenant customer engagement platform (email/SMS campaigns). This bundle is the **foundation layer only** — design tokens (colour, type, spacing, shape, motion) plus specimen cards that show each token in use. There are no product screens and no component library here; the job of this handoff is to get the token layer and the usage rules into a real codebase so components built there are consistent from day one.

## About the Design Files
The files in this bundle are **design references authored in HTML and CSS** — a token layer and a set of specimen cards demonstrating intended look, not production code to paste in wholesale.

Two things have different statuses:

- `styles.css` + `tokens/*.css` **are** meant to be adopted more or less directly. They are plain CSS custom properties with no framework dependency; drop them in, or port the values into whatever the codebase already uses (Tailwind theme, CSS-in-JS theme object, SCSS map, Style Dictionary, native design tokens).
- `guidelines/*.html` are **specimen cards** — visual documentation of each token group. Do not ship them. Read them to see what each token looks like, then recreate the equivalent UI in the target environment using its existing patterns and libraries. If no environment exists yet, choose an appropriate framework and implement there.

## Fidelity
**High fidelity, foundations only.** Every hex, size, duration and easing below is final and exact — treat them as locked values, not suggestions. What is *not* specified is component markup: no Button, Table, Modal or Drawer implementation exists in this bundle. Build those in the codebase's own idiom, composing the tokens below and following the usage rules in the Interaction, Elevation and Motion sections.

## Screens / Views
None. This system deliberately ships no screens — nothing was supplied to recreate. The specimen cards in `guidelines/` are documentation surfaces, not product views.

The token spec names the surfaces the system is expected to cover, which is the intended component inventory: buttons, links, active states, focus rings, selected rows, active nav background, input backgrounds, table cells, tags, dashboard tiles/KPIs, dropdowns and overflow menus, side-panel drawers, toast notifications.

App shell: fixed **240px** left rail in Navy 900 (**64px** collapsed), no border or shadow, following the nav rail spec (2026-09-25): a 32px brand-blue "CEP" mark with "Customer Engagement", 40px items with 4px corners and 20px icons, the current page on a solid fill with a 3px left bar, tooltips on collapsed items, a 32px collapse toggle straddling the rail's edge, and a 240ms width change with labels leaving first and returning last. The template editors use the same rail, always collapsed; fixed **56px** top bar matching the rail header height; one scrolling content column with the top bar's own side padding (16px, 32px from md) and no width cap, so page content lines up with the top bar's search and Sign out. Drawers are **480px** pinned to the right edge; modals are **480px** centred. Nothing centres itself on the page except modals and empty states.

---

## Design Tokens

All tokens are CSS custom properties on `:root`. Entry point is `styles.css`, which `@import`s the seven files in `tokens/`.

### Colour — primitives

Neutrals:

| Token | Hex | Role |
|---|---|---|
| `--white` | `#FFFFFF` | card/panel surfaces |
| `--gray-75` | `#F9FAFB` | subtle / alternating surfaces, row hover |
| `--gray-100` | `#EEEFF5` | subtle borders, icon-button hover |
| `--gray-150` | `#E7E8EF` | default borders, hairlines |
| `--gray-400` | `#9EA2AD` | emphasis borders, placeholders, disabled text |
| `--gray-700` | `#6B6F7B` | no text role in the app (kept for the template editors' exact copy and the Archived tag) |
| `--gray-800` | `#4B4F5B` | labels, helper text, notes, icons |
| `--gray-900` | `#17181C` | primary text |

Brand:

| Token | Hex | Role |
|---|---|---|
| `--color-sidebar` | `#20265D` | sidebar — the only dark surface |
| `--color-wordmark-navy` | `#273FA8` | wordmark (navy variant) |
| `--brand-600` | `#3863DB` | action blue — primary buttons, links, focus ring |
| `--brand-700` | `#4E47DD` | pill / large-CTA variant |
| `--brand-800` | `#2B4DD0` | brand tag text, pressed/hover on blue fills |
| `--brand-100` | `#DEE9FC` | brand tag background, selected rows |
| `--color-wordmark-teal` | `#418EAE` | wordmark (teal variant) |

Status & callout:

| Token | Hex | Role |
|---|---|---|
| `--green-500` | `#5EC16A` | success accent / dot |
| `--green-800` | `#0E6027` | success text |
| `--amber-100` | `#FCF4CB` | warning background |
| `--amber-500` | `#E8A13B` | warning accent |
| `--amber-800` | `#87451D` | warning text |
| `--red-100` | `#FAE2E2` | error background |
| `--red-500` | `#DD514C` | error accent |
| `--red-600` | `#C93A32` | plain error text (no background) |
| `--red-800` | `#A92E26` | error text on `--red-100` |
| `--maroon-700` | `#B44B23` | danger-dark accent |
| `--orange-100` | `#F6D5A4` | high-severity background |
| `--orange-600` | `#D96129` | high-severity accent |
| `--periwinkle-100` | `#EEF2FE` | callout background |
| `--periwinkle-500` | `#7570D4` | callout icon |
| `--periwinkle-700` | `#4139C2` | callout link |
| `--periwinkle-800` | `#312E7C` | callout text |
| `--yellow-50` | `#FEFDF2` | flagged table row |

### Colour — semantic tokens

Always consume these in component code, not the primitives.

| Token | Resolves to |
|---|---|
| `--bg-page` | `--white` (design.md: page background is White; Gray 50 is removed) |
| `--bg-surface` | `--white` |
| `--bg-surface-subtle` | `--gray-75` |
| `--bg-sidebar` | `--color-sidebar` |
| `--border-subtle` | `--gray-100` |
| `--border-default` | `--gray-150` |
| `--border-emphasis` | `--gray-400` |
| `--text-primary` | `--gray-900` |
| `--text-secondary` / `--text-label` | `--gray-800` |
| `--text-on-dark` | `--white` |
| `--wordmark-teal` | `--color-wordmark-teal` |
| `--wordmark-navy` | `--color-wordmark-navy` |
| `--brand-primary` | `--brand-600` |
| `--brand-primary-pill` | `--brand-700` |
| `--brand-tag-bg` / `--brand-tag-text` | `--brand-100` / `--brand-800` |
| `--status-success-accent` / `--status-success-text` | `--green-500` / `--green-800` |
| `--status-warning-accent` / `-bg` / `-text` | `--amber-500` / `--amber-100` / `--amber-800` |
| `--status-error-accent` / `-bg` / `-text` | `--red-500` / `--red-100` / `--red-800` |
| `--status-error-plain-text` | `--red-600` |
| `--status-danger-dark-accent` | `--maroon-700` |
| `--status-high-accent` / `-bg` | `--orange-600` / `--orange-100` |
| `--callout-bg` / `-icon` / `-link` / `-text` | periwinkle 100 / 500 / 700 / 800 |
| `--row-flagged-bg` | `--yellow-50` |

Derived convenience roles also exist for links, focus, icons and legacy surface names: `--surface-page`, `--surface-card`, `--surface-subtle`, `--surface-hover`, `--surface-selected`, `--surface-inverse`, `--sidebar-bg`, `--icon-on-dark`, `--text-tertiary`, `--text-placeholder`, `--text-disabled`, `--text-inverse`, `--text-link`, `--text-link-hover`, `--border-strong`, `--border-focus`, `--focus-ring`, `--icon-default`, `--icon-strong`, `--icon-brand`, `--icon-disabled`. See `tokens/colors.css` for the exact mapping.

**Text greys** (2026-09-30), one role each:
- `Gray 900` `#17181C`: text, values and column headers (`ink-900` in the app).
- `Gray 800` `#4B4F5B`: labels, helper text, notes and icons (`ink-800`); 8.2:1 on white, 7.1:1 on Gray 100.
- `Gray 400` `#9EA2AD`: placeholder and disabled only (`ink-300`).
- Rule: no `Gray 700` text on `Gray 100` or `Gray 150` fills (4.4:1 and 4.1:1, under 4.5:1). The template editors keep Gray 700 as their approved exact copy.

**Rule: no colour is decorative.** If something is coloured, it carries meaning. Callouts are periwinkle, never a blue-tinted info box — blue is reserved for action.

**Status tags** (2026-09-30): each lifecycle status has its own hue, `--tag-{status}-bg` / `-text` / `-dot` (in the app: `bg-tag-{status}-bg`, `text-tag-{status}-text`, `bg-tag-{status}-dot`). Every text passes 4.5:1 on its background. Shape: 22px tall, 4px corners (`--radius-sm`), 12px semibold, 8px side padding.

| Status | Background | Text | Dot | Why |
|---|---|---|---|---|
| Draft | `#F2EBE4` | `#5D4535` | `#B08A6E` | sand: unfinished, quiet, not yet a problem |
| Test Published | `#EBE6FA` | `#48309A` | `#8068DA` | violet: out, but only to testers |
| Production Published | `#D5EEF3` | `#0C5664` | `#2B9AAE` | teal: approved for real customers, not yet sending |
| Scheduled | `#FCE4D8` | `#8F3A12` | `#E4703E` | coral: a date is set, it will go out |
| Active (also Sending, Preparing) | `#D8F1E7` | `#0C5F43` | `#2FA57A` | green: going out now |
| Completed | `#DDEDFB` | `#1A5486` | `#3C8AD1` | light sky blue, by design: done, calm; far enough from action Blue 600 |
| Paused | `#FAF0C6` | `#6F5300` | `#D4A91C` | yellow: held back, needs a decision |
| Failed (also Cancelled) | `#FADCE1` | `#9C1C33` | `#D9485F` | rose: stopped |
| Archived | `#FFFFFF`, 1px dashed `#9EA2AD` | `#6B6F7B` | `#CFD2DC` | the only unfilled tag: out of use |

- **The 6px dot shows only on live statuses:** Active, Sending and Preparing, always in the Active dot colour. No other status has a dot; the other `-dot` tokens are for charts and legends.
- Sending and Preparing use the Active colours; the label tells them apart. Cancelled uses the Failed colours.
- Contact list types: Production uses Production Published, Test uses Test Published.
- An unknown status falls back to neutral grey (`Gray 100` / `Gray 800`). The blue brand tag is for merge-field tokens only, never a status.

**Category tags** say what a thing is, never its state: the status tag's shape with a 12px Lucide icon (1.5 stroke) where the dot would be, **never a dot**. `--cat-{name}-bg` / `-text`:

| Category | Background | Text | Icon |
|---|---|---|---|
| Journey | `#F4E4F1` | `#6E2A5E` | Route |
| Campaign | `#E6E7FB` | `#393E9E` | Megaphone |
| Seasonal | `#E5EFD9` | `#3E5A1C` | (later) |
| Loyalty | `#F7E3EC` | `#86264F` | (later) |
| Promotional | `#FDE7DA` | `#8A3E14` | (later) |
| Transactional | `#EEEFF5` | `#4A4E5A` | (later) |

Only Journey and Campaign are built (`components/CategoryTag.tsx`); the other four wait for a data field. A new category never reuses a status hue, and its text must pass 4.5:1 on its background.

**Plum accent**: `--plum-50 #FBF4F9`, `--plum-100 #F4E4F1`, `--plum-200 #E8C6E0`, `--plum-500 #A8488F`, `--plum-700 #8A3375`, `--plum-800 #6E2A5E`.
- Use for: journey markers; icon badges (a `plum-700` icon on a `plum-100` square) on KPI tiles, the Create New buttons and section headers; at most one `plum-50` header strip per section; small highlight marks.
- Never for: buttons, links, status, large fills, body text, or more than two plum elements in one small component. Blue 600 stays the only action colour.
- Keep plum at least 8px away from a violet Test Published tag so the two don't read as one.

### Typography

Families: `--font-display: 'Plus Jakarta Sans'` (headings), `--font-body: 'Inter'` (everything else). **No monospace font exists in the system** — numerals use `font-variant-numeric: tabular-nums` inside the two families.

Weights: `--fw-regular 400`, `--fw-medium 500`, `--fw-semibold 600`, `--fw-bold 700`.

Sizes: `--fs-page-title 26px` · `--fs-section-title 19px` (`-sm 16px`) · `--fs-card-title 15px` · `--fs-body 14px` · `--fs-body-lg 16px` · `--fs-helper 13px` (`-sm 12px`) · `--fs-label 12px` · `--fs-stat 32px` (`-sm 24px`).

Line heights: `--lh-tight 1.2` · `--lh-heading 1.3` · `--lh-body 1.5` · `--lh-dense 1.4`. Letter spacing: `--ls-tight -0.02em` (display type), `--ls-label 0.02em`.

Composite roles (CSS `font` shorthand):

| Token | Value |
|---|---|
| `--text-page-title` | 600 26px/1.25 Plus Jakarta Sans, -0.02em |
| `--text-section-title` | 600 19px/1.3 Plus Jakarta Sans, -0.02em — a heading on the page itself |
| `--text-card-title` | 600 15px/1.3 Inter — a title inside a bordered box |
| `--text-body-role` | 400 14px/1.5 Inter |
| `--text-helper` | 400 13px/1.4 Inter |
| `--text-label` | 600 12px/1.4 Inter |
| `--text-stat` | 600 32px/1.2 Plus Jakarta Sans |

KPI numbers: Plus Jakarta Sans 600 at 24–32px. Table numerics: Inter 500 at 14–16px, **right-aligned** in numeric columns so decimals line up.

### Spacing & layout

8px scale: `--sp-1 4` · `--sp-2 8` · `--sp-3 12` · `--sp-4 16` · `--sp-5 24` · `--sp-6 32` · `--sp-7 40` · `--sp-8 48` · `--sp-9 64` · `--sp-10 80` (px).

Semantic: `--gap-inline 4` · `--gap-icon-label 8` · `--pad-compact 12` · `--pad-field 16` · `--pad-card 16` · `--gap-section 24` · `--pad-page 32`.

Control heights — **three only**: `--control-h-sm 32px`, `--control-h-md 40px`, `--control-h-lg 48px`.
Table rows — **two only**: `--row-h-compact 40px`, `--row-h 48px` (`--row-h-tall 56px` exists but is rare).
Layout: `--sidenav-w 240px`, `--sidenav-w-collapsed 64px`, `--drawer-w 480px`, `--content-max` (no longer applied: see the app shell above).

### Shape, borders, elevation

Radii: `--radius-xs 2px` (checkbox) · `--radius-sm 4px` (tags, tooltips) · `--radius-md 6px` (menus) · `--radius-lg 8px` (cards, modals, drawer bodies) · `--radius-xl 12px` · `--radius-pill 999px` (switch track, progress fill only). **Buttons and controls round with their height:** 40px → 8px (`--radius-control-lg`), 32px → 6px (`--radius-control-md`), 24px and under → 4px (`--radius-control-sm`). The template editors keep 4px on every control. **Nothing is more rounded than 8px** (the Templates landing page is an approved exception). Aliases: `--radius-control`, `--radius-card`, `--radius-tag`, `--radius-modal`.

Borders: `--border-w 1px`, `--border-w-strong 2px`, `--accent-bar-w 3px`.

Elevation — **exactly three shadows, each with one job**:

| Token | Value | Used by |
|---|---|---|
| `--elev-menu` | `0 4px 16px rgba(20,23,31,0.10)` | dropdowns, overflow menus |
| `--elev-modal` | `-12px 0 32px rgba(20,23,31,0.14)` | right-edge drawers (cast leftward) |
| `--elev-toast` | `0 8px 24px rgba(20,23,31,0.16)` | toasts |

`--scrim: rgba(19,21,27,0.45)`. Cards, tiles, table rows and headers **never** carry a shadow, hover or otherwise — structure comes from 1px hairlines. No inner shadows; "sunken" (search and header fields) is a `Gray 100` fill with a transparent border at rest, white while focused. Disabled fields are also `Gray 100` but keep their visible `Gray 150` border and `Gray 400` text, which is what tells them apart.

### Motion

Durations: `--dur-fast 70ms` (hover/press) · `--dur-base 110ms` (control state change) · `--dur-moderate 240ms` (drawer/modal entrance, progress fills) · `--dur-slow 400ms` (reserved).

Easings — one family: `--ease-standard cubic-bezier(0.2,0,0.38,0.9)` · `--ease-entrance cubic-bezier(0,0,0.38,0.9)` · `--ease-exit cubic-bezier(0.2,0,1,0.9)`.

Prebuilt transitions: `--transition-control` (background-color, border-color, color, box-shadow @ `--dur-base`) and `--transition-panel` (transform, opacity @ `--dur-moderate`).

**No bounce, no spring, no overshoot, no attention loops.** Skeletons don't shimmer; toasts don't wobble. Drawers slide on X and fade the scrim; modals fade only. The only continuous animation in the system is a 700ms linear spinner ring.

---

## Interactions & Behavior

State rules apply to every interactive control:

- **Primary is the only solid blue button; the primary action goes last.** Secondary is an outline: a white fill, a 1px `Blue 600` border and `Blue 600` text; hover and press are `Blue 100` with a `Blue 800` border and text; disabled is the standard grey (`Gray 100` fill, `Gray 400` text, `Gray 150` border), never opacity. The 1px border sits inside the height, so a secondary and a primary side by side are both 32px or 40px. The template editors are an approved exact copy and keep their solid blue secondary buttons, as do the solid "outline" icon buttons. Danger, ghost and link buttons keep their own looks.
- **Hover** — `Blue 600` fills darken toward `Blue 800`; neutral surfaces go to `Gray 75`; ghost controls pick up `Blue 100`; icon buttons `Gray 100`.
- **Press** — one step darker again. **Colour change only — never a scale or shrink transform.**
- **Focus** — `Blue 600` border plus a 3px `rgba(56,99,219,0.24)` ring (`--focus-ring`). The ring is never removed, on any control. Base CSS also sets a `2px` `:focus-visible` outline at `1px` offset.
- **Selected** — `Blue 100` background (rows, nav) with `Blue 800` text. No checkmark-only selection.
- **Disabled** — `Gray 100` fill, `Gray 400` text, `Gray 150` border. Never a faded brand tint.

Cards: white fill, 1px `Gray 150` border, 8px radius, 16px padding, optional header with a 16/600 display title and a 1px divider beneath. No shadow, no colour-tinted left accent bar, no hover lift, no gradient. A card wrapping a table gets zero padding.

Transparency & blur: **almost never.** The only alpha in the system is the 45%-black scrim and the shadow colours. No frosted glass, no `backdrop-filter`, no translucent panels. Tag and notification backgrounds are solid light tints, not alpha.

Backgrounds & imagery: **there are none.** No photography, illustration, patterns, textures or gradients — flat colour fields only. The only "graphics" are data itself (bars, progress fills, tags).

## Charts

Every chart, now and later, uses the shared kit in `frontend/src/components/charts/` (`Chart`, with line, area and bar series; `BarList` for horizontal bars) and looks and behaves the same. No chart library, and never a chart styled on its own: a new chart is a new use of the kit. Future prompts say "use the chart kit".

**Design**
- **No chart border.** The card is the frame. Gridlines are 1px `Gray 100` (`line-subtle`), horizontal only, on round steps from 0.
- **Axis labels** are 12px `Gray 800` with tabular figures. The x axis shows only as many labels as fit.
- **Palette**, fixed and ordered, defined once as tokens (`--chart-1`…`6` here, `--color-chart-1`…`6` in `index.css`): Blue 600, Green 500, Amber 500, Gray 400, wordmark teal, Periwinkle 500. Series n takes chart-n unless it names one. Blue is only ever the first or primary series. When a chart has exactly two series, the second is Plum 500 (`--chart-pair`, `--color-chart-pair` in `index.css`); three or more follow the fixed order. Blue stays first. "Two" counts every series the chart is given, so hiding one with the legend never recolours the rest; a colour a series names still wins. A status colour never stands for something with a different meaning. **Neutral parts:** when a whole splits into parts that are neither good nor bad (the reasons customers were held back: frequency cap, no consent, suppression list), use Blue 600, wordmark teal and Periwinkle 500 (`--chart-1`, `--chart-5`, `--chart-6`), skipping green and amber so no part reads as a success or a warning.
- **Lines** are 2px with no dots, except the hovered point: a 6px dot with a 2px white ring. **Areas** sit under their line at no more than 12% opacity, the one alpha fill allowed besides the scrim and shadows. **Bars** are grouped per category, 4px apart, with a 2px radius on the top corners only.
- **Mixed marks:** a series may set `mark: 'bar' | 'line'` over the chart's type, so one chart draws bars and a line together (revenue as bars, cost as a line). Bars are drawn first, lines on top; colours still follow the palette rules.
- **Reference line** (`reference`: a target pace, a benchmark): a 1.5px dashed line (4 4) in Gray 400 (`--chart-4`). It is not a series: it takes no colour slot (revenue + cost + target pace is two series, so cost is Plum), it can't be hidden, and the y axis always includes it. It is in the legend (a dashed swatch, as a plain label), the tooltip and the numbers table.
- **Legend**, above the chart: 10px square swatches with 13px labels (a short line swatch for a line among bars, a dashed one for the reference). Clicking an item shows or hides its series (`aria-pressed`); a hidden series has a hollow swatch and a struck-through label. The legend can sit elsewhere, for example in a card header's right slot: render `ChartLegend` there with `useChartLegend()`, and give the Chart `legend="none"` and the same `hidden`. The toggles work the same.
- **States**, the same for every chart:
  - loading: a Gray 100 skeleton block at the chart's height;
  - empty: one line of `Gray 800` text saying what will fill it;
  - error: inline "The chart could not be loaded." with the reason and Retry.

**Interaction**
- **Bar fade:** while a category is active (hover, tap or keyboard), bars in the other categories drop to 40% fill opacity and the active category's bars stay full, over 70ms. Lines and the reference line never fade.
- **Hover** shows a 1px `Gray 400` vertical guide at the nearest point and a tooltip:
  - a white card with a 1px hairline, 8px radius and the toast shadow;
  - the time or category in 12px `Gray 800`, then one row per series (swatch, label, value);
  - it stays inside the chart area and flips to the other side of the guide near the right edge.
- **Keyboard:**
  - the plot takes focus (with the focus ring);
  - ← and → move between points with the same guide and tooltip, and Home and End jump to the ends;
  - Escape hides the tooltip;
  - the point in view is announced politely.
- **Touch:** tap a point to show it; tap outside the chart to hide it.
- **Numbers:** every chart carries its data as a table. It is visually hidden for screen readers until someone presses "Show the numbers".
- **Motion:** nothing animates its drawing; the bar fade is the one transition, and reduced motion drops it.

**BarList** (`components/charts/BarList.tsx`): horizontal bars with no axes, for a ranking or a funnel.
- Each row is a list item: the label (cut with a tooltip when long), the value on the right (14px semibold `Gray 900`, tabular), an optional secondary value (13px `Gray 800`, such as the share), and a 6px bar with round ends under them: a `Gray 100` track, the fill in `--chart-1` unless the row names another.
- Bars are measured against `max` (the largest value by default). A row with no value shows its text ("Not Tracked") in `Gray 800` and no bar.
- The same loading, empty and error states as `Chart`, and an accessible name from `title`, so it reads as "Delivered 1,142,300".

## Home cockpit patterns

The Home page (`frontend/src/features/home/`) is built from these parts; reuse them before drawing new ones. Paths are from `frontend/src/`.
- **KpiTile / KpiStrip** (`features/home/components/KpiTile.tsx`): one figure with its change, benchmark, supporting line and, for revenue, a target bar; states `ready`, `loading`, `notTracked` ("Not Tracked", SMS/MMS opens), `notSetUp` ("Not Set Up Yet", never $0) and `unavailable` (a grey dash). Six in one bordered strip with 1px dividers: 6 → 3 × 2 → 2 → 1 across.
- **ChangeChip** (`features/home/components/ChangeChip.tsx`): borderless, green up / rose down / grey flat; % for counts and money, pt for rates and shares; "—" with no earlier figure.
- **BenchmarkTag and SeverityTag** (`features/home/components/HomeTags.tsx`): Good / Fair / Poor as plain tags; alert severity critical / blocking / governance in danger / warning / callout, each with its icon.
- **FilterChip + SingleSelectMenu / MultiSelectMenu** (`components/FilterChip.tsx`): 40px, 8px corners; active = Blue 100 fill, Blue 600 border, Blue 800 text (a Period chip is never active); menus are listboxes, the multi-select a draft until Apply.
- **SectionHeader** (`features/home/components/SectionHeader.tsx`): page level (19px, no card) or card level (18px, a divider under it); an optional 28px plum icon square, count badge, helper text and a right-hand slot that wraps as one group.
- **Card layout** (`features/home/homeLayout.ts`): Home cards keep the design layout when all are present; otherwise they re-pack two per row (odd count: one wide card full width), never stretching a lone card.
- **HomeCard** (`features/home/components/HomeCard.tsx`): a `<section>` named by its heading, white with a 1px hairline and 8px corners, no shadow; renders nothing when its data is unavailable.
- **Diverging target bars** (`features/home/sections/TopBottom.tsx`): from a 1px 100% line, over target grows right in Blue 600, under grows left in the danger accent, each with its % beside it; bar length against the largest deviation shown.
- **Freshness line** (`features/home/sections/NeedsAttention.tsx`): a 6px green dot and "Updated at 14:05 EDT", the load time in the workspace zone.
- **Create New is a row of outline buttons beside the greeting** (2026-10-02), each with its plum icon, no card: the page's first block is what needs attention.
- **Needs Attention is one strip of alert cells** (2026-10-02), 64px tall: the severity icon on its tint, the count, the label with the category under it, and the action as a link after a hairline. A cell is as wide as its words and wraps whole to the next line of the strip; four show until View All.
- **Needs Attention is hidden when there are no alert groups** (also when alerts are unavailable or forbidden); no collapsed row, no heading. Loading keeps its placeholder cards and an error keeps the section with Try Again. The page order is greeting, Create New, Needs Attention, Marketing Performance, then the card rows (`features/home/homeLayout.ts` decides what shows).


Not applicable — this bundle has no application logic. Components built from it should follow the target codebase's existing state conventions. The only state the tokens care about is the visual state set above (rest / hover / press / focus / selected / disabled), which should map to whatever state model the target framework uses.

---

## Content & Copy Rules

These matter as much as the visuals; CEP writes like a competent colleague leaving a handover note — short, factual, numeric, never chirpy.

- **Title case for UI labels; full sentences stay sentences** (replaces sentence case, 2026-09-25).
  - **Title case on** interface labels, the short names of things and actions:
    - buttons, and links that perform an action ("Create Campaign", "Save and Close");
    - page, pop-up, drawer, card and section titles;
    - tabs and step names ("Test & Publish");
    - navigation items;
    - field labels, and placeholder-style labels in selects ("All Sources");
    - table and column headers;
    - menu items, segmented-control options and filter chips;
    - legend labels;
    - tags and badges we write, including status names ("Test Published").
  - **Casing:** capitalise every word except a, an, the, and, but, or, nor, for, to, of, in, on, at, by, as, via, per, vs, from, with, into, onto, over and upon, which stay lowercase unless first or last ("Add List to Leave Out", "From an Audience or a Clone", "Choose from Library", "Log In with Okta").
    - Both parts of a hyphenated word are capitalised ("E-Receipt", "Auto-Attached").
    - "&" stays as it is.
  - **Sentences stay sentences:** help text, hints, descriptions, notices, errors, toasts, confirmations, empty-state messages, tooltips that are sentences, and anything ending in a full stop ("Internal name, visible to your team only"). A title that is a whole question or sentence stays sentence-style ("When should this go out?").
  - **Never changed:** user and API data (campaign, list, template and person names, server messages), codes, emails and URLs.
  - **Accessible names** (aria-label) follow the visible text they describe.
  - The nav rail has no section headings.
- **Second person for instructions; the product never says "we" or "I".** "3 campaigns are scheduled today."
- **Lead with the number**, always with its unit, tabular figures and thousands separators. Percentages one decimal ("97.4%"); currency two in tables ("12,480.00"), abbreviated in tiles ("$4.82M").
- **Verbs for actions, nouns for places.** "Send test", "Publish campaign" / "Dashboard", "Contact lists".
- **Errors say what failed, when, and what to do**: "Test publish failed — email provider returned 503 at 04:12 UTC." plus a Retry. No "Oops".
- **Empty states describe the fix**: "No matching campaigns / Try widening the date range or clearing filters."
- **No emoji, ever. No exclamation marks.** Status is carried by tag colour (plus a 6px dot on live statuses), never a glyph.
- **Time is explicit and zoned**: "13 Aug 2026, 06:41 UTC".
- **Consistent vocabulary**: *campaign*, *journey*, *template*, *contact list*, *campaign list*, *audience*, *governance*, *test publish*, *production publish*, *party ID*. Status vocabulary is locked: Draft / Test Published / Production Published / Scheduled. Never use invoice/audit words (line item, exception, reconciled, ledger, SLA, tolerance).

---

## Assets

**Three documented substitutions — please confirm or replace before production:**

1. **Fonts.** Plus Jakarta Sans and Inter are the correct specified families, but no font binaries were supplied. `tokens/fonts.css` loads them from Google Fonts. **Replace with self-hosted `@font-face` rules pointing at licensed `.woff2` files.** Weights in use: Plus Jakarta Sans 600/700, Inter 400/500/600.
2. **Icons.** The source spec defines no icon set. **Lucide 0.454.0** (outline, 24px grid, 1.5px stroke, round caps) is documented as the closest neutral match. Sizes: 16px in controls/table cells/menu rows, 20px in side nav and icon buttons, 24px in empty states, 12–14px in tags and sort indicators. Colour via `--icon-default` / `--icon-strong` / `--icon-brand` / `--icon-disabled`. Outline only, never multi-coloured, never larger than 24px. Render as a CSS `mask-image` on a sized `<span>` so the glyph inherits `currentColor`. **Never hand-roll SVG paths.**
3. **Logo.** No logo or brand mark was supplied and none was drawn. Wherever a mark would sit, "CEP" is set in Plus Jakarta Sans 700 at `-0.03em`, in `--wordmark-teal` or `--wordmark-navy` on light surfaces and white on Navy 900. `assets/` contains no logo file.

Commonly used Lucide glyphs: `search, filter, download, upload, plus, check, x, chevron-down/left/right, chevrons-up-down, arrow-up/down/right, ellipsis-vertical, trash-2, external-link, refresh-cw, settings, layout-dashboard, file-text, triangle-alert, circle-alert, circle-check, circle-help, info, bell, lock, inbox, search-x, building-2, user-plus, trending-up, trending-down, link, play, calendar, minus`.

---

## Files

```
SKILL.md                 Claude Code skill entry point — see "How to use" below
README.md                this file
DESIGN-SYSTEM.md         the full authored design-system reference (voice, visual rules, index)
styles.css               single entry point; @imports the seven token files
tokens/
  fonts.css              webfont loading (currently Google Fonts — substitution)
  colors.css             named primitives + semantic tokens
  typography.css         families, weights, scale, composite roles
  spacing.css            8px scale, control/row heights, layout widths
  shape.css              radii, border widths, the three elevations, scrim
  motion.css             durations, easings, prebuilt transitions
  base.css               element resets, link colours, focus outline
guidelines/              21 specimen cards (documentation, do not ship)
  color-*.html           primitives, surfaces, text & wordmark, borders, status, callout
  type-*.html            display, body, numerics, pairing
  spacing-*.html         scale, in use, control & row heights
  brand-*.html, el*.html radii, elevation, motion, interaction states, wordmark, iconography
thumbnail.html           brand tile
```

## How to use this in Claude Code

Drop the folder into `.claude/skills/cep-design/` in the target repo (or `~/.claude/skills/cep-design/` to use it across projects). `SKILL.md` makes it invocable; Claude Code will read `README.md` and `DESIGN-SYSTEM.md` and follow the token layer when generating UI.

To adopt the tokens directly, copy `styles.css` and `tokens/` into the app and link `styles.css` once at the root. To port instead, `tokens/colors.css` is the source of truth for the mapping — keep the primitive → semantic split when translating into a Tailwind theme or a CSS-in-JS theme object, and have components reference only semantic names.

Open any file in `guidelines/` in a browser to see the tokens rendered.
