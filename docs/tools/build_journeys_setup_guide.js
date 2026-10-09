/** Builds docs/guides/CEP_Journeys_Setup_Guide.docx: the operational set-up and implementation guide for Journeys, with the
 * screenshots in docs/guides/journeys/. Run from the repository root: node docs/tools/build_journeys_setup_guide.js */
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
const SHOTS = path.join(ROOT, 'docs', 'guides', 'journeys')
const OUT = path.join(ROOT, 'docs', 'guides', 'CEP_Journeys_Setup_Guide.docx')
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
  const shownWidth = 624
  const shownHeight = Math.round((height / width) * shownWidth)
  figure += 1
  return [
    new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: shownWidth, height: shownHeight } })], spacing: { before: 120, after: 60 }, keepNext: true }),
    new Paragraph({ children: [new TextRun({ text: `Figure ${figure}. ${caption}`, italics: true, size: 18, color: MUTED, font: FONT })], spacing: { after: 240 } }),
  ]
}

const spacer = () => new Paragraph({ spacing: { after: 120 } })

const children = []
const add = (...items) => items.flat().forEach((item) => children.push(item))

// Cover
add(
  new Paragraph({ children: [new TextRun({ text: 'CEP Journeys', bold: true, size: 64, font: FONT, color: INK })], spacing: { before: 2800, after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: 'Operational Set-Up, Configuration and Implementation Guide', size: 32, font: FONT, color: INK })], spacing: { after: 240 } }),
  new Paragraph({ children: [new TextRun({ text: 'Data requirements, input sources and events; the ways to configure a journey in the app; how the engine runs it; how the output is measured; how to use, implement and integrate journeys; and the gaps still to fill.', size: 22, font: FONT, color: MUTED })], spacing: { after: 600 } }),
  new Paragraph({ children: [new TextRun({ text: `Built ${new Date().toISOString().slice(0, 10)} from the CEP code and manuals at main (PRs #98 to #110, database patches 0045 and 0046). Screenshots are from the app's design playgrounds with sample data, in the light theme; the app also offers a dark theme under the account menu's Appearance.`, size: 20, font: FONT, color: MUTED })] }),
  pageBreak(),
)

// Contents (static)
const CONTENTS = [
  '1. Purpose and Audience', '2. What a Journey Is', '3. Data Requirements and Input Sources', '4. Platform Set-Up (Back-Office)', '5. Workspace Set-Up (Tenant)',
  '6. The Ways to Configure a Journey', '7. Building a Journey, Step by Step', '8. How the Process Works', '9. How the Output Is Measured', '10. Using Journeys Already Set Up',
  '11. Integration Guide', '12. Gaps to Fill Before Journeys Are Used in Production', 'Appendix A. Permissions', 'Appendix B. Endpoints', 'Appendix C. Screenshot Index',
]
add(h1('Contents'), ...CONTENTS.map((line) => new Paragraph({ children: [new TextRun({ text: line, font: FONT, size: 22 })], spacing: { after: 80 } })), pageBreak())

// 1
add(h1('1. Purpose and Audience'),
  p('This guide is the operational companion to the Journeys chapters of the User Guide and the Platform Guide. It is written for three readers: the **platform team** that switches journeys on for a workspace and runs the machinery behind them, the **workspace administrator** who prepares senders, templates, keys and roles, and the **marketer or integrator** who configures journeys and connects the shop, the app, the point of sale and C360 to them.'),
  p('It explains what data a journey needs and where each piece comes from, every way a journey can be configured in the app, how the engine runs a journey from entry to exit, how the results are read, and what has to be in place outside CEP for a journey to do anything useful. The last chapter lists the gaps that remain in the app and in the surrounding integrations, so that a go-live plan can be written from this document.'),
  p('Conventions: **bold** is a label as it appears on screen; `monospace` is a field, a value or an endpoint. Figures are taken from the builder with sample data; the real app shows the same screens with the workspace\'s own data.'),
)

// 2
add(h1('2. What a Journey Is'),
  p('A journey is an automated path that each customer walks on their own. It is drawn once: **who enters**, the **steps** they go through (wait, check something, send an email or a text, issue a coupon, change their record, call an external system) and where the path **ends**. From then on CEP runs it for every customer who qualifies, one at a time, at their own pace. A campaign sends one message to a list at one moment; a journey keeps working for as long as it is live.'),
  h2('2.1 The Parts of a Journey'),
  table(['Part', 'What it is'], [
    ['Entry', 'What makes a customer enter: membership of a **customer list**, an **event** (a purchase, an abandoned cart, No Response and others), a **date or time** (a schedule, or a date on the customer\'s record such as a birthday), joining or leaving a **segment**, an **attribute change** (loyalty tier, preferences, address), or the customer\'s **record matching conditions**. Any entry can be narrowed with **Only Customers Where** filters.'],
    ['Population', '**Fixed** (who qualifies at launch, then closed), **Continuously Qualifying** or **Event Triggered** (keeps letting newcomers in).'],
    ['Re-entry', 'Whether the same customer can go through again: **Never**, **After X Days**, or **Every Qualifying Event**. Nobody is in the same journey twice at once.'],
    ['Steps', 'Wait, Condition (Yes / No), Split, Email, SMS / MMS, Issue Coupon, Update Loyalty Tier, Update Profile, Update Segment, Add to List, Remove from List, Webhook, Goal, Exit Journey.'],
    ['Goal', 'A Goal step names the outcome (an event within a window of entering); a customer who reaches it is **converted**, with the revenue of the matching orders. Without a Goal step, reaching an **Exit Journey** step counts as converted.'],
    ['Version', 'Every change to a published journey is a new version; one version is live at a time, and customers finish the version they started.'],
  ], [1, 4]),
  spacer(),
  h2('2.2 The Lifecycle'),
  table(['Status', 'Means'], [
    ['Draft', 'Being built. Nobody enters.'],
    ['Test', 'The test run went out; waiting for approval.'],
    ['Approved', 'Approved to go live at a set time; until then the schedule can be cancelled.'],
    ['Active', 'Live: customers enter and move along.'],
    ['Paused', 'Nobody new enters and nobody moves; everyone waits where they are until it resumes.'],
    ['Archived', 'Ended for good. Its figures and history stay readable.'],
  ], [1, 4]),
  spacer(),
  p('The path from nothing to live is always the same: **Set up** (name, entry, population, re-entry) → **Build** (the steps) → **Preview Route** (a no-send check for one customer) → **Test Publish** (real messages to a test population, waits skipped) → **Approve & Activate** (now or at a scheduled time). Chapter 7 walks through each of these screens.'),
)

