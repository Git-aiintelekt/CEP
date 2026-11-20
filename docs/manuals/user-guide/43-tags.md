# Tags

**Where:** Settings → Engagement → Tags.

## What this page is for

Tags are the words a template fills in for each person: `{{first_name}}`, `{{store_name}}`, `{{coupon_code}}`. The platform's own catalogue is inherited by every workspace and the same everywhere; this page shows it, and adds the workspace's own tags: a static text, or a value read from the customer record, a list upload column, the campaign, the run, a receipt, a store or a point-of-sale transaction. A tag added here appears in the tag picker of the email designer and the message editors, and is filled in at send time.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` to open Settings; changing tags also needs `template.edit`. The tags themselves are offered wherever the designer and editors offer tags. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Offered In (filter) | All, Email, E-Receipt, SMS, MMS. Default All. | Only which tags the table shows. A tag offered in every channel shows under each filter. |
| The table | Tag (the key in braces and its label), Reads From (the source and its path, or *Static:* and the value), Type, Offered In (*Every channel* when none is chosen), Sample, Origin (Platform or Workspace). | Nothing; it is the whole catalogue a template can use. |
| Platform tags | Marked Platform, with *Changed in the back-office* instead of buttons. | Read-only here: the platform team changes them, and every workspace's copy follows. |
| Add Tag | Opens the *New Tag* form below; Add Tag saves it. | The tag is offered in the editors of the chosen channels at once, and filled in from the next send. |
| Edit | On a workspace tag. Opens *Edit {{key}}*; Save Tag saves it. | The next preview, test and send use the new source, default and sample. Messages already sent keep what they had. |
| Remove | On a workspace tag. Asks *Remove {{key}}? Templates that use it will show the tag unfilled.* | The tag leaves the catalogue and the pickers. Templates keep the token; the designer flags it as unknown, and at send time it is filled only from a list column or customer attribute of the same name, otherwise left empty. |

### The tag form

| Field | What it is | What it changes |
|---|---|---|
| Tag Key | The word inside the braces: lower-case letters, digits and underscores, starting with a letter, up to 100 characters. Must not be in use by another tag (*Another tag already uses this key.*). | How the tag is typed in a template: `{{loyalty_tier}}`. Fixed once created, because templates keep the token. |
| Label | The name people see, at least two characters, up to 150. | What the tag picker lists, and what its search finds. Shown under the key in this table. |
| Reads From | Where the value comes from when a message is sent: Customer, List upload, Campaign, Campaign run, System, Receipt (e-receipts), Store (e-receipts), Transaction (e-receipts from the point of sale), or Static value. Default Customer. | Which record each recipient's value is taken from. Changing it clears the Data Point. Receipt, Store and Transaction values exist only in e-receipts; anywhere else such a tag counts as empty. |
| Data Point | For a source: the field to read, from the list the source offers. Required. Choosing one sets Type to match. | The value each recipient gets. |
| Key | Shown when the data point is an open-ended one, such as a customer attribute or a list upload column: the attribute name or the column's header. Letters, digits and underscores. | Completes the path: the tag reads that one attribute or column. A key that does not match the upload's header leaves the tag to its default. |
| Static Value | For Static value: the text itself. Required. | Every recipient gets this same text. Change it here and every later send carries the new text, for example a new offer's end date. |
| Type | Text, Number, Date, Yes / No. Default Text, or the data point's own type. | Describes the value for whoever picks the tag. This form sets no number or date pattern, so numbers and dates go out as stored; a true or false value goes out as Yes or No. |
| Default Value | Optional. | What a recipient whose value is empty sees, for example *Member*. Without a default, an empty value leaves the tag empty in the message. |
| Sample Value | Optional. | Shown beside the tag in the picker, in the designer's preview with sample values, and in every test send instead of a real person's value. Without one, test sends show the tag empty or its default. |
| Offered In | Email, E-Receipt, SMS, MMS checkboxes; all ticked for a new tag. At least one. | Which editors offer the tag in their picker; a tag ticked for SMS is offered in the WhatsApp editor too. It does not stop a tag typed by hand from being filled in. |
| Description | Optional, one line. | Shown as the tip on the tag in the picker, and found by the picker's search. |

## How to

**Add a tag from an upload column.** Add Tag → key `loyalty_tier`, label *Loyalty Tier* → Reads From: List upload → the upload-column data point → Key: the column's header → Default: *Member* → Sample: *Gold* → Add Tag. Upload lists with that column; every template can use the tag.

**A tag for one campaign's offer.** A static tag `offer_ends` with the date as its Static Value; Edit it with the next date for the next campaign.

## What happens behind the scenes

At send time each tag is filled for each recipient: from its source in the catalogue; if that is empty, from the list member's uploaded column of the same name; then from the customer's attribute of that name; then the tag's default. Test sends and previews use the sample values instead. A tag a template uses that is not in the catalogue is a finding on save. When the platform team changes a platform tag, every workspace's copy follows; a workspace tag with the same key is left alone.

## Things to know

- The coupon tags (`coupon_code`, `coupon_barcode_value`, `coupon_qr_value`) feed the designer's Barcode and QR Code blocks from list columns of the same names.
- Removing a tag does not change saved templates; they keep the token and the designer reports it as unknown.
- A tag key cannot be renamed: add a new tag, change the templates, then remove the old one.
