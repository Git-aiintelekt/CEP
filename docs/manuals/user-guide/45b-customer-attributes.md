# Customer Attributes

**Where:** Settings → Engagement → Customer Attributes (under Audience).

## What this page is for

Your workspace's own customer fields: a points balance, a tier end date, a favourite store, a last online order. Each one says where its value comes from (a table of your CRM, a file, or another system that sends values), how fresh it is, and how many people have one. Templates use them through tags: `{{points_balance}}` is filled with each person's own balance.

The values are kept per customer and per source system. iCRM today and another system tomorrow plug into the same place: a new system is a new source, never a change to C360.

A workspace that has not added any sees *No customer attributes yet*: tags keep reading the customer record and the list, as before.

## Who can use it

| | |
|---|---|
| Permission | Anyone can look. Adding, changing or removing attributes and sources, and **Sync Now**, need **Manage Customer Attributes** (`attribute.edit`); Workspace Admin has it. **Fill From Database** on a campaign needs `list.edit`. |

## The fields and controls

### Attributes

| Column or control | What it is | What it changes |
|---|---|---|
| Attribute | The label, its key (what tags use), *Personal* when it is personal data, *Off* when it is switched off. | |
| Type | Text, Number, Date or Yes or No; *List* when the value belongs to one list entry. | How values are kept: a number as a number, a date as a date. |
| Comes From | The source, with its table and column (a database), the field name (the API), or *A file column, kept with each list entry*. *Nowhere yet* when it has no source. | |
| Refresh | Nightly, On Import or On Change. | When the value is read again (see *How values arrive*). |
| People With a Value | How many people have one, over every source. Counted again every five minutes. | |
| Used By | The tags that read it. | An attribute a tag reads cannot be removed: change the tag first. |
| Add Attribute | Opens the form below. | |
| Edit / Remove | On each row. Remove asks first; the values already kept stay until a source writes them again. | |

### Add Attribute

| Field | What it is | What it changes |
|---|---|---|
| Label | Up to 120 characters, e.g. *Points Balance*. | What people see. |
| Key | Filled from the label (`points_balance`); lower-case letters, digits and underscores. A key C360 fills itself (first_name, email, party_id and the like) is refused. | What tags use. Fixed once saved. |
| Type | Text, Number, Date, Yes or No. | How a value read is kept: *1,240* becomes the number 1240, a date time becomes the date. |
| Belongs To | **The Customer** (one value a person, used by every campaign) or **One List Entry** (a value for one upload, such as an offer code: kept with each list entry). | |
| Comes From | One of your sources, or *Nowhere Yet*. | |
| Field | For a database source: the column to read, from the source's table (its first values are shown as a sample). For the API: the name the other system sends (empty: the key). For a file: the column, optional. | |
| Refresh | For a database: **Nightly** (every customer, every night) or **On Import** (the people of each upload that uses it). For the API: On Change. For a file: On Import. | |
| Default Value | Optional, up to 500 characters. | What a person without a value gets when the tag has no default of its own. |
| Personal data | Left out of exports unless asked, removed with the person. | |
| Make a tag that reads it | On a new attribute, ticked: adds the tag `{{key}}` (Settings → Tags, Reads From *Customer attribute*) unless a tag with that key exists. | Templates can use it at once. |

### Sources

| Column or control | What it is | What it changes |
|---|---|---|
| Source | Its name, the Report Database it reads (or its kind), and how many attributes read it. | |
| Kind | Report Database, API or File. | |
| Matches People By | A database: *TABLE · ID column → SYSTEM ID*. The API: the system's own ID, sent with each value. A file: the list's own matching. | |
| Last Sync | What read it last (Nightly, Sync Now, an upload, Fill From Database, an API push), when, and how many people were read and matched; the reason when it failed; *Waiting to be read* or the progress while it runs. | |
| Sync Now | On a database source with at least one attribute. | Reads every customer C360 can match, in the background. |
| Add Source | Name; **System**, its short name (ICRM, SHOPIFY); **How Values Arrive**: Report Database, API or File. For a Report Database: the database (MySQL or PostgreSQL, from Settings → Report Databases), the table or view, and the **ID Column** that holds the person's ID in that system. | A source's kind is fixed once saved. |
| Remove | Asks first. | The values it brought go with it. Its attributes keep their definitions and read nothing until they get another source. |

## How values arrive

**A Report Database, nightly.** Every night (the hour is the platform's: 02:00 UTC unless changed) C360 reads the source's table for every customer it can match, a batch of 1,000 IDs per query, on a read-only connection. The values read replace that source's values for each person; other sources' values are not touched.

**A Report Database, when a list comes in.** The upload's Tag Values step, and Fill From Database on a campaign, read the attributes for just those people. What is read is also kept with each customer, so the next campaign has it too.

**The API.** The other system sends `POST /api/v1/customer-attributes/values/` with an API key that has the scope `attributes:write` (Settings → API Keys): `{"system": "SHOPIFY", "people": [{"id": "the person's ID in that system", "values": {"last_order": "2026-11-20"}}]}`, up to 1,000 people a call. The workspace needs an API source for that system; each field needs an attribute that reads it. The answer says how many people were matched, how many C360 did not know, and which fields no attribute reads.

**How people are matched.** By their ID in the source's system, which C360 remembers once it has seen it. For the CRM (system ICRM) C360 also uses the IDs it already keeps: the Party ID an upload or Look Up in C360 brought, or the C360 ID itself for people synced from C360.

## What happens at send

A tag gets each person's value in this order:

1. **The list entry**: a value kept with the person on the list (a column of the uploaded file, a Tag Values choice, Fill From Database).
2. **Customer attributes**: the attribute the tag reads, or the attribute with the tag's own key. When two sources have it, the one read most recently wins.
3. **The customer record**: names, and the customer's own extra fields.
4. **The default**: the tag's default value, else nothing.

## Things to know

- An attribute never stops a send: a value that cannot be read leaves the tag to its default.
- A Report Database is only ever read, with the account it connects as.
- Values that belong to one upload (an offer code for this campaign) stay on the list entry, not with the customer.
- *Read live at send* (a value of the minute, read while the campaign sends) is not built: values are as of the last read.
- Insights and segments do not use attributes yet.
