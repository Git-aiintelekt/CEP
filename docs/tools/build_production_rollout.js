// Generates docs/C360_Production_Rollout.docx, the production rollout plan (also published as a page). Needs the docx package:
//   node docs/tools/build_production_rollout.js docs/C360_Production_Rollout.docx

const fs = require('fs')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, Header, Footer, PageNumber, TableOfContents, PageBreak, TabStopType,
} = require('docx')

const FONT = 'Calibri'
const MONO = 'Consolas'
const INK = '1F2937'
const MUTED = '6B7280'
const BRAND = '2753E4'
const WIDTH = 9026 // A4 with 1" margins, in DXA

// ---------------------------------------------------------------------------------------------- building blocks
const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: 21, color: INK, ...opts })
function rich(text) {
  // `code` and **bold** inside a sentence
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
    part.startsWith('`') ? new TextRun({ text: part.slice(1, -1), font: MONO, size: 19, color: '0F172A', shading: { type: ShadingType.CLEAR, fill: 'EEF2F7' } })
    : part.startsWith('**') ? run(part.slice(2, -2), { bold: true })
    : run(part))
}
const p = (text, opts = {}) => new Paragraph({ children: rich(text), spacing: { after: 120, line: 288 }, ...opts })
let firstHeading = true
const h1 = (text) => new Paragraph({ pageBreakBefore: firstHeading ? !(firstHeading = false) : false, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: BRAND })], spacing: { before: 360, after: 160 }, keepNext: true })
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: FONT, size: 25, bold: true, color: INK })], spacing: { before: 260, after: 110 }, keepNext: true })
const bullet = (text, level = 0) => new Paragraph({ children: rich(text), numbering: { reference: 'bullets', level }, spacing: { after: 70, line: 280 } })
let listCounter = 0
const steps = (items) => { const reference = `steps${listCounter++}`; stepRefs.push(reference); return items.map((text) => new Paragraph({ children: rich(text), numbering: { reference, level: 0 }, spacing: { after: 80, line: 280 } })) }
const stepRefs = []

function code(lines, title) {
  const out = []
  if (title) out.push(new Paragraph({ children: [new TextRun({ text: title, font: FONT, size: 17, bold: true, color: MUTED })], spacing: { before: 100, after: 40 }, keepNext: true }))
  const list = lines.split('\n')
  list.forEach((line, index) => out.push(new Paragraph({
    children: [new TextRun({ text: line === '' ? ' ' : line, font: MONO, size: 17, color: '0F172A' })],
    shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
    spacing: { before: index === 0 ? 40 : 0, after: index === list.length - 1 ? 160 : 0, line: 250 },
    indent: { left: 120, right: 120 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 6 } },
    keepLines: true,
  })))
  return out
}

function note(label, text, fill = 'FEF3C7', edge = 'D97706') {
  return new Paragraph({
    children: [run(`${label}  `, { bold: true }), ...rich(text)],
    shading: { type: ShadingType.CLEAR, fill }, spacing: { before: 80, after: 160, line: 280 }, indent: { left: 120, right: 120 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: edge, space: 6 } },
  })
}

function table(widths, header, rows) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const cell = (text, width, head) => new TableCell({
    width: { size: width, type: WidthType.DXA }, borders, margins: { top: 70, bottom: 70, left: 100, right: 100 },
    shading: head ? { type: ShadingType.CLEAR, fill: 'E8EDFB' } : undefined,
    children: String(text).split('\n').map((line) => new Paragraph({ children: head ? [run(line, { bold: true, size: 19 })] : rich(line).map((r) => r), spacing: { after: 30, line: 260 } })),
  })
  return [new Table({
    width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: header.map((text, i) => cell(text, widths[i], true)) }),
           ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((text, i) => cell(text, widths[i], false)) }))],
  }), new Paragraph({ children: [], spacing: { after: 140 } })]
}

// ---------------------------------------------------------------------------------------------- content
const body = []
const add = (...items) => items.flat().forEach((item) => body.push(item))


add(
  new Paragraph({ children: [new TextRun({ text: 'C360 PRODUCTION ROLLOUT', font: FONT, size: 22, bold: true, color: BRAND, characterSpacing: 40 })], spacing: { before: 2200, after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: 'Insights in production', font: FONT, size: 56, bold: true, color: INK })], spacing: { after: 200 } }),
  new Paragraph({ children: [run('A clean production database, a platform super user who can enter every workspace, a demo workspace with today\'s demo data, and reports on the customer\'s own MySQL database without slowing it down.', { size: 26, color: MUTED })], spacing: { after: 480 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND, space: 12 } } }),
  ...table([2600, 6426], ['At a glance', ''], [
    ['Production server', '`192.168.10.18`, with the database on the same server'],
    ['Product', 'Insights only (the reports engine)'],
    ['Platform super user', '`platform@aiintelekt.com`'],
    ['Customer database', 'MySQL 5.7, no read replica'],
    ['Plan of', '22 October 2026 (updated with the answers of the same day)'],
  ]),
  new Paragraph({ children: [new PageBreak()] }),
)

