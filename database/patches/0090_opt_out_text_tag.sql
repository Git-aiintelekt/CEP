-- 0090 (2026-11-21): {{opt_out_text}}, a platform personalization tag holding a marketing text's opt-out line ("Reply STOP to opt
-- out"). Static: its words are set once in the back-office (Personalization Tags) and every workspace inherits it. The
-- pre-publish opt-out check accepts the tag. After the patch, push it to the existing workspaces (see the PR).
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0090_opt_out_text_tag.sql.
\ir ../CEP_Database_Schema_Platform_Operations.sql
