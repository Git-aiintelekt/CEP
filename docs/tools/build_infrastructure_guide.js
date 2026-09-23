// Generates docs/CEP_Infrastructure_Sizing.docx. Needs the docx package:  npm install docx  (in any folder), then
//   node docs/tools/build_infrastructure_guide.js docs/CEP_Infrastructure_Sizing.docx

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
  new Paragraph({ children: [new TextRun({ text: 'CEP — Customer Engagement Platform', font: FONT, size: 52, bold: true, color: BRAND })], spacing: { before: 2400, after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: 'Infrastructure Sizing: how many servers, and how big', font: FONT, size: 32, color: INK })], spacing: { after: 360 } }),
  new Paragraph({ children: [run('Version 1.0  ·  23 September 2026  ·  Companion to the Deployment Guide (docs/CEP_Deployment_Guide.docx)', { color: MUTED })], spacing: { after: 600 } }),
  note('Basis for these numbers.', 'CEP has no production traffic yet, so there is no measured load to size against. The figures below start from the single confirmed data point in the Deployment Guide (2 vCPU / 4 GB RAM / 40 GB disk is enough to run every process on one host for a pilot) and extend it with standard Django + Celery + PostgreSQL sizing practice. Treat every number here as a starting point to monitor and adjust, not a guarantee — re-size once you have a real tenant count, campaign volume and send rate.', 'FEF3C7', 'D97706'),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ children: [new TextRun({ text: 'Contents', font: FONT, size: 32, bold: true, color: BRAND })], spacing: { after: 200 } }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
)

// 1
add(h1('1. Short answer'),
  p('CEP is five cooperating processes (Nginx, Gunicorn/Django, Celery worker, Celery beat, Redis) plus PostgreSQL. How many VMs that becomes depends on how much you separate them:'),
  table([1500, 2700, 4826], ['Tier', 'VM count', 'When to use it'], [
    ['Pilot / minimum', '2 VMs\n(1 app + 1 database)', 'Evaluation, a handful of tenants, low send volume, no uptime commitment. This is what the Deployment Guide already assumes.'],
    ['Recommended production', '3 VMs\n(2 app-side + 1 database)', 'Live tenants, normal campaign volumes, one production environment. Separates the request path from background sending so a large campaign send cannot slow down the UI.'],
    ['High availability', '7 VMs\n(load balancer + 2 API + 1 worker + 1 Redis + 2 database)', 'An uptime SLA, or enough traffic that one API node is a single point of failure. Matches the "Scaling out later" path already described in the Deployment Guide.'],
  ]),
  note('The database is already provisioned.', 'PostgreSQL 18 at `10.0.0.43:5433` (`cep_db`) exists on its own host today and is out of scope for new provisioning at the Pilot and Recommended tiers — it is counted above only so the totals describe the whole system. The High-availability tier adds a standby replica of that database as new infrastructure.', 'E8EDFB', BRAND),
)

// 2
add(h1('2. What is fixed by the architecture'),
  p('These constraints hold at every tier and shape where the lines between VMs can go:'),
  bullet('**Exactly one Celery beat**, ever running at a time — it is the scheduler that triggers campaign sends, retention, invoicing and alerts. A second one would fire every scheduled job twice (double sends, double invoices). Adding VMs never means adding beats.'),
  bullet('**Redis is shared** by the Django cache, the Celery broker and result store, and event streams. Every app-side process needs a route to it; it does not need to be internet-reachable.'),
  bullet('**Only Nginx and Gunicorn need to be reachable from the internet** (ports 80/443, proxied to 8000 internally). Celery worker, Celery beat and Redis are purely internal.'),
  bullet('**The database connects over the network already** (`10.0.0.43:5433`) — CEP was already designed to have its application tier and its database tier on separate hosts, so splitting further (API vs. worker, single vs. load-balanced) is a smaller step than it would be for an app that assumes a local database.'),
  bullet('**The React build is static files** served by Nginx — it adds no compute of its own beyond whichever host runs Nginx.'),
)

