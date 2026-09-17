# FastAPI services (to be scaffolded)

Per `CEP_Hybrid_Architecture.md`: `common/` (SQLAlchemy models generated from the DDL, `tenant_session()`, auth, telemetry),
`ingest/` (Postal / Digivize webhooks → `delivery_webhook_event` + `domain_event`), `tracking/` (open pixel, click redirect,
unsubscribe → `tracking_event`), `scoring/` (batch + on-demand scoring → `party_score`).

Each service connects with its own database role (`cep_ingest`, `cep_tracking`, `cep_scoring`) and sets
`SET LOCAL app.current_tenant` in every transaction, exactly like the Django middleware.
