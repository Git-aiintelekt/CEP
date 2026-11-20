# Suppressions

**Where:** Settings → Engagement → Suppressions.

## What this page is for

Everyone the workspace must not send to, in one list: people who unsubscribed or replied STOP, addresses that bounced, people who complained, and addresses or numbers blocked by you. A blocked address is left out of every audience from then on, whatever list it is on. The page shows the counts by reason, lets you search, unblock where that is allowed, export the list, and import a do-not-contact list before the first campaign.

## Who can use it

| | |
|---|---|
| Permission | `campaign.view` (or `consent.edit` or `governance.edit`) to read and export; `consent.edit` to unblock and import. Without `consent.edit` the Import Suppressions button and the Unblock links are not shown. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The heading line | *{n} addresses and numbers held back · {n} added this week*. | Nothing; a reading. |
| The counts | One card per reason: Unsubscribed (*by link, a STOP reply, or a person*), Bounced (*blocked after the provider said so*), Complained (*never sent to again*), Blocked by You (*imported or added by hand*). | Clicking a card filters the table to that reason; clicking it again shows every reason. |
| Search | *Address, number or party ID*; also matches the person's name. Filters as you type. | Narrows the table, and what Export CSV exports, to the matching rows. |
| Channel | All Channels (default), Email, Phone. | Narrows the table and the export. |
| Reason | Every Reason (default), Unsubscribed, Bounced, Complained, Blocked by You. | Narrows the table and the export. |
| Clear Filters | Shown when a filter or search is set. | Shows every row again. |
| The table | Contact (with the customer id and name, or *No person on file*), Channel, Reason, Source (an unsubscribe link, a STOP reply, the engine's bounce, an import, a request by phone) with any detail, and Since. 25 a page, newest first, with Previous and Next. | Nothing by itself: every row is left out of every audience. |
| Unblock | Shown only on a bounce or a block you made. Opens **Unblock this contact?** | **Unblock** makes the address or number reachable again from the next send that includes it; the history of the block is kept and the change is written to the consent record with who made it. **Keep Blocked** closes the dialog and changes nothing. A complaint or an unsubscribe has no Unblock: the person has to opt in again themselves. |
| Export CSV | Downloads the rows the filters and search show (all pages, not just the one on screen). | Nothing in the workspace changes. The file has the contact, channel, reason, source, detail, since, customer id, name and whether it can be unblocked; use it as a record or to clean lists in another system. |
| Import Suppressions | Opens the import dialog, subtitled *Addresses and numbers to stop sending to*. | See below. |

### The Import Suppressions dialog

| Control | What it is | What it changes |
|---|---|---|
| How | **Paste Addresses** (default) or **Upload CSV**. | Which of the two fields below is shown. |
| Addresses and Numbers | Paste Addresses: one per line, or separated by commas. Up to 5,000 at a time. | Every valid address and number is blocked. A ten-digit North American number gets +1. |
| CSV File | Upload CSV: any cell that looks like an address or a number is blocked. Up to 5 MB. | Every address and number found in the file is blocked. |
| Note | Up to 200 characters, optional: why they are blocked, for example a legal hold list or a request by phone. | Kept on the consent record of every address blocked by this import, so the reason can be shown later. |
| Block Them | | Blocks them at once, matched to the person when the address is on file. From then on no campaign run or e-receipt reaches them. The result says how many were blocked, how many were already blocked and which were not an address or a number. **Done** closes the dialog. |

## How to

**Import a do-not-contact list first.** Before the first upload, Import Suppressions → Upload CSV → the list from your previous system → Note: *Opt-outs carried over from …* → Block Them. No campaign can reach them, even if a later list contains them.

**A customer asks by phone never to be emailed.** Import Suppressions → Paste Addresses → the address → Note: *Request by phone, 3 Oct* → Block Them.

**An address bounced wrongly.** Reason: Bounced → search → Unblock → Unblock. The next run includes the person again.

**Hand the list to another system.** Set the filters you need → Export CSV.

## What happens behind the scenes

The list reads two records: what happened to an address or number (a hard bounce, repeated soft bounces, a complaint, a block) and what the person decided (unsubscribed, STOP). At every run the audience builder leaves out everyone on it, and the campaign's Recipients → Blocked & Unsubscribed shows the ones among that campaign's people. A single e-receipt to a blocked address or number is refused with *This address is blocked …: nothing was sent.* Every unblock and import is written to the consent record with who made it.

## Things to know

- Uploading a list never adds anyone back: the suppression wins over any list membership.
- Unsubscribes and complaints are the person's decision; only they can reverse them, on the preference page or by opting in through your forms.
