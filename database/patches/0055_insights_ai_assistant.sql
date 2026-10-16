-- 0055: AI · Ask for a Report (apps/insights/assistant.py): ai_provider (Configuration -> AI Assistant, keys encrypted), ai_prompt
-- (each workspace's prompts, RLS, kept 90 days), subscription_plan.max_ai_prompts_per_month (Starter 50, Growth 200, Enterprise
-- unlimited) and the ai.* global parameters. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