// 3
add(h1('3. Data Requirements and Input Sources'),
  p('A journey reads the customer\'s record, reacts to what happens to the customer, and writes back to the record and to external systems. CEP never invents a customer: **only a customer who exists in the customer records can enter a journey**, because a message to someone unknown could never go out. This chapter lists every piece of data a journey can use, where it has to come from, and what happens when it is missing.'),
  h2('3.1 Where Each Piece of Data Comes From'),
  table(['Data', 'Comes from', 'Used by'], [
    ['Customer records (name, emails, phones, address, source system)', 'C360 syncs them into the workspace\'s `customer_master` table. A contact list upload adds the people CEP did not know (owned by CEP, not a C360 copy).', 'Who can enter at all; the Customer fields in conditions; the Webhook payload.'],
    ['Custom attributes (loyalty tier, customer status, home store, lifetime value, any field C360 sends)', 'C360, as a JSON object (`custom_attributes`) on the record. The upload template adds `loyalty_tier`, `loyalty_id`, `last_purchase_at` and `timezone`. The Update Profile and Update Loyalty Tier steps write them.', 'Conditions (read as text, number or date by the comparison chosen), Split by an attribute, the attribute-match trigger, Wait Until a Date on the Record.'],
    ['`timezone` (an IANA name such as `America/Chicago`)', 'C360, or the upload template\'s Time zone column.', 'Wait Until a Time of Day and Until a Date on the Record in the customer\'s own time. A record without one waits in the workspace\'s time zone.'],
    ['Dates on the record (`YYYY-MM-DD`) such as `birth_date`, `membership_date`, `renewal_date`', 'C360 custom attributes. CEP has no birthday field of its own.', 'On a Date Attribute entries, Wait Until a Date on the Record, date conditions.'],
    ['Segments and their members', 'C360 (`segment`, `customer_segment_membership`): the audiences the data team defines.', 'Enters / Exits Segment entries, Is in a Segment conditions, the Update Segment step, Who Enters on a schedule.'],
    ['Contact lists', 'Uploaded, cloned or made from a segment in CEP.', 'Customer List entries, Is in a List conditions, Add to / Remove from List steps, Who Enters on a schedule, the test list.'],
    ['Events (purchase, abandoned cart, store visit, birthday, any type you name)', '`POST /api/v1/events/` from the shop, the app, the point of sale or the loyalty system with an `events:ingest` key. CEP raises Purchase and First Purchase from orders, Email Open/Click and SMS Response from its own tracking, and No Response, Preference Update, Loyalty Tier Change and Coupon Issue itself.', 'Event entries, Event conditions with property filters, the Goal step.'],
    ['Orders', '`POST /api/v1/orders/` with an `orders:ingest` key, or store transactions when POS Receipts count store sales. Attribution must be on.', 'Purchase events, Last Purchase Date, Number of Purchases, a Goal\'s attributed revenue.'],
    ['Coupons and loyalty tiers', 'C360 references synced into the workspace (`coupon`, `loyalty_tier`).', 'Issue Coupon (a request C360 fulfils through `coupons:issue`), Update Loyalty Tier.'],
    ['Consent, suppressions, preferences', 'The preference centre, unsubscribe links, STOP replies, imports, Settings → Suppressions.', 'Whether a message step sends; Preview Route shows the verdict for one customer.'],
    ['Your own systems', 'A Webhook step posts the customer and journey context to an https address, signed.', 'Anything outside CEP: a CRM note, a ticket, a loyalty credit.'],
  ], [2, 3, 2]),
  spacer(),
  h2('3.2 Customer Records and Attributes'),
  p('The record is the foundation. For the starters shipped with the app and for the conditions most journeys use, the following attributes should be present on every record C360 syncs. None of them is mandatory for the app to run, but a journey that references a missing attribute simply never matches.'),
  table(['Attribute', 'Type', 'Needed by'], [
    ['`timezone`', 'IANA zone name', 'Wait Until a Time of Day in the customer\'s time; date waits and date entries at a local hour.'],
    ['`birth_date`, `membership_date`, `renewal_date` (any date)', '`YYYY-MM-DD`', 'Birthday Reward and Membership Anniversary starters (On a Date Attribute), Wait Until a Date on the Record.'],
    ['`loyalty_tier`', 'Text (Gold, Platinum …)', 'Loyalty Tier Upgrade starter, Split by an attribute, tier conditions, Update Loyalty Tier.'],
    ['`customer_status`', 'Text (New, Welcomed …)', 'Customer Attribute Matches entries; Update Profile writes it back.'],
    ['`home_store`, `lifetime_value`, any field the data team names', 'Text or number', 'Conditions and Splits.'],
  ], [2, 1, 3]),
  spacer(),
  p('The Settings → Events page says whether a customer named in an event exists (*Not in the customer records yet*). A customer who is not in the records is the most common reason a journey appears to do nothing.'),
  h2('3.3 Events'),
  p('Events are the signals a journey reacts to. Each event names a type, the customer it belongs to, when it happened and, optionally, its own data. The standard types are listed below; any other type can be sent and used in an Event entry, an Event condition or a Goal by naming it.'),
  table(['Event type', 'Label in the app', 'Sent by'], [
    ['`CUSTOMER_CREATED`', 'Customer Creation', 'C360 or the shop, when a customer is created.'],
    ['`WELCOME`', 'Welcome', 'The loyalty system or the shop, when a customer joins.'],
    ['`BIRTHDAY`, `ANNIVERSARY`', 'Birthday, Anniversary', 'C360 or a scheduler of yours; or use an On a Date Attribute entry instead and send nothing.'],
    ['`PURCHASE`, `FIRST_PURCHASE`', 'Purchase, First Purchase', 'Raised by CEP from orders (Attribution). A first order also raises First Purchase.'],
    ['`CATEGORY_PURCHASE`', 'Category Purchase', 'The shop, with the category in the payload.'],
    ['`CART_ABANDON`', 'Abandoned Cart', 'The shop or the app.'],
    ['`COUPON_ISSUED`, `COUPON_REDEEMED`', 'Coupon Issue, Coupon Redemption', 'Issue: raised by CEP\'s Issue Coupon step. Redemption: the shop or the point of sale.'],
    ['`SEGMENT_INCEPTION`, `SEGMENT_CHANGE`', 'Segment Inception, Segment Change', 'C360 when it creates or changes a segment membership; Enters / Exits Segment entries read the membership table directly.'],
    ['`LOYALTY_TIER_CHANGE`', 'Loyalty Tier Change', 'The loyalty system, or raised by CEP\'s Update Loyalty Tier step.'],
    ['`EMAIL_ENGAGEMENT`, `SMS_RESPONSE`', 'Email Open/Click, SMS Response', 'Raised by CEP from its own tracking and inbound SMS.'],
    ['`NO_RESPONSE`', 'No Response', 'Raised by CEP: at least 3 marketing emails in 30 days with no open, click or reply, at most once per 30 days per customer, while a live journey starts from it.'],
    ['`PREFERENCE_UPDATE`', 'Preference Update', 'Raised by CEP from a preference-centre save that changed something.'],
    ['`ADDRESS_CHANGE`', 'Address Change', 'C360, when the address changes.'],
  ], [2, 2, 3]),
  spacer(),
  p('An event enters a customer into a live journey only if it arrives **after the journey went live** and is **at most seven days old**. Up to 500 events go in one call; an `event_id` makes a resend harmless (the second copy answers DUPLICATE). The payload format is in Chapter 11.'),
  h2('3.4 Orders and Attribution'),
  p('Purchases are not sent as events. The shop sends orders to `POST /api/v1/orders/` with an `orders:ingest` key (or the point of sale posts transactions when POS Receipts count store sales), and CEP raises the Purchase and First Purchase events, fills the record\'s Last Purchase Date and Number of Purchases, and credits revenue to a Goal. **Attribution must be switched on** in Settings → Attribution; with it off, orders are accepted but no journey sees a purchase.'),
  h2('3.5 Segments, Lists, Coupons and Tiers'),
  bullets([
    '**Segments** are C360\'s. CEP reads `segment` and `customer_segment_membership` as synced copies; the Update Segment step writes a membership row back. A segment that does not exist in those tables cannot be chosen.',
    '**Contact lists** are CEP\'s own: uploaded (the template has Time zone, Loyalty tier and Last order date columns), cloned, or made from a segment. One list marked as a test list is needed for Test Publish.',
    '**Coupons** are references C360 syncs into `coupon`. The Issue Coupon step makes no code: it records a request that C360 collects through `GET /api/v1/coupon-issuances/?status=REQUESTED` with a `coupons:issue` key, issues the coupon in its own system and marks the request done with a `PATCH` carrying the status and the external code. Until C360 does that, the customer has no coupon, even though the journey has moved on.',
    '**Loyalty tiers** are references in `loyalty_tier`. Update Loyalty Tier sets the attribute on the record and raises the event; the loyalty system itself is not called unless a Webhook step does it.',
  ]),
  h2('3.6 What CEP Raises Itself'),
  p('No external sender is needed for Email Open/Click, SMS Response, No Response, Preference Update, Coupon Issue (from the step) and Loyalty Tier Change (from the step). A journey built only on these, on lists and on schedules runs with no integration at all beyond the customer records.'),
)

