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
| Can do | add / deactivate users, one-time password links (emailed or copied), roles from the permission catalogue, API keys (shown once, revocable), plan & usage, invoices, require MFA, single sign-on, support-access log | register and onboard tenants (partitions, routing row, starting roles on save), suspend / reactivate, users and roles across tenants, revoke API keys, plans, subscriptions, routing, storage, read-only audit trail |
| Home page | workspace facts and plan limits | **Home**: what needs attention (failing checks, late jobs, open alerts, past-due subscriptions, draft invoices), quick actions, headline numbers, newest tenants, latest changes, then every health check and scheduled job. Also `GET /admin/health.json` (503 when a check fails) |
| Navigation | tabs under Settings | left menu: platform work always open (Overview, Tenants, People and access, Configuration, Operations); the tenants' own data (campaigns, delivery, customers, content, consent, journeys, integrations) in folded groups for support. `config/settings/unfold.py`; look: `backend/static/cep_admin/admin.css`; header label from `CEP_ENVIRONMENT` (Production / Staging; default Local or Production by `DEBUG`) |

Passwords are never typed by an administrator on either surface: both create a one-time link (`/set-password`) on
which the user chooses their own. Nobody can deactivate themselves or remove the last administrator of a workspace.
`/healthz` stays the unauthenticated liveness probe for load balancers.

## Platform operations

Layer 5 of the schema (`database/CEP_Database_Schema_Platform_Operations.sql`, patch `0006`) and the `apps/platform_ops` app.

### Email from the platform (do this first)

Password links, alert notifications and support-access notices are sent by the platform itself. Where a message goes
out from is decided per message, first match wins:

1. the tenant's own mail server (**Settings → Email server** in the React app: host, port, STARTTLS/SSL, username,
   password stored encrypted, From address, reply-to, "Send a test message")
2. the platform's mail server (**back-office → Configuration → Mail server**): the platform's own mail — alerts,
   back-office password links — and the fallback for a tenant that has no working server of its own
3. SMTP from the environment (`EMAIL_HOST` … in `.env`)
4. Django's console backend: the message is printed to the server log and the app says so honestly (a password link
   can then only be copied; the health page shows *Email: attention*)

The platform's server is never a tenant's sending engine: campaigns and e-receipts go through the tenant's own mail
server or its delivery providers. (Until patch `0027` the platform row could be shared with tenants; that option, and
the "Use the platform's mail server" switch, are gone.)

Both screens have a real "send a test message" action that records the outcome. Passwords are encrypted with
`FIELD_ENCRYPTION_KEY` and never appear in the audit trail or in any screen. Patch `0007` adds the `mail_server` table.

**As a campaign sender.** With "Offer this server as a campaign sender" on (Settings → Email server), the workspace gets a
delivery provider of type `SMTP` (`config.mail_server_id`; the credentials stay in `mail_server`) and an email sender
profile with the server's From address, which the campaign form lists as "… · your mail server". The sender is
`PENDING` until a test message has gone through the server, then `VERIFIED` and publishable; a failed test puts it back
to pending. Switching the option off (or removing the server) retires the provider and sender, and campaigns that
already reference the sender are refused at publish with "This sender was removed". Patch `0008`.

### Campaign send engine and delivery providers

Publishing a campaign creates a run; the send engine (`backend/apps/delivery/engine`) starts it, builds the audience
(consent, blocked addresses, frequency caps, duplicates; every exclusion keeps its reason), personalizes each message and
hands it to the sender's **delivery provider adapter** (`backend/apps/delivery/providers`: `SMTP`, `POSTAL`, `SENDGRID`,
one module each behind one interface). Providers report back to a per-provider callback address; bounces and complaints
block the address, the unsubscribe link in every marketing email records the opt-out (and, once a workspace switches on
its **preference centre** under Settings, `{{preference_url}}` opens a page where the person chooses channels and topics;
docs/WORKSPACE_TOOLS.md §5), and the campaign page shows the results live. Tenants manage their engines and senders under **Settings → Sending engines**. E-receipts are sent one at a time by the point of
sale or web shop through `POST /api/v1/receipts/send/` (API key scope `receipts:send`, idempotent on the receipt number, PDF attachments).
**SMS and MMS** run through the same engine (consent and STOP handling per number, quiet hours for marketing texts, message parts, delivery
receipts, replies on the campaign page). A sandbox text engine that sends nothing is installed; the Digivize adapter is a skeleton
waiting for its API specification.
**Full description, the adapter contract and how to add a provider: [docs/DELIVERY_PROVIDERS.md](docs/DELIVERY_PROVIDERS.md).**

## Campaigns

