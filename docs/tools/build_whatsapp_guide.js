/** Builds docs/guides/CEP_WhatsApp_Setup_Guide.docx: the set-up, configuration and test guide for WhatsApp, with the screenshots
 * in docs/guides/whatsapp/. Run from the repository root: node docs/tools/build_whatsapp_guide.js */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function loadDocx() {
  try { return require('docx') } catch { /* fall through to the global folder */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'docx'))
}
const docx = loadDocx()

const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat, AlignmentType, PageBreak, ImageRun } = docx

const ROOT = path.resolve(__dirname, '..', '..')
const SHOTS = path.join(ROOT, 'docs', 'guides', 'whatsapp')
const OUT = path.join(ROOT, 'docs', 'guides', 'CEP_WhatsApp_Setup_Guide.docx')
const FONT = 'Calibri'
const INK = '1F2440'
const MUTED = '555B6E'
const CONTENT_WIDTH = 9360
let figure = 0

function runs(text, base = {}) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean)
  return parts.map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) return new TextRun({ text: part.slice(2, -2), bold: true, font: FONT, ...base })
    if (part.startsWith('`') && part.endsWith('`')) return new TextRun({ text: part.slice(1, -1), font: 'Consolas', size: (base.size ?? 21) - 1, ...base })
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return new TextRun({ text: part.slice(1, -1), italics: true, font: FONT, ...base })
    return new TextRun({ text: part, font: FONT, ...base })
  })
}

const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: FONT })] })
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: FONT })] })
const h3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, font: FONT })] })
const p = (text, opts = {}) => new Paragraph({ children: runs(text, opts.run ?? {}), spacing: { after: 120, line: 276 }, ...opts.para })
const note = (text) => new Paragraph({ children: runs(text, { size: 20, color: MUTED }), spacing: { after: 120 }, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C9CDD8', space: 8 } } })
const bullets = (items) => items.map((item) => new Paragraph({ children: runs(item), numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 } }))
let numberInstance = 0
const numbered = (items) => { numberInstance += 1; return items.map((item) => new Paragraph({ children: runs(item), numbering: { reference: 'numbers', level: 0, instance: numberInstance }, spacing: { after: 60 } })) }
const code = (lines) => lines.map((line) => new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 18 })], shading: { type: ShadingType.CLEAR, fill: 'F3F4F8', color: 'auto' }, spacing: { after: 0 }, indent: { left: 180 } }))
const pageBreak = () => new Paragraph({ children: [new PageBreak()] })
const spacer = () => new Paragraph({ spacing: { after: 120 } })

function table(header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0)
  const dxa = widths.map((w) => Math.round((w / total) * CONTENT_WIDTH))
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9CDD8' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const cell = (text, index, isHeader) => new TableCell({
    width: { size: dxa[index], type: WidthType.DXA }, borders, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: 'EEF1F8', color: 'auto' } : undefined,
    children: [new Paragraph({ children: runs(text, { size: 19, bold: isHeader || undefined }), spacing: { after: 0 } })],
  })
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: dxa,
    rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, i, true)) }), ...rows.map((row) => new TableRow({ children: row.map((c, i) => cell(c, i, false)) }))],
  })
}

function image(file, caption) {
  const data = fs.readFileSync(path.join(SHOTS, file))
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const shownWidth = 600
  const shownHeight = Math.round((height / width) * shownWidth)
  figure += 1
  return [
    new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: shownWidth, height: shownHeight } })], spacing: { before: 120, after: 60 }, keepNext: true }),
    new Paragraph({ children: [new TextRun({ text: `Figure ${figure}. ${caption}`, italics: true, size: 18, color: MUTED, font: FONT })], spacing: { after: 240 } }),
  ]
}

const children = []
const add = (...items) => items.flat().forEach((item) => children.push(item))

