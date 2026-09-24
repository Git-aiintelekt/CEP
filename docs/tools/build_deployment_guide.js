// Generates docs/CEP_Deployment_Guide.docx. Needs the docx package:  npm install docx  (in any folder), then
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
  new Paragraph({ children: [new TextRun({ text: 'CEP — Customer Engagement Platform', font: FONT, size: 52, bold: true, color: BRAND })], spacing: { before: 2400, after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: 'Deployment Guide: hosting the application on a remote server', font: FONT, size: 32, color: INK })], spacing: { after: 360 } }),
  new Paragraph({ children: [run('Version 1.6  ·  24 September 2026  ·  Repository: github.com/Git-aiintelekt/CEP (branch main)', { color: MUTED })], spacing: { after: 80 } }),
  new Paragraph({ children: [run('Stack: Django 6.1 + Django REST Framework, Celery, Redis, PostgreSQL 18, React 19 (Vite), Nginx, Gunicorn', { color: MUTED })], spacing: { after: 600 } }),
  note('Scope.', 'This guide is written from the project\'s actual settings, commands and file layout. The server-side steps (Nginx, systemd, TLS) are the standard way to host this stack and have **not** been executed on your server by the author: run them on a staging host first, then repeat for production. Replace every `example.com` name, path and IP address with your own. No password appears in this document, and none should be added to it.', 'E8EDFB', BRAND),
  note('Release status, 24 September 2026.', '`main` is the branch of record and carries everything: the contact list and campaign modules, the shared UI restyle, the campaign calendar view, the idle session timeout, the receipt layout editor\'s API, the dashboard totals and campaign-results performance work, the public-address global parameter (patch 0018), and the template designer release (PR #15, commit `78f7788`): a new endpoint `POST /api/v1/templates/{id}/clone/` that makes a DRAFT copy of a template (its latest design or message becomes version 1 of the copy; the Templates page calls it from the row menu\'s Duplicate), a fix for the false "saved by someone else (now at version 0)" conflict on every second designer save, and designer autosave. That release changes Python and frontend code only — no schema patch — so deploying it is a pull and a restart of `cep-api` (section 3.3 for the general procedure). The dev server 10.0.0.43 (`cepdev.aiintelekt.com`) deploys from `main` and runs it. Database patches 0001–0017 are applied to `cep_db`; 0018 is the one this release adds (section 3.1). Confirm the commit on `main` with `git log -1` before deploying.', 'ECFDF5', '059669'),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ children: [new TextRun({ text: 'Contents', font: FONT, size: 32, bold: true, color: BRAND })], spacing: { after: 200 } }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
)

// 1
add(h1('1. What gets deployed'),
  p('CEP is five cooperating processes plus two data stores. On a small installation they all fit on one application server; the database already runs on its own host.'),
  table([2100, 2500, 4426], ['Component', 'Runs as', 'Purpose'], [
    ['React app', 'static files served by Nginx', 'The product UI for tenants. Built once per release (`npm run build`) into `frontend/dist`.'],
    ['Django API + back-office', 'Gunicorn (WSGI) behind Nginx, systemd service `cep-api`', 'REST API under `/api/v1/`, Swagger at `/api/v1/docs/`, platform back-office at `/admin/`, liveness probe at `/healthz`.'],
    ['Celery worker', 'systemd service `cep-worker`', 'Background jobs: campaign sending (runs, email and text batches), contact list uploads (queue `imports`: read, checked and imported in chunks), event outbox relay, partition maintenance, usage rollup, alerts, invoices, tenant operations. Queues: `default,events,maintenance,campaign,email,sms,imports`.'],
    ['Celery beat', 'systemd service `cep-beat` (exactly one)', 'The scheduler that triggers the jobs above. Two beats would run every job twice.'],
    ['Redis', 'local service', 'Celery broker and result store, Django cache, event streams.'],
    ['PostgreSQL 18', 'existing server `10.0.0.43:5433`, database `cep_db`', 'All data. Row-level security per tenant; per-tenant partitions.'],
    ['Nginx', 'local service, ports 80/443', 'TLS termination, static files, reverse proxy to Gunicorn.'],
  ]),
  h2('Request flow'),
  ...code('Browser ──HTTPS──▶ Nginx ─┬─ /            ▶ React build   (frontend/dist, static)\n                           ├─ /api/ /admin/ ▶ Gunicorn :8000 ▶ Django ──▶ PostgreSQL 18\n                           ├─ /static/     ▶ backend/staticfiles           ▲\n                           └─ /media/      ▶ backend/media (or S3/CDN)     │\nCelery beat ──▶ Redis ──▶ Celery worker ─────────────────────────────────┘'),
  h2('Two database logins, on purpose'),
  p('The application never connects as a superuser: superusers bypass row-level security, which would hide tenant-isolation bugs.'),
  table([2300, 2300, 4426], ['Setting', 'Database login', 'Used for'], [
    ['`DATABASE_URL`', '`cep_backend` (member of `cep_app`, RLS enforced)', 'Every API request and every Celery task.'],
    ['`PLATFORM_DATABASE_URL`', '`cep_platform` (BYPASSRLS, member of `cep_admin`)', 'The back-office `/admin/`, management commands, platform jobs that look across tenants.'],
    ['`OWNER_DATABASE_URL`', 'the DDL owner (`admin`)', 'Only tenant export / move / offboarding. Leave empty until you need those operations.'],
  ]),
)

