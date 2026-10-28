# Onboarding a Tenant

**Where:** Tenants → Onboard a tenant (the rocket button above the list).

## What this is for

How a new workspace comes in: seven steps that gather everything a workspace needs, kept as a draft in your session until the last step writes it all in one go: the tenant, its partitions and routing, the three starting roles, the platform's tags, the subscription, its components and the base reports chosen for them, the first administrators with their password links, and the hand-off email. A draft left unfinished is announced at the top of the Tenants list with Continue and Discard.

## Who can use it

Platform administrators.

## The seven steps

| Step | Asks | Checks and effects |
|---|---|---|
| 1 Workspace | Workspace name; Code; Subdomain; Custom app domain; Time zone; Region; Data residency; Hosting (shared, the usual choice, or dedicated). | Name and code unique; the code upper case, a letter then up to 19 letters, digits or underscores, fixed afterwards; the subdomain lower case; a known IANA zone. |
| 2 Plan and features | Subscription plan; Trial days (0 with a billing reference starts the subscription active); Billing reference (the customer at the billing provider: no invoice without it); Industry profile; one switch per feature: follow, on, off. | The table under the form shows where every switch comes from: catalogue default → profile → this workspace → plan. A plan can only take a feature away. |
| 3 Components and reports | **Components**: the suite components the workspace gets, the plan's ticked. **Base Reports**: the ready-made report packs, each naming the components it needs. | Untick a plan component to switch it off for this workspace; tick one outside the plan to add it as an add-on (both kept under the tenant's Components). A pack whose component is left out is refused. A pack reads a database the workspace connects, so it is not added here: it is remembered, and Insights → Reports → Add Base Reports shows it as **Chosen at Onboarding**. |
| 4 First administrator | Full name; Email (must not exist in another workspace); Also invite (more administrators, one email per line). | Each gets the Workspace Admin role and a one-time password link. |
| 5 Policies (skippable) | The consent policy: People without consent (hold back or refuse), Texts need a consent date, Approval before first send, Consent lifetime. | Written into the workspace's settings; the administrator can change it under Settings → Consent Policy. The rest (quiet hours, security, tags, single sign-on) is shown, not asked. |
| 6 Hand-off (skippable) | A line from you. | Goes into the password-link email under the set-up list. |
| 7 Review and onboard | Everything in one place, and whether the platform's mail server can send the links. **Onboard CODE** does it. | |

## How to

**Onboard a customer.** Tenants → Onboard a tenant → the seven steps → Onboard. The administrator's email carries the password link and the set-up list: choose a password, sign in, and the app's Set-Up page walks them through engines, senders, lists and the rest (User Guide: Setting Up a New Workspace).

**The link could not be emailed.** The flow says so with the link to copy; send it by hand. The platform's mail server (Configuration → Mail server) is what carries it; without one, every link has to be copied.

**Something was missed.** The tenant's page: Industry and features, the plan under Subscriptions, more users under Users (each with Create password link), Repair onboarding if the provisioning looks incomplete.

## What happens behind the scenes

The last step runs in one transaction on the platform connection: the tenant row with its settings (industry, feature overrides, the consent policy when step 5 was answered, the base report packs chosen, onboarded at), the component decisions (an Off entry for each plan component left out, an Add-on entry for each other one ticked), the feature cache invalidated, the provisioning (partitions for every partitioned table for the months ahead, the database routing row, the three starting roles, the coupon tags, a copy of every active platform tag, the integration records), the subscription (a trial with its end date, or active when 0 trial days and a billing reference), and the users with no password and the Workspace Admin role. Then the mail, one per user. Onboarding is idempotent: running the provisioning again changes nothing that exists.

## Things to know

- Nothing is written before the last step; a discarded draft leaves no trace.
- Password links last `security.password_link_hours` (72 by default); a new link from the user's page replaces an expired one.
- The workspace's readiness, and the app's Set-Up page, pick up where the flow leaves off.
- Insights shows what the workspace's components fit: without Engagement, its datasets (Messages, Attributed Orders, Contacts, Journey Enrollments) and the reports built on them are not shown, and the workspace's own databases and uploads are listed under Insights. Add Base Reports offers only the packs its components fit.
