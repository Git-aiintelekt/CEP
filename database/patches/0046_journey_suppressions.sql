-- 0046: journey_suppression (customers one journey must never enter or message), JOURNEY as a contact_list_member
-- membership source (the Add to List step), and the journey.export / journey.suppress permissions granted to every role
-- that edits journeys. Idempotent: re-runs the platform-operations layer, same pattern as 0045.
\ir ../CEP_Database_Schema_Platform_Operations.sql