// Cover
add(
  new Paragraph({ children: [new TextRun({ text: 'CEP WhatsApp', bold: true, size: 64, font: FONT, color: INK })], spacing: { before: 2800, after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: 'Set-Up, Configuration and Test Guide', size: 32, font: FONT, color: INK })], spacing: { after: 240 } }),
  new Paragraph({ children: [new TextRun({ text: 'What has to be in place at Meta, how the platform team switches WhatsApp on, how a workspace connects its number, writes templates Meta approves and sends campaigns, how to test every step, and what to do when something goes wrong.', size: 22, font: FONT, color: MUTED })], spacing: { after: 600 } }),
  new Paragraph({ children: [new TextRun({ text: `Built ${new Date().toISOString().slice(0, 10)} from the CEP code and manuals at main (PR #223, database patch 0082). The example workspace is City HT, a retailer in Singapore, with the WhatsApp number +65 6812 4400; every ID, token and value in the examples is made up. Screenshots are from the app's design playground with sample data.`, size: 20, font: FONT, color: MUTED })] }),
  pageBreak(),
)

const CONTENTS = [
  '1. Purpose and Audience', '2. How WhatsApp Works in CEP', '3. Prerequisites at Meta', '4. Platform Set-Up (Back Office)', '5. Workspace Set-Up: Connecting the Number',
  '6. Consent', '7. Templates', '8. Campaigns', '9. Test Plan', '10. Troubleshooting', '11. What CEP Stores', '12. Limits and What Is Not Built Yet',
  'Appendix A. Permissions', 'Appendix B. Endpoints', 'Appendix C. Screenshot Index',
]
add(h1('Contents'), ...CONTENTS.map((line) => new Paragraph({ children: [new TextRun({ text: line, font: FONT, size: 22 })], spacing: { after: 80 } })), pageBreak())

// 1
add(h1('1. Purpose and Audience'),
  p('This guide takes a workspace from nothing to its first WhatsApp campaign, and says how to prove each step works. It is written for three readers: the **workspace\'s Meta administrator**, who owns the business account, the app and the number at Meta; the **platform team**, who switches WhatsApp on for the workspace; and the **workspace administrator and marketers**, who connect the number in CEP, write templates and send campaigns.'),
  p('It is the long form of the in-app help chapter *WhatsApp Templates* (the help icon in the WhatsApp editor). Conventions: **bold** is a label as it appears on screen; `monospace` is a field, a value or an endpoint.'),
)

// 2
add(h1('2. How WhatsApp Works in CEP'),
  p('CEP sends WhatsApp through **Meta\'s WhatsApp Business Platform (Cloud API)** with each workspace\'s **own** Meta business account: Meta bills the workspace directly, and the number, its display name and its quality rating belong to the workspace. CEP never sends through a shared account.'),
  h2('2.1 The Path of a Message'),
  numbered([
    'A campaign with the WhatsApp channel is published. CEP builds the audience: only people with a **WhatsApp opt-in** and a mobile number with country code.',
    'For each person, CEP fills the template\'s numbered variables (`{{1}}`, `{{2}}`) with their own values, or the template\'s fallback when a value is empty, and calls Meta: `POST https://graph.facebook.com/v23.0/{phone number id}/messages` with the approved template\'s name, language and values.',
    'Meta delivers it to the person\'s WhatsApp and answers with a message ID (`wamid…`), which CEP stores with the message.',
    'Meta calls the workspace\'s **callback address** in CEP as the message is delivered, read or fails, and when the person replies or taps a button. CEP applies each report once, even when Meta sends it twice.',
    'Meta also calls back when it approves, rejects or pauses a template, and when the number\'s quality or daily limit changes.',
  ]),
  h2('2.2 Meta\'s Rules That Shape the Product'),
  table(['Meta\'s rule', 'What CEP does'], [
    ['A business may start a conversation only with a template Meta approved.', 'Only Approved templates can be sent; publishing waits for Meta\'s approval. Rejected and paused templates show Meta\'s reason.'],
    ['Free-form messages only within 24 hours of the person\'s last message.', 'Campaigns send templates only. Replies and taps are recorded; there is no reply inbox yet.'],
    ['People opt in to WhatsApp specifically.', 'A WhatsApp consent of its own, for every kind of campaign. Consent to texts does not count.'],
    ['Meta charges per delivered message, by category and the person\'s country.', 'The category (Marketing or Utility) is chosen per template; Meta bills the workspace\'s account.'],
    ['A number may start conversations with a limited number of people a day, which rises with quality.', 'Check shows the number\'s quality rating and daily limit.'],
    ['Meta limits how many marketing messages one person receives.', 'Shown as a failure with Meta\'s reason (Meta 131049).'],
  ], [2, 3]),
)