// 4
add(h1('4. Platform Set-Up (Back-Office)'),
  p('The platform team does this once per workspace, and once per environment for the shared parts. Nothing here is visible to the workspace.'),
  ...numbered([
    '**Switch the feature on.** Tenants → the workspace → Industry and features → **Journeys → On** (or Default when the industry profile has it on). The plan has the last word: a plan whose features exclude `journeys` keeps it off. Without the feature the app hides the Journeys menu and the Home card, and the workspace\'s events are refused with 403.',
    '**Apply the database patches.** Patches 0045 (the Goal step: conversions, revenue, the roll-up\'s goal and message columns) and 0046 (per-journey suppressions, the JOURNEY list-member source, the `journey.export` and `journey.suppress` permissions). Both are idempotent re-runs of the platform-operations layer. Both are applied on the shared development database as of 8 October 2026.',
    '**Run one scheduler.** cep-jobs (`manage.py run_scheduler --tick 15`) is one process for the platform. It enrols and moves journey customers every minute, activates scheduled journeys and rolls up the figures nightly. Nothing in a journey moves while it is stopped. Exactly one scheduler must work a given database: a second one skips a workspace the first holds (an advisory lock per workspace, per pass) and logs `locked: 1`. On the development environment the scheduler runs on 10.0.0.51 only.',
    '**Set the encryption key.** `FIELD_ENCRYPTION_KEY` on the application servers, so a Webhook step\'s signing secret is kept encrypted. Without it secrets use a key derived from `SECRET_KEY`, which the Secrets at rest check flags.',
    '**Arrange C360\'s feeds.** The data team writes `customer_master` (with `custom_attributes`), `segment`, `customer_segment_membership`, `coupon` and `loyalty_tier` into the workspace\'s database. CEP treats them as synced copies. This is outside CEP and is the longest lead-time item (see Chapter 12).',
    '**Confirm the sending engines.** The workspace\'s email engine (Postal or Mailgun) and texting engine are configured and their callbacks reach CEP, so that delivered, opened and clicked figures and the Email Open/Click event exist.',
    '**Watch the jobs log.** `jobs.log` on the application server carries one line per pass: `advance-journey-customers` reports moved, held, finished, busy, failed, converted, retrying, gave_up and locked. A failing workspace is logged with its traceback and the others continue.',
  ]),
)

// 5
add(h1('5. Workspace Set-Up (Tenant)'),
  p('The workspace administrator finishes the set-up in the app under Settings. Everything in this table has to exist before the first journey can send a message.'),
  table(['Item', 'Where', 'Why'], [
    ['Rights', 'Settings → Roles', 'Journeys · View (`journey.view`) sees journeys; Create and Edit (`journey.edit`) builds, tests, retries and skips steps, duplicates and archives drafts; Activate (`journey.activate`) approves, schedules, pauses, resumes and archives live journeys; Export (`journey.export`) saves the Customers card as CSV; Suppress (`journey.suppress`) keeps named customers out. Workspace Admin has all five, Analyst has View, Campaign Manager has none by default.'],
    ['Sending', 'Settings → Sending Engines', 'An email engine with a verified default sender, and a texting engine if journeys send texts. A message step with no sender is retried for an hour and then lands on Needs Attention.'],
    ['Templates', 'Templates', 'A **published** template for every message a journey sends. A draft template fails the readiness check.'],
    ['Senders', 'Settings → Sending Engines', 'The senders a message step may pick from; the engine\'s default sender is used when a step names none.'],
    ['A test list', 'Contact Lists', 'A list marked as a test list, holding your own team, for Test Publish.'],
    ['Consent and governance', 'Settings → Consent Policy, Suppressions, Preference Centre, Governance', 'Journey messages go through the same send engine as campaigns: no consent, a suppression, a topic the customer unticked, a frequency cap or quiet hours hold a message back, and the customer\'s timeline says why.'],
    ['Attribution', 'Settings → Attribution', 'Switch it on and have the shop send orders: every order raises a Purchase event, the purchase fields fill, and a Goal counts revenue.'],
    ['Events', 'Settings → API Keys, then Settings → Events', 'A key with the scope `events:ingest` for the shop, the app and the loyalty system. The Events page shows the endpoint, an example, the recent events and whether each customer was found.'],
    ['Coupons', 'Settings → API Keys', 'A key with the scope `coupons:issue` for C360, which collects and answers the Issue Coupon step\'s requests.'],
  ], [1, 2, 4]),
  spacer(),
  p('Recommended order: roles → sending engine and sender → templates → test list → API keys → Attribution → a first journey from a starter.'),
)

