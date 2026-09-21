# CLAUDE.md

## What this is
CEP is a multi-tenant Customer Engagement Platform: workspaces design and send email/SMS campaigns. Stack: React SPA → Django API, PostgreSQL. Current work is the front end (`frontend/`); the backend is a given API. The user is a designer, so UI must look right.

## Commands (from `frontend/`)
- `npm install <pkg>` add a package
- `npm run dev` start on :5173
- `npm run typecheck`, `npm run lint`, `npm test` (run all before finishing)
- Full app: `docker compose -f deploy/docker-compose.dev.yml up -d`, then Django on :8000. Sign in with workspace `NWA`; ask the user for the password.
- No backend: `/dev/designer` and `/dev/message`

## Debugging
Reproduce first. Check the browser console, then the Network tab: wrong request means front end, wrong response means API. 401 is an expired token, 403 a missing permission, 409 a stale version.

## Where things are
- `src/lib/api.ts` API client; `src/lib/types.ts` API contract
- `src/auth/AuthContext.tsx` permissions and feature flags
- `src/index.css` design tokens; use Tailwind tokens, never hard-coded colors
- Patterns: `pages/CampaignFormPage.tsx` (forms), `pages/ListPages.tsx` (lists), `src/test/mockApi.ts` (tests)

## Design system
`.claude/skills/cep-design/` holds the tokens (invoke the `cep-design` skill). The user's `design.md` / `designnew.md` overrides it where
they differ: **page background is White**, and **vocabulary is CEP's**. `src/index.css` is the port into Tailwind; change tokens
there, never a raw hex or a raw palette class (`red-*`, `slate-*`, `emerald-*`) in a component.

Flat and data-dense. Navy 900 sidebar is the only dark surface, Blue 600 is the only action colour, structure comes from 1px
`border-line` hairlines.

- **Brand ramp** is `brand-100 / 600 / 700 / 800` (Tailwind `bg-brand-600`): 600 action, 800 hover/pressed and selected text, 700 pill-CTA
  only, 100 tag/selected fill. Sidebar and wordmark are one-offs (`bg-sidebar`, `text-wordmark-navy`), not numbered. `--gray-50`
  no longer exists.
- **Colour means something.** Callouts are periwinkle (`callout-*`); blue is for action only, so **status tags never use blue**.
  Status tokens: `success`, `warning`, `danger`, `high` (+ `-bg`, `-text`). Use `StatusBadge` (dot + tint, 4px radius).
- **Radii** max 8px: `rounded-sm` (4px) controls, buttons and tags; `rounded-md` (6px) menus; `rounded-lg` (8px) cards and modals.
  `rounded-full` only for switch tracks, progress fills, avatars and dots. Never `rounded-xl` / `rounded-2xl`.
- **Shadows:** none on cards, tiles, rows or centred modals. Only `shadow-menu`, `shadow-drawer`, `shadow-toast` exist.
  "Sunken" is `bg-surface-subtle`. No blur, gradients or alpha panels; `bg-scrim` is the only alpha surface.
- **Responsive** (Tailwind defaults; hook `useMinWidth` in `lib/useMediaQuery.ts`): `xl` 1280+ rail 256px and table rows 48px; below
  `xl` the rail is 64px icon-only and rows are 40px; expanding the rail there overlays the content behind a scrim; below `md`
  (768) there is no rail until the hamburger opens it, tables become stacked label/value cards (`DataTable`), and modals go
  full-width with a 16px margin. Multi-column form grids use `lg:grid-cols-*`, so they are one column below 1024. Drawer width
  is `min(480px, 92vw)`. Below 640 has no dedicated design; it must only not look broken.
- **Ultra-wide (agreed amendment to designnew.md §3).** The 1440 content cap is a floor, not a ceiling: the shell uses
  `max-w-[clamp(1440px,68vw,2400px)]`, so 1440 holds to ~2100px wide and then grows to 2400. Without it a 4K screen showed
  1440 of content between two 1072px gutters. The login brand panel scales the same way (`clamp()` on its padding,
  headline and text block) rather than stranding a 440px block in a 1745px field.
- **Sizes:** controls 32 / 40 / 48px (`h-8` / `h-10` / `h-12`), table rows `h-10` or `h-12`, sidebar 256px (64 collapsed), top bar
  56px, modal 480px (`size="lg"` is a wider exception for long forms), content max 1440px, 8px spacing scale. Use the primitives
  in `components/Form.tsx` (`TextInput`, `Select`, `buttonPrimary`, ...) rather than hand-rolled control classes.
- **States:** hover darkens toward `brand-700` or goes `bg-surface-subtle`; press is colour only, never a scale transform;
  selected is `bg-brand-100` + `text-brand-700`; the focus ring is global and never removed; disabled is
  `bg-line-subtle` + `text-ink-300`, never `opacity-*`.
- **Type:** headings Plus Jakarta Sans (`font-display`, automatic on h1-h4), body Inter 14px. **No monospace**: numbers use
  `.cep-num` (tabular) and are right-aligned in numeric columns.
- **Icons:** `lucide-react`, outline, `strokeWidth={1.5}`, 16px in controls, 20px in nav and icon buttons, 24px in empty states.
  Never text glyphs (`x`, arrows) as icons; icon-only buttons need an `aria-label`.
- **Motion:** 70ms hover, 110ms controls, 240ms modal/drawer, `ease-standard`. Modals fade, drawers slide on X. No bounce or shimmer.
- **Copy:** sentence case; lead with the number; errors say what failed and what to do (no "Something went wrong");
  empty states describe the fix; no emoji, no exclamation marks.
- **CEP vocabulary:** campaign, journey, template, contact list, campaign list, audience, governance, test publish, production
  publish, party ID. Locked statuses: **Draft / Test Published / Production Published / Scheduled**. Never invoice/audit words
  (line item, exception, reconciled, ledger, SLA, tolerance).
- **Locked behaviour** (design.md sections 9-10: snapshot-on-attach, archive over delete, no autosave, journey campaigns read-only,
  edit-lock rules): several are not yet implemented. Do not build them silently; raise architectural changes first.

Known gaps: `CampaignFormPage` locks the whole form by status instead of the spec's per-section lock; the template gallery is
select-then-submit rather than instant duplicate plus a view-only Preview; no drawer, toast or A/B step exists yet.

## Style
Few comments; use clear names instead.
