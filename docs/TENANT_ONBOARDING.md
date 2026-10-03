# Tenant onboarding (back-office)

How a new workspace comes in, and how the platform team sees where any workspace stands. Platform staff only; the
workspace's own set-up (engines, senders, lists) stays with its administrator in Settings. The checklist spreadsheet
`docs/CEP_Tenant_Onboarding_and_Sending_Setup.xlsx` is the long-form guide; this is what the back-office does of it.

## 1. Onboard a tenant (Tenants → Onboard a tenant)

`apps/tenants/onboarding.py`, the view on `TenantAdmin.onboard_flow` (`/admin/tenants/tenant/onboard/`), template
`templates/admin/tenants/onboard.html`. Six steps, kept as a draft in the staff user's session; nothing is written before
the last step. A waiting draft is announced at the top of the Tenants list (Continue / Discard).

| Step | Asks | Checks |
|---|---|---|
| 1 Workspace | name, code, subdomain, custom app domain, time zone, region, data residency, hosting (shared / dedicated) | name and code unique; code `^[A-Z][A-Z0-9_]{1,19}$`, fixed afterwards; subdomain lower-case; a known IANA zone |
| 2 Plan and features | the subscription plan, trial days, billing reference, the industry profile, one switch per feature (follow / on / off) | the table under the form shows where every switch comes from: catalogue default → profile → this workspace → plan (a plan can only take a feature away) |
| 3 First administrator | full name, email, more administrators (one email per line) | the email must not exist; each gets Workspace Admin and a one-time password link |
| 4 Policies (skippable) | the consent policy: people without consent (hold back / refuse), texts need a date, approval before first send, lifetime | the rest is shown, not asked: quiet hours, security, tags, SSO |
| 5 Hand-off (skippable) | a line from the platform team | the set-up list the administrator receives with the password link |
| 6 Review and onboard | everything in one place, and whether the platform mail server can send the links | **Onboard CODE** runs `finish()` |

`finish()` in one transaction on the platform connection: the `tenant` row (settings: industry, feature overrides,
`consent_policy` when step 4 was answered; `onboarded_at` now), `params.invalidate`, `services.onboard_tenant` (partitions,
routing row, the three starting roles, platform tags, coupon tags, integration records), the `tenant_subscription` (TRIAL with
`trial_ends_at` unless 0 trial days and a billing reference: ACTIVE), the users with no password and the Workspace Admin role.
Once the administrator has chosen a password and signed in, the app takes over: the first sign-in lands on Settings → Set-Up, the
seven steps read from the workspace (`docs/WORKSPACE_SETUP.md`).

Then the mail: `password_link` with the hand-off checklist and the note (`templates/email/password_link.*`), one per user; a link that
could not be emailed is shown as a warning message to copy by hand. Onboarding stays idempotent: Repair onboarding on the tenant's
page runs the provisioning again.

`links.password_link(user)` builds the one-time address for both the flow and the Users page action.

## 2. Readiness (the tenant's page and the Tenants list)

`apps/tenants/readiness.py`: eight checks over existing tables, each with a state (ok / warn / todo), a sentence and the page that
fixes it. `templates/admin/tenants/readiness.html` is included above the tenant's form (`change_form_before_template`); the list
column shows *done of 8* with a meter (*Not onboarded* when nothing is done).

| Check | ok when | otherwise |
|---|---|---|
| Provisioned | partitions named with the tenant's `partition_seq` exist, a `tenant_database` row, at least one role | todo: Repair onboarding |
| Plan | a TRIAL or ACTIVE subscription with a billing reference | warn without the reference, todo without a subscription |
| Industry and features | an industry profile chosen; says how many features are on and which by override | warn: installation default |
| First administrator | an active user whose role holds `user.admin`, who has signed in | warn until the password link is used; todo when nobody holds it |
| Personalization tags | every active platform tag present in the workspace | warn with the number missing (Push again) |
| Consent policy | a policy chosen for the workspace | warn: platform defaults apply |
| Workspace sending (optional) | an engine per channel with a verified sender; read-only, theirs | warn without a verified sender, todo without an engine |
| Single sign-on (optional) | an active identity provider | todo: Register |

The summary counts ok checks of eight; the state is ok when every non-optional check is ok, todo when any non-optional check is todo,
warn otherwise.

## 3. Tests

Scratch suites against the local copy, rolled back: `test_readiness.py` (7 checks on NWA: the eight checks, the panel, the column) and
`test_onboarding.py` (24 checks: the steps, their validation, the draft notice, the feature table, skipping, review, finish and what it
makes, readiness straight after, nothing left behind). Sign-in for the admin client needs `user_logged_in.disconnect(update_last_login,
dispatch_uid="update_last_login")`: the user row lives on the platform alias.
