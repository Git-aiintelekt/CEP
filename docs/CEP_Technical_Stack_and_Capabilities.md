# CEP: Technical Stack and Capabilities

A briefing for stakeholders: what the Customer Engagement Platform does, what it is built on, how it is run, and what is still ahead. Written from the product as it stands on 3 October 2026.

## What CEP is

CEP is a multi-tenant customer engagement platform for retailers and other consumer businesses: one installation hosts many workspaces, each a company's own area with its contacts, templates, campaigns, sending engines and settings. A marketing team designs emails and texts, builds audiences from its own data, sends campaigns with consent and frequency rules applied, reads what came back, and sends e-receipts straight from the point of sale. The platform team onboards workspaces, sets plans and limits, and watches the installation from a back-office.

Two guides accompany the product: the **CEP User Guide** (24 chapters, shown inside the app behind a help icon on every page) and the **CEP Platform Guide** (16 chapters, shown inside the back-office).

## Capabilities

### Campaigns and sending

| Capability | What it does |
|---|---|
| Email, SMS and MMS campaigns | One-time, scheduled, recurring (daily, weekly, monthly, with an end) and drip series; a campaign has many runs and its results roll up. |
| Guided set-up | Create Campaign (name, type, channel, purpose, owner, tags), then Audience → Content → Test → Targets → Review & Publish, with validation per step and a pre-publish checklist. |
| Audience | Any number of contact lists included and excluded, merged into a frozen copy when the run starts, with a live estimate of who will be reached and why people are left out. |
| Governance at send time | Bounced, complained and blocked addresses, invalid addresses, the suppression list, unsubscribes, consent, the preference-centre topic, corporate frequency limits and duplicates, applied in the engine's own order; transactional, service and legal messages skip the consent rules. |
| Subject-line A/B tests | A sample split between two subjects, the winner chosen by open or click rate after a set time, the rest sent with it. |
| Recipient-local send times | The same clock time in each recipient's own time zone, from their address or a time-zone attribute. |
| Approvals | A second person's approval before a production publish, with notes, withdrawn by any later change. |
| Test publishing | Real messages to colleagues, counted in nothing. |
| Results | Delivered, opened, clicked, bounced, complained, unsubscribed, replied and STOP per run; a curve by hour or day; one row per recipient with its timeline; a direct query of the engine's own record. |
| Pause, resume, cancel, clone, archive | Status-aware actions on the list and the page; bulk actions; nothing is ever deleted, only archived. |

### Content

| Capability | What it does |
|---|---|
| Email designer | Drag-and-drop blocks on a canvas (structure, text, images, buttons, dividers, social links, brand header and footer, product cards, coupons, custom HTML), a settings panel per block, desktop and phone views, hide-on-phone and hide-on-desktop, personalization tags, an image library, links and findings checked before activation, versions on every save, autosave, inbox previews in four email clients in light and dark, a test send. The email's source is MJML and the server renders the HTML every inbox gets. |
| Barcodes and QR codes | Blocks that draw each recipient's own code (a coupon uploaded with the list, a receipt number) at send time, served as images. |
| Text and picture messages | An editor with live part counting (GSM and Unicode), tags, one picture for MMS, and a phone preview. |
| E-receipt editor | Five presentations (compact, standard, itemized, store register, custom HTML), seven receipt sections with their own switches, an outer email design, sample POS and e-commerce transactions. |
| Templates library | Channel tabs, status filter, search, presets copied as drafts, duplicate, rename, last-used-by. |
| Personalization | A platform catalogue inherited by every workspace plus the workspace's own tags, read from the customer record, upload columns, the campaign, the run, receipts or stores, with defaults and sample values. |
| Deliverability testing | Inbox previews through the workspace's Mailgun Inspect account, counted against the plan's monthly allowance. |

### Audiences and compliance

