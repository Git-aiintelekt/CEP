-- 0064: Insights' Key Influencers and Decomposition Tree views can be saved: report.view_type and report_version.view_type widen to
-- VARCHAR(20) and ck_report_view_type allows all six views. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
