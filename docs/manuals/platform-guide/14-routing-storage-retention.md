# Routing, Storage and Retention

**Where:** Operations → Database routing, Storage and CDN, Partition retention.

## What this is for

Where each tenant's data lives and for how long: the routing row that says which database a tenant is in, the storage backend and custom domain for its files, and the retention policy per partitioned table that ages old partitions out.

## Who can use it

Platform administrators. These are seldom touched by hand: onboarding writes the routing row and the storage record, a move changes the routing, and retention runs on its own.

## The fields and controls

### Database routing

| Field | What it is |
|---|---|
| Tenant, Hosting (shared or dedicated), Database alias, Status | Which connection serves the tenant. Shared tenants share the pool with their own partitions and row-level security; a dedicated tenant has its own database named by the alias. Changed by a move operation, not by hand. |

### Storage and CDN

| Field | What it is |
|---|---|
| Tenant, Storage backend (S3, R2, GCS, Azure), bucket and prefix, custom domain and its status | Where the tenant's media and files are kept and served from. The designer's image library and list uploads use it. |
| Base prefix | The tenant's own folder in the bucket, `t/<partition number>/`. Images go under `img/`; uploaded contact files under `private/`, deleted once read. |
| CDN base URL | The address images are served from, `https://cdn.example.com`. An image's address is this, the prefix and the file: `https://cdn.example.com/t/7/img/ab/<hash>.png`. |
| Custom asset domain, status | A client's own address for its images (`assets.client.com`). Used only when the status is Active; otherwise the CDN base URL. |

The record is used only when the server's `.env` sets `MEDIA_BUCKET`; until then images stay on the server's disk under `/media/`. From then on every workspace needs one: without it, the workspace cannot upload images or contact lists. Onboarding makes it, from `MEDIA_BUCKET`, `MEDIA_REGION`, `S3_ENDPOINT_URL` and `CDN_BASE_URL`; the tenant's Readiness panel shows it (Storage and CDN), and the Configuration check on the home page names any workspace without one.

### Partition retention

| Field | What it is |
|---|---|
| Table, tenant-partitioned, sub-partitioning (monthly or hash), key, months to keep, what happens at expiry (drop or detach) | One policy per partitioned table: the ensure-monthly-partitions job creates the months ahead; the apply-partition-retention job drops or detaches partitions past the policy. |

## How to

**Move image storage to Cloudflare R2.** In Cloudflare:

1. R2 → Create bucket (`cep-media`).
2. The bucket → Settings → Custom Domains → Connect Domain: `cdn.<your domain>` (the domain must be in the same Cloudflare account). Leave the `r2.dev` address off.
3. Security → WAF → a custom rule that blocks requests to that host whose path contains `/private/`: the bucket also holds uploaded contact files for the moment they wait to be read, and a connected domain makes the whole bucket public.
4. Caching → Cache Rules: that host eligible for cache, keeping the files' own one-year lifetime.
5. R2 → Manage API tokens → Create: Object Read & Write on that bucket only. Keep the Access Key ID, the Secret Access Key and the S3 endpoint, `https://<account id>.r2.cloudflarestorage.com`.

Then on the server, in this order:

1. Give every existing workspace its record, before the switch:
   `manage.py storage_records --bucket cep-media --cdn https://cdn.<your domain> --region auto --endpoint https://<account id>.r2.cloudflarestorage.com`
   lists what each would get; add `--apply` to make them.
2. In `.env`: `MEDIA_BUCKET=cep-media`, `MEDIA_REGION=auto`, `S3_ENDPOINT_URL=https://<account id>.r2.cloudflarestorage.com`, `CDN_BASE_URL=https://cdn.<your domain>`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the token.
3. Restart the API, the jobs and Insights.
4. Check: an image uploaded in a template gets an address on the CDN, its second request answers `cf-cache-status: HIT`, a small contact list uploads, and the home page's Configuration check no longer says uploads go to the local disk.

If an upload fails with a checksum error, add `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` to `.env` and restart.

**Keep the call log longer for one installation.** Partition retention → the integration log table → months to keep. The global parameter `integrations.log_retention_days` prunes rows inside the window; the partition policy bounds the whole.

## Things to know

- A dropped partition is gone; detach keeps it as a plain table for an archive.
- Images uploaded before the switch stay on the server's disk with their `/media/` addresses, which templates and sent emails already hold: keep the folder. Nothing copies them to the bucket.
- A workspace copy (export and import) carries images from the server's disk only, not from the bucket.
- A custom asset domain on R2 needs the client's domain in your Cloudflare account (or Cloudflare for SaaS); start with the shared CDN address.
- The Partitions check on the home page fails when a tenant lacks partitions for the months ahead; Repair onboarding on the tenant makes them.
- A month's partition runs from 00:00 UTC on its first day. Partitions made before October 2026 may start a few hours off, in the time zone of the session that made them; each new month starts exactly where the previous one ends, so no row falls between two months or into two.
