# CEP — Customer Engagement Platform

API-first modular monolith: **React SPA → Django 6.1 + DRF 3.18** for the core platform, **FastAPI** services for the hot
paths (webhook ingestion, tracking, scoring), **PostgreSQL 18** with per-tenant partitions and row-level security,
**Celery + Redis** for workers and the event outbox. Design documents live in `D:\Works\CEP\database_design\`
(`CEP_Database_Design.md`, `CEP_Hybrid_Architecture.md`, `CEP_SaaS_Tenancy_and_CDN_Setup.md`).

```
backend/    Django project — config/ (settings, urls, celery), apps/ (15 domain apps, unmanaged models), api/v1/, workers/
database/   the four DDL files (source of truth for every table) + development seed
services/   FastAPI services (ingest, tracking, scoring) — scaffolded next
frontend/   React SPA (Vite) — scaffolded next
deploy/     docker-compose for local PostgreSQL + Redis
```

## First run
```bash
cp .env.example .env                                   # then edit SECRET_KEY etc.
docker compose -f deploy/docker-compose.dev.yml up -d  # PostgreSQL 18 + Redis (or point DATABASE_URL at your own server)

cd backend
.venv\Scripts\activate                                 # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt                        # already installed in this checkout's .venv
python manage.py migrate                               # applies the four DDL files via RunSQL, then Django's own tables
psql "$DATABASE_URL" -f ../database/CEP_Seed_Data.sql  # optional: demo tenant "Northwind Apparel" (includes fn_provision_tenant)
python manage.py runserver                             # http://127.0.0.1:8000/api/v1/docs/
```
For a fresh tenant of your own: insert the `tenant` row (or use the admin), then `python manage.py provision_tenant <uuid>`.

Log in against the seed: POST `/api/v1/auth/token/` with `{"email": "maria.chen@northwindapparel.example", "password": "..."}`
after setting a password (`python manage.py changepassword maria.chen@northwindapparel.example`), and send
`X-Tenant: NWA` (or use the `northwind.` subdomain) on every request.

## Frontend (React)

`frontend/` is a Vite + React 19 + TypeScript app (Tailwind 4, React Router 7, TanStack Query 5). With the backend
running: `cd frontend && npm install && npm run dev`, then open `http://localhost:5173` and sign in with workspace
`NWA`. Vite proxies `/api` to Django. See `frontend/README.md` for layout, scripts and conventions.

## Sample templates

`python manage.py load_sample_templates <TENANT_CODE>` creates one draft per starter (5 marketing emails, 2 e-receipts,
2 SMS, 1 MMS) and adds the receipt / order personalization tags they use. Safe to re-run; `--only <key ...>` and
`--activate` are available. The same starters appear under **New template → Start from** for every tenant.

## Administration: two surfaces, two audiences

| | Tenant administrators (your customers) | Platform operators (your staff) |
|---|---|---|
| Where | **Settings** in the React app (`/settings`, permission `user.admin`) | Django Admin, themed with django-unfold (`/admin/`, `is_staff`) |
| Scope | their own workspace only, under row-level security | every tenant, on the BYPASSRLS `platform` connection |
| Can do | add / deactivate users, one-time password links, roles from the permission catalogue, API keys (shown once, revocable) | register and onboard tenants (partitions, routing row, starting roles on save), suspend / reactivate, users and roles across tenants, revoke API keys, plans, subscriptions, routing, storage, read-only audit trail |
| Home page | workspace facts and plan limits | **Platform health**: database, tenant isolation, migrations, partitions, event outbox, failed messages, cache, workers, configuration. Also `GET /admin/health.json` (503 when a check fails) |

Passwords are never typed by an administrator on either surface: both create a one-time link (`/set-password`) on
which the user chooses their own. Nobody can deactivate themselves or remove the last administrator of a workspace.
`/healthz` stays the unauthenticated liveness probe for load balancers.

## Logging in

There are two entry points, both served by `python manage.py runserver` from `backend/`:

| What | URL | Who | Connection |
|---|---|---|---|
| Django Admin (internal back-office, all tenants) | `http://127.0.0.1:8000/admin/` | users with `is_staff` | `platform` (BYPASSRLS, `PLATFORM_DATABASE_URL`) |
| Product API (what the React app calls) + Swagger | `http://127.0.0.1:8000/api/v1/docs/` | any active tenant user | `default` (RLS enforced, `DATABASE_URL`) |

First-time setup for a user (seed users have no password):

```bash
python manage.py make_platform_admin maria.chen@northwindapparel.example     # is_staff + is_platform_admin
python manage.py changepassword maria.chen@northwindapparel.example --database platform
```

API login: `POST /api/v1/auth/token/` with header `X-Tenant: NWA` and body `{"email": "...", "password": "..."}` returns
`access` / `refresh`. In Swagger click **Authorize**, paste the access token under `jwtAuth`, and send `X-Tenant: NWA`
with every call (in production the tenant comes from the subdomain). `GET /api/v1/me/` returns the user, tenant and permissions.

Local development needs no Redis (in-process cache) unless `DEV_USE_REDIS=True`.

## Database roles

| Role | Login | Used by | Notes |
|---|---|---|---|
| `cep_app` | no (group) | – | Row-level security enforced; SELECT/INSERT/UPDATE/DELETE on all parent tables, no direct access to partitions. |
| `cep_backend` | yes | Django, Celery, FastAPI services (`DATABASE_URL`) | Member of `cep_app`. May call `fn_provision_tenant`, `fn_ensure_monthly_partitions`, `fn_apply_partition_retention` (SECURITY DEFINER). |
| `cep_admin` | no (group) | migrations, ETL, support | BYPASSRLS; tenant detach/attach. Run `manage.py migrate` and the `database/patches/*.sql` files as a member of this role or as the DDL owner. |

Never point `DATABASE_URL` at a superuser: superusers bypass RLS, so tenant isolation bugs stay invisible.

## How the pieces fit
* **Models are `managed = False`.** `apps/database/migrations/0001_initial.py` applies `database/*.sql`; models mirror the
  tables and are regenerated from the DDL (`gen_django_models.py` in the design tooling). Change the DDL first, always.
* **Tenancy.** `apps/tenants/middleware.py` resolves the tenant (X-Tenant header, subdomain or custom domain), opens one
  transaction per request and executes `SET LOCAL app.current_tenant` — row-level security does the rest. `router.py` sends
  control-plane models to the pool database and everything else to the tenant's alias. Celery tasks use `workers/tenant_task.py`.
* **API.** `api/v1/views.py::BaseTenantViewSet` is the pattern for every resource: tenant filter + soft-delete filter on the
  queryset, tenant/created_by stamped on create, permission codes from `identity.permission`, cursor pagination, RFC 9457
  errors, OpenAPI at `/api/v1/schema/` (Swagger UI at `/api/v1/docs/`). JWT for the React app, `cep_…` API keys for integrations.
* **Workers.** `workers/outbox.py` relays `domain_event` to Redis Streams every second; `workers/maintenance.py` runs the
  partition lifecycle nightly (`celery -A config worker -Q default,events,maintenance` and `celery -A config beat`).

## Development notes
* Connect as a **non-superuser** database role in development too (`cep` in the compose file is fine): PostgreSQL superusers
  bypass row-level security, which hides tenancy bugs.
* Tests: unmanaged models mean the test database must be built from the DDL — add a `pytest-django` `django_db_setup`
  fixture that applies `database/*.sql` and provisions a test tenant.