// 6
add(h1('6. The Ways to Configure a Journey'),
  p('There are three ways to begin, and within a journey five families of entry, three population modes and three re-entry policies. Together they cover one-off campaigns that run themselves, continuous lifecycle programmes and event-driven reactions.'),
  h2('6.1 From a Starter'),
  p('The Journeys page\'s **Journey Templates** panel offers ten ready-made journeys (**View More** shows them all). Clicking one shows a read-only preview of its steps; **Copy This Template** opens the set-up already filled in. Each copy is yours and the starter never changes. The starters\' message steps have no template yet, so they open marked **Needs Setup** until one is chosen.'),
  table(['Starter', 'Enters on', 'What it does', 'Goal it suggests'], [
    ['Welcome Series', 'Customer Creation event', 'Welcome email; two days later, openers get Our Story, the others an SMS nudge; five days, a welcome coupon and a first-purchase email.', 'First purchase within 30 days'],
    ['Abandoned Cart Recovery', 'Abandoned Cart event (re-entry after 7 days)', 'An hour later a cart reminder; a day later, those who have not bought get a coupon and an SMS with the code.', 'Order placed within 3 days'],
    ['Post-Purchase Thank You & Review', 'Purchase event (re-entry after 30 days)', 'A thank-you email three days after the purchase, a review request a week later.', 'Review submitted'],
    ['First to Second Purchase', 'First Purchase event', 'Two weeks later, those who have not bought again get a coupon and an email.', 'Second purchase within 30 days'],
    ['Win-Back Lapsed Customers', 'Enters your Lapsed segment (re-entry after 180 days)', 'We Miss You email; a week later, buyers leave the segment, the others get a coupon, a 20% email and a last-chance SMS.', 'Return purchase within 21 days'],
    ['Birthday Reward', 'Birthday event (re-entry after 365 days)', 'A birthday coupon and email; a week later, an SMS to those who have not redeemed it.', 'Birthday coupon redeemed'],
    ['Loyalty Tier Upgrade', 'Loyalty Tier Change event (every time)', 'A welcome-to-your-tier email, Add to VIP, an SMS about the perks three days later.', 'Tier perk used within 14 days'],
    ['Coupon Expiry Reminder', 'Coupon Issue event (every time)', 'Eleven days later, those who have not redeemed get an SMS, then a last-day email.', 'Coupon redeemed before expiry'],
    ['Membership Anniversary', 'Anniversary event (re-entry after 365 days)', 'An anniversary email and a reward coupon.', 'Repeat visit within 30 days'],
    ['Re-Engagement / Sunset', 'No Response event (re-entry after 90 days)', 'A Still Want to Hear from Us email; five days later, the silent ones are added to your Sunset segment.', 'Opens or clicks again'],
  ], [2, 2, 4, 2]),
  spacer(),
  h2('6.2 From Scratch and From One of Yours'),
  bullets([
    '**Create Journey** (or **Start from Scratch** in the panel) opens the two-step set-up with nothing filled in.',
    '**Duplicate** on a journey\'s page makes a new draft copy, steps included, to start again or try a variant.',
    '**Save as Template** on a journey\'s page keeps the live version (or the newest, on a draft) as a template of the workspace, with a name, a category and a description. Saved templates sit under **Your Templates** on the Journey Templates panel and in View More, tagged *Saved Template*; they are previewed, used and deleted like a starter, and never change after they are saved.',
  ]),
  h2('6.3 Entry: Every Way a Customer Can Enter'),
  p('The first set-up step asks **What Qualifies a Customer to Enter This Journey?** and then the **Specific Trigger**. The table lists each entry, when it fires, and what has to exist for it.'),
  table(['Entry', 'Enters when', 'Needs'], [
    ['Customer List', 'A customer is on the chosen list (newcomers to the list enter on later passes unless the population is Fixed).', 'A list in Contact Lists, approved if the consent policy asks for it.'],
    ['Event (any standard type, or one you name)', 'That event arrives for the customer after the journey went live, within the last seven days at most.', 'The shop, app or loyalty system sending events; Attribution for purchases; nothing for the events CEP raises itself.'],
    ['Date / Time: Daily, Weekly, Monthly, On a Specific Date', 'The schedule\'s moment comes, for the members of a list or a segment. Times are the workspace\'s time zone; each moment fires once.', 'The list or segment.'],
    ['Date / Time: On a Date Attribute', 'A date on the customer\'s record is the chosen number of days away (every year, or once), at the chosen time. Every Year matches day and month (29 February counts on 28 February in other years); Once matches the full date.', 'A custom attribute holding a date; the Date list shows how many records have each.'],
    ['Enters Segment, Exits Segment', 'The customer joins or leaves the segment.', 'The segment, synced from C360.'],
    ['Loyalty Tier, Preference Update, Address Change', 'The attribute changes: a Loyalty Tier Change event, a preference-centre save that changed something, the Address Change event C360 sends.', 'The events behind them.'],
    ['Customer Attribute Matches', 'The customer\'s record matches the conditions now (each customer once; again on a change with Every Qualifying Event). A grey line says how many would enter now.', 'The attributes the conditions name.'],
  ], [2, 3, 2]),
  spacer(),
  p('**Only Customers Where (Optional)** narrows any trigger with the same condition builder: a customer the trigger would admit enters only if their record matches, for example Country is United States and Email Consent is Opted In.'),
  ...image('02-setup-trigger.png', 'Set-up step 1 with an Event trigger (Loyalty Tier Change) and a Customer Attribute Matches rule. The grey line under the rule says how many customers would enter now.'),
  ...image('03-setup-schedule.png', 'Set-up step 1 with a Date / Time trigger: a Weekly schedule, the time, and Who Enters (a list or a segment). The grey line reads the schedule back as a sentence.'),
  h2('6.4 Population and Re-Entry'),
  table(['Field', 'Choices'], [
    ['Population', '**Fixed**: who qualifies on the first pass after go-live, then nobody new. **Continuously Qualifying**: new matches keep joining on every pass. **Event Triggered**: customers enter the moment the event arrives.'],
    ['Re-Entry', '**Never**: once through, never again. **After X Days**: eligible again after **Days Before Re-Entry**, counted from when they finished or exited. **Every Qualifying Event**: again each time the trigger happens (a customer still inside is never entered twice).'],
  ], [1, 4]),
  spacer(),
  p('Population and re-entry belong to the journey, not to a version: on a live journey they cannot change, while the entry can change as part of a new version.'),
)

