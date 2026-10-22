// Generates docs/CEP_Deployment_Guide.docx (the C360 Deployment Guide). Needs the docx package:  npm install docx  (in any folder), then
//   node docs/tools/build_deployment_guide.js docs/CEP_Deployment_Guide.docx
// After generating, open the file in Word once and update the table of contents (or press F9).

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
  new Paragraph({ children: [new TextRun({ text: 'C360 — Insights and Engagement', font: FONT, size: 52, bold: true, color: BRAND })], spacing: { before: 2400, after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: 'Deployment Guide: a production server', font: FONT, size: 32, color: INK })], spacing: { after: 360 } }),
  new Paragraph({ children: [run('Version 2.0  ·  22 October 2026  ·  Repository: github.com/Git-aiintelekt/CEP (deploy a release tag of main)', { color: MUTED })], spacing: { after: 80 } }),
  new Paragraph({ children: [run('Stack: Django 6.1 + Django REST Framework, PostgreSQL 18, Redis 7 (cache), React 19 (Vite), Nginx, Gunicorn; ClickHouse optional for Insights', { color: MUTED })], spacing: { after: 600 } }),
  note('Scope.', 'Written from the project\'s settings, scripts and service files, and from the layout the dev server (10.0.0.51) runs today. The production server for the first release is `192.168.10.18`, with the database on the same machine; its customers get **Insights** (the reports engine) only. Replace host names and paths with your own. No password appears in this document, and none should be added to it.', 'E8EDFB', BRAND),
  note('What changed since version 1.12.', 'The job scheduler `manage.py run_scheduler` replaces the Celery worker and beat (one process, no broker); Redis stays, as the cache. Insights runs as its own service on port 8012, so a heavy report never slows the app. A new database is built by `database/production/build_production_db.sh` and `load_reference_data.sh`, with no sample data, and patches are applied by `database/apply_patch.sh`, which records each one in the `schema_patch` table. `create_platform_admin` makes the first platform administrator and the Platform workspace. Patch 0072 adds the Insights-only plan.', 'ECFDF5', '059669'),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ children: [new TextRun({ text: 'Contents', font: FONT, size: 32, bold: true, color: BRAND })], spacing: { after: 200 } }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
)

// 1
add(h1('1. What gets deployed'),
  p('C360 is three application processes, two data stores and a web server. For the first production release they all run on one server.'),
  table([2100, 2600, 4326], ['Component', 'Runs as', 'Purpose'], [
    ['React app', 'static files served by Nginx', 'The product for workspaces: Insights (and Engagement where a plan includes it). Built once per release into `frontend/dist`.'],
    ['API + back-office', 'Gunicorn on 127.0.0.1:8010, service `cep-api`', 'REST API under `/api/v1/`, the platform back-office at `/admin/`, the liveness probe `/healthz`.'],
    ['Insights engine', 'Gunicorn on 127.0.0.1:8012, service `cep-insights`', 'The same code with the Insights routes alone (`/api/v1/insights/`): reports, dashboards, Report Databases. Its own processes, so a runaway report cannot exhaust the app\'s.'],
    ['Job scheduler', '`manage.py run_scheduler`, service `cep-jobs` (exactly one)', 'Scheduled reports and alerts, partitions, retention, usage, health checks, tenant operations (and campaign sends and list imports where Engagement is used), each job on its interval, recorded in `job_run`.'],
    ['Redis 7', 'local service, 127.0.0.1:6379', 'The cache: report results for a minute, the report concurrency slots, rate limits, the parameter cache. Required.'],
    ['PostgreSQL 18', 'local service, 127.0.0.1:5432', 'All data. Row-level security per workspace; per-workspace partitions.'],
    ['Nginx', 'local service', 'TLS, the React files, `/static` and `/media`, and the proxy to the two Gunicorn services.'],
    ['ClickHouse', 'optional', 'A faster engine for large Insights workspaces, and the place for a nightly copy of a customer database (section 13).'],
  ]),
  h2('Request flow'),
  ...code('Browser ─HTTPS─▶ Nginx ─┬─ /                  React build (frontend/dist)\n                        ├─ /api/v1/insights/  Gunicorn :8012  cep-insights ─┐\n                        ├─ /api/  /admin/     Gunicorn :8010  cep-api ──────┼─▶ PostgreSQL 18\n                        └─ /static/ /media/   files on disk                 └─▶ Redis 7\ncep-jobs (run_scheduler) ──────────────────────────────────────────▶ PostgreSQL 18, Redis 7'),
  h2('Three database logins, on purpose'),
  p('The application never connects as a superuser: a superuser bypasses row-level security, which would hide a workspace-isolation bug.'),
  table([2300, 2400, 4326], ['Setting', 'Database login', 'Used for'], [
    ['`DATABASE_URL`', '`cep_backend` (member of `cep_app`, row-level security enforced)', 'Every API and Insights request, every scheduled job inside a workspace.'],
    ['`PLATFORM_DATABASE_URL`', '`cep_platform` (BYPASSRLS, member of `cep_admin`)', 'The back-office, management commands, platform jobs that look across workspaces.'],
    ['`OWNER_DATABASE_URL`', 'the database owner', 'Only workspace export, copy and offboarding. Leave empty until you run one.'],
  ]),
)

