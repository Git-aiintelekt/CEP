# Roles

**Where:** Settings → Workspace → Roles.

## What this page is for

A role is a named set of permissions. A user with the role may do what its permissions allow, and a user with several roles may do the union of them. Three roles come with every workspace: Workspace Admin (everything, including users, roles and API keys), Campaign Manager (builds and publishes campaigns, lists and templates) and Analyst (read-only with reports). Add your own for narrower jobs.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | Role (name and description), Permissions (how many of the catalogue), Users (how many hold it). | |
| New Role, Edit | The form: Name, Description, and a checkbox per permission, grouped by area. | |
| Delete | Removes a role nobody holds. A role with users is refused. | |

### The permissions

| Permission | What it allows |
|---|---|
| campaign.view | See campaigns, their results, recipients and activity. |
| campaign.edit | Create, edit, clone and archive campaigns; send tests; ask for approval. |
| campaign.publish | Publish to production, pause, resume, cancel a schedule, choose a subject test's winner. |
| campaign.approve | Approve or send back a campaign when the workspace requires approvals. Never for the person who asked. |
| journey.view, journey.edit, journey.activate | See, build and switch on journeys (with the journeys feature). |
| template.view, template.edit | See templates; create, edit, activate and delete them. |
| list.view, list.edit, list.import | See lists and their people; create, edit, clone and archive lists; upload files. |
| consent.edit | Approve or refuse a list that waits for approval; block and unblock addresses under Suppressions. |
| governance.edit | Change the frequency policies. |
| provider.edit | Sending engines, senders, integrations and deliverability testing. |
| report.view | Reports, Home's figures, Governance. |
| user.admin | Settings as a whole: users, roles, tags, security, approvals, notifications, the plan, API keys, the consent policy, the preference centre, POS receipts. |

## How to

**Make an approver who cannot publish.** New Role → *Approver* → tick campaign.view and campaign.approve → Create. Give it to the people who sign off.

**Let the store team upload lists only.** New Role → list.view, list.edit, list.import. They see Contact Lists and nothing else.

## What happens behind the scenes

Every API request checks the permission the endpoint needs against the union of the user's roles; a page without the permission says which one to ask for. Changing a role takes effect at the user's next request, no sign-out needed.

## Things to know

- Settings needs user.admin as a whole; a role with provider.edit alone cannot open Sending Engines through the menu, though the API allows it.
- The three starting roles can be edited and renamed like any other; the Workspace Admin role is what the first administrator holds.
