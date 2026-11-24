# Contact Lists

**Where:** Contact Lists in the main navigation; a list's own page (click its name); **Contact Lists → Uploads**; and **Contact Lists → Find a Customer**.

## What this page is for

A contact list is a reusable audience: the people a campaign is sent to. Lists come from a file you upload, from a file of Customer IDs that C360 looks up in your CRM (**Look Up in C360**), from an audience your data team defined in the BI tool, or from a copy of another list. A campaign never reads a list while it sends: when a run starts, the attached lists are merged into the campaign's own frozen copy, so you can change a list at any time without changing a send that was already built.

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
| Find a Customer | Opens the customer search (see *The customer page* below). | |
| Uploads | Opens the Uploads page: every file upload of the workspace with its progress, who started it, Continue, Cancel and its report. | |
| Create List | Opens the wizard. | |
| The table | Name and description; **For** (Email, Texts, Email and Texts); the number of people; the source; the type; how many campaigns it is attached to and how many of those are live; when it changed. A note under the name when the list waits for approval or was refused. | |
| Row menu | **Open** the list, **Clone** it (asks for the copy's name), **Archive** it (**Restore** on an archived list), **Delete** it. | Archive: campaigns can no longer pick the list; Restore makes it active again. Delete is refused while the list is attached to a campaign: archive it instead. Deleting removes its people from the list, never from C360. |

### A list's page

Opened by a list's name. It shows who is in the list, how and when each was added, where the list is used, and the ways to fix it.

| Control | What it is | What it changes |
|---|---|---|
| Header | The name and description, the Type (Production or Test), the source, Archived when it is, and where an audience or a copy came from. | |
| Refresh Now (a list that follows an audience) | Brings the list in line with its audience at once, instead of at the hourly refresh, and says how many were added and removed. | People who no longer qualify leave; people who now qualify join; contacts added by hand stay. |
| Clone | Asks for the copy's name and opens the copy. | A new list with the same people today; the two change separately from then on. |
| Edit Details | **List Name** (required, up to 200 characters), **Description**, **List Type** (Production or Test) and **What the List Is For** (Email, Texts, or Email and Texts). | List Type: a Test list is for test sends only, and publishing a campaign to production with it attached is refused. What the List Is For: which column a later upload must have (the address for email, the mobile number for texts, both for both). |
| Add Contacts | **Email Addresses**: one per line, optionally followed by first and last name after commas (`ana@example.com, Ana, Lopez`); up to 500 at a time. | Adds them to this list and says how many were added, new to C360, already in the list, or not valid and skipped. Someone C360 knows is linked to their record; anyone new is added to C360 without a consent answer, so marketing sends leave them out until they opt in. Not offered on an archived list. |
| The note on editing | Says whether the list is attached to live campaigns. | A change here is picked up the next time a campaign builds its Campaign List from it; a Campaign List that was already built does not change. |
| Contacts, Added This Week, Attached Campaigns | The counts. | Nothing; a reading. |
| Attached Campaigns | Each campaign the list is on, with its channel, status, Live, and how many Campaign Lists were already built from it. | The name opens the campaign. |
| Approval | Shown when the workspace's Consent Policy asks for approval before the first send: Awaiting Approval, Approved or Refused, with who decided, when and their note. Someone with `consent.edit` writes an optional **Note** (up to 300 characters, kept on the compliance record) and presses **Approve List** or **Refuse**. | Awaiting: campaigns can be built with the list, but none sends to it. Approved: campaigns can send to it. Refused: no campaign sends to it until it is approved. |
| Compliance Record | The source, the consent basis, where it was collected, who attested and when, the approval and the consent policy today; **Consent today** per channel (opted in from the file, confirmed since, no consent on record, unsubscribed). **Show Details** adds the attestation wording and every upload with its figures. | Nothing; the record. The consent figures are rebuilt each time the page opens; the attestation and the approval never change. |
| Governance Check · Marketing Email, as of Today | How many of the list's people a marketing email could reach today, with the reasons the others cannot. | Nothing; a reading, with the send engine's own rules. Transactional campaigns ignore consent, but not blocked or invalid addresses. |
| Search contacts, Consent | Filter the people by name, email address or customer id, and by their marketing-email verdict: Can Receive, Cannot Receive, Unsubscribed, No Consent on Record, Bounced, Complained, Blocked, Invalid Address, Suppressed. | The table below. |
| The people | 50 a page: Email (opens the customer's page when C360 knows them), First Name, Last Name, Added On, Source (Upload, Manual, Audience, Cloned, Rule) and Marketing Email (Can Receive, or why not). A box per row, and one for the whole page. | |
| Export All / Export Selected | A CSV of everyone in the list, or of the ticked people: email, first name, last name, mobile, the day added, the source and the customer id. | Nothing changes. Cells that a spreadsheet would read as a formula are made safe. |
| Remove from List | Takes the ticked people out, after asking. Not offered on an archived list. | They leave this list only; they stay in C360 and in every other list. On a list that follows an audience, someone who still qualifies comes back at the next refresh. |

### The wizard: Upload a File

| Step | Field or control | What it is | What it changes |
|---|---|---|---|
| New Contact List | Upload a File / Look Up in C360 / BI or Extraction Tool / Clone a List | Where the people come from. Look Up in C360 is offered only when a Report Database is ticked *Use for List Generation* (see *The wizard: Look Up in C360* below). | The steps that follow. |
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

### The wizard: Look Up in C360

For a list you have as IDs only: the file holds one Customer ID (or Lead, Account or Contact ID) per row, and C360 reads each person from your CRM: name, mobile number, email, postal code, loyalty ID, time zone and whether they may be contacted. The CRM is one of the workspace's Report Databases ticked **Use for List Generation** (Settings → Report Databases); it is only ever read. Five steps: List Details, the IDs, Consent, Review, Done. There are no columns to match.

| Step | Field or control | What it is | What it changes |
|---|---|---|---|
| List Details | Look Up in C360 | The card beside Upload a File. Shown only when at least one database is ticked for list generation. | Opens the two choices below on the same step. |
| | Look Up In | Shown when more than one database is offered: tick one or more. They are searched in the order ticked (the number beside each says its turn); the first that has the ID supplies the person. With one database, it is used without asking. | Where each ID is read from. |
| | Role | Customer, Lead, Account, Account Primary Contact, or Any Role (Party ID). | Only people who hold the role in the CRM are imported; the others are held back as *Not a Customer* (and so on). It also names the IDs everywhere in the wizard: Customer ID, Lead ID, Account ID, Contact ID, or Party ID for any role. |
| | List Name, What the List Is For, List Type, Description | As for Upload a File. | What the List Is For decides the rules below: a texts list needs a usable mobile number, an email list a usable address, both lists both. |
| Customer IDs (the step is named after the role) | *Add your Customer IDs. C360 looks each one up and brings the rest of the person with it.* | The file: CSV only, up to 50 MB and 2,000,000 IDs, a header row and one ID per row. The ID column is the only column, or one named Customer ID, Party ID, Account ID, Lead ID or Contact ID; other columns are ignored. **Download Sample CSV** gives a one-column file with the right header. | The file is stored privately and read in the background; the lookup starts as soon as it is read. |
| Consent | As for Upload a File. | The consent dates come from C360: *Allow Solicitation* Y on the number or address is an opt-in, dated by the solicitation change date (or the day it was linked), for people C360 has no answer for. | You can answer while the lookup runs. |
| Review | **Looked Up in C360**, first | The databases and the role, how many IDs in how long; **Found in C360**; each reason rows were **Held Back**, with its count; each **Warning**. Then **Filled From C360**: how many of the usable people came with a name, mobile number, email, loyalty ID, postal code, time zone, text consent and email consent. | Nothing yet. The usual review follows (new, existing, warnings, errors, the governance check) and **Create List** imports. |

Why a row is held back (for a texts list; an email list checks the email address the same way):

| Reason | What C360 found |
|---|---|
| *Customer ID not found* | No person with that ID in any of the databases. |
| *No Customer ID in this row* | The ID cell is empty. |
| *Same ID as line N* | The ID appears earlier in the file. |
| *Disabled in the source database* | The party is disabled in the CRM. |
| *Not a Customer* (or the role chosen) | The party does not hold the role. |
| *No primary phone* | No current primary phone in the CRM. |
| *Number no longer in use* | The primary phone's end date has passed. |
| *Number not valid* | Marked not valid in the CRM, or not 10 digits. |
| *On Do Not Disturb* | The number is on DND. |
| *Phone not open to solicitation* | Allow Solicitation is N, and the party is not a Customer. |
| *No email*, *Email not valid*, *Email not open to solicitation* | The same checks on the primary email, for an email list. |

A **Customer** whose number is not open to solicitation is still imported, with the warning *Customer not open to solicitation: imported with no text consent*: transactional texts reach them, marketing texts hold them back.

The other two sources are shorter: **BI or Extraction Tool** asks for the audience (the list then follows the audience: who leaves is removed and who joins is added, hourly and on *Refresh now*), **Clone a List** asks for the list to copy and the copy's name.

### The Uploads page

| Control | What it is | What it changes |
|---|---|---|
| The table | Newest first: **List and File** (the list, the file and its rows; for a lookup, its IDs and *Looked up in* the databases), **Status** (In Progress, Waiting for You, Imported, Failed, Cancelled), **Progress** (what the upload is doing, with a bar while it works, and under it the count and the time left: *1,234,000 of 1,320,000 Customer IDs looked up · about 6 min left*) and **Uploaded** (when, and who). | |
| Continue | On an upload waiting for you (matching, consent, review). Needs `list.import` or `list.edit`. | Opens the wizard again at the step it waits on. |
| Report | On any upload that was checked: the review figures, and **Download the Row-by-Row Report**, a CSV with every line of the file, whether it was imported or held back and why, how the person was recognised, and their marketing email status. | Nothing changes. |
| Open the List | On an imported upload. | Opens the list's page. |
| Cancel | On an upload that is not finished and not already adding people. Needs `list.import` or `list.edit`. | The file and the staged rows are discarded. An import that is already adding people finishes. |

The upload button in the header shows the uploads running on every page, with the same count and time left, and raises an alert when one finishes, fails, or waits for a review. A large upload (1,000,000 rows or more unless the platform team set another size) also emails the person who started it when it has been checked, when it is imported and if it fails, so they can leave it running and come back. The time left is worked out on the page from the progress it sees: it shows after a few seconds of each step, and starts again when the step changes (reading, looking up, checking, adding).

## How to

**Upload a file.** Contact Lists → Create List → Upload a File → name the list, say what it is for, choose Production or Test, add the file. Match the columns and confirm. Say where the people agreed and confirm the attestation. Read the review, then Import. The list is a draft until the import is applied; leaving the wizard before that deletes the draft.

**Make a list from Customer IDs.** Contact Lists → Create List → Look Up in C360 → tick the databases (when there are several) and choose the role → name the list, say what it is for, choose Production or Test → Next → add the file of IDs. Answer the consent questions while C360 looks the IDs up. Read **Looked Up in C360** at the top of the review, then Create List. A large file can be left running: Continue in the Background, and come back from the Uploads page or the email.

**Check a lookup before a big one.** Try a file of 20 IDs first and compare what *Filled From C360* and the held-back reasons say with the CRM; then send the full file.

**Prepare a file that imports cleanly.** Use Download Sample CSV as the model: a header row, one person per row, dates as `YYYY-MM-DD`, mobile numbers with the country code (`+14045550101`). Put an email consent date and a text consent date in for everyone who gave one: without a date, a new person has no consent on record and marketing sends leave them out.

**Keep a do-not-contact list first.** Before the first upload, import the people who opted out elsewhere under Settings → Suppressions. Then no upload can ever reach them.

**Approve a list that waits.** When the workspace's Consent Policy asks for approval before the first send, a fresh upload sets its list to *awaiting approval* and every campaign holds its people back as *in a list awaiting approval*. Someone with `consent.edit` opens the list and presses Approve, or Refuse with a note.

**Reuse a list on several campaigns.** Attach it in each campaign's Send To step. The list's page names every campaign it is on, and warns before an edit when one of them is live.

## What happens behind the scenes

1. **The file is stored and queued**, never processed inside your request. Reading, checking and importing run in the background, in chunks, at most a few uploads at a time across the whole platform and never two of the same workspace at once, so one large file cannot slow everyone down. The page keeps showing progress; a hidden browser tab stops asking.
2. **Reading** stages every row and guesses the columns from the headers.
3. **Checking** holds back rows without a usable address, rows whose address appears earlier in the file, and, under a strict policy, rows without a consent date. Everyone else is matched to a person C360 knows (by loyalty ID first, then by address or number) or marked as new. Each importable row is judged exactly as a marketing send would judge that person today, with the send engine's own rules, so a word means the same at upload and in a campaign's results.
4. **The declaration** is recorded: the basis, where it was collected, who attested and when.
For a file of IDs (Look Up in C360), a **lookup** comes between reading and checking: the IDs are read from the CRM 1,000 at a time, on a read-only connection, one upload at a time per workspace, so the CRM barely notices. A worker that stops carries on from the last batch it finished. The ID then becomes the person's key in C360: someone C360 already has under that ID is recognised by it first, a new person is created under it, and someone recognised by address or number gets the ID added, so the next file finds the same people.

5. **Importing** creates the new people, adds everyone with a usable address to the list (whatever their status: people resubscribe, addresses get unblocked, and the send engine decides again for real at every run), writes an opt-in for a consent date only where C360 had no answer, and never overrides an unsubscribe. The list becomes active; under an approval policy it waits for approval first.
6. **The compliance record** on the list's page shows, for as long as the list exists: the source, every upload with its declaration, the approval, the policy as it stands today and today's consent by channel.

## Things to know

- Uploading someone does not give consent. Only a consent date in the file, a sign-up through a C360 form or a preference page, or a record from your other systems does.
- The review's numbers add up: rows in the file = held back + ready; ready = added + already in the list. The row-by-row report is the audit trail of an upload.
- Lists are never deleted while a campaign uses them; archive instead. People are never deleted from C360 by a list action.
- A Test list cannot go to production. Make the real list a Production one from the start, or clone it.
- Excel files are not accepted; save as CSV first.
- Look Up in C360 never writes to the CRM: it only reads, with the account the Report Database connects as.
- A lookup takes about a second or two per 1,000 IDs, depending on the network to the CRM; 1.3 million IDs take a few tens of minutes. The Uploads page shows the time left.

## The customer page

**Where:** **Find a Customer** on the Contact Lists page (`/customers`); a customer's name on a journey's Customers card, on Settings → Events and on a list's people opens their page directly.

One customer across the workspace, read from the records C360 syncs (or an upload added). Nothing is edited here: the record is C360's.

| Part | What it shows |
|---|---|
| Header | The name, the customer id, where the record came from and when it was last updated, and a tag per channel saying whether they can receive marketing (Email: Can receive; SMS: No consent). |
| Record | Email addresses, phone numbers and the address, as the record holds them. |
| Consent | Per channel: the consent status, whether they can receive and why not, when they opted in or out and how, and any suppression. This is the verdict the send engine uses. |
| Engagement | What Unengaged Contacts (Settings → Governance) sees for this person. **Last Engaged**: their last click, purchase or preference visit ("Never, in the kept history" when there is none). **Marketing Email**: Gets marketing email; a tag when they are left out (**Unengaged since 3 March 2027**), until they click, buy or visit the preference page; or No Unengaged Contacts rule applies. **Emails, 180 Days**: the marketing emails sent to them in the rule's period. |
| Custom Attributes | Every field C360 sent with the record (loyalty tier, home store, time zone, dates), which conditions, splits, date entries and time-of-day waits read. |
| Journeys | Every journey they entered, with where they are now, whether they converted and **View Timeline**, which opens their timeline on the journey's page; and the journeys they are kept out of by a suppression. |
| Events | The last 50 events received for them, with their data. |
| Orders | The last 20 orders Attribution received, and the campaign each was credited to. |
| Messages | The last 30 messages campaigns and journeys sent them, with what became of each (delivered, opened, clicked, or why it was not sent). |
| Contact Lists | The lists they are on and how they got there. Lists a journey makes for its own sends are left out. |

**Finding a customer.** Type part of a name, an email address, a mobile number (digits only are fine) or a customer id in **Search customers**; the results follow as you type, 25 a page, with the Customer, Email, Mobile, Customer ID, Source and when the record was Updated. The search stays in the page's address, so a link or the browser's Back returns to it. Click a name to open the customer. A customer who is not in the records does not appear: C360 has to sync them, or an upload has to add them, before C360 can reach them. On a customer's page, **Find Another Customer** goes back to the search; nothing on the page changes the record.

Who may see it: anyone who may see contact lists, campaigns or journeys.
