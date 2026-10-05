-- 0036: journey_template (a workspace's saved journey templates) and journey.source_template_id /
-- journey.source_starter_key (where a journey came from). Idempotent: re-runs the platform-operations layer, same
-- pattern as 0033/0034/0035. (0035 is taken twice already, hence 0036.)
\ir ../CEP_Database_Schema_Platform_Operations.sql