// 3
add(h1('3. Prerequisites at Meta'),
  p('Everything in this chapter happens in the workspace\'s own Meta accounts, done by its Meta administrator. Meta changes its screens from time to time; the names below are those in use when this guide was written.'),
  h2('3.1 Business Portfolio and Verification'),
  p('At **business.facebook.com**, create or choose the business portfolio (for example *City HT Pte Ltd*) and complete **business verification** (Settings → Security Centre). An unverified business can start conversations with far fewer people a day.'),
  h2('3.2 The App and the WhatsApp Product'),
  p('At **developers.facebook.com** → My Apps → **Create App**, create a *Business* app (for example *City HT Messaging*) connected to the portfolio, and add the **WhatsApp** product. Meta creates a WhatsApp business account with a **test number** and the sample template `hello_world`, useful for the first tests (chapter 9).'),
  h2('3.3 The Phone Number and Display Name'),
  bullets([
    'In WhatsApp Manager → Phone Numbers, add the real number (+65 6812 4400) and verify it by SMS or voice call.',
    'Set the display name (*City HT*); Meta reviews and approves it.',
    'The number must not be in use on the WhatsApp or WhatsApp Business app. Move or delete that account first.',
  ]),
  h2('3.4 Payment Method'),
  p('In WhatsApp Manager → Billing (or Business Settings → Payments), add the card or credit line Meta charges. Without one, business-initiated messages fail (Meta 131042).'),
  h2('3.5 The System User and Its Access Token'),
  numbered([
    'Business Settings → Users → **System Users** → Add: a name such as *cep-sender*, role **Admin**.',
    '**Assign Assets**: the app (full control) and the WhatsApp account (full control).',
    '**Generate New Token**: choose the app, expiry **Never**, permissions `whatsapp_business_messaging` and `whatsapp_business_management`.',
    'Copy the token straight into a password manager: Meta shows it once.',
  ]),
  note('The temporary access token on the app\'s WhatsApp → API Setup page expires after 24 hours. Never use it in CEP: every send would stop the next day.'),
  h2('3.6 The Values CEP Needs'),
  table(['Value', 'Where to find it', 'Example'], [
    ['WhatsApp Business Account ID', 'WhatsApp Manager → Account Tools, or the app\'s WhatsApp → API Setup.', '`104883925517204`'],
    ['Phone Number ID', 'The app\'s WhatsApp → API Setup, or WhatsApp Manager → Phone Numbers. The ID, not the number.', '`118204576330981`'],
    ['Access Token', 'The system user\'s token (3.5).', '`EAAG…` (long)'],
    ['App Secret', 'The app\'s App Settings → Basic → App Secret → Show.', '32 hexadecimal characters'],
    ['App ID', 'The app\'s App Settings → Basic.', '`1234567890123456`'],
  ], [2, 3, 2]),
)

// 4
add(h1('4. Platform Set-Up (Back Office)'),
  p('WhatsApp is a workspace feature, **off by default**, because a workspace needs its own Meta account first. The platform team switches it on:'),
  numbered([
    'Back office → **Tenants** → open the workspace (*City HT*).',
    'Under **Industry and Features**, set **WhatsApp messages** to *On*. Save.',
    'Within a minute the workspace offers the WhatsApp (Meta) engine under Settings → Delivery, the WhatsApp card and tab in Templates, and the WhatsApp channel in campaigns.',
  ]),
  p('A subscription plan can also take WhatsApp away from all its workspaces (plan feature key `whatsapp`). Patch 0082 must be applied to the workspace\'s database before the release that carries WhatsApp is deployed.'),
)

