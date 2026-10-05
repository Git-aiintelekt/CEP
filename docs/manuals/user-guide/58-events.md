# Events

**Where:** Settings → Integrations → Events.

## What this page is for

What happened to a customer: a purchase, an abandoned cart, a birthday, a tier change. The shop and the loyalty system send events to CEP, and CEP raises some itself. A journey whose entry is an event enrols the customer within a minute, and a Condition step can check for one. This page shows what arrived, how to send events, and the coupon requests journeys leave for C360.

## Who can use it

| | |
|---|---|
| Permission | `user.admin`. The shop and the loyalty system send events with an API key that has the scope `events:ingest`; C360 reads and answers coupon requests with a key that has `coupons:issue`. The workspace needs the Journeys feature; without it events are refused. |

## The fields and controls

| Part | What it shows |
|---|---|
| Last 7 Days | How many events arrived, by type, and when the last one came. Events naming a customer CEP does not have yet are counted separately: they enter journeys once the customer arrives from C360, within seven days of the event. |
| Raised by CEP Itself | **Purchase** and **First Purchase** from every order Attribution receives (and every store sale, when Attribution counts them); **Coupon Issue** from every Issue Coupon step; **Loyalty Tier Change** from every Update Loyalty Tier step that changes the tier; **Preference Update** from every preference-centre save that changes a channel or a topic; **No Response** for lapsed engagers (below); **Email Open/Click** and **SMS Response**, read from CEP's own tracking (security scanners left out). These need nothing sent. |
| Send Events | The endpoint, the headers, the key's scope and how many keys have it, and one event as an example. |
| Coupon Requests for C360 | How many requests are waiting, issued and failed, and how C360 reads and answers them. |
| Latest Events | The newest 50 events, sent or raised by CEP: when it arrived, the event and its id, the customer, the source and when it happened. Filter by type; search by customer, event id or source. Opens, clicks and text replies are not listed here. |

## The event types

Customer Creation (`CUSTOMER_CREATED`), Welcome (`WELCOME`), Birthday (`BIRTHDAY`), Anniversary (`ANNIVERSARY`), Purchase (`PURCHASE`), First Purchase (`FIRST_PURCHASE`), Category Purchase (`CATEGORY_PURCHASE`), Abandoned Cart (`CART_ABANDON`), Coupon Issue (`COUPON_ISSUED`), Coupon Redemption (`COUPON_REDEEMED`), Segment Inception (`SEGMENT_INCEPTION`), Segment Change (`SEGMENT_CHANGE`), Loyalty Tier Change (`LOYALTY_TIER_CHANGE`), Preference Update (`PREFERENCE_UPDATE`), Address Change (`ADDRESS_CHANGE`), No Response (`NO_RESPONSE`), Email Open/Click (`EMAIL_ENGAGEMENT`) and SMS Response (`SMS_RESPONSE`). Any other name in capitals and underscores (for example `STORE_VISIT`) is accepted too.

A journey's **Attribute Change** entry reads these: Loyalty Tier on `LOYALTY_TIER_CHANGE`, Preference Update on `PREFERENCE_UPDATE`, Address Change on `ADDRESS_CHANGE`. CEP does not keep a history of customer records, so the loyalty system sends the tier changes it makes, and C360 sends `ADDRESS_CHANGE` when an address changes (the new address in `payload`).

**No Response** is raised by CEP for a customer sent at least 3 marketing emails (not receipts) in the last 30 days who opened, clicked and replied to none of them, security scanners left out. One per customer in 30 days, and only while a live journey starts from it (checked every 15 minutes).

## How to

**Connect the shop or the loyalty system.**
1. Settings → API Keys → New Key, with the scope `events:ingest`. Copy the key; it is shown once.
2. Give the developer the endpoint, the key and the example from Send Events.
3. Each event needs `event_type` and the customer by `party_id`, `email` or `phone` (an email or number must match a customer). Add `event_id` so an event sent twice counts once; `occurred_at` defaults to now; `payload` holds the details (for example the cart's value).
4. The first events appear in Latest Events within a minute.

**Let C360 fulfil coupons.**
1. A key with the scope `coupons:issue`.
2. C360 calls `GET /api/v1/coupon-issuances/` for the waiting requests (the customer, the coupon, the journey).
3. For each, it issues the coupon and calls `PATCH /api/v1/coupon-issuances/<id>/` with `{"status": "ISSUED", "external_code": "…"}`, or `"FAILED"` with a `note`.

**Check that an abandoned-cart journey will fire.** Latest Events → Type: Abandoned Cart. If nothing is there, the shop is not sending; if the customer reads *Not in the customer records yet*, the customer has not arrived from C360.

## What happens behind the scenes

Events arrive at `POST /api/v1/events/`, one at a time or up to 500 as `{"events": [...]}`. Each comes back Accepted, Duplicate (the same `event_id` from the same source was already received) or Rejected with the reason (an unknown type format, no customer, an email or number that matches nobody, a time more than a day ahead or more than 400 days back). A call where every event is rejected answers 400. Every call is in Settings → Integrations' call log.

The enrol job reads events every minute. An event counts for a journey that was live when it happened, at most seven days back.

## Things to know

- CEP keeps the event's type, customer, time, source, id and payload (up to 8,000 characters), not more.
- CEP never makes coupon codes; C360 does.