// 7
add(h1('7. Building a Journey, Step by Step'),
  h2('7.1 The Builder'),
  p('After **Create Journey** the builder opens on a Draft. The canvas shows the Entry at the top; the **+** between steps adds one; clicking a step opens its panel on the right, and **Save Step** keeps it. A step still to set up is marked **Needs Setup**. The step\'s **⋮** menu duplicates or deletes it. **Journey Settings** on the left shows the entry, population and re-entry; **Edit Setup** reopens the set-up. **Save Draft** (top right) keeps the work; nothing saves on its own. A Condition, Split or continuing Goal opens paths under it; a branching step cannot sit inside another step\'s path.'),
  ...image('01-builder-live.png', 'The builder on a live journey. The banner says version 3 is live and that saving makes a new version. Each card shows its live counts: passed, waiting, held back, failed.'),
  h2('7.2 Wait'),
  p('Three modes. **For a Duration**: minutes, hours, days or weeks. **Until a Time of Day**: the customer continues at that time, in their own time zone (the `timezone` attribute) or the workspace\'s, on any day or only on the days you pick. **Until a Date on the Record**: a date attribute with an offset ("3 days before") and a time; choose whether a customer whose date has passed, or who has none, continues at once or leaves the journey.'),
  ...image('05-wait-time.png', 'Wait Until a Time of Day: the time, whose time zone, and the days it may fall on.'),
  ...image('06-wait-date.png', 'Wait Until a Date on the Record: the date attribute, the offset and time, and what to do with a customer whose date has passed or is missing.'),
  h2('7.3 Condition'),
  p('A Condition splits into Yes and No. Each row is a field, how to compare it, and a value; **All** means every row must hold, **Any** that one is enough; **Add Group** nests an All / Any group inside the rule, up to 20 conditions. A sentence under the builder reads the whole condition back, and **Match on Entry** says how many customers in the journey would answer Yes right now. The same builder writes the Customer Attribute Matches trigger and the Only Customers Where filters.'),
  table(['Fields', 'Compared with'], [
    ['Customer: first name, last name, email, phone, country, state, city, postal code, source system, record updated, last purchase date, number of purchases, and every custom attribute (with its values to pick from when there are few)', 'Text: is, is not, is any of, is none of, contains, does not contain, starts with, is set, is not set. Numbers: equals, does not equal, is at least, is at most, is between. Dates: is within the last N days, is more than N days ago, is before, is after, is between.'],
    ['This Journey (Condition steps only): each Email or SMS step, any message of the journey, each other Condition, the goal', 'A message: was sent, was delivered, was opened, was clicked, bounced, was delivered and not opened, was not sent. A Condition: answered Yes or No. The goal: reached, not reached. Only sends after the customer entered count.'],
    ['Events: the types seen in the last 90 days and the standard ones, or any type you name', 'Happened, did not happen; optionally within the last N days (otherwise since the customer entered, or ever at entry), with filters on the event\'s own data (store is Lakeside, amount is at least 100).'],
    ['Lists and segments', 'Is in, is not in.'],
  ], [2, 3]),
  ...image('04-condition.png', 'A Condition with four rows and a nested Any group: a loyalty tier, a date comparison, this journey\'s Welcome email, and an event with a property filter. The sentence and the Match on Entry count sit under the rule.'),
  h2('7.4 Goal'),
  p('The Goal step names the outcome the journey is for: an event (Purchase, Coupon Redemption, or any type you name), optional filters on its data (order total is at least 25), and an attribution window from entering (14 days). A customer is **converted** when the event arrives within the window, whether they have reached the step or are anywhere else in the journey. **Mark converted and exit** takes them out; **Mark converted and continue on the Reached path** opens Reached and Not Yet paths under the step, so a thank-you can follow. Revenue is the matching events\' amounts as Attribution sends them. One Goal step per journey.'),
  ...image('07-goal.png', 'The Goal step: the event, its filters, the window in days, and what happens when it is reached.'),
  h2('7.5 Split'),
  p('**By an Attribute**: each customer takes the first path whose values hold their attribute\'s value (Home Store is Lakeside Mall → Path 1; Downtown or Airport → Path 2), everyone else the last path. **At Random**: percentages that add up to 100, chosen once per customer and kept on retry. Name each path; the names show on the canvas.'),
  ...image('08-split.png', 'A Split by an attribute with named paths and an Otherwise path.'),
  h2('7.6 Steps That Change the Record'),
  bullets([
    '**Update Profile** sets any attribute on the customer\'s record to a value (Customer Status to Welcomed).',
    '**Update Loyalty Tier** sets the tier and raises a Loyalty Tier Change event.',
    '**Update Segment** adds the customer to a segment or removes them; **Add to List** and **Remove from List** change a contact list membership.',
    '**Issue Coupon** records a request for C360 (Section 3.5) and raises a Coupon Issue event.',
  ]),
  ...image('09-profile.png', 'Update Profile: the attribute and the value to write.'),
  h2('7.7 Email and SMS / MMS'),
  p('A message step sends a **published** template through the normal send engine, as a generated campaign of its own (one per step per day), so consent, suppressions, the preference centre, frequency caps and quiet hours apply exactly as to a campaign. A held-back message is recorded on the customer\'s timeline with its reason. The step\'s template and its **Sender** are chosen in the panel; left as *Workspace default*, the message goes from the engine\'s default sender for the channel, and an SMS step offers texting senders only.'),
  h2('7.8 Webhook'),
  p('A Webhook step makes a signed JSON POST to an https address of yours (http only for localhost) with the customer (id, name, email, phone, and their custom attributes when ticked), the journey, the step and the enrollment. A signing secret, kept encrypted and never shown again, puts `X-CEP-Signature` beside `X-CEP-Timestamp` on every call; `X-CEP-Delivery` is unique per call. **Send a Test Call** posts a sample customer with the same headers; it shows on the Webhook Calls card. Chapter 11 has the payload and the verification code.'),
  ...image('10-webhook.png', 'The Webhook step: the address, the signing secret (shown only as set or not), whether to include custom attributes, and Send a Test Call.'),
  h2('7.9 Preview Route'),
  p('**Preview Route** (top right) walks the saved draft as one customer without sending or recording anything: whether they would enter, when each wait would continue, whether each message would send under today\'s consent and suppressions, which way each Condition on their record answers, and where the path ends. A step that depends on something that has not happened yet (a message outcome, a goal event) asks which way to assume. Use it before Test Publish, which sends real messages.'),
  ...image('13-preview-route.png', 'Preview Route for one customer: each step with its verdict and continue time, with Assume Yes / No and Assume reached / not reached where the outcome is not known yet.'),
  h2('7.10 Test Publish, Approve and Go Live'),
  ...numbered([
    'Choose **Continue to Test Publish** when every step is set up.',
    'Choose the **Test Population**: a **Random Sample of Live Audience** (up to 200 customers who would enter now) or a **Specific Test List**.',
    'Four **Readiness Checks** must pass: entry rules configured; all canvas steps configured and every path ended; templates ready (published); governance rules satisfied (always passes and lists the caps that apply).',
    '**Run Test Publish**, then **Send Test**. The test **sends real messages** to that population and skips waits, so use the test list. The results show who got what and how many were held back and why. Test customers leave the journey when the test ends.',
    '**Approve & Activate →** (needs Activate). **Activate Immediately** or **Schedule for Later** (a date and a time). A scheduled journey reads Approved until its time; **Cancel Schedule** takes it back to Test.',
    'From then on CEP enrols qualifying customers every minute. Watch them arrive on the journey\'s page.',
  ]),
)

// 8
add(h1('8. How the Process Works'),
  p('Four scheduled jobs run every journey. Knowing what each does explains every delay, every held-back message and every figure on the journey\'s page.'),
  table(['Job', 'Every', 'What it does'], [
    ['enroll-journey-customers', 'minute', 'Enters the customers who meet a live journey\'s entry: list members, events (seven days back at most, 5,000 per journey per pass), segment changes, Date / Time moments (each fires once), attribute matches. Only Customers Where filters and the journey\'s own suppressions apply. A Fixed journey closes after its first pass.'],
    ['advance-journey-customers', 'minute', 'First converts anyone whose goal event arrived, then moves the customers whose next step is due. Logs moved, held, finished, busy, failed, converted, retrying, gave_up and locked.'],
    ['activate-scheduled-journeys', 'minute', 'Takes approved journeys live when their time comes, retiring the older live version.'],
    ['rollup-journey-analytics', 'nightly', 'Rolls enrolments, conversions, revenue and the message counts per journey into the analytical table that feeds Performance.'],
  ], [2, 1, 4]),
  spacer(),
  h2('8.1 One Customer\'s Path'),
  ...numbered([
    'The enrol pass finds the customer qualifies (entry, filters, not suppressed, not already inside, re-entry allows it) and creates an **enrollment** at the Entry with a state record pointing to the first step.',
    'The advance pass runs each step whose time is due. A Wait sets the next due time. A Condition evaluates the rule against the record and the journey\'s own history and follows Yes or No. A Split picks a path. A message step creates (or reuses today\'s) generated campaign and hands the message to the send engine, which applies consent, suppressions, caps and quiet hours. A record step writes the record. A Webhook posts. A Goal waits for its event or, when reached, converts.',
    'Every outcome is written to the customer\'s **timeline**: the step, the time, the result, and for a message the delivered, opened and clicked moments as callbacks arrive.',
    'The customer leaves at an Exit Journey step (converted when the journey has no Goal), when the Goal is reached with exit, when a date wait sends them out, when suppressed, or when the journey is archived (exited early with the reason).',
  ]),
  h2('8.2 Failures and Retries'),
  p('A step that fails for a temporary reason (no sender yet, a provider outage, a webhook timeout, 429 or 5xx) is tried again after **5, 15 and 60 minutes**, then given up and listed on the journey\'s **Needs Attention** card with the reason, the tries and the next try. **Retry Now** runs the step again on the next pass; **Skip Step** records it as skipped and moves the customer on. A permanent failure (a missing template, a webhook refused with another 4xx) is recorded on the timeline and the customer carries on. The retry state lives on the customer\'s state record; nothing needs a setting.'),
  h2('8.3 Versions'),
  p('Saving a change to a live journey makes the **next version** as a draft; the live version keeps running untouched. The new version goes through Test Publish and approval like the first. Approved now, new customers enter it at once and customers already inside finish the version they started; approved for later, the live version runs until that time. The Versions card lists every version, with the running one tagged Live and a waiting one Scheduled.'),
  h2('8.4 Locks and Concurrency'),
  p('One scheduler at a time works a workspace, held by an advisory lock for the pass. A second scheduler on the same database skips the workspace and logs `locked: 1`. Within a pass, a customer is moved by one worker only; a Split\'s random choice is kept on retry so a customer never changes path.'),
)

