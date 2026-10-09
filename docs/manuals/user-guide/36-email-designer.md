# The Email Designer

**Where:** Templates → an email template, or New Template → Email. Full screen, with Back to Templates at the top left and the help icon beside the template's name.

## What this page is for

The designer is where an email template is built: the subject line and preheader, and the design as blocks dragged onto a canvas. Everything is edited visually; the designer writes the email's source (MJML, a mark-up made for email) and the server renders the HTML every inbox gets, so what the canvas shows is what is sent. Every save is a version, nothing is overwritten, and a template is a draft until Activate makes it usable by campaigns and journeys.

This chapter is the long form: the workspace piece by piece, every block and setting, and then worked examples for each thing the editor can do. The Templates and Content chapter covers the library, the text message editor and the receipt editor.

## Who can use it

| | |
|---|---|
| Permission | `template.edit` to edit, save and activate. Without it a template opens read-only: the canvas can be browsed and the Preview used, nothing can be changed. |
| Features | Barcode and QR Code blocks need **dynamic_codes**; the Deliverability tab needs **deliverability_tests** and a Mailgun Inspect account: CEP's, or your own under Settings. |

## The workspace, piece by piece

| Part | What it is | What it changes |
|---|---|---|
| The top bar | Back to Templates, the template's name and status, the three modes (Content, Preview, Deliverability) and History. | The mode you work in. |
| Subject | The subject line, with a tag picker and an emoji picker beside it; the counter turns amber past 60 characters (inboxes cut it there) and the field stops at 300; a hint appears when a word is one spam filters dislike. | The subject every campaign on this template sends, unless the campaign writes its own. Empty, it blocks Activate. |
| Preheader | The text an inbox shows after the subject, with the same pickers; amber past 90 characters. | Hidden text at the top of the email that inboxes show in the list. Optional. |
| Blocks (left rail) | The palette: Structure, Content, Brand and Commerce blocks, with a search. Drag a tile onto the canvas, or focus a tile with the arrow keys and press Enter to add it below the selected block. | The design. |
| Assets | The workspace's image library: upload (PNG, JPEG, GIF, WebP, up to 5 MB), search, and pick a picture for the selected Image block. The same file uploaded twice is kept once. | The images the design uses. |
| Layers | The tree of what is on the canvas: sections, columns and blocks, with their names. Select, rename, reorder, hide on canvas. | A quick way to reach a block buried in a layout. |
| Tags | The workspace's personalization tags with their sample values. A tag inserts at the cursor while text is being edited; otherwise it is copied. | `{{tag}}` tokens filled in per recipient at send time. |
| The canvas | The email as it renders, desktop, tablet or phone width, with the selected block outlined and its breadcrumb (section → column → block) above. Click a block to select it, drag to move it, double-click text to edit it with the formatting toolbar. | |
| The canvas toolbar | Undo, Redo, Zoom In, Zoom Out, Fit to Width, Desktop / Tablet / Mobile, Show Block Outlines, Preview, Fullscreen, View Code, Download HTML. | How you look at the design; View Code and Download HTML hand it to someone else. |
| The settings panel (right) | The selected block's settings in three groups: Content, Layout, Appearance. Every field is listed under the block types below. | The block. |
| The footer | The note: errors that must be fixed, warnings that are advisory, or No errors; **Save**; **Activate** (draft only, with the reason when it cannot). | |
| Errors and Links pills | The findings on the design, each leading to the field or block concerned; every link in the design with its address and what is wrong with it. | |

## Starting a template

**New Template → Email** asks for a name and a **Starting Point**: Blank, or one of CEP's starters, which become version 1 of your template and are yours to change:

| Starter | What it holds |
|---|---|
| Welcome email | Brand header, a hero with a greeting, one button, footer. |
| Sale announcement | A headline and offer, a coupon block, a button, footer. |
| Monthly newsletter | Header, a lead story, two columns of stories, footer with social links. |
| Loyalty statement | The member's tier and points from tags, a reward block. |
| Win-back offer | A short note, an offer, a button. |

**Duplicate** on the library's row makes a draft copy of any template's latest version, which is the usual way to make a seasonal variant.

