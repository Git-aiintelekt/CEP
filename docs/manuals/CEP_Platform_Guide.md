# CEP Platform Guide

For the platform team in the back-office. Built from `docs/manuals/platform-guide`; edit the chapters there, not this file.

## Contents

- The CEP Platform Guide
  - How the guide is organised
  - Two ideas that run through everything
- Signing In and the Two Kinds of Staff
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- The Home Page, Alerts and Usage
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Tenants
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Onboarding a Tenant
  - What this is for
  - Who can use it
  - The six steps
  - How to
  - What happens behind the scenes
  - Things to know
- Industry Profiles and Features
  - What this is for
  - Who can use it
  - The feature catalogue
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Plans, Subscriptions, Usage and Invoices
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Global Parameters
  - What this is for
  - Who can use it
  - The parameters
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- The Platform's Mail Server
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Mailgun Inspect: Deliverability Tests for Every Workspace
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Personalization Tags
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Users, Roles, API Keys and Support Sessions
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Single Sign-On
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Jobs, Alerts and System Checks
  - What this is for
  - Who can use it
  - The jobs
  - The checks
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Moving, Exporting and Offboarding a Tenant
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Routing, Storage and Retention
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - Things to know
- The Read-Only Sections
  - What this is for
  - Who can use it
  - What each section holds
  - How to
  - Things to know
- Errors, Uptime and Tenant Performance
  - What this is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Security
  - What this is for
  - Who can use it
  - Step by step
  - Severity
  - When something does not work
- Engine Health
  - What this is for
  - Who can use it
  - The checks
  - The page
  - Alerts
  - Step by step
  - What happens behind the scenes
- Journeys
  - What this is for
  - Who can use it
  - What a workspace needs from the platform
  - What the workspace does itself
  - How journeys get their data
  - The jobs, and what to watch
  - Troubleshooting
  - Things to know
- Report Datasets and Report Engines
  - Step by step: a calculated measure
  - What these pages are for
  - How a report runs
  - Report Datasets
  - Report Engines
  - When something goes wrong
  - Related chapters
  - Dataset Links
- ClickHouse Demo Workspace (City HT)
  - What this is for
  - What is in it
  - Who can use it
  - Step by step
  - Things to know
  - Rebuilding or removing the demo
  - Related chapters
- AI Assistant
  - Step by step: switching AI on
  - What this page is for
  - The providers
  - A workspace's own key
  - Defaults
  - This month, by workspace
  - What happens on a prompt
  - When something is off

---

# The CEP Platform Guide

This guide is for the platform team: the people who run the back-office at `/admin`, create workspaces for customers, set the installation's parameters and keep it healthy. Workspace users have their own guide, the CEP User Guide; where the two meet (a workspace's set-up, its users, its sending), this guide says what the platform side does and leaves the rest to the User Guide.

## How the guide is organised

Each chapter follows a section of the back-office menu and has the same shape as the User Guide's: what the page is for, who can use it, the fields and controls (a table of what each is and what it changes), how to, what happens behind the scenes, things to know.

| Chapter | Menu section |
|---|---|
| Signing in and the two kinds of staff | the sign-in page, Account security, the second factor |
| The home page | Home, Alerts, Usage against limits |
| Tenants | Tenants, a tenant's page, its readiness |
| Onboarding a tenant | Tenants → Onboard a tenant |
| Industry profiles and features | Configuration → Industry profiles; a tenant's Industry and features |
| Plans, subscriptions, usage and invoices | Plans, Subscriptions, Invoices, Usage against limits |
| Global parameters | Configuration → Global parameters |
| The platform's mail server | Configuration → Mail server |
| Personalization tags | Configuration → Personalization tags |
| Users, roles, API keys and support sessions | People and access |
| Single sign-on | People and access → Single sign-on |
| Jobs, alerts and system checks | Operations → Job runs, Alerts, the home page's checks |
| Moving, exporting and offboarding a tenant | Tenants → Move and offboard |
| Routing, storage and retention | Operations → Database routing, Storage and CDN, Partition retention |
| The read-only sections | Campaigns, Delivery, Customers and lists, Content, the audit trail |
| Errors, uptime and tenant performance | Overview → Errors, Uptime, Tenant performance |

## Two ideas that run through everything

**Tenant and workspace are the same thing.** The back-office says tenant; the app says workspace. A tenant's code (for example `NWA`) is fixed once created: it names its partitions, its callback addresses and the `X-Tenant` header its API callers send.

**Where a setting comes from.** Many things resolve in layers: a feature's catalogue default, then the industry profile, then the tenant's own switch, then the plan, which always has the last word and can only take a feature away. A global parameter is the installation's default; a tenant's settings override it where the product allows. Each chapter says which layer a page writes.

---

# Signing In and the Two Kinds of Staff

**Where:** `/admin/login/`, and the account's own page in the React app for the second factor.

## What this is for

The back-office is Django's admin with the Unfold skin. It signs in with a session, not with the app's tokens, and only accounts marked as staff may open it. A staff member who has enrolled an authenticator must pass it on every new admin session before any page opens.

## Who can use it

| | |
|---|---|
| Staff | An account with *Staff* set (People and access → Users → Platform staff). Staff can open the back-office and read everything; what they can change follows Django's permissions. |
| Platform administrator | *Platform administrator* set as well: can change everything, for every tenant. |
| Second factor | Enrolled in the React app under Account Security. The global parameter `security.mfa_required_for_staff` makes it compulsory for every staff account. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Email, Password | The staff account's sign-in. A staff account belongs to a tenant like any other user; the platform's own tenant is the usual home. | |
| The code page | After the password, the six digits from the authenticator app, when enrolled or required. | The session opens only after it. |
| Account menu → Log out | Ends the admin session. | |

## How to

**Make someone staff.** Users → open the account → Platform staff → tick Staff; tick Platform administrator only for those who may change anything. A staff account's password is never typed in the back-office: Create password link and send it.

**Require the second factor for staff.** Global parameters → `security.mfa_required_for_staff` → yes. A staff member without an enrolled authenticator is asked to enrol in the app first: the app asks at the next sign-in, and every back-office page sends them to **Set Up Two-Step Verification**, with a link to the app's Account Security, until they have.

## What happens behind the scenes

The admin session is separate from the app's tokens: signing out of one does not sign out of the other. Everything a staff member changes goes to the change audit trail with their name.

## Things to know

- A support session into a workspace is opened from the user's page here (the Users chapter), never by knowing a user's password.
- Suspending a tenant does not lock its staff out of the back-office; only *Staff* decides that.

---

# The Home Page, Alerts and Usage

**Where:** Home at the top of the menu; Alerts and Usage against limits under Overview.

## What this is for

The home page is the platform's own cockpit: what needs attention right now, the quick actions, the figures, the newest tenants, the latest definition changes, the system checks and whether the scheduled jobs are on time. Alerts is the list of problems the checks raised and whether they were acknowledged; Usage against limits is every tenant's month so far, worst first.

## Who can use it

Every staff account. Acknowledging an alert needs change rights on alerts.

## The fields and controls

### Home

| Section | What it shows | Where it leads |
|---|---|---|
| Needs your attention | A failing or warning check, a failed or overdue job, the scheduler not running, an open alert, subscriptions past due, trials ending within 7 days, draft invoices to issue. | The check, the job, the alert, the subscription or invoice list. |
| Quick actions | New tenant, Find a user, Usage against limits, Invoices, Global parameters, Mail server, Move or offboard, Audit trail. | |
| Platform at a glance | Tenants, users, messages this month and the other headline numbers. | |
| Newest tenants | The latest workspaces with their status dot. | The tenant. |
| Latest changes | The newest entries of the change audit trail: who changed which definition. | The trail. |
| System checks | Database, tenant isolation, migrations, partitions, event outbox, failed messages, cache, background workers, configuration, email, secrets at rest, tenant operations, integrations, errors, uptime; *n of 15 fine*. | |
| Scheduled jobs | Every job with its last run and whether it is on time; *n of 14 on time*. | Job runs. |

### Alerts

| Control | What it is | What it changes |
|---|---|---|
| The list | Opened at, the check, severity (fail or warn), the summary, the notifications sent, the state (Open, Acknowledged, Resolved). | |
| Acknowledge | Stops the repeated notification while the problem lasts. | The alert resolves itself when the check passes again. |

### Usage against limits

| Column | What it is |
|---|---|
| Tenant, plan, messages, contacts, users, storage, deliverability tests | This month's usage against each limit, with the share used; tenants closest to a limit first. A hard-capped plan at its message limit stops sending. |

## How to

**Start the day.** Home: anything under Needs your attention first. A red check or a failed job has its detail one click away; an open alert says what was already notified.

**See who is about to hit a limit.** Usage against limits. Warn the tenant, or change the plan under Subscriptions.

## What happens behind the scenes

The evaluate-alerts job runs the health checks and the job report every 20 minutes. A problem opens one alert, is notified at once by email to `alerts.recipients` and to the `alerts.webhook_url` chat webhook, re-notified every `alerts.renotify_minutes` while it lasts, and resolved with a notice when the check passes again. The usage figures come from the rollup-usage job, every three hours; deliverability tests are counted live.

## Things to know

- A job marked *off* is deliberately not running (no broker, a setting); it is not a problem and raises no alert.
- The home page reads live; it is not cached.

---

# Tenants

**Where:** Tenants → Tenants; a tenant's page.

## What this is for

Every workspace: its identity (name, code, how its users reach it), its hosting, its industry profile and feature switches, its settings, and a readiness panel that says where its set-up stands. Creating one is the Onboard a tenant flow (its own chapter); this page is for everything after.

## Who can use it

Staff read; platform administrators change. Suspend, Reactivate, Request a data export and Repair onboarding are actions on the list.

## The fields and controls

### The list

| Column | What it is |
|---|---|
| Code, Name | The identity. The code is fixed once created. |
| Status | Active or Suspended. |
| Industry | The profile. |
| Readiness | *n of 8 done* with a meter, or Not onboarded. |
| Hosting, Region, Partition | Shared or dedicated, the region, the partition sequence number. |
| Active users, Onboarded at | |
| Filters, search | Status, hosting, region; by code, name, subdomain or custom domain. |

### A tenant's page

| Section | Fields | What they change |
|---|---|---|
| Workspace | Name, Code (fixed), Status, Time zone. | The zone every schedule, quiet hour and report of the workspace reads. Any IANA zone can be typed here. |
| Access | Subdomain, Custom app domain. | Users reach the app at `<subdomain>.your-domain`; the API also accepts the code in the X-Tenant header. A custom domain needs the DNS record and a certificate; the subdomain works meanwhile. |
| Hosting | Hosting (fixed), Region, Data residency, Onboarded at. | Shared tenants live in the pool database in their own partitions. Moving to dedicated is a migration (Move and offboard), not a field change. |
| Industry and features | Industry profile, and one switch per feature: Default (follows the profile), On, Off. | What the workspace offers. The plan always has the last word: a feature the plan excludes stays off. |
| Settings | The workspace's settings as stored: consent policy, notifications, approvals, the preference centre, the set-up card. | Normally changed by the workspace's administrator in the app; here for support. |
| Deliverability Tests | This month's inbox previews against the workspace's total, and where the total comes from; Add Tests opens the additions page (Mailgun Inspect chapter). | |
| Readiness | Eight checks over what exists, each with a sentence and the page that fixes it: provisioned, plan, industry and features, first administrator, personalization tags, consent policy, workspace sending (optional), single sign-on (optional). | |
| System | id, partition sequence, timestamps, row version. | |

### Actions on the list

| Action | What it does |
|---|---|
| Onboard a tenant | The guided flow (next chapter). |
| Suspend | Blocks sign-in and API access at once; the data stays. Reactivate undoes it. |
| Request a data export | Queues an export (Move and offboard chapter). |
| Repair onboarding | Runs the provisioning again: partitions, the routing row, the three starting roles, the platform tags. Safe to repeat. |