// 5
add(h1('5. Workspace Set-Up: Connecting the Number'),
  p('Needs the `provider.edit` permission. All of it is on **Settings → Delivery**.'),
  h2('5.1 Add the Engine'),
  p('**Add Engine** → Engine *WhatsApp · WhatsApp (Meta)*:'),
  table(['Field', 'What to enter', 'Example'], [
    ['Name', 'How the number is listed in the workspace.', '*City HT WhatsApp*'],
    ['WhatsApp Business Account ID', 'From 3.6.', '`104883925517204`'],
    ['Phone Number ID', 'From 3.6.', '`118204576330981`'],
    ['Access Token', 'The system user\'s token. Write-only and stored encrypted.', '(paste)'],
    ['App Secret', 'Optional but recommended: CEP then checks Meta\'s signature on every callback. Write-only.', '(paste)'],
    ['App ID', 'Optional: needed only to submit a template with a picture or document header.', '`1234567890123456`'],
    ['Graph API Version', 'Leave empty for the version CEP was built for (v23.0).', '(empty)'],
    ['Messages per Minute', 'Leave empty: Meta paces the number itself.', '(empty)'],
  ], [2, 3, 2]),
  h2('5.2 Register the Callback Address at Meta'),
  numbered([
    'In the engine\'s row: **Copy Webhook URL** and **Copy Verify Token**.',
    'In the Meta app: WhatsApp → **Configuration** → Webhook → **Edit**. Paste the callback URL and the verify token, then **Verify and Save**. Meta calls the address once (a handshake) and CEP answers it.',
    'Under **Webhook fields**, **Subscribe** to `messages` and `message_template_status_update`; optionally also `message_template_quality_update` and `phone_number_quality_update`.',
  ]),
  p('An example callback address:'),
  ...code(['https://cepdev.aiintelekt.com/api/v1/webhooks/delivery/CITYHT/7f3c2a90-…/a1b2c3d4…/']),
  spacer(),
  p('The last part of the address is the verify token. **Rotate Address** in the engine\'s row retires the address at once: paste the new one and its token into Meta again.'),
  h2('5.3 Check the Engine'),
  p('Press **Check**. CEP asks Meta about the number, and the engine\'s row then reads, for example: *+65 6812 4400 · City HT · Quality High · 1,000 people a day*. A failure names Meta\'s reason, most often the token (chapter 10).'),
  h2('5.4 Add and Verify the Sender'),
  numbered([
    '**Add Sender**: Sends Through *City HT WhatsApp*; Name *City HT WhatsApp*; WhatsApp Number *+65 6812 4400* (country code required; spaces are removed).',
    '**Verify**: WhatsApp sends no free-form test message, so CEP asks Meta whether the engine\'s number is this one. The sender shows *Verified*, or names the number Meta reports.',
  ]),
)

// 6
add(h1('6. Consent'),
  p('WhatsApp goes only to people with a **WhatsApp opt-in**, for every kind of campaign, marketing or not: Meta\'s rule. Consent to texts does not count, and opt-outs are kept apart:'),
  bullets([
    'A text STOP does not stop WhatsApp; a WhatsApp STOP (typed, or a *Stop* quick reply) stops WhatsApp only, and does not block the number for texts.',
    'Someone without a WhatsApp opt-in is left out of the audience as *No Consent*; someone who opted out as *Unsubscribed*.',
  ]),
  h2('6.1 Recording Consent with a List Upload'),
  p('Contact Lists → upload a file with a **WhatsApp consent date** column. A valid date, not in the future, becomes a WhatsApp opt-in for people CEP has no WhatsApp answer for; it never overrides an opt-out. Mobile numbers need their country code.'),
  table(['email', 'first_name', 'mobile', 'whatsapp_consent_date'], [
    ['mei.ling@example.com', 'Mei Ling', '+6591234471', '2026-10-01'],
    ['arif.rahman@example.com', 'Arif', '+60124481902', '2026-10-03'],
    ['grace.santos@example.com', 'Grace', '+639175520184', '2026-10-05'],
  ], [3, 2, 2, 2]),
  spacer(),
  p('The column is recognised by headings such as *WhatsApp consent date*, *whatsapp_optin* or *wa_consent*, and can be mapped by hand on the upload\'s mapping step.'),
)

