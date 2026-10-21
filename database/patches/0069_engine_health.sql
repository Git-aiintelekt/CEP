-- 0069: Engine Health: delivery_provider_health (the latest result per sending engine, written by the check-engine-health job)
-- and the engine_health.* thresholds in Global Parameters. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
