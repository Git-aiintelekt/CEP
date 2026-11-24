# Message Rates and Message Usage

**Where:** Tenants → a tenant → Message Rates (Manage Message Rates on the tenant's page); Tenants → Message Usage.

## What this is for

What an SMS part, an MMS and a WhatsApp message cost the platform (the **cost**, from the provider's contract or Meta's rate card) and what the workspace pays (the **price**). The workspace sees prices only: its database login is granted the price columns and nothing else, so costs, carrier costs and margins never leave the back-office. Until a tenant has a rate, its users see no costs anywhere and sending is not affected.

## Who can use it

Platform administrators.

## The tenant's currency

Set once, before the first rate (ISO 4217: USD, GBP, EUR). Cost and price share it. Changing it later ends every rate in force yesterday and deletes the ones that had not started: add the rates again in the new currency.

## A rate (SMS and MMS)

A rate never changes once in force. Changing a price adds a rate from a date (today or later), which ends the previous one for the same engine, sender type and destination the day before; a text is always priced at the rate of the day it was sent. A rate that has not started can be edited or deleted. On a rate in force, **Change From a Date** opens the form as a copy of it.

| Field | What it is | Rules |
|---|---|---|
| Sending Engine | One of the tenant's SMS or MMS engines. | Required. |
| Sender Type | Any, Short Code, Long Code (10DLC), Toll-Free, Alphanumeric. | Worked out from the sender's number: 3 to 8 digits a short code, a North American 8XX number toll-free, letters alphanumeric, any other number a long code. The most specific row wins: a Short Code row beats an Any row. |
| Destination | All Countries, or one country. | A country row beats All Countries. A recipient with no matching rate is counted as *no rate*, never priced at 0. |
| Effective From | A date, today or later. | Ends the previous rate the day before. |
| SMS Cost a Part | What the provider bills for one part. | Required, 4 decimals. |
| MMS Cost a Message | | Empty when the engine sends no MMS: MMS then has no price. |
| Carrier Fee a Part, an MMS | Carrier pass-through fees. | Default 0. |
| Failed Messages Are Billed | Whether the provider charges for messages carriers refuse. | Default Yes. Decides whether failed messages count in the actual figures. |
| Source | Where the figures come from. | For the record. |
| Pricing | Fixed Price or Markup on Cost. | With Markup, the price is cost × (1 + markup), rounded to 4 decimals. |
| SMS Price a Part, MMS Price a Message | What the workspace pays. | A price below the cost (with Included, below cost plus fee) is refused unless **Below Cost on Purpose** is ticked. |
| Carrier Fees to the Workspace | Passed On at Cost, Included in Price, Not Charged. | Passed On: the workspace sees the fee as its own line. Included: one figure. Not Charged: the platform absorbs it. |

The form shows the margin as you type: (price − cost) ÷ price, carrier fees left out when they are passed on.

**Copy From Another Tenant** copies the other tenant's rates in force on a date onto this tenant's engines of the same provider, from a date you give. Same currency only.

## WhatsApp rates

One rate card per WhatsApp engine (account) and date: Meta's cost of a delivered Marketing, Utility and Authentication message in each market, and how the platform prices it.

**Import Meta Rate Card.** Download the card from Meta's WhatsApp pricing page (CSV or Excel, in the account's billing currency) and upload it with the date it starts. The upload is checked first: markets read, the changes against the card in force, new and missing markets, and any fixed price the new costs would put below cost. Nothing is saved until you import. The new card keeps the previous card's pricing and fixed prices; the first card of an account is priced at cost until you set the pricing.

**Edit Pricing.**

| Field | What it is |
|---|---|
| Pricing Method | Markup on Cost (every market) or Fixed Price (a price for every market and category). |
| Markup | Percent on cost, 0 to 500. |
| Fixed Prices | A price for one market and category. With Markup, it overrides the markup there. |
| Other Countries | On: numbers outside the listed markets are priced at the card's Other row. Off: they cannot be priced, and the workspace cannot choose them. |
| Free Messages | Free, or a platform fee a message when Meta charges nothing (replies within 24 hours, ad entry points). The fee is its own line for the workspace. |
| Volume Discounts | Kept as Margin or Passed On. Estimates always use list rates. |
| Effective From | A card in force is never changed: new pricing starts from this date on a copy of its costs. A card that has not started is changed in place. |

Each WhatsApp message's charge comes from Meta's delivery report (billable or not, the category, the free reason), so the actual figures are exact. A country is matched to Meta's market by the number's dialling code: a market of its own first, then Meta's regional group (Rest of Latin America, North America …), then Other.

## Message Usage

Tenants → Message Usage. For a month: each tenant with rates, what its texts cost the platform, what it paid and the margin; choose a tenant for its campaigns (e-receipts together). Sandbox texts are not counted.

## What the workspace sets

In the workspace's Settings → Message Costs its administrator sets the approval limit, the monthly budget, the warning percent, what happens over budget, and for WhatsApp the countries it sends to and its home country. Roles with View Message Costs see money in the app; others see parts and recipients only.

## Things to know

- Apply patch `0099_message_costs.sql` before deploying the code.
- Rates are per tenant: a new tenant starts with none.
- The per-1,000 text rate in a workspace's Settings → Attribution is still used for campaigns that sent no priced text; a priced text campaign's actual delivery cost comes from its rates.
