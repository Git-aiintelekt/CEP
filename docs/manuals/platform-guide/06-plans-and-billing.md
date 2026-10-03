# Plans, Subscriptions, Usage and Invoices

**Where:** Tenants → Plans, Subscriptions, Invoices; Overview → Usage against limits.

## What this is for

A plan is what a customer buys: its limits, its price and what it includes. A subscription puts a tenant on a plan, as a trial or active. Usage is metered per tenant per month and read against the plan; an invoice is drafted for each tenant at month end from the plan's price and any overage, and issued from here.

## Who can use it

Platform administrators. The workspace's administrator sees the result under Settings → Plan & Usage, read-only.

## The fields and controls

### A plan

| Field | What it is | What it changes |
|---|---|---|
| Code, Name | STARTER, GROWTH, ENTERPRISE as seeded; any code. | |
| Default hosting | Shared or dedicated for tenants on the plan. | The suggestion when onboarding. |
| Max contacts, Max messages per month, Max users, Max storage (GB), Max deliverability tests per month | The limits; empty means unlimited. | Usage against limits and the workspace's Plan & Usage read against them. Users refuses a new user past the limit; a deliverability test past the allowance is refused. |
| Overage per 1,000 messages, per 1,000 contacts | The price of going over; empty means a hard limit: sending stops at the message limit. | Whether a tenant at its limit is billed or stopped. |
| Monthly price, Currency | | The invoice's base amount. |
| Features | The features the plan allows, as switches; a feature switched off here is off for every tenant on the plan, whatever the tenant's own switch. | |
| Active | Whether the plan is offered. | |

### A subscription

| Field | What it is | What it changes |
|---|---|---|
| Tenant, Plan | | |
| Status | Trial, Active, Past due, Cancelled. | A cancelled subscription does not count; a tenant with none is unmetered and uninvoiced. |
| Started at, Trial ends at, Ends at | | A trial ending within 7 days is listed on the home page. |
| Billing reference, Billing subscription reference | The customer and subscription at the billing provider. | No invoice is raised without a billing reference. |

### An invoice

| Field | What it is | What it changes |
|---|---|---|
| Number, Tenant, Period, Plan, Base amount, Overage amount, Total, Line items | Drafted by the generate-invoices job from the month's usage. Drafts are recomputed on re-run; issued and paid invoices never are. | |
| Status | Draft, Issued, Paid, Void. | Draft invoices are not visible to the tenant. |
| Issue | The tenant can see it under Plan & Usage and the due date starts (`billing.invoice_due_days`, 14 by default). | |
| Mark as paid, Void | | |

## How to

**Put a trial customer on a paid plan.** Subscriptions → the subscription → Status: Active, the billing reference → Save. Or add a new subscription on another plan; the newest counts.

**Raise a limit for one customer.** Make a plan for them (copy the figures, change the limit) and move their subscription to it. Limits live on the plan, not the tenant.

**Month end.** The job drafts the invoices in the first days of the month; Home says how many drafts wait. Invoices → tick → Issue. Mark as paid when the money arrives.

## What happens behind the scenes

The rollup-usage job counts messages, contacts and storage per tenant from the source tables every three hours; the count is recomputed, not incremented, so a re-run is safe. Deliverability tests are counted live because the allowance is checked before every test. Publishing a campaign on a hard-capped plan that has used its messages is refused with the limit named; `billing.usage_warning_percent` (80) is where a meter turns amber.

## Things to know

- A plan's feature switch overrides every tenant on it; use it for what the plan sells, and the tenant's switches for exceptions above that.
- The Sandbox text engine is not metered.
