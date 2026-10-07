-- 0043: campaign.stopped_at / stopped_by, a drip stopped early (Stop Remaining Messages; it is COMPLETED, no new status).
-- Idempotent: re-runs the platform-operations layer, same pattern as 0042.
\ir ../CEP_Database_Schema_Platform_Operations.sql
