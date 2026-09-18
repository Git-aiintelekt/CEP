-- Patch 0008: a tenant's mail server as a campaign delivery provider (provider_type SMTP, mail_server.campaign_sender).
-- The layer file is idempotent, so the patch simply runs it again.
\ir ../CEP_Database_Schema_Platform_Operations.sql
