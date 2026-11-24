-- 0099 (2026-11-25): what texts cost. campaign.cost_estimate, message_rate (SMS and MMS: cost and price per sending engine, sender type and country, from a
-- date), whatsapp_rate_card + whatsapp_rate (Meta's card per WhatsApp engine and how it is priced), the WhatsApp pricing block on
-- sms_execution, and the View Message Costs permission (cost.view, given to the roles holding user.admin). The workspace's login
-- reads the price columns only. Re-runs the Platform Operations layer, which is idempotent. Apply with
-- database/apply_patch.sh 0099_message_costs.sql BEFORE deploying the code of branch message-costs.
\ir ../CEP_Database_Schema_Platform_Operations.sql
