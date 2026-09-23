-- Patch 0018: platform.api_public_url global parameter (the installation's public address, set in the back-office;
-- empty = the API_PUBLIC_URL environment variable). The layer file is idempotent.
\ir ../CEP_Database_Schema_Platform_Operations.sql
