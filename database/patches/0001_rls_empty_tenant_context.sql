-- Patch 0001: RLS policies treat an empty app.current_tenant (what a pooled connection has after SET LOCAL
-- expires) as 'no tenant' -> zero rows, instead of failing with `invalid input syntax for type uuid: ""`.
-- Idempotent: ALTER POLICY only replaces the expressions. Apply as cep_admin / superuser in one transaction.
BEGIN;
ALTER POLICY rls_app_user_tenant ON app_user
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_role_tenant ON role
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_customer_master_tenant ON customer_master
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_segment_tenant ON segment
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_customer_segment_membership_tenant ON customer_segment_membership
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_contact_list_tenant ON contact_list
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_contact_list_member_tenant ON contact_list_member
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_contact_list_import_tenant ON contact_list_import
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_contact_list_import_row_tenant ON contact_list_import_row
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_template_master_tenant ON template_master
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_personalization_tag_tenant ON personalization_tag
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_template_tag_tenant ON template_tag
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_receipt_presentation_model_tenant ON receipt_presentation_model
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_campaign_tenant ON campaign
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_campaign_run_tenant ON campaign_run
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_contact_list_campaign_tenant ON contact_list_campaign
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_campaign_list_tenant ON campaign_list
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_campaign_list_member_tenant ON campaign_list_member
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_campaign_target_tenant ON campaign_target
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_campaign_actual_tenant ON campaign_actual
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_tenant ON journey
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_enrollment_tenant ON journey_enrollment
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_node_execution_tenant ON journey_node_execution
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_event_tenant ON journey_event
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_generated_campaign_tenant ON journey_generated_campaign
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_generated_campaign_run_tenant ON journey_generated_campaign_run
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_communication_governance_policy_tenant ON communication_governance_policy
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_contact_point_status_tenant ON contact_point_status
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_consent_suppression_tenant ON consent_suppression
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_consent_record_tenant ON consent_record
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_governance_evaluation_log_tenant ON governance_evaluation_log
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_mailer_execution_tenant ON mailer_execution
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_sms_execution_tenant ON sms_execution
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_delivery_webhook_event_tenant ON delivery_webhook_event
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_campaign_master_analytical_tenant ON campaign_master_analytical
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_master_analytical_tenant ON journey_master_analytical
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_journey_execution_master_analytical_tenant ON journey_execution_master_analytical
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_delivery_provider_tenant ON delivery_provider
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_sender_profile_tenant ON sender_profile
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_media_asset_tenant ON media_asset
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_template_media_asset_tenant ON template_media_asset
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_dead_letter_message_tenant ON dead_letter_message
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_definition_audit_log_tenant ON definition_audit_log
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_tenant_self ON tenant
    USING (id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_tenant_database_tenant ON tenant_database
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_tenant_subscription_tenant ON tenant_subscription
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_tenant_usage_tenant ON tenant_usage
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_tenant_storage_config_tenant ON tenant_storage_config
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_domain_event_tenant ON domain_event
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_tracking_link_tenant ON tracking_link
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_tracking_event_tenant ON tracking_event
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_ml_model_tenant ON ml_model
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_party_score_tenant ON party_score
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_api_client_tenant ON api_client
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_webhook_subscription_tenant ON webhook_subscription
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
ALTER POLICY rls_outbound_webhook_delivery_tenant ON outbound_webhook_delivery
    USING (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid))
    WITH CHECK (tenant_id = CAST(NULLIF(current_setting('app.current_tenant', TRUE), '') AS uuid));
COMMIT;
