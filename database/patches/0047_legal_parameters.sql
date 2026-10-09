-- 0047: the Legal global parameters (legal.copyright_holder, legal.terms_of_use) behind the copyright footer of every page
-- and the Terms of Use page linked from the sign-in page. Idempotent: re-runs the platform-operations layer, same pattern
-- as 0045 and 0046; an installation that already changed the terms keeps its text (ON CONFLICT DO NOTHING).
\ir ../CEP_Database_Schema_Platform_Operations.sql
