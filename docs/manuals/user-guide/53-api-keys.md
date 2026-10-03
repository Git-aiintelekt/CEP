# API Keys

**Where:** Settings → Integrations → API Keys.

## What this page is for

Keys for systems that call CEP's API: the point of sale sending receipts, a web shop, a data warehouse. Each key has a name, the scopes it may use, optionally the addresses it may call from and an expiry. The key is shown once, when it is created.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |
| Features | **api_access**. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | Key (name and the visible prefix), Scopes, Allowed From, Status (Active, Expired, Revoked), Last Used, Expires. | |
| New API Key | The form below; then *Copy the Key Now*, shown once. | |
| Revoke | Stops the key at once. | The caller gets 401 from the next call. |

### The form

| Field | What it is | What it changes |
|---|---|---|
| Name | The system that will use it, for example *POS integration*. | |
| Scopes | Give the key only what it needs: `receipts:send` (the point of sale and the web shop), `lists:write`, `events:ingest`, `scores:write`, `customers:read`, `consent:write`. | What the key may call. |
| Allowed IP Addresses | Optional addresses or CIDR ranges. Empty means any address. | A call from elsewhere is refused. |
| Expires | Optional, your local time. | The key stops at that moment. |

## How to

**A key for the point of sale.** New API Key → *POS integration* → tick `receipts:send` → the stores' outbound address under Allowed IP Addresses → Create → copy the key into the register software now; it is never shown again. The POS Receipts page says which headers to send it in.

**Rotate a key.** Create the new one, switch the caller over, Revoke the old one. The call log shows which key each call used.

## What happens behind the scenes

Only a hash of the key is stored; the prefix identifies it in the log. Each key has its own pace limit, and every answer carries the rate-limit headers so the caller can slow itself down. A revoked or expired key stops the caller at once.

## Things to know

- A key belongs to this workspace only; the caller also names the workspace with the X-Tenant header.
- Keys are never written to the audit trail or an export.
