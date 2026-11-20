-- 0091 (2026-11-21): Receipt Layouts. A receipt layout (the receipt inside an E-Receipt: header, columns, totals, footer) becomes
-- a named record E-Receipt templates pick, in table receipt_layout (row-level security). Templates keep their own layouts until
-- someone picks a library layout, so nothing a customer receives changes when this is applied.
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0091_receipt_layouts.sql.
\ir ../CEP_Database_Schema_Platform_Operations.sql