// 9
add(h1('9. How the Output Is Measured'),
  p('The journey\'s page is the place to read results. Each card answers a different question, from the whole journey down to one customer.'),
  table(['Where', 'Figure', 'Definition'], [
    ['Performance card', 'Enrolled', 'Customers who entered, across all versions.'],
    ['', 'In Journey', 'Customers currently inside (waiting at a step or being moved).'],
    ['', 'Converted', 'With a Goal: customers whose goal event arrived within the window, with their attributed revenue and the average per conversion. Without a Goal: customers who reached an Exit Journey step.'],
    ['', 'Exited Early', 'Customers who left before the end: a date wait sent them out, a suppression, an archive.'],
    ['', 'Enrollment Over Time', 'Weekly entries, to see whether the trigger is firing as expected.'],
    ['', 'Messages, All Steps', 'Every message step\'s sent, delivered, opened, clicked, bounced, complained, unsubscribed, held back (by reason) and failed figures for the last 30 days.'],
    ['Builder canvas', 'Per-step counts', 'On a live or paused version: passed, waiting, held back, failed, Yes / No (Condition), reached (Goal), refreshed every minute. The fastest way to find where customers pile up.'],
    ['Needs Attention card', 'Retrying / Gave up', 'Customers whose step failed for a temporary reason, with the reason, tries and next try.'],
    ['Customers card', 'The list', 'Everyone who entered, newest first, where they are now; search by name or email, filter by status and, once a step has held anyone back, by **Held Back Reason** with how many customers each; Export CSV (`journey.export`) follows the filters.'],
    ['Customer timeline', 'One customer', 'Entry, every step with its outcome and time, a held-back message\'s reason, a Condition\'s answer, the Goal, where they wait now, how they left. **View Customer Record** opens the customer\'s page.'],
    ['Customer page', 'One customer, every journey', 'Contact Lists → Find a Customer, or the link from a timeline: the record, consent per channel, custom attributes, every journey entered with a link to each timeline, events, orders, messages and lists, in one place.'],
    ['Webhook Calls card', 'Calls', 'Every call a Webhook step made, test calls included: the endpoint\'s answer, the try, the duration.'],
    ['Generated Campaigns', 'Per step per day', 'Each message step sends through a campaign; open one for its recipients and results, the same as any campaign.'],
    ['Reports → Journeys dataset', 'Per journey per day', 'Entered, converted with revenue, sent, delivered, opened, clicked, held back and failed over a period, with a journey filter, the day curve, a row per journey and a CSV of every journey\'s every day.'],
    ['Nightly roll-up', 'journey_master_analytical', 'Enrolments, conversions, revenue and message counts per journey, for the Performance card. Lags the live page by up to a day.'],
  ], [2, 2, 4]),
  spacer(),
  ...image('11-customers.png', 'The Customers card: everyone who entered, where they are now, search and status filter, Export CSV.'),
  ...image('12-timeline.png', 'One customer\'s timeline: entry, each step with its outcome and time, the message\'s delivered and opened moments, and where they wait now.'),
  ...image('14-needs-attention.png', 'The Needs Attention card: the failed step, the reason, the tries and next try, with Retry Now and Skip Step.'),
  h2('9.1 Reading the Figures'),
  bullets([
    '**Entered but nobody moves**: the scheduler (Chapter 4) or every pass logging `locked: 1`.',
    '**Many held back on a message step**: consent, suppressions, a frequency cap or quiet hours; the Customers card's Held Back Reason filter lists the customers behind each reason, and the timeline says which for one customer. Governance applies to journeys as it does to campaigns.',
    '**Converted looks too high**: a journey without a Goal counts every Exit arrival as converted. Add a Goal with the real outcome.',
    '**Revenue is zero**: Attribution is off, or the shop is not sending orders, or the Goal\'s event is not Purchase.',
    '**Delivered and opened never fill**: the engine\'s callbacks are not reaching CEP (the engine card on Settings → Sending Engines shows callback health).',
  ]),
)

// 10
add(h1('10. Using Journeys Already Set Up'),
  p('The Journeys page lists every journey in the workspace with its status, trigger, channels and steps. Open one for its page: the header (status, trigger, channels, the actions your rights allow), notices (draft, paused, scheduled, a new version waiting), Performance, Setup (trigger, Goal, Exit Criteria, re-entry, audience), Needs Attention, Customers, Suppressions, Webhook Calls, Versions, Generated Campaigns and Activity.'),
  table(['To', 'Do'], [
    ['Change a draft or tested journey', '**Edit Journey** opens the builder on the same version. Change steps, **Save Draft**, run Test Publish again before approving.'],
    ['Change the entry, population or re-entry', 'In the builder, **Edit Setup**. On a draft everything can change; on a live journey the entry can change as part of a new version, population and re-entry cannot.'],
    ['Change a live journey', '**Edit Journey**, make the changes, **Save Draft** (saved as the next version). On the journey\'s page, **Test Publish Version N**, then approve it now or for later. Customers already inside finish the version they started.'],
    ['Pause and resume', '**Pause Journey**: nobody new enters and nobody moves. **Resume Journey** carries on where everyone was.'],
    ['End for good', '**Archive Journey**, then confirm: nobody new enters, everyone inside leaves (exited early), versions are retired, a scheduled start is dropped. Cannot be undone; needs Activate for a live, paused or scheduled journey.'],
    ['Copy', '**Duplicate** makes a new draft copy to start again or try a variant.'],
    ['Keep a customer out', 'Suppressions card: add by email, mobile number or customer id with a note (a customer inside leaves at once); remove later. Needs `journey.suppress`.'],
    ['Unstick a customer', 'Needs Attention card: **Retry Now** or **Skip Step**.'],
    ['Check one customer', 'Customers card: search, open the timeline.'],
    ['Edit the Goal and Exit Criteria notes', 'On the journey\'s page, in Setup, the pencil beside each note edits it in place.'],
  ], [2, 5]),
)

