# Message Costs

**Where:** Settings → Engagement → Message Costs.

## What this page is for

What texts cost this workspace, and the limits that apply before a campaign goes out. The platform team sets the price of an SMS part, an MMS and a WhatsApp message; you see those prices here, read-only. You set an approval limit and a monthly budget, and for WhatsApp the countries you send to.

Before the platform team adds a price the page says *Prices are not set up yet*: nobody in the workspace sees costs, limits cannot be set, and sending works as it always has.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` to open the page and change the limits. Seeing money anywhere else (templates, campaigns, results) needs **View Message Costs** (`cost.view`) on a role; Workspace Admin has it. |

## How a text is priced

| Channel | What you pay |
|---|---|
| SMS | recipients × parts each × (price a part + carrier fee a part). A part is 160 characters, 153 each when the message is longer; with an emoji or other special character, 70 and 67. |
| MMS | recipients × (price an MMS + carrier fee an MMS): one price whatever the length. |
| WhatsApp | delivered messages × the price for the template's category (Marketing, Utility, Authentication) in the recipient's country. A message that is not delivered is free, and so are replies within 24 hours of the customer's own message. |

Carrier fees are the carriers' own charges (US 10DLC and the like). Depending on what the platform team chose they are a line of their own, included in the price, or not charged.

## The fields and controls

| Control | What it is | What it changes |
|---|---|---|
| Prices | One row per text sender: the price of an SMS part, an MMS and the carrier fees. A coming change shows below the table with its date. | Nothing: ask the platform team to change a price. Campaigns sent before a change keep the price of their send date. |
| This Month | Every text sent this calendar month (campaigns, journeys and drips, e-receipts) plus production campaigns scheduled later in the month at their estimate; against the budget when there is one, with the days left. | Nothing; it is what the budget is checked against. |
| Approval Above | An amount a campaign. Empty: never. | A campaign whose estimate is higher needs approval before Publish to Production: its Review & Publish step shows the Approval card, as when Settings → Approvals is on. The author cannot approve their own. |
| Monthly Budget | An amount a calendar month. Empty: no budget. | Checked at Publish to Production: this month's spend plus the campaign's estimate. |
| Warn At | 50 to 100 percent of the budget. Default 80. | Once the month reaches it, administrators see *Message Budget* under Needs Attention on Home. |
| Over Budget | Warn Only, Needs Approval or Block Publishing. Default Needs Approval. | What happens when a campaign would take the month over the budget. Warn Only publishes; Needs Approval asks for an approver; Block Publishing refuses Publish to Production. E-receipts, journeys already running and sends already started are never held. |
| WhatsApp Countries | The countries, as Meta groups them, where you send WhatsApp. Shown with how many of your contacts have a number in each. | Numbers elsewhere are left out of WhatsApp campaigns (*Country Not Chosen for WhatsApp* on the campaign's Recipients tab) and are not counted in the estimate. All countries when none is chosen. |
| Home Country | One country. | Used for numbers saved without a country code, and for the headline price on WhatsApp templates. |
| WhatsApp Prices | A delivered message by category and country. Billing currency and Free Messages are set by the platform team. | Nothing. |
| Who Sees Costs | The roles with View Message Costs. Edit Roles opens Roles. | Everyone else sees parts and recipients, never money. |

## Where costs show

- **On a text template**, under the part counter: what one recipient costs at the default sender's price, as you type. Tags are counted with their sample values: a long value can add a part. On a WhatsApp template, the price of its category in your home country.
- **On a campaign**, an Estimated Cost card beside the Audience estimate and again on Review & Publish: only people who can receive the campaign are counted, each with their own text filled in and its parts counted (above 50,000 people, a sample). Before a template is picked it is a *From* price, one part each. Targets & Economics offers the estimate as the Planned Campaign Cost.
- **At Publish to Production**, the confirmation shows the estimate and the month's spend after it.
- **After sending**, a Cost card on the campaign's Performance tab: the actual figure from the parts each message used, or from Meta's delivery reports for WhatsApp, next to the estimate. Failed messages are included when the provider bills attempts.

## Things to know

- Estimates use the price on the send date: a scheduled campaign after a price change is estimated at the new price.
- The estimate counts people who can receive the campaign today; the real Campaign List is frozen when the send starts, so the actual can differ.
- WhatsApp estimates assume every message is delivered, so the actual is usually lower.
- Changing the limits does not touch campaigns already published.
