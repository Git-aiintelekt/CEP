# Users

**Where:** Settings → General → Users.

## What this page is for

Who can sign in to the workspace, with which roles. You add a person with their email address and roles; they get a one-time password link, choose their own password and sign in. Administrators never see or set a password. Users are deactivated, never deleted, so everything they created keeps its author.

An account is the **Workspace ID and the email address** together. The same person can have an account here and in another workspace (Staging and Production, for example): each is added in its own workspace, with its own password, roles and two-factor. The line above the table names this workspace: *Accounts in the workspace CODE.*

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. |
| Features | Always on. When the workspace signs people in through its identity provider (Settings → Security), those accounts show the provider type instead of a sign-in date and have no password link. |

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| The table | User (name and email, *you* on your own row), Roles (*No role* when there is none), Two-Factor (On, *Not set up*, or *Single sign-on* for an account the identity provider signs in), Status (Active or Deactivated), Sign-In: when they last signed in, *Never signed in* when they have a password but have not used it, *No password yet* until the password link is used, or the provider type (for example `OIDC`) for single sign-on accounts. | Nothing; it shows who can get in. *No password yet* means the person cannot sign in until they use a password link. |
| Add User | Opens the *Add a User* form below. | Creates the account with no password. Nothing is emailed: make a password link next. Refused when the plan's active-user limit is reached: *Your plan allows {n} active users. Deactivate someone or upgrade the plan.* |
| Edit | Opens the same form for one person: the name and the roles. The email address cannot be changed. | Saves with Save Changes. New roles take effect at the person's next request; no sign-out needed. |
| Password Link | Shown for active users who sign in with a password. Opens a dialog with a fresh one-time link. | Makes a link on which the person chooses their own password: for a new user, someone who forgot, or when an earlier link expired. |
| Deactivate | On every row but your own. Asks *Deactivate {name}? They will not be able to sign in.* | The person cannot sign in, and a session they already have open stops at its next request. They no longer count against the plan's user limit and no longer appear as an approver. Their campaigns, templates and history keep their name. Refused for the last active user who holds `user.admin`: *This is the last active administrator. Give another user an administrator role first.* |
| Activate | On a deactivated user's row. | The person can sign in again with their existing password, and counts as an active user again. |

### The user form (Add a User, Edit {name})

| Field | What it is | What it changes |
|---|---|---|
| Email | The sign-in name. A valid address, used once in this workspace; the hint under it says *They log in with this address and the Workspace ID CODE.* An address that has an account in another workspace is fine: it gets its own account here. Used twice here, it is refused: *This address already has an account in this workspace. Edit it to change the roles.* | What the person types to sign in, with this workspace's ID, and where an emailed password link goes. Fixed once created: for a new address, deactivate the user and add a new one. |
| Name | At least two characters. | How the person appears everywhere: the Users table, the owner of a campaign, the author of a template, the approver of a campaign, the *Welcome* on Set-Up. |
| Roles | A checkbox per role of the workspace, with its description. One or more. | What the person may do: the permissions of all their roles add up. Without a role the person can sign in but sees nothing. Taking `user.admin` away from the last active administrator is refused. |

### The Password Link dialog

| Control | What it is | What it changes |
|---|---|---|
| Email the Link | Shown when the workspace has a working mail server (its own under Email Server, or the platform's). | Makes a new link and emails it to the person with the subject *Choose your password for {CODE}*; the link on screen becomes that same link. *Sent to {email}* confirms it. If the email fails, the dialog says so and you copy the link instead. |
| One-Time Link | The link itself, read-only, with how long it lasts: *It works once, for {n} hours* (72 unless the platform team set another length). | Whoever opens it can set the password, so send it only by a channel you trust. It stops working once a password is set with it, once the person signs in, or when the hours run out. |
| Copy | Copies the link (the button reads *Copied*). | Nothing is sent; you pass the link on yourself. |
| Done | Closes the dialog. | Nothing; the link stays valid until it is used or expires. |

## How to

**Invite someone.** Add User → email, name, tick a role → Add User. Then Password Link on their row → Email the Link, or Copy and send it yourself.

**Someone forgot their password.** Password Link on their row → Email the Link. The link works once and expires.

**Change what someone may do.** Edit → tick or untick roles → Save Changes. To change what a role allows, edit the role under Roles.

**Someone leaves.** Deactivate. Their campaigns keep their name as owner; reassign the live ones from each campaign's Edit Details. Deactivating here closes this workspace's account only: if they also have an account in another workspace (Staging, say), deactivate it there too, or ask the platform team to close every account of the address at once.

**Give someone access to both Staging and Production.** Add them in each workspace, with the roles they need there (often more in Staging). Each workspace sends its own password link, so they choose a password for each.

## What happens behind the scenes

1. Adding a user creates the account with no password. The password link is made only when you open Password Link; Email the Link sends it through the workspace's own mail server when one is in use under Settings → Email Server, the platform's server otherwise. With no mail server at all, the dialog only offers the link to copy.
2. The first sign-in of an administrator lands on Settings → Set-Up while the workspace is not ready.
3. When Security requires multi-factor authentication, a new user is asked to set it up on their first sign-in, before anything else.

## Things to know

- The workspace's plan caps the number of active users; Settings → Plan & Usage shows the count against the limit.
- A single sign-on account has no password link: the identity provider signs it in. An account that signs in through the provider once becomes a single sign-on account.
- Roles are defined on the Roles page; this page only assigns them.
- Opening Password Link again makes a new link but does not cancel one sent earlier: every link stops working as soon as one of them is used or the person signs in.
- A password link sets the password for this workspace's account only; the person's account in another workspace keeps its own.
- This page never says whether an address has an account in another workspace: each workspace sees only its own people.
