-- Run after database/build_test_db.sh on a database built for tests (CI), never on a real one: the people the tests act as.
-- A back-office user who administers the sample workspace NWA, as a platform operator does on the servers.
INSERT INTO app_user (id, tenant_id, email, display_name, auth_provider, is_active, is_staff, is_platform_admin)
VALUES ('a1000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000001', 'ci.admin@northwindapparel.example', 'CI Administrator',
        'LOCAL', TRUE, TRUE, TRUE)
ON CONFLICT DO NOTHING;
INSERT INTO user_role (user_id, role_id)
VALUES ('a1000000-0000-4000-8000-0000000000c1', 'a2000000-0000-4000-8000-000000000001')   -- Marketing Admin (has user.admin)
ON CONFLICT DO NOTHING;

-- NWA as a retailer with barcodes and QR codes, as the scenarios expect (the Retail profile brings e-receipts)
UPDATE tenant SET settings = settings || '{"industry": "RETAIL", "features": {"dynamic_codes": true}}'::jsonb
 WHERE id = 'a0000000-0000-4000-8000-000000000001';