What is sent, to whom, when and why (BRD 6.3, 7, 15). The **Campaigns** page shows what is coming up, and every campaign in a **list view** (search, filters, sorting,
pages of 50, bulk clone / archive) or a **calendar view** (the month, a bar per campaign over the days it runs, coloured by status). A campaign is set up in **seven steps**: basic info, audience (lists to send to *and* lists to exclude, with a live
estimate: merged, one entry per person, today's governance check), template (with a preview), scheduling and delivery (now, scheduled, recurring, or a
drip series, in the campaign's own time zone), targets and economics, test and preview, review and publish (the API's publish checks shown as a checklist
first). A draft whose setup is not finished opens in the setup at the step it stopped at, from the list or from its own address; the campaign page opens once
every step before the publish is done. Each send is a **run** of its campaign against a Campaign List frozen when the run starts, so a recurring or drip campaign stays one campaign
with many runs and its results roll up. A campaign page has six tabs: overview, performance (numbers, rates, progress against targets, a curve over
time), audience (the frozen list, who was left out and why, CSV export), content, settings and an activity log. Statuses are Draft, Test Published,
Production Published and Scheduled (derived), then Active, Paused, Completed, Cancelled, Archived; the API says which actions each allows, and
**archive replaces delete**. The hourly limit and recipient-local send time are stored now and take effect with the email engine integration.
**[docs/CAMPAIGNS.md](docs/CAMPAIGNS.md)**

## Contact lists

Reusable audiences, made three ways: **upload a CSV** (staged, columns matched, reviewed, then imported: known people are recognised by loyalty ID
or email address, new ones become customer rows owned by CEP), **take an audience the data team defined** (a C360 segment; the list follows it), or
**clone a list** (a snapshot). Lists are typed Production or Test (a Test list cannot go out in a production send), can be attached to any number of
campaigns, and say which live campaigns use them. A campaign freezes its own copy at send time, so editing a list never changes a send that was
already built. Inside campaign setup the same wizard is one click away: a vetted list (audience, clone) is attached at once, an uploaded one waits
for the operator to confirm. **A file is never processed inside a web request:** the upload answers at once and a background worker reads, checks and
imports it in chunks, a few uploads at a time for the whole platform and one per workspace, with progress in the header, an alert when it is done
and an uploads page (Celery queue `imports` in production; a thread of the web process in development, no Redis needed).
Every uploaded contact is checked against governance with the send engine's own rules (unsubscribed, bounced, complained, blocked, invalid, suppressed,
no consent), and the upload reports numbers that add up (rows = held back + ready; ready = the governance lines = added + already in the list), with a
row-by-row CSV to reconcile against the source. **[docs/CONTACT_LISTS.md](docs/CONTACT_LISTS.md)**

```bash
celery -A config worker -Q default,events,maintenance,campaign,email,sms,imports   # campaign = runs, email / sms = batches
python manage.py send_campaign_runs                                    # the same without Celery (development, or by hand)
```

### Global parameters and industry profiles

* **Configuration → Global parameters** (`platform_setting`): typed values that take effect within a minute, no deployment:
  alert recipients and webhook, support-session length, staff MFA, invoice due days, usage warning percent, default
  industry, export retention, the frontend's idle-timeout warning and how long it waits before signing out, and the
  installation's public address (`platform.api_public_url`: the provider webhook callbacks, unsubscribe links and the
  single sign-on redirect are built from it; empty = the `API_PUBLIC_URL` environment variable). Never a secret:
  secrets stay in the environment.
* **Configuration → Industry profiles** (`industry_profile`): what a kind of business gets by default (features) and what
  it calls things (terminology). Seeded: Generic, Retail, Hospitality, Financial services, Healthcare.
* A tenant picks its profile and may override single features on its own page. Resolution order:
  **product default → industry profile → tenant override → plan** (a plan can only take away). The API refuses what is
  off (`403`, or a field error for a channel), `/api/v1/me/` returns `industry`, `features` and `terminology`, and the
  React app hides what is off (navigation, settings tabs, channel choices, starter templates).

### Usage and billing

`rollup-usage` (hourly) meters messages, contacts, users and storage from the source tables into `tenant_usage`.
Tenants see **Settings → Plan & usage**; operators see **Billing → Usage against plan limits**. Publishing is refused
only when a plan has a message limit and *no* overage price. `generate-invoices` (monthly) drafts one invoice per tenant
for plans that have a `monthly_price` (set your prices under Plans; plans without one are never invoiced). Drafts are
the platform's working copy: **Issue** makes one visible to the tenant and starts the due date; **Mark as paid** / **Void**.
Payment collection is not included: `external_ref` is where your payment provider's id goes.

