-- The settings a production installation starts with, on top of the defaults the layers insert. Run by
-- load_reference_data.sh after build_production_db.sh; safe to run again (it only sets these values).
-- psql variables: public_url (the installation's public https address, no trailing slash; empty keeps the default).
\set ON_ERROR_STOP on

-- staff sign in to the back-office with a second factor; the first platform administrator is sent to set one up
UPDATE platform_setting SET value = 'true', updated_at = now() WHERE key = 'security.mfa_required_for_staff';
-- people are told when platform staff open their account or switch into their workspace
UPDATE platform_setting SET value = 'true', updated_at = now() WHERE key = 'security.notify_user_on_support_access';

SELECT :'public_url' <> '' AS has_public_url \gset
\if :has_public_url
UPDATE platform_setting SET value = to_jsonb(:'public_url'::text), updated_at = now() WHERE key = 'platform.api_public_url';
\endif

SELECT key, value FROM platform_setting
 WHERE key IN ('security.mfa_required_for_staff', 'security.notify_user_on_support_access', 'platform.api_public_url') ORDER BY key;
