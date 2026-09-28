-- 0024: barcode and QR code blocks. The three coupon tags the blocks read, added to every workspace (a workspace that
-- already has a tag with one of these keys keeps its own). The feature itself is a product switch
-- (platform_ops.params.FEATURES["dynamic_codes"]): off until tenant management turns it on for a workspace, and a plan
-- can switch it off with {"dynamic_codes": false} in subscription_plan.features. New workspaces get the tags at onboarding.
-- Idempotent.
INSERT INTO personalization_tag (tenant_id, tag_key, label, tag_kind, source_system, resolution_source, source_path, data_type,
                                 applies_to_channels, description, sample_value, is_active)
SELECT t.id, v.tag_key, v.label, 'CUSTOM', 'CEP', 'CAMPAIGN_LIST_MEMBER', v.source_path, 'STRING', v.channels, v.label, v.sample_value, TRUE
FROM tenant t
CROSS JOIN (VALUES
    ('coupon_code', 'Coupon Code', 'custom_value_pairs.coupon_code', ARRAY['EMAIL', 'E_RECEIPT', 'SMS', 'MMS']::text[], 'SAVE20-7K3Q'),
    ('coupon_barcode_value', 'Coupon Barcode Value', 'custom_value_pairs.coupon_barcode_value', ARRAY['EMAIL', 'E_RECEIPT']::text[], 'CPN400012345678'),
    ('coupon_qr_value', 'Coupon QR Value', 'custom_value_pairs.coupon_qr_value', ARRAY['EMAIL', 'E_RECEIPT']::text[], 'https://shop.example.com/c/SAVE20-7K3Q')
) AS v(tag_key, label, source_path, channels, sample_value)
ON CONFLICT (tenant_id, tag_key) DO NOTHING;
