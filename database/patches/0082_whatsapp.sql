-- 0082 (2026-11-05): WhatsApp as a third phone channel, through Meta's WhatsApp Business API with the workspace's own Meta account.
-- The channel checks of templates, campaigns, consent, engines, senders, dead letters and tags take WHATSAPP; sms_execution
-- takes message_type WHATSAPP (with a header picture in media_url) and read_at; delivery_provider takes WHATSAPP_META;
-- whatsapp_template holds Meta's parts of a WhatsApp template and where Meta's review stands. Row-level security.
-- Apply with database/apply_patch.sh 0082_whatsapp.sql, which also records it.
\ir ../CEP_Database_Schema_Platform_Operations.sql
