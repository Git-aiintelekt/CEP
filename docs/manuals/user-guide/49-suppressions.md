# Suppressions

**Where:** Settings → Audience → Suppressions.

## What this page is for

Everyone the workspace must not send to, in one list: people who unsubscribed or replied STOP, addresses that bounced, people who complained, and addresses or numbers blocked by you. A blocked address is left out of every audience from then on, whatever list it is on. The page shows the counts by reason, lets you search, unblock where that is allowed, and import a do-not-contact list before the first campaign.

## Who can use it

| | |
|---|---|
| Permission | `campaign.view` to read; `consent.edit` to unblock and import. Settings as a whole needs `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The counts | Per reason, with this week's additions; each is a filter. | |
| Channel | All, Email, Phone. | The table. |
| Reason | Every Reason, Unsubscribed, Bounced, Complained, Blocked by You. | The table. |
| Search | An address, a number or a customer id. | |
| The table | The contact, the person behind it, the reason in words, the source (an unsubscribe link, a STOP reply, the engine's bounce, an import, a request by phone), since when. 25 a page. | |
| Unblock | Undoes a bounce or a block you made, after a confirmation. A complaint or an unsubscribe cannot be undone here: the person has to opt in again themselves. | The address is reachable again from the next run. |
| Export CSV | The filtered rows as a file. | |
| Import | Paste Addresses (one per line or comma-separated, up to 5,000) or Upload CSV (any cell that looks like an address or a number, up to 5 MB), with a Note for the consent record: a legal hold list, a request by phone. | Every address and number is blocked, matched to the person when the address is on file. The result says what was invalid and what was already blocked. |

## How to

**Import a do-not-contact list first.** Before the first upload, Import → Upload CSV → the list from your previous system → Note: *Opt-outs carried over from …* → Import. No campaign can reach them, even if a later list contains them.

**A customer asks by phone never to be emailed.** Import → Paste Addresses → the address → Note: *Request by phone, 3 Oct*.

**An address bounced wrongly.** Reason: Bounced → search → Unblock. The next run includes the person again.

## What happens behind the scenes

The list reads two records: what happened to an address or number (a hard bounce, repeated soft bounces, a complaint, a block) and what the person decided (unsubscribed, STOP). At every run the audience builder leaves out everyone on it, and the campaign's Recipients → Blocked & Unsubscribed shows the ones among that campaign's people. A ten-digit North American number pasted without a country code is read as +1.

## Things to know

- Uploading a list never adds anyone back: the suppression wins over any list membership.
- Unsubscribes and complaints are the person's decision; only they can reverse them, on the preference page or by opting in through your forms.