## How to

**Switch a feature on for one workspace.** The tenant → Industry and features → the feature → On → Save. The app shows it from the user's next request. If it stays off, the plan excludes it: change the plan or its features.

**Suspend a non-paying tenant.** Tick it on the list → Suspend. Its users get a refusal at sign-in and its API keys stop; campaigns scheduled meanwhile do not run.

**Check why a workspace cannot send.** The tenant's Readiness panel: an unchecked engine or an unverified sender reads as warn under Workspace sending. The fix is the workspace administrator's, in the app.

## What happens behind the scenes

A feature resolves as catalogue default → industry profile → the tenant's switch → the plan; the result is cached a few minutes per tenant and invalidated on save. The readiness panel is computed on every load from the real tables, as the app's Set-Up page is on its side.

## Things to know

- The code names partitions, callback addresses and the API header; it cannot change. Rename the workspace freely.
- Hosting is changed only by a move operation; the field is read-only once the tenant exists.

---

# Onboarding a Tenant

**Where:** Tenants → Onboard a tenant (the rocket button above the list).

## What this is for

How a new workspace comes in: six steps that gather everything a workspace needs, kept as a draft in your session until the last step writes it all in one go: the tenant, its partitions and routing, the three starting roles, the platform's tags, the subscription, the first administrators with their password links, and the hand-off email. A draft left unfinished is announced at the top of the Tenants list with Continue and Discard.

## Who can use it

Platform administrators.

## The six steps

| Step | Asks | Checks and effects |
|---|---|---|
| 1 Workspace | Workspace name; Code; Subdomain; Custom app domain; Time zone; Region; Data residency; Hosting (shared, the usual choice, or dedicated). | Name and code unique; the code upper case, a letter then up to 19 letters, digits or underscores, fixed afterwards; the subdomain lower case; a known IANA zone. |
| 2 Plan and features | Subscription plan; Trial days (0 with a billing reference starts the subscription active); Billing reference (the customer at the billing provider: no invoice without it); Industry profile; one switch per feature: follow, on, off. | The table under the form shows where every switch comes from: catalogue default → profile → this workspace → plan. A plan can only take a feature away. |
| 3 First administrator | Full name; Email (must not exist in another workspace); Also invite (more administrators, one email per line). | Each gets the Workspace Admin role and a one-time password link. |
| 4 Policies (skippable) | The consent policy: People without consent (hold back or refuse), Texts need a consent date, Approval before first send, Consent lifetime. | Written into the workspace's settings; the administrator can change it under Settings → Consent Policy. The rest (quiet hours, security, tags, single sign-on) is shown, not asked. |
| 5 Hand-off (skippable) | A line from you. | Goes into the password-link email under the set-up list. |
| 6 Review and onboard | Everything in one place, and whether the platform's mail server can send the links. **Onboard CODE** does it. | |

## How to

**Onboard a customer.** Tenants → Onboard a tenant → the six steps → Onboard. The administrator's email carries the password link and the set-up list: choose a password, sign in, and the app's Set-Up page walks them through engines, senders, lists and the rest (User Guide: Setting Up a New Workspace).

**The link could not be emailed.** The flow says so with the link to copy; send it by hand. The platform's mail server (Configuration → Mail server) is what carries it; without one, every link has to be copied.

**Something was missed.** The tenant's page: Industry and features, the plan under Subscriptions, more users under Users (each with Create password link), Repair onboarding if the provisioning looks incomplete.

## What happens behind the scenes

The last step runs in one transaction on the platform connection: the tenant row with its settings (industry, feature overrides, the consent policy when step 4 was answered, onboarded at), the feature cache invalidated, the provisioning (partitions for every partitioned table for the months ahead, the database routing row, the three starting roles, the coupon tags, a copy of every active platform tag, the integration records), the subscription (a trial with its end date, or active when 0 trial days and a billing reference), and the users with no password and the Workspace Admin role. Then the mail, one per user. Onboarding is idempotent: running the provisioning again changes nothing that exists.

## Things to know

- Nothing is written before the last step; a discarded draft leaves no trace.
- Password links last `security.password_link_hours` (72 by default); a new link from the user's page replaces an expired one.
- The workspace's readiness, and the app's Set-Up page, pick up where the flow leaves off.

---

# Industry Profiles and Features

**Where:** Configuration → Industry profiles; a tenant's page → Industry and features; a plan's Features.

## What this is for

A feature is a part of CEP that can be on or off per workspace. An industry profile is a starting point: which features a workspace of that kind begins with, and what it calls customers, locations and transactions. The tenant's own switches override the profile; the plan has the last word.

## Who can use it

Platform administrators.

## The feature catalogue

| Feature | What it switches on in the workspace | Default |
|---|---|---|
| Email campaigns | The email channel: templates, campaigns, engines. | on |
| SMS messages | The text channel: text templates and campaigns, text engines and senders, text lists. | on |
| MMS picture messages | Picture messages on top of texts. | on |
| E-receipts | E-receipt templates and campaigns, the point-of-sale endpoint, Settings → POS Receipts. | off; a plan may exclude it |
| Journeys | Journeys in the app and Active Journeys on Home. | on; a plan may exclude it |
| Subject-line A/B testing | The subject line test on a campaign's Test step. | on; a plan may exclude it |
| Loyalty tags and statements | The loyalty tags and the loyalty section of receipts. | off |
| API keys and integrations | Settings → API Keys. | on |
| Outbound webhooks | The chat webhook under Notifications. | on |
| Single sign-on | Settings → Security's single sign-on section. | on |
| Custom sending domain | A sending domain of the workspace's own. | off; a plan may exclude it |
| AI scoring | Scores on customers. | off |
| Barcodes and QR codes | The designer's Barcode and QR Code blocks and the codes drawn at send time. | off; a plan may exclude it |
| Deliverability tests | Inbox previews from the designer, within the plan's allowance. | on; a plan may exclude it |

### How a feature resolves

Catalogue default → the industry profile's value → the tenant's switch (Default, On, Off) → the plan's features, which can only take away. The result is what `GET /me/` tells the app, so a page that belongs to a feature that is off is not shown at all.

## The fields and controls

### An industry profile

| Field | What it is | What it changes |
|---|---|---|
| Code, Name, Description | The identity; the code is fixed. Seeded: General business, Retail, Hospitality and travel, Financial services, Healthcare. | |
| Features | One switch per feature: follow the catalogue, on, off. | The starting point for every tenant on the profile that leaves a feature on Default. |
| Vocabulary | What the workspace calls a customer, a location and a transaction (for example member, store, order). | The words the app uses in its labels. |
| Defaults | Starting settings for a new tenant on the profile. | |
| Active, Sort order | Whether the profile is offered when onboarding, and where in the list. | |

## How to

**Give a customer barcodes.** The tenant → Industry and features → Barcodes and QR codes → On. If the plan excludes it (Plans → the plan → Features), change the plan first.

**A new kind of customer.** Industry profiles → Add: the code, the vocabulary, the features that make sense; then onboard tenants on it.

## What happens behind the scenes

The resolved features and vocabulary are cached per tenant for a few minutes and invalidated when the tenant, its profile or its plan is saved. Changing a profile changes every tenant that follows it on the next request.

## Things to know

- Switching a feature off hides its pages but deletes nothing: a text campaign stays stored and comes back when the feature returns.
- The global parameter `tenancy.default_industry` names the profile a tenant without one follows.

---

# Plans, Subscriptions, Usage and Invoices

**Where:** Tenants → Plans, Subscriptions, Invoices; Overview → Usage against limits.

## What this is for

A plan is what a customer buys: its limits, its price and what it includes. A subscription puts a tenant on a plan, as a trial or active. Usage is metered per tenant per month and read against the plan; an invoice is drafted for each tenant at month end from the plan's price and any overage, and issued from here.

## Who can use it

Platform administrators. The workspace's administrator sees the result under Settings → Plan & Usage, read-only.

## The fields and controls

### A plan

| Field | What it is | What it changes |
|---|---|---|
| Code, Name | STARTER, GROWTH, ENTERPRISE as seeded; any code. | |
| Default hosting | Shared or dedicated for tenants on the plan. | The suggestion when onboarding. |
| Max contacts, Max messages per month, Max users, Max storage (GB), Max deliverability tests per month | The limits; empty means unlimited. | Usage against limits and the workspace's Plan & Usage read against them. Users refuses a new user past the limit; a deliverability test through the platform's Mailgun Inspect account past the plan's number plus the month's additions is refused. |
| Overage per 1,000 messages, per 1,000 contacts | The price of going over; empty means a hard limit: sending stops at the message limit. | Whether a tenant at its limit is billed or stopped. |
| Monthly price, Currency | | The invoice's base amount. |
| Features | The features the plan allows, as switches; a feature switched off here is off for every tenant on the plan, whatever the tenant's own switch. | |
| Active | Whether the plan is offered. | |

### A subscription

| Field | What it is | What it changes |
|---|---|---|
| Tenant, Plan | | |
| Status | Trial, Active, Past due, Cancelled. | A cancelled subscription does not count; a tenant with none is unmetered and uninvoiced. |
| Started at, Trial ends at, Ends at | | A trial ending within 7 days is listed on the home page. |
| Billing reference, Billing subscription reference | The customer and subscription at the billing provider. | No invoice is raised without a billing reference. |

### An invoice

| Field | What it is | What it changes |
|---|---|---|
| Number, Tenant, Period, Plan, Base amount, Overage amount, Total, Line items | Drafted by the generate-invoices job from the month's usage. Drafts are recomputed on re-run; issued and paid invoices never are. | |
| Status | Draft, Issued, Paid, Void. | Draft invoices are not visible to the tenant. |
| Issue | The tenant can see it under Plan & Usage and the due date starts (`billing.invoice_due_days`, 14 by default). | |
| Mark as paid, Void | | |

## How to

**Put a trial customer on a paid plan.** Subscriptions → the subscription → Status: Active, the billing reference → Save. Or add a new subscription on another plan; the newest counts.

**Raise a limit for one customer.** Make a plan for them (copy the figures, change the limit) and move their subscription to it. Limits live on the plan, not the tenant.

**Month end.** The job drafts the invoices in the first days of the month; Home says how many drafts wait. Invoices → tick → Issue. Mark as paid when the money arrives.

## What happens behind the scenes

The rollup-usage job counts messages, contacts and storage per tenant from the source tables every three hours; the count is recomputed, not incremented, so a re-run is safe. Deliverability tests are counted live because the allowance is checked before every test. Publishing a campaign on a hard-capped plan that has used its messages is refused with the limit named; `billing.usage_warning_percent` (80) is where a meter turns amber.

## Things to know

- A plan's feature switch overrides every tenant on it; use it for what the plan sells, and the tenant's switches for exceptions above that.
- The Sandbox text engine is not metered.

---

# Global Parameters

**Where:** Configuration → Global parameters.

## What this is for

The installation's defaults and limits, one row per parameter, read by every tenant unless the product gives a tenant its own setting. Each has a kind (text, whole number, decimal, yes/no, a list, an object) and is edited as a typed value, never as raw JSON. Secrets never live here.

## Who can use it

Platform administrators.

## The parameters

