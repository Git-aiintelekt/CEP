-- 0102 (2026-11-26): the Results API's per-recipient rows. mailer_execution.changed_at and sms_execution.changed_at (when a
-- message's result last moved, stamped by a trigger; added without touching existing rows, indexed for stamped rows only),
-- the stamp an unsubscribe puts on its message, the indexes for a page of held-back people and of unsubscribes, and the platform
-- setting results.changes_tracked_from. For the list of who must not be contacted: integration.kind accepts RESULTS_SUPPRESSIONS,
-- and consent_suppression and contact_point_status are indexed by workspace and updated_at (two index builds over those
-- tables: seconds on a large workspace, during which consent changes wait). Re-runs the Platform Operations layer, which is idempotent. The code of branch
-- results-api-recipients works before this patch (rows are read by send day; reading "what changed since" needs the patch).
-- Apply with database/apply_patch.sh 0102_results_api_recipients.sql. It takes a brief lock on the two message tables to add
-- the column and the trigger: quick, but best done when no campaign is going out.
\ir ../CEP_Database_Schema_Platform_Operations.sql