// 2
add(h1('2. Prerequisites'),
  h2('Server'),
  bullet('**Operating system:** Ubuntu Server 22.04 or 24.04 LTS (the commands below), or RHEL 9/10 with the equivalent `dnf` packages (see the SELinux note in section 6).'),
  bullet('**Size for app and database on one server:** 4 vCPU, 16 GB RAM, 150 GB disk on SSD to start. PostgreSQL takes about half the memory; watch disk as partitions grow.'),
  bullet('**Network:** inbound HTTPS (443, or the port you publish); outbound to the mail server, the AI providers, and the customer databases that Insights reads (MySQL 3306, PostgreSQL 5432). PostgreSQL and Redis listen on localhost only.'),
  h2('Software versions'),
  table([2600, 2600, 3826], ['Software', 'Version', 'Note'], [
    ['Python', '3.12 or newer (developed on 3.14)', 'Django 6.1 requires 3.12+. The dev server runs 3.12.'],
    ['Node.js', '22 LTS or newer', 'Only to build the React app; not needed at run time.'],
    ['PostgreSQL', '18', 'The schema uses PostgreSQL 18 features. From the PGDG repository on Ubuntu.'],
    ['Redis', '7', 'Local, no persistence needed.'],
    ['Nginx', 'any current release', ''],
  ]),
  h2('Address and certificate'),
  p('The production settings send every request to HTTPS, mark the sign-in cookies HTTPS-only and set HSTS, so C360 must be reached over **HTTPS**. Give the server a name (for example `c360.aiintelekt.com`) with a certificate, or publish it through a Cloudflare tunnel as the dev server does. Plain `http://192.168.10.18:8811` will show the sign-in page but signing in will not hold.'),
  p('People type their workspace code on the sign-in page. A host whose first label is not a workspace (`c360`, `app`, `www`) must be listed when the front end is built: `VITE_RESERVED_SUBDOMAINS=c360` (section 7).'),
  h2('Have these to hand'),
  bullet('Read access to the GitHub repository from the server (a deploy key).'),
  bullet('The mail server details for the platform\'s own mail (alerts, password links).'),
  bullet('The AI provider keys, if Ask for a Report is offered.'),
  bullet('For each customer database Insights will read: host, port, database name, and a read-only account made for it (section 13).'),
)

