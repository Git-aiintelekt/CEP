-- 0096 (2026-11-24): error_group.user_note, the back-office's Note for Users: shown under the error message to everyone who meets
-- that error until it is resolved. Re-runs the Platform Operations layer, which is idempotent. Apply with
-- database/apply_patch.sh 0096_error_user_note.sql BEFORE deploying the code of branch error-details.
\ir ../CEP_Database_Schema_Platform_Operations.sql
