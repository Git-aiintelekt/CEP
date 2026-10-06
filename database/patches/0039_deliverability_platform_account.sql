-- 0039: deliverability tests through the platform's Mailgun Inspect account (deliverability_service row without a tenant),
-- deliverability_test.account (OWN | PLATFORM: which account ran it, and whether it counts against the plan), and
-- tenant_quota_grant (tests the platform team adds to one workspace for one month), and deliverability_test.updated_by, without which
-- every update of a test failed in its touch trigger (a started test never showed its previews).
-- Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