// 3
add(h1('3. Database'),
  h2('3.1 A new production database'),
  p('Three scripts in `database/production/` build it, run on the app server from the repository root once the code and `.env` are in place (section 5). They ask for every password they set and never print one. The layer files already contain every patch, so a new database needs none.'),
  ...steps([
    'Install PostgreSQL 18 and keep it on localhost (`listen_addresses = \'localhost\'`). Create the database as the `postgres` superuser, with ICU collation so lists sort as people expect.',
    '`build_production_db.sh`: the extensions, the login roles `cep_backend` and `cep_platform` (it asks for their passwords: put the same ones in `.env`), the five schema layers **without** the sample data, the record of the patches they contain, and Django\'s own tables. It refuses a database that already has tables.',
    '`load_reference_data.sh <email> [name]`: the production settings (staff must use two-step verification; people are told when platform staff enter their workspace; the public address from `CEP_PUBLIC_URL`), then the **Platform** workspace on the Insights plan and its first platform administrator, whose password it asks for twice. Safe to run again.',
    '`verify.sql` checks the result: it stops with the reason when something is missing, and lists the permissions, plans, recorded patches, workspaces and platform administrators.',
  ]),
  ...code("sudo -u postgres psql -c \"CREATE DATABASE cep_db TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C'\"\n\ncd /opt/cep/app\nexport PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=cep_db      # the owner's password: PGPASSWORD or ~/.pgpass\nexport PYTHON=/opt/cep/app/backend/.venv/bin/python DJANGO_SETTINGS_MODULE=config.settings.production\nbash database/production/build_production_db.sh\nCEP_PUBLIC_URL=https://c360.aiintelekt.com bash database/production/load_reference_data.sh platform@aiintelekt.com \"Platform Admin\"\npsql -X -f database/production/verify.sql", 'New database, on the app server'),
  h2('3.2 The demo workspace'),
  p('`load_demo_data.sh` loads an export of the dev server\'s NWA workspace as the demo workspace, with its reports, dashboards and data. Its people come across as disabled accounts without a password (they remain the authors of the data); platform administrators reach the demo through Switch Workspace. Secrets do not travel: production has its own encryption key, so the demo\'s engine and API keys are entered again. This script arrives with the workspace copy tool.'),
  h2('3.3 Patches'),
  p('A release that changes the schema ships a numbered file in `database/patches/`. Apply new ones in number order, as the owner, **before** restarting the services. `apply_patch.sh` runs a patch in one transaction and records it; a patch already recorded is skipped unless `--again` is given. Every patch is idempotent.'),
  ...code("cd /opt/cep/app\nPGHOST=localhost PGUSER=postgres PGDATABASE=cep_db bash database/apply_patch.sh 0073_<name>.sql\npsql -d cep_db -c \"SELECT name, how, applied_at FROM schema_patch ORDER BY name DESC LIMIT 5\""),
  p('`schema_patch.how` is `BUILD` for the patches the layers already held when the database was built, and `PATCH` for each one applied since.'),
  h2('3.4 Databases built before patch 0072'),
  p('The dev and test databases were built before `schema_patch` existed. Apply 0072 with `apply_patch.sh` like any patch; it creates the table and records itself. To record the earlier ones once, so the list is complete:'),
  ...code("cd /opt/cep/app/database/patches\nfor f in 00[0-6]*.sql 0070*.sql 0071*.sql; do\n  psql -X -q -c \"INSERT INTO schema_patch (name, how) VALUES ('$f', 'PATCH') ON CONFLICT DO NOTHING\"\ndone"),
)

// 4
add(h1('4. Prepare the server'),
  ...code('sudo apt update && sudo apt -y upgrade\nsudo apt -y install python3.12 python3.12-venv python3.12-dev build-essential git nginx redis-server curl\n\n# PostgreSQL 18 from the PGDG repository\nsudo apt -y install postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y\nsudo apt -y install postgresql-18\n\n# Node.js 22 LTS, only for building the React app\ncurl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs\n\n# the service account and its directories\nsudo adduser --system --group --home /opt/cep cep\nsudo mkdir -p /var/lib/cep/exports /var/log/cep\nsudo chown -R cep:cep /opt/cep /var/lib/cep /var/log/cep'),
  p('Keep Redis and PostgreSQL on localhost: `bind 127.0.0.1 -::1` in `/etc/redis/redis.conf` (the Ubuntu default) and `listen_addresses = \'localhost\'` in `postgresql.conf`. Then `sudo systemctl enable --now redis-server postgresql`.'),
  h2('Firewall'),
  ...code('sudo ufw allow OpenSSH\nsudo ufw allow "Nginx Full"          # or only the port you publish\nsudo ufw enable'),
)