| Capability | What it does |
|---|---|
| Contact lists | From a CSV upload (up to 250,000 rows, processed in the background in chunks with progress), from an audience defined in the BI tool (kept in sync), or by cloning; production and test lists; reuse across campaigns. |
| Upload review | Every row judged as a marketing send would judge the person today, before anything is imported; a row-by-row report; numbers that reconcile. |
| Consent policy | What happens to people without a consent date (hold back or refuse), whether texts need a text consent date, approval before a fresh list's first send, the consent lifetime, the attestation sentence uploaders confirm. |
| Compliance record | Per list: the source, every upload with its declared consent basis and who attested, the approval, the policy as it stands, today's consent by channel. |
| Suppressions | One list of unsubscribes, STOPs, bounces, complaints and blocks; import a do-not-contact list; unblock where allowed; export. |
| Preference centre | A customer page reached from an email: channels and topics, locked receipts, unsubscribe from everything; campaigns filed under topics. |
| Unsubscribe | A signed link with a confirmation page and one-click (RFC 8058) support; a STOP reply opts a number out of everything. |

### Transactional and integrations

| Capability | What it does |
|---|---|
| POS e-receipts | The point of sale posts a TransactionTree (TTDR 3.2.2) document; CEP validates it against the schema, renders the receipt on the workspace's e-receipt campaign, sends it by email or text, answers in the same call with the codes the register already reads, and keeps only the trail. Returns and exchanges render as refunds. |
| Sending engines | Postal and SendGrid for email, the workspace's own SMTP server, Digivize for texts, and a sandbox that sends nothing for rehearsals; two credentials on one engine to keep receipts out of the campaign queue. |
| Callbacks | Delivery, bounce, complaint, open, click and unsubscribe events from the engines, verified by signature where the engine signs, applied to each message; replies and STOPs for texts. |
| The integration bridge | Every exchange with an outside system throttled, guarded by a circuit breaker and logged with the request and the answer (keys and card numbers masked); health cards, charts and a searchable call log per workspace; pause and resume. |
| API keys | Scoped keys with IP allow-lists and expiry; per-key pace limits with rate-limit headers. |
| Notifications | Send completed and failed, approvals, engine trouble, A/B winners and the weekly report, by email to the owner or fixed recipients and to a chat webhook. |

### Reporting

| Capability | What it does |
|---|---|
| Home | A command centre: alerts, the set-up card, key figures against the period before, revenue versus cost, the engagement funnel, channel snapshot, the next seven days, active journeys, recent campaigns, governance, e-receipts, with campaign, channel and period filters. |
| Reports | Period presets, channel filter, figure tiles, sent and opened by day, best and worst, campaign comparison, CSV export, a weekly scheduled email. |
| Attribution | Orders from the shop (`POST /orders/`) and, if allowed, the point of sale, credited last-touch to the campaign named by a code or the latest click, open or text in configurable windows; revenue, buyers, cost, ROI and contribution per campaign, refunds netted. |

### Multi-tenancy and administration

| Capability | What it does |
|---|---|
| Workspaces | Shared-pool hosting with per-tenant partitions and row-level security, or a dedicated database; a move between the two as an operation on the record. |
| Onboarding | A six-step guided flow in the back-office that creates everything a workspace needs in one transaction and hands off to the administrator's own Set-Up page in the app, which reads its seven steps from the workspace. |
| Industry profiles and features | Fourteen features switched per workspace, with the profile as the starting point and the plan with the last word; vocabulary per industry. |
| Plans and billing | Limits on messages, contacts, users, storage and deliverability tests; overage or hard cap; hourly usage metering; monthly invoices drafted, issued and marked paid. |
| Users, roles and permissions | Seventeen permissions composed into roles; three starting roles per workspace; one-time password links; deactivation, never deletion. |
| Security | Multi-factor authentication per user or required per workspace; single sign-on through any OpenID Connect provider, optional or required; support sessions by platform staff on the record and visible to the workspace; idle sign-out; secrets stored encrypted and never shown. |
| Operations | Fourteen scheduled jobs with recorded runs, thirteen health checks, alerts opened once and re-notified while they last, usage against limits worst first, a change audit trail, partition retention, exports and offboarding. |

## The technical stack

