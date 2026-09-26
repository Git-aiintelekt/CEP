-- 0022: campaign approval before a production publish (campaign.approval_* columns, the campaign.approve permission, granted to
-- every role that holds user.admin). Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
