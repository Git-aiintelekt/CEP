# CEP User Guide

For everyone who signs in to a workspace. Built from `docs/manuals/user-guide`; edit the chapters there, not this file.

## Contents

- Welcome to CEP
  - How the guide is organised
  - Help inside the app
  - Three ideas that run through everything
  - Statuses you will meet
  - Where to start
- Contact Lists
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know
- Sending Engines and Senders
  - What this page is for
  - Who can use it
  - The fields and controls
  - How to
  - What happens behind the scenes
  - Things to know

---

# Welcome to CEP

CEP is the Customer Engagement Platform: the place where a marketing team keeps its contacts, designs emails and texts, sends campaigns and reads what came back. This guide is for the people who sign in to a workspace: administrators who set it up, marketers who run campaigns, and anyone who reads the reports.

A second guide, the Platform Guide, is for the platform team who run the back-office: creating workspaces, plans, features and the platform's own settings. If you were invited to a workspace, you only need this one.

## How the guide is organised

Every page of the app has a chapter, and every chapter has the same shape:

- **What this page is for.** One paragraph on the job the page does.
- **Who can use it.** The permission a role needs, and the feature the workspace needs switched on.
- **The fields and controls.** A table of everything on the page: what each field or button is, and what it changes elsewhere in CEP. That is the part to read when a setting is unclear.
- **How to.** The everyday tasks, step by step.
- **What happens behind the scenes.** The business flow: what CEP does with what you entered, and where it shows up later.
- **Things to know.** The limits and the consequences worth remembering.

## Help inside the app

- **The help icon** beside a page's title opens that page's chapter in a panel, so the guide is one click away from the page it describes. Close it with the cross or the Escape key.
- **The small information icon** beside a field opens a note on that one field: what it is and what it affects.
- **The keyboard icon** in the header lists the keyboard shortcuts. Pressing `?` on any page does the same.

## Three ideas that run through everything

**Workspace.** Your company's own area of CEP. Everything you see belongs to one workspace: its users, roles, lists, templates, campaigns and settings. The workspace code (for example `NWA`) appears in the sign-in screen and in every address CEP gives you to register with other systems.

**Roles and permissions.** What a person may do is set by their role. A role is a set of permissions such as *campaign.edit* or *user.admin*. The chapter for each page names the permission it needs. If a page refuses you, it says which permission to ask an administrator for.

**Features.** Some parts of CEP are switched on per workspace by the platform team: texts, MMS, e-receipts, journeys, A/B testing, API access, the preference centre, barcodes. A page that belongs to a feature that is off is simply not shown, and its chapter says which feature to ask for.

## Statuses you will meet

| Status | Where | Meaning |
|---|---|---|
| Draft | campaigns, lists | Being prepared; nothing has been sent and nothing is live. |
| Test Published | campaigns | Published to test lists only. Production lists cannot be attached. |
| Production Published | campaigns | Published to real people; a scheduled run will go out. |
| Scheduled | campaigns | A production campaign with a run waiting for its time. |
| Active, Sending, Preparing | campaigns | Live right now: a run is building its audience or sending. |
| Completed | campaigns | The run finished. |
| Verified, Not Verified Yet, Verification Failed | senders | Whether a sender address or number has proven it can send. |

## Where to start

A new workspace begins at **Settings → Set-Up**: seven steps, each opening the page that does it, read from the workspace so the page always knows what is done. The chapters for those pages are the ones to read first: Users and Roles, Sending Engines, Suppressions, Contact Lists, Notifications and Approvals.