// 7
add(h1('7. Templates'),
  p('Needs the `template.edit` permission. Templates → the **WhatsApp** card or tab.'),
  h2('7.1 The Editor'),
  ...image('01-editor-draft.png', 'The WhatsApp editor with a draft: Meta\'s parts on the left, the phone preview with the samples on the right.'),
  table(['Field', 'What it is', 'Example'], [
    ['WhatsApp Number', 'The engine the template is reviewed and sent through.', '*+6568124400 · City HT*'],
    ['Name at Meta', 'Lower-case letters, digits and underscores; fixed once Meta has it.', '`back_in_stock`'],
    ['Category', 'Marketing, or Utility for an update the person expects (receipt, order). Meta moves anything promotional to Marketing.', 'Marketing'],
    ['Language', 'One language per template.', 'English'],
    ['Header', 'None, Text (60 characters, the same for everyone), Picture (JPEG or PNG, 5 MB) or Document (PDF).', 'Picture'],
    ['Body', 'Up to 1,024 characters, with tags. Meta gets `{{1}}`, `{{2}}` in the order the tags first appear.', '*Good news, {{first_name}}: the {{product_name}} you asked about is back at {{preferred_store}}. We\'ll hold one for you until Sunday.*'],
    ['Samples for Meta\'s Review', 'A sample value per tag.', '*Mei Ling*, *Linen Shirt, Navy*, *Harbour Mall*'],
    ['If Empty', 'Sent when a person has no value for the tag; without it (or the tag\'s own default) their message fails.', '*there*, *item*, *your City HT store*'],
    ['Footer', 'Up to 60 characters.', '*City HT · Reply STOP to opt out*'],
    ['Buttons', 'Up to 10: Link (at most 2), Quick Reply, Phone Number (at most 1). A quick reply starting with *Stop* opts the person out of WhatsApp.', 'Link *Reserve It*; Quick Reply *Stop Offers*'],
  ], [2, 4, 3]),
  h2('7.2 Meta\'s Rules, Checked Before Submitting'),
  bullets([
    'The body may not start or end with a tag, and may not have two tags side by side: the editor says *Meta Would Refuse This* and Save stays off.',
    'Every tag needs a sample; links must start with `https://`.',
    'A marketing template with no way to stop (no STOP in the body or footer, no Stop quick reply) gets a warning.',
    'A short message with many tags gets a warning: Meta often refuses it.',
  ]),
  h2('7.3 Submit, and Meta\'s Review'),
  p('**Save** keeps a new version, still a draft. **Submit to Meta** sends the saved version; Meta usually decides within minutes, at most 24 hours, and its callback updates the status with no action in CEP.'),
  table(['Status', 'Means', 'Next'], [
    ['Not Submitted', 'Written here, not with Meta.', 'Submit to Meta.'],
    ['In Review', 'Meta is reviewing it.', 'Wait; nothing can change.'],
    ['Approved', 'Campaigns can send it; a template written here becomes Active by itself.', 'Use it.'],
    ['Rejected', 'Meta\'s reason is shown.', 'Change it and submit again.'],
    ['Paused by Meta', 'Low quality: many people blocked or reported it.', 'Wait for Meta, or copy and improve it.'],
    ['Disabled by Meta', 'Switched off for good.', 'Copy to Change.'],
  ], [2, 3, 2]),
  spacer(),
  ...image('02-editor-approved.png', 'An approved template is read-only: Meta sends exactly what it approved. Copy to Change makes a draft copy for a new review.'),
  h2('7.4 Templates Made in WhatsApp Manager: Sync from Meta'),
  p('**Sync from Meta** (WhatsApp tab) brings in every template of the number\'s business account, and brings the status, reason and quality of known ones up to date. A template made in WhatsApp Manager keeps Meta\'s words; the editor asks which tag fills each of Meta\'s numbers and what to send when it is empty. Once every number has a tag, **Activate** makes it usable.'),
  ...image('03-editor-synced.png', 'A template synced from WhatsApp Manager: Meta\'s words stay as they are; each number is mapped to a tag.'),
  h2('7.5 Starting Points'),
  table(['Starter', 'Category', 'Body'], [
    ['WhatsApp offer', 'Marketing', '*Hi {{first_name}}, this weekend only: 20% off everything in store. Show this message at the till to get it.* With a Stop Offers quick reply.'],
    ['WhatsApp back in stock', 'Marketing', '*Good news, {{first_name}}: the item you asked about is back in store. We will hold one for you until Sunday.*'],
    ['WhatsApp purchase thank-you', 'Utility', '*Hi {{first_name}}, thank you for shopping with us today. The points for this purchase are now on your account.*'],
  ], [2, 1, 5]),
)

