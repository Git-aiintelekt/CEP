# Tags

**Where:** Settings → Workspace → Tags.

## What this page is for

Tags are the words a template fills in for each person: `{{first_name}}`, `{{store_name}}`, `{{coupon_code}}`. The platform's own catalogue is inherited by every workspace and the same everywhere; this page shows it, and adds the workspace's own tags: a static text, or a value read from the customer record, a list upload column, the campaign, the run, a receipt or a store.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` to open Settings; the tags themselves are read with `template.edit` wherever the designer offers them. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Offered In | All, Email, SMS, MMS, E-Receipt: the channel filter. | The table. |
| The table | Tag (the key and its label), Reads From, Type, Offered In, Sample, Origin (Platform or Workspace). | |
| Add Tag, Edit, Remove | For the workspace's own tags. A platform tag is read-only here and changed by the platform team. | |

### The tag form

| Field | What it is | What it changes |
|---|---|---|
| Tag Key | The word inside the braces: lower-case letters, digits and underscores. | How the tag is typed in a template. Fixed once created. |
| Label | What the tag picker shows. | |
| Reads From | Where the value comes from at send time: a source (customer record, list upload column, campaign, run, system, receipt, store) or a static value. | |
| Data Point, Key | For a source: the data point, and for a list column or an attribute, the key that completes the path. | The value each recipient gets. |
| Static Value | The same text for everyone. | |
| Type | Text, Number, Date, True/False. | How the value is formatted. |
| Default Value | Used when the source is empty for a person. | What a person without the value sees. |
| Sample Value | Shown in previews, the designer's canvas and test sends. | |
| Offered In | The channels whose editors list the tag. | |
| Description | A line for whoever picks it. | |

## How to

**Add a tag from an upload column.** Add Tag → key `loyalty_tier`, label *Loyalty Tier* → Reads From: list upload column → Key: the column's header → Default: *Member* → Sample: *Gold* → Add. Upload lists with that column; every template can use the tag.

**A tag for one campaign's offer.** A static tag `offer_ends` with the date; change its value for the next campaign.

## What happens behind the scenes

At send time the engine fills each tag from its source: the workspace's catalogue, the list member's uploaded columns, the customer's attributes, then the default. A tag a template uses that is not in the catalogue is a finding on save. When the platform team changes a platform tag, every workspace's copy follows; a workspace tag with the same key is left alone.

## Things to know

- The coupon tags (`coupon_code`, `coupon_barcode_value`, `coupon_qr_value`) feed the designer's Barcode and QR Code blocks from list columns of the same names.
- Removing a tag does not change saved templates; they keep the token and the designer reports it as unknown.
