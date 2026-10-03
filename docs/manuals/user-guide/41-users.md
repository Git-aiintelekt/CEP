# Users

**Where:** Settings → Workspace → Users.

## What this page is for

Who can sign in to the workspace, with which roles. People are invited by email with a one-time password link; they choose a password and sign in. Users are deactivated, never deleted, so everything they created keeps its author.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |
| Features | Always on. A column reads SSO when the workspace signs people in through its identity provider (Settings → Security). |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | User (name and email, *you* on your own row), Roles, Status (Active or Deactivated), Sign-In (when they last signed in; *No password yet* until the password link is used; the provider's name for single sign-on accounts). | |
| Add User | Opens the form. | |
| Edit | The name and the roles. The email address is the sign-in name and cannot be changed. | |
| Password Link | Makes a one-time link to choose a password, sends it by email when the workspace has a mail server, and shows it to copy otherwise. For a new user, for someone who forgot, or when a link expired. | The previous link stops working. |
| Deactivate / Reactivate | Takes the sign-in away or gives it back. Nobody can deactivate themselves. | A deactivated user is left out of every count and every notification; their campaigns and templates stay. |

### The user form

| Field | What it is | What it changes |
|---|---|---|
| Email | The sign-in name. Must not exist in the workspace. | Where the password link goes. Fixed once created. |
| Name | Shown wherever the person appears: owner of a campaign, author of a template, the approver. | |
| Roles | One or more of the workspace's roles. Without a role the user can sign in but sees nothing. | What the person may do. The permissions of all their roles add up. |

## How to

**Invite someone.** Add User → email, name, tick a role → Add. The password link goes by email when the workspace has a mail server; otherwise copy it from the Password Link dialog and send it yourself.

**Someone forgot their password.** Password Link on their row. The link is one-time and expires; an older link stops working.

**Someone leaves.** Deactivate. Their campaigns keep their name as owner; reassign the live ones from each campaign's Edit Details.

## What happens behind the scenes

1. Adding a user creates the account with no password and a one-time link. The workspace's own mail server carries the email when one is entered under Settings → Email Server; the platform's server otherwise; with no server at all the link is shown to copy.
2. The first sign-in of an administrator lands on Settings → Set-Up while the workspace is not ready.
3. When Security requires multi-factor authentication, a new user is asked to set it up on their first sign-in, before anything else.

## Things to know

- The workspace's plan caps the number of active users; Settings → Plan & Usage shows the count against the limit.
- A single sign-on account has no password link: the identity provider signs it in.
- Roles are defined on the Roles page; this page only assigns them.
