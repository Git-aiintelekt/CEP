-- 0045: the Goal step. journey_enrollment.converted_at / converted_node_id / attributed_revenue (who converted, at which goal,
-- the revenue within its window), and the nightly rollup's goal and message figures on journey_master_analytical.
-- Idempotent: re-runs the platform-operations layer, same pattern as 0044.
\ir ../CEP_Database_Schema_Platform_Operations.sql
