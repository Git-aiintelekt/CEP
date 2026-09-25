-- 0020: a second, encrypted credential on delivery_provider for transactional traffic (receipts, non-marketing campaigns):
-- for Postal the API key of a separate mail server. Idempotent: re-runs the platform-operations layer, which adds the
-- column IF NOT EXISTS and keeps it out of the audit trail.
\ir ../CEP_Database_Schema_Platform_Operations.sql