## The blocks

| Group | Block | What it is | Settings that matter |
|---|---|---|---|
| Structure | One, Two, Three, Four Columns | A section with that many columns. Everything else goes into a column. | Section: Email Width, Padding, Full Width, Background Color, Corner Radius, and on the phone canvas the stacking (On Phones: stack, reverse, Keep Side by Side). Column: Width, Padding, Vertical Alignment, Background Color, Corner Radius. |
| Structure | Spacer, Divider | Empty vertical space; a line. | Height; Width, Alignment, Line Color, Line Width. |
| Content | Heading, Text | Rich text with the toolbar: bold, italic, underline, strikethrough, a link, a tag, an emoji. | Alignment, Padding, Font Family, Font Size, Font Weight, Line Height, Text Color, Background Color (the cell behind the text). A link inside text gets Link Color and Underline of its own. |
| Content | Image | A picture from the image library or uploaded now (PNG, JPEG, GIF, WebP, up to 5 MB). | Image, Alt Text (describe it for people who cannot see it; a missing alt is a finding), Link, Hover Text, Alignment, Width, Height, Max Height, Padding, Corner Radius. |
| Content | Button | A call to action. | Label, Link, Alignment, Width, Height, Margin (space outside), Padding (space inside), Font, Background Color, Text Color, Corner Radius. |
| Content | Custom HTML | Raw HTML you write, for things the blocks cannot do. It is sent as written, so keep to email-safe tables. | HTML, Width, Alignment, Margin, Padding, Background Color. |
| Brand | Header | Your wordmark, an optional tagline, on a brand bar. | Wordmark Text, Tagline, Alignment, Brand Bar Color. |
| Brand | Social Links | Icons for the networks you add, in a row or a column, with or without labels. | Add a Network, then per network: Network (Facebook, Instagram, X, Twitter, LinkedIn, YouTube, TikTok, Pinterest, Snapchat, Google, GitHub, Medium, Tumblr, Vimeo, SoundCloud, Dribbble, Xing, Website), Link, Label; Layout, Icon Size, Icon Padding, Icon Background, Icon Corner Radius, Label Font, Label Size, Label Color. |
| Brand | Footer | The address, the unsubscribe link and the small print. | Sender Address and the legal text. The unsubscribe link must stay for marketing mail. |
| Commerce | Product Card | Image, name, price and a button for one product. | Image with Alt Text, Ratio, the text, the button's Label and Destination. |
| Commerce | Coupon | A headline, body text and a treatment for an offer, with the coupon tags ready to use. | Headline, Body (with quick tags for the coupon code), Alignment, Treatment. |
| Commerce | Barcode, QR Code | A code drawn per recipient from a tag's value, the coupon code uploaded with the list for example. | Source tag; barcode Format (Code 128, Code 39, EAN-13, UPC-A), Width, Height; QR Error Correction (Low, Standard, High, Maximum), Size; the value printed under the code; Alignment; Background. |

Settings every block shares, in Layout: **Margin** (space outside the block), **Padding** (space inside), **Hide on Phones** and **Hide on Desktop**. In Appearance, where the block allows it: Background Color, Border Width, Border Style, Border Color, Shadow (Outlook for Windows drops shadows; the field says so), Corner Radius. Lengths take px, %, em and rem and settle on px.

## Personalization

- Tags come from the workspace's catalogue (Settings → Tags): first name, last name, loyalty tier and so on, the three coupon tags, and the system tags that are always there: unsubscribe URL, preference centre URL, current year, today, the campaign's name, the recipient's email.
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

Run Inbox Previews renders the last saved version in real email clients through CEP's Mailgun Inspect account, or the workspace's own one under Settings → Sending Engines → Deliverability Testing. Every test of the template is listed on the left; a result shows the renders grouped by client kind, a render opens full size. Through CEP's account, tests count against the plan's monthly number plus any tests added for the month, which Settings → Plan & Usage shows; through your own, they are not limited. Unsaved changes are not in a test: save first.

## Saving, versions and activating

