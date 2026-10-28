# CLAUDE.md

## What this is
CEP: multi-tenant Customer Engagement Platform for email/SMS campaigns. React SPA → Django API, PostgreSQL. Work is in `frontend/`; the backend is a given API. The user is a designer, so UI must look right.

## Rules
- Frontend only. Never change backend code, the database or setup; write the ask in `docs/requests/` instead.
- Commit only when the user asks.
- Run `npm run typecheck`, `npm run lint`, `npm test` (from `frontend/`) before finishing.

## Commands
- Previews: named servers in `.claude/launch.json` (`cep-frontend` :5173, `cep-backend` :8000, spare ports 5174–5176 / 8001)
- Full app: `docker compose -f deploy/docker-compose.dev.yml up -d`; workspace `NWA`, ask for the password
- No backend: `/dev/*` playgrounds, routes in `src/App.tsx` (`/dev/designer`, `/dev/message`, `/dev/home`, `/dev/insights`, `/dev/dashboard`, `/dev/new-report`…)
- Backend tests (from `backend/`): `.venv/bin/python -m pytest` (local database only, every change rolled back; see `backend/tests/README.md`)

## Debugging
Reproduce first. Console, then Network: wrong request = front end, wrong response = API. 401 expired token, 403 missing permission, 409 stale version.

## Where things are
- Two apps, registered in `src/apps/registry.ts`: `src/apps/cep` (campaigns, journeys, templates, designer… under `features/`) and `src/apps/insights` (reports, dashboards, Ask AI). Each has `manifest.ts`, `routes.tsx`; Insights has its own `api.ts` and `types.ts`.
- `src/lib/api.ts` client; `src/lib/types.ts` contract
- `src/auth/AuthContext.tsx` permissions, flags
- `src/index.css` design tokens
- Patterns: `apps/cep/features/campaigns/`, list pages use `components/SearchField.tsx` + `components/FilterChip.tsx` + Clear Filters, `src/test/mockApi.ts`
- Every chart goes through `components/charts/` and the cep-design Charts rules.

## Workflow
Design first: mockup in `docs/mockups/`, then a phased build prompt in `docs/build-prompts/`, then build phase by phase. Backend needs go in `docs/requests/`. For broad design instructions, list the issues and let the user pick; never restyle unasked. A restyle keeps every live feature and piece of information.

## Design
Invoke the `cep-design` skill. Page background is white. Tailwind tokens only, never raw hex or palette classes. Flat, 1px hairlines, radii max 8px, Blue 600 is the only action colour, status tags use the --tag-{status} colours (Completed is a light sky blue by design); the dot shows only on live statuses (Active, Sending, Preparing); Plum is an accent, never action or status. Use `components/Form.tsx` primitives. Title case for UI labels; full sentences stay sentences (rules in the cep-design README, "Content & Copy Rules"). Statuses: Draft / Test Published / Production Published / Scheduled. Unimplemented locked behaviour (design.md §9): raise it, don't build it silently. design.md §10 ("clicking a preset instantly copies it, no confirmation, no preview") is superseded: as of the Templates preview modal, clicking a preset opens a read-only preview first, with a "Copy This Template" button to proceed.

## Style
Few comments; clear names.
