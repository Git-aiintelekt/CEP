# Industry Profiles and Features

**Where:** Configuration → Industry profiles; a tenant's page → Industry and features; a plan's Features.

## What this is for

A feature is a part of CEP that can be on or off per workspace. An industry profile is a starting point: which features a workspace of that kind begins with, and what it calls customers, locations and transactions. The tenant's own switches override the profile; the plan has the last word.

## Who can use it

Platform administrators.

## The feature catalogue

| Feature | What it switches on in the workspace | Default |
|---|---|---|
| Email campaigns | The email channel: templates, campaigns, engines. | on |
| SMS messages | The text channel: text templates and campaigns, text engines and senders, text lists. | on |
| MMS picture messages | Picture messages on top of texts. | on |
| E-receipts | E-receipt templates and campaigns, the point-of-sale endpoint, Settings → POS Receipts. | off; a plan may exclude it |
| Journeys | Journeys in the app and Active Journeys on Home. | on; a plan may exclude it |
| Subject-line A/B testing | The subject line test on a campaign's Test step. | on; a plan may exclude it |
| Loyalty tags and statements | The loyalty tags and the loyalty section of receipts. | off |
| API keys and integrations | Settings → API Keys. | on |
| Outbound webhooks | The chat webhook under Notifications. | on |
| Single sign-on | Settings → Security's single sign-on section. | on |
| Custom sending domain | A sending domain of the workspace's own. | off; a plan may exclude it |
| AI scoring | Scores on customers. | off |
| Barcodes and QR codes | The designer's Barcode and QR Code blocks and the codes drawn at send time. | off; a plan may exclude it |
| Deliverability tests | Inbox previews from the designer, within the plan's allowance. | on; a plan may exclude it |

### How a feature resolves

Catalogue default → the industry profile's value → the tenant's switch (Default, On, Off) → the plan's features, which can only take away. The result is what `GET /me/` tells the app, so a page that belongs to a feature that is off is not shown at all.

## The fields and controls

### An industry profile

| Field | What it is | What it changes |
|---|---|---|
| Code, Name, Description | The identity; the code is fixed. Seeded: General business, Retail, Hospitality and travel, Financial services, Healthcare. | |
| Features | One switch per feature: follow the catalogue, on, off. | The starting point for every tenant on the profile that leaves a feature on Default. |
| Vocabulary | What the workspace calls a customer, a location and a transaction (for example member, store, order). | The words the app uses in its labels. |
| Defaults | Starting settings for a new tenant on the profile. | |
| Active, Sort order | Whether the profile is offered when onboarding, and where in the list. | |

## How to

**Give a customer barcodes.** The tenant → Industry and features → Barcodes and QR codes → On. If the plan excludes it (Plans → the plan → Features), change the plan first.

**A new kind of customer.** Industry profiles → Add: the code, the vocabulary, the features that make sense; then onboard tenants on it.

## What happens behind the scenes

The resolved features and vocabulary are cached per tenant for a few minutes and invalidated when the tenant, its profile or its plan is saved. Changing a profile changes every tenant that follows it on the next request.

## Things to know

- Switching a feature off hides its pages but deletes nothing: a text campaign stays stored and comes back when the feature returns.
- The global parameter `tenancy.default_industry` names the profile a tenant without one follows.
