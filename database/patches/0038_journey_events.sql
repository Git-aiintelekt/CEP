-- 0038: journey events in (journey_event.external_id, one event once), coupon_issuance (C360 fulfils journeys' coupon requests),
-- journey_version.population_frozen_at (the Fixed population lock), the EVENTS / COUPONS integration kinds, and APPROVED as a journey status
-- (Approve → Schedule for Later failed on the old status list).
-- Idempotent: re-runs the platform-operations layer.
-- Date / Time entry rules: journey_version.last_fired_at, the schedule moment that last fired.
\ir ../CEP_Database_Schema_Platform_Operations.sql
