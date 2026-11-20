# Roles

**Where:** Settings → General → Roles.

## What this page is for

A role is a named set of permissions. A user with the role may do what its permissions allow, and a user with several roles may do the sum of them. Three roles come with every workspace: Workspace Admin (everything, including users, roles and API keys), Campaign Manager (builds and publishes campaigns, lists and templates) and Analyst (read-only with reports). Add your own for narrower jobs, then give them to people under Users.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | Role (name and description), Permissions (how many of the catalogue, for example *5 of 21*), Users (how many people hold it, deactivated users included). | Nothing; it shows what each role allows and who depends on it. |
| New Role | Opens the *New Role* form below; Create Role saves it. | Adds a role that Users and, for single sign-on, Role for New Accounts can then offer. Nobody holds it until you give it to someone. |
| Edit | Opens the same form for one role; Save Changes saves it. | Everyone holding the role gains or loses the permissions at their next request; no sign-out needed. Removing `user.admin` from the only role that gives it to an active user is refused: *This role is the only one that gives anyone user administration.* |
| Delete | Asks *Delete the role "{name}"?* Greyed out, with the tip *People still have this role*, while anyone holds it. | The role disappears from Users and the form's role lists; its name can be used again. Move people to another role first, deactivated users included. |

### The role form

| Field | What it is | What it changes |
|---|---|---|
| Name | At least two characters, up to 100; unique in the workspace (*Another role already has this name.*). | How the role appears in the Users table, the user form and the single sign-on role list. Renaming it changes nothing for the people who hold it. |
| Description | Optional, one line. | Shown under the name in this table and under the role's checkbox in the user form, so whoever assigns it knows what it is for. Without one, the user form shows how many permissions it has. |
| Permissions | A checkbox per permission, grouped by area (Campaigns, Contact Lists, Templates, Journeys, Consent, Sending Rules, Delivery Providers, Reports, Administration), each with its code. The count of ticked ones shows in the heading. | What everyone holding the role may do: see the list below. A role with none lets its people sign in and see nothing. |

### The permissions

| Permission | What it allows |
|---|---|
| campaign.view | See campaigns, their results, recipients and activity. |
| campaign.edit | Create, edit, clone and archive campaigns; send tests; ask for approval. |
| campaign.publish | Publish to production, pause, resume, cancel a schedule, choose a subject test's winner. |
| campaign.approve | Approve or send back a campaign when the workspace requires approvals. Never for the person who asked. |
| journey.view, journey.edit, journey.activate, journey.export, journey.suppress | See journeys; build, test, retry or skip steps, duplicate and archive drafts; approve, schedule, pause, resume and archive live journeys; export a journey's customers; keep named customers out of a journey (all with the journeys feature). |
| template.view, template.edit | See templates; create, edit, activate and delete them. |
| list.view, list.edit, list.import | See lists and their people; create, edit, clone and archive lists; upload files. |
| consent.edit | Approve or refuse a list that waits for approval; block and unblock addresses under Suppressions. |
| governance.edit | Change the frequency policies. |
| provider.edit | Sending engines, senders, integrations and deliverability testing. |
| report.view | Reports, Home's figures, Governance. |
| report.edit | Build reports and dashboards in Insights, and change your own or those shared with you for editing. |
| report.admin | Change and manage every report and dashboard in Insights, whoever owns it. |
| user.admin | Settings as a whole: users, roles, tags, security, approvals, notifications, the plan, API keys, the consent policy, the preference centre, POS receipts. |

## How to

**Make an approver who cannot publish.** New Role → *Approver* → tick campaign.view and campaign.approve → Create Role. Give it to the people who sign off under Users.

**Let the store team upload lists only.** New Role → list.view, list.edit, list.import → Create Role. They see Contact Lists and nothing else.

**Retire a role.** Under Users, give everyone who holds it another role (deactivated users too), then Delete.

## What happens behind the scenes

Every API request checks the permission the endpoint needs against the sum of the user's roles; a page without the permission says which one to ask for. Changing a role takes effect at the user's next request, no sign-out needed.

## Things to know

- Settings needs user.admin as a whole; a role with provider.edit alone cannot open Sending Engines through the menu, though the API allows it.
- The three starting roles can be edited and renamed like any other; the Workspace Admin role is what the first administrator holds.
- There is always at least one active administrator: the last one cannot lose `user.admin`, whether by a role change here or under Users.
