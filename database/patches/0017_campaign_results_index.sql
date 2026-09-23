-- Patch 0017: (tenant_id, campaign_id) index on mailer_execution and sms_execution, so campaign results/dashboard
-- queries (campaigns.service.metrics/timeseries) stop scanning whole partitions. The layer file is idempotent.
\ir ../CEP_Database_Schema_Platform_Operations.sql