// 11
add(h1('11. Integration Guide'),
  p('Four integration points connect a journey to the outside world: events in, orders in, coupon requests out (polled by C360) and webhooks out. All of them use the workspace\'s API keys from Settings → API Keys, sent as a Bearer token, and every call is logged under Settings → Integration Log.'),
  h2('11.1 Sending Events'),
  p('`POST /api/v1/events/` with a key holding `events:ingest`. One event, or `{"events": [...]}` with up to 500. `event_type` is required; the customer is named by `party_id`, `email` or `phone` (an email or number must match a customer in the records). `event_id` makes resends harmless. `occurred_at` defaults to now. `payload` is free JSON and is what Event conditions filter on.'),
  ...code([
    'POST /api/v1/events/',
    'Authorization: Bearer <key with events:ingest>',
    'Content-Type: application/json',
    '',
    '{',
    '  "event_type": "CART_ABANDON",',
    '  "event_id": "cart-77812",',
    '  "party_id": "C-88213",',
    '  "occurred_at": "2026-10-06T09:30:00Z",',
    '  "payload": { "cart_value": 84.5, "items": 3, "cart_url": "https://shop.example/cart/77812" }',
    '}',
    '',
    'Answer per event: ACCEPTED, DUPLICATE (same event_id seen before) or REJECTED with errors.',
  ]),
  spacer(),
  p('Who should send what: the shop sends Customer Creation, Abandoned Cart, Category Purchase and Coupon Redemption; the loyalty system sends Welcome, Loyalty Tier Change and Anniversary; C360 sends Address Change and Segment Inception; nobody sends Purchase (orders do that). Any event type not in the standard list can be sent and used by name.'),
  h2('11.2 Sending Orders'),
  p('`POST /api/v1/orders/` with a key holding `orders:ingest`. One order or `{"orders": [...]}` with up to 500; idempotent on `order_id`. `order_id` and `amount` (the revenue to count, without tax and shipping) are required; the person is named by `party_id`, `email` or `phone`. A refund is `"type": "REFUND"` with a positive amount and `original_order_id`. Each accepted order raises Purchase (and First Purchase for a first order), fills the purchase fields on the record, and credits a Goal\'s revenue.'),
  ...code([
    'POST /api/v1/orders/',
    'Authorization: Bearer <key with orders:ingest>',
    '',
    '{ "order_id": "W-100234", "amount": 129.5, "currency": "USD", "ordered_at": "2026-10-04T14:30:00Z",',
    '  "email": "jane@example.com", "party_id": "C-88213" }',
  ]),
  spacer(),
  h2('11.3 Fulfilling Coupon Requests (C360)'),
  p('The Issue Coupon step records a request. C360 polls `GET /api/v1/coupon-issuances/?status=REQUESTED&after=<last id>` with a key holding `coupons:issue` (oldest first, 200 a page), issues the coupon in its own system, and marks each request done with `PATCH /api/v1/coupon-issuances/{id}/` carrying `{"status": "ISSUED", "external_code": "…"}` (or `FAILED` with a note). Settings → Events → Coupon Requests shows the queue. Until C360 does this, the customer has no code, and a later "those who have not redeemed" condition reads as not redeemed for everyone.'),
  h2('11.4 Receiving Webhooks'),
  p('A Webhook step POSTs the body below to the configured https address, with the headers `Content-Type: application/json`, `User-Agent: CEP-Journeys/1.0`, `X-CEP-Event` (`journey.step`, or `journey.test` for a test call), `X-CEP-Delivery` (unique per call), `X-CEP-Timestamp` (Unix seconds) and, when a secret is set, `X-CEP-Signature`. Answer 2xx within 10 seconds. 429 and 5xx, a timeout or a connection error are retried after 5, 15 and 60 minutes; any other 4xx is recorded as refused and the customer carries on.'),
  ...code([
    '{',
    '  "event": "journey.step", "sent_at": "2026-10-08T14:02:11+00:00", "delivery_id": "9c1f…",',
    '  "journey": { "id": "…", "code": "JRN-2026-00012", "name": "Welcome Series", "version": 3 },',
    '  "step": { "key": "webhook-1", "label": "Tell the CRM" },',
    '  "customer": { "party_id": "C-88213", "first_name": "Devon", "last_name": "Okafor",',
    '                "email": "devon@example.com", "phone": "+1…", "attributes": { "loyalty_tier": "GOLD" } },',
    '  "enrollment": { "id": "…", "status": "ACTIVE", "enrolled_at": "2026-10-01T09:00:00+00:00", "converted_at": null }',
    '}',
  ]),
  spacer(),
  p('Verify the signature: `X-CEP-Signature` is `sha256=` followed by the hex HMAC-SHA256, keyed with the secret, over the string `<X-CEP-Timestamp>.<raw body>`. Compare in constant time, and reject timestamps older than a few minutes to stop replays. Use `X-CEP-Delivery` to ignore a duplicate delivery after a retry.'),
  ...code([
    '# Python (Flask)',
    'import hmac, hashlib, time',
    'def verify(request, secret):',
    '    ts = request.headers["X-CEP-Timestamp"]',
    '    expected = "sha256=" + hmac.new(secret.encode(), ts.encode() + b"." + request.get_data(), hashlib.sha256).hexdigest()',
    '    fresh = abs(time.time() - int(ts)) < 300',
    '    return fresh and hmac.compare_digest(expected, request.headers.get("X-CEP-Signature", ""))',
    '',
    '// Node (Express, with express.raw({ type: "application/json" }))',
    'const crypto = require("crypto")',
    'function verify(req, secret) {',
    '  const ts = req.get("X-CEP-Timestamp")',
    '  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.`).update(req.body).digest("hex")',
    '  const given = req.get("X-CEP-Signature") || ""',
    '  return Math.abs(Date.now() / 1000 - Number(ts)) < 300 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))',
    '}',
  ]),
  spacer(),
  h2('11.5 C360 Feeds'),
  p('C360 writes directly into the workspace\'s database: `customer_master` (one row per customer with `custom_attributes` as JSON), `segment` and `customer_segment_membership`, `coupon` and `loyalty_tier`. CEP reads them as synced copies; the Update Segment, Update Profile and Update Loyalty Tier steps write back to them. A sync that deletes and recreates rows will break enrollments that point at the old rows, so the feed should update in place.'),
  h2('11.6 A Minimal Go-Live Sequence'),
  ...numbered([
    'C360 feed of customer records with `timezone` and the attributes the first journey needs.',
    'Sending engine with callbacks verified (a test send shows Delivered and Opened).',
    'Attribution on and the shop posting orders (a test order appears under Settings → Attribution).',
    'The shop posting the first event type (a test event appears under Settings → Events with the customer found).',
    'A starter copied, its templates chosen, Preview Route for one real customer, Test Publish to the test list, approve.',
    'Watch Enrollment Over Time and the canvas counts for a day, then Needs Attention.',
  ]),
)