// 5
add(h1('5. Install the application'),
  h2('5.1 Code'),
  ...code('sudo -u cep -H bash\ncd /opt/cep\ngit clone https://github.com/Git-aiintelekt/CEP.git app\ncd app && git fetch --tags && git checkout v1.2.0      # the release tag'),
  h2('5.2 Python environment'),
  ...code('cd /opt/cep/app/backend\npython3.12 -m venv .venv\n.venv/bin/pip install --upgrade pip\n.venv/bin/pip install -r requirements.txt'),
  h2('5.3 Configuration: /opt/cep/app/.env'),
  p('The settings read one file, `.env` in the repository root. It is git-ignored. Start from the template, lock it down, and generate **new** secrets for production; never copy the dev server\'s.'),
  ...code('cd /opt/cep/app\ncp .env.example .env && chmod 600 .env\nbackend/.venv/bin/python -c "import secrets; print(secrets.token_urlsafe(64))"                         # SECRET_KEY\nbackend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # FIELD_ENCRYPTION_KEY'),
  ...code('SECRET_KEY=<first generated value>\nDEBUG=False\nCEP_ENVIRONMENT=production\nALLOWED_HOSTS=c360.aiintelekt.com,192.168.10.18\nCSRF_TRUSTED_ORIGINS=https://c360.aiintelekt.com\nCORS_ALLOWED_ORIGINS=https://c360.aiintelekt.com\n\nDATABASE_URL=postgres://cep_backend:<password>@localhost:5432/cep_db\nPLATFORM_DATABASE_URL=postgres://cep_platform:<password>@localhost:5432/cep_db\nOWNER_DATABASE_URL=\nREDIS_URL=redis://127.0.0.1:6379/0\n\nFIELD_ENCRYPTION_KEY=<second generated value>\nFRONTEND_URL=https://c360.aiintelekt.com\nAPI_PUBLIC_URL=https://c360.aiintelekt.com\nPLATFORM_ADMIN_URL=https://c360.aiintelekt.com/admin/\nDEFAULT_FROM_EMAIL=C360 <no-reply@aiintelekt.com>\nTENANT_EXPORT_DIR=/var/lib/cep/exports\nLOG_LEVEL=INFO\n\n# optional: ClickHouse for Insights (section 13)\nCLICKHOUSE_URL=\nCLICKHOUSE_USER=\nCLICKHOUSE_PASSWORD=\nCLICKHOUSE_DATABASE=', '/opt/cep/app/.env (passwords filled in on the server only)'),
  note('Keep FIELD_ENCRYPTION_KEY safe and unchanged.', 'It encrypts mail server passwords, single sign-on secrets, two-step verification secrets, sending-engine keys and Report Database passwords. Lost or replaced, those values cannot be read and must be entered again. Back it up with the other secrets, apart from the database backups. Special characters in a database password must be URL-encoded inside the `postgres://` URLs.'),
  h2('5.4 Static files and checks'),
  ...code('cd /opt/cep/app/backend\nexport DJANGO_SETTINGS_MODULE=config.settings.production\n.venv/bin/python manage.py collectstatic --noinput\n.venv/bin/python manage.py check --deploy          # must report no errors'),
  note('DJANGO_SETTINGS_MODULE matters.', '`manage.py` and `wsgi.py` default to the **development** settings. Every production command and every service sets `DJANGO_SETTINGS_MODULE=config.settings.production` (the Insights service: `config.settings.insights` with `CEP_SETTINGS_BASE=production`). The SQL layers own the schema: never run `migrate` on the production database; `build_production_db.sh` records the app\'s migrations as applied.'),
)

