# Results API

**Where:** Settings → Engagement → Results API. Its keys are made under Settings → General → API Keys, and its full call log is under Settings → Engagement → Integrations; the page links to both.

## What this is for

Another system reading what your campaigns did, straight from C360: the customer system (iCRM), a BI tool, a data warehouse. The other system calls C360 whenever it wants the figures; C360 never calls it. You decide which system may read by giving it a key, you see every call it makes, and you can stop it at any moment.

It answers four lists:

| List | What it holds |
|---|---|
| Campaigns | Each campaign's counts (sent, delivered, opened, clicked, bounced, unsubscribed, replied), its rates, the people held back by reason, and the revenue and cost attributed to it. |
| Sends | The same counts for each send: one message of a drip, one occurrence of a recurring campaign. |
| Recipients | One row for each recipient of each send, and one for each person a send held back: the party ID, the status, and when each thing happened. |
| Suppressions | Who must not be contacted: everyone who unsubscribed or replied STOP, and every customer whose address or number is blocked. The list on the Suppressions page, by party ID. |

## What it never gives

- A name, an email address or a phone number. A customer is a party ID and nothing else; the other system adds the name from its own records.
- The content of a message.
- Test sends.
- A blocked address that belongs to no customer (an imported or registry address has no party ID). The other system is told how many were left out.

## Who can use it

| | |
|---|---|
| To open the page and give a system access | `user.admin`. The workspace needs the **api_access** feature; without it the page is not in the Settings menu. |
| To pause or resume a list | `provider.edit` as well. Without it the lists show, the Pause and Resume buttons do not. |
| The other system | An API key of this workspace with the scope `results:read`. A person's sign-in is never accepted, whatever their role. |

## The fields and controls

### Connect a System

What to give the team that builds the other system.

| Control | What it is | What it changes |
|---|---|---|
| Base Address | The address the four lists sit under, with **Copy** (it reads *Copied*). The lists answer JSON, or CSV when asked. | Copy puts the address on the clipboard. Nothing in the workspace changes. |
| Headers | The two headers every call carries: the key, and your workspace ID. | Nothing; a reading. |
| API Key | The scope a key needs, `results:read`, and the active keys that hold it, by name. A key that expires within 30 days says in how many days. When no key holds the scope: *No key has it yet, so nothing can be read*, with **Go to API Keys**. | Nothing here. Keys are made and revoked on the API Keys page, which the link and the button open. |
| Specification | **Open API Description** opens the description C360 publishes of every address and field, in a new tab. The Word copy, with the test checklist, comes from the platform team. | Nothing; a reading. |

### The Four Lists

One row a list. Until something has read, the table shows what there is to read: the list, its address, its limit a minute and *No Calls Yet*. Once a system reads, it shows the last 24 hours.

| Control | What it is | What it changes |
|---|---|---|
| List, Address | The list, what it holds, and its address under the base address. | Nothing; a reading. |
| Calls | Calls to the list in the last 24 hours. | Nothing; a reading. |
| Throttled | Calls the pace limit held, in amber when there are any. Hover for the limit. | Nothing; a reading. Held calls are slowed, not lost: the other system waits and asks again. A count that keeps growing means it is calling faster than the limit. |
| Last Read | How long ago the list was last called, and the name of the key that called. *Not Yet* when it never was. | Nothing; it tells you which system is still reading. |
| Status | Healthy, Degraded (5% or more of the day's calls failed), Circuit Open, Paused, or No Calls Yet: the same words as on the Integrations page. | Nothing; a reading. |
| Pause / Resume | Pause asks first: *Pause {list}? The system reading this list is answered "paused" until it is resumed. The other lists go on.* Resume needs no confirmation. | Pause: every call to that list is answered *paused* (HTTP 503) until it is resumed; nothing is lost, the other system reads what it missed afterwards. The other three lists are not affected. It is the same switch as the list's card on the Integrations page. |
| View Log in Integrations | A link, shown once something has read. | Opens the Integrations page, where each call is listed with the key that made it. |

## The limits

| Limit | Value | What the other system is told |
|---|---|---|
| How far back | Campaigns and sends: 13 months. Recipients: 90 days. | Refused, with the earliest day allowed. |
| How much a call | 31 days. | Refused, with the latest day allowed. |
| Calls a minute | Campaigns 60, Sends 60, Recipients 120, Suppressions 60, each counted for the whole workspace. | A *throttled* answer (429) and how long to wait. |
| Calls in one second | 10. | The same. |

The platform team can set a different calls-a-minute figure for your workspace. However the other system is written, it cannot slow C360 down for the people using it.

## How to

**Let a system read your results.**
1. Ask its team for the public addresses it will call from.
2. Settings → API Keys → New API Key. Name it after the system (for example *Data Warehouse*), tick `results:read` and nothing else, enter the addresses under Allowed IP Addresses, set an expiry, and Create Key.
3. Copy the key and pass it on over a channel approved for secrets. It is shown once.
4. Give the team what Connect a System shows on the Results API page (the base address, the headers, your workspace ID) and the integration specification (*CEP Results API: Integration Specification*, from the platform team): every field, the limits and a test checklist.

**See what it reads.** The Four Lists on this page: each list's calls in the last 24 hours, how many the limit held, and which key read it last. For every call (when, which key, what was asked, how it was answered), View Log in Integrations: once a key has `results:read`, the Integrations page has a card for each list, Results: Campaigns, Results: Sends, Results: Recipients and Results: Suppressions.

**Stop it for a while.** Pause on the list's row. That list answers *paused* (503) until you press Resume; the other lists go on. Nothing is lost: the other system reads what it missed when it is resumed.

**Stop it for good.** Settings → API Keys → Revoke. The next call is refused.

**The other system says its calls are throttled.** It is calling faster than the limit. Its calls are slowed, not lost. If it truly needs more, ask the platform team to raise the figure for that list.

**A figure does not match the campaign's Results tab.** The lists count the messages made in the days asked for. A campaign that never ends (e-receipts, a journey's messages) shows those days only, not its whole life. Ask for the same days as the tab shows.

## What happens behind the scenes

Each list is an integration of the workspace with its own pace limit, pause switch and call log. A call is checked for its key, the key's expiry and allowed addresses, and the scope; then counted against the list's minute.

The counts are worked out when asked, from the same records the campaign's Results tab reads, and kept for 30 seconds. Only one such working-out runs at a time for a workspace, and a query that takes longer than 15 seconds is stopped, so a heavy read waits its turn instead of weighing on the app.

Recipients and Suppressions can be read whole, or only what changed since the other system's last read. For recipients, C360 stamps a message each time its result moves: a delivery, an open, a click, a bounce, a reply, an unsubscribe. A person held back appears once. In Suppressions, someone who asks for messages again, or a block you remove, comes back marked as lifted, so the other system can clear its own flag.

By default Suppressions holds what C360 learned first: an unsubscribe link, a STOP reply, the preference centre, a spam report, a bounce, a block made here. An opt-out that arrived with the customer record is left out, because the customer system is where it came from; the other system can ask for those too.

Every list also answers as CSV, for tools that load files.

## Things to know

- A key with `results:read` reads all four lists of this workspace, and nothing of any other workspace.
- Give the key no other scope: with more scopes the other system could do more than read results.
- A sending engine's reason for a failure can contain the address it refused. C360 replaces any address or number in it before the row is answered.
- Money (revenue, orders, cost) is per campaign, as Attribution last worked it out; it is empty until Attribution has run for the campaign.
- A change to a suppression reaches the other system at its next read, at least five minutes after it happened.
