-- 0032: contact compliance: an upload declares where its people agreed (consent basis, where it was collected, the attestation);
--       a list carries an approval status the send engine respects. The policy itself lives in tenant.settings (consent_policy).
-- Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