// 6
add(h1('6. The three services'),
  p('System units, run as the `cep` account. On RHEL keep the logs under `/var/log/cep`: SELinux refuses a log appended under `/opt`.'),
  ...code('[Unit]\nDescription=C360 API and back-office (gunicorn)\nAfter=network-online.target postgresql.service redis-server.service\n\n[Service]\nUser=cep\nGroup=cep\nWorkingDirectory=/opt/cep/app/backend\nEnvironment=PYTHONUNBUFFERED=1\nEnvironment=DJANGO_SETTINGS_MODULE=config.settings.production\nExecStart=/opt/cep/app/backend/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8010 \\\n          --workers 3 --threads 4 --timeout 120 --graceful-timeout 30 --access-logfile - --error-logfile -\nRestart=always\nRestartSec=3\nStandardOutput=append:/var/log/cep/api.log\nStandardError=append:/var/log/cep/api.log\n\n[Install]\nWantedBy=multi-user.target', '/etc/systemd/system/cep-api.service'),
  ...code('[Unit]\nDescription=C360 Insights report engine\nAfter=network-online.target postgresql.service redis-server.service\n\n[Service]\nUser=cep\nGroup=cep\nWorkingDirectory=/opt/cep/app/backend\nEnvironment=PYTHONUNBUFFERED=1\nEnvironment=DJANGO_SETTINGS_MODULE=config.settings.insights\nEnvironment=CEP_SETTINGS_BASE=production\nExecStart=/opt/cep/app/backend/.venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8012 \\\n          --workers 2 --threads 2 --timeout 120 --graceful-timeout 30 --access-logfile - --error-logfile -\nRestart=always\nRestartSec=3\nStandardOutput=append:/var/log/cep/insights.log\nStandardError=append:/var/log/cep/insights.log\n\n[Install]\nWantedBy=multi-user.target', '/etc/systemd/system/cep-insights.service'),
  ...code('[Unit]\nDescription=C360 job scheduler (run exactly one)\nAfter=network-online.target postgresql.service redis-server.service\n\n[Service]\nUser=cep\nGroup=cep\nWorkingDirectory=/opt/cep/app/backend\nEnvironment=PYTHONUNBUFFERED=1\nEnvironment=DJANGO_SETTINGS_MODULE=config.settings.production\nExecStart=/opt/cep/app/backend/.venv/bin/python manage.py run_scheduler --tick 15\nRestart=always\nRestartSec=5\nStandardOutput=append:/var/log/cep/jobs.log\nStandardError=append:/var/log/cep/jobs.log\n\n[Install]\nWantedBy=multi-user.target', '/etc/systemd/system/cep-jobs.service'),
  ...code('sudo systemctl daemon-reload\nsudo systemctl enable --now cep-api cep-insights cep-jobs\nsystemctl status cep-api cep-insights cep-jobs --no-pager\ncurl -s http://127.0.0.1:8010/healthz -H "X-Forwarded-Proto: https" -H "Host: c360.aiintelekt.com"'),
  p('`/healthz` answers 301 without the two headers: the production settings redirect plain HTTP. Gunicorn workers: start with the numbers above; each worker holds its own database connections, so keep the total well under PostgreSQL\'s `max_connections`. Never run two `cep-jobs`: every job would run twice. A large Engagement installation can move the jobs to Celery (a worker and one beat on Redis) instead of `cep-jobs`; never both.'),
)

// 7
add(h1('7. Build the React app'),
  p('Build on the server from the same tag. The app calls `/api/v1` on the host it is served from. `VITE_RESERVED_SUBDOMAINS` names host labels that are never a workspace code (section 2).'),
  ...code('cd /opt/cep/app/frontend\nnpm ci\nVITE_RESERVED_SUBDOMAINS=c360 npm run build      # type-check, production build and size budgets -> dist/'),
  p('The build fails if a part grows past its size budget (index 120 KB, Engagement 400 KB, Insights 360 KB, compressed). Asset names carry a content hash, so they can be cached for a year; `index.html` must never be cached.'),
)