// 3
add(h1('3. Sizing by tier'),
  h2('3.1 Pilot / minimum — 2 VMs'),
  p('Everything CEP runs (Nginx, Gunicorn, Celery worker, Celery beat, Redis) on one host, talking to the existing database host.'),
  table([2400, 1500, 1500, 1300, 2326], ['VM', 'vCPU', 'RAM', 'Disk', 'Runs'], [
    ['App server', '2', '4 GB', '40 GB SSD', 'Nginx, Gunicorn (API), Celery worker, Celery beat, Redis'],
    ['Database server\n(already exists)', '—', '—', '—', 'PostgreSQL 18, `cep_db` — no new provisioning'],
  ]),
  note('Risk to accept at this tier.', 'A large campaign send and normal API traffic compete for the same CPU, and a restart of the app server takes background jobs down with it. Fine for a pilot; the Recommended tier below removes both.', 'FEF3C7', 'D97706'),

  h2('3.2 Recommended production — 3 VMs'),
  p('Separates the request path (what tenants feel as latency) from background sending (what a large campaign load spikes), so one does not starve the other. This is the tier to launch a paying customer on.'),
  table([2400, 1500, 1500, 1300, 2326], ['VM', 'vCPU', 'RAM', 'Disk', 'Runs'], [
    ['App / API server', '2–4', '8 GB', '60 GB SSD', 'Nginx, Gunicorn (API + back-office), Redis'],
    ['Worker server', '2–4', '8 GB', '40 GB SSD', 'Celery worker (all queues), Celery beat (the one and only)'],
    ['Database server\n(already exists)', '—', '—', '—', 'PostgreSQL 18, `cep_db` — no new provisioning'],
  ]),
  p('Gunicorn workers follow the Deployment Guide\'s own rule of thumb, `2 × CPU cores + 1`; the worker server\'s Celery concurrency scales with vCPU count the same way. Redis is small (a few hundred MB of working set at this scale) and rides comfortably alongside the API process.'),

  h2('3.3 High availability — 7 VMs'),
  p('For an uptime SLA, or once one API node is not enough traffic headroom. This is the path the Deployment Guide\'s "Scaling out later" section already describes, made concrete:'),
  table([2400, 1500, 1500, 1300, 2326], ['VM', 'vCPU', 'RAM', 'Disk', 'Runs'], [
    ['Load balancer', '2', '2 GB', '20 GB SSD', 'TLS termination + health-checked routing to the API nodes (or a managed load balancer instead of a VM)'],
    ['API server × 2', '4', '8 GB', '60 GB SSD', 'Nginx (optional if the LB terminates TLS) + Gunicorn, behind the load balancer'],
    ['Worker server', '4', '8 GB', '40 GB SSD', 'Celery worker + the single Celery beat'],
    ['Redis server', '2', '4 GB', '20 GB SSD', 'Shared cache/broker for both API nodes and the worker (add Sentinel for Redis-level HA if Redis itself must not be a single point of failure)'],
    ['Database primary\n(already exists)', '—', '—', '—', 'PostgreSQL 18, `cep_db`'],
    ['Database standby\n(new)', '4', '16 GB', '100 GB SSD', 'Streaming replica of `cep_db` for failover — new infrastructure, not covered by the current Deployment Guide'],
  ]),
  note('Two API nodes, still one beat.', 'Both API servers run `cep-api`; only the worker server runs `cep-beat`. If you also want worker redundancy, add a second worker server running `cep-worker` only (never `cep-beat`) — Celery workers scale horizontally without limit, beat does not.', 'E8EDFB', BRAND),
)

