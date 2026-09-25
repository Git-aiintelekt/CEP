# CLAUDE.md

## What this is
CEP: multi-tenant Customer Engagement Platform for email/SMS campaigns. React SPA → Django API, PostgreSQL. Work is in `frontend/`; the backend is a given API. The user is a designer, so UI must look right.

## Commands (from `frontend/`)
- `npm run dev` (:5173)
- `npm run typecheck`, `npm run lint`, `npm test` (run all before finishing)
- Full app: `docker compose -f deploy/docker-compose.dev.yml up -d`; workspace `NWA`, ask for the password
- No backend: `/dev/designer`, `/dev/message`

## Debugging
Reproduce first. Console, then Network: wrong request = front end, wrong response = API. 401 expired token, 403 missing permission, 409 stale version.

## Where things are
- `src/lib/api.ts` client; `src/lib/types.ts` contract
- `src/auth/AuthContext.tsx` permissions, flags
- `src/index.css` design tokens
- Patterns: `pages/CampaignFormPage.tsx`, `pages/ListPages.tsx`, `src/test/mockApi.ts`

## Design
Invoke the `cep-design` skill. Page background is white. Tailwind tokens only, never raw hex or palette classes. Flat, 1px hairlines, radii max 8px, Blue 600 is the only action colour, status tags never blue, except Scheduled (approved 2026-09-24). Use `components/Form.tsx` primitives. Title case for UI labels; full sentences stay sentences (rules in the cep-design README, "Content & Copy Rules"). Statuses: Draft / Test Published / Production Published / Scheduled. Unimplemented locked behaviour (design.md §9): raise it, don't build it silently. design.md §10 ("clicking a preset instantly copies it, no confirmation, no preview") is superseded: as of the Templates preview modal, clicking a preset opens a read-only preview first, with a "Copy This Template" button to proceed.

## Style
Few comments; clear names.
