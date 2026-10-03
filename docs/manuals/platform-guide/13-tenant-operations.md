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