// 8
add(h1('8. Campaigns'),
  numbered([
    'Campaigns → **Create Campaign**: type *Regular Marketing* (or Other), channel **WhatsApp**. Drips and e-receipts do not send WhatsApp yet.',
    'Content: choose an approved template (the list shows Meta\'s status); Sender *City HT WhatsApp*.',
    'Audience: the list with WhatsApp consent.',
    '**Test Publish** to your own WhatsApp number: the approved template arrives with the samples Meta reviewed. WhatsApp adds no "[TEST]" mark: Meta sends only its approved words.',
    '**Publish**. Publishing is refused while the template is not approved.',
  ]),
  p('Afterwards the campaign\'s **Recipients** tab shows each message with Delivered, **Read**, and Failed with Meta\'s reason; the results show Read beside Delivered, and replies and opt-outs. Marketing campaigns keep the workspace\'s quiet hours for texts.'),
)

// 9
add(h1('9. Test Plan'),
  p('Run these in order on a new set-up. Tests 1 to 4 can run on Meta\'s **test number** (3.2) before the real number is live: on the app\'s API Setup page, add and verify up to five recipient numbers (your team\'s phones), and Sync brings in `hello_world`, which has no variables and needs no review.'),
  table(['#', 'Test', 'Do', 'Expect'], [
    ['1', 'The connection', 'Settings → Delivery → **Check** on the engine.', 'The number, name, quality and daily limit appear. A refusal names Meta\'s reason.'],
    ['2', 'The callback address', 'Meta\'s **Verify and Save** (5.2).', 'Meta accepts it. After the first event, the engine\'s Callbacks column shows when it last arrived.'],
    ['3', 'Sync', 'Templates → WhatsApp → **Sync from Meta**.', '`hello_world` and any template made in WhatsApp Manager appear with Meta\'s status.'],
    ['4', 'A test send', 'Activate `hello_world` (or an approved template), make a WhatsApp campaign, **Test Publish** to a team phone.', 'The message arrives on the phone.'],
    ['5', 'A review round trip', 'Write a short Utility template, **Submit to Meta**.', 'In Review, then Approved within minutes, with no action in CEP. Stuck In Review for an hour: test 2 is not done.'],
    ['6', 'A refusal before Meta', 'End the body with a tag: *Your store is {{preferred_store}}*.', 'The editor says Meta would refuse it; Save stays off.'],
    ['7', 'Consent', 'Publish to a list of two: one with WhatsApp consent, one with text consent only.', 'The first receives it; the second is left out as No Consent.'],
    ['8', 'Read', 'Open the message on the phone.', 'Recipients shows the time it was read; the results count it.'],
    ['9', 'Stop', 'Tap **Stop Offers**.', 'Recipients shows Opted Out; the person\'s text consent is unchanged; the next WhatsApp campaign leaves them out.'],
    ['10', 'A number that cannot receive', 'Include a number that is not on WhatsApp.', 'Failed: *Not a WhatsApp number, or it cannot receive this message (Meta 131026)*.'],
  ], [1, 3, 5, 6]),
)

