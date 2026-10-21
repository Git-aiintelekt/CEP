-- 0068: sending_domain, the SPF, DMARC and DKIM results of each workspace's sending domains (Settings -> Delivery -> Sending Domains)
-- and the DKIM selector a workspace gives. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