// 8
add(h1('8. Nginx and TLS'),
  p('Install the security headers once as `/etc/nginx/snippets/cep-security-headers.conf` (from `deploy/nginx-security-headers.conf`), then the site:'),
  ...code('server {\n    listen 80;\n    server_name c360.aiintelekt.com;\n    return 301 https://$host$request_uri;\n}\n\nserver {\n    listen 443 ssl;\n    server_name c360.aiintelekt.com;\n    ssl_certificate     /etc/nginx/ssl/c360_fullchain.crt;\n    ssl_certificate_key /etc/nginx/ssl/c360.key;\n    ssl_protocols TLSv1.2 TLSv1.3;\n    client_max_body_size 50m;                      # Report uploads and images\n    root /opt/cep/app/frontend/dist;\n\n    location ~ ^/api/v1/insights(/|$) {            # Insights: its own service\n        proxy_pass http://127.0.0.1:8012;\n        proxy_http_version 1.1;\n        proxy_read_timeout 120s;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n    location ~ ^/(api|admin|healthz)(/|$) {\n        proxy_pass http://127.0.0.1:8010;\n        proxy_http_version 1.1;\n        proxy_read_timeout 120s;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n    location ^~ /static/ { alias /opt/cep/app/backend/staticfiles/; include snippets/cep-security-headers.conf; add_header Cache-Control "public, max-age=3600"; }\n    location ^~ /media/  { alias /opt/cep/app/backend/media/;       include snippets/cep-security-headers.conf; add_header Cache-Control "public, max-age=86400"; }\n    location /assets/   { include snippets/cep-security-headers.conf; expires 1y; add_header Cache-Control "public, immutable"; }\n    location / {\n        try_files $uri /index.html;\n        include snippets/cep-security-headers.conf;\n        add_header Cache-Control "no-store";\n    }\n}', '/etc/nginx/sites-available/c360'),
  p('`Host` must pass through unchanged, and `X-Forwarded-Proto` tells Django the request was HTTPS; without it the production settings redirect forever. Behind a Cloudflare tunnel, nginx listens on a local port and `X-Forwarded-Proto` is set to `https` (as `deploy/nginx-cepdev.conf` does).'),
  ...code('sudo ln -s /etc/nginx/sites-available/c360 /etc/nginx/sites-enabled/c360\nsudo rm -f /etc/nginx/sites-enabled/default\nsudo nginx -t && sudo systemctl reload nginx'),
)

// 9
add(h1('9. First run'),
  ...steps([
    '**Sign in to the back-office** at `https://c360.aiintelekt.com/admin/` as `platform@aiintelekt.com`. Staff must use two-step verification, so the back-office first sends you to set it up: sign in to the app at the workspace **PLATFORM**, open Account Security, scan the code and keep the recovery codes. Then sign in to `/admin/` again.',
    '**Mail server.** Configuration → Mail Server: the server for the platform\'s own mail (alerts, password links), then **Send a test message to me**.',
    '**Global parameters.** `alerts.recipients` (the operations addresses), `platform.api_public_url` (set by `load_reference_data.sh` when `CEP_PUBLIC_URL` was given).',
    '**AI providers.** Configuration → AI Assistant: the platform keys for Claude and OpenAI, if Ask for a Report is offered.',
    '**Production workspace.** Tenants → Onboard a Tenant, on the **Insights** plan: its code, name, time zone and first administrator, who receives a link to choose a password.',
    '**Demo workspace** (optional): section 3.2.',
    '**Customer database.** In the production workspace: Insights → Report Databases → Connect a Database, with the read-only reporting account (section 13).',
  ]),
)

// 10
add(h1('10. Verify the deployment'),
  table([4300, 4726], ['Check', 'Expected'], [
    ['`manage.py check --deploy` (production settings)', 'No issues.'],
    ['`psql -X -f database/production/verify.sql`', 'No error; PLATFORM and its platform administrator listed; staff need a second factor: true.'],
    ['`curl -s https://c360.aiintelekt.com/healthz`', '`{"status": "ok", ...}`'],
    ['`curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant: PLATFORM" https://c360.aiintelekt.com/api/v1/insights/reports/`', '`401`: the Insights service answers and asks for a sign-in. A `502` means `cep-insights` is down.'],
    ['`/admin/` home page', 'The health checks green or explained; Scheduled jobs healthy within their interval.'],
    ['Back-office Security page', 'No open findings (the daily check covers packages, server settings, accounts and keys).'],
    ['The production workspace in the app', 'Insights only: no Engagement in the launcher or the menus.'],
    ['A report on the customer database', 'Runs within its time limit; Insights → Run Log shows its time and rows.'],
    ['`systemctl status cep-api cep-insights cep-jobs`', 'All active; no errors in `/var/log/cep/*.log`.'],
  ]),
)

// 11
add(h1('11. Releasing a new version'),
  ...code('sudo -u cep -H bash -lc \'\n  set -e\n  cd /opt/cep/app && git fetch --tags && git checkout v1.2.1\n  cd backend && .venv/bin/pip install -r requirements.txt          # when requirements.txt changed\n  export DJANGO_SETTINGS_MODULE=config.settings.production\n  .venv/bin/python manage.py collectstatic --noinput\n  .venv/bin/python manage.py check --deploy\n  cd ../frontend && npm ci && VITE_RESERVED_SUBDOMAINS=c360 npm run build\n\'\n# new files in database/patches/ ? apply them now, before the restart (section 3.3)\nsudo systemctl restart cep-api cep-insights cep-jobs'),
  bullet('**Order:** the database patch first (patches only add), then the restart.'),
  bullet('**Rollback:** check out the previous tag, rebuild the front end, restart. The previous code runs on the newer schema.'),
  bullet('**A graceful reload of the API:** `sudo systemctl kill -s HUP cep-api` replaces the Gunicorn workers without dropping requests.'),
)

