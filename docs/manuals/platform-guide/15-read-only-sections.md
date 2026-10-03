# The Read-Only Sections

**Where:** The collapsible sections at the foot of the menu: Campaigns, Delivery, Customers and lists, Content; and Operations → Change audit trail.

## What this is for

Every workspace's records, across tenants, as the database holds them: for support, for answering a question the app cannot, and for the audit trail. Nothing here is edited; the workspace's pages are where things change.

## Who can use it

Every staff account reads.

## What each section holds

| Section | Lists |
|---|---|
| Campaigns | Campaigns, their runs and run variants (subject tests), the frozen audience snapshots and their members, targets and actuals. |
| Delivery | Sending engines (with their last check and whether a credential is stored; keys never shown), senders, every email and text sent with its status and the engine's id, provider callbacks as received, dead letters (messages that failed for good), tracking events and tracked links. |
| Customers and lists | Customers, segments, contact lists and their members, uploads and their rows. |
| Content | Templates and their versions. |
| Integrations | Every tenant's integration records (throttle, retries, breaker and log policy are editable here: Pause, Resume, Close the circuit now) and the call log with request and answer, keys masked. |
| Change audit trail | Who changed which definition, when, and which columns: every save in the app and the back-office. |

## How to

**Why did this person not get the campaign?** Campaigns → Audience members → filter by the campaign and search the person: the row carries the reason they were left out. The same is on the campaign's Audience tab in the app.

**What did the engine say about a message?** Delivery → Emails sent → the message: its status, the engine's id, and under Provider callbacks every event the engine posted for it.

**Who changed a plan?** Change audit trail → filter by the table.

## Things to know

- Keys, passwords and card numbers are never shown in these sections; a credential reads as stored or not.
- Editing a record here bypasses the app's rules; that is why the sections are read-only, except the integration policies, which belong to the platform.