// 2
add(h1('2. Prerequisites'),
  h2('Server'),
  bullet('**Operating system:** Ubuntu Server 22.04 or 24.04 LTS (the commands below use `apt` and `systemd`; any modern Linux works with the equivalent commands). For Windows Server see Appendix B.'),
  bullet('**Size to start with:** 2 vCPU, 4 GB RAM, 40 GB disk. Add CPU for Celery when campaign volumes grow.'),
  bullet('**Network:** inbound 80 and 443 from the internet; outbound to the database `10.0.0.43:5433`, to your SMTP server (587 or 465) and to your identity provider if single sign-on is used. The server must be on, or routed to, the `10.0.0.x` network.'),
  h2('Software versions'),
  table([2600, 2600, 3826], ['Software', 'Version', 'Note'], [
    ['Python', '3.12 or newer (developed on 3.14)', 'Django 6.1 requires Python 3.12+. Ubuntu 24.04 ships 3.12.'],
    ['Node.js', '22 LTS or newer (developed on 24)', 'Only needed to build the React app. Not needed at run time.'],
    ['PostgreSQL', '18', 'Already in place. The schema uses PostgreSQL 18 features.'],
    ['Redis', '7 or newer', 'Local to the application server.'],
    ['Nginx', 'any current release', ''],
  ]),
  h2('Names and certificates'),
  p('Tenants are recognised by subdomain: `northwind.cep.example.com` selects the tenant whose subdomain is `northwind`. Decide your base domain and create:'),
  bullet('a DNS **A record** for the application host, e.g. `app.cep.example.com` → server IP (`www`, `app` and `api` are reserved and never treated as tenants);'),
  bullet('a **wildcard A record** `*.cep.example.com` → the same IP, so new tenants need no DNS change;'),
  bullet('a **TLS certificate** covering `cep.example.com` and `*.cep.example.com`. Wildcard certificates from Let\'s Encrypt need the DNS challenge (section 9).'),
  note('Simpler start.', 'A single host (`app.cep.example.com`) with no wildcard also works: people then type their workspace code on the sign-in page. You can add the wildcard later without changing the application.', 'ECFDF5', '059669'),
  h2('Have these to hand'),
  bullet('The three database logins (kept in your credentials file; never paste them into tickets, chat or this document).'),
  bullet('SMTP details, or plan to enter them after go-live in the back-office (Configuration → Mail server).'),
  bullet('Read access to the GitHub repository from the server (a deploy key or a personal access token).'),
)