// 4
add(h1('4. Deployment diagram'),
  h2('4.1 Recommended production (3 VMs)'),
  ...code(
    '                                   Internet\n' +
    '                                      │  HTTPS (443)\n' +
    '                                      ▼\n' +
    '                    ┌──────────────────────────────────┐\n' +
    '                    │   VM 1 — App / API server         │\n' +
    '                    │   Nginx ── Gunicorn :8000 (Django) │\n' +
    '                    │   Redis (cache + Celery broker)   │\n' +
    '                    └───────────────┬────────────────────┘\n' +
    '                                    │ 10.0.0.43:5433\n' +
    '                                    ▼\n' +
    '                    ┌──────────────────────────────────┐\n' +
    '                    │   VM 3 — Database server (exists)  │\n' +
    '                    │   PostgreSQL 18 — cep_db          │\n' +
    '                    └───────────────▲────────────────────┘\n' +
    '                                    │ 10.0.0.43:5433\n' +
    '                    ┌───────────────┴────────────────────┐\n' +
    '                    │   VM 2 — Worker server             │\n' +
    '                    │   Celery worker  +  Celery beat    │\n' +
    '                    │   (reads jobs from VM 1\'s Redis)   │\n' +
    '                    └──────────────────────────────────┘',
  ),
  h2('4.2 High availability (7 VMs)'),
  ...code(
    '                                        Internet\n' +
    '                                           │ HTTPS (443)\n' +
    '                                           ▼\n' +
    '                              ┌────────────────────────┐\n' +
    '                              │  Load balancer          │\n' +
    '                              └──────┬───────────┬──────┘\n' +
    '                                     ▼           ▼\n' +
    '                        ┌──────────────┐  ┌──────────────┐\n' +
    '                        │ API node 1    │  │ API node 2    │\n' +
    '                        │ Nginx+Gunicorn │  │ Nginx+Gunicorn │\n' +
    '                        └───────┬───────┘  └───────┬───────┘\n' +
    '                                └─────────┬─────────┘\n' +
    '                                          ▼\n' +
    '                                 ┌──────────────┐\n' +
    '                                 │ Redis server   │\n' +
    '                                 └───────┬───────┘\n' +
    '                                          ▲\n' +
    '                                 ┌───────┴───────┐\n' +
    '                                 │ Worker server   │\n' +
    '                                 │ celery worker   │\n' +
    '                                 │ celery beat (×1)│\n' +
    '                                 └───────┬───────┘\n' +
    '                    ┌─────────────────────┴─────────────────────┐\n' +
    '                    ▼                                           ▼\n' +
    '           ┌────────────────┐                          ┌────────────────┐\n' +
    '           │ DB primary       │── streaming replication ▶│ DB standby       │\n' +
    '           │ cep_db (exists)  │                          │ cep_db (new)     │\n' +
    '           └────────────────┘                          └────────────────┘',
  ),
  p('Every arrow into the database server is the same connection the Deployment Guide already documents (`cep_backend` for the API and worker, `cep_platform` for the back-office) — high availability changes how many hosts run these processes, not how they talk to the database.'),
)

// 5
add(h1('5. Network exposure'),
  table([2800, 2500, 3726], ['VM', 'Inbound', 'Outbound'], [
    ['Load balancer / App-API node(s)', '443 (and 80 to redirect) from the internet', '8000 to itself (Gunicorn); 5433 to the database; 587/465 to SMTP if used directly'],
    ['Worker server', 'none from the internet; 6379 from itself and the API node(s) only if Redis is co-located here instead', '5433 to the database; 6379 to Redis; 587/465 to SMTP'],
    ['Redis server (HA tier)', '6379, only from the API node(s) and the worker server', 'none'],
    ['Database server(s)', '5433, only from the application-side hosts above', 'none (standby pulls from primary on 5433)'],
  ]),
  note('Nothing here changes the credentials model.', 'Every tier still uses the same two application logins described in the Deployment Guide (`cep_backend` for API and worker traffic, `cep_platform` for the back-office) — neither is a superuser, at any VM count.', 'E8EDFB', BRAND),
)

// 6
add(h1('6. Growing from one tier to the next'),
  bullet('**Pilot → Recommended:** stand up the new worker VM, point `REDIS_URL` on it at the app server\'s Redis, move the `cep-worker` and `cep-beat` systemd units there, stop them on the app server. No database or DNS change.'),
  bullet('**Recommended → High availability:** clone the app server into two API nodes behind a load balancer (they are stateless — sessions and cache live in Redis/the database, not on the node), move Redis to its own VM so both API nodes and the worker share one instance, and add a streaming replica of the database. All of this matches the "Scaling out later" section of the Deployment Guide.'),
  bullet('**Signals it is time to move up a tier:** Gunicorn workers regularly saturated (check `systemctl status cep-api` and response times), the worker log shows jobs queuing behind a large send instead of starting promptly, or a single host restart is no longer an acceptable interruption.'),
)

// ---------------------------------------------------------------------------------------------- document
const numbering = {
  config: {
    reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 900, hanging: 260 } } } },
    ],
  },
}

const doc = new Document({
  creator: 'CEP', title: 'CEP Infrastructure Sizing', description: 'How many VMs to run CEP on, and how big each should be',
  features: { updateFields: true },
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
  numbering: { config: [numbering.config] },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [run('CEP Infrastructure Sizing', { size: 17, color: MUTED })], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 4 } } })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }],
      children: [run('Confidential — contains infrastructure details, no credentials', { size: 17, color: MUTED }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: MUTED })] })] }) },
    children: body,
  }],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(process.argv[2], buffer)
  console.log('written', process.argv[2], buffer.length, 'bytes')
})
