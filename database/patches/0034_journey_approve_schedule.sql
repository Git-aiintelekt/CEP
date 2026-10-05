-- 0034: journey.scheduled_activate_at, for the Test Publish + Approve page's "Schedule for later" (phase 6i).
-- journey.status gains an APPROVED value at the application layer only (plain VARCHAR, no CHECK to widen).
-- Idempotent: re-runs the platform-operations layer, same pattern as 0033.
\ir ../CEP_Database_Schema_Platform_Operations.sql
