# The CEP Platform Guide

This guide is for the platform team: the people who run the back-office at `/admin`, create workspaces for customers, set the installation's parameters and keep it healthy. Workspace users have their own guide, the CEP User Guide; where the two meet (a workspace's set-up, its users, its sending), this guide says what the platform side does and leaves the rest to the User Guide.

## How the guide is organised

Each chapter follows a section of the back-office menu and has the same shape as the User Guide's: what the page is for, who can use it, the fields and controls (a table of what each is and what it changes), how to, what happens behind the scenes, things to know.

| Chapter | Menu section |
|---|---|
| Signing in and the two kinds of staff | the sign-in page, Account security, the second factor |
| The home page | Home, Alerts, Usage against limits |
| Tenants | Tenants, a tenant's page, its readiness |
| Onboarding a tenant | Tenants → Onboard a tenant |
| Industry profiles and features | Configuration → Industry profiles; a tenant's Industry and features |
| Plans, subscriptions, usage and invoices | Plans, Subscriptions, Invoices, Usage against limits |
| Global parameters | Configuration → Global parameters |
| The platform's mail server | Configuration → Mail server |
| Personalization tags | Configuration → Personalization tags |
| Users, roles, API keys and support sessions | People and access |
| Single sign-on | People and access → Single sign-on |
| Jobs, alerts and system checks | Operations → Job runs, Alerts, the home page's checks |
| Moving, exporting and offboarding a tenant | Tenants → Move and offboard |
| Routing, storage and retention | Operations → Database routing, Storage and CDN, Partition retention |
| The read-only sections | Campaigns, Delivery, Customers and lists, Content, the audit trail |
| Errors, uptime and tenant performance | Overview → Errors, Uptime, Tenant performance |

## Two ideas that run through everything

**Tenant and workspace are the same thing.** The back-office says tenant; the app says workspace. A tenant's code (for example `NWA`) is fixed once created: it names its partitions, its callback addresses and the `X-Tenant` header its API callers send.

**Where a setting comes from.** Many things resolve in layers: a feature's catalogue default, then the industry profile, then the tenant's own switch, then the plan, which always has the last word and can only take a feature away. A global parameter is the installation's default; a tenant's settings override it where the product allows. Each chapter says which layer a page writes.
