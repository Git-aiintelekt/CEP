# POS Receipts

**Where:** Settings → Integrations → POS Receipts.

## What this page is for

E-receipts from the point of sale: which e-receipt campaign renders them, what to tell the register software, the stores the transactions come from, and the trail of what was received. The point of sale posts each transaction as a TransactionTree (TTDR 3.2.2) document; C360 validates it, renders the receipt on the campaign's template and sends it through the campaign's sender and engine. Nothing about the transaction or the customer is kept, only the trail.

## Who can use it

| | |
|---|---|
| Permission | `user.admin` to open Settings; the trail is read with `campaign.view`. |
| Features | **ereceipt**; text receipts need **sms** as well. |

## The fields and controls

### E-Receipt Campaign

| Field | What it is | What it changes |
|---|---|---|
| Email Receipt | The published e-receipt campaign that renders the email receipt. Needed when more than one is published. | Sent when the transaction's EntryType asks for email. |
| Returns and Exchanges | Optional: another campaign for refunds. Empty uses the same campaign. | A return renders as a refund: negative amounts, the tender as a refund. |
| Text Receipt | An e-receipt campaign on the SMS channel. | Sent when EntryType asks for a text. Empty: no text receipts. |
| Phone Numbers Are From | US, CA or none. | A ten-digit number from a register is read with +1; numbers sent with a country code are used as sent. |

### Tell the Point of Sale

| Item | What it is |
|---|---|
| Endpoint | The address to POST to, as application/xml or the form field XmlInput, with Copy. |
| Headers | `X-Tenant-Key` with the workspace code and `accessTokenKey` with the API key, or `Authorization: Bearer`. |
| API Key | One with the scope `receipts:send`, made under API Keys. |
| Answers | The XML answers: S100 email receipt sent, S101 accepted but no email address, S102 already received, S103 text receipt sent, S104 printed with no e-receipt, S105 text asked for but not sent, and the E-codes for refused documents. |
| What triggers a receipt | The transaction's EntryType: EMAIL, BOTH, ALL and every value naming EMAIL send the email; SMS values send the text; PRINT, NOPRINT, PUSH and NONE send nothing. |

### Stores

| Control | What it is | What it changes |
|---|---|---|
| The table | The stores: number, name, address, return policy, In Use. | The store's name and address on the receipt; the return policy in its Returns & support section. |
| Add Store, Edit | Number, name, address lines, phone, return policy, In Use. | |
| Import CSV | A file of stores. | |

### Received from the Point of Sale

| Control | What it is |
|---|---|
| Answer, Transaction ID | Filters by the code answered and the transaction number. |
| The table | Every transaction received: when, store, transaction, what was answered, the receipt's status. A row opens the call in the log with the document as received, masked. |

## How to

**Connect a register.** API Keys → a key with `receipts:send` → here, copy the endpoint and give the register software the endpoint, the two headers and the key → publish an e-receipt campaign → choose it under Email Receipt → add the stores → run one test transaction and find it under Received.

**A store prints when it should email.** Received → Answer: S104. The register sends an EntryType without EMAIL; the store's register settings are the fix.

## What happens behind the scenes

The document is checked against the TTDR schema; the merchant, store, register, transaction number and date make the transaction unique, so a register that retries gets S102 and nothing is sent twice. The receipt is rendered with the receipt, store and transaction tags and the campaign's receipt layout, sent through the campaign's engine, recorded as a message under the campaign's run of the day with callbacks like any other, and answered in the same call. A text receipt goes the same way through the text engine.

## Things to know

- A paused POS integration answers E503 to every register; nothing is queued.
- A receipt to a blocked address is refused with its reason in the answer; the trail keeps it.
- With Count Store Sales on under Settings → Attribution, each transaction also becomes an order credited to a campaign: the amount without tax, the customer, the store and its promotion codes. Off (the default), nothing about a transaction is kept but the trail.
