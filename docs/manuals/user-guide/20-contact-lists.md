# Contact Lists

**Where:** Contact Lists in the main navigation, and **Contact Lists → Uploads**.

## What this page is for

A contact list is a reusable audience: the people a campaign is sent to. Lists come from a file you upload, from an audience your data team defined in the BI tool, or from a copy of another list. A campaign never reads a list while it sends: when a run starts, the attached lists are merged into the campaign's own frozen copy, so you can change a list at any time without changing a send that was already built.

The page shows every list of the workspace with its size and where it is used, and starts the wizard that creates one.

## Who can use it

| | |
|---|---|
| Permission | `list.view` to see lists and their people; `list.edit` to create, edit, clone, archive and delete; `list.import` to upload a file; `consent.edit` to approve or refuse a list that waits for approval. |
| Features | Always on. A list *for texts* only matters when the workspace has the **sms** feature. |

## The fields and controls

### The page

| Control | What it is | What it changes |
|---|---|---|
| Total Lists, Total Contacts, Attached to Live Campaigns | The counts for the workspace: lists, distinct people across them, and lists attached to a campaign that is published to production or sending now. | Nothing; a reading. |
| Search | Filters the table by name as you type. | |
| Type | Production or Test. | A campaign published to production refuses a Test list. Keep real sends and rehearsals apart with it. |
| Source | Upload, BI or Extraction, Cloned. | |
| Uploads | Opens the Uploads page: every file upload of the workspace with its progress, who started it, Continue, Cancel and its report. | |
| Create List | Opens the wizard. | |
| The table | Name and description; **For** (Email, Texts, Email and Texts); the number of people; the source; the type; how many campaigns it is attached to and how many of those are live; when it changed. A note under the name when the list waits for approval or was refused. | |
| Row menu | **Open** the list, **Clone** it (asks for the copy's name), **Delete** it. | Delete is refused while the list is attached to a campaign: archive it from its page instead. Deleting removes its people from the list, never from C360. |

### The wizard: Upload a File

| Step | Field or control | What it is | What it changes |
|---|---|---|---|
| New Contact List | Upload a File / BI or Extraction Tool / Clone a List | Where the people come from. | The steps that follow. |
| Add Your File | List Name | The list's name, up to 200 characters. | How it is listed everywhere, including a campaign's Send To table. |
| | Description | Optional. Shown under the name in the table. | |
| | What the List Is For | Email, Texts, or Email and Texts. | Which column the file must have (an email address, a mobile number, or both), how a new person is recognised, and how each row is judged (email consent and address status, or text consent and the number's standing). Changed later on the list's Edit Details. |
| | Type | Production or Test. | See Type above. |
| | CSV File | The file: CSV only, up to 50 MB and 250,000 rows, comma, semicolon, tab or pipe separated, UTF-8 or Windows-1252. **Download Sample CSV** gives a file with the recognised columns in the right shape. | The file is stored privately, read in the background and deleted as soon as its rows are staged. |
| Match Your Columns | One choice per column of the file | What each column means: Email, Mobile number, First name, Last name, Postal code, Loyalty ID, Loyalty tier, Last order date, Time zone, Email consent date, Text consent date, or *keep as a custom value*. C360 guesses from the headers; confirm or correct. | The required column must be matched. A consent date column becomes an opt-in for people C360 has no answer for. Any other column is kept on the person's list entry under its header and can be used as a tag in a template (coupon columns feed the barcode and QR code blocks). Time zone is the person's own, an IANA name such as America/Chicago; journeys that wait until a time of day use it, and a name that is not recognised is left out. |
| Where Did These People Agree? | Consent Basis | Signed up on our website or app; Enrolled in store or in the loyalty programme; Asked us directly; Existing customers under implied consent. A bought or rented list is not allowed. | Recorded on every consent written from the file and on the list's compliance record. A Texts or Email-and-Texts list cannot use implied consent: marketing texts need an express opt-in. |
| | Where the Consent Was Collected | Optional, up to 300 characters: a form name, a store, a campaign. | Kept as the evidence, so the proof can be found later. |
| | The attestation | A sentence the uploader confirms in their own name, worded by the workspace (Settings → Consent Policy). | The import cannot be applied without it. Who confirmed it, and when, is kept. |
| Review Before Importing | The report | How many rows will be imported and how many are held back (no address, not a valid address, the same address earlier in the file, and under a strict policy, no consent date); how many people are new to C360 and how many it already knows; and how the imported people would be judged by a marketing send today: can receive, unsubscribed, bounced, complained, blocked, invalid, suppressed, no consent on record. | Nothing yet. **Import** starts the import; **Continue in the background** closes the wizard and leaves it running. |
| List Created | Where the list is, and what to do next. | | |

The other two sources are shorter: **BI or Extraction Tool** asks for the audience (the list then follows the audience: who leaves is removed and who joins is added, hourly and on *Refresh now*), **Clone a List** asks for the list to copy and the copy's name.

### The Uploads page

| Control | What it is | What it changes |
|---|---|---|
| The list of uploads | Newest first: file, list, who started it, status and progress. | |
| Continue | Opens the wizard again at the step an upload is waiting on (matching, consent, review). | |
| Cancel | Stops an upload that has not been applied. | The file and the staged rows are discarded. An import that is already adding people finishes. |
| Report | The review figures of any upload that was checked, and **Download the row-by-row report**: a CSV with every line of the file, whether it was imported or held back and why, how the person was recognised, and their marketing email status. | |
| Open the list | | |

The upload button in the header shows the uploads running on every page and raises an alert when one finishes, fails, or waits for a review.

## How to

**Upload a file.** Contact Lists → Create List → Upload a File → name the list, say what it is for, choose Production or Test, add the file. Match the columns and confirm. Say where the people agreed and confirm the attestation. Read the review, then Import. The list is a draft until the import is applied; leaving the wizard before that deletes the draft.

**Prepare a file that imports cleanly.** Use Download Sample CSV as the model: a header row, one person per row, dates as `YYYY-MM-DD`, mobile numbers with the country code (`+14045550101`). Put an email consent date and a text consent date in for everyone who gave one: without a date, a new person has no consent on record and marketing sends leave them out.

**Keep a do-not-contact list first.** Before the first upload, import the people who opted out elsewhere under Settings → Suppressions. Then no upload can ever reach them.

**Approve a list that waits.** When the workspace's Consent Policy asks for approval before the first send, a fresh upload sets its list to *awaiting approval* and every campaign holds its people back as *in a list awaiting approval*. Someone with `consent.edit` opens the list and presses Approve, or Refuse with a note.

**Reuse a list on several campaigns.** Attach it in each campaign's Send To step. The list's page names every campaign it is on, and warns before an edit when one of them is live.

## What happens behind the scenes

1. **The file is stored and queued**, never processed inside your request. Reading, checking and importing run in the background, in chunks, at most a few uploads at a time across the whole platform and never two of the same workspace at once, so one large file cannot slow everyone down. The page keeps showing progress; a hidden browser tab stops asking.
2. **Reading** stages every row and guesses the columns from the headers.
3. **Checking** holds back rows without a usable address, rows whose address appears earlier in the file, and, under a strict policy, rows without a consent date. Everyone else is matched to a person C360 knows (by loyalty ID first, then by address or number) or marked as new. Each importable row is judged exactly as a marketing send would judge that person today, with the send engine's own rules, so a word means the same at upload and in a campaign's results.
4. **The declaration** is recorded: the basis, where it was collected, who attested and when.
5. **Importing** creates the new people, adds everyone with a usable address to the list (whatever their status: people resubscribe, addresses get unblocked, and the send engine decides again for real at every run), writes an opt-in for a consent date only where C360 had no answer, and never overrides an unsubscribe. The list becomes active; under an approval policy it waits for approval first.
6. **The compliance record** on the list's page shows, for as long as the list exists: the source, every upload with its declaration, the approval, the policy as it stands today and today's consent by channel.

## Things to know

- Uploading someone does not give consent. Only a consent date in the file, a sign-up through a C360 form or a preference page, or a record from your other systems does.
- The review's numbers add up: rows in the file = held back + ready; ready = added + already in the list. The row-by-row report is the audit trail of an upload.
- Lists are never deleted while a campaign uses them; archive instead. People are never deleted from C360 by a list action.
- A Test list cannot go to production. Make the real list a Production one from the start, or clone it.
- Excel files are not accepted; save as CSV first.

## The customer page

**Where:** **Find a Customer** on the Contact Lists page (`/customers`); a customer's name on a journey's Customers card, on Settings → Events and on a list's members opens their page directly.

One customer across the workspace, read from the records C360 syncs (or an upload added). Nothing is edited here: the record is C360's.

| Part | What it shows |
|---|---|
| Header | The name, the customer id, where the record came from and when it was last updated, and a tag per channel saying whether they can receive marketing (Email: Can receive; SMS: No consent). |
| Record | Email addresses, phone numbers and the address, as the record holds them. |
| Consent | Per channel: the consent status, whether they can receive and why not, when they opted in or out and how, and any suppression. This is the verdict the send engine uses. |
| Custom Attributes | Every field C360 sent with the record (loyalty tier, home store, time zone, dates), which conditions, splits, date entries and time-of-day waits read. |
| Journeys | Every journey they entered, with where they are now, whether they converted and **View Timeline**, which opens their timeline on the journey's page; and the journeys they are kept out of by a suppression. |
| Events | The last 50 events received for them, with their data. |
| Orders | The last 20 orders Attribution received, and the campaign each was credited to. |
| Messages | The last 30 messages campaigns and journeys sent them, with what became of each (delivered, opened, clicked, or why it was not sent). |
| Contact Lists | The lists they are on and how they got there. Lists a journey makes for its own sends are left out. |

**Finding a customer.** Type part of a name, an email address, a mobile number (digits only are fine) or a customer id. A customer who is not in the records does not appear: C360 has to sync them, or an upload has to add them, before C360 can reach them.

Who may see it: anyone who may see contact lists, campaigns or journeys.