// 10
add(h1('10. Troubleshooting'),
  h2('10.1 Meta\'s Error Codes'),
  p('CEP shows Meta\'s reason in words with its code, for example *(Meta 131026)*.'),
  table(['Code', 'Means', 'What happens in CEP', 'What to do'], [
    ['190', 'The access token is invalid or expired.', 'Check fails; a run stops with every message back in the queue.', 'Generate a system-user token with expiry Never (3.5) and paste it under Edit.'],
    ['131026', 'Not a WhatsApp number, or it cannot receive.', 'That message fails.', 'None in CEP; reach the person another way.'],
    ['131049', 'Meta held a marketing message back to keep people from receiving too many.', 'That message fails, counted apart from bad numbers.', 'Try again another day.'],
    ['131042', 'Meta could not charge the account.', 'Messages fail.', 'Fix the payment method (3.4).'],
    ['131047', 'More than 24 hours since the person last wrote, for a non-template message.', 'Does not occur for campaigns (they send templates).', 'None.'],
    ['132001', 'No approved template of this name and language.', 'The run stops.', 'The template was deleted or renamed in WhatsApp Manager: Sync, then choose an approved one.'],
    ['132015', 'Meta paused the template for low quality.', 'The run stops; the template shows Paused by Meta.', 'Wait for Meta, or copy and improve it.'],
  ], [1, 3, 3, 3]),
  h2('10.2 Other Problems'),
  table(['What you see', 'Why', 'What to do'], [
    ['Meta\'s Verify and Save fails.', 'The URL or verify token was not copied whole, or WhatsApp is not on for the workspace.', 'Copy both again from the engine\'s row.'],
    ['Templates stay In Review; Recipients never shows Delivered or Read.', 'Meta is not calling back: the webhook fields are not subscribed, or the app is not subscribed to the WhatsApp account (common when the account was not created by the app).', 'Subscribe `messages` and `message_template_status_update` (5.2). Subscribe the app to the account (Graph API `POST /{business account id}/subscribed_apps` with the token).'],
    ['Meta says it sends callbacks, but the engine\'s Callbacks column never shows one.', 'CEP refuses them: the App Secret in CEP is not this app\'s, so Meta\'s signature does not match.', 'Paste the right App Secret under Edit, or leave it empty to rely on the address\'s own token.'],
    ['Everyone in the audience is No Consent.', 'Nobody has a WhatsApp opt-in yet.', 'Record consent (chapter 6).'],
    ['A message fails: *No value for {{tag}} and the template has no fallback*.', 'That person has no value for the tag.', 'Give the tag an If Empty value: a template written here needs Copy to Change and a new review; a synced one takes it on Save.'],
    ['The run fails: *The WhatsApp template cannot be sent*.', 'The template is not approved, paused, or has a number without a tag.', 'Open the template; its status line says what is missing.'],
    ['Sync: *Meta did not list the templates*.', 'The token lacks `whatsapp_business_management`, or the account ID is wrong.', 'Fix the token\'s permissions or the account ID.'],
  ], [3, 3, 3]),
)

// 11
add(h1('11. What CEP Stores'),
  p('Patch **0082** adds WhatsApp to the database; it is applied once per database, before the release is deployed.'),
  table(['Where', 'What'], [
    ['`delivery_provider` (type `WHATSAPP_META`, channel `WHATSAPP`)', 'The engine: the IDs in its settings; the token and the App Secret encrypted; what the last Check learned (display number, name, quality, daily limit).'],
    ['`sender_profile` (channel `WHATSAPP`)', 'The number with its country code, and whether Meta confirmed it.'],
    ['`template_master` (channel `WHATSAPP`) and `rendered_template_content`', 'The template and its versions; the body in the tag form.'],
    ['`whatsapp_template`', 'Meta\'s parts: name at Meta, language, category, header, body in Meta\'s form, footer, buttons, each number\'s tag, sample and fallback; where Meta\'s review stands, its reason and quality; written here or synced. Row-level security per workspace.'],
    ['`sms_execution` (message type `WHATSAPP`)', 'One row per message, like a text: the number, the words the person got, their values, Meta\'s message ID, the status, and `read_at`.'],
    ['`consent_suppression` and `consent_record` (channel `WHATSAPP`)', 'WhatsApp opt-ins and opt-outs, with where they came from.'],
    ['`delivery_webhook_event`', 'Every callback from Meta, kept for the audit trail; a repeated one is marked Duplicate and applied once.'],
  ], [2, 4]),
)

