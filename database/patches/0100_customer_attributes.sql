-- 0100 (2026-11-25): Customer Attributes and template tags from the list. customer_attribute_source, customer_attribute_definition,
-- customer_attribute_values (one row per customer per source system), customer_external_id, customer_attribute_sync_run; the
-- CUSTOMER_ATTRIBUTE tag source; contact_list_import.tag_values (the upload's Tag Values step) and the TAGS step of the upload queue;
-- four platform settings; and the
-- Manage Customer Attributes permission (attribute.edit, given to the roles holding user.admin). Re-runs the Platform Operations
-- layer, which is idempotent. Apply with database/apply_patch.sh 0100_customer_attributes.sql BEFORE deploying the code of branch
-- customer-attributes.
\ir ../CEP_Database_Schema_Platform_Operations.sql
