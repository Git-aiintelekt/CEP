-- 0097 (2026-11-24): Look Up in C360 (New Contact List from a file of IDs). report_connection.use_for_lists, contact_list_import.lookup,
-- the LOOKUP step of the upload queue and three platform settings. Re-runs the Platform Operations layer, which is idempotent. Apply with
-- database/apply_patch.sh 0097_list_lookup.sql BEFORE deploying the code of branch icrm-lookup.
\ir ../CEP_Database_Schema_Platform_Operations.sql
