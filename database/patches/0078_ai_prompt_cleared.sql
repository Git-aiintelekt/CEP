-- 0078 (2026-10-24): AI Reports, Clear History. ai_prompt.cleared_at: a prompt the person cleared from their history stays in the
-- table (the month's prompt count and the workspace's record are unchanged) and leaves their list.
-- Apply with database/apply_patch.sh 0078_ai_prompt_cleared.sql, which also records it.
\ir ../CEP_Database_Schema_Platform_Operations.sql
