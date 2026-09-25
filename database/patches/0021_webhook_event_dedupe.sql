-- 0021: delivery_webhook_event.provider_event_id and the DUPLICATE processing status: a Postal callback delivered twice (Postal retries on
-- anything but a 2xx) is kept as a DUPLICATE row and never applied twice, so opens and clicks are counted once. Idempotent: re-runs the
-- platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