// 12
add(h1('12. Operations'),
  h2('Backups'),
  bullet('**Database:** a nightly `pg_dump -Fc cep_db`, copied off the server; test a restore before go-live and every quarter.'),
  bullet('**Secrets:** `/opt/cep/app/.env`, above all `FIELD_ENCRYPTION_KEY` and `SECRET_KEY`, kept apart from the database backups.'),
  bullet('**Uploaded files:** `/opt/cep/app/backend/media` (logos, images, Report uploads).'),
  h2('Logs'),
  bullet('`/var/log/cep/api.log`, `insights.log`, `jobs.log` (JSON lines), Nginx in `/var/log/nginx/`. Add `/var/log/cep/*.log` to logrotate (weekly, keep 8, `copytruncate`).'),
  h2('Monitoring'),
  bullet('An uptime check on `/healthz` (anonymous) and the back-office sign-in page. The platform raises its own alerts (failing checks, failed or overdue jobs) by email once `alerts.recipients` is set.'),
  bullet('Disk on the database: partitions are created monthly per workspace and dropped by the retention policy.'),
  h2('Security checklist'),
  bullet('`DEBUG=False`, new `SECRET_KEY` and `FIELD_ENCRYPTION_KEY`, `.env` readable by `cep` only.'),
  bullet('`DATABASE_URL` is never a superuser; `OWNER_DATABASE_URL` stays empty except while a workspace operation runs.'),
  bullet('PostgreSQL and Redis on localhost; SSH by key only; unattended security updates.'),
  bullet('Two-step verification for every staff account (`security.mfa_required_for_staff`, switched on by `load_reference_data.sh`).'),
  bullet('Consider limiting `/admin/` to the office or VPN addresses in Nginx.'),
)

// 13
add(h1('13. Reports on a customer database'),
  p('Insights reads a customer\'s own database through Report Databases. The first production customer\'s database is **MySQL 5.7 without a read replica**, so reports would read the live database. C360 limits what a report can do to it:'),
  table([2600, 6426], ['Guard', 'What it does'], [
    ['Read-only session', 'Every query runs in a read-only transaction; Test Connection warns when the account can write.'],
    ['Time limit', 'A query stops after 15 seconds on the database itself (`max_execution_time` on MySQL).'],
    ['Row limits', '200 rows in a preview, 5,000 in a run, 100,000 in an export.'],
    ['Parallel queries', 'At most 4 reports run at once per workspace; the rest wait.'],
    ['Result cache', 'The same report again within a minute is answered from the cache.'],
  ]),
  h2('The reporting account'),
  p('Make an account for C360 alone, able to read only the tables reports need, with its own connection cap. MySQL enforces the cap whatever C360 does:'),
  ...code("CREATE USER 'c360_reports'@'192.168.10.18' IDENTIFIED BY '<generated>' WITH MAX_USER_CONNECTIONS 4;\nGRANT SELECT ON shopdb.* TO 'c360_reports'@'192.168.10.18';\n-- no INSERT, UPDATE, DELETE, no PROCESS, no access to mysql.*", 'On the customer\'s MySQL server'),
  bullet('Index the columns reports filter and group on, above all dates (`created_at`, `order_date`).'),
  bullet('Schedule heavy reports outside business hours (Insights → Schedules).'),
  bullet('Open the MySQL port to the production server\'s address only.'),
  note('No replica: a nightly copy is the safer path.', 'With no read replica, every report reads the database the business runs on. The safer path is a nightly copy of the mapped tables into ClickHouse on the production server, so reports never touch the customer\'s database in working hours. It is planned with the production rollout; until then, the limits above apply. MySQL 5.7 has been out of support since October 2023: plan its upgrade with the customer.'),
)

