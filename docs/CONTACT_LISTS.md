# Contact lists

A contact list is a reusable audience. A campaign never reads a contact list while it sends: at send time the attached
lists are merged into one **frozen campaign list** (one entry per customer). So a list can be attached to any number of
campaigns, and changing it never changes a send that was already built.

Interface reference: <https://cep-dashboard-tau.vercel.app/> → Contact Lists.

## 1. The twelve use cases and where they live

| # | Use case | Where |
|---|---|---|
| 1 | Create a list from a file | wizard, *Upload a file*: name → file → match columns → review → done |
| 2 | Create a list from BI / extraction | wizard, *BI or extraction tool*: pick an audience the data team defined (a C360 `segment`) |
| 3 | Create a list by cloning | wizard, *Clone a list*; also **Clone** in a row's menu and on the list page |
| 4 | Browse all lists | `/contact-lists`: totals, search, **Type** and **Source** filters |
| 5 | Inspect a list's contents | `/contact-lists/:id`: email, name, *added on*, *source* per contact; search; paging; CSV export |
| 6 | Fix a list after creation | **Add contacts** (by email address), **Remove from list**, **Edit details** (name, description, type) |
| 7 | Reuse a list across campaigns | campaign form → Audience: tick any number of lists; the list page names every campaign it is on |
| 8 | Build a list without leaving campaign setup | campaign form → Audience → **Create a list** opens the same wizard |
| 9 | Know what is safe to edit | the note at the top of the list page: live campaigns, and that a built Campaign List does not change |
| 10 | Keep test and real sends separate | list type **Production / Test**; publishing to production with a Test list attached is refused |
| 11 | Trust vetted data automatically | a list made in campaign setup from an audience or a clone is attached at once (`vetted: true`) |
| 12 | Double-check unvetted data | a list made there from an upload is **not** attached: a callout asks the operator to confirm |

## 2. Sources

| Source (table) | `source_type` | `list_kind` | `vetted` | Members |
|---|---|---|---|---|
| Upload | `UPLOAD` | `STATIC` | no | rows of the file, matched to known customers or created as new ones |
| BI / Extraction | `BI` (also `EXTRACTION`, `SEGMENT`) | `SEGMENT` | yes | the audience's people; follows the audience (job `refresh-audience-lists`, hourly per list; **Refresh now**) |
| Cloned | `CLONE` | `STATIC` | yes | a snapshot of the source list's members; `parent_contact_list` records where it came from |

A list made by the upload wizard is a **`DRAFT`** until its first import is added: drafts are hidden from the table and
from campaign pickers, and leaving the wizard deletes the draft with everything it staged.

## 3. Uploading a file (`apps/contact_lists/imports.py`)

CSV only, up to 50 MB and 250,000 rows; `,` `;` tab or `|`; UTF-8 (with or without BOM) or Windows-1252.

1. **read** – the file is parsed once and staged in `contact_list_import_row` (`raw` = the row as received). Nothing is
   kept of the file itself. Properties are guessed from the headers (`Email Address`, `Surname`, `Cell`, `ZIP`, ...).
2. **review** `{mapping}` – set-based SQL over the staged rows; can be repeated with another mapping:
   * no address / not an address → **held back** (`REJECTED`)
   * the same address further down the file → **held back** (`DUPLICATE`, "Same email address as line N")
   * already known: by **loyalty ID** first, then by **email address** (`MATCHED`)
   * everyone else is **new** (`UNMATCHED`)
   * **warnings** on rows that *are* imported: a mobile number that is not recognised is left out; an unreadable date is left out
3. **apply** – new people become `customer_master` rows owned by CEP (`source_system = 'CEP_UPLOAD'`,
   `is_synced_copy = FALSE`, key `UPL-<hash of workspace + address>`); the list gets its members
   (`membership_source = 'UPLOAD'`); the list becomes `ACTIVE`.

