# Templates and Content

**Where:** Templates in the main navigation; a template opens in its own editor: the email designer, the message editor for texts, or the receipt editor.

## What this page is for

A template is the content a campaign sends: an email design, a text message, or an e-receipt. The Templates page is the library: start a new one from a channel or from a CEP preset, and find, rename, duplicate or preview the ones you have. Each channel has its own editor, full-screen, with versions kept on every save. A campaign picks a template on its Content step; a template is used by any number of campaigns and changing it changes what those campaigns send from then on.

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
| A template's card | Name, channel, status, when it was last used and by which campaign. | Opens the editor. |
| Card menu | Preview, Rename, Duplicate (a draft copy of the latest version), Delete. | Delete is refused while a campaign uses the template. |
| Starting Point gallery | CEP's presets by category. A preset opens in a read-only preview first. | Copy This Template makes it yours as a new draft; the preset itself never changes. |

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
| The message | The text, with live counting of characters and parts: a text over 160 GSM characters, or 70 with an emoji or an accented letter, is sent as more than one part and the carrier bills each. | What is sent. |
| Insert Personalization Tag | A tag at the cursor. | Filled in per recipient; the counter uses the sample value. |
| Picture (MMS) | One image, uploaded here, with a public address the aggregator fetches. | |
| The preview | The message in a phone frame as the sender's number. | |
| STOP line | A marketing text must tell people how to opt out. | The aggregator refuses a marketing text without one. |
| Save, Activate, Version History | As in the designer. | |

### The receipt editor

| Control | What it is | What it changes |
|---|---|---|
| Presentation | Compact, Standard, Itemized, Store Register, or Custom HTML. | The shape of the receipt inside the email. |
| Receipt Sections | Order header, Customer & fulfillment, Items, Totals, Payment, Loyalty, Returns & support: each on or off (some are fixed), each with its own switches: the order number, date, store and receipt ID; the address shown; the item columns and row height; the totals rows and a savings callout; the payment method, always masked to the last four digits; points and tier progress; the policy text and an in-store return barcode. | What the point of sale's transaction is laid out as, at send time. |
| Show Inside Email Shell | Whether the receipt sits inside the outer email design. | |
| The outer design | The email around the receipt: brand header, marketing block, button, image, divider, footer, in the same designer. | |
| Sample Transaction | A POS or eCommerce sample to preview with; desktop and mobile; Send a Test. | |
| Checks | What a receipt needs before Activate. | |

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
- Only an active template can be published; a draft can be previewed and test sent.
- A marketing email must carry the unsubscribe link; the designer blocks Activate without it and the campaign cannot publish.
- Outlook for Windows ignores shadows; the field says so.
- A text template cannot have a subject line; a campaign on it cannot either.
