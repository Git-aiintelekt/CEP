-- 0040: tenant_usage accepts the DELIVERABILITY_TESTS metric. The hourly usage rollup has written it since patch 0030, but the
-- check constraint did not allow it, so every rollup ended in an error on its last metric (the other metrics were stored).
-- Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
