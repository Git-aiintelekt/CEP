# CEP frontend

React 19 + TypeScript + Vite 8, Tailwind CSS 4, React Router 7, TanStack Query 5. Talks only to the CEP REST API
(`/api/v1`), never to the database.

## Run

```bash
# 1. backend (another terminal)
cd ../backend && .venv\Scripts\activate && python manage.py runserver

# 2. frontend
npm install
npm run dev            # http://localhost:5173
```

Sign in with a tenant user (workspace `NWA` for the seed tenant). In development Vite proxies `/api` to
`http://localhost:8000`, so the browser stays same-origin. Settings: copy `.env.example` to `.env.local`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | oxlint |
| `npm run gen:api` | Regenerates `src/lib/api-schema.d.ts` from the running backend's OpenAPI schema |

## Layout

```
src/
  lib/          api.ts (fetch client: JWT + refresh, X-Tenant, problem+json) · types.ts · useCursorList.ts · format.ts · config.ts
  auth/         AuthContext (login / logout / me / can(permission)) · RequireAuth route guard
  components/   AppShell · ResourceList (filters + table + cursor paging) · DataTable · StatusBadge · States
  components/   Form (Field, TextInput, Select, TextArea, FormSection, button styles)
  pages/        LoginPage · DashboardPage · ListPages (campaigns, contact lists, templates, journeys) · CampaignDetailPage · CampaignFormPage
  features/designer/   GrapesJS + MJML email designer (see its README.md) · /dev/designer playground in development
  features/messaging/  SMS / MMS editor: sms.ts (GSM-7 / UCS-2 part counting, mirrors the server) · MessageWorkspace · /dev/message playground
  features/templates/  StarterGallery: the "Start from" picker fed by GET /template-starters/
  test/         mockApi.ts (in-memory API for component tests)
```

## Conventions

- **Tenant**: taken from the subdomain (`<tenant>.cep.example.com`); on localhost the login form asks for the
  workspace code and it is sent as `X-Tenant` on every call.
- **Auth**: access token 15 min, refresh 7 days and rotating. The client refreshes once on a 401 and drops to
  `/login` if that fails. Tokens live in `localStorage`; move the refresh token to an httpOnly cookie before production.
- **Permissions**: `useAuth().can('campaign.publish')` hides actions the user cannot perform. The API enforces the
  same codes, so this is presentation only.
- **Lists** are cursor-paginated (`next` / `previous`); there is no total count by design.
- **New collection page**: add the type to `lib/types.ts`, then a column list over `<ResourceList>` in `pages/ListPages.tsx`
  and a route in `App.tsx`.

- **Forms**: see `pages/CampaignFormPage.tsx`. Client rules mirror the API's; the API stays the authority and its 400
  field errors land on the same fields. Edits send `row_version`; a 409 offers a reload instead of overwriting.

- **Styling**: Tailwind everywhere. The single exception is GrapesJS' own base stylesheet, which its panels need; it loads
  only with the lazy designer chunk, and `features/designer/designer.css` skins it from the same Tailwind tokens
  (`@reference` + `@apply`), so changing a colour in `src/index.css` changes the designer too.

Still to come: create / edit forms for lists and journeys, campaign targets, test sends, the journey canvas, reporting.
