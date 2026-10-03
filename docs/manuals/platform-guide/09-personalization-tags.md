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
