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