// 3
add(h1('3. Database'),
  h2('3.1 Using the existing cep_db (your case)'),
  p('The schema, all five DDL layers and patches 0001–0017 are already applied to `cep_db`, and the three logins exist. Patch 0018 (the `platform.api_public_url` global parameter) ships with this release and is not yet applied as of this version of the guide: apply it with the release that brings the parameter live (section 3.3), then set the parameter (section 10). Nothing else has to be created. Two things to check from the new application server:'),
  ...steps([
    'On the PostgreSQL host, allow the application server in `pg_hba.conf` for the logins `cep_backend` and `cep_platform` (and the owner only if you will run tenant operations), then reload PostgreSQL. Use `scram-sha-256`. If the traffic leaves a trusted network, require TLS (`hostssl`) and add `?sslmode=require` to the URLs.',
    'From the application server, prove connectivity: `psql "postgres://cep_backend@10.0.0.43:5433/cep_db" -c "select 1"` (psql prompts for the password).',
  ]),
  ...code('# pg_hba.conf on the database server (replace 10.0.0.50 with the app server)\nhost  cep_db  cep_backend   10.0.0.50/32  scram-sha-256\nhost  cep_db  cep_platform  10.0.0.50/32  scram-sha-256'),
  h2('3.2 A brand-new database (another environment)'),
  p('Apply the layer files in this order as the DDL owner. They already contain every fix shipped as a patch, so patches are only for databases created earlier.'),
  ...code('createdb -p 5433 cep_db\ncd database\npsql -p 5433 -d cep_db -v ON_ERROR_STOP=1 -f CEP_Database_Schema.sql\npsql -p 5433 -d cep_db -v ON_ERROR_STOP=1 -f CEP_Database_Schema_Enterprise_Hardening.sql\npsql -p 5433 -d cep_db -v ON_ERROR_STOP=1 -f CEP_Database_Schema_SaaS_Tenancy.sql\npsql -p 5433 -d cep_db -v ON_ERROR_STOP=1 -f CEP_Database_Schema_Hybrid_Services.sql\npsql -p 5433 -d cep_db -v ON_ERROR_STOP=1 -f CEP_Database_Schema_Platform_Operations.sql\n# optional demo tenant "Northwind Apparel" (never on production):\n# psql -p 5433 -d cep_db -f CEP_Seed_Data.sql'),
  p('Then create the two application logins as members of the groups the DDL creates (`cep_app`, `cep_admin`) and give each a strong generated password:'),
  ...code("CREATE ROLE cep_backend  LOGIN PASSWORD '<generated>' IN ROLE cep_app;\nCREATE ROLE cep_platform LOGIN PASSWORD '<generated>' BYPASSRLS IN ROLE cep_admin;"),
  h2('3.3 Upgrading an existing database later'),
  p('Releases that change the schema ship a numbered file in `database/patches/`. Apply new ones in order with psql as the DDL owner, from the `patches` folder (they include the layer file with a relative path). Every patch is idempotent: running one twice is harmless.'),
  ...code('cd database/patches\npsql "$OWNER_URL" -v ON_ERROR_STOP=1 -f 0008_smtp_delivery_provider.sql'),
)

// 4
add(h1('4. Prepare the application server'),
  ...code('sudo apt update && sudo apt -y upgrade\nsudo apt -y install python3 python3-venv python3-dev build-essential git \\\n                    nginx redis-server postgresql-client curl\n\n# Node.js 22 LTS, only for building the React app\ncurl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt -y install nodejs\n\n# a dedicated, unprivileged account and the directories it owns\nsudo adduser --system --group --home /opt/cep cep\nsudo mkdir -p /opt/cep/frontend-dist /var/lib/cep/exports /var/log/cep\nsudo chown -R cep:cep /opt/cep /var/lib/cep /var/log/cep'),
  p('Redis must listen on localhost only (the Ubuntu default). Confirm `bind 127.0.0.1 -::1` in `/etc/redis/redis.conf`, then `sudo systemctl enable --now redis-server`.'),
  h2('Firewall'),
  ...code('sudo ufw allow OpenSSH\nsudo ufw allow "Nginx Full"\nsudo ufw enable'),
)