add(h1('1. Decisions'),
  table([2500, 6526], ['Topic', 'Decision'], [
    ['Server', 'A new production server, `192.168.10.18` (reached at port 8811 today). The application and its PostgreSQL database run on the same machine. The dev server (10.0.0.51) and the release-test server (10.0.0.56) stay as they are.'],
    ['Product', 'Insights only. Production workspaces are on the **Insights** plan, which includes the reports engine and not Engagement.'],
    ['Platform super user', '`platform@aiintelekt.com`, in its own **Platform** workspace: the back-office for every workspace, and a Switch Workspace menu in the app.'],
    ['Switching workspace', 'Every switch is recorded and shown to that workspace\'s administrators, like Sign In As today.'],
    ['Demo workspace', 'Today\'s NWA workspace, with its demo data, copied into production as its own workspace. None of NWA\'s sign-ins come with it: their accounts arrive disabled and without a password, kept only as the authors of the data. The super user reaches the demo through Switch Workspace.'],
    ['Database scripts', 'One script builds the empty production database; a separate script loads the reference data and the first platform administrator; another loads the demo data.'],
    ['Customer data', 'Reports read the customer\'s MySQL 5.7 database through Report Databases. It has no read replica, so the limits in section 3 apply, and a nightly copy into ClickHouse is recommended.'],
  ]),
)

add(h1('2. Work before the install'),
  p('Six changes to the code, each its own pull request, tested before the install.'),
  table([500, 2500, 4526, 1500], ['#', 'Change', 'What it does', 'Status'], [
    ['1', 'Production database scripts', '`build_production_db.sh` (the empty database, without sample data), `load_reference_data.sh` (production settings, the Platform workspace and `platform@aiintelekt.com`), `verify.sql`, `apply_patch.sh` with a record of applied patches. Patch 0072 puts the core permissions into the schema (until now only the demo seed had them) and adds the Insights plan. Rehearsed on a throwaway database; a CI job builds one on every change.', '**Built**, awaiting commit'],
    ['2', 'Insights-only workspaces', 'The Insights plan exists (patch 0072). Check every screen an Insights-only workspace reaches: the launcher, the first page after sign-in, Settings, the help; no Engagement page or menu item.', 'Next'],
    ['3', 'Copy a workspace to another database', 'Export a workspace with every table and a checksum, load it into another installation (`load_demo_data.sh`). NWA\'s people arrive disabled, without passwords, with placeholder addresses; the logs stay behind. Secrets do not travel: keys are entered again on production. Rehearsed with the local NWA: 38,506 rows in 108 tables, and all 20 demo reports run on the copy.', '**Built**'],
    ['4', 'Switch Workspace', 'A menu for platform administrators with a search over every workspace. You enter as yourself with full rights; each switch is recorded and listed for the workspace\'s administrators. Plan, mockup with options, your pick, then the build.', 'Next'],
    ['5', 'Protecting the customer\'s database', 'A time limit and a parallel-query cap set per connection, tighter for a production database than a test one; and the nightly copy of the mapped tables into ClickHouse, so working-hours reports never touch the MySQL database.', 'Next'],
    ['6', 'Deployment guide', 'The C360 Deployment Guide 2.0: the layout the servers run now (the job scheduler instead of Celery, the separate Insights service), the new scripts, the MySQL reporting account.', '**Built**'],
  ]),
)

add(h1('3. Reports on the customer\'s MySQL database'),
  p('Insights reads the database the customer\'s business runs on. Without a read replica, the protection comes from the limits below, an account made for C360 alone, and, best, a nightly copy.'),
  table([2700, 4826, 1500], ['Guard', 'What it does', 'Status'], [
    ['Read-only session', 'Every query runs in a read-only transaction; Test Connection warns when the account can write.', 'In place'],
    ['Time limit', 'A query stops after 15 seconds on MySQL itself (`max_execution_time`).', 'In place'],
    ['Row limits', '200 rows in a preview, 5,000 in a run, 100,000 in an export.', 'In place'],
    ['Parallel queries', 'At most 4 reports at once per workspace; the rest wait.', 'In place'],
    ['Result cache', 'The same report again within a minute is answered from the cache.', 'In place'],
    ['Per-connection limits', 'A time limit and a parallel-query cap on each connection.', 'To build (change 5)'],
    ['Nightly copy', 'The mapped tables copied into ClickHouse each night; reports read the copy.', 'To build (change 5)'],
  ]),
  h2('On the customer\'s side'),
  bullet('A reporting account for C360 alone, with its own connection cap, able to read only the tables reports need:'),
  ...code("CREATE USER 'c360_reports'@'192.168.10.18' IDENTIFIED BY '<generated>' WITH MAX_USER_CONNECTIONS 4;\nGRANT SELECT ON shopdb.* TO 'c360_reports'@'192.168.10.18';"),
  bullet('Indexes on the columns reports filter and group on, above all dates.'),
  bullet('Heavy reports scheduled outside business hours.'),
  bullet('The MySQL port open to the production server only.'),
  note('MySQL 5.7.', 'It has been out of support since October 2023. Plan its upgrade (or a replica on a supported version) with the customer.'),
)

