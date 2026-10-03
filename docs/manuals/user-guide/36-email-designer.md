# The Email Designer

**Where:** Templates → an email template, or New Template → Email. Full screen, with Back to Templates at the top left.

## What this page is for

The designer is where an email template is built: the subject line and preheader, and the design as blocks dragged onto a canvas. Everything is edited visually; the designer writes the email's source (MJML, a mark-up made for email) and the server renders the HTML every inbox gets, so what the canvas shows is what is sent. Every save is a version, nothing is overwritten, and a template is a draft until Activate makes it usable by campaigns.

This chapter is the long form. The Templates and Content chapter covers the library, the text message editor and the receipt editor.

## Who can use it

| | |
|---|---|
| Permission | `template.edit` to edit, save and activate. Without it a template opens read-only: the canvas can be browsed and the Preview used, nothing can be changed. |
| Features | Barcode and QR Code blocks need **dynamic_codes**; the Deliverability tab needs **deliverability_tests** and a Mailgun Inspect account under Settings. |

## The workspace, piece by piece

| Part | What it is | What it changes |
|---|---|---|
| The top bar | Back to Templates, the template's name and status, the three modes (Content, Preview, Deliverability) and History. | The mode you work in. |
| Subject | The subject line, with a tag picker and an emoji picker beside it; the counter turns amber past 60 characters (inboxes cut it there) and the field stops at 300; a hint appears when a word is one spam filters dislike. | The subject every campaign on this template sends, unless the campaign writes its own. Empty, it blocks Activate. |
| Preheader | The text an inbox shows after the subject, with the same pickers; amber past 90 characters. | Hidden text at the top of the email that inboxes show in the list. Optional. |
| Blocks (left rail) | The palette: Structure, Content, Brand and Commerce blocks, with a search. Drag a tile onto the canvas, or focus a tile and press Enter to add it below the selected block. | The design. |
| Assets | The workspace's image library: upload (PNG, JPEG, GIF, WebP, up to 5 MB), search, and pick a picture for the selected Image block. The same file uploaded twice is kept once. | The images the design uses. |
| Layers | The tree of what is on the canvas: sections, columns and blocks, with their names. Select, rename, reorder, hide on canvas. | A quick way to reach a block buried in a layout. |
| Tags | The workspace's personalization tags with their sample values. A tag inserts at the cursor while text is being edited; otherwise it is copied. | `{{tag}}` tokens filled in per recipient at send time. |
| The canvas | The email as it renders, desktop or phone width, with the selected block outlined. Click a block to select it, drag to move it, double-click text to edit it with the formatting toolbar. | |
| The settings panel (right) | The selected block's settings in three groups: Content, Layout, Appearance. Every field is listed under the block types below. | The block. |
| The footer | The note: errors that must be fixed, warnings that are advisory, or No errors; **Save**; **Activate** (draft only, with the reason when it cannot). | |
| Errors and Links pills | The findings on the design, each leading to the field or block concerned; every link in the design with its address and what is wrong with it. | |

## The blocks

| Group | Block | What it is | Settings that matter |
|---|---|---|---|
| Structure | One, Two, Three, Four Columns | A section with that many columns. Everything else goes into a column. | Section: Email Width, Padding, Full Width, Background Color, Corner Radius. Column: Width, Padding, Vertical Alignment, Background Color, Corner Radius. |
| Structure | Spacer, Divider | Empty vertical space; a line. | Height; Width, Alignment, Line Color, Line Width. |
| Content | Heading, Text | Rich text with the toolbar: bold, italic, links, lists, tags. | Alignment, Padding, Font Family, Font Size, Font Weight, Line Height, Text Color, Background Color (the cell behind the text). A link inside text gets Link Color and Underline. |
| Content | Image | A picture from the image library or uploaded now (PNG, JPEG, GIF, WebP, up to 5 MB). | Image, Alt Text (describe it for people who cannot see it; a missing alt is a finding), Link, Alignment, Width, Height, Max Height, Padding, Corner Radius. |
| Content | Button | A call to action. | Label, Link, Alignment, Width, Height, Margin (space outside), Padding (space inside), Font, Background Color, Text Color, Corner Radius. |
| Content | Custom HTML | Raw HTML you write, for things the blocks cannot do. It is sent as written, so keep to email-safe tables. | HTML, Width, Alignment, Margin, Padding, Background Color. |
| Brand | Header | Your wordmark, an optional tagline, on a brand bar. | Wordmark Text, Tagline, Alignment, Brand Bar Color. |
| Brand | Social Links | Icons for the networks you add, in a row or a column, with or without labels. | Add a Network, then per network: Network, Link, Label, Icon Size, Icon Background, Icon Corner Radius. |
| Brand | Footer | The address, the unsubscribe link and the small print. | The sender address and the legal text. The unsubscribe link must stay for marketing mail. |
| Commerce | Product Card | Image, name, price and a button for one product. | Image with Alt Text, Ratio, the text and the button's label and destination. |
| Commerce | Coupon | A headline, body text and a treatment for an offer, with the coupon tags ready to use. | Headline, Body (with quick tags for the coupon code), Alignment, Treatment. |
| Commerce | Barcode, QR Code | A code drawn per recipient from a tag's value, the coupon code uploaded with the list for example. | Source tag; barcode Format (Code 128, Code 39, EAN-13, UPC-A), Width, Height; QR Error Correction (Low, Standard, High, Maximum), Size; the value printed under the code; Alignment; Background. |

Settings every block shares, in Layout: **Margin** (space outside the block), **Padding** (space inside), **Hide on Phones** and **Hide on Desktop**. In Appearance, where the block allows it: Background Color, Border Width, Border Style, Border Color, Shadow (Outlook for Windows drops shadows; the field says so), Corner Radius. Lengths take px, %, em and rem and settle on px.