| Layer | Technology |
|---|---|
| Front end | React 19 with TypeScript 6, built by Vite 8; Tailwind CSS 4 on a token-based design system; TanStack Query for server state; React Router 7; React Hook Form with Zod for forms; GrapesJS with the MJML plugin for the email designer; Lucide icons; Vitest and Testing Library for tests. |
| Back end | Python 3.14, Django 6.1, Django REST Framework 3.18 with OpenAPI schemas (drf-spectacular), JWT sessions (SimpleJWT); django-unfold for the back-office; Celery 5 with Redis for queues where a broker exists, and an in-process scheduler where it does not. |
| Database | PostgreSQL 18: a shared pool with LIST partitioning by tenant and monthly sub-partitions on the large tables, row-level security on every tenant table, an application role separate from the owner role; a control plane for tenants, plans, parameters and jobs; an event outbox. 38 tables across three schema layers, evolved through 32 numbered patches. |
| Email rendering | MJML compiled by mrml on the server; the browser never supplies the final HTML. |
| Delivery adapters | Postal, SendGrid, SMTP, Digivize and a sandbox, behind one adapter contract: send, check, verify and parse callbacks. |
| Images and files | Content-addressed media per workspace on S3, R2, GCS or Azure through django-storages, served from a CDN; private storage for uploads, deleted as soon as staged. |
| Codes and receipts | python-barcode, segno and Pillow for barcodes and QR codes; lxml for schema validation of POS documents. |
| Security | Field encryption with the cryptography library; signed tokens for public links; HMAC-tokened callback addresses; TOTP for multi-factor authentication. |
| Deployment | Docker Compose for development (PostgreSQL 18, Redis 7); Gunicorn behind Nginx in production; a Cloudflare tunnel in front of the staging environment. |

## Architecture in brief

- **One API, two surfaces.** The React app and the back-office both talk to the same Django API. The back-office is Django's admin with a product skin, with its own pages for onboarding, usage, health and the guide.
- **Tenant isolation in the database.** Every tenant table carries the tenant id, is partitioned by it, and is protected by row-level security bound to the request's tenant; the application role cannot read across tenants. A move to a dedicated database copies the tenant's partitions and switches one routing row.
- **Work off the request.** Campaign sends, list imports, invoices and metrics run as jobs: the database itself is the queue for sends and imports, so nothing is lost when no broker is reachable, and chunked, idempotent steps let a crashed worker's job be taken over.
- **Everything external through one gate.** The integration bridge throttles, breaks the circuit and logs every call in both directions, so a receipt's call in, the send out and the engine's callback share one correlation id.
- **Resolution in layers.** Features resolve catalogue → industry profile → tenant → plan; mail goes out from the tenant's server, else the platform's; parameters are installation defaults the workspace overrides where the product allows.

## Quality and operations

| | |
|---|---|
| Front-end tests | 185 test files, about 1,940 tests, run against an in-memory API; typecheck and lint on every change. |
| Back-end tests | Suites per module run against the real database in rolled-back transactions: campaigns and the send engine, lists and governance, compliance, A/B and local send times, approvals, onboarding and readiness, the set-up page, the call log, the guide. |
| Observability | Recorded job runs, thirteen health checks, platform alerts with email and chat notification, per-workspace integration metrics and logs, a change audit trail. |
| Documentation | Design documents per module in the repository; the two guides built from Markdown into Word with one command. |
| Size | About 45,700 lines of TypeScript in the app and 24,800 lines of Python in the API and back-office. |

## Standards and compliance touchpoints

- Consent recorded per person and channel with its source and evidence; a declared consent basis on every upload, attested by the uploader; a bought or rented list is refused.
- Unsubscribe link required in marketing email; RFC 8058 one-click unsubscribe; STOP, START and HELP handling for texts; quiet hours for marketing texts.
- Suppression of bounced, complained and blocked addresses across every campaign.
- Secrets encrypted at rest and write-only in every interface; card numbers masked in logs; support access on the record and notified to the user.
- Audit trail of every definition change in the app and the back-office.

## What is still ahead

- Multi-touch attribution (credit shared along a person's path); today the last touch takes it all.
- Enforcement of a campaign's own hourly rate limit (the engine's per-minute pace is enforced today).
- Delivery receipts from the Digivize sandbox, which has not posted callbacks to the per-request address; the production account is expected to.
- Excel uploads (CSV today), per-list preferences, the consent-lifetime reminder.
- The spam verdict and inbox-placement tests, which need Mailgun Inspect Premium and a seed-list service.
- Journeys beyond the current read-only view, and the Reports and Journeys chapters of the User Guide.