- **Save** writes version n+1. The designer also saves a draft by itself 30 seconds after the last edit, unless the template is read-only, an older version is on the canvas, or the last save was refused.
- **History** lists every version with who saved it and when. Open one to look at it: the strip says *You are looking at version n*; saving from there makes it the newest version, nothing is lost; Back to Latest returns.
- **A conflict**: when someone else saved a newer version, the strip says so and offers Load Latest Version. Nothing is sent until you do.
- **Activate** runs the blockers: a subject line, the design saved at least once, an unsubscribe link for marketing mail, images with an alt text and no placeholder images, the HTML under Gmail's 102 KB clip limit. A template with an error cannot be activated; warnings are advisory. Once active, campaigns can pick it on their Content step and journeys on a message step.
- **Leaving** with unsaved changes asks first.

## How to use the editor: worked examples

Each example is a complete recipe. Names, colours and addresses are placeholders for your own.

### 1. A welcome email from a starter

1. Templates → New Template → Email → name it *Welcome to Northwind* → Starting Point: Welcome email → Create.
2. Subject: type *Welcome,* then insert `first_name` from the tag picker beside the field; the counter stays green. Preheader: *Your first order ships free this month.*
3. Select the Header block → Wordmark Text: Northwind Apparel → Brand Bar Color: your navy.
4. Double-click the hero text → write the welcome in two short sentences; keep the heading one line.
5. Select the Button → Label: Start Shopping → Link: your shop's address; Appearance → Background Color: your action colour.
6. Preview → Client: Gmail → check the inbox row reads well where Gmail cuts it; Device: Mobile → check the button is reachable with a thumb.
7. Send a Test to yourself, then Save and Activate. The campaign's Content step now offers it.

### 2. Formatting text, links and emoji

1. Double-click a Text block. The toolbar appears above it: **bold**, *italic*, underline, strikethrough, link, tag, emoji.
2. Select a phrase and press the link button → paste the address. Select the link again: the settings panel now shows **Link Color** and **Underline** for that link alone, so a link can be your brand blue without an underline while the paragraph stays black.
3. Press the tag button → pick `first_name`: it lands where the cursor is. Press the emoji button for a mark at the cursor; the emoji picker beside Subject does the same for the subject line.
4. The block's own settings set the whole block: Font Family (the email fonts the workspace offers; the default is the design's own), Font Size, Font Weight, Line Height, Text Color, Alignment. Use the toolbar for a word, the panel for the block.
5. Press Escape to finish editing. The **Links** pill at the bottom lists every link in the design with its address: open it before saving to catch a link to nowhere.

### 3. A hero: a coloured section, a picture and a button

1. Drag **One Column** (Structure) below the header. Select the section (the breadcrumb above the canvas shows section → column → block; click *section*).
2. Appearance → Background Color: your brand colour; Layout → Full Width on, so the colour runs edge to edge in inboxes that allow it; Padding: 32 px top and bottom.
3. Drag an **Image** into the column → Assets → upload the hero picture → Alt Text: what it shows (*A rack of autumn coats*). Width: 100%; Corner Radius: 8 px.
4. Drag a **Heading** under the image → Text Color: white; then a **Button** → Label: Shop the Collection → Link; Corner Radius: 8 px; Margin 16 px on top to lift it off the heading.
5. Switch the canvas to **Mobile**: the picture scales to the column; if it is too tall, set **Max Height** on the image. Save.

### 4. Columns that behave on a phone

1. Drag **Two Columns** → left column an Image, right column a Heading and a Text. On the desktop canvas they sit side by side.
2. Switch to **Mobile**. Columns stack, picture first. If the words should come first on a phone, select the section → Layout → **On Phones: reverse**.
3. Two small items that should stay beside each other on a phone (two icons, a price and a button): select their section → **Keep Side by Side**. They share the width instead of stacking.
4. A **Three Columns** section with a Product Card in each stacks to three cards on a phone; if that is too long, select the third card → Layout → **Hide on Phones**. The desktop email keeps all three.
5. The other way round: a square banner that only phones should see → set its section to **Hide on Desktop**. The canvas hides it on the device it does not apply to; Show Block Outlines on the toolbar keeps hidden blocks findable.

