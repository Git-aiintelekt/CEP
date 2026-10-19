-- 0061: Insights' smaller gaps: dashboard_view (saved views), insights_usage (who opens what), insights_embed (embed links, found by
-- the hash of their secret) and report_dataset_link (platform datasets that share a dimension, two seeded: Messages and Attributed Orders).
-- Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