| Parameter | Kind | Default | What it changes |
|---|---|---|---|
| security.password_link_hours | number | 72 | How long a password link works. |
| security.support_access_minutes | number | 30 | How long a support session lasts. |
| security.notify_user_on_support_access | yes/no | yes | Whether the user is emailed when support signs in as them. |
| security.mfa_required_for_staff | yes/no | no | Every staff account must pass the second factor to open the back-office. |
| security.idle_timeout_minutes, security.idle_warning_seconds | number | 120, 60 | How long the app waits before warning of inactivity, and how long the warning stays before signing out. |
| billing.invoice_due_days | number | 14 | The due date of an issued invoice. |
| billing.usage_warning_percent | number | 80 | Where a usage meter turns amber. |
| alerts.recipients | list | empty | Who is emailed when a check fails or a job breaks. |
| alerts.webhook_url | text | empty | A Slack-compatible webhook for the same. |
| alerts.renotify_minutes | number | 240 | How often an open alert is notified again. |
| errors.retention_days | number | 30 | Days error occurrences are kept; a resolved error not seen for this long is removed. |
| errors.spike_per_15_minutes | number | 25 | Occurrences of one error within 15 minutes that make the Errors check fail and alert. |
| metrics.retention_days | number | 30 | Days of per-minute request figures kept for Tenant performance. |
| uptime.failures_before_alert | number | 2 | Failed probes in a row before an uptime target is down and an alert goes out. |
| uptime.retention_days | number | 90 | Days of uptime probes kept. |
| tenancy.default_industry | text | GENERIC | The profile a tenant without one follows. |
| tenancy.offboarding_export_days | number | 30 | How long an offboarding export is kept. |
| messaging.max_upload_mb | number | 5 | The largest image a designer may upload. |
| messaging.sms_quiet_hours | object | 21:00 to 08:00 | Marketing texts due in this window (the workspace's zone) wait until it opens; an empty object switches it off. |
| lists.import_max_parallel | number | 2 | Uploads processed at once across the whole platform. |
| lists.import_max_waiting_per_workspace | number | 5 | Unfinished uploads a workspace may have before a new one is refused. |
| lists.import_chunk_rows | number | 5000 | Rows per chunk of an upload. |
| integrations.inbound_per_minute | object | 60 / 600 / unlimited per plan | The inbound pace limit per plan code for the point of sale and other callers. |
| integrations.log_body_max_bytes | number | 65536 | How much of a request or answer body the call log keeps. |
| integrations.log_retention_days, integrations.metric_retention_months | number | 90, 13 | How long the call log and its roll-up are kept. |
| engine_health.callback_silence_minutes | number | 60 | An engine that took messages but has not called back for this long is Failing (Engine Health). |
| engine_health.rejection_rate_pct, engine_health.p95_ms | decimal, number | 1, 5000 | The share of refused or failed calls, and the call time 95% of calls stay under, before an engine needs attention. |
| engine_health.hard_bounce_pct, engine_health.complaint_pct, engine_health.sms_failure_pct | decimal | 2, 0.1, 5 | The last day's hard bounces, complaints and failed texts before an engine needs attention; twice the line is Failing. |
| engine_health.receipt_wait_minutes, engine_health.missing_receipt_pct | number, decimal | 15, 1 | How long a text may wait for its receipt, and the share of the last two hours' texts that may still be waiting. |
| engine_health.min_sample | number | 50 | Messages or calls a rate needs before it is judged. |
| platform.api_public_url | text | empty | The public address callback addresses and links are built from. |
| legal.copyright_holder | text | Transaction Tree | Whose copyright the footer of every page carries, after the current year (the year itself is never typed: the app and the back-office take it from the clock). |
| legal.terms_of_use | text | the sample terms | The Terms of Use page the sign-in page and every footer link to, in Markdown: `##` for a heading, a blank line between paragraphs, `-` for a list. The page shows the date it was last changed. |

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Key, Category, Description | The identity; the category groups the list. | |
| Kind | Text, whole number, decimal, yes/no, list, object. | How Value is read. |
| Value | As it will be read: text, a number, yes or no; a list one entry per line; an object as key: value lines. | The parameter. |

## How to

**Send alerts to the on-call channel.** `alerts.recipients` → the addresses one per line; `alerts.webhook_url` → the chat webhook. The next evaluation uses them.

**Lengthen the password link for a slow customer.** `security.password_link_hours` → 168. Links made from now on last a week.

## What happens behind the scenes

Parameters are cached for a short time in every process and invalidated on save, so a change reaches the workers within minutes. A value the product does not understand is refused on save with the kind named.

## Things to know

- Keys and the platform's mail password are not parameters; they live in the environment and the mail server page.
- A workspace's own settings (its consent policy, notifications, quiet hours when a product gives one) override the parameter for that workspace only.

---

# The Platform's Mail Server

**Where:** Configuration → Mail server.

## What this is for

The SMTP server the platform's own mail goes out from: password links, alerts, support-access notices, and the fallback for a tenant that has no working mail server of its own. It is never a campaign engine: campaigns and e-receipts go through the tenant's own server or its sending engines.

## Who can use it

Platform administrators.

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Owner | The platform, or the tenant whose own server this is (tenants enter theirs in the app; they are listed here read-only). | |
| Host, Port, Security | The server, the port, none or STARTTLS or SSL. | |
| Username, Password | The password is stored encrypted and never shown; empty keeps the stored one. | |
| From address, From name, Reply-to | What people see on the platform's mail. | |
| Active | Whether the server is used. | |
| Send a test message to me | On the server's page: a message to your own address; the result is kept as the last test. | |

## How to

**Set it up.** Add the platform's server → Save → Send a test message to me. From then on password links are emailed instead of shown to copy.

**A tenant's links are not arriving.** Mail server → the tenant's own server, if any: its last test. A failed or missing server of theirs falls back to the platform's; a missing platform server means the link is shown in the flow to copy by hand.

## What happens behind the scenes

Where a message goes out from is resolved per message, first match wins: the tenant's own server when the message is for one of its users, then the platform's server, then SMTP from the environment, then the server log in development so nothing is ever silently lost.

## Things to know

- The platform's server carries only the platform's mail; a tenant cannot pick it as a campaign sender.
- The home page's Email check reads this server's last test.

---

# Mailgun Inspect: Deliverability Tests for Every Workspace

**Where:** Configuration → Mailgun Inspect; each tenant's page → Deliverability Tests → Add Tests.

## What this is for

The platform's Mailgun Inspect account. Inbox previews (a template rendered in real email clients) run through it for every workspace that has no Inspect account of its own, up to the workspace's plan number plus any tests added for the month. A workspace may instead enter its own Mailgun Inspect key in the app; its tests then run on its own account and CEP does not limit them.

## Who can use it

Platform administrators.

## The fields and controls

### The account (Configuration → Mailgun Inspect)

| Field | What it is | What it changes |
|---|---|---|
| Region | US or EU: where the Mailgun account lives. | The address the tests go to. |
| Username, API key | The Inspect account's username and an API key (Mailgun → Inspect → Settings → API). The key is stored encrypted and never shown; empty keeps the stored one. | |
| Default clients | The clients a test renders in when the workspace has not chosen its own. None ticked: the service's own default set. The list appears once the key is saved. | |
| Render with images blocked | The default for workspaces that have not chosen. | |
| Active | Whether workspaces may use the account. Off: only workspaces with their own account can run tests. | |
| Check Connection | Asks Mailgun for the client list with the stored key; the result shows as Connected or Check failed, with Mailgun's answer. | |
| Remove | Deletes the account. Past results stay. | Workspaces without their own account can no longer run tests. |
| This month, by workspace | Each workspace's tests through this account this month, its plan and its total (the added tests in brackets), with Add Tests. | |

### Added tests (a tenant's page → Deliverability Tests)

| Field | What it is | What it changes |
|---|---|---|
| The card | This month's tests against the total, the meter, and where the total comes from ("50 a month on the Growth plan + 70 added for October"). Its own account: "not limited". | |
| Tests | How many to add, 1 to 100,000. | This month's total. |
| Note | Why, for the record (300 characters). | |
| History | Every addition: when, for which month, how many, the note, by whom. **Remove** takes back an addition while its month is open; past months read Ended. | |

## How to

**Set it up.** Configuration → Mailgun Inspect → region, username and API key → Save → Check Connection. When it reads Connected, tick the default clients and Save again. Every workspace without its own account can now run inbox previews.

**Give a workspace more tests this month.** The tenant → Deliverability Tests → Add Tests → the number and a note → Add Tests. The workspace sees the new total at once, on its Deliverability tab and on Plan & Usage.

**Change the number every month.** Change the plan's Max deliverability tests per month (Plans and billing), or move the tenant to another plan. Additions are for one month only.

## What happens behind the scenes

A test counts when it is requested, because Mailgun bills it then, whatever comes back. Only tests through the platform's account count against the total; a workspace's own account is counted for information and never refused. Additions belong to a calendar month and end with it: nothing carries over. A test is tagged `cep:<tenant code>:<template>:<version>` on Mailgun, so the account's own usage can be split by workspace. A test's results are always read from the account that ran it, even if the workspace switches accounts meanwhile.

## Things to know

- A workspace with its own account uses it first; the platform's is the fallback.
- Additions to a workspace that uses its own account change nothing until it goes back to the platform's.
- The refusal at the limit names the total, where it comes from and the date more become available, and points the workspace to the platform team.

---

# Personalization Tags

**Where:** Configuration → Personalization tags.

## What this is for

The platform's own catalogue of tags, inherited by every workspace: first and last name, the coupon tags, the system tags, the receipt and store tags. A workspace's own tags are added in the app (Settings → Tags); the platform's are the same everywhere and changed only here.

## Who can use it

Platform administrators.

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Tag key, Label | The word inside the braces (lower case, letters, digits, underscores, starting with a letter) and what pickers show. | |
| Kind | What sort of tag it is. | |
| Data point | Where the value comes from: the customer record, a list upload column, the campaign, the run, the system, a receipt, a store, or a static value. For a customer attribute or an upload column, pick the typed entry and complete the path. | The value each recipient gets. |
| Path | Only for a typed data point: the attribute's key or the column's header. | |
| Static value, Default value, Format, Data type, Sample value | The same text for everyone; what a person without a value gets; how it is formatted; what previews show. | |
| Offered in | The channels whose editors list it. | |
| Active | Switching off takes the tag out of every workspace's designer. | |
| Workspaces | How many workspaces hold a copy. | |
| Apply to every workspace again | Pushes the tag to every active workspace once more, for a workspace onboarded before the tag existed. | |

## How to

**Add a tag every workspace should have.** Add → the key, label, data point, default and sample → Save. Every active workspace gets a copy at once; the designer offers it from the next load.

**A workspace is missing the standard tags.** Its readiness panel says how many are missing; Apply to every workspace again on the tag, or on each.

## What happens behind the scenes

Saving a platform tag pushes the change to every active workspace's copy, linked by the platform tag's id. A workspace tag that happens to have the same key is left alone and named in the message. Switching off switches the copies off; deleting releases the copies, which become the workspaces' own. The copies are the platform's to change: the workspace API refuses to edit or delete one.

## Things to know

- Templates reference tags by key; a key cannot be renamed without breaking them.
- The coupon tags are what the designer's Barcode and QR Code blocks read; keep them.

---

# Users, Roles, API Keys and Support Sessions

**Where:** People and access → Users, Roles, API keys, Support access log; Configuration → Permission catalogue.

## What this is for

Every workspace's users, roles and API keys in one place, across tenants, for support: resetting a password, deactivating an account, marking staff, and signing in as a user on the record. The workspace's own administrator does the same for their workspace in the app.

## Who can use it

Staff read; platform administrators change. A support session is logged under the staff member's name and the tenant sees it.

## The fields and controls

### Users

| Section | Fields | What they change |
|---|---|---|
| The list | Email, name, tenant, roles, active, staff, platform administrator, last sign-in; filters by tenant, active, staff, sign-in provider. | |
| Person | Tenant, Email (fixed once created), Name. | |
| Sign-in | Provider (local or the identity provider), external subject, Active, MFA enabled, last sign-in. Passwords are never typed here. | |
| Roles in the tenant | The workspace's roles. | What the user may do in the app. |
| Platform staff | Staff; Platform administrator. | Who may open the back-office and who may change everything in it. |
| Create password link | A one-time link, emailed when a mail server can, shown to copy otherwise. | |
| Sign in as this user (support session) | Reason (ticket and what the customer asked, readable by the tenant's administrators), Access mode (read only unless the customer asked for a change). | A short session in the app as that user. |
| Deactivate, Activate | | |

### Roles

A tenant's roles with their permissions and user counts; the Permission catalogue lists every permission code. The workspace's administrator edits roles in the app; here is for support.

### API keys

Every tenant's keys with their type, prefix, state, last use and expiry; Revoke stops a key at once. Keys are created in the app, where they are shown once.

### Support access log

| Column | What it is |
|---|---|
| Started, Tenant, Staff, Acted as, Access mode, Reason, Writes, State (Active, Ended, Expired) | Every support session ever opened. End the session now closes an open one. |

## How to

**A customer cannot sign in.** Find the user → check Active and the provider → Create password link → send it. A user of a workspace that requires single sign-on signs in through the provider, not with a link.

**See a problem with the customer's own eyes.** The user → Sign in as this user → the reason and read-only → Open. The app opens as them with a banner; the session ends after `security.support_access_minutes`, or on End session. The tenant's Security page lists it.

## What happens behind the scenes

A support session yields a short-lived token only: read-only unless opened for writing, and never able to manage users, roles, API keys or sign-in security whatever the mode. The user is emailed when `security.notify_user_on_support_access` is on. Everything changed here goes to the change audit trail.

## Things to know

- Deactivating keeps everything the user made; nothing is deleted.
- A user belongs to one tenant; the same email cannot exist in two workspaces.

---

# Single Sign-On

**Where:** People and access → Single sign-on.

## What this is for

The identity providers workspaces sign in through, one per tenant, as the workspace's administrator entered them under Settings → Security. The back-office lists them for support and can switch one off; the details are the tenant's to change in the app.

## Who can use it

Staff read; platform administrators change what is editable.

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Tenant, Name on the button, Issuer, Client id, Scopes, Allowed email domains, Create accounts on first sign-in, Role for new accounts | As the tenant entered them; read-only here. | |
| Active, Require single sign-on | Whether the button shows and whether passwords are refused for everyone but administrators. | Switching Require off here is the way back in when a provider broke and no administrator kept a password. |

## How to

**A workspace locked itself out.** The provider is down and the workspace requires single sign-on: open the row → Require single sign-on → off → Save. Their administrators' passwords work again; they can also use Create password link on the user.

## What happens behind the scenes

The feature **sso** must be on for the workspace; the sign-in page asks the API what the workspace offers and shows the button when a provider is active. Accounts created on first sign-in get the role the provider's row names.

## Things to know

- The client secret is stored encrypted and never shown anywhere; a new one is entered in the app.

---

# Jobs, Alerts and System Checks

**Where:** Operations → Job runs; Overview → Alerts; the home page's System checks and Scheduled jobs.

## What this is for

Everything CEP does on a timer, and how you know it is working: twenty-eight scheduled jobs with their runs, fifteen system checks, and the alerts raised when a check fails or a job breaks.

## Who can use it

Every staff account reads; acknowledging an alert needs change rights.

## The jobs

| Job | Does | Every |
|---|---|---|
| outbox-relay | Publishes domain events to the stream. | 5 min |
| ensure-monthly-partitions | Creates next months' partitions for every tenant. | 13 h |
| apply-partition-retention | Drops or detaches expired partitions. | 49 h |
| rollup-usage | Meters messages, contacts and storage per tenant. | 3 h |
| evaluate-alerts | Runs the health checks and notifies on changes. | 20 min |
| generate-invoices | Drafts last month's invoices. | 32 days |
| run-tenant-operations | Executes requested exports, moves and offboardings. | 30 min |
| dispatch-campaign-runs | Starts campaign runs that are due and closes finished ones. | 10 min (every minute on the scheduler) |
| plan-recurring-runs | Plans the next send of recurring campaigns. | 30 min |
| refresh-audience-lists | Brings contact lists that follow an audience in line with it. | 3 h |
| process-list-imports | Reads, checks and imports uploaded contact list files. | 10 min |
| rollup-integration-metrics | Rolls the integration log up into per-minute figures and prunes both. | 20 min |
| check-engine-health | Checks every active sending engine's callbacks, refused calls, speed, bounces and receipts, and stores the result (Overview → Engine Health). | 30 min (every 10 minutes on the scheduler) |
| check-engines-daily | Runs every active sending engine's Check: key and address, nothing sent. | 26 h (daily) |
| check-sending-domains | Looks up the SPF, DMARC and DKIM records of every workspace's sending domains (Settings → Delivery → Sending Domains). | 49 h (daily) |
| decide-ab-winners | Chooses the subject-line winner of runs whose decision time has come. | 10 min |
| send-weekly-reports | Emails the weekly report to workspaces that asked for one. | 3 h |
| probe-uptime | Calls the uptime targets and alerts when one goes down or comes back. | 10 min (every minute on the scheduler) |
| prune-observability | Removes errors, request figures and uptime probes past their retention. | 49 h |
| attribute-orders | Credits the orders workspaces sent to campaigns and writes each campaign's revenue, cost and ROI (workspaces with attribution on). | 30 min (every 5 minutes on the scheduler) |
| enroll-journey-customers | Enrols the customers who meet a live journey's entry: list members, events (sent, from orders, from tracking, No Response), segment changes, Date / Time schedules whose moment has come (each fires once), attribute matches; Only Customers Where filters and per-journey suppressions apply. A Fixed journey closes after its first pass. One scheduler per workspace (an advisory lock). | 10 min (every minute on the scheduler) |
| advance-journey-customers | Converts anyone whose goal event arrived, then moves journey customers whose next step is due: waits (durations, a time of day, a date on the record), conditions, splits, messages (through a daily campaign per step), coupon requests, record, tier, segment and list changes, webhooks. A temporary failure is retried after 5, 15 and 60 minutes, then given up (Needs Attention). | 10 min (every minute on the scheduler) |
| activate-scheduled-journeys | Takes journeys approved for a later time live once it comes, retiring the older live version. | 10 min (every minute on the scheduler) |
| rollup-journey-analytics | Rolls journey enrolments, conversions, revenue, the message counts and steps into the Performance figures. | 49 h (nightly) |
| deliver-report-schedules | Emails the Insights reports and dashboards whose scheduled time has come, as Excel, CSV, PDF or PowerPoint. | 20 min (every 5 minutes on the scheduler) |
| check-report-alerts | Reads the Insights alerts that are due and emails the ones whose value crosses its threshold (once, until it is back). | 20 min (every 5 minutes on the scheduler) |

The cadence is how late a job may be before it reads overdue; the scheduler runs most of them more often. Two chatty jobs (the outbox relay and the list imports) record only failures and one success a minute.

## The checks

| Check | What it looks at |
|---|---|
| Database | The pool database answers. |
| Tenant isolation | The application role and row-level security are in place. |
| Migrations | Nothing unapplied. |
| Partitions | Every tenant has partitions for the months ahead. |
| Event outbox | Events are being relayed, not piling up. |
| Failed messages | Dead letters, messages that failed for good. |
| Cache | The cache answers (throttles and breakers live in it). |
| Background workers | Workers are alive. |
| Configuration | The settings an installation needs are set, the public address among them. |
| Email | The platform's mail server's last test. |
| Secrets at rest | The encryption key is set, so credentials can be stored. |
| Tenant operations | No operation stuck. |
| Integrations | No circuit open for long. |
| Errors | No error new or returning in the last hour, and no error repeating fast. See Errors, Uptime and Tenant Performance. |
| Uptime | Every uptime target answers. |

## The fields and controls

| Control | What it is |
|---|---|
| Job runs | Started, job, status (Succeeded, Failed, Running), duration, worker, the error's first line; filter by status and job. A run opens with its result or its full error. |
| Alerts | Opened, check, severity, summary, notifications sent, state; Acknowledge. |
| Home → System checks, Scheduled jobs | The live picture: *n of 15 fine*, *n of 28 on time*. |

## How to

**A job is overdue.** Home says so. Job runs → filter by the job: a failed run shows the error; no run at all means the scheduler or a worker is not running. Restart the worker; the next pass catches up (runs are idempotent).

**Stop the noise from a known problem.** Alerts → the alert → Acknowledge. It stays open and resolves itself when the check passes.

## What happens behind the scenes

Every job records a run with its result or error. The evaluate-alerts job compares the checks and the job report with the open alerts: a new problem opens one alert and notifies `alerts.recipients` and the webhook; a lasting one is notified again every `alerts.renotify_minutes`; a problem that went away resolves its alert with a notice. Sending engines add one alert per engine and failing check (see Engine Health); a text engine that has never sent a receipt opens one acknowledged alert, emailed once.

## Things to know

- A job shown *off* is deliberately not scheduled in this installation and never alerts.
- Without a message broker one scheduler process runs every job in turn; with Celery the workers listen on their queues.

---

# Moving, Exporting and Offboarding a Tenant

**Where:** Tenants → Move and offboard; Request a data export on the Tenants list.

## What this is for

The lifecycle operations on a whole tenant: an export of its data, a move from the shared pool to a dedicated database, and offboarding (export, then erase). Each is a request that the run-tenant-operations job executes, with its progress appended as it runs, so the runbook writes itself.

## Who can use it

Platform administrators.

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Tenant, Operation | Export data; Move to a dedicated database; Offboard (export, then erase). | |
| Status | Requested, Running, Succeeded, Failed, Cancelled. | |
| Steps, Result, Error | The progress as it runs, what it produced, what went wrong. | |
| Requested by, requested, started, finished | | |
| Run now | Runs the operation in this request; small tenants only, and a move waits 70 seconds for caches. | |
| Cancel | Only while still waiting. | |

## How to

**A customer asks for their data.** Tenants → tick → Request a data export, or Move and offboard → Add → Export. The job runs it within half an hour; the result names the file. Exports are kept `tenancy.offboarding_export_days` (30).

**Move a large tenant to its own database.** Prepare the dedicated database and its owner credentials (the environment variables the operation names), then Add → Move to a dedicated database. The move copies the data with triggers and foreign-key checks off, switches the routing row, and waits for caches to expire. The tenant's hosting reads dedicated afterwards.

**A customer leaves.** Suspend first (the Tenants chapter), then Offboard: an export, then the erase. The tenant's status becomes offboarded and its partitions are dropped.

## What happens behind the scenes

Nothing is hard-coded: the catalogue is read for every table, and a table belongs to a tenant when it has a tenant column or reaches one through foreign keys; tables that reach no tenant (permissions, plans, reference codes) are global and left alone. The copy and the purge run as the database owner with triggers off, the way a restore does, so rows arrive exactly as they were. Every step is appended to the operation's progress.

## Things to know

- A move needs the owner credentials for both the pool and the target; the Tenant operations check on the home page reports a stuck operation.
- An export is a file on the platform's storage, not an email.

---

# Routing, Storage and Retention

**Where:** Operations → Database routing, Storage and CDN, Partition retention.

## What this is for

Where each tenant's data lives and for how long: the routing row that says which database a tenant is in, the storage backend and custom domain for its files, and the retention policy per partitioned table that ages old partitions out.

## Who can use it

Platform administrators. These are seldom touched by hand: onboarding writes the routing row, a move changes it, and retention runs on its own.

## The fields and controls

### Database routing

| Field | What it is |
|---|---|
| Tenant, Hosting (shared or dedicated), Database alias, Status | Which connection serves the tenant. Shared tenants share the pool with their own partitions and row-level security; a dedicated tenant has its own database named by the alias. Changed by a move operation, not by hand. |

### Storage and CDN

| Field | What it is |
|---|---|
| Tenant, Storage backend (S3, R2, GCS, Azure), bucket and prefix, custom domain and its status | Where the tenant's media and files are kept and served from. The designer's image library and list uploads use it. |

### Partition retention

| Field | What it is |
|---|---|
| Table, tenant-partitioned, sub-partitioning (monthly or hash), key, months to keep, what happens at expiry (drop or detach) | One policy per partitioned table: the ensure-monthly-partitions job creates the months ahead; the apply-partition-retention job drops or detaches partitions past the policy. |

## How to

**Keep the call log longer for one installation.** Partition retention → the integration log table → months to keep. The global parameter `integrations.log_retention_days` prunes rows inside the window; the partition policy bounds the whole.

## Things to know

- A dropped partition is gone; detach keeps it as a plain table for an archive.
- The Partitions check on the home page fails when a tenant lacks partitions for the months ahead; Repair onboarding on the tenant makes them.
- A month's partition runs from 00:00 UTC on its first day. Partitions made before October 2026 may start a few hours off, in the time zone of the session that made them; each new month starts exactly where the previous one ends, so no row falls between two months or into two.

---

# The Read-Only Sections

**Where:** The collapsible sections at the foot of the menu: Campaigns, Delivery, Customers and lists, Content; and Operations → Change audit trail.

## What this is for

Every workspace's records, across tenants, as the database holds them: for support, for answering a question the app cannot, and for the audit trail. Nothing here is edited; the workspace's pages are where things change.

## Who can use it

Every staff account reads.

## What each section holds

| Section | Lists |
|---|---|
| Campaigns | Campaigns, their runs and run variants (subject tests), the frozen audience snapshots and their members, targets and actuals. |
| Delivery | Sending engines (with their last check and whether a credential is stored; keys never shown), senders, every email and text sent with its status and the engine's id, provider callbacks as received, dead letters (messages that failed for good), tracking events and tracked links. |
| Customers and lists | Customers, segments, contact lists and their members, uploads and their rows. |
| Content | Templates and their versions. |
| Integrations | Every tenant's integration records (throttle, retries, breaker and log policy are editable here: Pause, Resume, Close the circuit now) and the call log with request and answer, keys masked. |
| Change audit trail | Who changed which definition, when, and which columns: every save in the app and the back-office. |

## How to

**Why did this person not get the campaign?** Campaigns → Audience members → filter by the campaign and search the person: the row carries the reason they were left out. The same is on the campaign's Audience tab in the app.

**What did the engine say about a message?** Delivery → Emails sent → the message: its status, the engine's id, and under Provider callbacks every event the engine posted for it.

**Who changed a plan?** Change audit trail → filter by the table.

## Things to know

- Keys, passwords and card numbers are never shown in these sections; a credential reads as stored or not.
- Editing a record here bypasses the app's rules; that is why the sections are read-only, except the integration policies, which belong to the platform.

---

# Errors, Uptime and Tenant Performance

**Where:** Overview → Errors, Uptime, Tenant performance. A tenant's own figures are also on its page, under Tenants → the tenant → Performance.

## What this is for

Knowing that something broke before a customer says so, and seeing how each tenant is served. Errors collects every failure from three places: the API, the background jobs, and the browsers of the people using the app. Uptime calls the installation's public addresses every minute and alerts when one stops answering. Tenant performance shows each tenant's requests, response times, sends and failures side by side, worst first.

## Who can use it

Platform staff. Tenants never see these pages; their own workspace shows only its own sends and integrations.

## The fields and controls

### Errors

| Field | What it is |
|---|---|
| Error | The message, and under it the kind (the exception) and where it happened: the endpoint, the job, or the page. |
| Source | API, Job or Browser. |
| Occurrences | How many times it happened since it was first seen. Every occurrence is counted; at most ten a minute are kept with their details. |
| Tenants | How many tenants it touched. |
| First seen, Last seen | When it started and when it last happened. |
| State | Open, Regressed (resolved, then seen again), Resolved, Ignored. The list opens on Open; the filter shows the rest. |
| Resolve, Ignore, Reopen | Actions on the list and buttons on the error's page. Resolve says it is fixed: if it happens again it reopens as Regressed. Ignore keeps counting but no longer counts as a problem. |
| The error's page | The state, the count, the tenants it touched, the last 14 days as bars, a note for what was found or the ticket, and the recent occurrences with the request, the tenant, the release and the full stack. |

### Uptime

| Field | What it is |
|---|---|
| Name, Address | What is called. Three targets are made on the first run from the installation's addresses: the API's health address, the app's first page, and the back-office sign-in. Add more with Add uptime target. |
| Expected status, Expected text | A healthy answer has this status (200 by default) and, when set, contains this text. The app target expects the page's root element, so a blank server error page counts as down. |
| Timeout (ms) | A slower answer is a failure. 5,000 by default. |
| Active | Off pauses the target without losing its history. |
| State, Since | Up, Down or Not checked yet, and for how long. |
| 24 h, 7 days, 30 days | The share of probes that succeeded. |
| Probe now | Calls every active target at once, without waiting for the minute. |
| The target's page | Availability and response time (p95) for each period, and the last 30 probes with their status, time and error. |

### Tenant performance

| Field | What it is |
|---|---|
| Period | Last hour, last 24 hours or last 7 days. |
| State | Trouble, Watch or Healthy. Trouble: server errors 2% or more, p95 2.5 s or more, bounces 5% or more, complaints 0.1% or more, or integrations failing 10% or more. Watch: a quarter of those, or any open error. |
| Requests, Server errors, p95 | The tenant's API calls, the share that failed on the server (5xx), and the time 95% of them finished within. The slowest endpoint is named under the tenant. |
| Sent, Delivered, Bounced, Complaints | Email and text messages created in the period and what became of them. |
| Integrations failing | Calls to and from its integrations that failed or were refused, of all calls. |
| Errors | Error occurrences tied to the tenant, and how many distinct errors are still open. |
| The tenant's page | The same figures as tiles, requests per hour as bars (a red bar had server errors), every endpoint it used with its counts and times, failing first, and the errors it hit. |

## How to

**Someone reports "the page crashed".** Errors → filter Source: Browser → find their page. The occurrence shows their workspace, the page, the browser and the component that failed. Fix it, then Resolve: if the fix did not hold, it comes back as Regressed.

**Find out why one tenant is slow.** Tenant performance → the tenant → Endpoints. The slowest endpoints are near the top; compare with another tenant on the same route to tell the tenant's data apart from the code.

**Watch another address.** Uptime → Add uptime target → the name, the address, and the text a healthy page contains. It is probed within the minute.

**Silence a known error.** Errors → the error → Ignore. It keeps counting and you can reopen it.

## What happens behind the scenes

Every API request is timed and counted per tenant, per endpoint and per minute; each server process adds its figures to the database every 30 seconds, outside the request. Response times are kept as counts in time buckets (under 50, 100, 250, 500 ms, 1, 2.5, 5, 10 s, and above), so p95 is an estimate, interpolated inside the bucket it falls in.

Any error the API or a job logs with an exception is recorded on a connection of its own, so it is kept even when the request that raised it is rolled back. A job that fails is recorded once, as a job error. The app reports errors from the browser through a public endpoint that takes at most 30 reports a minute from one address. Errors are grouped by their kind and where they happened, with ids and numbers taken out, so one crash on many campaigns is one error.

The probe-uptime job runs every minute. A target is down after `uptime.failures_before_alert` failures in a row and up again on the first success; either change runs the alert evaluation at once, so the notice goes out within the minute rather than at the next 5-minute pass.

Two health checks feed Home and the alerts. **Errors** asks for attention when an error is new or came back in the last hour, and fails when one error happens `errors.spike_per_15_minutes` times in 15 minutes. **Uptime** fails while any target is down. Both notify through `alerts.recipients` and `alerts.webhook_url` like every other check.

The prune-observability job removes, once a day, error occurrences after `errors.retention_days`, resolved and ignored errors not seen for that long, request figures after `metrics.retention_days`, and probes after `uptime.retention_days`.

## Things to know

- Uptime probes come from the server itself. They prove the addresses answer through the public route the server can reach; an outage of the network in front of it is better caught by an outside monitor calling `/healthz` as well.
- Figures from the last 30 seconds may not be written yet. The pages keep their figures for one minute.
- A browser report has no sign-in requirement, so it can come from the sign-in page itself. It never carries form contents, only the page, the error and the browser.
- Each occurrence records the release it happened on: the server's git commit, or `CEP_RELEASE` when set.

---

# Security

**Where:** Overview → Security. The number on the menu item counts the open Critical and High items on this server; the back-office Home shows a card while one is open (a warning card when the worst is Medium).

## What this is for

Knowing which updates and settings this server needs before someone else finds out. Each server checks itself once a day (the check-security job) and whenever someone presses **Check Now**:

- **Packages:** every Python package installed for the backend and every npm package in the deployed frontend (its package-lock.json) is looked up in OSV.dev, the open vulnerability database behind the GitHub, PyPI and npm advisories.
- **Server settings:** Django's own deployment checks (debug mode, the signing key, allowed hosts, HTTPS-only cookies, HSTS, the HTTPS redirect) and whether the development web server (`manage.py runserver`) is serving the app.
- **Site headers:** the headers the app's public address really sends: HSTS, Content-Security-Policy, nosniff, and whether other sites may frame it. Set the address in Global Parameters → `security.site_address` (for example `https://cepdev.aiintelekt.com`); while it is empty the headers are not checked.
- **Workspace isolation:** every table holding workspace rows that the app's login can read keeps each workspace's rows apart (forced row-level security), unless it is one of the platform's own tables; and the app's login can neither skip row-level security nor change the schema.
- **Accounts and keys:** platform accounts that have not signed in for 90 days, platform staff allowed to sign in without a second factor, active accounts with a test address (example.com, .test and the like), workspace accounts unused for 90 days, workspace API keys over a year old or unused for 90 days, and Postal engines whose callbacks are not signed.
- **Sending domains:** the SPF and DMARC records of every domain a workspace sends email from, read from DNS by this server. Domains reserved for examples (`.example`, `.test`) are not looked up. DKIM is not checked here: its record name depends on the mail engine's selector, which each workspace gives on its own Settings → Delivery → Sending Domains, where its administrators also see these results with the record to publish (the daily check-sending-domains job and Check Now).

The last three need patch 0067; until it is applied the page says so under Passed and the other checks run as before.

The page never installs or changes anything. A package is updated with a deploy and a setting on the server; the next check marks the item **Fixed** and the check history says so.

## Who can use it

Platform staff see the page. Accepting a risk and reopening an accepted item need a platform administrator.

## Step by step

**See what needs updating**

1. Open **Overview → Security**. The figures say how many items are open (Critical and High, Medium and Low), how many are accepted, and how many packages were checked.
2. **Needs Attention** lists every open item, worst first, packages, settings and data checks together: the severity, the item and why it matters, where it is (Backend · Python, Frontend · npm, Server setting, Site header, Workspace isolation, Account or key, Sending domain), what is there now and what fixes it, the reference, and when it was first seen.
3. Press the advisory to read it (GitHub or OSV.dev for a package, Django's documentation for a setting).
4. An npm package marked **Build-time only** is used while the frontend is built and never reaches a browser.

**Check now**

1. Press **Check Now** at the top right. The check takes a few seconds; the message says how many items are open and how many were fixed since the check before.
2. If OSV.dev cannot be reached, the settings are still checked; the packages keep their earlier findings and the page says so.

**Accept the risk**

1. On an open item, press **Accept…**.
2. Write why the risk is acceptable in a sentence (for example, a build-time package, or a setting the proxy in front already covers), and choose a **Review On** date within a year.
3. Press **Accept the Risk**. The item leaves the count and shows under **Accepted**, with who accepted it, why and until when.
4. It opens again on its review date, or as soon as an advisory appears that was not there when it was accepted. Press **Reopen** under Accepted to open it earlier.

**See what passed and the history**

1. **Passed** lists the packages with no known advisories (Python and npm), every setting and header that passes, and, below them, what passed in Workspace Isolation, Accounts and Keys and Sending Domains.
2. **Checks · last 30 days** lists every check: when, by the daily job or by whom, how many packages, what was open after it, and what it found fixed.

## Severity

| Severity | Meaning |
|---|---|
| Critical | Fix now: for example a weak signing key, a package advisory rated critical, or the app's login skipping row-level security. |
| High | Fix soon: debug mode on, the development web server serving, a session cookie sent over HTTP, a high-rated advisory, a workspace table that does not keep workspaces apart, an unused platform administrator, staff signing in with a password alone, a sending domain without SPF. |
| Medium | Plan the fix: missing HSTS or Content-Security-Policy, a moderate advisory, an advisory its database did not rate, an API key over a year old, unsigned engine callbacks, a sending domain without DMARC. |
| Low | Note it: a low-rated advisory, nosniff missing, the HTTPS redirect left to the proxy, unused workspace accounts or API keys, DMARC that only monitors. |

Package severities come from the advisory (GitHub's rating, or the rating of the GitHub twin of a PyPI advisory).

## When something does not work

| What you see | What it means |
|---|---|
| The page says it needs a database update | Patch 0066 has not been applied on this server. |
| Not checked yet | No check has run: press Check Now, or wait for the daily job. |
| "OSV.dev could not be reached" | The server cannot reach api.osv.dev over HTTPS; allow it in the firewall. |
| The site could not be read | The address in `security.site_address` does not answer from the server itself. |
| The development web server item does not appear on Windows | Running processes are read on Linux only. |
| Passed says the data checks wait for patch 0067 | Patch 0067 has not been applied on this server. |
| "A sending domain could not be looked up" | This server's DNS did not answer for it; check the server's resolver. |
| "Workspace Isolation was not checked" (or another group) | That group failed to read the database; the check's history shows the error, and the group's earlier findings stand. |

---

# Engine Health

**Where:** Overview → Engine Health. The number on the menu item counts the engines failing now. Problems also open alerts (Overview → Alerts), which are emailed to `alerts.recipients` and posted to the alert webhook. A workspace sees its own engines' health on Settings → Sending Engines.

## What this is for

Knowing when a sending engine stops working before the campaigns show it. C360 records every call to an engine (how long it took, what came back) and every callback, but a dead webhook, a refused key or a list that bounces used to be noticed only when someone looked. The check-engine-health job looks at every active engine of every workspace every 10 minutes; check-engines-daily runs each engine's Check (key and address, nothing sent) once a day.

## Who can use it

Platform staff see the page. Run Checks Now and Run Daily Check need a platform administrator.

## The checks

| Check | Looks at | Raises |
|---|---|---|
| Callbacks | The last callback from the engine and the messages sent since. | **Failing** when messages went out but the engine has not called back for `engine_health.callback_silence_minutes` (60). A message is given 10 minutes before its silence counts. |
| Refused Calls, 1 h | The last hour's calls in the integration log. | **Failing** when the key was refused (a 401 or 403 after the last good call) or the circuit breaker is open. **Attention** when more than `engine_health.rejection_rate_pct` (1%) of the calls were refused or failed. |
| API Speed, 1 h | The 95th percentile of the last hour's call times. | **Attention** above `engine_health.p95_ms` (5,000 ms). Judged from 10 calls. |
| Bounces · Complaints, 24 h | The last day's email from the engine. | **Attention** above `engine_health.hard_bounce_pct` (2%) hard bounces or `engine_health.complaint_pct` (0.1%) complaints; **Failing** at twice either. |
| Failed Texts, 24 h | The last day's text delivery receipts. | **Attention** above `engine_health.sms_failure_pct` (5%) failed; **Failing** at twice it. |
| Receipts | Texts of the last two hours still without a receipt after `engine_health.receipt_wait_minutes` (15). | **Attention** above `engine_health.missing_receipt_pct` (1%) of them. |
| Daily Check | The engine's last Check. | **Failing** when it failed. |

A rate is judged only from `engine_health.min_sample` (50) messages or calls in its window; fewer is **Quiet** and shows the counts (*1 of 1*) instead of a share, as an engine's own Check probe would otherwise read *100%*. An engine that sent nothing in a day is Quiet overall. All the lines are Global Parameters (category *Engine health*) and take effect within a minute.

**Digivize, said plainly.** Digivize accepts texts but has never posted a delivery receipt from its sandbox. A text engine that has never called back is therefore not judged on Callbacks or Receipts: it shows **No Receipts Yet**, one standing warning. Its alert opens acknowledged, is emailed once and is not repeated. The first receipt that arrives switches the real checks on by themselves.

## The page

| Part | What it shows |
|---|---|
| Run Checks Now | Runs the check-engine-health job at once. |
| Run Daily Check | Runs every active engine's Check at once (key and address, nothing sent). |
| Engines, Failing, Attention, Healthy or Quiet | The counts across every workspace. |
| Engines | One row per active engine, worst first: the workspace and engine, its health and the reason, messages sent in the last hour, the last callback, refused calls, the p95, bounces and complaints (failed texts for a text engine) and the Daily Check. A figure over its line is coloured. |
| The Lines | The thresholds in force, in words. |

## Alerts

Each failing check of an engine is one alert, named *Engine · workspace · engine · check*, for example *Engine · NWA · Postal Marketing · Callbacks*. It is notified when it opens, again every `alerts.renotify_minutes` while it lasts unless acknowledged, and resolved with a notice when the check passes. Failing checks are Failing alerts; Attention checks are warnings.

## Step by step

**An engine is Failing on Callbacks.** The engine is sending but its news is not coming back. In the provider's console check that the workspace's callback address is registered and switched on (the workspace copies it with Copy Webhook URL on Sending Engines). Postal: the mail server → Webhooks.

**An engine is Failing on Refused Calls with a refused key.** The key was revoked or replaced at the provider. The workspace enters the current key (Sending Engines → Edit) and presses Check; the health clears at once.

**Bounces need attention.** Find the campaign and list that sent the bad addresses (the workspace's run results, or the Emails Sent list under Delivery) before the next send makes the provider throttle the domain.

**Tune a line.** Configuration → Global Parameters → search `engine_health` → change the value. The next pass uses it.

## What happens behind the scenes

The job reads each workspace in its own row-level-security scope: the integration log (calls out, callbacks in, timings, status codes), the circuit breaker's state, the email and text records of the last day, and the engine's last Check. It stores one result per engine in `delivery_provider_health` (patch 0069), which this page, the workspace's page and the alert evaluator read. Before patch 0069 is applied the job skips and the page says so.

---

# Journeys

**Where:** Tenants → the workspace → Industry and features (the switch); Jobs and checks (the scheduler); the workspace's own Journeys pages (what tenants build). The User Guide's Journeys chapter is what the workspace reads.

## What this is for

Journeys are the automated, per-customer paths a workspace draws in the app: who enters, the steps they go through (waits, conditions, splits, messages, coupons, record changes, webhooks, a goal) and where the path ends. The platform team does not build journeys; it makes sure a workspace can, and that the machinery behind every workspace's journeys runs.

## Who can use it

Platform operators. Nothing here is visible to a workspace.

## What a workspace needs from the platform

| Item | Where | Notes |
|---|---|---|
| The Journeys feature | The tenant → Industry and features → Journeys → On (or Default when the industry profile has it on) | The plan has the last word: a plan whose features exclude `journeys` keeps it off for every tenant on it (Plans and billing). Without the feature the app hides the Journeys menu, the Home card, and refuses the tenant's events (`POST /api/v1/events/` answers 403). |
| Outbound webhooks | The `webhooks` feature (on by default) | The Webhook step is offered in the builder regardless; the feature governs the workspace's notification webhooks. |
| The scheduler | cep-jobs, one process for the platform (Jobs and checks) | Journeys do nothing without it: enrolment, advancement and activation run every minute, the roll-up nightly. Exactly one scheduler must work a given database: a second one skips a workspace the first holds (an advisory lock per workspace, per pass) rather than running it twice. |
| Secrets at rest | `FIELD_ENCRYPTION_KEY` on the servers (the Secrets at rest check) | A Webhook step's signing secret is encrypted with it. Without the key, secrets use a key derived from `SECRET_KEY`, which the check flags. |
| C360's feeds into the workspace database | The data team, outside CEP | `customer_master` (the customer records, with `custom_attributes` such as `loyalty_tier`, `birth_date`, `timezone`), `segment` and `customer_segment_membership`, `coupon`, `loyalty_tier`. CEP treats them as synced copies and never invents a customer: only a customer in the records can enter a journey. A contact list upload adds the people CEP did not know, owned by CEP. |
| The database layer | Patches 0045 (the Goal step: conversions, revenue, the roll-up's goal and message columns) and 0046 (per-journey suppressions, the JOURNEY list-member source, the `journey.export` and `journey.suppress` permissions) | Both are idempotent re-runs of the platform-operations layer; apply them before the code that reads them. The Needs Attention retries and the Webhook step need no patch. |

## What the workspace does itself

The workspace's administrator finishes the set-up in the app, and the User Guide's chapter walks them through it:

1. Roles: `journey.view`, `journey.edit`, `journey.activate`, `journey.export`, `journey.suppress` (Workspace Admin holds all five after patch 0046; roles that already held `journey.edit` were granted the two new ones).
2. A verified email sender and, for texts, a texting engine; published templates; a test list.
3. API keys: `events:ingest` for the systems that send events (the shop, the app, the loyalty system), `orders:ingest` for the shop's orders (Attribution), `coupons:issue` for C360 to fulfil coupon requests.
4. Consent policy, suppressions, the preference centre and frequency caps: journey messages go through the same send engine as campaigns.

## How journeys get their data

| From | Through | Used for |
|---|---|---|
| The shop, the app, the point of sale, the loyalty system | `POST /api/v1/events/` (up to 500 per call, deduplicated by `event_id`); `POST /api/v1/orders/` and POS transactions become Purchase events through Attribution | Event entries, event conditions, goals, conversions and revenue |
| C360 | Direct writes to the workspace's tables (above) | Who exists, their attributes and dates, segments, coupons, tiers |
| CEP itself | Email opens and clicks, SMS replies, No Response, Preference Update, Loyalty Tier Change, Coupon Issue | Entries and conditions that need no external sender |
| The workspace | Contact list uploads (the template has Time zone, Loyalty tier, Last order date columns) | Lists, the people CEP owns, the attributes an upload adds |
| Journeys, outward | The Webhook step: a signed JSON POST (`X-CEP-Signature`, `X-CEP-Timestamp`, `X-CEP-Delivery`) to an https address; every call in the integration log (system WEBHOOK) | The tenant's own systems |

## The jobs, and what to watch

| Job | Every | What it does |
|---|---|---|
| enroll-journey-customers | minute | Enters the customers who meet a live journey's entry: list members, events (seven days back at most, 5,000 per journey per pass), segment changes, Date / Time moments (each fires once), attribute matches; Only Customers Where filters and the journey's own suppressions apply. A Fixed journey closes after its first pass. |
| advance-journey-customers | minute | Converts anyone whose goal event arrived, then moves the customers whose next step is due. The log line's figures: moved, held, finished, busy, failed, converted, retrying, gave_up, locked. `locked` above 0 means another scheduler holds that workspace. |
| activate-scheduled-journeys | minute | Takes approved journeys live when their time comes, retiring the older live version. |
| rollup-journey-analytics | nightly | Rolls enrolments, conversions, revenue and the message counts per journey into `journey_master_analytical`. |

The jobs log (`jobs.log` on the application server) carries one line per pass with these figures. A pass that fails for a workspace is logged with the traceback and the other workspaces continue.

## Troubleshooting

| Symptom | Look at |
|---|---|
| The workspace sees no Journeys menu | The feature: the tenant's switch, then the plan's features. The app shows it from the user's next request. |
| Events are refused with 403 | The same feature, then the key's scope (`events:ingest`). |
| A customer never enters | They are not in `customer_master` (the Events page says *Not in the customer records yet*); the event is older than seven days or happened before the journey went live; the journey's population is Fixed and already closed; the customer is suppressed for the journey; the Only Customers Where filters do not match. Preview Route in the builder says which. |
| Customers stop moving | The scheduler: cep-jobs stopped, or every pass logs `locked: 1` because a second scheduler holds the workspace. |
| A step keeps failing | The journey page's Needs Attention card: the reason, the tries, Retry Now and Skip Step. A missing sender or a provider outage is temporary and retried; a missing template is permanent. |
| A Webhook step never delivers | The Webhook Calls card on the journey page (the endpoint's answer), then the integration log. http addresses are refused except localhost. |
| Converted figures look wrong | A journey without a Goal step counts Exit arrivals as converted; with one, only the goal's event within its window. The nightly roll-up lags the live page by up to a day. |

## Things to know

- A journey's message steps send through generated campaigns, one per step per day, so everything that governs a campaign send (consent, suppressions, caps, quiet hours, the preference centre) governs a journey message too.
- Test Publish sends real messages to the test population and skips waits; Preview Route sends nothing.
- Per-journey suppressions sit on top of the workspace's suppressions and consent; they never loosen them.
- The retry state lives on the customer's state record; nothing about retries needs a patch or a setting.

---

# Report Datasets and Report Engines

**Where:** Configuration → Report Datasets, and Configuration → Report Engines.

## Step by step: a calculated measure

1. Open Configuration → Report Datasets and open the dataset, such as Messages.
2. On a new field row, give the key (delivered_rate) and the label (Delivered Rate), put the key in **Column name** too (a formula reads no column), set **Type** to number, **Role** to measure and the **Display format** (percent for a rate).
3. Fill in **Formula**, for example:
   `{"op": "ratio", "left": {"field": "delivered", "aggregate": "sum"}, "right": {"field": "sent", "aggregate": "sum"}, "scale": 100}`.
   `op` is ratio, difference, sum or product; a side is a measure of the same dataset with one of its aggregates, or `{"value": 2}`; `scale` multiplies the result.
4. Press **Save**. The form refuses a formula that does not fit the dataset's fields, and sets the row's aggregates to `calc` itself.
5. Within a minute every workspace on the dataset finds it among the measures, with the calculation **Calculated**. Delivered, Open, Click and Bounce Rate, Average Order Value and Conversion Rate are already there.

## What these pages are for

Insights, the suite's reporting app, lets a workspace build its own reports, dashboards and scheduled deliveries on
the data the platform already keeps. Two things make that possible and both live here:

- **Report Datasets** is the catalogue: what a report can be built on (a dataset such as Messages or Attributed
  Orders), which fields each dataset offers, how each field may be filtered, grouped and totalled, how it is
  displayed, and how sensitive it is. Report authors see labels, never table or column names.
- **Report Engines** says, per workspace, which analytics engine runs its reports: **PostgreSQL**, the live reporting
  views on the workspace's own database, or **ClickHouse**, reporting tables loaded from those views. It also holds the
  workspace's query limits.

Nothing on these pages changes a workspace's data. They decide what can be reported on, where the query runs and how
much of the engine one workspace may use.

## How a report runs

A report is a definition: columns (dimensions to group by, measures to total), filters, a sort, a limit and a view.
The engine checks the definition against the catalogue, compiles it to SQL for the workspace's engine with every value
bound as a parameter and the workspace restriction always present, and runs it as one short read-only query under a
statement timeout, a row cap and a per-workspace cap on concurrent runs. Every preview, run, export and scheduled
delivery is written to the run log (Insights → Run Log in the app, for report administrators). A query that runs
too long is stopped and the person is told to narrow it; nothing else in the platform is affected. On the dev server
the engine runs as its own process, `cep-insights`, so a heavy report cannot slow the app.

## Report Datasets

| Field | Meaning |
|---|---|
| Key, label, description | How the dataset is named in the catalogue and described to authors. |
| Component | Which suite component the data belongs to (Engagement today). Reports group by it. |
| Primary key, time field | The row's identity, and the column a dashboard's period applies to. |
| Freshness policy | What the dataset promises: live, or as of a refresh. |
| Status | ACTIVE datasets are offered; anything else is hidden without being deleted. |
| Sources | One per engine: the view or table that holds the dataset on PostgreSQL and on ClickHouse. A workspace sees a dataset only when its engine has an ACTIVE source for it. |
| Fields | Each with its key, label, the column behind it, its type (string, number, date, datetime, boolean), its role (dimension or measure), the aggregates it allows (sum, count, distinct count, average, min, max), its display format (integer, decimal, money, percent, date, datetime) and its sensitivity. |
| Formula | Makes the field a calculated measure: `{"op": "ratio", "left": {"field": "delivered", "aggregate": "sum"}, "right": {"field": "sent", "aggregate": "sum"}, "scale": 100}`. `op` is ratio, difference, sum or product; a side is a measure of the same dataset with one of its aggregates, or `{"value": n}`; `scale` multiplies the result (100 for a percentage). The row is saved as a number measure with the aggregate `calc`; the column is a placeholder (the key is used when it is left empty). The form refuses a formula that does not fit the dataset's fields. Delivered, Open, Click and Bounce Rate, Average Order Value and Conversion Rate are seeded. |

### Sensitivity

- **NORMAL** fields are offered to everyone with Reports · View.
- **PII** fields (a customer's identifier, an email address) can be built on only by people with Report Admin
  (`report.admin`) or User Admin (`user.admin`). Everyone else does not see them in the catalogue, and when they open
  a shared report that has such a column, its values are masked in the grid, the exports and the deliveries.
- **CONFIDENTIAL** fields are never offered.

The four datasets shipped are Messages, Attributed Orders, Contacts and Journey Enrolments. Adding a field means
adding it to the reporting view (or table) first, then here; the catalogue is cached for a minute.

## Report Engines

One row per workspace. A workspace without a row runs on PostgreSQL with the default limits.

| Field | Values | Meaning |
|---|---|---|
| Engine | `postgresql`, `clickhouse` | The engine the workspace is on, or moving to. |
| Status | `ACTIVE`, `MIGRATING`, `READ_ONLY` | With ClickHouse, `MIGRATING` means the tables are being loaded or checked and reports **still run on PostgreSQL**. `ACTIVE` means reports run on the engine named. |
| Freshness SLA | `LIVE`, `QUARTER_HOUR`, `MINUTES_5`, `HOURLY`, `DAILY` | What the line under a report's title tells people: "live data", or "data as of the last quarter hour". |
| Query limits | JSON | `statement_timeout_ms` (15,000), `preview_rows` (200), `run_rows` (5,000), `export_rows` (100,000), `concurrent` (4). Empty means these defaults. Raise them for a workspace that needs more; the limits protect everyone else. |
| Connection profile | a Report Engine Connection, or empty | The ClickHouse this workspace loads into and reads from. Empty: the server's environment. |
| Last reconciled | time | Set by Reconcile. |

### Where the ClickHouse connection comes from

**Configuration → Report Engine Connections** holds the servers the platform can point a workspace at. One row per
connection: a profile name, the engine, the URL of ClickHouse's HTTP interface, the user, the password (typed to set
or change it, stored encrypted, never shown again), the database (`cep_reporting`), a status and notes. **Test
Connection** reaches the server and shows its version; the result stays on the row. A workspace's Report Engines row
chooses one of these in **Connection profile**; from then on its backfill, refresh, reconcile and reports use that
server, so workspaces can be spread over several ClickHouse servers. A row with no profile uses the server's
environment (`CLICKHOUSE_URL`, user, password, database), set by whoever runs the server; with neither, the buttons
say so and the workspace stays on PostgreSQL. The database patches 0053 (the catalogue's ClickHouse sources) and 0054
(the connections table) must be applied. The operator's guide, with the checks to run from the server, is
`docs/INSIGHTS_ENGINE_SWITCH.md`.

### Switching a workspace to ClickHouse

Open the workspace's row and use the buttons at the top of the page, in this order.

1. **Backfill ClickHouse.** Creates the ClickHouse database and tables if they are missing, copies every row of the
   workspace's datasets from the PostgreSQL views, and sets the row to `clickhouse` + `MIGRATING`. The message says how
   many rows went per dataset. Reports keep running on PostgreSQL. A large workspace takes a few minutes; the page
   waits.
2. **Reconcile.** Counts every dataset on both engines and shows them side by side; sets Last reconciled. Green when
   they agree, amber with the differences when they do not. A difference right after a backfill means rows changed in
   between: run Backfill again. Rows loaded twice replace themselves.
3. **Activate ClickHouse.** Sets `ACTIVE` and the freshness to a quarter hour. From the next request the workspace's
   reports, dashboards, exports and scheduled deliveries read ClickHouse. People see the same pages and the same
   figures; the line under a report's title now says "data as of the last quarter hour".

From then on the job **refresh-clickhouse-reporting** (every 15 minutes; see Jobs, Alerts and System Checks) reloads
the last seven days of messages, orders and enrolments, and the whole of contacts, for every workspace whose engine
is ClickHouse. Reconcile can be run again at any time.

### Rolling back

**Roll Back to PostgreSQL** sets `postgresql` + `ACTIVE` + `LIVE`. From the next request the workspace reads the live
views again. The ClickHouse tables keep their rows, so a later switch is Backfill, Reconcile, Activate once more.

### What to know about the ClickHouse engine today

- Rows deleted in PostgreSQL stay in ClickHouse until the next Backfill.
- A change to a row older than seven days (a message delivered late, an order re-attributed) reaches ClickHouse at the
  next Backfill, not at the quarter-hour refresh. After a bulk correction, run Backfill.
- One ClickHouse database holds every workspace's rows, kept apart by the workspace column on every query.

## When something goes wrong

| What people see | Where to look | What it usually is |
|---|---|---|
| "The report took longer than 15 seconds and was stopped" | Run Log, outcome Timed Out | A report over a large dataset without a filter. Suggest a period or a filter; raise `statement_timeout_ms` only for that workspace if it is legitimate. |
| "This workspace's reports are moving to a new engine" | Report Engines, status | The row is `MIGRATING` on an engine that is not yet active. Finish the switch or roll back. |
| "Insights is not part of this workspace" | Tenant → Components | The Insights component is not on for the workspace or its plan. |
| A dataset missing from New Report | Report Datasets → Sources | No ACTIVE source for the workspace's engine. |
| A PII field missing for someone | People and Access | They lack Report Admin or User Admin; that is by design. |
| A figure differs between engines | Report Engines → Reconcile | Rows changed since the last load. Backfill. |
| Deliveries not arriving | Insights → Scheduled, the run log kind Delivery; the workspace's Mail Server | The schedule is paused after three failures, or the workspace has no mail server. |
| ClickHouse buttons say it is not configured | the server's environment | The four ClickHouse lines are missing on that server. |

## Related chapters

Jobs, Alerts and System Checks (the refresh and delivery jobs on the health page); Tenants (switching the Insights
component on for a workspace); People and Access (the Reports · View, Edit and Admin permissions).

## Dataset Links

**Where:** Configuration → Dataset Links.

Two of the platform's datasets that share dimensions, so a report on the first can add measures from the second. Messages and Attributed Orders come linked both ways: they share Campaign and Channel, and a period on the send date is the same period on the order date.

| Control | What it is | What it changes |
|---|---|---|
| From dataset, To dataset | the report's dataset, and the one its measures come from | one link per pair, each way set on its own |
| Label | a sentence report authors read in the editor | the Linked Measures dialog |
| Pairs | the shared dimensions, each `[first dataset's field, second dataset's field]` | what a blended report may group by, and which filters apply to both sides |
| Time pair | the two dates that mean the same period, or empty | lets the report group by the date by a period |
| Status | Active, or Hidden | Hidden takes the link out of the editor; saved reports that use it are refused until it is active again |

Each pair must name dimensions of one type; the time pair two dates. Personal and confidential measures of the second dataset are never offered. A change shows in the editor within a minute.

---

# ClickHouse Demo Workspace (City HT)

**Where:** the dev server (`cepdev.aiintelekt.com`): the workspace **CITYHT**, opened from People and Access → Users; its engine under Configuration → Report Engines.

## What this is for

Showing how fast Insights stays on a large workspace once its reports run on ClickHouse. City HT carries 25 million messages, 3 million orders, 2 million contacts and half a million journey enrolments; its saved reports over the 25 million messages answer in well under a second.

It is a demo workspace on the dev server only: nothing in it is real, and it is not on the release-test or production servers.

## What is in it

| Data | Rows | Where it lives |
|---|---|---|
| Messages (email and texts) | 25,012,727 | ClickHouse |
| Attributed orders and refunds | 3,002,188 | ClickHouse |
| Contacts | 2,001,500 | ClickHouse |
| Journey enrolments | 501,220 | ClickHouse |
| A small working sample: 1,500 customers, 5 lists, 13 campaigns over 15 months, 2 journeys, POS sales and returns uploads | thousands | PostgreSQL (and copied to ClickHouse) |
| 20 "Demo ·" reports in a Demo folder, and 2 dashboards | | PostgreSQL |

The large volume covers the last 24 months, busier towards today, on the sample's own campaigns (a weekly newsletter, seasonal email campaigns, e-receipts, two text campaigns) and journeys (Welcome Series, Win-Back), with realistic rates: about 23% of emails opened, 4.7% clicked, 1.8% bounced; 6% of orders refunded; 28% of orders credited to a campaign.

## Who can use it

Platform staff, through **Sign In As** on the workspace's one user, `demo.admin@cityht.example` (Workspace Admin). That user has no password, so nobody can sign in as it directly.

## Step by step

**1. Open the workspace**

1. In the back-office, open **People and Access → Users** and search for `demo.admin@cityht.example`.
2. Open the user and choose **Sign In as This User (support session)**.
3. Write a reason (for example *ClickHouse demo*), keep the access **read-only** unless you will change something, and confirm.
4. The app opens as City HT, with the support banner at the top.

**2. Show that the workspace runs on ClickHouse**

1. In the back-office, open **Configuration → Report Engines** and the CITYHT row: engine **clickhouse**, status **ACTIVE**, freshness **QUARTER_HOUR**.
2. In the app, every Insights report says under its title that the data is as of the last quarter hour.

**3. Run the saved reports**

1. In the app, open **Insights → Reports** and the **Demo** folder.
2. Open the reports in this order, each a different kind of question over the large data:

| Report | What it reads | First run (measured) |
|---|---|---|
| Demo · Channel Mix by Quarter | 25M messages, grouped by quarter and channel | 0.66 s |
| Demo · Email Funnel by Campaign | 25M messages: sent, delivered, opened, clicked per campaign | 0.54 s |
| Demo · Campaign Detail | 25M messages, every campaign and run | 0.80 s |
| Demo · What Drives Clicks | 25M messages, Key Influencers | 0.74 s |
| Demo · Weekly Sends vs the Week Before | 25M messages, a week-on-week comparison | 0.56 s |
| Demo · Attributed Revenue by Month | 3M orders | 0.05 s |
| Demo · Customers by State | 2M contacts | 0.03 s |
| Demo · Journey Conversion | 0.5M enrolments | 0.03 s |

3. Opening a report a second time is almost instant (1 to 2 milliseconds): that is the app's result cache, not ClickHouse. To show ClickHouse itself again, change a filter (for example the date range) and run it.

**4. Build a report live**

1. In **Insights → Reports**, start a new report on **Messages**.
2. Group by the month of **Created** and by **Channel**; add the counts of sent, opened and clicked messages.
3. Run it: 25 million messages are grouped and counted in under a second.
4. Add a filter on one campaign, or switch to a chart: each change runs again just as quickly.

**5. Open the dashboards**

1. Open **Insights → Dashboards → Demo · Marketing Command Centre**: every tile reads the large data at once.
2. **Demo · Store Performance** reads the POS uploads, which stay in PostgreSQL (see *Things to know*).

**6. Check the speed in the Run Log**

1. In the app, open **Insights → Run Log** (report administrators; the demo admin is one).
2. Each run is listed with its time and rows, so the timings can be shown rather than told.

**7. Compare with PostgreSQL (optional)**

1. In the back-office, on the CITYHT row of **Configuration → Report Engines**, press **Roll Back to PostgreSQL**.
2. Run the same report in the app: it now reads the small PostgreSQL sample only (about 12,700 messages), because the 25 million rows exist in ClickHouse alone.
3. To go back, press **Backfill ClickHouse** (it copies the small sample again; the 25 million rows stay where they are), then **Activate ClickHouse**.

**8. End the session**

Press **End session** on the support banner in the app, or let it expire.

## Things to know

- **Reconcile** on the Report Engines row shows PostgreSQL far smaller than ClickHouse. That is by design: the large volume was generated straight into ClickHouse, so the dev server's PostgreSQL disk is not filled.
- The quarter-hourly `refresh-clickhouse-reporting` job keeps copying the sample's recent changes to ClickHouse; it never removes the generated rows.
- The seven POS reports (store sales, returns, margins) read uploaded files, which Insights keeps in PostgreSQL whatever the engine; they are not part of the ClickHouse comparison.
- The back-office Security page lists `demo.admin@cityht.example` as an account that looks like a test account (Low). Accept the risk there with a reason such as *demo workspace on the dev server*.
- Campaigns cannot be sent from City HT: it has no sending engine.

## Rebuilding or removing the demo

The scripts that built it are on the dev server in `~/cep-demo` (they are never pushed to the repository); each runs with `manage.py shell -c "exec(open(...).read())"` under the production settings, from `/app/cep/backend`.

| Script | What it does |
|---|---|
| `create_cityht.py` | Creates the workspace and its demo admin; does nothing if they exist. |
| `seed_insights_demo.py` with `DEMO_TENANT=CITYHT` | The PostgreSQL sample, reports and dashboards; `DEMO_MODE=clean` removes them. |
| `cityht_backfill_vocab.py` | Copies the sample into ClickHouse (Backfill) and prints its values. |
| `cityht_generate.py` | Removes and regenerates the large volume inside ClickHouse, merges the tables and sets the engine to ClickHouse (about 90 seconds). |
| `cityht_timing.py` | Times the saved reports through the report runner. |

To remove the large volume only, roll the workspace back to PostgreSQL and delete the generated rows in ClickHouse (their ids start with `g`, `go`, `gj` and `CHT-`), as the start of `cityht_generate.py` does.

## Related chapters

Report Datasets and Report Engines (switching any workspace between PostgreSQL and ClickHouse); Tenants and People and Access
(the workspace and its user); Security (accepting the demo admin as a known risk).

---

# AI Assistant

**Where:** Configuration → AI Assistant.

## Step by step: switching AI on

1. Open Configuration → AI Assistant in the back-office.
2. On the Claude (Anthropic) or OpenAI card, paste the API key from the provider's console, keep or change the two model names, leave **Workspaces May Use This Provider** on, and press **Save**.
3. Press **Check Connection**. The card shows Connected with the time, or Failed with the provider's reason; the check also says when a model name is not in the account's list.
4. Under the cards, choose the **Default Model** and whether **Explain This Report May Send Totals**, then **Save**. The plans' prompts a month are set on each plan.
5. From then on every workspace on a plan with prompts sees Ask for a Report above its report list, unless its administrator switches AI off under Settings → AI Assistant. The table at the bottom counts this month's drafts by workspace.

## What this page is for

Insights can turn a prompt into a report: a person writes what they want to see above the report list, picks a
model, and gets a draft back in words, checked against the report catalogue the same way as a report built by hand.
The model is Claude (Anthropic) or OpenAI, reached from CEP's own server with a key the platform team enters here. The
browser never sees a key, and no customer row ever leaves CEP: the model receives the prompt and the names of the
fields that person may use.

Each workspace decides for itself whether AI is used in its reports (Settings → AI Assistant), and its plan sets how
many drafts it may ask for in a month.

## The providers

One card per provider, Claude (Anthropic) and OpenAI:

| Field | What it does |
| --- | --- |
| API Key | From the provider's console (console.anthropic.com → API Keys, platform.openai.com → API Keys). Typed to set or change it, stored encrypted, never shown again; the label says "stored" once it is. Leave it empty on a later save to keep the saved key. |
| Model for Reports | The model offered as "best for reports", by its exact name at the provider (for example `claude-sonnet-5-5`, `gpt-5`). |
| Fast Model | The model offered as "fastest" (`claude-haiku-5-5`, `gpt-5-mini`). |
| Workspaces May Use This Provider | Off keeps the key but takes the provider's models out of every workspace's picker. |

**Check Connection** reaches the provider with the key and looks for the two models in the account's model list. The
result stays on the card (Connected, Failed with the reason, Not Checked after a new key). **Remove** deletes the key and
the card's settings; workspaces can no longer pick that provider.

Model names are settings, not code: a newer model is a change on this page, not a release.

## A workspace's own key

A workspace may enter its own key for either provider under Settings → AI Assistant, with the two models to offer. Its
own key wins over the platform's for that provider, so a workspace can use a provider the platform does not offer, or
keep its prompts on its own account. Prompts on a workspace's own key are not counted against its plan and do not
appear in the table below; the row is the workspace's, in `ai_provider` with its tenant id, and never shown here.

## Defaults

- **Default Model**: preselected for people who have not chosen one. A person's own choice is remembered in their browser.
- **Explain This Report May Send Totals**: whether the (coming) Explain This Report feature may send a report's totals to
  the model. Personal-data fields are never sent. Each workspace has its own switch under this one.
- **Prompts a Month**: read from the plans. Set it on each plan (Plans → AI prompts a month; empty means unlimited; the
  seeds are Starter 50, Growth 200, Enterprise unlimited). Only a draft counts; a question back or a no-field answer
  does not.

## This month, by workspace

The table at the bottom counts this month's drafts by workspace and provider against the workspace's number. A
workspace that reaches its number is told so at the prompt and can still build reports in the editor.

## What happens on a prompt

1. CEP checks the workspace's switch, the provider the person picked and the month's number.
2. It sends the provider the prompt and the catalogue of the datasets and fields that person may use (locked
   personal-data fields are left out), with the workspace's time zone and today's date, and asks for a reply in a fixed
   shape: a draft, one question, or no field for this.
3. A draft's definition is validated against the catalogue. One that does not fit is sent back once with the reason; a
   second miss is reported to the person as a failure, nothing is saved.
4. A draft is previewed under the preview cap for its row count, recorded against the month, and shown in words. **Open
   in Editor** makes it a private report of the person's, with its first version noted "Drafted by AI".
5. Every prompt, its model, outcome, token counts and draft are kept in the workspace for 90 days.

## When something is off

- The page says patch 0055 is missing: apply it; until then no workspace is offered AI.
- A workspace sees no prompt box: no provider is switched on here, or the workspace switched AI off, or the person
  cannot build reports (the box needs the report.edit right).
- Check Connection says a model is not in the account's list: the name is wrong for that account, or the account has
  no access to it; the prompt will fail until it is fixed.
