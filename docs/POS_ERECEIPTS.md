# Point-of-sale e-receipts (patch 0029)

The point of sale posts each transaction to CEP as a TransactionTree **TTDR 3.2.2** XML document; CEP validates it, renders the
e-receipt on the workspace's e-receipt campaign and sends it through the campaign's sender and engine. **Nothing about the
transaction or the customer is stored**: they belong to C360. What CEP keeps is the trail — the integration log row of the
call (the XML received, masked, and the XML answered) and the receipt's `mailer_execution` (address, status, the engine's
message id, callbacks). Code: `apps/pos/` (`ttdr.py` reads and validates, `mapping.py` turns the document into what the
receipt engine wants), `api/v1/pos_api.py` (the endpoint, the stores, the settings, the trail).

## 1. The endpoint

`POST {public address}/api/v1/pos/transactions/`

| | |
|---|---|
| Body | the TTDR document, as `application/xml` / `text/xml`, or form-encoded in the field `XmlInput` (the Customer 360 API convention) |
| Key | a workspace API key (Settings → API Keys) with the scope `receipts:send`, sent as `Authorization: Bearer cep_…` **or** as the header `accessTokenKey`; the workspace as `X-Tenant` or `X-Tenant-Key` (its code). Each workspace has its own keys; a revoked or expired key stops the point of sale at once, the key's IP allowlist and rate limit apply |
| Validation | the document is checked against the vendored schema `apps/pos/schemas/TTDR-3.2.2.xsd` (lxml); the root must be `Transaction` in the TTDR namespace; 2 MB at most |
| Idempotency | merchant number + store + register + `TransId` + transaction date: a register that retries gets `S102` and nothing is sent twice |
| Feature | the workspace's plan must include `ereceipt` (`E122` otherwise); a paused POS integration answers `E503` |

The answer is XML, whatever happened, in the shape the point of sale already reads:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<RESPONSE ResponseId="1790782710">
    <RESPONSE_DATE>2026-09-30 15:38:30.412</RESPONSE_DATE>
    <ORI_ORDER_ID>243309</ORI_ORDER_ID>
    <RESPONSE_CODE>S100</RESPONSE_CODE>
    <EXECUTION_ID>953</EXECUTION_ID>
    <MESSAGE_ID>9604a7e8-…@rp.emsb.lynxs.ai</MESSAGE_ID>
