-- 0095 (2026-11-24): the send window for separate send workers. sms_execution and mailer_execution get enqueued_at (when a
-- waiting message was last given to a worker), and an index of each run's waiting messages in order, so a finished batch
-- finds the next one without sorting the whole run. Nothing reads enqueued_at until the code of branch workers-resume runs.
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0095_send_window.sql
-- BEFORE deploying that code. The two indexes are built on every partition: run it in a quiet hour on a large database.
\ir ../CEP_Database_Schema_Platform_Operations.sql