**Consent.** Uploading someone does not give consent. When a *Consent date* column is mapped, a valid date that is not
in the future becomes an email opt-in (`consent_record`: `OPT_IN`, source `IMPORT`, evidence = file, line, date) **only
for people CEP has no consent answer for**. It never overrides an unsubscribe. Without it, new people have no consent
answer and marketing sends leave them out (`NO_CONSENT`), as for anyone else.

Properties: Email (required), First name, Last name, Mobile number, Postal code, Loyalty ID, Loyalty tier, Last order
date, Consent date. First / last name, postal code, tier and last order date are also kept on the membership
(`contact_list_member.custom_attributes`).

## 4. API (`api/v1/contact_lists_api.py`)

| | | Permission |
|---|---|---|
| `GET /contact-lists/` | `?search= &list_environment=TEST\|PRODUCTION &source=UPLOAD\|BI\|CLONE &status=` (drafts only with `status=DRAFT`); each row: `source_label`, `vetted`, `attached_campaigns`, `live_campaigns` | `list.view` |
| `POST /contact-lists/` | step 1 of the upload wizard: a `DRAFT` list | `list.edit` |
| `PATCH /contact-lists/{id}/` | name, description, type, `status` `ACTIVE` ↔ `ARCHIVED`; source and kind are fixed | `list.edit` |
| `DELETE /contact-lists/{id}/` | 409 while attached to a campaign (archive instead); members and staged rows go with it | `list.edit` |
| `GET /contact-lists/stats/` | lists, distinct people, lists attached to live campaigns | `list.view` |
| `GET /contact-lists/audiences/` | the workspace's audiences with today's size | `list.view` |
| `POST /contact-lists/from-audience/` | `{name, description, list_environment, audience}` | `list.edit` |
| `POST /contact-lists/{id}/clone/` | `{name, description, list_environment}` | `list.edit` |
| `POST /contact-lists/{id}/refresh/` | audience lists: who left is removed, who joined is added, contacts added by hand stay | `list.edit` |
| `GET /contact-lists/{id}/usage/` | campaigns, which are live, Campaign Lists already built, added this week | `list.view` |
| `GET /contact-lists/{id}/members/` | `?search= &source= &page= &page_size=` | `list.view` |
| `POST /contact-lists/{id}/members/` | `{contacts: [{email, first_name, last_name}]}` (up to 500): known people are linked, new ones created | `list.edit` |
| `POST /contact-lists/{id}/members/remove/` | `{ids}`; the people stay in CEP | `list.edit` |
| `GET /contact-lists/{id}/members/export/` | CSV; `?ids=1,2,3` for a selection; cells that a spreadsheet would run as a formula are neutralised | `list.view` |
| `POST /contact-lists/{id}/imports/` | multipart `file` | `list.import` |
| `POST /contact-lists/{id}/imports/{import}/review/` | `{mapping: {property: column}}` | `list.import` |
| `POST /contact-lists/{id}/imports/{import}/apply/` | | `list.import` |

"Live" = a campaign in `PRODUCTION_PUBLISHED` or `ACTIVE`. `POST /campaigns/{id}/publish/` refuses a list that is
marked Test, archived, deleted or still a draft.

## 5. Schema

`database/patches/0011_contact_list_module.sql` (layer 5, section 11): `source_type` gains `CLONE`, `status` gains
`DRAFT`, `membership_source` gains `CLONE`; `contact_list_import` gains `file_size`, `file_columns`, `column_mapping`,
`rejected_count`, `warning_count`, `applied_count`, `error`; `contact_list_import_row` gains `warning`.

## 6. Tests

* backend: `test_contact_lists.py` (26 checks, real database, rolled back)
* frontend: `src/features/contact-lists/ContactLists.test.tsx` (7 tests against the mock API)

## 7. Not in this version

* Excel files (`.xlsx`); adding to an *existing* list from a file (the endpoint accepts it, the screen does not offer it yet).
* Text-message consent from a file; per-list preferences.
* Row-level edit of a contact's name or address (the customer master is the record for that).
