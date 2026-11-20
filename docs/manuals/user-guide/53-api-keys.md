# API Keys

**Where:** Settings → General → API Keys.

## What this page is for

Keys for systems that call C360's API: the point of sale sending receipts, a web shop, a data warehouse. Each key has a name, the scopes it may use, optionally the addresses it may call from and an expiry. The key is shown once, when it is created. A key can never manage users, roles or other keys.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. A support session can never open or change this page. |
| Features | **api_access**. Without it the page is not in the Settings menu. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | Key (name and the visible prefix, for example `cep_in_AbC123…`), Scopes, Allowed From (*Any address* when not limited), Status (Active, Expired, Revoked), Last Used (*Never* until the first call), Expires (*Never* when it has no expiry). | Nothing; Last Used tells you whether a system still calls with the key, and Status whether it still works. |
| New API Key | Opens the *New API Key* form below; Create Key makes the key. | A new key that works from its first call. The form's choices cannot be changed afterwards: to change them, create a new key and revoke the old one. |
| Revoke | On a key that is not revoked. Asks *Revoke "{name}"? Systems using it stop working immediately. This cannot be undone.* | The key is refused from its next call (*Invalid API key*). The row stays, marked Revoked, so the call log still names it. |

### The form (New API Key)

| Field | What it is | What it changes |
|---|---|---|
| Name | Required, at least two characters, up to 100. The system that will use it, for example *POS integration*. | How the key appears in this table and in the call log, so you know which system to switch over before you revoke it. |
| Scopes | At least one. The service scopes: `receipts:send` (the point of sale and the web shop), `orders:ingest` (the shop's orders, for attribution), `events:ingest` (the shop's and the loyalty system's events, for journeys), `coupons:issue` (C360 answering journeys' coupon requests), `lists:write`, `scores:write`, `customers:read`, `consent:write`. Also one scope per permission, written with a colon (for example `campaign:view`), which lets the key do what that permission allows. | What the key may call: anything else is refused. Give it only what it needs. |
| Allowed IP Addresses | Optional. Addresses or CIDR ranges (for example `203.0.113.0/24`), separated by commas or new lines. Something that is not an address or range is refused. | A call from any other address is refused even with the right key (*IP address not allowed for this key*). Empty: any address may call. |
| Expires | Optional, your local time, in the future. | From that moment the key is refused (*API key expired*) and shows as Expired. Empty: the key never expires. |

### Copy the Key Now

Shown once, right after Create Key.

| Control | What it is | What it changes |
|---|---|---|
| API Key | The full key, read-only, with a Copy button (it reads *Copied*). Below it, how to send it: `Authorization: Bearer cep_…` together with the `X-Tenant` header. | Nothing; copy it into the calling system now. |
| I Have Stored It | Closes the dialog. | The full key is never shown again: only a fingerprint is stored, so it cannot be recovered. A lost key means a new key. |

## How to

**A key for the point of sale.** New API Key → *POS integration* → tick `receipts:send` → the stores' outbound address under Allowed IP Addresses → Create Key → Copy the key into the register software → I Have Stored It. The POS Receipts page says which headers to send it in.

**Rotate a key.** Create the new one, switch the caller over, check that the old key's Last Used stops moving, then Revoke the old one. The call log shows which key each call used.

## What happens behind the scenes

Only a hash of the key is stored; the prefix identifies it in the log. Each call checks the key, its expiry and its allowed addresses, then updates Last Used. Each key has its own pace limit, and every answer carries the rate-limit headers so the caller can slow itself down. A revoked or expired key stops the caller at once.

## Things to know

- A key belongs to this workspace only; the caller also names the workspace with the X-Tenant header.
- Keys are never written to the audit trail or an export.
- There is no scope for user administration: keys cannot add users, change roles or create keys.
