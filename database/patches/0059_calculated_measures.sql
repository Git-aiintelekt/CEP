-- 0059: calculated measures (apps/insights/compiler.py measure_expr): report_field.formula, and the seeded rates on the platform datasets.
-- Dashboard slicers live in dashboard.layout (JSON) and need no change. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