---

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
| Row menu | **Open** the list, **Clone** it (asks for the copy's name), **Delete** it. | Delete is refused while the list is attached to a campaign: archive it from its page instead. Deleting removes its people from the list, never from CEP. |

### The wizard: Upload a File

| Step | Field or control | What it is | What it changes |
|---|---|---|---|
| New Contact List | Upload a File / BI or Extraction Tool / Clone a List | Where the people come from. | The steps that follow. |
| Add Your File | List Name | The list's name, up to 200 characters. | How it is listed everywhere, including a campaign's Send To table. |
| | Description | Optional. Shown under the name in the table. | |
| | What the List Is For | Email, Texts, or Email and Texts. | Which column the file must have (an email address, a mobile number, or both), how a new person is recognised, and how each row is judged (email consent and address status, or text consent and the number's standing). Changed later on the list's Edit Details. |
| | Type | Production or Test. | See Type above. |
| | CSV File | The file: CSV only, up to 50 MB and 250,000 rows, comma, semicolon, tab or pipe separated, UTF-8 or Windows-1252. **Download Sample CSV** gives a file with the recognised columns in the right shape. | The file is stored privately, read in the background and deleted as soon as its rows are staged. |
| Match Your Columns | One choice per column of the file | What each column means: Email, Mobile number, First name, Last name, Postal code, Loyalty ID, Loyalty tier, Last order date, Email consent date, Text consent date, or *keep as a custom value*. CEP guesses from the headers; confirm or correct. | The required column must be matched. A consent date column becomes an opt-in for people CEP has no answer for. Any other column is kept on the person's list entry under its header and can be used as a tag in a template (coupon columns feed the barcode and QR code blocks). |
| Where Did These People Agree? | Consent Basis | Signed up on our website or app; Enrolled in store or in the loyalty programme; Asked us directly; Existing customers under implied consent. A bought or rented list is not allowed. | Recorded on every consent written from the file and on the list's compliance record. A Texts or Email-and-Texts list cannot use implied consent: marketing texts need an express opt-in. |
| | Where the Consent Was Collected | Optional, up to 300 characters: a form name, a store, a campaign. | Kept as the evidence, so the proof can be found later. |
| | The attestation | A sentence the uploader confirms in their own name, worded by the workspace (Settings → Consent Policy). | The import cannot be applied without it. Who confirmed it, and when, is kept. |
| Review Before Importing | The report | How many rows will be imported and how many are held back (no address, not a valid address, the same address earlier in the file, and under a strict policy, no consent date); how many people are new to CEP and how many it already knows; and how the imported people would be judged by a marketing send today: can receive, unsubscribed, bounced, complained, blocked, invalid, suppressed, no consent on record. | Nothing yet. **Import** starts the import; **Continue in the background** closes the wizard and leaves it running. |
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
3. **Checking** holds back rows without a usable address, rows whose address appears earlier in the file, and, under a strict policy, rows without a consent date. Everyone else is matched to a person CEP knows (by loyalty ID first, then by address or number) or marked as new. Each importable row is judged exactly as a marketing send would judge that person today, with the send engine's own rules, so a word means the same at upload and in a campaign's results.
4. **The declaration** is recorded: the basis, where it was collected, who attested and when.
5. **Importing** creates the new people, adds everyone with a usable address to the list (whatever their status: people resubscribe, addresses get unblocked, and the send engine decides again for real at every run), writes an opt-in for a consent date only where CEP had no answer, and never overrides an unsubscribe. The list becomes active; under an approval policy it waits for approval first.
6. **The compliance record** on the list's page shows, for as long as the list exists: the source, every upload with its declaration, the approval, the policy as it stands today and today's consent by channel.

## Things to know

- Uploading someone does not give consent. Only a consent date in the file, a sign-up through a CEP form or a preference page, or a record from your other systems does.
- The review's numbers add up: rows in the file = held back + ready; ready = added + already in the list. The row-by-row report is the audit trail of an upload.
- Lists are never deleted while a campaign uses them; archive instead. People are never deleted from CEP by a list action.
- A Test list cannot go to production. Make the real list a Production one from the start, or clone it.
- Excel files are not accepted; save as CSV first.

---

# Sending Engines and Senders

**Where:** Settings → Sending → Sending Engines.

## What this page is for

Nothing leaves CEP without an engine. An engine is the service that actually delivers your messages: a Postal or SendGrid account for email, Digivize for texts, your own mail server, or the Sandbox that sends nothing while you try things out. A sender is the name and address (or the number) your messages come from, on one of those engines. This page is where both are added, checked and kept healthy, and where the engine is told how to report deliveries back to CEP.

A campaign picks a sender when it is set up; the sender decides the engine. Until a workspace has a checked email engine and a verified sender, test sends work but nothing can be published to production.

## Who can use it

| | |
|---|---|
| Permission | `provider.edit`. Without it the page says so and names the permission to ask for. Settings as a whole needs `user.admin`. |
| Features | Email engines are always offered. Text engines (Digivize, Sandbox) need the **sms** feature; MMS needs **mms** as well. The platform team switches features on per workspace. |

## The fields and controls

### The engines table

| Control | What it is | What it changes |
|---|---|---|
| Provider | The engine's name, its channel tag (Email or Texts) and **Default** when it is the one new senders are offered first. Under it, the engine type and its address, and *separate key for receipts* when a second credential is stored. | Nothing by itself; it is the row's identity. |
| State | **Not Checked Yet** until the first Check; **Checked** with the date and time when the last Check passed; **Check Failed** when it did not; **Switched Off** when *In Use* is unticked. | Set-Up counts an email engine as done only when it reads Checked. A switched-off engine is skipped by every send. |
| Callbacks | **Copy Webhook URL** copies the engine's callback address, the address the provider must post delivery results to. **Rotate Address** makes a fresh address and retires the old one at once. Under them: when the last callback arrived and how many came in the last 24 hours, or a warning that none ever has. | Without a registered callback address CEP sends but never learns what happened: no delivered, bounced, opened or clicked counts, and bounced addresses are not blocked. Rotating means registering the new address with the provider again. |
| Check | Asks the provider to confirm the address and the credential without sending anything. With two keys on a Postal engine it checks both and names the one refused. | Sets State to Checked or Check Failed with the provider's own words. |
| Edit | Opens the engine's form. | |
| Remove | Deletes the engine after a confirmation. | Its senders are removed with it. A campaign that used one of them has to be given another sender before it can publish. |
| Add Engine | Opens the form for a new engine. | |

### The engine form (Add Engine, Edit)

| Field | What it is | What it changes |
|---|---|---|
| Engine | The engine type: *Email · Postal*, *Email · SendGrid*, *Texts · Digivize*, *Texts · Sandbox (sends nothing)*. The type is fixed once saved. *Email · SMTP (your mail server)* is not offered here: it is switched on from Settings → Email Server with *Offer this server as a campaign sender*. | Decides which fields follow, whether the engine reports callbacks, and the channel its senders belong to. |
| Name | How the engine is listed in this workspace, for example *Postal (marketing)* or *Texts (short code 55123)*. | Shown on every sender and in Set-Up. |
| The engine's own fields | What the type needs to connect. They are listed per type below. A field marked as a key or secret is write-only: once saved it is never shown again, and the form says *stored*; leave it empty to keep it, type a new one to replace it. | The credential and address CEP uses on every send. |
| Messages per Minute | An optional pace. Empty means as fast as the provider accepts. | Spreads a run over time. Use it when the provider has a rate limit or when a slow ramp is wanted for a new sending domain. |
| Default Engine for Email / Texts | One engine per channel is the default. | The one offered first when a sender is added. It does not change existing senders. |
| In Use | Whether the engine may send. | Unticked: State reads Switched Off and every send that would use it fails at once with that reason. Tick it again to resume. |

### Fields per engine type

**Postal**

| Field | What it is | What it changes |
|---|---|---|
| Postal Address | The base address of your Postal installation, for example `https://postal.example.com`. | Where every send and every Check goes. |
| Server API Key | Postal → your mail server → Credentials → type API. | Carries campaigns, and everything else until a transactional key is set. |
| Transactional Server API Key | Optional. The API key of a second Postal mail server. | Receipts and other transactional email go through that server in their own lane, so they never queue behind a campaign, and each server keeps its own sending reputation. Both servers post to the same callback address. *Remove* drops it. |
| Webhook Public Key | Optional. The PEM public key of the Postal installation. | Callbacks are then checked against Postal's signature as well as the address's own token. |

**SendGrid**

| Field | What it is | What it changes |
|---|---|---|
| API Key | SendGrid → Settings → API keys. It needs the *Mail Send* permission. | Used on every send and Check. |
| API Address | Optional. Empty means the global region; EU subusers use `https://api.eu.sendgrid.com`. | Where the calls go. |
| Event Webhook Verification Key | Optional. SendGrid → Mail settings → Event Webhook → Signed Event Webhook. | Callbacks are then verified against SendGrid's signature. |

**Digivize (texts)**

| Field | What it is | What it changes |
|---|---|---|
| API Address | Optional. Empty means Digivize's standard address; the sandbox has its own. | Where every send goes. |
| Batch Send Path | Optional. The path of the batch request, when Digivize gives one that differs from the standard. | Used in batch send mode. |
| API Key | Digivize's `api_key`. | Travels with every call. |
| Secret Key | Digivize's `secret_key`. Write-only. | Signs every call; a wrong key fails Check. |
| Brand ID | The brand's number at Digivize, for example `3`. A name is refused. | Every text is sent under this brand. |
| Send Mode | `single` (the default): one request per text. `batch`: one request per identical text with a list of recipients, once Digivize provides the batch route. | How a run's messages are grouped. |
| Message Type | `marketing` (the default) or `transactional`. | Digivize applies its own rules per type; a marketing text without a STOP line is refused by Digivize. |
| Callback Address to Send | Optional. Paste this engine's own callback address (Copy Webhook URL). | Digivize is asked to post delivery results there with every send. |
| Webhook Secret | Optional. The secret given to Digivize for the callback. | Results are then verified; empty, the address's own token is the check. |

**Sandbox (sends nothing)**

| Field | What it is | What it changes |
|---|---|---|
| Numbers to Refuse | Comma-separated numbers. | Sending to them fails for good, as an invalid number would: for rehearsing failures. |
| Numbers that Fail Temporarily | Comma-separated numbers. | Sending to them asks for a retry, as a busy aggregator would. |

The Sandbox accepts every text and sends none, and is not metered against the plan. Use it to try text campaigns before an aggregator is connected.

### The senders table

| Control | What it is | What it changes |
|---|---|---|
| Sender | The display name, the channel tag and **Default** when it is the one a new campaign is offered first. Under it, the address or the number and the engine it sends through. | The From line (email) or the number (texts) on every message of a campaign that uses it. |
| Status | **Not Verified Yet**, **Verified**, or **Verification Failed**. | Only a verified sender can publish to production. Test sends work from any sender. |
| Verify / Verify Again | Email: sends a real message from the address to your own sign-in email. Texts: asks for a mobile number (with the country code) and sends it a text. Accepted by the engine = Verified. | Sets the status. |
| Edit | Opens the sender's form. | |
| Remove | Deletes the sender after a confirmation. | A campaign that used it needs another sender before it can publish. |
| Add Sender | Opens the form for a new sender; needs an engine first. | |

### The sender form (Add Sender, Edit)

| Field | What it is | What it changes |
|---|---|---|
| Sends Through | The engine this sender uses. | The channel of the sender (email or texts) and which account delivers its messages. |
| From Name (email) / Name (texts) | Email: the name shown in the inbox, for example *Northwind Rewards*. Texts: how the sender is listed in campaigns, for example *Northwind texts*. | The name on every message, or the label in the campaign's sender list. |
| From Address (email) | The address messages come from. It must belong to a domain the engine is allowed to send for. | Changing it needs a new verification. The engine's domain checks (SPF, DKIM) decide whether inboxes trust it. |
| Reply-To Address (email) | Optional. Where replies go when it is not the From address. | The Reply-To header on every message. |
| Sender Number (texts) | The number texts come from: a short code (`55123`), a long number with the country code (`+14045550155`) or an alphanumeric sender id where the aggregator allows one. | The number on every text; replies and STOP messages come back to it. |
| Default | One sender per channel is the default. | Offered first when a campaign is set up. |

## How to

**Connect an email engine.** Add Engine → choose the type → name it → paste the address and the key → Add Engine. Press **Check** on its row and wait for *Checked*. Then **Copy Webhook URL** and register that address with the provider (Postal: the mail server's Webhooks; SendGrid: Mail settings → Event Webhook). Within a day the Callbacks column should show callbacks arriving.

**Add and verify a sender.** Add Sender → pick the engine → the from name and address → tick Default if it is the usual one → Add Sender. Press **Verify** and look for the message in your own inbox: when the engine accepts it, the status reads Verified. For texts, Verify asks for a mobile number to text.

**Keep receipts out of the campaign queue (Postal).** Edit the engine and enter the API key of a second Postal mail server as the Transactional Server API Key. Receipts and transactional campaigns then use it in their own lane. One engine, one callback address, two keys.

**Replace a leaked key.** Edit the engine, type the new key over the stored one, save, press Check. For the callback address, press **Rotate Address** and register the new address with the provider; the old one answers nothing from the moment you rotate.

**Try texts without an aggregator.** Add the Sandbox engine and a sender on it. Text campaigns then run end to end and nothing is sent. The Sandbox can even play back deliveries and STOP replies when a developer posts to its callback address.

## What happens behind the scenes

1. **Publishing** a campaign attaches the sender you chose; the sender names the engine.
2. **At the run's time** CEP builds the audience, leaves out the people it must (no consent, unsubscribed, bounced, over the frequency cap, and so on), and hands the messages to the engine in batches, paced by Messages per Minute.
3. **The engine answers** per message: accepted (CEP records the engine's message id), rejected (failed, never retried) or try again (retried after 1, 5, 15, 30 and 60 minutes; after five attempts it fails). A refused key or a suspended account stops the whole run with that reason.
4. **The engine calls back** to the callback address as things happen: delivered, bounced, deferred, dropped, complained, opened, clicked, unsubscribed. CEP keeps every callback and moves the message's status forward. A hard bounce or a complaint blocks the address for every future campaign; a complaint or an unsubscribe also records an opt-out.
5. **Texts** follow the same path with their own vocabulary: delivered or failed receipts, and replies. A STOP reply opts the number out of every kind of campaign and blocks it; START lifts the block.

The campaign's **Recipients** tab shows each message's story, and **Check with the Engine** on a row asks Postal directly what became of it.

## Things to know

- A sent message with no delivered time, and *No callback has ever arrived* on the engine, means the callback address is not registered with the provider. The send worked; the news is not coming back.
- Verification is per address. Changing a sender's From Address resets it to Not Verified Yet.
- Removing an engine removes its senders. Switch it off instead when you may need it again.
- Keys are stored encrypted and are never shown, exported or written to the audit trail.
- The platform's own mail server (used for password links and notifications) is never a campaign engine. Your workspace's own mail server can be, from Settings → Email Server.
