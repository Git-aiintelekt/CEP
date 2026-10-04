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
