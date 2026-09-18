-- Patch 0007: mail_server (SMTP details entered in the product: per tenant, and the platform's own, shareable).
-- The layer file is idempotent, so the patch simply runs it again.
\ir ../CEP_Database_Schema_Platform_Operations.sql
