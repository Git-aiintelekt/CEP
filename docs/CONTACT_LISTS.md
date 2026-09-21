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

## 3. Uploading a file

CSV only, up to 50 MB and 250,000 rows; `,` `;` tab or `|`; UTF-8 (with or without BOM) or Windows-1252.

### 3.1 Built for large files and many workspaces (`apps/contact_lists/jobs.py`)

Reading, checking and importing 250,000 rows takes minutes. Done inside a web request that is a server thread and a
database transaction held for minutes, per upload, and a few workspaces doing it together would slow CEP down for
everyone. So **a request never processes a file**:

| | |
|---|---|
| The request | streams the file to private storage (it is never read into memory), reads the first 256 KB for the column names and sample values, queues the import and answers. Measured: 0.08 s for a 3.7 MB / 50,000-row file |
| The queue | the `contact_list_import` table itself (`next_action` = `STAGE`, `REVIEW` or `APPLY`). The database is the queue, as for campaign runs: nothing is lost when no broker is reachable |
| A claim | `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` under an advisory lock: any number of workers can run side by side, none takes the same job |
| Limits | at most `lists.import_max_parallel` imports at once in the **whole platform** (default 2); **never two of the same workspace at once**, so one busy workspace cannot take every slot and the others' uploads are claimed in between, oldest first; a workspace with `lists.import_max_waiting_per_workspace` unfinished uploads (default 5) gets a 409 until one finishes |
| Chunks | every step works `lists.import_chunk_rows` rows at a time (default 5,000), **each chunk its own short transaction**: no long locks, no huge transaction, constant memory, and progress after every chunk |
| Why not threads per chunk | the database is the bottleneck; parallel writers on one file would add exactly the load the limits contain. Chunks of a file run in order; the parallelism is *between* uploads, and bounded |
| Crashes | a worker sends a heartbeat with every chunk. A job whose heartbeat is 3 minutes old is claimed again, up to 3 attempts; the three steps can be run again safely (`ON CONFLICT DO NOTHING`, counted not summed). After that: `FAILED`, with a message, nothing half-imported |
| The file | private storage only (the workspace's private bucket prefix; locally `backend/imports/`, never the public media folder); **deleted as soon as its rows are staged** |
| Cancel | `POST .../cancel/`, or deleting the draft list: a worker that is on it stops at its next chunk; file and staged rows go. Adding contacts to the list (`APPLYING`) is not interrupted half-way |

Status: `UPLOADED` waiting to be read → `STAGING` → `STAGED` waiting for the mapping → `MATCHING` → `REVIEW` waiting for
the operator → `APPLYING` → `APPLIED` (or `FAILED` / `CANCELLED`). The mapping can be confirmed while the file is still
being read: the check then starts by itself.

**Who runs the jobs** (`LIST_IMPORT_RUNNER`):

| | |
|---|---|
| `celery` (production) | the API sends `workers.lists.process_imports` to the queue **`imports`**; beat repeats it every 30 s as a net. **The worker must listen to that queue**: `celery -A config worker -Q default,events,maintenance,campaign,email,sms,imports`. A dedicated queue means a big file never delays a campaign send |
| `thread` (development default, no Redis needed) | a daemon thread of the web process, started when something is queued |
| `none` | only `python manage.py process_list_imports [--loop]` does the work: a worker for a server without a broker; can run next to the others |

Measured on a laptop with a local database, one upload: 50,000 rows read + checked in 8 s and imported in 53 s; 100,000
rows in 29 s + 83 s. While it ran, other API calls took 0.03 to 0.39 s.

**What the operator sees.** The wizard moves on as soon as the file is received (columns can be matched while it is
read) and shows the progress of each background step. **Continue in the background** closes it and leaves the job
running. The upload button in the header shows what is running with its progress on every page, and raises an alert when
an upload finishes, fails, or has been checked and waits for a review (not for the step someone is watching in the
wizard). **Contact Lists → Uploads** lists the workspace's uploads: progress, who started them, *Continue* for one that
waits, *Cancel*, *Open the list*. A hidden browser tab stops asking, so idle tabs add no load.

### 3.2 The three steps (`apps/contact_lists/imports.py`)

1. **stage** – the stored file is read as a stream and staged in `contact_list_import_row` (`raw` = the row as
   received). Properties are guessed from the headers (`Email Address`, `Surname`, `Cell`, `ZIP`, ...).
2. **review** `{mapping}` – set-based SQL over the staged rows, a range of lines per transaction; can be repeated with
   another mapping. Who CEP already knows is put in an indexed temporary table once per job, instead of scanning the
   customer master for every range:
   * no address / not an address → **held back** (`REJECTED`)
   * the same address further down the file → **held back** (`DUPLICATE`, "Same email address as line N")
   * already known: by **loyalty ID** first, then by **email address** (`MATCHED`)
   * everyone else is **new** (`UNMATCHED`)
   * **warnings** on rows that *are* imported: a mobile number that is not recognised is left out; an unreadable date is left out
3. **apply** – a range of lines per transaction. New people become `customer_master` rows owned by CEP
   (`source_system = 'CEP_UPLOAD'`, `is_synced_copy = FALSE`, key `UPL-<hash of workspace + address>`); the list gets its
   members (`membership_source = 'UPLOAD'`); the list becomes `ACTIVE`. Staged rows that went in are deleted; the ones to
   look at (held back, warnings) are kept.

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
| `GET /contact-lists/imports/` | the workspace's uploads, newest first; `?active=true` = unfinished. Each: `status`, `phase`, `working`, `progress {done, total, percent, unit}`, `error`, counts | `list.view` |
| `POST /contact-lists/{id}/imports/` | multipart `file`. **201 at once**: stored and queued. 409 when the workspace has too many unfinished uploads | `list.import` |
| `GET /contact-lists/{id}/imports/{import}/` | poll this: progress, then `review` and `issues` | `list.view` |
| `POST /contact-lists/{id}/imports/{import}/review/` | `{mapping: {property: column}}` → **202**, checked in the background | `list.import` |
| `POST /contact-lists/{id}/imports/{import}/apply/` | → **202**, added in the background | `list.import` |
| `POST /contact-lists/{id}/imports/{import}/cancel/` | | `list.import` |

"Live" = a campaign in `PRODUCTION_PUBLISHED` or `ACTIVE`. `POST /campaigns/{id}/publish/` refuses a list that is
marked Test, archived, deleted or still a draft.

## 5. Schema

`database/patches/0012_list_upload_jobs.sql` (section 12): the queue on `contact_list_import` (`next_action`, progress, `heartbeat_at`, `worker`,
`attempts`, statuses `STAGING` / `STAGED` / `APPLYING` / `CANCELLED`) and the three `lists.import_*` global parameters.
`database/patches/0011_contact_list_module.sql` (layer 5, section 11): `source_type` gains `CLONE`, `status` gains
`DRAFT`, `membership_source` gains `CLONE`; `contact_list_import` gains `file_size`, `file_columns`, `column_mapping`,
`rejected_count`, `warning_count`, `applied_count`, `error`; `contact_list_import_row` gains `warning`.

## 6. Tests

* backend: `test_contact_lists.py` (37 checks, real database, rolled back): chunking, the limits per workspace and platform, a dead worker's job taken over, cancel, 20,000 rows
* frontend: `src/features/contact-lists/ContactLists.test.tsx` (10 tests against the mock API, whose worker takes time)
* live: `live_upload.py` pushes 50,000 to 100,000 rows through the running server and times other API calls meanwhile

## 7. Not in this version

* Excel files (`.xlsx`); adding to an *existing* list from a file (the endpoint accepts it, the screen does not offer it yet).
* Text-message consent from a file; per-list preferences.
* Row-level edit of a contact's name or address (the customer master is the record for that).
