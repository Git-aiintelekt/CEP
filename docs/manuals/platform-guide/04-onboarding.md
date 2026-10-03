# Onboarding a Tenant

**Where:** Tenants → Onboard a tenant (the rocket button above the list).

## What this is for

How a new workspace comes in: six steps that gather everything a workspace needs, kept as a draft in your session until the last step writes it all in one go: the tenant, its partitions and routing, the three starting roles, the platform's tags, the subscription, the first administrators with their password links, and the hand-off email. A draft left unfinished is announced at the top of the Tenants list with Continue and Discard.

## Who can use it

Platform administrators.

## The six steps

| Step | Asks | Checks and effects |
|---|---|---|
| 1 Workspace | Workspace name; Code; Subdomain; Custom app domain; Time zone; Region; Data residency; Hosting (shared, the usual choice, or dedicated). | Name and code unique; the code upper case, a letter then up to 19 letters, digits or underscores, fixed afterwards; the subdomain lower case; a known IANA zone. |
| 2 Plan and features | Subscription plan; Trial days (0 with a billing reference starts the subscription active); Billing reference (the customer at the billing provider: no invoice without it); Industry profile; one switch per feature: follow, on, off. | The table under the form shows where every switch comes from: catalogue default → profile → this workspace → plan. A plan can only take a feature away. |
| 3 First administrator | Full name; Email (must not exist in another workspace); Also invite (more administrators, one email per line). | Each gets the Workspace Admin role and a one-time password link. |
| 4 Policies (skippable) | The consent policy: People without consent (hold back or refuse), Texts need a consent date, Approval before first send, Consent lifetime. | Written into the workspace's settings; the administrator can change it under Settings → Consent Policy. The rest (quiet hours, security, tags, single sign-on) is shown, not asked. |
| 5 Hand-off (skippable) | A line from you. | Goes into the password-link email under the set-up list. |
| 6 Review and onboard | Everything in one place, and whether the platform's mail server can send the links. **Onboard CODE** does it. | |

## How to

**Onboard a customer.** Tenants → Onboard a tenant → the six steps → Onboard. The administrator's email carries the password link and the set-up list: choose a password, sign in, and the app's Set-Up page walks them through engines, senders, lists and the rest (User Guide: Setting Up a New Workspace).

**The link could not be emailed.** The flow says so with the link to copy; send it by hand. The platform's mail server (Configuration → Mail server) is what carries it; without one, every link has to be copied.

**Something was missed.** The tenant's page: Industry and features, the plan under Subscriptions, more users under Users (each with Create password link), Repair onboarding if the provisioning looks incomplete.

## What happens behind the scenes

The last step runs in one transaction on the platform connection: the tenant row with its settings (industry, feature overrides, the consent policy when step 4 was answered, onboarded at), the feature cache invalidated, the provisioning (partitions for every partitioned table for the months ahead, the database routing row, the three starting roles, the coupon tags, a copy of every active platform tag, the integration records), the subscription (a trial with its end date, or active when 0 trial days and a billing reference), and the users with no password and the Workspace Admin role. Then the mail, one per user. Onboarding is idempotent: running the provisioning again changes nothing that exists.

## Things to know

- Nothing is written before the last step; a discarded draft leaves no trace.
- Password links last `security.password_link_hours` (72 by default); a new link from the user's page replaces an expired one.
- The workspace's readiness, and the app's Set-Up page, pick up where the flow leaves off.
