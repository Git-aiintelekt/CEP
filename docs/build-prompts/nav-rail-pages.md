# Build Prompt: Navy Rail Pages

Mockup (approved 2026-11-20): `docs/mockups/nav-rail-pages.html`. Branch `nav-rail-pages`, from `main`.

## The change in plain words

Today the shell has three layers: a navy rail with one button per product (Engagement, Insights) and Settings, a white menu column with the open product's pages, and the 9-dot launcher. After this change there are two:

- **The navy rail holds the open product's pages.** The white menu column goes. The product buttons leave the rail.
- **The launcher is the only product switcher.** Its search, tiles and "coming" line stay as they are.

## Decisions

- Rail: 240px expanded with the label beside the icon; 64px collapsed, 40px icon squares, each label a dark tooltip (the existing `useTooltip` / `RailTooltip`).
- The product's name heads the expanded rail (section title, white, a link to its Home). No subline: the tagline is dropped from the shell and lives on only as the launcher tile's tooltip and in its search. Collapsed, no header.
- Rows: 40px, 8px corners, `text-sidebar-text` with `text-sidebar-icon` 20px icons; hover `sidebar-hover`; pressed `sidebar-pressed`; current page `sidebar-selected` with white semibold text and icon (the same states as today's rail tiles). Focus: the `sidebar-accent` outline.
- Settings stays at the foot under a `sidebar-divider` hairline, labelled "Settings", admins only, never in a support session; search still lists it as Workspace Settings.
- Toggle behaviour unchanged: xl and up open unless collapsed (remembered in `cep.nav.collapsed`); below xl the rail sits at 64px and the toggle opens it to 240px over the page with the scrim; below md there is no rail until the toggle opens it (240px, over the page).
- Content offset: 240px expanded, 64px collapsed (today 328 / 152).
- The amber "Trial" tag moves from the rail tile to beside the product name in the top bar; the launcher keeps "Trial to …".
- Insights stays one flat list. "Contact lists" becomes "Contact Lists" (title case).
- The template editors' own 64px page rail is not touched.
- Nothing lost: every page link, permission, feature flag (Journeys), the AI gate (AI Reports), the `requires` / standalone Insights rule, Settings and its rules, the launcher.

## Phase 1: One Navy Rail

Files: `frontend/src/shell/LeftNav.tsx`, `frontend/src/components/AppShell.tsx`.

- Replace `AppRail` and `ComponentMenu` with one `PageRail` (`current`, `settings`, `collapsed`, `onNavigate`): the header link, `<ul aria-label={current.name}>` of pages, and `<ul aria-label="Workspace">` with Settings at the foot.
- AppShell renders one `<nav aria-label="Main">` inside the `Sidebar` aside, width `w-60` or `w-16` with the existing width transition; the `Apps` navigation goes. Offsets `pl-60` / `pl-16`.

## Phase 2: Top Bar, Launcher, Labels

Files: `frontend/src/shell/TopBar.tsx`, `frontend/src/shell/AppLauncher.tsx`, `frontend/src/apps/cep/manifest.ts`, `frontend/src/components/AppShell.tsx`.

- Trial tag beside the top-bar name when the open product is on trial.
- Launcher tiles get the tagline as their `title`.
- "Contact Lists" in Engagement's menu and in the shortcuts help.

## Phase 3: Tests and Design Docs

- Tests that looked for the `Apps` navigation or its `Components` list now look in `Main`, and the rail-tile tests become launcher tests (product switching, trial).
- Rewrite the App shell entries in `.claude/skills/cep-design/README.md` (the layout paragraph and the dated ruling) and the "Contact lists" nav mention.
- Run `npm run typecheck`, `npm run lint`, `npm test` from `frontend/`.
