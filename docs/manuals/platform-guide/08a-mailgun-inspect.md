# Mailgun Inspect: Deliverability Tests for Every Workspace

**Where:** Configuration → Mailgun Inspect; each tenant's page → Deliverability Tests → Add Tests.

## What this is for

The platform's Mailgun Inspect account. Inbox previews (a template rendered in real email clients) run through it for every workspace that has no Inspect account of its own, up to the workspace's plan number plus any tests added for the month. A workspace may instead enter its own Mailgun Inspect key in the app; its tests then run on its own account and CEP does not limit them.

## Who can use it

Platform administrators.

## The fields and controls

### The account (Configuration → Mailgun Inspect)

| Field | What it is | What it changes |
|---|---|---|
| Region | US or EU: where the Mailgun account lives. | The address the tests go to. |
| Username, API key | The Inspect account's username and an API key (Mailgun → Inspect → Settings → API). The key is stored encrypted and never shown; empty keeps the stored one. | |
| Default clients | The clients a test renders in when the workspace has not chosen its own. None ticked: the service's own default set. The list appears once the key is saved. | |
| Render with images blocked | The default for workspaces that have not chosen. | |
| Active | Whether workspaces may use the account. Off: only workspaces with their own account can run tests. | |
| Check Connection | Asks Mailgun for the client list with the stored key; the result shows as Connected or Check failed, with Mailgun's answer. | |
| Remove | Deletes the account. Past results stay. | Workspaces without their own account can no longer run tests. |
| This month, by workspace | Each workspace's tests through this account this month, its plan and its total (the added tests in brackets), with Add Tests. | |

### Added tests (a tenant's page → Deliverability Tests)

| Field | What it is | What it changes |
|---|---|---|
| The card | This month's tests against the total, the meter, and where the total comes from ("50 a month on the Growth plan + 70 added for October"). Its own account: "not limited". | |
| Tests | How many to add, 1 to 100,000. | This month's total. |
| Note | Why, for the record (300 characters). | |
| History | Every addition: when, for which month, how many, the note, by whom. **Remove** takes back an addition while its month is open; past months read Ended. | |

## How to

**Set it up.** Configuration → Mailgun Inspect → region, username and API key → Save → Check Connection. When it reads Connected, tick the default clients and Save again. Every workspace without its own account can now run inbox previews.

**Give a workspace more tests this month.** The tenant → Deliverability Tests → Add Tests → the number and a note → Add Tests. The workspace sees the new total at once, on its Deliverability tab and on Plan & Usage.

**Change the number every month.** Change the plan's Max deliverability tests per month (Plans and billing), or move the tenant to another plan. Additions are for one month only.

## What happens behind the scenes

A test counts when it is requested, because Mailgun bills it then, whatever comes back. Only tests through the platform's account count against the total; a workspace's own account is counted for information and never refused. Additions belong to a calendar month and end with it: nothing carries over. A test is tagged `cep:<tenant code>:<template>:<version>` on Mailgun, so the account's own usage can be split by workspace. A test's results are always read from the account that ran it, even if the workspace switches accounts meanwhile.

## Things to know

- A workspace with its own account uses it first; the platform's is the fallback.
- Additions to a workspace that uses its own account change nothing until it goes back to the platform's.
- The refusal at the limit names the total, where it comes from and the date more become available, and points the workspace to the platform team.
