-- 0031: list channels: contact_list.channel (EMAIL | SMS | BOTH) decides the required upload column; lists on text campaigns become BOTH.
-- Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