// 5
add(h1('5. Install the application'),
  h2('5.1 Code'),
  ...code('sudo -u cep -H bash\ncd /opt/cep\ngit clone https://github.com/Git-aiintelekt/CEP.git app\ncd app && git checkout main'),
  h2('5.2 Python environment'),
  ...code('cd /opt/cep/app/backend\npython3 -m venv .venv\n.venv/bin/pip install --upgrade pip\n.venv/bin/pip install -r requirements.txt'),
  h2('5.3 Configuration: /opt/cep/app/.env'),
  p('The settings read one file, `.env` in the repository root (next to `backend/` and `frontend/`). It is git-ignored. Start from the template and lock it down:'),
  ...code('cd /opt/cep/app\ncp .env.example .env\nchmod 600 .env\n\n# generate the two secrets (run each once, paste the output into .env)\nbackend/.venv/bin/python -c "import secrets; print(secrets.token_urlsafe(64))"\nbackend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'),
  p('Production values (replace names; fill the passwords in on the server only):'),
  ...code('SECRET_KEY=<first generated value>\nDEBUG=False\nALLOWED_HOSTS=.cep.example.com\nCSRF_TRUSTED_ORIGINS=https://cep.example.com,https://*.cep.example.com\nCORS_ALLOWED_ORIGINS=https://app.cep.example.com\n\nDATABASE_URL=postgres://cep_backend:<password>@10.0.0.43:5433/cep_db\nPLATFORM_DATABASE_URL=postgres://cep_platform:<password>@10.0.0.43:5433/cep_db\nOWNER_DATABASE_URL=\nCONN_MAX_AGE=60\n\nFIELD_ENCRYPTION_KEY=<second generated value>\nREDIS_URL=redis://127.0.0.1:6379/0\n\nFRONTEND_URL=https://app.cep.example.com\nAPI_PUBLIC_URL=https://app.cep.example.com\nPLATFORM_ADMIN_URL=https://app.cep.example.com\n\nDEFAULT_FROM_EMAIL=CEP <no-reply@cep.example.com>\nEMAIL_HOST=\nTENANT_EXPORT_DIR=/var/lib/cep/exports\nLOG_LEVEL=INFO\nMEDIA_BUCKET='),
  note('Keep FIELD_ENCRYPTION_KEY safe and unchanged.', 'It encrypts SMTP passwords, single sign-on client secrets and MFA secrets stored in the database. If it is lost or replaced, those values can no longer be read and must be entered again. Back it up with your other secrets, separately from the database backups. Special characters in a database password must be URL-encoded inside the `postgres://` URLs.'),
  table([2900, 6126], ['Variable', 'Meaning'], [
    ['`ALLOWED_HOSTS`', 'A leading dot accepts the domain and every subdomain (all tenants).'],
    ['`CSRF_TRUSTED_ORIGINS`', 'Needed for the back-office forms behind HTTPS.'],
    ['`FRONTEND_URL`', 'Where one-time password links, single sign-on and support sessions send the browser.'],
    ['`API_PUBLIC_URL`', 'Public base address of the API: the single sign-on redirect URI, the delivery providers\' callback addresses (webhooks) and the unsubscribe link in every marketing email are built from it. It must be reachable from the internet. Once the installation runs, the global parameter `platform.api_public_url` (section 10) takes precedence over this value; this is the bootstrap.'],
    ['`EMAIL_HOST` …', 'Optional fallback. Normally the mail server is entered in the back-office after go-live (section 10).'],
    ['`MEDIA_BUCKET`, `CDN_BASE_URL`, `S3_ENDPOINT_URL`', 'Empty = uploaded images on local disk (`backend/media`). Set them to store media in S3-compatible storage behind a CDN.'],
  ]),
  h2('5.4 Static files and checks'),
  ...code('cd /opt/cep/app/backend\nexport DJANGO_SETTINGS_MODULE=config.settings.production\n.venv/bin/python manage.py collectstatic --noinput     # -> backend/staticfiles\n.venv/bin/python manage.py check --deploy              # must report no errors\n.venv/bin/python manage.py showmigrations --database platform'),
  note('DJANGO_SETTINGS_MODULE matters.', '`manage.py`, `wsgi.py` and Celery default to the **development** settings. Every production command and every systemd unit below sets `DJANGO_SETTINGS_MODULE=config.settings.production`, which switches off DEBUG and turns on HTTPS redirects, HSTS and secure cookies.'),
  p('About migrations: every model is unmanaged; the SQL files own the schema. On the existing `cep_db` the migration history is already recorded, so `showmigrations` should list everything as applied and there is nothing to migrate. Do not run `migrate` against a database whose schema was applied with psql unless you pass `--fake` for the `database` app, or Django would try to run the DDL a second time.'),
)

// 6
add(h1('6. Run the API with Gunicorn'),
  ...code('[Unit]\nDescription=CEP API (Gunicorn)\nAfter=network-online.target redis-server.service\nWants=network-online.target\n\n[Service]\nUser=cep\nGroup=cep\nWorkingDirectory=/opt/cep/app/backend\nEnvironment=DJANGO_SETTINGS_MODULE=config.settings.production\nExecStart=/opt/cep/app/backend/.venv/bin/gunicorn config.wsgi:application \\\n          --bind 127.0.0.1:8000 --workers 3 --timeout 60 \\\n          --access-logfile /var/log/cep/access.log --error-logfile /var/log/cep/api.log\nRestart=always\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=multi-user.target', '/etc/systemd/system/cep-api.service'),
  p('Workers: start with `2 × CPU cores + 1`. Each worker holds its own database connections, so keep `workers × 2` comfortably below the PostgreSQL `max_connections` budget for the application.'),
)

