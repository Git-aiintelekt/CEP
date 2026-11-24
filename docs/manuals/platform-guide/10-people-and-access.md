# Users, Roles, API Keys, Support Sessions and Switch Workspace

**Where:** People and access → Users, Roles, API keys, Support access log; Configuration → Permission catalogue.

## What this is for

Every workspace's users, roles and API keys in one place, across tenants, for support: resetting a password, deactivating an account, marking staff, and signing in as a user on the record. The workspace's own administrator does the same for their workspace in the app.

## Who can use it

Staff read; platform administrators change. A support session is logged under the staff member's name and the tenant sees it.

## The fields and controls

### Users

| Section | Fields | What they change |
|---|---|---|
| The list | Email, name, tenant, Used For (the tenant's Production or Staging), roles, Two-Factor, active, staff, platform administrator, last sign-in; sorted by email, then tenant; search by email, name or tenant code; filters by tenant, Used For, active, staff, sign-in provider. | Searching an address lists every account it has, one row per workspace, side by side. |
| Person | Tenant, Email (fixed once created), Name. An address is used once per tenant: a second account for it in the same tenant is refused (*This address already has an account in this workspace.*). | |
| Sign-in | Provider (local or the identity provider), external subject, Active, MFA enabled, last sign-in. Passwords are never typed here. | |
| Roles in the tenant | The workspace's roles. | What the user may do in the app. |
| Platform staff | Staff; Platform administrator. Staff keep one address across the platform: ticking Staff on an address that is already staff in another tenant is refused. | Who may open the back-office and who may change everything in it. |
| Create password link | A one-time link, emailed when a mail server can, shown to copy otherwise. | |
| Sign in as this user (support session) | Reason (ticket and what the customer asked, readable by the tenant's administrators), Access mode (read only unless the customer asked for a change). | A short session in the app as that user. |
| Deactivate, Activate | Actions on the selected rows. | |
| Deactivate in Every Workspace | An action on the selected rows. | Every account of the selected addresses, in every tenant, is deactivated in one step, each change audited under your name (your own account is never included). For someone who leaves: no account stays active in a Staging workspace. |

### Roles

A tenant's roles with their permissions and user counts; the Permission catalogue lists every permission code. The workspace's administrator edits roles in the app; here is for support.

### API keys

Every tenant's keys with their type, prefix, state, last use and expiry; Revoke stops a key at once. Keys are created in the app, where they are shown once.

### Support access log

| Column | What it is |
|---|---|
| Started, Tenant, Staff, Acted as, Access mode, Reason, Writes, State (Active, Ended, Expired) | Every support session ever opened. End the session now closes an open one. |

### Platform visits

| Column | What it is |
|---|---|
| Started, Tenant, Staff, Reason, Writes, State (In the Workspace, Ended) | Every Switch Workspace visit of a platform administrator, as themselves. End the Visit Now closes an open one; its tokens stop working at once. |

## How to

**A customer cannot sign in.** Find the user → check Active and the provider → Create password link → send it. A user of a workspace that requires single sign-on signs in through the provider, not with a link.

**Someone leaves a customer that has Staging and Production.** Users → search their address → tick the rows → Deactivate in Every Workspace.

**One person in Staging and Production.** Each workspace's administrator adds them in the app (Settings → Users), or here: a new user with the other tenant and the same address. Each account has its own password link, roles and two-factor; a Staging account's password never opens Production.

**See a problem with the customer's own eyes.** The user → Sign in as this user → the reason and read-only → Open. The app opens as them with a banner; the session ends after `security.support_access_minutes`, or on End session. The tenant's Security page lists it.

**Work in another workspace as yourself (Switch Workspace).** Platform administrators only, from the app:
1. Open the account menu (your name at the top right) → **Switch Workspace…**.
2. Search the workspaces by code or name; each shows its plan, active users and status (a suspended one too). Pick one.
3. Give a **Reason** in a few words (at least 5 characters): the workspace's administrators read it.
4. Press **Switch to CODE**. The app opens in that workspace with every right, under your own name, and an amber line on every page says you are visiting.
5. Press **Back to Platform** on that line to end the visit and return to your own workspace. Signing out ends it too.

The workspace's administrators see each visit under Settings → Security → Platform Visits (who, from when to when, the reason, changes made); the back-office lists them all under Platform Visits. You cannot switch again from inside a visit: go back first.

## What happens behind the scenes

A support session yields a short-lived token only: read-only unless opened for writing, and never able to manage users, roles, API keys or sign-in security whatever the mode. The user is emailed when `security.notify_user_on_support_access` is on. Everything changed here goes to the change audit trail.

A visit is different: nobody is impersonated. Its tokens carry your own account and the visit; they work only in the visited workspace and only while the visit is open (Back to Platform, signing out, or End the Visit Now closes it). Each change made during the visit is counted on its row. Recording visits needs database patch 0077.

## Things to know

- Deactivating keeps everything the user made; nothing is deleted.
- An account is the tenant and the email address together (database patch 0098): the same address can have an account in several tenants, each with its own password, roles and two-factor. The app's log-in always names the workspace (its address, or the Workspace ID field), so it finds that tenant's account; the back-office log-in, which names no workspace, finds staff only.
- Staff and platform administrators keep one address across the platform (a partial unique index); the same address may still have ordinary accounts in workspaces.
- Once two tenants hold the same address, patch 0098 cannot be undone.
