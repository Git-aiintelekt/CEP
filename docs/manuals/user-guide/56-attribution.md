# Attribution

**Where:** Settings → Integrations → Attribution.

## What this page is for

Which campaign earned an order. The shop sends its orders to CEP, and the point of sale's sales can count too. Each order is credited to one campaign: the one named by a campaign code, else the person's last click, open or text before the order. Home's Attributed Revenue, Campaign ROI, Revenue vs. Cost and Top Campaigns, the Reports revenue column, each campaign's revenue progress and the e-receipts' Revenue from Receipt Offers all read the figures this fills. Until attribution is on they read *Not Set Up*.

## Who can use it

| | |
|---|---|
| Permission | Read with `report.view`; changed with `user.admin`. The shop sends orders with an API key that has the scope `orders:ingest`. |

## The fields and controls

| Field | What it is | What it changes |
|---|---|---|
| Attribution | On or off. | Off: the shop's orders are refused (409) and revenue reads *Not Set Up*. On: every campaign that ever sent gets figures within five minutes, 0 until its first order. |
| Click Window | 1, 3, 7 (the default), 14 or 30 days. | A click on a campaign's link takes the credit for an order the same person places within this time. |
| Open Window | Not counted, or 1 (the default), 2, 3 or 7 days. | With no click, an open of a marketing email takes the credit. Opens by security scanners and of e-receipts never count. |
| Text Window | Not counted, or 1 (the default), 2, 3 or 7 days. | With no click or open, a marketing text delivered to the person takes the credit. Text links are not tracked yet, so delivery stands in for a click. |
| Count Store Sales | Shown when the workspace has POS Receipts. | Every transaction the point of sale posts also becomes an order: the amount without tax and shipping, the customer, the store and its promotion codes. A return becomes a refund of its sale. Employee sales are left out. Off, nothing about a transaction is kept. |
| Send Costs | What 1,000 delivered emails and 1,000 delivered texts cost. | A campaign's cost becomes its delivered messages at these rates plus its offer cost; ROI, contribution and cost per conversion follow. Left empty, ROI uses each campaign's planned cost. |
| Last 30 Days | Orders, revenue net of refunds, the revenue credited and the share of orders credited, orders not credited and waiting, credit by campaign code, click, open and text, and the top five campaigns. | |
| Recalculate | Judges the last 400 days of orders again under the current windows and rewrites every campaign's figures. | Use it after changing a window. |
| Send Orders from the Shop | The endpoint, the headers, the key's scope and one order as an example. | |
| Latest Orders | The newest 50 orders: when, the order, the amount, and the campaign credited with how (or why none). Filter by Credited, Not Credited or Waiting; search by order, email or campaign. | |

## How to

**Turn attribution on.**
1. Settings → API Keys → New Key, with the scope `orders:ingest`. Copy the key; it is shown once.
2. Settings → Attribution → switch Attribution on.
3. Give the shop's developer the endpoint, the key and the example from Send Orders from the Shop. Each order needs `order_id` and `amount` and names the person by `party_id`, `email` or `phone`.
4. The first orders appear in Latest Orders within a minute; Home shows revenue within five.

**Credit a promotion outright.** Give the campaign's code (on the campaign's page, for example CMP-2026-0042) to the shop as the coupon, or have the shop send it as `campaign_code`. An order carrying it is credited to that campaign whatever the person clicked.

**Find out why an order earned nothing.** Latest Orders → State: Not Credited. The reason is under each order: no person CEP knows, no click, open or text in the windows, or a refund whose order was not credited.

## What happens behind the scenes

The shop posts orders to `POST /api/v1/orders/`, one at a time or up to 500 as `{"orders": [...]}`. An order sent twice counts once. Every call is in Settings → Integrations' call log.

The attribute-orders job runs every five minutes. It waits a minute after an order arrives, so a click still on its way from the sending engine is counted. It then finds the person: the customer id, or whoever CEP emailed at the address or texted at the number in the last 120 days. Credit goes, in this order, to a campaign named by code, the latest click within the click window, the latest open within the open window, then the latest text within the text window. One campaign gets the whole amount (last touch). A refund follows its original order and reduces that campaign's revenue.

The job then writes each campaign's actuals: revenue net of refunds, orders, buyers (distinct people, plus orders without a person), delivery cost, contribution (revenue minus cost), ROI (revenue over cost), revenue per delivered message and cost per buyer.

## Things to know

- Last touch is easy to explain and to check against the shop, but it gives no credit to the campaigns earlier in a person's path.
- Revenue counts on the campaign whenever the order happens, so a campaign's figures grow for as long as its clicks are in the window.
- CEP keeps the amount, the person, the store and the codes of an order, not its items or payment.
- Changing a window applies to new orders. Recalculate applies it to the past.