// 7
add(h1('7. Run the background jobs with Celery'),
  ...code('[Unit]\nDescription=CEP Celery worker\nAfter=network-online.target redis-server.service\n\n[Service]\nUser=cep\nGroup=cep\nWorkingDirectory=/opt/cep/app/backend\nEnvironment=DJANGO_SETTINGS_MODULE=config.settings.production\nExecStart=/opt/cep/app/backend/.venv/bin/celery -A config worker \\\n          -Q default,events,maintenance,campaign,email,sms,imports --concurrency 4 -l INFO \\\n          --logfile /var/log/cep/worker.log\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target', '/etc/systemd/system/cep-worker.service'),
  ...code('[Unit]\nDescription=CEP Celery beat (scheduler) - run exactly one\nAfter=network-online.target redis-server.service\n\n[Service]\nUser=cep\nGroup=cep\nWorkingDirectory=/opt/cep/app/backend\nEnvironment=DJANGO_SETTINGS_MODULE=config.settings.production\nExecStart=/opt/cep/app/backend/.venv/bin/celery -A config beat -l INFO \\\n          --schedule /var/lib/cep/celerybeat-schedule --logfile /var/log/cep/beat.log\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target', '/etc/systemd/system/cep-beat.service'),
  ...code('sudo systemctl daemon-reload\nsudo systemctl enable --now cep-api cep-worker cep-beat\nsystemctl status cep-api cep-worker cep-beat --no-pager\ncurl -s http://127.0.0.1:8000/healthz -H "X-Forwarded-Proto: https"'),
  p('The scheduled jobs and their intervals are defined in `config/settings/base.py` (`CELERY_BEAT_SCHEDULE`): outbox relay every second, campaign runs every minute (starts due runs, closes finished ones), partitions every 6 hours, retention daily, usage hourly, alerts every 5 minutes, invoices daily, tenant operations every 10 minutes. Campaign email and texts are sent by the `campaign`, `email` and `sms` queues of the worker; for high volumes run a second `cep-worker` unit that listens only to `-Q email`. The back-office health page shows each job as healthy, failed, overdue or never run.'),
)

// 8
add(h1('8. Build and publish the React app'),
  p('The build needs no environment variables: the app calls `/api/v1` on the host it is served from, and takes the tenant from the subdomain. Build on the server, or build on a workstation and copy `frontend/dist` across.'),
  ...code('cd /opt/cep/app/frontend\nnpm ci\nnpm run build                                   # type-check + production build -> dist/\nrsync -a --delete dist/ /opt/cep/frontend-dist/'),
  p('The build output is fingerprinted (`assets/index-<hash>.js`), so it can be cached for a year; `index.html` must never be cached. The Nginx configuration below does both. The email designer is a separate chunk of about 1 MB that loads only when someone opens it.'),
)

// 9
add(h1('9. Nginx and TLS'),
  ...code('upstream cep_api { server 127.0.0.1:8000; keepalive 16; }\n\nserver {\n    listen 80;\n    server_name cep.example.com *.cep.example.com;\n    return 301 https://$host$request_uri;\n}\n\nserver {\n    listen 443 ssl http2;\n    server_name cep.example.com *.cep.example.com;\n\n    ssl_certificate     /etc/letsencrypt/live/cep.example.com/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/cep.example.com/privkey.pem;\n\n    client_max_body_size 30m;            # image uploads (the app caps them lower)\n    root /opt/cep/frontend-dist;\n\n    # --- Django: API, back-office, liveness probe\n    location ~ ^/(api|admin|healthz) {\n        proxy_pass         http://cep_api;\n        proxy_http_version 1.1;\n        proxy_set_header   Connection        "";\n        proxy_set_header   Host              $host;\n        proxy_set_header   X-Real-IP         $remote_addr;\n        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;\n        proxy_set_header   X-Forwarded-Proto $scheme;\n        proxy_read_timeout 75s;\n    }\n\n    # --- files collected / uploaded by Django\n    location /static/ { alias /opt/cep/app/backend/staticfiles/; expires 30d; }\n    location /media/  { alias /opt/cep/app/backend/media/;       expires 7d;  }\n\n    # --- React build: long cache for fingerprinted assets, none for index.html\n    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }\n    location / {\n        add_header Cache-Control "no-cache";\n        try_files $uri /index.html;      # client-side routes (/campaigns, /settings ...)\n    }\n\n    gzip on;\n    gzip_types text/css application/javascript application/json image/svg+xml;\n}', '/etc/nginx/sites-available/cep'),
  p('`Host` must be passed through unchanged: Django reads the tenant from it. `X-Forwarded-Proto` is what tells Django the original request was HTTPS; without it the production settings redirect forever.'),
  h2('Certificate'),
  p('For the single-host start, the HTTP challenge is enough. For the wildcard, use the DNS challenge with the certbot plugin of your DNS provider (Cloudflare, Route 53, …), which also renews unattended.'),
  ...code('sudo apt -y install certbot python3-certbot-nginx\n# single host:\nsudo certbot --nginx -d app.cep.example.com\n# wildcard (example: Cloudflare DNS plugin):\nsudo apt -y install python3-certbot-dns-cloudflare\nsudo certbot certonly --dns-cloudflare \\\n     --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \\\n     -d cep.example.com -d "*.cep.example.com"\n\nsudo ln -s /etc/nginx/sites-available/cep /etc/nginx/sites-enabled/cep\nsudo rm -f /etc/nginx/sites-enabled/default\nsudo nginx -t && sudo systemctl reload nginx'),
)

