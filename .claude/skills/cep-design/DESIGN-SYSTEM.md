# CEP Design System

> **designnew.md (the latest design.md) overrides this file** where they differ: page background is White (not Gray 50), and the invoice/audit vocabulary and "internal audit console" framing below do not apply to CEP, which is a campaign platform.

A flat, data-dense enterprise design language built around a Navy 900 sidebar, a Blue 600 action colour, a cool blue-grey neutral ramp, and typography that pairs **Plus Jakarta Sans** headings with **Inter** body and tabular numerics.

## Sources supplied

| Source | Path / link | What it gave us |
|---|---|---|
| CEP token spec (markdown) | `uploads/CEP-design-tokens.md` | Primary / neutral / semantic color ramps with locked hex values, type families + scale, 8px spacing scale, elevation rules |

**Nothing else was provided** — no codebase, no Figma file, no repository, no screenshots, no product copy, no logo files, no icon set, no imagery. Everything in this system is either (a) transcribed verbatim from that token spec, or (b) an explicitly-flagged inference marked as such below. If a real CEP codebase, Figma library or brand kit exists, attach it and this system should be re-derived from it — token values here are exact, but component inventory and screens are inferred.

### What was inferred, and from what

The token spec's usage notes name the product's surfaces directly: *buttons, links, active states, focus rings, selected rows, active nav background, input backgrounds, table cells, tags, dashboard tiles/KPIs, dropdowns and overflow menus, side-panel drawers, toast notifications.* That list is the component inventory here — nothing outside it was invented, and the one UI-kit view with no basis in the spec (Vendors) is deliberately left blank with an on-screen disclaimer.

Read together, those surfaces describe an **internal enterprise console for financial/invoice audit work**: high-density tables of monetary records, KPI tiles, a right-hand detail drawer, and a left rail of sections. That context informs the guidance below, but **this system deliberately ships foundations only** — no components, no screens. Nothing was recreated because nothing was supplied to recreate.

### Flagged substitutions

1. **Fonts** — Plus Jakarta Sans and Inter are the specified families, but **no font binaries were supplied**, so they load from Google Fonts (`tokens/fonts.css`). Send the licensed `.woff2` files and we'll self-host them with real `@font-face` rules.
2. **Icons** — the spec defines **no icon set**, so **Lucide** (1.5px outline, CDN) is documented as the closest neutral match for an enterprise UI. See ICONOGRAPHY.
3. **Logo** — **no logo or brand mark was supplied, and none was drawn.** Wherever a mark would sit, "CEP" is set in Plus Jakarta Sans 700 at `-0.03em` (see the *Wordmark (type only)* card). `assets/` holds no logo file for this reason.
4. **Product copy** — no real CEP copy was supplied. The voice rules in CONTENT FUNDAMENTALS are derived from the spec's own register (terse, lowercase-after-first-word, numeric, no exclamation) and should be confirmed by a writer.

---

## CONTENT FUNDAMENTALS

CEP writes like a competent colleague filing an audit note: **short, factual, numeric, unhurried, never chirpy.**

- **Sentence case everywhere.** Buttons, headings, table headers, menu items, tabs: "Run audit", "Open exceptions", "Invoice date". Never Title Case, never ALL CAPS except the 11px uppercase side-nav section headings (`AUDIT`, `SETUP`) and 12px/600 tag text, which stays sentence case too.
- **Second person for instructions, no first person for the system.** "Review them before you close Q3." Not "We found 126 exceptions" and never "I". The product doesn't refer to itself; it states what is true: "126 exceptions are open, 8 past SLA."
- **Lead with the number.** "1,284 lines scanned", "8 over SLA", "$4.82M audited". Numbers always carry their unit and always use tabular figures and thousands separators. Percentages get one decimal ("97.4%"), currency two in tables ("12,480.00") and abbreviated in tiles ("$4.82M").
- **Verbs for actions, nouns for places.** Buttons: "Run audit", "Mark reconciled", "Close period", "Export". Nav items and page titles: "Dashboard", "Invoices", "Exceptions", "Settings".
- **State consequences plainly in destructive copy.** "Locked periods can't be edited afterwards." Contractions are fine; hedging is not. No "Oops", no "Whoops, something went wrong" — an error says what failed, when, and what to do: "Sync failed — vendor feed returned 503 at 04:12 UTC." + a Retry.
- **Empty states describe the fix, not the emptiness.** "No matching invoices / Try widening the date range or clearing filters."
- **Helper text is one clause, no terminal period when it's a fragment**: "12 digits, no dashes". Full sentences get periods.
- **No emoji. Ever.** Not in UI, not in notifications, not in docs. Status is carried by Tag color + a 6px dot, never by a glyph like ✅.
- **No exclamation marks.** Success reads "Period Q2 FY26 closed", not "Period closed!"
- **Time is explicit and zoned**: "04:12 UTC", "13 Aug 2026, 06:41 UTC", "9d" only in dense age columns.
- **Vocabulary to keep consistent**: *line item* (not row of data), *exception* (not error/issue), *reconciled* (not matched-ok), *variance* (not difference), *period* (not month), *SLA*, *tolerance*, *ledger*.

