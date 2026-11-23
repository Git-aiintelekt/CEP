# Templates and Content

**Where:** Templates in the main navigation; a template opens in its own editor: the email designer, the message editor for texts, or the receipt editor.

## What this page is for

A template is the content a campaign sends: an email design, a text message, or an e-receipt. The Templates page is the library: start a new one from a channel or from a C360 preset, and find, rename, duplicate or preview the ones you have. Each channel has its own editor, full-screen, with versions kept on every save. A campaign picks a template on its Content step; a template is used by any number of campaigns and changing it changes what those campaigns send from then on.

## Who can use it

| | |
|---|---|
| Permission | `template.edit` to create, edit and activate; without it the library is read-only and previews still work. |
| Features | SMS and MMS templates need **sms** and **mms**; E-Receipt needs **ereceipt**; the Barcode and QR Code blocks need **dynamic_codes**. |

## The fields and controls

### The Templates page

| Control | What it is | What it changes |
|---|---|---|
| Start a new message | One card per channel you may use: Email, E-Receipt, SMS, MMS. | Opens New Template for that channel. |
| Your Templates | Search, a tab per channel, a Status filter (Draft, Active, Archived). | The library below. |
| A template's card | Name, channel, status, when it was last used and by which campaign. A drip message's template says which message it is ("Loyalty Welcome Series · Message 2 of 4"); a drip's templates sit together by name, and carry Locked while the drip is live. | Opens the editor. |
| Card menu | Preview, Rename, Duplicate (a draft copy of the latest version), Delete. | Delete is refused while a campaign uses the template, and while a drip uses it for a message ("This Template Is in Use", with the way to the campaign). |
| Starting Point gallery | C360's presets by category. A preset opens in a read-only preview first. | Copy This Template makes it yours as a new draft; the preset itself never changes. |

### New Template

| Field | What it is | What it changes |
|---|---|---|
| Name | Up to 200 characters. | How it is listed, and what a campaign's Content step shows. |
| Channel | Email (the drag-and-drop designer), E-Receipt (the receipt editor), SMS (the message editor with part counting), MMS (text plus one picture). Fixed once created. | Which editor opens and which campaigns can use it. |
| Description | What the template is for. | Shown in the library. |
| Starting Point | Blank, or one of the starters. | Version 1 of the design. |

A new template is a draft. Activate it from its editor when it is ready; only an active template can be published in a campaign.

### The email designer

The short tour; the chapter The Email Designer has every block and setting, and worked examples.

| Control | What it is | What it changes |
|---|---|---|
| Subject, Preheader | The template's subject line and the text an inbox shows after it. | The campaign uses them unless it writes its own. A missing subject blocks Activate. |
| The palette | Structure (one to four columns), Content (Heading, Text, Image, Button, Divider, Spacer, Social, Header, Footer, Custom HTML), Commerce (Product Card, Coupon, Barcode and QR Code where the feature is on). Drag a block onto the canvas or focus a tile and press Enter. | The design. |
| The canvas | The email as it will render, with desktop and phone views; a block selected shows its settings in the panel. | |
| The settings panel | Per block: text, links, images, colours, fonts, alignment; Margin and Padding; Border and Shadow; Hide on Phones and Hide on Desktop; a barcode or QR code's source tag, format and size. | Written into the email's MJML, the format the server renders to HTML. |
| Tags | The workspace's personalization tags, inserted at the cursor as {{first_name}} and the like. Unsubscribe URL, current year, today, campaign name and email are always available. | Filled in per recipient at send time. |
| Links | Every link in the design, checked for an address. | A missing or bad address is listed before Activate. |
| Errors | Findings: unknown tags, a missing subject, no unsubscribe link, HTML over Gmail's 102 KB clip limit. | Warnings on Save; blockers on Activate. A marketing campaign cannot publish without the unsubscribe link. |
| Preview, Send a Test | The compiled email with sample values, desktop and mobile; a test to your own address. | |
| Save, Activate | Save writes version n+1 and never overwrites an earlier one; Activate makes the template usable by campaigns. | A save on top of someone else's newer version is refused and the page offers to reload. |
| History | Every version with who saved it and when; open one and save to make it the newest. | |
| Code | The MJML source, for reading or pasting a block of raw markup. | |