// 10
add(h1('10. First run'),
  ...steps([
    '**Platform administrator.** On the existing database your account already exists. On a new database: `python manage.py make_platform_admin you@example.com` then `python manage.py changepassword you@example.com --database platform` (both with the production settings module exported).',
    '**Sign in to the back-office** at `https://app.cep.example.com/admin/`. The home page is the platform health page: every check should be green or explained.',
    '**Mail server.** Configuration → Mail server: enter your SMTP details, save, then use **Send a test message to me**. Optionally share it with every tenant or with selected tenants. Until a server is configured, messages are only written to the log and password links must be copied by hand.',
    '**Alerts.** Configuration → Global parameters: put your operations addresses in `alerts.recipients` (and a Slack-compatible webhook in `alerts.webhook_url` if you use one).',
    '**Plans and prices.** Set `monthly_price` and overage prices on the subscription plans; plans without a price are never invoiced.',
    '**First tenant.** Tenants → Add: saving creates its partitions, routing row and starting roles. Add its first administrator under People and access, then send the one-time password link from the user\'s page.',
    '**Tenant sign-in.** `https://<subdomain>.cep.example.com/` (or the application host plus the workspace code). Tenant administrators find users, roles, API keys, plan & usage, security (MFA, single sign-on) and their own email server under **Settings**.',
    '**Staff MFA.** After every staff member has enrolled (their name → Account security), switch `security.mfa_required_for_staff` on.',
    '**Public address (patch 0018 and newer).** Configuration → Global parameters: set `platform.api_public_url` to the https address the outside world reaches this installation at, no trailing slash (e.g. `https://cep.example.com`). The webhook callback addresses shown under Settings → Delivery, the unsubscribe link in marketing emails and the single sign-on redirect URI are built from it, so set it before registering any of those with a provider; it takes effect within a minute. Empty, the `API_PUBLIC_URL` variable from `.env` applies.',
    '**Idle sign-out (patch 0016 and newer).** Configuration → Global parameters: `security.idle_timeout_minutes` (default 120) and `security.idle_warning_seconds` (default 60) control how long the frontend waits before warning of inactivity, and how long that warning stays up before signing the person out. The defaults suit most workspaces; change them here, not in code.',
  ]),
)

// 11
add(h1('11. Verify the deployment'),
  table([4200, 4826], ['Check', 'Expected'], [
    ['`curl -s https://app.cep.example.com/healthz`', '`{"status": "ok", "database": "ok"}`'],
    ['`https://app.cep.example.com/` in a browser', 'The sign-in page; no errors in the browser console.'],
    ['`https://app.cep.example.com/api/v1/docs/`', 'Swagger UI lists the API, including `POST /api/v1/templates/{id}/clone/`.'],
    ['`curl -s -o /dev/null -w "%{http_code}" -X POST -H "X-Tenant: <workspace code>" https://app.cep.example.com/api/v1/templates/00000000-0000-4000-8000-000000000000/clone/`', '`401` — the clone route is served and asks for a sign-in (a `404` means the API is still running code from before PR #15). Signed in, Templates → row menu → Duplicate creates "<name> (copy)" as a draft and opens it.'],
    ['`/admin/` home page', 'Database, Tenant isolation, Migrations, Partitions, Cache, Workers, Email, Secrets at rest and Configuration are green; Scheduled jobs become "Healthy" within their interval.'],
    ['`https://app.cep.example.com/admin/health.json` (signed in)', 'HTTP 200; 503 means at least one check is failing. Suitable for an uptime monitor with a session, while `/healthz` is the anonymous probe.'],
    ['Sign in as a tenant user, open Campaigns', 'Data of that tenant only.'],
    ['`systemctl status cep-worker cep-beat`', 'active (running); `tail /var/log/cep/worker.log` shows tasks succeeding every second (outbox relay).'],
    ['Tenant isolation', 'Health page "Tenant isolation" confirms the API login is not a superuser and cannot bypass row-level security.'],
  ]),
)