## Personalization

- Tags come from the workspace's catalogue (Settings → Tags): first name, last name, loyalty tier and so on, the three coupon tags, and the system tags that are always there: unsubscribe URL, current year, today, the campaign's name, the recipient's email.
- Insert one from the toolbar while editing text, from the Tags panel, or from the picker beside Subject and Preheader. Type it as `{{first_name}}` if you prefer.
- The canvas and the Preview show each tag's sample value; the sent email has the recipient's own, or the tag's default when the person has none. A tag that is not in the catalogue is a finding on Save.
- The coupon tags (`coupon_code`, `coupon_barcode_value`, `coupon_qr_value`) are filled from columns of the same names in the contact list's upload, so an offer can be unique per person.

## Preview mode

| Control | What it is |
|---|---|
| Preview As | Sample Values (the catalogue's samples), Full Profile (a complete customer), Empty Profile (a customer with nothing filled in, to see the defaults). |
| Device | Desktop (680 px) or Mobile (375 px). |
| Client | Generic, Gmail, Outlook, Apple Mail: the inbox row above the email shows the subject and preheader cut where that client cuts them, and the email is rendered with that client's quirks. |
| Appearance | Light or Dark: how the email looks in a dark-mode inbox. |
| Send a Test | The email, as previewed, to your own address or the addresses you type. |

## Deliverability mode

Run Inbox Previews renders the last saved version in real email clients through the workspace's Mailgun Inspect account, chosen under Settings → Sending → Deliverability Testing. Every test of the template is listed on the left; a result shows the renders grouped by client kind, a render opens full size. Tests count against the plan's monthly allowance, which Settings → Plan & Usage shows. Unsaved changes are not in a test: save first.

## Saving, versions and activating

- **Save** writes version n+1. The designer also saves a draft by itself 30 seconds after the last edit, unless the template is read-only, an older version is on the canvas, or the last save was refused.
- **History** lists every version with who saved it and when. Open one to look at it: the strip says *You are looking at version n*; saving from there makes it the newest version, nothing is lost; Back to Latest returns.
- **A conflict**: when someone else saved a newer version, the strip says so and offers Load Latest Version. Nothing is sent until you do.
- **Activate** runs the blockers: a subject line, the design saved at least once, an unsubscribe link for marketing mail, images with an alt text and no placeholder images, the HTML under Gmail's 102 KB clip limit. A template with an error cannot be activated; warnings are advisory. Once active, campaigns can pick it and publish.
- **Leaving** with unsaved changes asks first.

## Examples

### A welcome email from a starter

1. Templates → Email → name it *Welcome to Northwind* → Starting Point: Welcome email → Create.
2. Subject: `Welcome, {{first_name}}` from the tag picker; Preheader: *Your first order ships free this month.*
3. Select the Header block → Wordmark Text: Northwind Apparel → Brand Bar Color: your navy.
4. Double-click the hero text → write the welcome in two short sentences; keep the heading one line.
5. Select the Button → Label: Start Shopping → Link: your shop's address; Appearance → Background Color: Blue 600.
6. Preview → Client: Gmail → check the inbox row reads well cut at 100 characters; Device: Mobile → check the button is reachable with a thumb.
7. Send a Test to yourself, then Save and Activate. The campaign's Content step now offers it.

### A sale announcement with a personal coupon

1. New Template → Email → Starting Point: Sale announcement.
2. Drag a **Coupon** block under the hero. Headline: *20% off this weekend*; Body: insert the `coupon_code` tag from the quick tags, so each person sees their own code; Treatment: dashed.
3. Drag a **Barcode** block under the coupon. Source: `coupon_barcode_value`; Format: Code 128; the value under the code on. The canvas shows the sample value's bars; the sent email draws each recipient's.
4. Upload the contact list with columns named `coupon_code` and `coupon_barcode_value`; the list's people carry them.
5. A recipient with no code gets the email without the barcode block; the run's completion message says how many.
6. Preview As → Empty Profile shows what a person without a code sees. Save, Activate.

### A two-column newsletter with a phone layout

1. New Template → Email → Blank. Add a **Header**, then a **Two Columns** section.
2. Into the left column drag an **Image** (upload the cover picture; Alt Text: what it shows), into the right a **Heading** and a **Text**.
3. Below, a **Three Columns** section with a **Product Card** in each: image, name, price, Button → Destination: the product's page.
4. Switch the canvas to the phone. The columns stack; if the picture should come after its text on a phone, select the section → Layout → stacking: reverse. If the three cards are too much on a phone, select the third card → Hide on Phones.
5. Add a **Spacer** (Structure) between sections rather than padding on every block: one place to tune the rhythm.
6. Footer: keep the unsubscribe link; add Social Links (Brand) with your networks.
7. Preview → Appearance: Dark → check the header's wordmark is still readable on the dark bar. Save, Activate.

### Reusing a design

Duplicate from the library makes a draft copy of the latest version; change the copy and activate it. The original and the campaigns on it are untouched. For a seasonal variant, History on the copy still shows where it came from.

## Things to know

- The subject and preheader on the template are defaults: a campaign can write its own on its Content step without touching the template.
- Marketing mail must carry the unsubscribe link; the Footer block has it. Remove it and Activate refuses, and a marketing campaign cannot publish.
- Images are stored once per workspace and served from the media store; the same file uploaded twice is kept once.
- Email clients differ: Outlook for Windows has no shadows and no media queries (the phone rules use its own mechanism), Gmail clips emails over 102 KB. The Preview's clients show the common cases.
- A text template has no designer: SMS and MMS open the message editor, e-receipts the receipt editor.
