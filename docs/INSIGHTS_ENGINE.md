# The Insights report engine: how it runs

Insights (the reporting app, suite component `insights`) runs reports through the backend's `apps/insights`. The
engine can run inside the app process or as a process of its own; the second is what keeps a runaway report from
taking the other apps down with it. Both run the same code (`docs/C360_INSIGHTS_SUITE_PLAN.md`, Phase B).

## What protects the other apps either way

Every report runs in one short read-only transaction as the `cep_reporting` role (SELECT on the reporting views and
the tables beneath them, nothing else), with the workspace's row-level setting, a statement timeout, a row cap per kind
(preview, run, export) and a per-workspace cap on concurrent reports. The limits come from `report_engine_setting`
(Tenant Administration → Report Engines) over the defaults in `apps/insights/catalog.py`. Every preview, run and
export is audited in `report_run_audit`; a timeout or a refusal is a plain 422 to the person.

## The engine as its own service

The same codebase, with the settings module `config.settings.insights`, mounts only the Insights routes and the health
check (`config/urls_insights.py`). Beside `cep-backend` and `cep-jobs`:

```ini
# ~/.config/systemd/user/cep-insights.service (a user unit on 10.0.0.51; a system unit, User=mafsar, on 10.0.0.56)
[Unit]
Description=C360 Insights report engine
After=network.target

[Service]
WorkingDirectory=/app/cep/backend
Environment=PYTHONUNBUFFERED=1
Environment=DJANGO_SETTINGS_MODULE=config.settings.insights
Environment=CEP_SETTINGS_BASE=development
ExecStart=/app/cep/backend/.venv/bin/python manage.py runserver 127.0.0.1:8020 --noreload
Restart=always
RestartSec=3
StandardOutput=append:/var/log/cep/insights.log
StandardError=append:/var/log/cep/insights.log

[Install]
WantedBy=default.target
```

nginx sends the Insights routes there and everything else to the app:

```nginx
location ~ ^/api/v1/insights(/|$) { proxy_pass http://127.0.0.1:8020; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
location ~ ^/(api|admin|healthz|static|media)(/|$) { proxy_pass http://127.0.0.1:8010; ... }
```

Set the global parameter `insights.engine_url` to the engine's address (`http://127.0.0.1:8020`) so the platform
health page probes it; empty means the app process runs reports itself. A deploy restarts `cep-insights` with the
other two units. Under SELinux the log lives under `/var/log` (an append log under `/opt` is refused).

## How Insights is offered (platform admin → Global Parameters)

| Parameter | Values | Effect |
|---|---|---|
| `insights.mode` | `integrated` (default), `standalone`, `both` | integrated: an Insights item in each component's menu opening the list on that component's reports; standalone: Insights only as an app of its own in the launcher; both. |
| `insights.standalone_path` | `/insights` | Where the standalone app answers on this host. |
| `insights.engine_url` | an internal URL, or empty | The engine service, when there is one. |

A workspace sees Insights at all only when Tenant Administration → Components has it on (every plan includes it since
patch 0048; it is released as Beta in patch 0049).

## The catalogue

Configuration → Report Datasets maps each dataset to its reporting view (`reporting.rpt_*`, created by patch 0049
with `security_invoker`, so row-level security applies) and lists its fields: a dimension or a measure, its type, its
aggregates, its display format and its sensitivity (PII fields are offered only to `report.admin` or `user.admin`;
CONFIDENTIAL never). Report authors never see table or column names.

## The analytics engine per workspace

`report_engine_setting` names the engine (PostgreSQL today, ClickHouse with Phase E), its connection profile, its
status, freshness and limits. For dev and test, the reporting views read the CEP database itself (the spec's smallest
deployment); production gets a reporting instance fed by logical replication.