</RESPONSE>
```

| Code | HTTP | Meaning |
|---|---|---|
| `S100` | 200 | Accepted and the receipt was handed to the engine (`EXECUTION_ID`, `MESSAGE_ID`) |
| `S101` | 200 | Accepted; the recipient has no `EmailAddress`, so nothing was sent — ask the point of sale to include it |
| `S102` | 200 | This transaction was received before; the receipt is not sent again |
| `S103` | 200 | Accepted and the **text receipt** was handed to the text engine (`TEXT_EXECUTION_ID`, `TEXT_MESSAGE_ID`) |
| `S104` | 200 | Accepted; `EntryType` asks for no e-receipt (`PRINT`, `NOPRINT`, `PUSH`, `NONE`, the SMS registration flows) — nothing from CEP |
| `S105` | 200 | Accepted; a text was asked for but not sent — the message says why (no usable mobile number, no text campaign, number blocked, engine refused) |

**What triggers a receipt is the transaction's `EntryType`** (`api/v1/pos_api.py asks_for`): every value naming `EMAIL`, plus `BOTH`,
`ALL`, `PUSH_BOTH`, sends the **email** receipt to the recipient's `EmailAddress` (else `S101`); every value naming `SMS`, plus `ALL`,
sends the **text** receipt to the recipient's `PhoneNumber` on the workspace's text e-receipt campaign; `EMAIL_SMS`, `EMAIL_SMS_PRINT`
and `ALL` send both — the email decides the answer code and the text's outcome rides along as `TEXT_STATUS` (SENT / DUPLICATE /
NOT_SENT with `TEXT_MESSAGE`), `TEXT_EXECUTION_ID`, `TEXT_MESSAGE_ID`. `PRINT`, `NOPRINT`, `PUSH*`, `NONE`, `SMS_REGISTER` and
`SMS_UPDATE` are accepted and send nothing (`S104`). Any value outside the schema's list fails validation (`E103`). The trail keeps every
answer, so a store that prints when it should email shows up as a run of `S104`.

**Returns, exchanges, voids.** `TransactionType` is folded into a category (`ttdr.CATEGORIES`): Sale (SaleTransaction, Sale, EmployeeSale,
TaxExemptSale, WEBORDER, MOBILE, Delivery, CurbsidePickup, InStorePickup…), Return (ReturnTransaction, Return, EmployeeReturn,
TaxExemptReturn, InstantReturn, MobileReturn, PostReturn…), Exchange, Void (Voided, PostVoidSale, PostVoidReturn), Layaway, Reprint, Order;
anything else keeps its own name. A **Return or Void renders as a refund**: every amount negative, the tender "Refund to debit ···3425",
`receipt.refund = true`, `receipt.kind = Return`; the return campaign (Settings → POS Receipts) carries it when one is chosen, else the same
campaign. An **Exchange** shows only the lines whose `ItemReceivedType` is `Return` or `TradeIn` as negatives; voided lines (`ItemVoid`,
`ItemReceivedType Void`) and voided tenders are left out. Also read: `OriginalTransId` (and per line the original transaction, date and
store), `IsEmployeeTransaction`, `IsTaxExemptTransaction`, `GiftReceipt`, item discounts with their promo codes, transaction-level
discounts (`TransactionLevelDiscounts` and `Discounts/AdditionalDiscount…` → `receipt.discount_code`, tag `discount_words`), shipping and
handling totals, cash back, the card type and remaining gift-card balance.

**Text receipts** (`apps/pos/receipt_text.py`): an e-receipt campaign on the **SMS channel** (the setup dialog offers Email or SMS for an
e-receipt; its template is a message template with the same tags) chosen under Settings → POS Receipts → Text Receipt, or the one
published. The message is rendered with RECEIPT / STORE / TRANSACTION tags, sent through the campaign's sender and text engine
(Digivize, or the sandbox engine), recorded as an `sms_execution` under the campaign's run of the day (callbacks, STOP handling and
the Recipients tab apply), idempotent on the transaction key + `:SMS`. A number that replied STOP or is blocked is refused. Ten-digit
numbers are read as +1 when the workspace's *Phone Numbers Are From* setting is US or CA.
| `E101` / `E102` / `E103` / `E104` | 400 | No XML / not well formed / does not follow TTDR 3.2.2 (`RESPONSE_MESSAGE` says the line and the rule) / too large |
| `E120` | 409 | No e-receipt campaign is published, or more than one and none chosen under Settings → POS Receipts |
| `E121` | 422 | The address is blocked (hard bounce, complaint): nothing sent |
| `E122` | 403 | E-receipts are not in the workspace's plan |
| `E429` | 429 | Over the key's or the workspace's rate limit (`Retry-After`) |
| `E503` | 503 | The POS integration is paused in Settings → Integrations |
| `E888` | 401 | The key is missing, wrong, expired or revoked |
| `E900` | 424 / 422 | The sending engine did not accept the receipt: 424 = temporary, call again later; 422 = refused |

A sample document to try with: `GET /api/v1/pos/sample/` (signed in) returns the vendored sample with the caller's own address.

## 2. What the document becomes

Amounts in TTDR are whole cents (`8373` = 83.73) and quantities hundredths (`100` = one); a line's quantity is taken from its
own arithmetic (`ExtDollarAmount ÷ DollarAmount`), falling back to `QuantitySold ÷ 100`. `ItemsSold 600` = six items.

- **Recipient**: the first `Recipient` with an `EmailAddress` (else the first); its name, phone, `CustomerID`, loyalty card and
  level, birthday and address feed the tags. `CustomerID` is passed as the party id of the send, so the receipt lands under
  that customer when the workspace's customer copy knows it; nothing is written to the customer.
- **Receipt** (`mapping.receipt_of`): number = `TransId`, date and time, currency, subtotal / discounts / tax / total / change /
  amount paid, the tender in words (`Debit ···3425`, from the masked account number), the items (description, SKU, UPC, colour,
  size, quantity, unit price, discount, extended, tax, status), the tax lines, the barcode value (which the receipt layout's
  barcode block draws), the loyalty summary when sent. The receipt layout editor's sections render it exactly as they render
  a JSON receipt from `POST /receipts/send/`.
- **Store** (`mapping.store_tags`): the workspace's store row for `StoreNumber` (Settings → POS Receipts → Stores), with any
  address, phone or email the document itself carries laid over it.
- **Transaction tags** (source `TRANSACTION`, `mapping.transaction_tags`): everything below.

## 3. The tags

Added to the platform catalogue (inherited by every workspace; push them to an existing workspace as with the other seeds),
all on the `E_RECEIPT` channel. Standard-template names in brackets.

| Tag | Source · path | |
|---|---|---|
| `trans_id` (TRANS_ID) | TRANSACTION · id | |
| `trans_cat` (TRANS_CAT) | TRANSACTION · category | Sale / Return / Exchange / Void / Layaway / Order |
| `trans_date`, `trans_time` (TRANS_DATE) | TRANSACTION · date, time | |
| `register_number`, `terminal_id`, `clerk_id`, `clerk_name` | TRANSACTION · … | |
| `item_count` (ITEM_COUNT) | TRANSACTION · item_count | |
| `bar_code` (BAR_CODE) | TRANSACTION · barcode_value | the receipt layout's barcode block draws it |
| `layaway_number` (LAYAWAY_NUMBER) | TRANSACTION · layaway_number | |
| `customer_id`, `customer_fullname`, `email_address`, `phone`, `birthday`, `full_address` | TRANSACTION · customer.* | from the document's recipient |
| `loyalty_balance`, `loyalty_earned` | TRANSACTION · loyalty.* | when the document carries a loyalty summary |
| `store_id`, `store_name`, `store_brand`, `store_address`, `store_address_2`, `store_city`, `store_state`, `store_postal`, `store_country`, `store_district`, `store_phone`, `store_email`, `store_manager`, `store_return_policy`, `store_url1`–`4`, `store_image_url` | STORE · … | from the store list, the document's own address on top |
| `current_date` (CURRENT_DATE) | SYSTEM · today | |

Already there and unchanged: `receipt.number`, `receipt.transaction_at`, `receipt.subtotal` … `receipt.tender_summary`
(RECEIPT), `first_name` / `last_name` (CUSTOMER_MASTER), `{{receipt_body}}` (TRANS_HTML), `today`, `campaign_name`.
Not offered, because CEP has no such feature yet: SURVEY_SECRET / SURVEY_AUTO_SUBMIT, SR_STATUS, COUPON_ID, CLIENT_LOGO /
APPLICATION_URL (put the logo and the link into the template itself).

## 4. Settings → POS Receipts

- **E-Receipt Campaign**: the email campaign transactions go out on, optionally another one for returns and exchanges, the
  **text** campaign (SMS channel) for `EntryType` values that ask for a text, and *Phone Numbers Are From* (the country a ten-digit
  number belongs to). With exactly one published campaign of a kind no choice is needed. `GET` / `PUT /workspace/pos/`
  (`user.admin`, `tenant.settings.pos`: `campaign`, `return_campaign`, `text_campaign`, `default_country`); the answer also carries
  the endpoint, the tenant key, the header names and the scope to give the point of sale.
- **Stores** (`/stores/`, reads `campaign.view`, changes `user.admin`; `store` table, RLS, audited): number, name, brand,
  address, city, state, postal code, country, district, phone, email, manager, return policy, four URLs, an image URL, in use.
  **Import CSV** (`POST /stores/import/`, multipart `file`): a header row with `store_number` and `name` at least; a listed
  number is updated, a line without a number is reported.
- **Received from the Point of Sale** (`GET /workspace/pos/received/?code=&q=&days=`): the last 30 days of POS calls read
  from the integration log — when, `TransId`, the answer code and message, the receipt's execution and message id. The full
  XML of a call is under Settings → Integrations (search `receipt:<key>`); the receipt itself is on the campaign's
  **Recipients** tab, with Check with the Engine.

## 5. Tests

`test_pos.py` (scratchpad, rolled back, Postal faked): the reader on the sample document (units, items, tender, barcode), the
refusals (`E101`, `E103` with the reason, `E888`), the receipt dictionary, stores by hand and by CSV, the settings, `S100`
through the endpoint with the key as `accessTokenKey` and as a Bearer, the form field `XmlInput`, `S102` on a repeat, `S101`
without an email address, and the trail with its filters. `PosReceipts.test.tsx` covers the Settings page.
