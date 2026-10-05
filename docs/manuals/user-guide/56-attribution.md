# Attribution

**Where:** Settings → Integrations → Attribution.

## What is attribution

Attribution answers one question: **which campaign earned this order?** The shop sends CEP its orders (and the point of sale its store sales, if you choose). CEP matches each order to the customer, looks back at what it sent that customer, and credits the order to one campaign. Adding those orders up gives each campaign its **revenue**, and with its cost, its **ROI**.

CEP credits an order to the first of these that applies:

1. **A campaign code.** The order carries the campaign's code (for example CMP-2026-0042), as `campaign_code` or as one of its coupon codes. That campaign gets it, whatever else happened.
2. **The latest click** on a campaign's link by that customer within the **Click Window** (7 days by default).
3. **The latest open** of a marketing email within the **Open Window** (1 day by default).
4. **The latest text** delivered to that customer within the **Text Window** (1 day by default). Text links are not tracked yet, so delivery stands in for a click.

One campaign gets the whole amount (this is called *last touch*). An order that matches none of these is **Not Credited**, and the page says why. A refund follows its original order and takes the money back from the same campaign.

Until attribution is on, every revenue figure in CEP reads *Not Set Up*: Home's Attributed Revenue, Campaign ROI, Marketing Performance and Top Campaigns, each campaign's revenue against its target, the Reports revenue column, and the e-receipts' Revenue from Receipt Offers.

## Who can use it

| | |
|---|---|
| Permission | Read with `report.view`; changed with `user.admin`. The shop sends orders with an API key that has the scope `orders:ingest`. |

## How to configure attribution

**1. Make a key for the shop.** Settings → API Keys → New Key, with the scope `orders:ingest`. Copy it: it is shown once.

**2. Switch it on.** Settings → Attribution → **Attribution** on. From now on the shop's orders are accepted (while it is off they are refused with 409), and every campaign that has ever sent gets figures within five minutes, 0 until its first order.

**3. Choose the windows.** Each saves as you change it.

| Setting | Choices | Means |
|---|---|---|
| Click Window | 1, 3, 7, 14 or 30 days | How long after a click the click still earns an order. |
| Open Window | Opens Do Not Count, 1, 2, 3 or 7 days | How long an open of a marketing email earns an order when there was no click. Scanner opens and receipts never count. |
| Text Window | Texts Do Not Count, 1, 2, 3 or 7 days | How long a delivered marketing text earns an order when there was no click or open. |

**4. Count store sales** (shown when the workspace has POS Receipts). Switch **Count Store Sales** on and every transaction the point of sale posts also becomes an order: the amount without tax and shipping, the customer, the store and its promotion codes. Returns become refunds; employee sales are left out.

**5. Enter the send costs.** **Send Costs**: what 1,000 delivered emails and 1,000 delivered texts cost you, then **Save Costs**. A campaign's cost is then its delivered messages at these rates plus its offer cost, and ROI, contribution and cost per conversion follow. Left empty, ROI uses each campaign's planned cost.

**6. Connect the shop.** Give the shop's developer the endpoint, the headers and the example under **Send Orders from the Shop**:

```
POST /api/v1/orders/
Authorization: Bearer <the API key>
X-Tenant: <the workspace code>

{"order_id": "W-100235", "amount": 129.50, "currency": "USD",
 "email": "jane@example.com", "ordered_at": "2026-10-04T14:30:00Z",
 "coupon_codes": ["FALL20"], "channel": "ONLINE"}
```

Each order needs `order_id` and `amount` (revenue to count, 0 or more) and names the customer by `party_id`, `email` or `phone`. Optional: `ordered_at` (defaults to now), `currency`, `channel` (ONLINE, STORE, APP, PHONE or OTHER), `campaign_code`, `coupon_codes`, `store_number`, `items`. A refund is `"type": "REFUND"` with the positive amount and `original_order_id`. Up to 500 at once as `{"orders": [...]}`.

## How to use it in real time