// 12
add(h1('12. Gaps to Fill Before Journeys Are Used in Production'),
  p('The engine, the builder, the measurement and the app-side gaps below are complete and deployed (PRs #98 to #109). What remains is in the systems around the app. Each item says what is missing, what it blocks, and what fills it.'),
  h2('12.1 Gaps in the App, Now Closed'),
  p('The app-side gaps found while writing this guide were built and deployed in PR #109 on 8 October 2026. They are kept here so a reader of an earlier copy knows what changed.'),
  table(['Was', 'Now'], [
    ['No customer record page', 'Contact Lists → **Find a Customer** searches by name, email, mobile or id. A customer\'s page shows the record, consent per channel, custom attributes, every journey entered with a link to the timeline, events, orders, messages and lists. A journey\'s timeline drawer, a list\'s members and Settings → Events link to it.'],
    ['No report engine and no Journeys dataset', 'Reports has a **Dataset** switch. The Journeys dataset is per journey per day: entered, converted with revenue, sent, delivered, opened, clicked, held back, failed; tiles, the day curve, a row per journey, a journey filter and a CSV of every journey\'s every day.'],
    ['No save-as-template', '**Save as Template** on a journey\'s page keeps the live version as a template of the workspace; **Your Templates** on the Journey Templates panel and in the gallery previews, copies and deletes them. A platform catalogue of shared starters is still not offered: CEP\'s starters stay in code.'],
    ['Message steps have no sender choice', 'A **Sender** field on Email and SMS / MMS steps, the workspace default unless another is picked.'],
    ['Test Publish skips waits only', 'Unchanged, by design: Preview Route asks which way to assume a step that depends on what has not happened yet.'],
    ['Journey timelines are not searchable by event', 'The Customers card filters by **Held Back Reason**, with how many customers each, and the export follows the filter.'],
  ], [2, 6]),
  spacer(),
  h2('12.2 Gaps in Data and Integrations'),
  table(['Gap', 'What it blocks', 'Fills it'], [
    ['C360 feeds are not running into the development workspace', 'Only customers from contact list uploads exist; segments, coupons and loyalty tiers are empty, so Win-Back, Birthday, Loyalty Tier Upgrade, Coupon Expiry and every Issue Coupon step have nothing to work on.', 'The data team\'s sync of `customer_master`, `segment`, `customer_segment_membership`, `coupon`, `loyalty_tier`, updating in place.'],
    ['`timezone` and date attributes are not on the records', 'Until a Time of Day waits in the workspace\'s zone; On a Date Attribute entries and date waits find no dates.', 'C360 sends `timezone` (IANA) and `birth_date` / `membership_date` / `renewal_date` as `YYYY-MM-DD`; or the upload template\'s columns for CEP-owned contacts.'],
    ['No external system sends events yet', 'Event entries other than the ones CEP raises itself never fire; Abandoned Cart, Customer Creation, Coupon Redemption and Category Purchase journeys stay empty.', 'An `events:ingest` key per sender and the calls in Section 11.1 from the shop, the app and the loyalty system.'],
    ['Attribution is off and no orders arrive', 'No Purchase or First Purchase events, no Last Purchase Date, no revenue on any Goal.', 'Switch Attribution on; the shop posts orders (Section 11.2); POS Receipts for store sales.'],
    ['Coupon fulfilment by C360 is not built', 'Issue Coupon records requests that nobody answers; customers get no code.', 'C360 polls and resolves coupon requests with a `coupons:issue` key (Section 11.3).'],
    ['SMS sending has never run with real Digivize keys and the sandbox posts no callbacks', 'SMS steps are accepted by the adapter but no live send has been made; delivered and reply figures for texts cannot fill; SMS Response events do not arrive.', 'Production Digivize credentials, a live test send, and Digivize\'s delivery callback pointed at CEP.'],
    ['Email engine callback history', 'Postal callbacks arrive since 1 October; sends before that have no delivered or opened figures. Mailgun workspaces need their webhooks registered per domain.', 'Register the callback on every engine and verify with a test send.'],
    ['Webhook receivers do not exist', 'The Webhook step has nowhere to post until the CRM or ticketing side exposes an https endpoint and verifies the signature.', 'An endpoint per use (Section 11.4), tested with Send a Test Call.'],
    ['Preference centre and consent policy not set per workspace', 'Message steps are held back (no consent) or sent without topic control.', 'Settings → Consent Policy and Preference Centre, with the topics each journey\'s template uses.'],
  ], [2, 3, 3]),
  spacer(),
  h2('12.3 Suggested Order'),
  ...numbered([
    'C360 customer feed with `timezone` and the date attributes (unblocks every starter that reads the record).',
    'Attribution on and orders flowing (unblocks Purchase goals and revenue).',
    'The shop\'s events (unblocks Abandoned Cart, Customer Creation).',
    'Email engine callbacks verified on every workspace; Digivize production keys and callback.',
    'Segments and coupons from C360, then coupon fulfilment.',
    'In the app: a dark-theme pass over the customer page, the Journeys report and Save as Template; a platform catalogue of shared starters if workspaces are to share them.',
  ]),
)

// Appendices
add(h1('Appendix A. Permissions'),
  table(['Permission', 'Label', 'Allows'], [
    ['`journey.view`', 'Journeys · View', 'See the Journeys page, a journey\'s page, its customers and timelines.'],
    ['`journey.edit`', 'Journeys · Create and Edit', 'Create, build, save, test publish, retry and skip steps, duplicate, archive drafts.'],
    ['`journey.activate`', 'Journeys · Activate', 'Approve, schedule, cancel a schedule, pause, resume, archive live journeys.'],
    ['`journey.export`', 'Journeys · Export', 'Export the Customers card as CSV.'],
    ['`journey.suppress`', 'Journeys · Suppress', 'Add and remove per-journey suppressions.'],
  ], [2, 2, 4]),
  spacer(),
  h1('Appendix B. Endpoints'),
  table(['Endpoint', 'Key scope', 'Purpose'], [
    ['`POST /api/v1/events/`', '`events:ingest`', 'One event or up to 500; ACCEPTED / DUPLICATE / REJECTED per event.'],
    ['`GET /api/v1/workspace/events/`, `GET /api/v1/workspace/events/recent/`', 'a user session', 'The known types, the keys with the scope, and the recent events (the Settings → Events page).'],
    ['`POST /api/v1/orders/`', '`orders:ingest`', 'Orders and refunds for Attribution.'],
    ['`GET /api/v1/coupon-issuances/`, `PATCH /api/v1/coupon-issuances/{id}/`', '`coupons:issue`', 'C360 collects Issue Coupon requests and marks them ISSUED or FAILED.'],
    ['`POST /api/v1/pos/transactions/`', 'the POS key', 'Store transactions (e-receipts) that count as sales when POS Receipts is on.'],
    ['`/api/v1/journeys/…`', 'a user session with the journey permissions', 'Everything the app does: condition-fields, condition-count, preview-customers, customers (+ export, reasons, timeline, retry, skip), versions/{n}/counts and preview, suppressions, attention, webhook-test, webhook-calls.'],
    ['`/api/v1/journey-templates/`', 'a user session with `journey.edit`', 'The workspace's saved templates: list, save (a journey and a version number), rename, delete.'],
    ['`GET /api/v1/customers/?q=`, `GET /api/v1/customers/{party_id}/`', 'a user session that may see lists, campaigns or journeys', 'The customer search and the customer page.'],
    ['`GET /api/v1/reports/journeys/`, `/reports/journeys.csv`', 'a user session with `report.view`', 'The Journeys dataset per journey per day, and its CSV.'],
    ['Outbound: the Webhook step', 'the step\'s secret', 'A signed POST per customer per step (Section 11.4).'],
  ], [3, 2, 3]),
  spacer(),
  h1('Appendix C. Screenshot Index'),
  p('All figures were captured from the app\'s design playgrounds (`/dev/journey-build`, `/dev/journey-setup`, `/dev/journey-condition`, `/dev/journey-timeline`) with sample data, so they show the exact screens without a workspace\'s real customers. The files live in `docs/guides/journeys/`.'),
  table(['File', 'Figure'], [
    ['01-builder-live.png', 'The builder on a live version with per-step counts'],
    ['02-setup-trigger.png', 'Set-up: an event trigger and an attribute-match rule'],
    ['03-setup-schedule.png', 'Set-up: a weekly schedule'],
    ['04-condition.png', 'A Condition with a nested group and Match on Entry'],
    ['05-wait-time.png', 'Wait Until a Time of Day'],
    ['06-wait-date.png', 'Wait Until a Date on the Record'],
    ['07-goal.png', 'The Goal step'],
    ['08-split.png', 'A Split by an attribute'],
    ['09-profile.png', 'Update Profile'],
    ['10-webhook.png', 'The Webhook step'],
    ['11-customers.png', 'The Customers card'],
    ['12-timeline.png', 'One customer\'s timeline'],
    ['13-preview-route.png', 'Preview Route'],
    ['14-needs-attention.png', 'The Needs Attention card'],
  ], [2, 4]),
)

const doc = new Document({
  creator: 'CEP',
  title: 'CEP Journeys: Operational Set-Up and Implementation Guide',
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