---

## VISUAL FOUNDATIONS

**The one-sentence version:** white panels on a White page, hairline Gray 100/150 borders, 4px radii on controls and 8px on panels, one blue for action and a Navy sidebar, and no shadows unless something is genuinely floating.

**Colour.** The palette is a set of named primitives with semantic tokens layered on top — not open-ended ramps.

*Neutrals:* White surfaces, `Gray 75 #F9FAFB` subtle/alternate surfaces, `Gray 100 #EEEFF5` subtle borders, `Gray 150 #E7E8EF` default borders, `Gray 400 #9EA2AD` emphasis borders and placeholders, `Gray 700 #6B6F7B` secondary text, `Gray 900 #17181C` primary text.

*Brand:* `Navy 900 #20265D` is the sidebar — the only dark surface. `Blue 600 #3863DB` is the action blue (primary buttons, links, focus rings); `Blue 700 #4E47DD` is the pill/large-CTA variant; `Blue 100 #DEE9FC` with `Blue 800 #2B4DD0` text is the brand tag pair. The wordmark has two approved colours: `Teal 600 #418EAE` and `Navy 700 #273FA8`.

*Status:* success `Green 500` accent / `Green 800` text; warning `Amber 500` accent, `Amber 100` background, `Amber 800` text; error `Red 500` accent, `Red 100` background, `Red 800` text, with `Red 600` for plain error text; high severity `Orange 600` accent on `Orange 100`; danger-dark accent `Maroon 700`. Flagged table rows use `Yellow 50`.

*Callouts* are their own periwinkle family: `Periwinkle 100` background, `Periwinkle 500` icon, `Periwinkle 700` link, `Periwinkle 800` text — never a blue-tinted info box.

No colour is used decoratively; if something is coloured, it means something.

**Type.** Plus Jakarta Sans 600 for anything titular (32/28px page titles, 20px section titles, 16px card titles) with `-0.02em` tracking to keep the wide-ish display face compact. Inter for everything else: 14/400 body and table cells at 1.5 line-height, 13/400 `Gray 700` helper and metadata, 12/600 tag and label text. There is **no monospace font** — numerals get `font-variant-numeric: tabular-nums` inside the two families, Plus Jakarta Sans 600 at 24–32px for KPI numbers and Inter 500 at 14–16px for table numerics, always right-aligned in numeric columns so decimal points line up.

**Spacing & layout.** Strict 8px scale (4/8/12/16/24/32/40/48/64/80). 16px inside cards and fields, 12px under a card title, 24px between sibling sections, 32px page padding. Controls come in three heights only — 32 / 40 / 48px — and table rows in two: 40px compact, 48px default. Layout is a fixed 256px Navy 900 left rail (64px collapsed) with a 1px right border, a fixed 56px top bar matching the rail's header height, and a single scrolling content column capped at 1440px. Drawers are 480px and pinned to the right edge; modals are 480px and centred. Dense two- and three-column grids inside content; nothing centres itself on the page except modals and empty states.

**Backgrounds & imagery.** There are none. No photography, no illustration, no hand-drawn art, no repeating patterns, no textures, no gradients — the spec supplies none and this is an internal data tool: **flat colour fields only**. If imagery ever enters the brand it should be cool-toned and desaturated to sit beside the blue; today the only "graphic" elements are data itself (bars, progress fills, tags). No protection gradients are needed because nothing is layered over imagery; where contrast is needed against a fill, a solid capsule (Tag, Tooltip) is used instead of a scrim.

**Elevation & borders.** Flat by default. Structure comes from 1px `Gray 150` hairlines, not shadow: cards, tiles, table rows and headers **never** carry a shadow, hover or otherwise. Exactly three shadows exist and each has one job — `--elev-menu` `0 4px 16px rgba(20,23,31,.10)` for dropdowns, `--elev-modal` `-12px 0 32px rgba(20,23,31,.14)` cast *leftward* for right-edge drawers, `--elev-toast` `0 8px 24px rgba(20,23,31,.16)` for toasts. No inner shadows anywhere; "sunken" is expressed by a `Gray 75` fill (inputs, search) rather than an inset.