### What happens to an order, minute by minute

| When | What you see |
|---|---|
| The shop posts the order | The answer says Accepted, Duplicate (the same order was already received; it counts once) or Rejected with the field at fault. Every call is in Settings → Integrations' call log. |
| Within a minute | The order is in **Latest Orders** as **Waiting**. It also raises a Purchase event (and First Purchase for a customer's first order), so a journey that starts on a purchase enrols the customer within a minute. |
| One to five minutes later | The attribute-orders job credits it: **Credited** with the campaign and how (Campaign Code, Click, Open, Text), or **Not Credited** with the reason. It waits a minute after an order arrives so a click still on its way from the sending engine is counted. |
| Within five minutes | The campaign's figures are rewritten: revenue net of refunds, orders, buyers, cost, contribution, ROI. Home, the campaign's page and Reports show them on their next refresh. |

### Check that it works: one test order

1. Pick a customer you emailed recently who clicked the email (your own test address is best).
2. Post one order for them with the shop's key, using their email address and a small amount, for example with Postman or curl.
3. Within a minute it is in **Latest Orders** as Waiting; within five it reads **Credited** with that campaign and **Click**.
4. Open the campaign: its revenue now includes the amount. Home's Attributed Revenue includes it too.
5. Post the same order again: the answer says Duplicate, and nothing is counted twice. To remove the test amount, post a refund for it (`"type": "REFUND"`, `original_order_id`).

### Watch the orders as they come in

**Latest Orders** shows the newest 50: when, the order, the amount, and the campaign credited with how, or why none. Filter **State** by **Credited**, **Not Credited** or **Waiting**; **Search** by order, email or campaign.

**Last 30 Days** sums them up: orders, revenue net of refunds, the revenue credited and the share of orders credited, orders not credited and waiting, credit by Campaign Code, Click, Open and Text, and the **Top Campaigns**.

### Read the results

| Where | What it shows |
|---|---|
| Home | Attributed Revenue, Campaign ROI (revenue per $1 spent), Marketing Performance (attributed revenue and campaign cost per day or week, with the target pace), Top Campaigns. |
| A campaign's page | Its Revenue and Conversions, against the targets set in its setup. |
| Reports | The revenue column per campaign. |
| E-Receipts on Home | Revenue from Receipt Offers (store sales credited to e-receipt campaigns). |
| Journeys | Purchase and First Purchase events start journeys and answer a Condition's "Made a Purchase". |

### Day-to-day tasks

**Credit a promotion outright.** Give the campaign's code (on the campaign's page) to the shop as the coupon, or have the shop send it as `campaign_code`. An order carrying it is credited to that campaign whatever the customer clicked.

**Find out why an order earned nothing.** Latest Orders → State: **Not Credited**. The reason is under each order: no customer CEP knows, no click, open or text within the windows, or a refund whose order was not credited.

**Change a window.** It applies to new orders. **Recalculate** (in Last 30 Days) judges the last 400 days of orders again under the current windows and rewrites every campaign's figures.

**Stop counting.** Switch Attribution off. New orders are refused (409) and revenue reads *Not Set Up* again; orders already received are kept.

## What happens behind the scenes

The attribute-orders job runs every five minutes. It finds the customer: the customer id, or whoever CEP emailed at the address or texted at the number in the last 120 days. It credits the order as above, then writes each campaign's actuals: revenue net of refunds, orders, buyers (distinct people, plus orders without a person), delivery cost, contribution (revenue minus cost), ROI (revenue over cost), revenue per delivered message and cost per buyer.

## Things to know

- Last touch is easy to explain and to check against the shop, but it gives no credit to the campaigns earlier in a customer's path.
- Revenue counts on the campaign whenever the order happens, so a campaign's figures grow for as long as its clicks are in the window.
- CEP keeps the amount, the customer, the store and the codes of an order, not its items or payment.
- An order for a customer CEP never emailed or texted, and with no customer id it knows, is Not Credited: there is nobody to match.
