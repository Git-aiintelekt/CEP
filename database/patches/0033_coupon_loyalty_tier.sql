-- 0033: cached Coupon and LoyaltyTier references for Journey's Issue Coupon and Update Loyalty Tier
-- action nodes. Same treatment as `segment`: a non-authoritative synced copy, not a coupon or loyalty
-- program engine (BRD: do not rebuild these, invoke the existing C360 services). Idempotent: re-runs
-- the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