add(h1('4. Server'),
  ...steps([
    '**Tag the release.** Tag main once the changes are merged (for example `v1.2.0`) and deploy the tag, never a branch.',
    '**Prepare the machine.** Python 3.12 or later, Node 22 to build the front end, nginx, Redis 7 and PostgreSQL 18, a `cep` service account, `/opt/cep` for the code and `/var/log/cep` for the logs. PostgreSQL and Redis listen on localhost only.',
    '**Install.** Clone at the tag, create the Python environment, build the front end.',
    '**Settings.** A production `.env` readable by the service account only, with a **new** `SECRET_KEY` and `FIELD_ENCRYPTION_KEY`, the server\'s address in the allowed hosts and URLs, and the production mail server.',
    '**Services.** System services for the API, the Insights engine and the job scheduler, each restarting on failure.',
    '**Web server.** nginx with HTTPS, the React files, and the proxy to the two services.',
  ]),
  p('The commands are in the C360 Deployment Guide 2.0, sections 4 to 8.'),
)

add(h1('5. Database'),
  ...steps([
    '**Build.** Create the empty database and run `build_production_db.sh`. It asks for the passwords of the app\'s two database logins; the same go into `.env`.',
    '**Reference data.** `load_reference_data.sh platform@aiintelekt.com "Platform Admin"`: staff must use two-step verification, people are told about platform access, the public address; then the Platform workspace and the super user, whose password it asks for twice.',
    '**Check.** `verify.sql` lists what is there and stops with the reason if anything is missing.',
    '**Two-step verification.** Sign in to the back-office as `platform@aiintelekt.com` and set it up at once.',
    '**Backups.** A nightly backup copied off the server, and one restore tested before go-live.',
  ]),
)

add(h1('6. Workspaces'),
  ...steps([
    '**Platform settings.** Mail server, alert recipients, AI provider keys.',
    '**Demo workspace.** Export NWA on the dev server, copy the file across, run `load_demo_data.sh`. Enter its keys again and check its reports and dashboards.',
    '**Production workspace.** Onboard it in the back-office on the Insights plan. It starts empty; its first administrator gets an invitation.',
    '**Customer database.** In that workspace: Insights → Report Databases → Connect a Database, with the reporting account. Map the tables, build the first reports.',
  ]),
)

add(h1('7. Go-live checks'),
  table([3200, 5826], ['Check', 'Passes when'], [
    ['Django production check', '`check --deploy` reports no issues.'],
    ['Database', '`verify.sql` passes.'],
    ['Health', '`/healthz` answers; the three services run with no errors in the logs.'],
    ['Security page', 'No open findings.'],
    ['Sign-in', 'The super user signs in with two-step verification, switches to the demo workspace and back.'],
    ['Insights only', 'The production workspace shows Insights and nothing from Engagement.'],
    ['Reports', 'A report on the customer\'s database runs within its limit; the Run Log shows it.'],
    ['Backups', 'Last night\'s backup exists and the test restore worked.'],
    ['Monitoring', 'The uptime check points at production and its alerts reach someone.'],
  ]),
)

add(h1('8. Later releases'),
  p('Tag main, pull the tag on the server, apply new database patches with `apply_patch.sh` **before** restarting (each is recorded), rebuild the front end and restart the three services. Rolling back is checking out the previous tag: patches only add, so the old code still runs on the newer database.'),
)

add(h1('9. Open questions'),
  table([3000, 6026], ['Question', 'Why it matters'], [
    ['HTTPS for the production address', 'The address is `http://192.168.10.18:8811`. Production settings send every request to HTTPS and keep sign-in cookies for HTTPS only, so sign-in does not hold on plain HTTP. It needs a name with a certificate, or a Cloudflare tunnel as the dev server uses.'],
    ['Access to the server', 'An SSH login (user and key) with sudo, for the install.'],
    ['The nightly copy', 'Whether to build the copy into ClickHouse now (recommended, since the MySQL database has no replica), and whether ClickHouse may run on the production server.'],
  ]),
)

// ---------------------------------------------------------------------------------------------- document
const numbering = {
  config: [
    { reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } },
    ] },
    ...stepRefs.map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 360 } } } }] })),
  ],
}

const doc = new Document({
  creator: 'C360', title: 'C360 Production Rollout', description: 'How C360 goes to production with Insights',
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
  numbering,
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } }, titlePage: true },
    headers: { default: new Header({ children: [new Paragraph({ children: [run('C360 Production Rollout', { size: 17, color: MUTED })], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 4 } } })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }],
      children: [run('Internal — no credentials', { size: 17, color: MUTED }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: MUTED })] })] }) },
    children: body,
  }],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(process.argv[2] || 'docs/C360_Production_Rollout.docx', buffer)
  console.log('written', process.argv[2] || 'docs/C360_Production_Rollout.docx', buffer.length, 'bytes')
})