// 14
add(h1('14. Troubleshooting'),
  table([3300, 5726], ['Symptom', 'Cause and fix'], [
    ['Sign-in seems to work, then returns to the sign-in page', 'The site is reached over plain HTTP: the production settings only keep HTTPS cookies. Serve it over HTTPS (section 2).'],
    ['Browser loops on redirects', 'Nginx does not send `X-Forwarded-Proto`. Add the proxy headers (section 8).'],
    ['`400 Bad Request` / DisallowedHost', '`ALLOWED_HOSTS` does not name the host. Add it and restart `cep-api` and `cep-insights`.'],
    ['Back-office forms: CSRF verification failed', 'Add the origin with `https://` to `CSRF_TRUSTED_ORIGINS`, restart.'],
    ['Back-office without styling', '`collectstatic` not run, or the `/static/` alias is wrong.'],
    ['Insights pages fail with 502', '`cep-insights` is down or not on 8012: `systemctl status cep-insights`, `/var/log/cep/insights.log`.'],
    ['"Unknown workspace" on sign-in', 'The workspace code is wrong, or the host\'s first label is read as a workspace: rebuild with `VITE_RESERVED_SUBDOMAINS`.'],
    ['Scheduled reports never arrive', '`cep-jobs` is down, or no mail server: back-office health page, `/var/log/cep/jobs.log`.'],
    ['Jobs run twice', 'Two schedulers, or `cep-jobs` beside Celery. Keep exactly one.'],
    ['A report on the customer database times out', 'It reads more than 15 seconds\' worth: add a filter or an index on the customer\'s side, or schedule it.'],
    ['`permission denied for table …`', '`DATABASE_URL` and `PLATFORM_DATABASE_URL` swapped, or a patch not applied.'],
    ['Stored secrets unreadable after a move', '`FIELD_ENCRYPTION_KEY` differs from the one they were saved with. Restore it, or enter them again.'],
  ]),
)

// Appendix
add(h1('Appendix A. Command reference'),
  table([4900, 4126], ['Command (repository root or `backend/`, production settings exported)', 'Use'], [
    ['`bash database/production/build_production_db.sh`', 'Build a new, empty production database.'],
    ['`bash database/production/load_reference_data.sh <email> [name]`', 'Production settings, the Platform workspace and its administrator.'],
    ['`psql -X -f database/production/verify.sql`', 'Check a production database.'],
    ['`bash database/apply_patch.sh <file>`', 'Apply and record one patch.'],
    ['`python manage.py create_platform_admin <email>`', 'The Platform workspace and a platform administrator (asks for the password).'],
    ['`python manage.py changepassword <email> --database platform`', 'Set a staff password from the console.'],
    ['`python manage.py check --deploy`', 'Configuration and security self-check.'],
    ['`python manage.py run_scheduler --once`', 'One pass of the scheduler, to see what is due.'],
    ['`python manage.py run_job --list` / `run_job <name>`', 'List the scheduled jobs / run one now.'],
    ['`python manage.py run_tenant_operation --tenant X --operation EXPORT`', 'Export, move, purge or offboard a workspace (needs `OWNER_DATABASE_URL`).'],
  ]),
  h1('Appendix B. Windows and containers'),
  p('Gunicorn does not run on Windows: use a Linux server, or WSL 2. `deploy/docker-compose.dev.yml` is for development only (PostgreSQL and Redis); no production images exist. The systemd layout in this guide is the supported one.'),
)

// ---------------------------------------------------------------------------------------------- document
const numbering = {
  config: [
    { reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 900, hanging: 260 } } } },
    ] },
    ...stepRefs.map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 360 } } } }] })),
  ],
}

const doc = new Document({
  creator: 'C360', title: 'C360 Deployment Guide', description: 'How to host C360 on a production server',
  features: { updateFields: true },
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
  numbering,
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [run('C360 Deployment Guide', { size: 17, color: MUTED })], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 4 } } })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }],
      children: [run('Confidential — contains infrastructure details, no credentials', { size: 17, color: MUTED }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: MUTED })] })] }) },
    children: body,
  }],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(process.argv[2], buffer)
  console.log('written', process.argv[2], buffer.length, 'bytes')
})
