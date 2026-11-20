# POS Receipts

**Where:** Settings → Engagement → POS Receipts.

## What this page is for

E-receipts from the point of sale: which e-receipt campaign renders them, what to tell the register software, the stores the transactions come from, and the trail of what was received. The point of sale posts each transaction as a TransactionTree (TTDR 3.2.2) document; C360 validates it, renders the receipt on the campaign's template and sends it through the campaign's sender and engine. Nothing about the transaction or the customer is kept, only the trail, unless Settings → Attribution counts store sales.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` to open Settings, choose the campaigns and change the stores; the stores and the trail are read with `campaign.view`. |
| Features | **ereceipt**; text receipts need **sms** as well. |

## The fields and controls

### E-Receipt Campaign

The campaigns offered are the workspace's e-receipt campaigns; one not yet published is marked *(not published)*. A receipt goes out only on a campaign published to production with a verified sender. Each choice is saved as soon as you make it, with a *Saved* tick.

| Control | What it is | What it changes |
|---|---|---|
| Email Receipt | The e-receipt campaign on the email channel that renders the email receipt. Empty reads *The one published campaign* when exactly one is published. | Sent when the transaction's EntryType asks for email. Empty with exactly one published campaign: that one is used. Empty with none or several published: every email receipt is refused with E120 *No campaign*, so choose one. |
| Returns and Exchanges | Optional: another email e-receipt campaign for returns and exchanges. Default *Same Campaign*. | A return or exchange goes out on this campaign instead of the Email Receipt one. Either way a return renders as a refund: negative amounts, the tender as *Refund to …*. |
| Text Receipt | An e-receipt campaign on the SMS channel. Empty reads *The one published text campaign* when exactly one is published, or *No text e-receipt campaign yet*. | Sent when EntryType asks for a text. With no text campaign chosen or published, the transaction is still accepted and answered S105 *Text not sent*, with the reason in the message; no text goes out. |
| Phone Numbers Are From | United States (+1, the default), Canada (+1), United Kingdom (+44), India (+91), Australia (+61). | A number from a register without a country code gets this country's code, and a leading 0 is dropped: *07911 123456* from a UK register is sent to +44 7911 123456, *0412 345 678* from an Australian one to +61 412 345 678. A number sent with + or 00 and its country code is used as sent. It decides whether a text receipt can be sent at all: a number that cannot be read is answered S105. |

### Tell the Point of Sale

| Item | What it is |
|---|---|
| Endpoint | The address to POST to, as application/xml or the form field XmlInput, with Copy. |
| Headers | `X-Tenant-Key` with the workspace code and `accessTokenKey` with the API key, or `Authorization: Bearer` with the API key and `X-Tenant` with the workspace code. |
| API Key | One with the scope `receipts:send`, made under API Keys; it is shown once. A revoked key stops the point of sale at once (E888 *Wrong key*). |
| Answers | The XML answers: S100 email receipt sent, S101 accepted but no email address, S102 already received, S103 text receipt sent, S104 no e-receipt asked for, nothing sent, S105 text asked for but not sent (the message says why), E1xx the document is refused (the message says where), E120 no campaign, E888 wrong key, E900 the engine did not accept it, call again later. |
| What triggers a receipt | The transaction's EntryType: EMAIL, BOTH, ALL and every value naming EMAIL send the email receipt; SMS, SMS_LINK, ALL and every value naming SMS send the text receipt (both when both are named; the text's outcome rides in the answer as `TEXT_STATUS`); PRINT, NOPRINT, PUSH and NONE are accepted and send nothing. A return or void renders as a refund; an exchange shows the returned lines as negatives. |

### Stores

A transaction names its store by number only. The store's details here fill the receipt's store tags.

| Control | What it is | What it changes |
|---|---|---|
| The table | Store (number · name, with the brand), Address, Phone, In Use, and Edit. | Nothing by itself: each In Use row fills the store tags of receipts from that number. |
| Add Store | Opens the store form, empty. | **Save** lists the store: receipts from that store number carry its details from the next transaction. A number already listed is refused: *Store … is already listed.* |
| Edit | Opens the store form for that store, titled *Store {number}*. | **Save** changes the details on every receipt from that store from the next transaction. Receipts already sent keep what they had. |
| Store Number | Required. Exactly as the point of sale sends it. | The match between a transaction and the store. A number that does not match is treated as an unlisted store (see below). |
| Name | Required. | The store name on the receipt. |
| Brand, District | Optional. | Fill the store's brand and district tags, for templates that use them. |
| Address 1, Address 2, City, State, Postal Code, Country | Optional. | The store's address on the receipt. |
| Phone, Email, Manager | Optional. | The store's phone, email and manager tags on the receipt. |
| Image URL | Optional. | The store's image tag, for a template that shows a store picture. |
| URL 1 to URL 4 | Optional. | Four link tags, for example the store page, directions, a survey or the returns page. |
| Return Policy | Optional, a few lines. | The return policy in the receipt's Returns & support section. |
| In Use | A switch, on by default. | Off: the store is kept but treated as unlisted, so its details are not used on receipts and the answer carries the unlisted-store note. |
| Remove | In the form of a listed store; asks first: *Remove store …? Receipts from it will carry only the number.* | Deletes the store. Receipts from that number then carry only the number and whatever the document gives. |
| Download Template | Saves *store-import-template.csv*: a header row with every column the import reads, and two sample stores. | Replace the samples with your stores (keep the header row), then Import CSV. Nothing changes until you import. |
| Import CSV | Choose a CSV file. It needs a header row with `store_number` and `name`; the other columns (the field names above, such as `address1`, `phone`, `return_policy`, `url1`) are optional. | Adds each new store and updates each store already listed under that number. The result says how many were added and updated, and which lines were skipped and why (for example *no store number*). |

### Received from the Point of Sale

The last 30 days, read from the call log, newest first. The list refreshes every 30 seconds.

| Control | What it is | What it changes |
|---|---|---|
| Transaction ID | Search by the transaction number. | Shows only that transaction's calls. |
| Answer | All Answers (default) or one code: S100 Receipt sent, S101 No email address, S102 Already received, S103 Text receipt sent, S104 Printed, no e-receipt, S105 Text not sent, E103 Document refused, E120 No campaign, E900 Engine refused. | Shows only the transactions answered with that code. |
| Clear Filters | Shown when a filter is set. | Shows everything again. |
| The table | Received (when), Transaction, Answer (the code, its words and the message), Receipt (*sent ·* the message id when a receipt went out). Rows do not open. Only the newest 100 are shown; narrow by answer or transaction id. | The receipt itself is on the campaign's Recipients tab, and the full XML under Integrations → Call Log. |

## How to

**Connect a register.** API Keys → a key with `receipts:send` → here, copy the endpoint and give the register software the endpoint, the two headers and the key → publish an e-receipt campaign → choose it under Email Receipt → add the stores → run one test transaction and find it under Received.

**Load all your stores at once.** Stores → **Download Template** → replace the two sample stores with yours in a spreadsheet (keep the header row; `store_number` and `name` are required, `is_active` is yes or no) → save as CSV → **Import CSV**. Run it again later to update them.

**A store prints when it should email.** Received → Answer: S104. The register sends an EntryType without EMAIL; the store's register settings are the fix.

**A receipt shows no store address.** The answer says *Store … is not in Settings -> POS Receipts -> Stores*. Add Store with that exact number, or switch it to In Use.

## What happens behind the scenes

The document is checked against the TTDR schema; the merchant, store, register, transaction number and date make the transaction unique, so a register that retries gets S102 and nothing is sent twice. The receipt is rendered with the receipt, store and transaction tags and the campaign's receipt layout, sent through the campaign's engine, recorded as a message under the campaign's run of the day with callbacks like any other, and answered in the same call. A text receipt goes the same way through the text engine; when both are asked for, the text goes first.

When the store number is not listed (or not In Use), the receipt still goes out: the store name reads *Store {number}*, the other store tags carry only what the document itself gives, and the answer says so. An address, phone or email the document carries for the store wins over the one listed here.

## Things to know

- A paused POS integration answers E503 to every register; nothing is queued.
- A receipt to a blocked address is refused with its reason in the answer; the trail keeps it.
- At the plan's message limit (a plan without overage), receipts are refused until the next month.
- With Count Store Sales on under Settings → Attribution, each transaction also becomes an order credited to a campaign: the amount without tax, the customer, the store and its promotion codes. Off (the default), nothing about a transaction is kept but the trail.