### 5. Images: the library, alt text and sizes

1. Select an Image block → **Image** → the library opens: search by name, pick one, or Upload (PNG, JPEG, GIF, WebP, up to 5 MB; a GIF animates in inboxes that play them, Outlook shows its first frame). The same file uploaded twice is kept once, so re-uploading is harmless.
2. **Alt Text** is read by people who cannot see the picture and shown where images are blocked; a picture without one is a finding, and a placeholder picture blocks Activate.
3. **Link** makes the picture clickable; **Hover Text** is the tooltip. **Width** in %, **Max Height** to keep tall pictures in check, **Corner Radius** for rounded corners, **Padding** for breathing room.
4. Give photos a 2:1 or 3:2 shape; a 600 px wide export is plenty for a 680 px email and keeps the message under Gmail's clip limit.

### 6. A sale with a personal coupon and a barcode

1. New Template → Email → Starting Point: Sale announcement.
2. Drag a **Coupon** block under the hero. Headline: *20% off this weekend*; Body: insert the `coupon_code` tag from the quick tags, so each person sees their own code; Treatment: dashed.
3. Drag a **Barcode** block under the coupon. Source: `coupon_barcode_value`; Format: Code 128; the value under the code on. The canvas shows the sample value's bars; the sent email draws each recipient's.
4. Upload the contact list with columns named `coupon_code` and `coupon_barcode_value`; the list's people carry them.
5. A recipient with no code gets the email without the barcode block; the run's completion message says how many.
6. Preview As → Empty Profile shows what a person without a code sees. Save, Activate.

### 7. A QR code for in-store redemption

1. Drag a **QR Code** block (Commerce; offered when the workspace has Barcodes and QR codes). Source: `coupon_qr_value`; Error Correction: Standard (High if the code will be printed small or on a dark background); Size: 160 px; Alignment: centre.
2. Give the QR value in the list upload a full URL or the till's code, whatever the store scans.
3. On a dark section, set the block's **Background** to white: a QR code needs light around it to scan.

### 8. Social links, including TikTok

1. Drag **Social Links** (Brand) into the footer section. **Add a Network** → Network: Instagram → Link: your profile. Add Facebook, TikTok, YouTube the same way; each row has its own Link and an optional Label.
2. Layout: a row for a footer, a column for a sidebar. Icon Size 32 px, Icon Background your brand colour or none, Icon Corner Radius 16 px for round icons; Label Font, Label Size, Label Color when labels are shown. The TikTok mark takes the colour its neighbours have.

### 9. Something the blocks cannot do: Custom HTML

1. Drag **Custom HTML** (Content) where it should go: into a column, a section or the body. It refuses to land inside another raw block.
2. HTML: write an email-safe table, for example a two-row opening-hours table with inline styles. No scripts and no external stylesheets: the server rejects scripts, and inboxes ignore stylesheets.
3. Layout: Width (full or a fixed width), Alignment, Margin and Padding, Background Color: these wrap your HTML in a table the inboxes understand, so the block lines up with the rest. Hide on Phones and Hide on Desktop work on it too.
4. Preview in Outlook as well as Gmail: raw HTML is where the two differ most.

### 10. Spacing with rhythm

1. Put a **Spacer** (Structure) between sections and tune its Height once, rather than padding every block: one place to change the rhythm.
2. On a block, **Margin** is the space outside it (between it and its neighbours), **Padding** the space inside (between its edge and its content). A Button is the one block where Padding is the space inside the button itself.
3. The four boxes take px or %, and em or rem if you think that way: 1.5em becomes px the moment you press Enter, so the email stays predictable in every inbox. Mixing px and % on one side is refused.

### 11. Borders and shadows

1. Select a section, column, image or button → Appearance → Border Width 1 px, Border Style solid, Border Color a light grey: a hairline card. Corner Radius rounds it.
2. Shadow: soft, medium or strong on a section, column, text, image or button. Apple Mail, Gmail and Outlook.com draw it; Outlook for Windows drops shadows, so never let a shadow carry meaning.

### 12. The subject line and preheader