**Corner radii.** 2px checkbox, 4px controls / tags / tooltips (the system's default), 6px menus, 8px cards, modals and drawer bodies, full pill only for the Switch track and progress fills. Nothing is more rounded than 8px; nothing decorative is a circle except avatar chips and status dots.

**Cards.** White fill, 1px `Gray 150` border, 8px radius, 16px padding, optional header with a 16/600 display title and a 1px divider under it. No shadow, no colour-tinted left accent bar, no hover lift, no gradient. A card wrapping a table gets `padding={0}`.

**Interaction states.** Hover: `Blue 600` fills darken toward `Blue 800`, neutral surfaces go to `Gray 75`, ghost controls pick up `Blue 100`, icon buttons `Gray 100`. Press: one step darker again — colour change only, **never a scale/shrink transform**. Focus: always `Blue 600` border plus a 3px `rgba(56,99,219,.24)` ring — the ring is never removed, on any control. Selected: `Blue 100` background (rows, nav) with `Blue 800` text; no checkmark-only selection. Disabled: `Gray 100` fill, `Gray 400` text, `Gray 150` border — never a faded brand tint.

**Motion.** Functional and quick: 70ms hover/press, 110ms control state change, 240ms drawer and modal entrance and progress fills, 400ms reserved. One easing family — `cubic-bezier(0.2, 0, 0.38, 0.9)` standard, entrance `(0, 0, 0.38, 0.9)`, exit `(0.2, 0, 1, 0.9)`. Drawers slide on X and fade the scrim; modals fade only. **No bounce, no spring, no overshoot, no attention-seeking loops** — skeletons don't shimmer and toasts don't slide-and-wobble. The spinner is the only continuous animation (700ms linear ring).

**Transparency & blur.** Almost never. The only alpha values in the system are the 45%-black modal/drawer scrim and the shadow colours; **no frosted glass, no backdrop-filter, no translucent panels** — an opaque white surface over a scrim reads more legibly in dense data. Tag and notification backgrounds are solid light tints (Amber 100, Red 100, Blue 100, Periwinkle 100), not alpha.

---

## ICONOGRAPHY

- **The supplied CEP source contains no icon set, icon font, sprite sheet or SVGs.** Substituted: **[Lucide](https://lucide.dev) 0.454.0**, loaded from `unpkg` CDN — outline glyphs on a 24px grid with a 1.5px stroke and round caps, which matches a flat, hairline-bordered enterprise UI more closely than filled or duotone sets. **Please confirm or replace this** with the real CEP icon set.
- **Never hand-roll SVG paths.** Render Lucide SVGs as a CSS `mask-image` on a sized `<span>` so the glyph inherits `currentColor` and can be tinted with any token (see `guidelines/iconography.html`).
- **Sizes:** 16px inside controls, table cells and menu rows; 20px in the side nav and icon buttons; 24px in empty states (inside a 40px `Gray 100` rounded square); 12–14px inside Tags and sort indicators.
- **Colour:** `--icon-default` (`Gray 700`) at rest, `--icon-strong` (`Gray 900`) for emphasis, `--icon-brand` (`Blue 600`) when active/selected, status accents inside notifications and toasts, `--icon-disabled` (`Gray 400`) when disabled. Icons are never multi-coloured.
- **Style rules:** outline only (no filled variants), no icon-only buttons without a `label`/Tooltip, no icons inside Tags unless the tag has no dot, no decorative icons in headings, and no icon larger than 24px anywhere.
- **Emoji and unicode glyphs are not used** as icons or anywhere else. The one unicode exception is the keyboard-shortcut hint `↵` in Menu rows, plus `—` as an em-dash placeholder for empty table cells and `·` as a metadata separator.
- **Common set in use:** `search, filter, download, upload, plus, check, x, chevron-down/left/right, chevrons-up-down, arrow-up/down/right, ellipsis-vertical, trash-2, external-link, refresh-cw, settings, settings-2, layout-dashboard, file-text, triangle-alert, circle-alert, circle-check, circle-help, info, bell, lock, inbox, search-x, building-2, user-plus, trending-up, trending-down, link, play, calendar, minus`.
- `assets/` contains **no logo file** — see "Flagged substitutions" above.

---

## Index

### Root
- `styles.css` — the single entry point consumers link. `@import` lines only.
- `readme.md` — this file.
- `SKILL.md` — Agent-Skills-compatible entry point.
- `thumbnail.html` — homepage tile.
- `uploads/CEP-design-tokens.md` — the original supplied spec (source of truth for all values).

### `tokens/`
`fonts.css` (Google Fonts import) · `colors.css` (named primitives + semantic tokens) · `typography.css` (families, scale, roles) · `spacing.css` (8px scale, control/row heights, layout widths) · `shape.css` (radii, borders, the three elevations, scrim) · `motion.css` (durations, easings, transitions) · `base.css` (element resets, link colours, focus outline).

### Components / UI kits
None. This system is foundations only — tokens and specimen cards. No React components or product screens were authored, because none were supplied to recreate.

### `guidelines/` — 21 specimen cards
Colors (neutral, brand, status & callout primitives; surfaces; text & wordmark; borders & focus; status tokens; callout) · Type (display, body, numerics, pairing) · Spacing (scale, in use, control & row heights) · Brand (radii, elevation, motion, interaction states, wordmark, iconography).

