-- Patch 0012: list uploads as background jobs (queue columns and statuses on contact_list_import, progress, heartbeat,
-- the three lists.import_* parameters). The layer file is idempotent.
\ir ../CEP_Database_Schema_Platform_Operations.sql
