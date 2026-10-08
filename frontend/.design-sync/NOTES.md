# design-sync notes (CEP frontend)

Syncs `src/components/` (the app's component library) to the Claude Design project "CEP Design System". This is an app, not a published package, so the sync builds its own library surface.

## How the build is wired
- **Entry**: `.design-sync/entry.ts` is the library barrel (passed as `--entry`). Add a new component file here AND in `componentSrcMap`. The component list comes only from `componentSrcMap`, because there is no package `types` field.
- **Types**: `npx tsc -p .design-sync/tsconfig.dts.json` emits declarations to `dist/types/` (gitignored), which the converter finds automatically. `vite build` empties `dist/`, so always run `buildCmd` before the converter, or every `<Name>.d.ts` silently degrades to `[key: string]: unknown`.
- **CSS**: `.design-sync/build-css.mjs` compiles `src/index.css` with Tailwind v4 (`@tailwindcss/node` + oxide scanner over `src/` and `.design-sync/previews/`) into `.design-sync/.cache/cep.css` (`cfg.cssEntry`). It safelists every `--color-*`, `--text-*`, `--radius-*` and `--shadow-*` token utility so the design agent can use tokens the app never uses (e.g. `text-body`, `text-caption`).
- **Fonts**: `cfg.extraFonts` points at the `@fontsource` CSS files that `src/main.tsx` imports (Plex Sans 400/400i/500/600, Plex Mono 400). Keep the two lists in step.
- **`@/` alias**: the converter's tsconfig reader strips `/*` as a block comment, which eats `"@/*"`. `.design-sync/tsconfig.paths.json` writes the slash as `/` to dodge it. Don't "clean up" those escapes.
- **HelpPanel stub**: `Form.tsx` imports `FieldNote` from `@/help/HelpPanel`, which pulls Vite `?raw` markdown chapters that esbuild can't load. `tsconfig.paths.json` redirects that import to `.design-sync/stubs/HelpPanel.tsx`, which holds a verbatim copy of `FieldNote`.
- **Icons**: `.design-sync/icons.ts` (via `cfg.extraEntries`) exposes the ~50 most-used lucide icons as `window.CEP.<Name>Icon`.
- **Render check browser**: no playwright cache on this machine. Playwright is installed in `.ds-sync` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and runs against the system Chrome: `DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
- **Commands** (from `frontend/`): `node .design-sync/build-css.mjs && npx tsc -p .design-sync/tsconfig.dts.json`, then `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules --entry ./.design-sync/entry.ts --out ./ds-bundle [--remote .design-sync/.cache/remote-sync.json]`.

## Scope decisions
- First sync (2026-10-08): the user chose **basic cards only**. Previews were authored only where the floor card rendered blank (14 components: Checkbox, Counter, MenuRow, PageHeader, Popover, PopoverHeading, ProgressBar, SkeletonLine, StatusBadge, Swatch, Tag, TruncatedText, IconButton, ChartLegend). The other 31 are on the floor card and can be authored on any re-sync.
- Excluded on purpose: AppShell, NavBar, Rail*, Auth* (router/auth context), LoadingOverlayHost, ErrorBoundary, SaveTick (needs a react-query mutation), chart internals (LineSeries, BarSeries, ReferenceLine), FullPageSpinner, and **ResourceList**, which fetches the live CEP API via react-query. Designs should compose PageHeader + filters + DataTable instead.
- `src/features/designer/ui/*` (designer-only primitives) are not synced.
- Target project is the user's existing hand-built "CEP Design System" project (user's explicit choice). Its own `tokens/`, `guidelines/`, `design_handoff_cep_design_system/`, `uploads/`, `DESIGN-SYSTEM.md`, `SKILL.md`, `readme.md` are not produced by this sync and must never be deleted by it. The sync overwrites `styles.css`, `README.md` and `_ds_bundle.js`.

## Known render warns
- none outstanding (PageHeader and StatusBadge use `cardMode: column` for GRID_OVERFLOW)

## Re-sync risks
- `stubs/HelpPanel.tsx` is a copy of `FieldNote`. If `src/help/HelpPanel.tsx` changes FieldNote, re-copy it.
- `entry.ts` and `componentSrcMap` are hand lists. A new file in `src/components/` is not synced until it's added to both.
- `icons.ts` is a fixed list. New icons used in designs need adding there.
- `cep.css` only contains classes found in `src/` and previews plus the token safelist. Arbitrary Tailwind values or palette classes the agent invents won't resolve (by design: tokens only).
- The bundle and `.d.ts` files reflect the working tree at sync time, including uncommitted changes.
- Built with Tailwind 4.3.3, TypeScript ~6.0, React 19.2 (bundled 19.3.0 from node_modules).