1. Write the subject as a sentence, under 60 characters: the counter turns amber past that, where inboxes cut it. Insert `first_name` from the picker for a personal subject, an emoji from the picker beside it if your brand uses them.
2. A hint appears under the field when a word is one spam filters weigh (*free*, *act now*, capitals, stacked punctuation). It is advice, not a verdict.
3. The preheader is the line inboxes show after the subject: write the second half of the thought, under 90 characters. Leave it empty and inboxes show the first words of the email instead.
4. Preview → Client: Gmail, Outlook, Apple Mail: the inbox row above the email shows where each cuts the two.

### 13. Checking the email in Preview

1. Switch to **Preview**. Preview As: Sample Values first, then **Empty Profile**: every tag shows its default, which is what a customer with a thin record sees. Fix a default under Settings → Tags.
2. Device: Mobile. Everything should be readable without zooming; buttons wide enough for a thumb.
3. Client: Outlook. Shadows are gone, rounded corners square off; the design should still hold.
4. Appearance: Dark. A dark header with dark text, or a logo with a transparent background on a dark bar, shows here before a customer sees it.
5. **Send a Test** to yourself and a colleague: the real email through the workspace's sender, as the previewed profile.

### 14. Inbox previews in real clients

1. Save, then **Deliverability → Run Inbox Previews**. The last saved version is rendered in real clients through Mailgun Inspect.
2. The result lists renders grouped by kind (desktop, phone, webmail); open one full size. Each test counts against the plan's monthly number unless the workspace uses its own Inspect account.

### 15. Versions: going back, and two people at once

1. **History** at the top right lists every version with who saved it and when. Open one to look at it; the strip says *You are looking at version n*. **Save** from there makes it the newest version, so a design from last month is one Save away. **Back to Latest** returns without saving.
2. When a colleague saves while you are editing, the strip says a newer version exists and offers **Load Latest Version**. Your unsaved work is lost by loading it, so copy any text you wrote first. Nothing is sent until the conflict is resolved.
3. The designer saves a draft by itself 30 seconds after the last edit; the footer says when it last saved.

### 16. Handing the design to a campaign or a journey

1. **Activate**. The footer names anything that blocks it: an empty subject, a placeholder image, an image without alt text, a marketing email without the unsubscribe link, an email over Gmail's 102 KB limit. Fix and Activate again.
2. A campaign picks the template on its Content step and may write its own subject and preheader without touching the template. A journey's Email step picks it in the step's panel.
3. Changing an active template changes what campaigns send from the next save that is activated; the campaigns themselves need no edit.

### 17. Taking the design elsewhere

1. **View Code** on the canvas toolbar shows the MJML source and the rendered HTML, formatted, with a copy button: for an agency, another tool, or a quick look at what an inbox will receive.
2. **Download HTML** saves the rendered email as a file.
3. **Fullscreen** hides the rails for a clean look at the canvas; **Exit Fullscreen** brings them back. **Fit to Width** and the zoom menu size the canvas to the window.

### 18. Finding and fixing a buried block

1. Open **Layers**: the tree of sections, columns and blocks with their names. Click one to select it on the canvas; rename it so the tree reads like the email; drag to reorder; the eye hides it on the canvas while you work (it still sends).
2. The breadcrumb above the canvas walks up from a block to its column and section, which is the quickest way to select a section to change its background or stacking.
3. The **Errors** pill lists every finding with a link to the field or block concerned.

## Things to know

- The subject and preheader on the template are defaults: a campaign can write its own on its Content step without touching the template.
- Marketing mail must carry the unsubscribe link; the Footer block has it. Remove it and Activate refuses, and a marketing campaign cannot publish.
- Images are stored once per workspace and served from the media store; the same file uploaded twice is kept once.
- Email clients differ: Outlook for Windows has no shadows and no media queries (the phone rules use its own mechanism), Gmail clips emails over 102 KB. The Preview's clients show the common cases; Deliverability shows the real ones.
- A design made outside CEP can be pasted as Custom HTML, but the blocks cannot edit what is inside it; rebuild with blocks where you will want to change it later.
- A text template has no designer: SMS and MMS open the message editor, e-receipts the receipt editor.