### Jobs and alerts

Every scheduled job records each run in `job_run` (`@monitored`). The health page lists all jobs: healthy, failed,
overdue or never run. `evaluate-alerts` (every 5 minutes) turns failing health checks and jobs into `platform_alert`
rows and notifies `alerts.recipients` by email and `alerts.webhook_url` (Slack-compatible): once when it opens, again
after `alerts.renotify_minutes` unless acknowledged, and once when it recovers. Run one by hand:

```bash
python manage.py run_job --list
python manage.py run_job rollup-usage
```

### Tenant operations: export, dedicated database, offboarding

Requested under **Operations → Tenant operations**, executed by the `run-tenant-operations` job or
`python manage.py run_tenant_operation <id>`; every step is appended to the operation's runbook. They copy and erase
with triggers off, so they need the DDL-owner login: `OWNER_DATABASE_URL` (never used by the web application).

| Operation | What it does |
|---|---|
| `EXPORT` | One CSV per tenant table + manifest with row counts and SHA-256, zipped into `TENANT_EXPORT_DIR`. Secret columns are left out. Tables are discovered from the catalog, not hard-coded. |
| `MOVE_TO_DEDICATED` | Freezes the tenant (API answers 503), copies it into a database that already has the CEP schema, verifies row counts table by table, switches the routing row. The pool copy stays until purged. Parameters: `db_alias`, `db_host`, `db_port`, `db_name`, `db_secret_ref=env:NAME` (`NAME_OWNER_USER` / `NAME_OWNER_PASSWORD`). Add the alias to the app servers and restart them. |
| `PURGE_SOURCE` | After a successful move only: removes the tenant's data from the pool. |
| `OFFBOARD` | Exports first, marks the tenant `OFFBOARDED` (sign-in refused), cancels the subscription, erases everything except the tenant tombstone, its invoices and the operation log. Needs `{"confirm": "<TENANT CODE>"}`. |

### Sign-in security

* **MFA (TOTP).** Users enrol under their name → **Account security** (QR code, 10 one-time recovery codes). A workspace
  can require it (**Settings → Security**): people without it get a token that reaches only enrolment. Staff who enrolled
  must also pass the code at `/admin/`. `security.mfa_required_for_staff` forces enrolment for all staff.
* **Single sign-on (OpenID Connect, authorization code + PKCE).** Configured by the tenant under **Settings → Security**
  (issuer, client id, write-only client secret encrypted with `FIELD_ENCRYPTION_KEY`, allowed email domains, optional
  account creation on first sign-in with a default role). Register the shown redirect URI (the installation's public
  address, `platform.api_public_url` or else `API_PUBLIC_URL`, + `/api/v1/auth/sso/callback/`) with the identity provider. "Require single sign-on" switches passwords off for everyone
  except workspace administrators (break-glass).
* **Support access.** A platform administrator opens a user's page in the back-office → **Sign in as this user**: a reason
  is mandatory, the session is read-only unless opened for writing, lasts `security.support_access_minutes`, can never
  touch users, roles, API keys or security settings, shows a banner in the app, emails the user, and is listed for the
  tenant under **Settings → Security → Support access**.
* **Idle sign-out.** After `security.idle_timeout_minutes` (default 2 hours) with no mouse, keyboard, wheel, touch or
  scroll activity anywhere in the tab, the frontend shows a dialog ("Still there?"); without a response within
  `security.idle_warning_seconds` (default 1 minute) it signs the person out and explains why on the next login screen.
  Activity in one tab of the browser keeps every tab of the same workspace alive (a shared `localStorage` timestamp);
  while the dialog is up, only its own buttons count as "still here" — a resting pointer must not silently cancel a
  sign-out nobody saw. Both numbers are global parameters, so they change on the next page load, no deployment needed.

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

Local development needs no Redis (in-process cache) unless `DEV_USE_REDIS=True`. Development shares a small database connection pool between
requests (`DEV_DB_POOL=False` turns it off): opening a connection per request costs over a second when the database is far away.
Every statement is one network round trip, so a database on the same machine or network is what makes the app fast.

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
  partition lifecycle nightly (`celery -A config worker -Q default,events,maintenance,campaign,email,sms,imports` and `celery -A config beat`).

## Development notes
* Connect as a **non-superuser** database role in development too (`cep` in the compose file is fine): PostgreSQL superusers
  bypass row-level security, which hides tenancy bugs.
* Tests: unmanaged models mean the test database must be built from the DDL — add a `pytest-django` `django_db_setup`
  fixture that applies `database/*.sql` and provisions a test tenant.
