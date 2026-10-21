-- 0071: Report Databases take ClickHouse too (report_connection.engine 'clickhouse', read over its HTTP interface), so a report author
-- can connect one from New Report. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