// 12
add(h1('12. Releasing a new version'),
  ...code('sudo -u cep -H bash -lc \'\n  set -e\n  cd /opt/cep/app && git fetch origin && git checkout main && git pull --ff-only\n  cd backend && .venv/bin/pip install -r requirements.txt\n  export DJANGO_SETTINGS_MODULE=config.settings.production\n  .venv/bin/python manage.py collectstatic --noinput\n  .venv/bin/python manage.py check --deploy\n  cd ../frontend && npm ci && npm run build\n  rsync -a --delete dist/ /opt/cep/frontend-dist/\n\'\n# new files in database/patches/ ? apply them now, as the DDL owner (section 3.3)\nsudo systemctl restart cep-api cep-worker cep-beat'),
  bullet('**Order for schema changes:** apply the database patch first (patches only add), then restart the application.'),
  bullet('**Rollback:** `git checkout <previous commit>`, rebuild the frontend, restart. Patches are additive, so the previous code keeps working against the newer schema.'),
  bullet('**Zero-downtime reload of the API:** `sudo systemctl kill -s HUP cep-api` makes Gunicorn replace its workers gracefully.'),
)

// 13
add(h1('13. Operations'),
  h2('Backups'),
  bullet('**Database:** nightly `pg_dump -Fc` of `cep_db` (or continuous WAL archiving) on the database server; test a restore regularly.'),
  bullet('**Uploaded media:** `/opt/cep/app/backend/media` (unless you use S3).'),
  bullet('**Secrets:** `/opt/cep/app/.env`, above all `FIELD_ENCRYPTION_KEY` and `SECRET_KEY`, stored separately from the database backups.'),
  bullet('**Tenant exports:** `/var/lib/cep/exports` holds the archives produced by export / offboarding; they may be deleted after `tenancy.offboarding_export_days`.'),
  h2('Logs'),
  bullet('Application logs are JSON lines: `/var/log/cep/api.log`, `worker.log`, `beat.log`, plus `journalctl -u cep-api`. Nginx: `/var/log/nginx/`.'),
  bullet('Add `/var/log/cep/*.log` to logrotate (weekly, keep 8, `copytruncate`).'),
  h2('Monitoring'),
  bullet('Point your uptime monitor at `/healthz`. The platform raises its own alerts (failing health checks, failed or overdue jobs) by email and webhook once `alerts.recipients` is set.'),
  bullet('Watch disk space on the database server: partitions are created monthly per tenant and dropped according to the retention policy.'),
  h2('Security checklist'),
  bullet('`DEBUG=False`, a unique `SECRET_KEY`, `.env` readable by the `cep` user only (`chmod 600`).'),
  bullet('`DATABASE_URL` is **never** a superuser. `OWNER_DATABASE_URL` stays empty except while running tenant operations.'),
  bullet('Redis bound to localhost; PostgreSQL reachable only from the application server; SSH by key only.'),
  bullet('Consider restricting `/admin/` to your office or VPN addresses in Nginx (`allow` / `deny` inside a dedicated `location /admin/`).'),
  bullet('Unattended security updates: `sudo apt -y install unattended-upgrades`.'),
  h2('Scaling out later'),
  bullet('Several application servers behind a load balancer: run `cep-api` and `cep-worker` on each, **one** `cep-beat` in total, and point all of them at a shared Redis. Move media to S3 so every server sees the same files.'),
  bullet('Large tenants can be moved to their own database with the MOVE_TO_DEDICATED operation; add the new database alias to the application servers and restart them.'),
)

