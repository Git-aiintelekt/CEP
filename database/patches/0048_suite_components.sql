-- 0048: the suite's components: suite_component (the registry and its release states), plan_component (what each plan
-- includes) and tenant_component (a workspace's trials, add-ons and switched-off components), with their seeds.
-- Idempotent: re-runs the platform-operations layer, same pattern as 0045 to 0047.
\ir ../CEP_Database_Schema_Platform_Operations.sql
