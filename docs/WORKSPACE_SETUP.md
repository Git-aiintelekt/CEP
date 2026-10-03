# Workspace set-up (the administrator's side)

The back-office onboards a tenant (`docs/TENANT_ONBOARDING.md`) and emails its first administrator a one-time password link with
the set-up list. From there everything happens in the app: they choose a password, sign in and land on **Settings → Set-Up**, a
page that knows what is done and what is not, and sends them to the Settings page for each step. Nothing on it is a new form; it is
a guide over the pages that exist. Built from `docs/mockups/workspace-setup.html`, Option 1 (the checklist page).

## The steps

Read from the workspace on every load, never ticked by hand (`apps/tenants/setup.py`):

| # | Step | Done when | Opens |
|---|---|---|---|
| 1 | Choose your password and sign in | the administrator has signed in (they are reading the page) | Account Security |
| 2 | Invite your team and give them roles | at least one other active user with a role | Users (Invite Users), Roles |
| 3 | Add an email engine | an active email engine whose last Check passed; *warn* with an engine not checked or whose check failed | Sending Engines |
| 4 | Add an email sender and verify it | a VERIFIED email sender on an active email engine; *warn* with a sender not verified | Senders (Verify Sender) |
| 5 | Add a text engine and a sender number (optional) | an active text engine with a verified sender number; *warn* with an engine but no sender | Sending Engines |
| 6 | Import your do-not-contact list, then your first contact list | a production list (ACTIVE, master, not refused) with people; suppressions are counted, not required | Suppressions, Contact Lists (Upload a List) |
| 7 | Decide who is told, and who approves (optional) | a notification recipient, or approvals on, or an API key | Notifications, Approvals, API Keys (with the feature) |

**Ready** = steps 1, 2, 3, 4 and 6 done. **Next** = the first required step not done; the page draws it blue with its hint and
makes its primary link the one blue button. A workspace with the sms feature off reads step 5 as not available.

## The endpoint

`GET /api/v1/workspace/setup/` (`user.admin`): `workspace` (name, code, plan, timezone), `viewer.first_name`, `steps[]`
(key, label, state done | todo | warn, tag, text, why, links[{label, to, primary}], optional), `done`, `total`, `ready`, `next`,
`dismissed`. `PUT {"dismissed": true | false}` hides or shows the Home card again (`tenant.settings.setup.dismissed_at`) and
answers the same payload.

## In the app

- **The page** `/settings/setup` (`pages/settings/WorkspaceSetupPage.tsx`), first in the Settings menu's Workspace group. A
  brand-new workspace (only step 1 done) is greeted *Welcome, {name}. Let's set up {CODE}.*; otherwise *Set Up Your Workspace*.
  The card shows *n of 7 done* with a meter, every step as a row, and the callout says what ready means; **Hide Until Later** /
  **Show on Home Again** drive the Home card. Ready: the callout says so and the button goes.
- **The first sign-in**: the sign-in page sets a session-storage flag as it leaves for the app (`features/setup/setup.ts`); the
  landing route (`features/home/LandingAfterSignIn.tsx`) reads it once and sends an administrator to Set-Up while the workspace is
  not ready and the card is not hidden. Every later visit to `/` is Home.
- **The Home card** (`features/home/sections/SetupCard.tsx`): under the alerts, for administrators, *Set Up Your Workspace · n of 7
  done · Next: …* with **Continue Set-Up**, until ready or hidden. The Home source asks `GET /workspace/setup/` only for a viewer
  with `user.admin` (`liveSource.useSetup`); the playground's *Setting Up* state shows it on sample data.
- **Dev**: `/dev/settings/setup` renders the real page on `features/setup/sampleSetup.ts` (three steps done, the sender to verify
  next); `/dev/home` → Setting Up shows the card.

## Tests

`pages/settings/WorkspaceSetup.test.tsx` (the page, the greeting, the ready state, the Home card for administrators only, the
fresh sign-in landing), `pages/LoginPage.test.tsx` (the sign-in flow landing on Set-Up), `features/home/home.test.ts` (the source
wiring). Backend: the scratch suite `test_workspace_setup.py` against the local copy, rolled back (14 checks: the payload, each
step against the tables, ready and next, the dismissal, 403 for a user without `user.admin`).