// 14
add(h1('14. Troubleshooting'),
  table([3300, 5726], ['Symptom', 'Cause and fix'], [
    ['Browser loops on redirects (too many redirects)', 'Nginx is not sending `X-Forwarded-Proto`. Add the proxy headers from section 9.'],
    ['`400 Bad Request` / DisallowedHost in `api.log`', '`ALLOWED_HOSTS` does not cover the host name. Use `.cep.example.com` (leading dot). Make sure Nginx passes `Host $host`.'],
    ['Back-office forms fail with CSRF verification failed', 'Add the origin to `CSRF_TRUSTED_ORIGINS` (with `https://`), restart `cep-api`.'],
    ['Back-office has no styling', '`collectstatic` was not run, or the Nginx `/static/` alias does not point at `backend/staticfiles/`.'],
    ['"Unknown tenant" / 404 on sign-in', 'The subdomain does not match a tenant\'s subdomain, or the workspace code is wrong. `www`, `app` and `api` are never tenants.'],
    ['A page of the React app gives 404 after refresh', 'The `try_files $uri /index.html;` fallback is missing.'],
    ['Health page: Workers / Scheduled jobs red or "never run"', '`cep-worker` or `cep-beat` is down, or Redis is unreachable: `systemctl status`, then `/var/log/cep/worker.log`.'],
    ['Jobs run twice', 'Two beat processes. Keep exactly one `cep-beat`.'],
    ['A published campaign stays Scheduled', 'The worker is not listening to the `campaign`, `email` and `sms` queues (check `-Q` in `cep-worker.service`), or beat is down. `python manage.py send_campaign_runs` sends what is due by hand.'],
    ['No deliveries, bounces or opens come back', 'The provider does not know the callback address: copy it from Settings → Delivery and register it with Postal / SendGrid. It must be reachable from the internet at `API_PUBLIC_URL`.'],
    ['`permission denied for table …` in the API log', '`DATABASE_URL` and `PLATFORM_DATABASE_URL` are swapped or point at the wrong login.'],
    ['"Email: attention" on the health page; password links only copyable', 'No mail server yet: Configuration → Mail server, then send a test.'],
    ['Stored SMTP / single sign-on secrets unreadable after a move', '`FIELD_ENCRYPTION_KEY` differs from the one used when they were saved. Restore the key, or enter the secrets again.'],
    ['`password authentication failed` from the new server', '`pg_hba.conf` has no entry for the server\'s address, or special characters in the password are not URL-encoded in the URL.'],
  ]),
)

// Appendix
add(h1('Appendix A. Docker alternative'),
  p('The repository ships `deploy/docker-compose.dev.yml` for development only (PostgreSQL 18 and Redis). It is not a production stack and no production images exist yet. If you prefer containers, the same five processes map one-to-one to services (`api`, `worker`, `beat`, `redis`, `nginx`), each started with the commands in sections 6, 7 and 9 and the same `.env`. Ask for a production compose file if you want to go that way; the systemd layout above is what this guide supports.'),
  h1('Appendix B. Windows Server'),
  p('Gunicorn does not run on Windows. The supported path on a Windows host is WSL 2 or Docker Desktop with the Linux steps above. Running natively is possible but untested for this project: serve Django with `waitress` (`pip install waitress`, then `waitress-serve --listen=127.0.0.1:8000 config.wsgi:application`), run Celery with `--pool=solo`, install the services with NSSM, use Memurai or a remote Redis, and put IIS (URL Rewrite + ARR) or Nginx for Windows in front with the same routing rules as section 9. A Linux server is strongly recommended.'),
  h1('Appendix C. Command reference'),
  table([4700, 4326], ['Command (from `backend/`, production settings exported)', 'Use'], [
    ['`python manage.py check --deploy`', 'Configuration and security self-check.'],
    ['`python manage.py make_platform_admin <email>`', 'Give a user back-office access.'],
    ['`python manage.py changepassword <email> --database platform`', 'Set a staff password from the console.'],
    ['`python manage.py provision_tenant <uuid>`', 'Create the partitions of a tenant inserted by hand (the back-office does this on save).'],
    ['`python manage.py load_sample_templates <TENANT>`', 'Starter email, e-receipt, SMS and MMS templates for a tenant.'],
    ['`python manage.py run_job --list` / `run_job <name>`', 'List the scheduled jobs / run one now.'],
    ['`python manage.py run_tenant_operation --tenant X --operation EXPORT`', 'Export, move, purge or offboard a tenant (needs `OWNER_DATABASE_URL`).'],
    ['`python manage.py sendtestemail you@example.com`', 'Test the `EMAIL_*` fallback from `.env` (the back-office has its own test button).'],
  ]),
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
  creator: 'CEP', title: 'CEP Deployment Guide', description: 'How to host the CEP application on a remote server',
  features: { updateFields: true },
  styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
  numbering,
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [run('CEP Deployment Guide', { size: 17, color: MUTED })], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 4 } } })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }],
      children: [run('Confidential — contains infrastructure details, no credentials', { size: 17, color: MUTED }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 17, color: MUTED })] })] }) },
    children: body,
  }],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(process.argv[2], buffer)
  console.log('written', process.argv[2], buffer.length, 'bytes')
})