### The message editor (SMS, MMS)

| Control | What it is | What it changes |
|---|---|---|
| Subject (MMS) | Optional, up to 80 characters. | Sent with the MMS; some phones show it. |
| Message | The text, up to 1,600 characters (10 parts). Under it, live counting: characters, parts and characters per part, what is left in this part, and the alphabet (GSM-7 or UCS-2). A text over 160 GSM characters, or over 70 once it holds an emoji or a character outside the standard SMS alphabet, is sent as more than one part, and the carrier bills each. With tags, the count uses their sample values; with UTM tracking on for texts, links to your sites are counted as short links. | What is sent. A longer text cannot be saved. |
| Insert Tag | The workspace's personalization tags, by group, put in at the cursor. | Filled in per recipient at send time. |
| Emoji | The emoji picker, put in at the cursor. | Makes the text a Unicode (UCS-2) message: 70 characters a part. |
| Use Plain Punctuation | Shown when curly quotes, long dashes, ellipses or invisible spaces push the text out of the standard SMS alphabet. Swaps them for plain ones. Also in a drip's text messages, with the characters named. | Brings the text back to 160 characters a part. |
| Pasting | Text pasted from Word, Google Docs or a web page: curly quotes (’ “ ”), long dashes (– —), ellipses (…) and invisible spaces become plain as they land. A note says how many changed; **Keep as Pasted** puts them back. | Keeps one stray character from turning the whole message into Unicode (70 characters a part, 67 when split, instead of 160 and 153). |
| At send time | Nothing to set. Just before a text goes to the gateway, C360 makes the same swap in the finished message, after the tags are filled, so a curly apostrophe in someone's own data (O’Brien, a store name) does not double their parts. A message that is Unicode anyway (an emoji, a non-Latin script) keeps its punctuation as written. | The Recipients tab shows the text as it was sent. Emoji are never changed: they keep a message in Unicode. |
| Picture (MMS) | **Choose from Library** (the workspace's images) or **Upload**: JPEG, PNG or GIF, up to 1 MB; under 600 KB is delivered reliably by every carrier. **Remove** takes it off. | The picture the MMS carries. An MMS without one cannot be published in a campaign. |
| Before Sending | Warnings as you type: characters outside the standard alphabet, emoji, more than three parts, unknown tags (sent as typed), and no opt-out wording. | Advice; the text can still be saved. |
| Opt-out wording | A marketing text must say how to stop, with words such as STOP, unsubscribe or opt out, or the **Opt-Out Text** tag {{opt_out_text}} ("Reply STOP to opt out. HELP for help. Msg&data rates may apply."). The tag's words are kept in one place, the platform's tag catalogue in the back-office, so every text says the same and a change there reaches every message. Without opt-out wording, **Before Sending** offers **Add the Opt-Out Text**, which adds the tag at the end. | A marketing campaign on a text without it fails the pre-publish check and cannot be published. |
| The preview | The message in a phone frame, from the workspace's default texting sender, with the tags' sample values. | |
| History, Activate, Save | **History** lists every saved version; open one and Save to make it the newest. **Activate** (on a draft, once saved) makes the template usable by campaigns. **Save** writes a new version. | As in the designer. The editor is read-only for someone without `template.edit`, for an archived template, and while a live drip uses it. |

### The receipt editor

| Control | What it is | What it changes |
|---|---|---|
| Layout | **This Template’s Own Layout**, or a layout from Templates → Receipt Layouts. With a library layout picked the settings below are read-only: **Edit Layout** opens it, **Make a Copy for This Template** turns it back into this template’s own. **Save to Receipt Layouts** puts this template’s own layout into the library. | Where the receipt comes from. A library layout reaches every template that picks it. |
| Presentation | Compact, Standard, Itemized, Store Register, or Custom HTML. | The shape of the receipt inside the email. |
| Receipt Sections | Order header, Customer & fulfillment, Items, Totals, Payment, Loyalty, Returns & support: each on or off (Order header, Items and Totals are always shown). Select a section to see its own settings, below. | What the point of sale's transaction is laid out as, at send time. |

The sections' settings:

| Section | Setting | What it is | What it changes |
|---|---|---|---|
| Order header | Order Number, Order Date, Store or Channel, Receipt ID | A switch each. Receipt ID is needed for expense and tax claims. | Which of these lines the receipt's header shows. |
| Customer & fulfillment | Address Shown | **Auto from Order** (the delivery address when the order has one, else the pickup place or store), **Ship To**, or **Pickup At**. | Whether the section reads Delivery with the shipping address, or In store with the pickup place or store. An order without that address says "No address on this order". |
| | Delivery Estimate | On or off. | On: the delivery or pickup estimate the transaction carries ("Arrives Thu, Sep 25", "Ready for pickup Sep 21, 4:00 PM") is shown under the address. A transaction without one shows nothing, whatever the switch says. |
| Items | Product Image, SKU, Quantity, Unit Price, Amount; Row Height (Compact or Default) | The item table's columns and how tall its rows are. | |
| Totals | Subtotal, Discounts, Tax, Shipping, Tip; Savings Callout | The totals rows, and a highlighted line on the discount under the total. | Discounts, Shipping and Tip show only when the transaction has them, and Shipping never on an in-store (POS) receipt. The Savings Callout shows only when the transaction has a discount. |
| Payment | Payment Method, Authorization Time, Billing Address | Payment Method is always masked to the last four digits. | |
| Loyalty | Points Earned, Points Balance, Tier Progress | A switch each. | Points Balance on: the customer's points balance after this purchase, as the transaction reports it, shown as "Points balance". The whole section shows only when the transaction says the customer is in the loyalty programme; Tier Progress only when the transaction carries it ("620 points to Gold"). |
| Returns & support | Policy Text, In-Store Return Barcode | The returns wording, and a barcode the store can scan for a return. | |
| Show Inside Email Shell | Whether the receipt sits inside the outer email design. | |
| The outer design | The email around the receipt: brand header, marketing block, button, image, divider, footer, in the same designer. | |
| Sample Transaction | A POS or eCommerce sample to preview with; desktop and mobile; Send a Test. | |
| Checks | What a receipt needs before Activate. | |

The Store Register's settings (select a part under Receipt Parts):

| Part | Setting | What it changes |
|---|---|---|
| Title & Header | The title (YOUR RECEIPT), and the six transaction fields: rename, hide, reorder. | The block at the top, in rows of three. |
| Columns | One line per column: its header, and what it shows when the two differ (Qty, Shows Quantity). The pencil (**Edit**) opens the column's Header and Shows; **Done** closes it. Add up to 5 columns (Size, Colour, Quantity, Unit Price, Discount, Line Tax, SKU, UPC, Status); a new one opens for editing. Remove or reorder them. The item is always first and its amount always last. Under the item: Discount, Qty @ Price, SKU, UPC. | The item table. Every value comes from the point of sale's transaction. |
| Totals & Tenders | Rename or hide Subtotal, the taxes, Paid with and Cash Change (TOTAL is always shown). Taxes: **With the rate**. Paid with: **With the authorisation**; an empty label prints the tender alone (CREDIT-VISA). TOTAL: **A size larger**. **Add Row**: Order Discount (with its code), You Saved (the lines' discounts and the order's, in the discount colour), Shipping, Tip, Items Sold, Points Earned, Points Balance. **Layout**: **Beside the Figures** (Subtotal: right beside its figure) or **Label Left** (no colons). | The rows under the items, always in the same order. The figures come from the transaction; a row with nothing for a receipt (no shipping, no loyalty) drops out of that receipt. |
| Colours & Text | **Theme**: Lilac (as before), Paper, Ink or Blue. **Customise Colours**: Frame, Cards, Column Headers, Text, Discounts and Savings, by picker or hex code. **Around the Receipt**: Choose a Colour fills the space between the frame and the email's edges; Use the Email's Background goes back to the email's own (as before). **Font**: Helvetica, Georgia or Courier. **Text Size**: Small, Medium, Large. **Title**: size and Centre or Left. **Labels**: bold header labels; column headers in capitals. | The whole receipt. Text on a dark colour turns white by itself, so it stays readable. Only fonts every mail app has are offered. |
| Footer Text | Up to 500 characters with tags, centred or left. | Text inside the receipt under the totals; a tag that is empty for a receipt drops out. |
| On Phones | **Fold Extra Columns Under the Item** or **Keep Every Column**. | On a phone, folded columns move to a line under the item. Mail apps that ignore phone rules show every column. |

A Custom HTML receipt has three parts: **Receipt** (the HTML around the lines, with `{{receipt_items}}` where the rows go), **Item Row** (one line, repeated per item, with `{{item.description}}`, `{{item.sku}}`, `{{item.upc}}`, `{{item.size}}`, `{{item.color}}`, `{{item.quantity}}`, `{{item.unit_price}}`, `{{item.discount}}`, `{{item.tax}}`, `{{item.amount}}`, `{{item.status}}`) and **CSS**. Without an Item Row, `{{receipt_body}}` still gives the built-in item table.

### Receipt Layouts

Templates → **Receipt Layouts** lists the receipt layouts E-Receipt templates can pick, with how many templates use each. **New Layout** starts one from Store Register, Standard, Itemized, Compact, Custom HTML, or a copy of another; each row's menu has Edit, Duplicate, Rename and Archive. Editing a layout used by templates names them before you save, because the change reaches all of them; a layout used by a template in a running drip cannot be changed until the drip ends. A layout a template still uses cannot be archived.

## How to

**Make an email from a preset.** Templates → scroll to Starting Point → open a preset → Copy This Template → name it → the designer opens with the copy; change the text and images, Save, Activate.

**Personalize.** Put the cursor in a text block, open Tags, pick First Name. The canvas shows the sample value; each recipient gets their own.

**Add a coupon with a barcode.** Commerce → Barcode; in the settings pick the source tag (for example the coupon code uploaded with the list) and the format. The sent email carries each recipient's own code; a recipient without a value gets the email without the block.

**Hide a block on phones.** Select it → Hide on Phones. The phone view of the canvas shows the result.

**Go back to an earlier version.** History → open the version → Save. It becomes the newest version; nothing is lost.

**Write a text that fits in one part.** Keep under 160 characters without emoji; the counter says how many parts the text will be sent as.

## What happens behind the scenes

1. The designer saves the design twice over: the editor's own state, to reopen exactly as left, and the MJML source. The server renders the HTML from the MJML, derives the text part, and checks the design (tags, subject, unsubscribe link, size). The browser never supplies the final HTML.
2. Every save is a new version in the template's history; Activate marks the template usable by campaigns.
3. At send time the engine fills the tags from the workspace's tag catalogue, the recipient's list columns and the customer record, draws each barcode and QR code, puts the campaign's subject and preheader in when it has its own, and for a receipt lays out the transaction the point of sale sent into the receipt slot.
4. Images are uploaded once per workspace and served from the media store, never embedded in the email.

## Things to know

- Changing a template changes what every campaign using it sends from then on. Duplicate when a campaign must keep its own version.
- A drip gives every message its own copy of a template, so a drip's messages never change other campaigns. Opened from the Drip Campaign Setup step the editor says which message it is, keeps the subject on the message (read-only here), and leads Back to Drip Campaign Setup. While the drip is live the copy is locked: the preview and the editor say "Used by a live drip (…). It can't be changed until the drip finishes or is stopped." and open read-only.
- Only an active template can be published; a draft can be previewed and test sent.
- A marketing email must carry the unsubscribe link; the designer blocks Activate without it and the campaign cannot publish.
- Outlook for Windows ignores shadows; the field says so.
- An SMS template cannot have a subject line, and a campaign on it cannot either; an MMS may carry the optional Subject above.
