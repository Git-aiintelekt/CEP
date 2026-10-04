-- 0035: attribution: attributed_order (orders and refunds from the shop and, when allowed, the point of sale, each credited
-- to a campaign), lookup indexes on the addresses and numbers CEP sent to, and the ORDERS integration kind for the call log.
-- Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