// 12
add(h1('12. Limits and What Is Not Built Yet'),
  bullets([
    '**Drips and journeys** do not send WhatsApp yet; the API refuses a WhatsApp drip or e-receipt campaign.',
    '**POS e-receipts on WhatsApp** (a Utility template with the receipt PDF) are not wired yet.',
    '**No reply inbox:** replies and button taps are recorded and STOP acts, but nobody can answer within Meta\'s 24-hour window from CEP.',
    '**Meta\'s charge** is not estimated or reported per campaign: Meta\'s API has no rate card, so it needs a rate table per country.',
    '**Daily limit:** a campaign bigger than the number\'s daily limit is not spread over several days; the people over the limit fail at Meta.',
    '**Insights:** no WhatsApp dataset yet; WhatsApp messages appear in the text-message datasets with message type WHATSAPP.',
    'Header text has no variables, and link buttons have fixed addresses (no per-person link and no UTM tagging: Meta sends the approved words and links).',
  ]),
)

// Appendices
add(pageBreak(), h1('Appendix A. Permissions'),
  table(['Task', 'Permission'], [
    ['Switch WhatsApp on for a workspace', 'Platform team, in the back office'],
    ['Add, edit, check the engine; add and verify senders', '`provider.edit`'],
    ['Write, submit, sync, activate templates', '`template.edit`'],
    ['Create, test and publish campaigns', 'The workspace\'s campaign permissions'],
  ], [3, 2]),
)
add(h1('Appendix B. Endpoints'),
  table(['Endpoint', 'What it does'], [
    ['`GET /api/v1/templates/{id}/whatsapp/`', 'A WhatsApp template\'s parts, Meta\'s review and the findings.'],
    ['`POST /api/v1/templates/{id}/whatsapp/`', 'Saves a new version (written here) or the tag of each number (synced).'],
    ['`POST /api/v1/templates/{id}/whatsapp/submit/`', 'Sends the template to Meta for review.'],
    ['`POST /api/v1/templates/whatsapp-sync/`', 'Body `{"engine": "<engine id>"}`: every template of the number\'s business account.'],
    ['`POST /api/v1/templates/{id}/activate/`', 'Makes an approved template usable by campaigns.'],
    ['`GET /api/v1/webhooks/delivery/{workspace}/{engine id}/{token}/`', 'Meta\'s subscription handshake: answers `hub.challenge` when `hub.verify_token` is the address\'s token.'],
    ['`POST /api/v1/webhooks/delivery/{workspace}/{engine id}/{token}/`', 'Meta\'s callbacks: statuses, messages, template reviews and quality; checked against `X-Hub-Signature-256` when the App Secret is set.'],
    ['`POST /api/v1/delivery-providers/{id}/check/`', 'The engine\'s Check.'],
    ['`POST /api/v1/delivery-senders/{id}/verify/`', 'Confirms with Meta that the sender is the engine\'s number.'],
  ], [3, 4]),
)
add(h1('Appendix C. Screenshot Index'),
  p('Captured from the app\'s design playground (`/dev/whatsapp`) with sample data. The files live in `docs/guides/whatsapp/`.'),
  table(['File', 'Figure'], [
    ['01-editor-draft.png', 'The WhatsApp editor with a draft'],
    ['02-editor-approved.png', 'An approved template, read-only'],
    ['03-editor-synced.png', 'A template synced from WhatsApp Manager'],
  ], [2, 4]),
)

const doc = new Document({
  creator: 'CEP',
  title: 'CEP WhatsApp: Set-Up, Configuration and Test Guide',
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, font: FONT, color: INK }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: FONT, color: INK }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: FONT, color: '2A3052' }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children,
  }],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer)
  console.log(`wrote ${path.relative(ROOT, OUT)} (${(buffer.length / 1024 / 1024).toFixed(1)} MB, ${figure} figures)`)
})
