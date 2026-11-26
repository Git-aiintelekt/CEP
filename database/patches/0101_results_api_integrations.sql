-- 0101 (2026-11-26): the Results API's endpoints as integrations. integration.kind accepts RESULTS_CAMPAIGNS, RESULTS_RUNS and
-- RESULTS_MESSAGES, so each endpoint another system reads campaign results from has its own record under Settings -> Integrations:
-- a calls-per-minute limit, a pause switch and its calls in the log. Nothing else changes. Re-runs the Platform Operations layer,
-- which is idempotent. The code of branch results-api works before this patch (the calls are limited and logged, without a
-- record to configure or pause); apply with database/apply_patch.sh 0101_results_api_integrations.sql to get the records.
\ir ../CEP_Database_Schema_Platform_Operations.sql
