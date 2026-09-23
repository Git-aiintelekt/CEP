# Handoff: CEP Design System

> **designnew.md (the latest design.md) overrides this file** where they differ: page background is White (Gray 50 is removed), brand tokens are named `--brand-100/600/700/800`, navy and teal are `--color-sidebar` and `--color-wordmark-*`, and CEP's vocabulary is campaign / journey / template / contact list / audience. Nav sections are ENGAGE / MANAGE.

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

Intended app shell (documented, not built): fixed **256px** left rail in Navy 900 (**64px** collapsed) with a 1px right border; fixed **56px** top bar matching the rail header height; one scrolling content column with the top bar's own side padding (16px, 32px from md) and no width cap, so page content lines up with the top bar's search and Sign out. Drawers are **480px** pinned to the right edge; modals are **480px** centred. Nothing centres itself on the page except modals and empty states.

---

## Design Tokens

All tokens are CSS custom properties on `:root`. Entry point is `styles.css`, which `@import`s the seven files in `tokens/`.

### Colour — primitives

Neutrals:

| Token | Hex | Role |
|---|---|---|
| `--white` | `#FFFFFF` | card/panel surfaces |
| `--gray-75` | `#F9FAFB` | subtle / alternating surfaces, sunken inputs |
| `--gray-100` | `#EEEFF5` | subtle borders, icon-button hover |
| `--gray-150` | `#E7E8EF` | default borders, hairlines |
| `--gray-400` | `#9EA2AD` | emphasis borders, placeholders, disabled text |
| `--gray-700` | `#6B6F7B` | secondary text, default icons |
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
| `--text-secondary` | `--gray-700` |
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

**Rule: no colour is decorative.** If something is coloured, it carries meaning. Callouts are periwinkle, never a blue-tinted info box — blue is reserved for action.

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
Layout: `--sidenav-w 256px`, `--sidenav-w-collapsed 64px`, `--drawer-w 480px`, `--content-max` (no longer applied: see the app shell above).

### Shape, borders, elevation

Radii: `--radius-xs 2px` (checkbox) · `--radius-sm 4px` (tags, tooltips) · `--radius-md 6px` (menus) · `--radius-lg 8px` (cards, modals, drawer bodies) · `--radius-xl 12px` · `--radius-pill 999px` (switch track, progress fill only). **Buttons and controls round with their height:** 40px → 8px (`--radius-control-lg`), 32px → 6px (`--radius-control-md`), 24px and under → 4px (`--radius-control-sm`). The template editors keep 4px on every control. **Nothing is more rounded than 8px** (the Templates landing page is an approved exception). Aliases: `--radius-control`, `--radius-card`, `--radius-tag`, `--radius-modal`.

Borders: `--border-w 1px`, `--border-w-strong 2px`, `--accent-bar-w 3px`.

Elevation — **exactly three shadows, each with one job**:

| Token | Value | Used by |
|---|---|---|
| `--elev-menu` | `0 4px 16px rgba(20,23,31,0.10)` | dropdowns, overflow menus |
| `--elev-modal` | `-12px 0 32px rgba(20,23,31,0.14)` | right-edge drawers (cast leftward) |
| `--elev-toast` | `0 8px 24px rgba(20,23,31,0.16)` | toasts |

`--scrim: rgba(19,21,27,0.45)`. Cards, tiles, table rows and headers **never** carry a shadow, hover or otherwise — structure comes from 1px hairlines. No inner shadows; "sunken" is a `Gray 75` fill.

### Motion

Durations: `--dur-fast 70ms` (hover/press) · `--dur-base 110ms` (control state change) · `--dur-moderate 240ms` (drawer/modal entrance, progress fills) · `--dur-slow 400ms` (reserved).

Easings — one family: `--ease-standard cubic-bezier(0.2,0,0.38,0.9)` · `--ease-entrance cubic-bezier(0,0,0.38,0.9)` · `--ease-exit cubic-bezier(0.2,0,1,0.9)`.

Prebuilt transitions: `--transition-control` (background-color, border-color, color, box-shadow @ `--dur-base`) and `--transition-panel` (transform, opacity @ `--dur-moderate`).

**No bounce, no spring, no overshoot, no attention loops.** Skeletons don't shimmer; toasts don't wobble. Drawers slide on X and fade the scrim; modals fade only. The only continuous animation in the system is a 700ms linear spinner ring.

---

## Interactions & Behavior

State rules apply to every interactive control:

- **Hover** — `Blue 600` fills darken toward `Blue 800`; neutral surfaces go to `Gray 75`; ghost controls pick up `Blue 100`; icon buttons `Gray 100`.
- **Press** — one step darker again. **Colour change only — never a scale or shrink transform.**
- **Focus** — `Blue 600` border plus a 3px `rgba(56,99,219,0.24)` ring (`--focus-ring`). The ring is never removed, on any control. Base CSS also sets a `2px` `:focus-visible` outline at `1px` offset.
- **Selected** — `Blue 100` background (rows, nav) with `Blue 800` text. No checkmark-only selection.
- **Disabled** — `Gray 100` fill, `Gray 400` text, `Gray 150` border. Never a faded brand tint.

Cards: white fill, 1px `Gray 150` border, 8px radius, 16px padding, optional header with a 16/600 display title and a 1px divider beneath. No shadow, no colour-tinted left accent bar, no hover lift, no gradient. A card wrapping a table gets zero padding.

Transparency & blur: **almost never.** The only alpha in the system is the 45%-black scrim and the shadow colours. No frosted glass, no `backdrop-filter`, no translucent panels. Tag and notification backgrounds are solid light tints, not alpha.

Backgrounds & imagery: **there are none.** No photography, illustration, patterns, textures or gradients — flat colour fields only. The only "graphics" are data itself (bars, progress fills, tags).

## State Management
Not applicable — this bundle has no application logic. Components built from it should follow the target codebase's existing state conventions. The only state the tokens care about is the visual state set above (rest / hover / press / focus / selected / disabled), which should map to whatever state model the target framework uses.

---

## Content & Copy Rules

These matter as much as the visuals; CEP writes like a competent colleague leaving a handover note — short, factual, numeric, never chirpy.

- **Sentence case everywhere.** Buttons, headings, table headers, tabs. Exception: 11px uppercase side-nav section headings (`ENGAGE`, `MANAGE`).
- **Second person for instructions; the product never says "we" or "I".** "3 campaigns are scheduled today."
- **Lead with the number**, always with its unit, tabular figures and thousands separators. Percentages one decimal ("97.4%"); currency two in tables ("12,480.00"), abbreviated in tiles ("$4.82M").
- **Verbs for actions, nouns for places.** "Send test", "Publish campaign" / "Dashboard", "Contact lists".
- **Errors say what failed, when, and what to do**: "Test publish failed — email provider returned 503 at 04:12 UTC." plus a Retry. No "Oops".
- **Empty states describe the fix**: "No matching campaigns / Try widening the date range or clearing filters."
- **No emoji, ever. No exclamation marks.** Status is carried by tag colour plus a 6px dot, never a glyph.
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
