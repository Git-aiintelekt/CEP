/** In-memory stand-in for the CEP API used by the component tests. */
import { vi } from 'vitest'

import { derived, handleCampaigns, listCampaigns, moduleDefaults } from './mockCampaigns'
import { handleWorkspaceTools, workspaceToolsState, type WorkspaceToolsState } from './mockWorkspaceTools'
import { defaultSectionsFor } from '@/features/receipt/receiptPresets'
import { RECEIPT_STARTER_MJML } from '@/features/receipt/receiptStarter'

import type { CampaignRunVariant, ApiKey, Audience, AuthOptions, Campaign, CampaignActivity, CampaignAudience, CampaignMetrics, ContactList, DeliverabilityService, DeliverabilityTest, FieldRule, FieldRules, InspectClient, Design, GovernanceLine, Integration, IntegrationLogDetail, ListImport, ListMember, UploadSummary, DeliveryProvider, DeliverySender, Invoice, MailServerSettings, Me, MediaAsset, Message, PersonalizationTag, ProviderType, ReceiptLayout, Role, RunResults,
              RunRecipient, SecuritySettings, SenderProfile, SettingsUser, SmsReply, SupportAccess, Template, TemplateStarter, Usage, Workspace } from '@/lib/types'

export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

const audit = { tenant: 't1', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', row_version: 1 }

export const me = {
  principal: { kind: 'user', id: 'u1', email: 'aby.john@aiintelekt.com', display_name: 'Aby John', is_platform_admin: false,
               permissions: ['campaign.view', 'campaign.edit', 'campaign.publish', 'template.edit', 'provider.edit', 'user.admin', 'list.view', 'list.edit', 'list.import', 'report.view', 'consent.edit'] },
  tenant: { id: 't1', code: 'NWA', timezone: 'America/New_York', db_alias: 'default', db_status: 'ACTIVE' },
  session: { idle_timeout_minutes: 120, idle_warning_seconds: 60 },
}

export const templates: Template[] = [
  { ...audit, id: 'tpl-email', name: 'Fall Email', description: null, channel: 'EMAIL', status: 'ACTIVE', cloned_from: null, last_used_in: { id: 'c1', name: 'Fall Launch', status: 'ACTIVE', at: '2026-09-10T10:00:00Z' }, campaign_count: 2 },
  { ...audit, id: 'tpl-sms', name: 'Fall SMS', description: null, channel: 'SMS', status: 'ACTIVE', cloned_from: null },
  { ...audit, id: 'tpl-old', name: 'Retired Email', description: null, channel: 'EMAIL', status: 'ARCHIVED', cloned_from: null },
  { ...audit, id: 'tpl-receipt', name: 'Northline order receipt', description: null, channel: 'E_RECEIPT', status: 'ACTIVE', cloned_from: null },
]

export const senders: SenderProfile[] = [
  { id: 'snd-email', display_name: 'Northwind Rewards', channel: 'EMAIL', from_address: 'rewards@northwind.example', reply_to_address: null, sender_id: null, verification_status: 'VERIFIED', is_default: true },
  { id: 'snd-sms', display_name: 'Northwind SMS', channel: 'SMS', from_address: null, reply_to_address: null, sender_id: '55512', verification_status: 'PENDING', is_default: true },
  { id: 'snd-smtp', display_name: 'Northwind', channel: 'EMAIL', from_address: 'hello@nwa.example', reply_to_address: null, sender_id: null, verification_status: 'VERIFIED', is_default: false, provider_type: 'SMTP', provider_name: 'Workspace mail server' },
]

const list = (id: string, name: string, member_count: number, is_master = false, extra: Partial<ContactList> = {}): ContactList => ({
  ...audit, id, name, description: null, source_type: 'UPLOAD', source_label: 'Upload', vetted: false, list_kind: 'STATIC', is_master, refresh_mode: 'MANUAL',
  last_refreshed_at: null, list_environment: 'PRODUCTION', status: 'ACTIVE', member_count, parent_contact_list: null, attached_campaigns: 0, live_campaigns: 0, ...extra,
})
export const contactLists: ContactList[] = [
  list('cl-master', 'Fall Master Audience', 90, true, { description: 'Active loyalty members', attached_campaigns: 2, live_campaigns: 1 }),
  list('cl-ga', 'Georgia only', 30, false, { source_type: 'BI', source_label: 'BI / Extraction', vetted: true, list_kind: 'SEGMENT', list_environment: 'TEST' }),
]
export const audiences: Audience[] = [
  { id: 'aud-gold', code: 'LOYALTY_GOLD_PLUS', name: 'Loyalty Gold & Platinum', description: null, source_system: 'C360', synced_at: '2026-09-20T05:00:00Z', member_count: 43, list_count: 1 },
  { id: 'aud-lapsed', code: 'LAPSED_90', name: 'No purchase in 90 days', description: 'Win-back base', source_system: 'C360', synced_at: '2026-09-20T05:00:00Z', member_count: 70, list_count: 0 },
]
export const listMembers: ListMember[] = [
  { id: 11, party_id: 'P-1', email: 'd.alvarez@northwind.example', first_name: 'Dolores', last_name: 'Alvarez', mobile: null, added_at: '2026-08-27T10:00:00Z', source: 'UPLOAD', known: true, email_status: 'MARKETABLE', email_status_label: 'Can receive marketing email', sendable: true },
  { id: 12, party_id: 'P-2', email: 'm.okonkwo@fabrikam.example', first_name: 'Miriam', last_name: 'Okonkwo', mobile: '+14045550002', added_at: '2026-08-27T10:00:00Z', source: 'UPLOAD', known: true, email_status: 'MARKETABLE', email_status_label: 'Can receive marketing email', sendable: true },
  { id: 13, party_id: 'P-3', email: 's.ramachandran@tailspin.example', first_name: 'Sana', last_name: 'Ramachandran', mobile: null, added_at: '2026-08-24T10:00:00Z', source: 'MANUAL', known: true, email_status: 'UNSUBSCRIBED', email_status_label: 'Unsubscribed', sendable: false },
]
const PROPERTIES = [
  { key: 'email', label: 'Email', required: true, help: 'Who the person is.' }, { key: 'first_name', label: 'First name', required: false, help: '' },
  { key: 'last_name', label: 'Last name', required: false, help: '' }, { key: 'consent_date', label: 'Consent date', required: false, help: 'Recorded as an email opt-in.' },
]
const REVIEW = { ready: 4, held_back: 2, new: 3, existing: 1, warnings: 1, errors: 2, duplicates: 1, rejected: 1 }
const GOVERNANCE: GovernanceLine[] = [
  { code: 'MARKETABLE', label: 'Can receive marketing email', sendable: true, count: 2 }, { code: 'UNSUBSCRIBED', label: 'Unsubscribed', sendable: false, count: 1 },
  { code: 'HARD_BOUNCE', label: 'Bounced: the address does not exist', sendable: false, count: 1 }, { code: 'SOFT_BOUNCE', label: 'Bounced repeatedly', sendable: false, count: 0 },
  { code: 'COMPLAINT', label: 'Marked a message as spam', sendable: false, count: 0 }, { code: 'BLOCKED', label: 'Blocked address', sendable: false, count: 0 },
  { code: 'INVALID_ADDRESS', label: 'Invalid address', sendable: false, count: 0 }, { code: 'SUPPRESSED', label: 'Suppressed', sendable: false, count: 0 },
  { code: 'NO_CONSENT', label: 'No consent on record', sendable: false, count: 0 },
]
/** 6 rows = 2 held back + 4 ready; 4 = 2 marketable + 1 unsubscribed + 1 hard bounce; after the import 4 = 3 added + 1 already in the list */
export const uploadSummary: UploadSummary = {
  rows: 6, held_back: { total: 2, reasons: [{ code: 'NO_EMAIL', label: 'No email address', count: 0 }, { code: 'INVALID_EMAIL', label: 'Not a valid email address', count: 1 },
                                            { code: 'DUPLICATE_IN_FILE', label: 'Same address earlier in the file', count: 1 }] },
  ready: { total: 4, new: 3, existing: 1 }, governance: { sendable: 2, not_sendable: 2, statuses: GOVERNANCE }, mobile: null, result: null, balanced: true,
}
/** as POST .../imports/ answers: stored and queued, nothing read yet. The mock "worker" moves it on at the next poll. */
export const stagedImport: ListImport = {
  id: 'imp-1', contact_list: 'cl-new', list_name: 'Trade show leads', list_status: 'DRAFT', file_name: 'leads.csv', file_size: 2048, status: 'UPLOADED', phase: 'Waiting to be read',
  working: true, progress: { done: 0, total: 2048, percent: 0, unit: 'bytes' }, mapping_confirmed: false, error: null, created_at: '2026-09-21T10:00:00Z', completed_at: null,
  created_by_name: 'Aby John', row_count: 0, applied_count: 0, review: null, properties: PROPERTIES,
  columns: [{ name: 'Email Address', samples: ['a@x.example'], guess: 'email' }, { name: 'First Name', samples: ['Ana'], guess: 'first_name' }, { name: 'Notes', samples: ['vip'], guess: null }],
  mapping: { email: 'Email Address', first_name: 'First Name' },
}

const tag = (tag_key: string, label: string, tag_kind: string, sample_value: string): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind, data_type: 'STRING', applies_to_channels: ['EMAIL', 'SMS', 'MMS'], description: null, sample_value,
  default_value: null, static_value: null, is_active: true, resolution_source: tag_kind === 'CUSTOM' ? 'CAMPAIGN_LIST_MEMBER' : 'CUSTOMER_MASTER',
  source_path: tag_kind === 'CUSTOM' ? `custom_value_pairs.${tag_key}` : tag_key, platform_tag_id: tag_kind === 'STANDARD' ? `platform-${tag_key}` : null, row_version: 1,
})
export const tags: PersonalizationTag[] = [tag('first_name', 'First name', 'STANDARD', 'Jordan'), tag('offer_code', 'Offer code', 'CUSTOM', 'FALL017')]
/** GET /deliverability/clients/: a cut of Mailgun Inspect's client list */
export const inspectClients: InspectClient[] = [
  { id: 'outlook365', client: 'Outlook 365', os: 'Windows', category: 'Application', browser: '', default: true, image_blocking: true },
  { id: 'applemail', client: 'Apple Mail', os: 'macOS 14', category: 'Application', browser: '', default: true, image_blocking: false },
  { id: 'iphone15', client: 'iPhone 15 (iOS 17)', os: 'iOS 17', category: 'Mobile', browser: '', default: true, image_blocking: false },
  { id: 'gmail_android', client: 'Gmail app', os: 'Android 14', category: 'Mobile', browser: '', default: false, image_blocking: true },
  { id: 'gmail_chr_win', client: 'Gmail', os: 'Windows', category: 'Web', browser: 'Chrome', default: true, image_blocking: true },
]

const preview = (client: InspectClient, status: DeliverabilityTest['status'] = 'COMPLETE') => ({
  id: client.id, name: client.client, client: client.client, os: client.os, category: client.category, browser: client.browser, status, detail: status === 'FAILED' ? 'The client did not load the message.' : '',
  screenshot: status === 'COMPLETE' ? `https://shots.example/${client.id}.png` : '', screenshot_no_images: '', thumbnail: status === 'COMPLETE' ? `https://shots.example/${client.id}_t.png` : '', full_thumbnail: '',
})

/** one finished inbox-preview test of the Fall Email, v2 */
export const finishedDeliverabilityTest: DeliverabilityTest = {
  id: 'dt-1', template: 'tpl-email', template_version: 2, kind: 'PREVIEW', provider: 'MAILGUN_INSPECT', status: 'COMPLETE', subject: 'Aaliyah, 20% off this weekend only',
  clients: inspectClients.map((c) => c.id), summary: { clients: 5, complete: 4, failed: 1, processing: 0 }, error: null, requested_by: 'Aby John',
  requested_at: '2026-09-30T14:12:00Z', completed_at: '2026-09-30T14:15:00Z', previews: inspectClients.map((c, i) => preview(c, i === 3 ? 'FAILED' : 'COMPLETE')), spam: null, placement: null,
}

/** GET /field-rules/: the lengths the forms count against, as the tables set them */
const text = (max: number | null, required = false): FieldRule => ({ type: 'string', required, max, min: null, blank: !required })
export const fieldRules: FieldRules = {
  generated_at: '2026-10-02T00:00:00Z',
  resources: {
    campaign: { name: text(200, true), code: text(40), description: text(null), subject_line: text(300), preheader: text(300),
                targets: { type: 'object', required: false, fields: { notes: text(1000) } },
                drip_config: { type: 'json', required: false } },
    template: { name: text(200, true), description: text(null) },
    personalization_tag: { tag_key: text(100, true), label: text(150, true), static_value: text(null) },
    contact_list: { name: text(200, true), description: text(null) },
    new_contact_list: { name: text(200, true), description: text(null) },
  },
}

/** GET /personalization-tags/data-points/: a cut of the catalogue the Tags page's form reads */
export const tagDataPoints = {
  sources: [
    { key: 'CUSTOMER_MASTER', label: 'Customer', points: [{ path: 'first_name', label: 'First name', data_type: 'STRING', prefix: false }, { path: 'custom_attributes.', label: 'A customer attribute', data_type: 'STRING', prefix: true }] },
    { key: 'TRANSACTION', label: 'Transaction (e-receipts from the point of sale)', points: [{ path: 'id', label: 'Transaction ID', data_type: 'STRING', prefix: false }, { path: 'grand_total', label: 'Total', data_type: 'NUMBER', prefix: false }] },
    { key: 'STORE', label: 'Store (e-receipts)', points: [{ path: 'name', label: 'Store Name', data_type: 'STRING', prefix: false }] },
  ],
  static: { key: 'STATIC', label: 'Static value' },
}
/** every tag the marketing presets use, with the sample values the SMS lengths are counted with */
export const presetTags: PersonalizationTag[] = [...tags, tag('discount_pct', 'Discount %', 'CUSTOM', '20'), tag('shop_url', 'Shop URL', 'SYSTEM', 'https://shop.example.com'),
  tag('unsubscribe_url', 'Unsubscribe URL', 'SYSTEM', 'https://example.com/unsubscribe'), tag('loyalty_points', 'Loyalty points', 'STANDARD', '1,250'),
  tag('loyalty_tier', 'Loyalty tier', 'STANDARD', 'Gold')]

export const mediaLibrary: MediaAsset[] = [
  { id: 'img-1', file_name: 'lookbook.jpg', mime_type: 'image/jpeg', byte_size: 180_000, width_px: 600, height_px: 400, url: 'http://cdn.test/lookbook.jpg', created_at: '2026-09-01T10:00:00Z' },
  { id: 'img-webp', file_name: 'modern.webp', mime_type: 'image/webp', byte_size: 90_000, width_px: 600, height_px: 400, url: 'http://cdn.test/modern.webp', created_at: '2026-09-01T10:00:00Z' },
]

export const roles: Role[] = [
  { id: 'role-admin', name: 'Marketing Admin', description: 'Everything', permissions: ['campaign.edit', 'user.admin'], user_count: 1, row_version: 1 },
  { id: 'role-analyst', name: 'Analyst', description: 'Read only', permissions: ['campaign.view'], user_count: 0, row_version: 1 },
]
export const permissionCatalogue = [
  { code: 'campaign.view', description: 'Campaign view' }, { code: 'campaign.edit', description: 'Campaign edit' },
  { code: 'template.edit', description: 'Template edit' }, { code: 'user.admin', description: 'User admin' },
]
const settingsUser = (overrides: Partial<SettingsUser>): SettingsUser => ({
  id: 'u1', email: 'aby.john@aiintelekt.com', display_name: 'Aby John', is_active: true, auth_provider: 'LOCAL', mfa_enabled: false,
  last_login: '2026-09-17T10:00:00Z', created_at: '2026-09-01T10:00:00Z', roles: ['role-admin'], role_names: ['Marketing Admin'], has_password: true, is_self: true, ...overrides,
})
export const settingsUsers: SettingsUser[] = [
  settingsUser({}),
  settingsUser({ id: 'u2', email: 'devon@example.com', display_name: 'Devon Okafor', roles: ['role-analyst'], role_names: ['Analyst'], has_password: false, is_self: false, last_login: null }),
]
export const integrations: Integration[] = [
  { id: 'int-pos', kind: 'POS_RECEIPTS', name: 'POS receipts', direction: 'IN', system: 'POS', status: 'ACTIVE', environment: null, delivery_provider_id: null, throttle_per_minute: null, throttle_burst: null,
    effective_limit_per_minute: 600, log_level: 'FULL', log_retention_days: 90, last_call_at: '2026-09-25T09:58:00Z', last_outcome: 'OK', last_error: null, breaker_failures: 5, breaker_cooldown_seconds: 60,
    breaker_open_seconds: 0, calls_24h: 1240, ok_24h: 1231, rejected_24h: 6, retried_24h: 0, errors_24h: 0, throttled_24h: 3, error_rate_24h: 0, p95_ms: 212, max_ms: 890, bytes_in_24h: 2_400_000, bytes_out_24h: 180_000, health: 'healthy' },
  { id: 'int-postal', kind: 'PROVIDER', name: 'Postal (self-hosted)', direction: 'OUT', system: 'POSTAL', status: 'ACTIVE', environment: null, delivery_provider_id: 'prov-postal', throttle_per_minute: 600, throttle_burst: null,
    log_level: 'FULL', log_retention_days: 90, last_call_at: '2026-09-25T09:57:30Z', last_outcome: 'RETRY', last_error: 'Postal answered 503', breaker_failures: 5, breaker_cooldown_seconds: 60,
    breaker_open_seconds: 42, calls_24h: 8_120, ok_24h: 7_600, rejected_24h: 0, retried_24h: 520, errors_24h: 0, throttled_24h: 0, error_rate_24h: 6.4, p95_ms: 640, max_ms: 5_000, bytes_in_24h: 900_000, bytes_out_24h: 41_000_000, health: 'circuit_open' },
]
export const integrationLog: IntegrationLogDetail[] = [
  { id: 50, integration_id: 'int-postal', direction: 'IN', kind: 'PROVIDER', system: 'POSTAL', correlation_id: 'hook-0007', related_ref: 'mailer_execution:7', method: 'POST', url: '/api/v1/webhooks/delivery/NWA/prov-postal/***/', response_status: 200, outcome: 'ERROR',
    error_class: null, error_message: '1 events could not be applied', attempt: 1, duration_ms: 96, request_bytes: 610, response_bytes: 90, api_client_id: null, started_at: '2026-09-25T09:59:00Z',
    request_headers: { 'Content-Type': 'application/json' }, request_body: '{"event": "MessageLoaded", "uuid": "evt-7", "payload": {"message": {"id": 7, "message_id": "m7@postal.example"}}}',
    response_headers: {}, response_body: '{"received": 1, "applied": 0, "failed": 1}', worker: 'web-1' },
  { id: 52, integration_id: 'int-pos', direction: 'IN', kind: 'POS_RECEIPTS', system: 'POS', correlation_id: 'pos-corr-0001', related_ref: 'receipt:R-1001', method: 'POST', url: '/api/v1/receipts/send/', response_status: 201, outcome: 'OK',
    error_class: null, error_message: null, attempt: 1, duration_ms: 184, request_bytes: 212, response_bytes: 83, api_client_id: 'key-1', started_at: '2026-09-25T09:58:00Z',
    request_headers: { 'Content-Type': 'application/json', Authorization: '***' }, request_body: '{"campaign": "RCPT", "to": "buyer@x.test", "receipt": {"number": "R-1001", "card_number": "***"}}',
    response_headers: { 'X-RateLimit-Limit': '600' }, response_body: '{"status": "SUBMITTED", "execution_id": 7}', worker: 'web-1' },
  { id: 51, integration_id: 'int-postal', direction: 'OUT', kind: 'PROVIDER', system: 'POSTAL', correlation_id: 'pos-corr-0001', related_ref: 'receipt:R-1001', method: 'POST', url: 'https://postal.example/api/v1/send/message', response_status: 503, outcome: 'RETRY',
    error_class: null, error_message: 'Postal answered 503', attempt: 1, duration_ms: 1_204, request_bytes: 4_100, response_bytes: 40, api_client_id: null, started_at: '2026-09-25T09:57:30Z',
    request_headers: { 'X-Server-API-Key': '***' }, request_body: '{"to": ["buyer@x.test"], "subject": "Your receipt"}', response_headers: {}, response_body: '{"status": "error"}', worker: 'worker-1' },
]

export const apiKeys: ApiKey[] = [
  { id: 'key-1', name: 'POS integration', client_type: 'INTEGRATION', key_prefix: 'cep_in_AbC123', scopes: ['events:ingest'], allowed_ip_cidrs: ['203.0.113.0/24'], rate_limit_per_minute: 600,
    expires_at: null, revoked_at: null, last_used_at: null, created_at: '2026-09-01T10:00:00Z', status: 'ACTIVE' },
]
export const workspace: Workspace = { name: 'Northwind Apparel', code: 'NWA', timezone: 'America/New_York', status: 'ACTIVE', subdomain: 'northwind', region: 'us-east-1',
                                      plan: 'Growth', max_users: 50, active_users: 2, roles: 2, active_api_keys: 1 }

export const usage: Usage = {
  month: '2026-09-01', can_send: true, plan: { code: 'GROWTH', name: 'Growth', monthly_price: 499, currency: 'USD', status: 'ACTIVE' },
  breakdown: { Email: 8_200_000, SMS: 300_000, MMS: 0 },
  meters: [
    { label: 'Messages this month', used: 8_500_000, limit: 10_000_000, percent: 85, state: 'warning', unit: '', overage: true, overage_price_per_1k: 0.9 },
    { label: 'Contacts', used: 120_000, limit: 2_000_000, percent: 6, state: 'ok', unit: '', overage: true, overage_price_per_1k: 4 },
    { label: 'Active users', used: 2, limit: 50, percent: 4, state: 'ok', unit: '', overage: false, overage_price_per_1k: null },
    { label: 'Storage', used: 1.5, limit: null, percent: null, state: 'ok', unit: 'GB', overage: false, overage_price_per_1k: null },
  ],
}
export const invoices: Invoice[] = [
  { id: 'inv-1', invoice_number: 'INV-NWA-202608', period_month: '2026-08-01', plan_code: 'GROWTH', currency: 'USD', base_amount: '499.00', overage_amount: '2.70', total_amount: '501.70',
    line_items: [], status: 'ISSUED', issued_at: '2026-09-01T06:00:00Z', due_at: '2026-09-15T06:00:00Z', paid_at: null },
]
export const security: SecuritySettings = { require_mfa: false, sso_available: true, redirect_uri: 'http://localhost:8000/api/v1/auth/sso/callback/', identity_provider: null }
export const supportAccess: SupportAccess[] = [
  { id: 'sup-1', staff: 'Pat Support', as_user: 'Devon Okafor', as_email: 'devon@example.com', reason: 'Ticket 4821: cannot find a campaign', mode: 'READ',
    started_at: '2026-09-10T10:00:00Z', expires_at: '2026-09-10T10:30:00Z', ended_at: '2026-09-10T10:12:00Z', writes: 0 },
]

export const providerCatalogue: ProviderType[] = [
  { provider_type: 'POSTAL', label: 'Postal', description: 'Self-hosted Postal server.', supports_webhooks: true, manageable: true, channel: 'EMAIL', fields: [
    { key: 'endpoint', label: 'Postal address', required: true, secret: false, help: 'Base address of your Postal installation.', placeholder: 'https://postal.example.com', kind: 'url' },
    { key: 'api_key', label: 'Server API key', required: true, secret: true, help: 'Credentials -> type API.', placeholder: '', kind: 'text', credential: 'secret' },
    { key: 'transactional_api_key', label: 'Transactional server API key', required: false, secret: true, help: 'Optional. A second Postal mail server for receipts.', placeholder: '', kind: 'text', credential: 'transactional_secret' }] },
  { provider_type: 'SENDGRID', label: 'SendGrid', description: 'Twilio SendGrid.', supports_webhooks: true, manageable: true, channel: 'EMAIL', fields: [
    { key: 'api_key', label: 'API key', required: true, secret: true, help: 'Needs the Mail Send permission.', placeholder: '', kind: 'text', credential: 'secret' },
    { key: 'api_base', label: 'API address', required: false, secret: false, help: 'Leave empty for the global region.', placeholder: 'https://api.sendgrid.com', kind: 'url' }] },
  { provider_type: 'SMTP', label: 'SMTP (your mail server)', description: 'Follows Settings -> Email server.', supports_webhooks: false, manageable: false, channel: 'EMAIL', fields: [] },
  { provider_type: 'SANDBOX_SMS', label: 'Sandbox (sends nothing)', description: 'Accepts SMS and MMS without sending them.', supports_webhooks: true, manageable: true, channel: 'SMS', supports_mms: true, fields: [
    { key: 'reject_numbers', label: 'Numbers to refuse', required: false, secret: false, help: 'Comma-separated.', placeholder: '', kind: 'text' }] },
]
export const deliveryProviders: DeliveryProvider[] = [
  { id: 'prov-postal', provider_type: 'POSTAL', channel: 'EMAIL', name: 'Postal (self-hosted)', config: { endpoint: 'https://postal.cep.example.com' }, has_secret: true, has_transactional_secret: false, secret_ref: null,
    rate_limit_per_minute: null, is_default: true, is_active: true, webhook_url: 'http://localhost:8000/api/v1/webhooks/delivery/NWA/prov-postal/tok/', sender_count: 1,
    last_checked_at: null, last_check_ok: null, last_check_error: null, row_version: 1 },
]
export const textEngine: DeliveryProvider = { id: 'prov-texts', provider_type: 'SANDBOX_SMS', channel: 'SMS', name: 'Sandbox texts', config: {}, has_secret: false, secret_ref: null,
  rate_limit_per_minute: null, is_default: true, is_active: true, webhook_url: 'http://localhost:8000/api/v1/webhooks/delivery/NWA/prov-texts/tok/', sender_count: 1,
  last_checked_at: null, last_check_ok: null, last_check_error: null, row_version: 1 }
export const textSender: DeliverySender = { id: 'snd-texts', delivery_provider: 'prov-texts', display_name: 'Northwind texts', channel: 'SMS', from_address: null, reply_to_address: null, sender_id: '55123',
  verification_status: 'PENDING', is_default: true, provider_type: 'SANDBOX_SMS', provider_name: 'Sandbox texts' }
export const textResults: RunResults = {
  id: 'r1', status: 'COMPLETED', family: 'SMS', started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:01:00Z',
  audience: { members: 40, eligible: 31, suppressed: { NO_CONSENT: 5, BLOCKED_NUMBER: 3, INVALID_NUMBER: 1 } },
  messages: { queued: 0, sent: 30, failed: 1, delivered: 28, opened: 0, clicked: 0, bounced: 0, complained: 0, replied: 4, opted_out: 2, parts: 37 }, by_status: {},
}
export const smsReplies: SmsReply[] = [
  { id: 2, from_number: '+14045550002', to_number: '55123', body: 'Do you have it in blue?', keyword: null, action: 'NONE', party_id: 'P-2', name: 'Luis Brown', campaign: 'c1', received_at: '2026-09-18T10:20:00Z' },
  { id: 1, from_number: '+14045550001', to_number: '55123', body: 'STOP', keyword: 'STOP', action: 'OPT_OUT', party_id: 'P-1', name: 'Brianna Garcia', campaign: 'c1', received_at: '2026-09-18T10:05:00Z' },
]

export const deliverySenders: DeliverySender[] = [
  { id: 'snd-email', delivery_provider: 'prov-postal', display_name: 'Northwind Rewards', channel: 'EMAIL', from_address: 'rewards@northwind.example', reply_to_address: null, sender_id: null,
    verification_status: 'PENDING', is_default: true, provider_type: 'POSTAL', provider_name: 'Postal (self-hosted)' },
]
const recipient = (overrides: Partial<RunRecipient>): RunRecipient => ({
  id: 1, party_id: 'P-100001', address: 'brianna.garcia@example.com', status: 'OPENED', status_reason: null, provider_message_id: 'postal-7205256a6e7d', attempts: 1, variant_key: null, bounce_type: null,
  created_at: '2026-09-18T10:00:00Z', submitted_at: '2026-09-18T10:00:20Z', delivered_at: '2026-09-18T10:01:30Z', opened_at: '2026-09-18T12:00:00Z', clicked_at: null, bounced_at: null, complained_at: null,
  failed_at: null, send_after: null, first_name: 'Brianna', last_name: 'Garcia', ...overrides,
})
export const runRecipients: RunRecipient[] = [
  recipient({}),
  recipient({ id: 2, party_id: 'P-100002', address: 'devon.okafor@example.com', status: 'BOUNCED', status_reason: '550 5.1.1 The email account does not exist', bounce_type: 'HARD', provider_message_id: 'postal-91aa0c2b3f10',
              delivered_at: null, opened_at: null, bounced_at: '2026-09-18T10:01:40Z', first_name: 'Devon', last_name: 'Okafor' }),
  recipient({ id: 3, party_id: 'P-100003', address: 'maria.chen@example.com', status: 'FAILED', status_reason: 'ValidationError: the to address is not valid', provider_message_id: null, delivered_at: null, opened_at: null,
              first_name: 'Maria', last_name: 'Chen' }),
  recipient({ id: 4, party_id: 'P-100004', address: 'sam.lee@example.com', status: 'SUBMITTED', delivered_at: null, opened_at: null, provider_message_id: 'postal-0ffe1a77bd02', first_name: 'Sam', last_name: 'Lee' }),
]

export const runResults: RunResults = {
  id: 'r1', status: 'COMPLETED', started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z',
  audience: { members: 90, eligible: 72, suppressed: { NO_CONSENT: 11, UNSUBSCRIBED: 4, BLOCKED_ADDRESS: 2, FREQUENCY_CAP: 1 } },
  messages: { queued: 0, sent: 71, failed: 1, delivered: 68, opened: 30, clicked: 9, bounced: 2, complained: 0 }, by_status: {},
}

export const starters: TemplateStarter[] = [
  { key: 'promotion', name: 'Sale announcement', channel: 'EMAIL', category: 'Promotion', description: 'A time-limited offer.', subject_line: '{{first_name}}, a sale',
    preheader: '', html_content: '<html><body><p>Hi {{first_name}}</p></body></html>', sms_body: null },
  { key: 'newsletter', name: 'Monthly newsletter', channel: 'EMAIL', category: 'Newsletter', description: 'News and updates.', subject_line: 'This month',
    preheader: '', html_content: '<html><body><p>News for {{first_name}}</p></body></html>', sms_body: null },
  { key: 'sms_promotion', name: 'SMS offer', channel: 'SMS', category: 'Promotion', description: 'One-part text.', subject_line: '', preheader: '', html_content: null,
    sms_body: 'Hi {{first_name}}, code {{offer_code}}. Reply STOP to opt out.' },
  // uses a tag the workspace does not have, so the landing page does not offer it as a preset
  { key: 'points_update', name: 'Points balance update', channel: 'EMAIL', category: 'Loyalty', description: 'Monthly points summary.', subject_line: 'Your points',
    preheader: '', html_content: '<html><body><p>You have {{ points_balance }} points</p></body></html>', sms_body: null },
]

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    template: 'tpl-sms', channel: 'SMS', version_number: 1, latest_version: 1, sms_body: 'Northwind: Hi {{first_name}}. Reply STOP to opt out.', subject_line: '',
    media_asset: null, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor',
    findings: { encoding: 'GSM-7', units: 45, segments: 1, per_segment: 160, non_gsm_characters: [], estimated: true, tags_used: ['first_name'], unknown_tags: [],
                wrong_channel_tags: [], missing_opt_out: false, long_message: false, has_link: false, missing_media: false, media_bytes: null, media_heavy: false },
    ...overrides,
  }
}

export function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    template: 'tpl-receipt', version_number: 1, latest_version: 1, editor_state: null, mjml_source: RECEIPT_STARTER_MJML, html_content: null,
    text_content: null, subject_line: 'Your Northline receipt', preheader: '', saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor',
    ...overrides,
  }
}

export function makeReceiptLayout(overrides: Partial<ReceiptLayout> = {}): ReceiptLayout {
  return {
    template: 'tpl-receipt', version_number: 1, latest_version: 1, layout_preset: 'STANDARD',
    sections: defaultSectionsFor('STANDARD'),
    custom_html: null, custom_css: null, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor',
    ...overrides,
  }
}

export function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  const made = { ...campaignBase(), ...overrides }
  return { ...made, ...derived(made), ...(overrides.actions ? { actions: overrides.actions } : {}) }
}

function campaignBase(): Omit<Campaign, 'display_status' | 'display_status_label' | 'actions' | 'next_run_at' | 'setup_complete'> {
  return {
    ...audit, ...moduleDefaults, id: 'c1', code: 'CMP-2026-0001', name: 'Fall Launch', description: 'Seasonal launch', campaign_type: 'REGULAR_MARKETING',
    channel: 'EMAIL', status: 'DRAFT', status_label: 'Draft', solicitation_type: 'MARKETING', is_journey_generated: false, scheduled_at: null,
    template: 'tpl-email', sender_profile: 'snd-email', origin_journey: null, owner_user: 'u1', template_name: 'Fall Email',
    sender_profile_name: 'Northwind Rewards', contact_lists: ['cl-master'],
    contact_list_details: [{ id: 'cl-master', name: 'Fall Master Audience', list_kind: 'STATIC', is_master: true, list_environment: 'PRODUCTION', status: 'ACTIVE', member_count: 90 }],
    runs: [], subject_line: null, preheader: null, topic: null, topic_name: null,
  }
}

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface MockOptions {
  /** Settings -> Delivery -> Deliverability Testing: the account as stored; default: none */
  deliverabilityService?: Partial<DeliverabilityService>
  /** the template's past tests, newest first */
  deliverabilityTests?: DeliverabilityTest[]
  /** the plan's monthly allowance; null = unlimited */
  deliverabilityLimit?: number | null
  campaign?: Campaign
  /** the workspace's campaigns (GET /campaigns/); default: the one campaign above */
  campaigns?: Campaign[]
  /** the tags GET /campaigns/form-options/ offers; default Fall and VIP */
  campaignTags?: string[]
  /** merged over the default GET /campaigns/{id}/audience/ answer */
  audience?: Partial<CampaignAudience>
  /** GET /campaigns/{id}/audience/export/ fails with a 503 */
  audienceExportFails?: boolean
  /** merged over the campaign results (GET /campaigns/{id}/metrics/) */
  metrics?: Partial<CampaignMetrics>
  /** GET /campaigns/{id}/activity/ answers these instead of the default two entries */
  activity?: CampaignActivity[]
  /** the workspace's contact lists (default: Fall Master Audience and Georgia only) */
  lists?: ContactList[]
  /** merged over GET /campaigns/audience-estimate/ */
  estimate?: Partial<CampaignAudience>
  /** GET /campaigns/{id}/activity/ fails with a 503 */
  activityFails?: boolean
  /** answer for POST /campaigns/ and PATCH /campaigns/{id}/ ; default echoes a saved campaign */
  onSave?: (call: Call) => Response | null
  /** answer for POST /templates/ ; default echoes a created draft */
  onSaveTemplate?: (call: Call) => Response | null
  /** what GET /templates/{id}/ and /message/ answer */
  template?: Template
  message?: Message
  /** answer for POST /templates/{id}/message/ ; default echoes version n+1 */
  onSaveMessage?: (call: Call) => Response | null
  /** the workspace's tag catalogue (GET /personalization-tags/); default: first_name and offer_code */
  tags?: PersonalizationTag[]
  /** what GET /templates/{id}/design/ answers */
  design?: Design
  /** answer for POST /templates/{id}/design/ ; default echoes version n+1 */
  onSaveDesign?: (call: Call) => Response | null
  /** what GET /templates/{id}/receipt/ answers */
  receiptLayout?: ReceiptLayout
  /** answer for POST /templates/{id}/receipt/ ; default echoes version n+1 */
  onSaveReceiptLayout?: (call: Call) => Response | null
  /** answer for writes under /users/, /roles/, /api-clients/ and /auth/set-password/ ; default echoes success */
  onSettingsWrite?: (call: Call) => Response | null
  /** merged over the default GET /me/ answer: features, support_session, mfa_setup_required ... */
  me?: Partial<Me>
  /** answer for POST /auth/forgot-password/ ; default: 404, as the unbuilt endpoint really answers */
  onForgotPassword?: (call: Call) => Response | null
  /** GET /auth/options/ ; default: no single sign-on */
  authOptions?: Partial<AuthOptions>
  /** GET /auth/mfa/ starts from this */
  mfaEnabled?: boolean
  /** answer for PUT /workspace/security/ ; default merges the body into the stored settings */
  onSecurityWrite?: (call: Call) => Response | null
  /** GET /workspace/mail-server/ starts from this */
  mailServer?: Partial<MailServerSettings>
  /** POST /delivery-providers/{id}/check/ answers a failure */
  providerCheckFails?: boolean
  /** the Postal engine holds a second key for receipts */
  providerHasTransactionalKey?: boolean
  /** the workspace also has a text engine and sender; run results and replies are those of a text campaign */
  texts?: boolean
  /** answer for POST /contact-lists/{id}/imports/ ; default: a six-row file, stored and queued */
  onListUpload?: (call: Call) => Response | null
  /** how long the background worker takes to import (default: done at the next poll) */
  listImportMs?: number
  /** the background worker refuses the file when it reads it */
  listUploadFails?: boolean
  /** uploads the workspace already has (GET /contact-lists/imports/) */
  listUploads?: ListImport[]
  /** a production run's subject line test, for the campaign page's runs */
  runVariants?: CampaignRunVariant[]
  /** reports schedule, suppressions, notifications and approvals as the backend would hold them */
  workspaceTools?: Partial<WorkspaceToolsState>
}

/** the code the mock authenticator "shows" */
export const MFA_CODE = '123456'

/** Installs a fetch mock; returns the recorded calls. Call signIn() to start authenticated. */
export function installMockApi(options: MockOptions = {}) {
  const calls: Call[] = []
  const campaign = options.campaign ?? makeCampaign()
  let mfaEnabled = options.mfaEnabled ?? false
  const campaignState = { variants: options.runVariants, campaigns: options.campaigns ?? [campaign], tags: options.campaignTags, make: makeCampaign, audience: options.audience, audienceExportFails: options.audienceExportFails, metrics: options.metrics, activity: options.activity, activityFails: options.activityFails, estimate: options.estimate }
  let listsNow: ContactList[] = [...(options.lists ?? contactLists)]
  let templatesNow: Template[] = [...templates]
  let membersNow: ListMember[] = [...listMembers]
  let jobsNow: ListImport[] = [...(options.listUploads ?? [])]
  const importDoneAt = new Map<string, number>()
  let securityNow: SecuritySettings = { ...security }
  let mailNow: MailServerSettings = { server: null, in_use: 'console', sender_profile: null, ...options.mailServer }
  const toolsState = workspaceToolsState(options.workspaceTools)
  const tagRows: PersonalizationTag[] = (options.tags ?? tags).map((item) => ({ ...item }))
  let deliverabilityServiceNow: DeliverabilityService = { configured: false, provider: 'MAILGUN_INSPECT', region: 'US', username: '', has_api_key: false, default_clients: [], image_blocking: false,
                                                           is_active: false, last_checked_at: null, last_check_ok: null, last_check_error: null, ...options.deliverabilityService }
  if (options.deliverabilityService?.has_api_key) deliverabilityServiceNow = { ...deliverabilityServiceNow, configured: true, is_active: true }
  const deliverabilityTests: DeliverabilityTest[] = [...(options.deliverabilityTests ?? [])]
  const deliverabilityAllowance = () => {
    const limit = options.deliverabilityLimit === undefined ? 20 : options.deliverabilityLimit
    return { enabled: true, used: deliverabilityTests.length, limit, left: limit === null ? null : Math.max(0, limit - deliverabilityTests.length), month: '2026-10-01', plan: 'Growth', configured: deliverabilityServiceNow.configured }
  }

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = init.body && !(init.body instanceof FormData) ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const call = { url, method, headers, body }
    calls.push(call)
    const path = url.split('?')[0]

    if (/\/campaigns\/[^/]+\/suppressions\/export\.csv$/.test(path)) return new Response('contact,channel,reason\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (/\/campaigns\/[^/]+\/suppressions\/$/.test(path)) {                    // the campaign page's own view of the Suppressions rows
      const reason = new URL(url, 'http://test.local').searchParams.get('reason')
      const rows = toolsState.suppressions.filter((row) => !reason || row.group === reason)
      const groups = (['UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'BLOCKED'] as const).map((key) => ({ key, label: key === 'BLOCKED' ? 'Blocked by You' : key.charAt(0) + key.slice(1).toLowerCase(),
        count: toolsState.suppressions.filter((row) => row.group === key).length, email: 0, phone: 0, this_week: 0 }))
      return json({ count: rows.length, page: 1, page_size: 50, results: rows, summary: { total: toolsState.suppressions.length, this_week: 0, groups } })
    }
    const tools = handleWorkspaceTools({ path, url, method, body }, toolsState)
    if (tools) return tools
    if (path.endsWith('/auth/options/')) return json({ workspace: headers['X-Tenant'], sso_enabled: false, sso_enforced: false, sso_name: null, mfa_required: false, ...options.authOptions })
    if (path.endsWith('/auth/mfa/verify/')) {
      return body?.mfa_token === 'mfa-token-1' && body?.code === MFA_CODE ? json({ access: 'access-1', refresh: 'refresh-1' })
        : json({ type: 'about:blank', title: 'Authentication Failed', status: 401, detail: 'That code is not right. Codes change every 30 seconds; a recovery code works once.' }, 401)
    }
    if (path.endsWith('/auth/token/') && method === 'POST') {
      if (body?.password === 'needs-a-code') return json({ mfa_required: true, mfa_token: 'mfa-token-1' })
      return body?.password === 'correct-horse'
        ? json({ access: 'access-1', refresh: 'refresh-1' })
        : json({ type: 'about:blank', title: 'Authentication Failed', status: 401, detail: 'No active account' }, 401)
    }
    if (path.endsWith('/auth/set-password/')) return options.onSettingsWrite?.(call) ?? json(null, 204)
    // no view is registered for this yet: Django answers 404, which is what the reset form has to cope with
    if (path.endsWith('/auth/forgot-password/')) return options.onForgotPassword?.(call) ?? json({ title: 'Not Found', status: 404 }, 404)
    if (headers.Authorization !== 'Bearer access-1') return json({ title: 'Unauthorized', status: 401 }, 401)
    if (/\/(users|roles|api-clients)\//.test(path) && method !== 'GET') {
      const custom = options.onSettingsWrite?.(call)
      if (custom) return custom
      if (path.endsWith('/password-link/')) return json({ path: `/set-password?tenant=NWA&uid=dTI&token=${body?.send ? 'mailed-456' : 'abc-123'}`, expires_in_hours: 72, emailed: Boolean(body?.send), email_configured: true, email: 'devon@example.com' })
      if (path.endsWith('/revoke/')) return json({ ...apiKeys[0], status: 'REVOKED', revoked_at: '2026-09-18T10:00:00Z' })
      if (path.endsWith('/api-clients/')) return json({ ...apiKeys[0], ...(body as Partial<ApiKey>), id: 'key-new', key_prefix: 'cep_in_NeW456', key: 'cep_in_NeW456secretsecretsecret' }, 201)
      if (path.includes('/roles/')) return method === 'DELETE' ? json(null, 204) : json({ ...roles[1], ...(body as Partial<Role>), id: 'role-new' }, method === 'POST' ? 201 : 200)
      return json({ ...settingsUsers[1], ...(body as Partial<SettingsUser>) }, method === 'POST' ? 201 : 200)
    }
    if (path.endsWith('/auth/support-session/end/')) return json(null, 204)
    if (path.endsWith('/auth/mfa/') && method === 'POST') {
      if (body?.action === 'setup') return json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/CEP:aby.john%40aiintelekt.com?secret=JBSWY3DPEHPK3PXP&issuer=CEP' })
      if (body?.code !== MFA_CODE) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { code: ['That code is not right. Check the time on your phone and try the next code.'] } }, 400)
      mfaEnabled = body?.action === 'confirm'
      return json(mfaEnabled ? { enabled: true, recovery_codes: ['aaaa-bbbb-01', 'aaaa-bbbb-02', 'aaaa-bbbb-03'], access: 'access-1', refresh: 'refresh-1' } : { enabled: false })
    }
    if (path.endsWith('/auth/mfa/')) return json({ enabled: mfaEnabled, required: Boolean(options.me?.mfa_setup_required), recovery_codes_left: mfaEnabled ? 10 : 0, sso: false, confirmed_at: mfaEnabled ? '2026-09-18T10:00:00Z' : null })
    if (path.endsWith('/delivery-providers/catalogue/')) return json(providerCatalogue)
    if (/\/delivery-providers\/[^/]+\/check\/$/.test(path)) return json({ ok: !options.providerCheckFails, detail: options.providerCheckFails ? 'Postal refused the API key (InvalidServerAPIKey).' : null })
    if (path.endsWith('/delivery-providers/') && method === 'POST') {
      if (!body?.secret) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { secret: ['API key is required.'] } }, 400)
      const { secret, ...rest } = body as Record<string, unknown>
      void secret
      return json({ ...deliveryProviders[0], ...rest, id: 'prov-new', has_secret: true, has_transactional_secret: Boolean(body.transactional_secret), is_default: false, webhook_url: 'http://localhost:8000/api/v1/webhooks/delivery/NWA/prov-new/tok/' }, 201)
    }
    if (/\/delivery-providers\/[^/]+\/rotate-webhook\/$/.test(path)) return json({ ...deliveryProviders[0], webhook_url: 'https://cep.example.com/api/v1/webhooks/delivery/NWA/prov-postal/rotated-token/' })
    if (path.includes('/delivery-providers/') && method === 'PATCH') return json({ ...deliveryProviders[0], has_transactional_secret: Boolean(options.providerHasTransactionalKey), ...(body as Partial<DeliveryProvider>) })
    if (path.endsWith('/delivery-providers/')) return json((options.texts ? [...deliveryProviders, textEngine] : deliveryProviders).map((item) => item.id === 'prov-postal' ? { ...item, has_transactional_secret: Boolean(options.providerHasTransactionalKey) } : item))
    if (path.endsWith('/sms-inbound/')) return json(options.texts ? smsReplies : [])
    if (/\/delivery-senders\/[^/]+\/verify\/$/.test(path)) return json({ ok: true, detail: null, to: body?.to, verification_status: 'VERIFIED' })
    if (path.endsWith('/delivery-senders/') && method === 'POST') return json({ ...deliverySenders[0], ...(body as Partial<DeliverySender>), id: 'snd-new', verification_status: 'PENDING', is_default: false }, 201)
    if (path.endsWith('/delivery-senders/')) return json(options.texts ? [...deliverySenders, textSender] : deliverySenders)
    if (path.endsWith('/results/')) return json(options.texts ? textResults : runResults)
    if (/\/campaign-runs\/[^/]+\/recipients\/export\.csv$/.test(path)) return new Response('address,status\n' + runRecipients.map((row) => `${row.address},${row.status}`).join('\n'), { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (/\/campaign-runs\/[^/]+\/recipients\/\d+\/check\/$/.test(path)) {
      return json({ provider: 'Postal (self-hosted)', provider_type: 'POSTAL', id: 3913, message_id: 'postal-7205256a6e7d', status: 'Sent', held: false, hold_expiry: null, last_delivery_attempt: '2026-09-18T10:01:30Z',
                    to: 'brianna@example.com', from: 'rewards@mail.northwindapparel.example', subject: 'Fall Rewards', sent_at: '2026-09-18T10:00:20Z',
                    deliveries: [{ at: '2026-09-18T10:01:30Z', status: 'Sent', details: 'Message for brianna@example.com accepted by mx.example.com', output: '250 2.0.0 OK', sent_with_ssl: true, time: 0.4 }] })
    }
    const recipientMatch = path.match(/\/campaign-runs\/[^/]+\/recipients\/(\d+)\/$/)
    if (recipientMatch) {
      const row = runRecipients.find((item) => item.id === Number(recipientMatch[1])) ?? runRecipients[0]
      return json({ recipient: row, callbacks: row.status === 'SUBMITTED' ? 0 : 2,
                    events: [{ at: row.created_at, kind: 'cep', what: 'Queued', detail: null }, { at: row.submitted_at, kind: 'cep', what: 'Handed to the engine', detail: null },
                             ...(row.delivered_at ? [{ at: row.delivered_at, kind: 'callback', what: 'MessageDelivered', detail: 'PROCESSED' }] : []),
                             ...(row.failed_at || row.status === 'FAILED' ? [{ at: row.submitted_at, kind: 'cep', what: 'Failed', detail: row.status_reason }] : [])],
                    log: [{ id: 501, at: row.submitted_at, direction: 'OUT', outcome: row.status === 'FAILED' ? 'REJECTED' : 'OK', response_status: 200, error: row.status_reason }],
                    standing: { blocked: row.status === 'BOUNCED', block_reason: row.status === 'BOUNCED' ? 'HARD_BOUNCE' : null, hard_bounces: row.status === 'BOUNCED' ? 1 : 0, soft_bounces: 0, complaints: 0, consent: 'OPTED_IN', opt_out_method: null } })
    }
    if (/\/campaign-runs\/[^/]+\/recipients\/$/.test(path)) {
      const params = new URL(url, 'http://test.local').searchParams
      const status = params.get('status'), q = (params.get('q') ?? '').toLowerCase()
      const rows = runRecipients.filter((row) => (!status || status.split(',').includes(row.status)) && (!q || row.address.includes(q) || `${row.first_name} ${row.last_name}`.toLowerCase().includes(q)))
      const byStatus = runRecipients.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {})
      return json({ run: { id: 'r1', run_number: 1, status: 'COMPLETED', test_mode: false, family: 'EMAIL' }, count: rows.length, page: 1, page_size: 50, results: rows, by_status: byStatus,
                    statuses: ['QUEUED', 'SUBMITTED', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'FAILED'] })
    }
    if (path.endsWith('/workspace/mail-server/test/')) {
      const ok = mailNow.server?.host !== 'smtp.broken.example'
      const sender = mailNow.server?.campaign_sender ? { id: 'snd-smtp', display_name: mailNow.server.from_name ?? mailNow.server.from_email, from_address: mailNow.server.from_email, verification_status: ok ? 'VERIFIED' as const : 'PENDING' as const, is_default: false } : null
      mailNow = { ...mailNow, sender_profile: sender, server: mailNow.server && { ...mailNow.server, last_tested_at: '2026-09-18T10:00:00Z', last_test_ok: ok, last_test_error: ok ? null : 'ConnectionRefusedError: [Errno 111]' } }
      return json({ ok, error: ok ? null : 'ConnectionRefusedError: [Errno 111]', to: body?.to, sender_profile: sender })
    }
    if (path.endsWith('/workspace/mail-server/')) {
      if (method === 'DELETE') { mailNow = { ...mailNow, server: null, sender_profile: null, in_use: 'console' }; return json(null, 204) }
      if (method === 'PUT') {
        if (body?.from_email === 'bad') return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { from_email: ['Enter a valid email address.'] } }, 400)
        const { password, ...rest } = body as Record<string, unknown>
        const server = { host: '', port: 587, security: 'STARTTLS', username: null, from_name: null, reply_to: null, is_active: true, campaign_sender: false, last_tested_at: null, last_test_ok: null, last_test_error: null,
                         ...(mailNow.server ?? {}), ...rest, has_password: Boolean(password) || Boolean(mailNow.server?.has_password) } as NonNullable<MailServerSettings['server']>
        const sender = server.campaign_sender ? { id: 'snd-smtp', display_name: server.from_name ?? server.from_email, from_address: server.from_email, verification_status: server.last_test_ok ? 'VERIFIED' as const : 'PENDING' as const, is_default: false } : null
        mailNow = { ...mailNow, in_use: 'tenant', server, sender_profile: sender }
      }
      return json(mailNow)
    }
    if (path.endsWith('/deliverability/service/check/')) {
      deliverabilityServiceNow = { ...deliverabilityServiceNow, last_checked_at: '2026-10-02T09:00:00Z', last_check_ok: true, last_check_error: null }
      return json({ ok: true, detail: null })
    }
    if (path.endsWith('/deliverability/service/')) {
      if (method === 'PUT') {
        const input = (body ?? {}) as Record<string, unknown>
        if (!deliverabilityServiceNow.has_api_key && !input.api_key) return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { api_key: ['Enter the Mailgun Inspect API key.'] } }, 400)
        deliverabilityServiceNow = { ...deliverabilityServiceNow, region: (input.region as 'US' | 'EU') ?? 'US', username: String(input.username ?? ''), default_clients: (input.default_clients as string[]) ?? [],
                                     image_blocking: Boolean(input.image_blocking), is_active: input.is_active !== false, has_api_key: true, configured: true }
        return json(deliverabilityServiceNow)
      }
      if (method === 'DELETE') {
        deliverabilityServiceNow = { ...deliverabilityServiceNow, configured: false, has_api_key: false, is_active: false, username: '', default_clients: [] }
        return json(null, 204)
      }
      return json(deliverabilityServiceNow)
    }
    if (path.endsWith('/deliverability/clients/')) return json(deliverabilityServiceNow.has_api_key ? { clients: inspectClients, detail: null } : { clients: [], detail: 'No inbox-preview account is set up.' })
    if (path.endsWith('/deliverability/allowance/')) return json(deliverabilityAllowance())
    if (path.includes('/templates/') && path.endsWith('/deliverability-tests/')) {
      if (method === 'POST') {
        const allowance = deliverabilityAllowance()
        if (!allowance.configured) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'No inbox-preview account is set up. Add the Mailgun Inspect account under Settings → Delivery → Deliverability Testing.' }, 409)
        if (allowance.left === 0) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: `This workspace has used its ${allowance.limit} deliverability tests for the month. Testing resumes next month, or ask for a plan upgrade.` }, 409)
        const made: DeliverabilityTest = { ...finishedDeliverabilityTest, id: `dt-${deliverabilityTests.length + 2}`, template: path.split('/templates/')[1].split('/')[0], template_version: 3, status: 'PENDING', completed_at: null,
                                           requested_at: '2026-10-02T09:30:00Z', summary: { clients: 5, complete: 0, failed: 0, processing: 5 }, previews: inspectClients.map((c) => preview(c, 'PROCESSING')) }
        deliverabilityTests.unshift(made)
        return json(made, 201)
      }
      return json({ tests: deliverabilityTests.map((t) => ({ ...t, previews: [] })), allowance: deliverabilityAllowance() })
    }
    if (path.includes('/deliverability-tests/')) {
      const id = path.split('/deliverability-tests/')[1].replace(/\/$/, '')
      const at = deliverabilityTests.findIndex((t) => t.id === id)
      if (at < 0) return json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'No such test.' }, 404)
      if (method === 'DELETE') { deliverabilityTests.splice(at, 1); return json(null, 204) }
      const found = deliverabilityTests[at]
      if (found.status === 'PENDING') {                                                     // the next read finishes it, as Inspect would in a minute
        deliverabilityTests[at] = { ...found, status: 'COMPLETE', completed_at: '2026-10-02T09:33:00Z', summary: { clients: 5, complete: 5, failed: 0, processing: 0 }, previews: inspectClients.map((c) => preview(c)) }
      }
      return json(deliverabilityTests[at])
    }
    if (path.endsWith('/workspace/usage/')) return json(usage)
    if (path.endsWith('/workspace/invoices/')) return json(invoices)
    if (path.endsWith('/workspace/support-access/')) return json(supportAccess)
    if (path.endsWith('/workspace/security/')) {
      if (method === 'PUT') {
        const custom = options.onSecurityWrite?.(call)
        if (custom) return custom
        const provider = body && 'identity_provider' in body ? (body.identity_provider as Record<string, unknown> | null) : undefined
        securityNow = { ...securityNow, ...(typeof body?.require_mfa === 'boolean' ? { require_mfa: body.require_mfa } : {}),
                        ...(provider === undefined ? {} : { identity_provider: provider === null ? null : ({ ...provider, client_secret: undefined, has_client_secret: Boolean(provider.client_secret) } as never) }) }
      }
      return json(securityNow)
    }
    if (path.endsWith('/workspace/')) return json(workspace)
    if (/\/integrations\/[^/]+\/(pause|resume)\/$/.test(path)) {
      const item = integrations.find((row) => path.includes(`/${row.id}/`)) ?? integrations[0]
      return json({ ...item, status: path.endsWith('/pause/') ? 'PAUSED' : 'ACTIVE', health: path.endsWith('/pause/') ? 'paused' : 'healthy', breaker_open_seconds: 0 })
    }
    if (/\/integrations\/[^/]+\/metrics\/$/.test(path)) {
      const minute = 60_000
      const at = (minutesAgo: number) => new Date(Math.floor((Date.now() - minutesAgo * minute) / (15 * minute)) * 15 * minute).toISOString()
      const busy = path.includes('/int-postal/')
      return json({ hours: 24, step_minutes: 15, buckets: busy
        ? [{ bucket: at(30), calls: 120, ok: 110, rejected: 0, failed: 10, throttled: 0, p95_ms: 640 }, { bucket: at(15), calls: 80, ok: 70, rejected: 0, failed: 4, throttled: 6, p95_ms: 410 }]
        : [] })
    }
    if (/\/integrations\/log\/\d+\/$/.test(path)) {
      const found = integrationLog.find((row) => path.endsWith(`/${row.id}/`))
      return found ? json(found) : json({ type: 'about:blank', title: 'Not found', status: 404 }, 404)
    }
    if (path.endsWith('/integrations/log/')) {
      const query = new URL(url, 'http://test.local').searchParams
      const rows = integrationLog.filter((row) => (!query.get('integration') || row.integration_id === query.get('integration')) && (!query.get('direction') || row.direction === query.get('direction'))
        && (query.get('failed') !== '1' || row.outcome !== 'OK') && (!query.get('q') || row.correlation_id === query.get('q') || row.related_ref === query.get('q')))
      return json({ results: rows.map(({ request_headers: _rh, request_body: _rb, response_headers: _sh, response_body: _sb, worker: _w, ...row }) => row), more: false, next_before: null })
    }
    if (/\/integrations\/log\/\d+\/retry\/$/.test(path) && method === 'POST') return json({ queued: true, execution: 42, run: 'r1', campaign: 'c1', note: "It goes out on the dispatcher's next pass; the new attempt appears in the log." })
    if (/\/integrations\/log\/\d+\/replay\/$/.test(path) && method === 'POST') return json({ received: 1, applied: 1, ignored: 0, unmatched: 0, failed: 0, duplicate: 0, replayed: 2 })
    if (/\/integrations\/[^/]+\/alerts\/$/.test(path) && method === 'POST') return json({ id: path.split('/').at(-3), alerts_enabled: Boolean((body as { enabled?: boolean } | null)?.enabled) })
    if (path.endsWith('/integrations/')) return json(integrations)
    if (path.endsWith('/search/')) {
      const q = (new URL(url, 'http://test.local').searchParams.get('q') ?? '').toLowerCase()
      if (q.length < 2) return json({ q, campaigns: [], lists: [], templates: [] })
      return json({
        q,
        campaigns: campaignState.campaigns.filter((item) => item.name.toLowerCase().includes(q) && item.status !== 'ARCHIVED').slice(0, 6)
          .map((item) => ({ id: item.id, name: item.name, code: item.code, channel: item.channel, status: item.display_status, status_label: item.display_status_label, setup_complete: item.setup_complete })),
        lists: listsNow.filter((item) => item.name.toLowerCase().includes(q) && item.status !== 'DRAFT').slice(0, 6)
          .map((item) => ({ id: item.id, name: item.name, member_count: item.member_count, list_environment: item.list_environment, status: item.status })),
        templates: templatesNow.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 6).map((item) => ({ id: item.id, name: item.name, channel: item.channel, status: item.status })),
      })
    }
    if (path.endsWith('/users/')) return json(settingsUsers)
    if (path.endsWith('/roles/permissions/')) return json(permissionCatalogue)
    if (path.endsWith('/roles/')) return json(roles)
    if (path.endsWith('/api-clients/scopes/')) return json({ scopes: ['campaign:view', 'campaign:edit', 'events:ingest'] })
    if (path.endsWith('/api-clients/')) return json(apiKeys)
    if (path.endsWith('/me/')) return json({ ...me, ...options.me })
    const message = options.message ?? makeMessage()
    if (path.endsWith('/message/') && method === 'POST') {
      const custom = options.onSaveMessage?.(call)
      if (custom) return custom
      const media = mediaLibrary.find((item) => item.id === body?.media_asset) ?? null
      return json({ ...message, sms_body: String(body?.sms_body ?? '').trim(), subject_line: body?.subject_line ?? '', media_asset: media, version_number: message.latest_version + 1,
                    latest_version: message.latest_version + 1, saved_by: 'Aby John' }, 201)
    }
    if (path.endsWith('/message/')) return json(message)
    if (path.endsWith('/design/versions/')) return json([{ version_number: message.latest_version, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' }])
    const design = options.design ?? makeDesign()
    if (path.endsWith('/design/') && method === 'POST') {
      const custom = options.onSaveDesign?.(call)
      if (custom) return custom
      return json({ ...design, ...(body as Partial<Design>), version_number: design.latest_version + 1, latest_version: design.latest_version + 1, saved_by: 'Aby John' }, 201)
    }
    if (path.endsWith('/design/')) return json(design)
    const receiptLayout = options.receiptLayout ?? makeReceiptLayout()
    if (path.endsWith('/receipt/') && method === 'POST') {
      const custom = options.onSaveReceiptLayout?.(call)
      if (custom) return custom
      return json({ ...receiptLayout, ...(body as Partial<ReceiptLayout>), version_number: receiptLayout.latest_version + 1,
                    latest_version: receiptLayout.latest_version + 1, saved_by: 'Aby John' }, 201)
    }
    if (path.endsWith('/receipt/')) return json(receiptLayout)
    if (path.endsWith('/receipt/versions/')) return json([{ version_number: receiptLayout.latest_version, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' }])
    if (path.endsWith('/field-rules/')) return json(fieldRules)
    if (path.endsWith('/personalization-tags/data-points/')) return json(tagDataPoints)
    if (path.endsWith('/personalization-tags/') && method === 'POST') {
      const input = (body ?? {}) as Partial<PersonalizationTag>
      const made = { ...tag(String(input.tag_key), String(input.label), 'CUSTOM', String(input.sample_value ?? '')), ...input, id: 'tag-new', platform_tag_id: null }
      tagRows.push(made as PersonalizationTag)
      return json(made, 201)
    }
    if (path.endsWith('/personalization-tags/')) return json({ next: null, previous: null, results: tagRows })
    const tagMatch = path.match(/\/personalization-tags\/([^/]+)\/$/)
    if (tagMatch && (method === 'PATCH' || method === 'DELETE')) {
      const found = tagRows.find((item) => item.id === tagMatch[1])
      if (!found) return json({ title: 'Not found', status: 404 }, 404)
      if (found.platform_tag_id) return json({ title: 'This tag comes from the platform catalogue; the back-office changes it.', status: 403 }, 403)
      if (method === 'DELETE') { tagRows.splice(tagRows.indexOf(found), 1); return json(null, 204) }
      Object.assign(found, body)
      return json(found)
    }
    if (path.endsWith('/template-starters/')) return json(starters.filter((item) => url.includes(`channel=${item.channel}`)))
    if (path.endsWith('/media-assets/') && method === 'POST') return json({ ...mediaLibrary[0], id: 'img-up', file_name: 'uploaded.png', mime_type: 'image/png' }, 201)
    if (path.endsWith('/media-assets/')) return json({ next: null, previous: null, results: mediaLibrary })
    if (path.endsWith('/activate/')) return json({ ...(options.template ?? templates[1]), status: 'ACTIVE' })
    // templates are stateful: a copy or a deletion shows in the list afterwards
    if (/\/templates\/[^/]+\/clone\/$/.test(path) && method === 'POST') {
      const source = templatesNow.find((item) => path.includes(`/${item.id}/`)) ?? templates[0]
      const copy: Template = { ...source, id: `${source.id}-copy`, name: `${source.name} (copy)`, status: 'DRAFT', cloned_from: source.id, latest_version: source.latest_version ?? 1 }
      templatesNow = [copy, ...templatesNow]
      return json(copy, 201)
    }
    if (/\/templates\/[^/]+\/$/.test(path) && method === 'DELETE') {
      const id = /\/templates\/([^/]+)\/$/.exec(path)?.[1]
      // Fall Email is the campaign's template, which the server refuses to delete
      if (id === 'tpl-email') return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'This template is used by a campaign. Archive it instead.' }, 409)
      templatesNow = templatesNow.filter((item) => item.id !== id)
      return json(null, 204)
    }
    if (/\/templates\/[^/]+\/$/.test(path) && method === 'PATCH') {
      const id = /\/templates\/([^/]+)\/$/.exec(path)?.[1]
      const wanted = String((body as { name?: string })?.name ?? '').trim()
      // the server's own rule: a live name is unique, case aside
      if (templatesNow.some((item) => item.id !== id && item.name.toLowerCase() === wanted.toLowerCase())) return json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Another template already has this name.', errors: { name: ['Another template already has this name.'] } }, 400)
      templatesNow = templatesNow.map((item) => (item.id === id ? { ...item, ...(body as Partial<Template>) } : item))
      return json(templatesNow.find((item) => item.id === id) ?? templates[1])
    }
    if (/\/templates\/[^/]+\/$/.test(path) && method === 'GET') return json(options.template ?? templates[1])
    if (path.endsWith('/templates/') && method === 'POST') {
      return options.onSaveTemplate?.(call) ?? json({ ...templates[0], ...(body as Partial<Template>), id: 'tpl-new', status: 'DRAFT', latest_version: 0 }, 201)
    }
    if (path.endsWith('/templates/')) {
      const query = new URL(url, 'http://x').searchParams
      const needle = (query.get('search') ?? '').toLowerCase()
      const rows = templatesNow.filter((item) => (!query.get('channel') || item.channel === query.get('channel')) && (!query.get('status') || item.status === query.get('status'))
        && item.name.toLowerCase().includes(needle))
      return json({ next: null, previous: null, results: rows })
    }
    if (path.endsWith('/sender-profiles/')) return json(senders)
    // ---- contact lists: stateful, so what a test creates is there afterwards
    if (path.includes('/contact-lists/')) {
      if (/\/contact-lists\/[^/]+\/reach\/$/.test(path)) {
        const found = listsNow.find((item) => path.includes(`/${item.id}/`))
        const total = found?.member_count ?? 0
        return json({ email: { total, sendable: Math.round(total * 0.88) }, sms: { total, sendable: Math.round(total * 0.4), no_phone: Math.round(total * 0.3) }, checked_at: '2026-09-26T10:00:00Z' })
      }
      const one = /\/contact-lists\/([^/]+)\//.exec(path)?.[1]
      const find = (id: string | undefined) => listsNow.find((item) => item.id === id)
      const query = new URL(url, 'http://x').searchParams
      if (path.endsWith('/contact-lists/stats/')) return json({ total_lists: listsNow.filter((item) => item.status !== 'DRAFT').length, total_contacts: 100, attached_to_live_campaigns: 1 })
      if (path.endsWith('/audiences/')) return json(audiences)
      if (path.endsWith('/from-audience/')) {
        const made = list('cl-bi', String(body?.name), 43, true, { source_type: 'BI', source_label: 'BI / Extraction', vetted: true, list_kind: 'SEGMENT', list_environment: String(body?.list_environment ?? 'PRODUCTION') })
        listsNow = [made, ...listsNow]
        return json(made, 201)
      }
      if (path.endsWith('/clone/')) {
        const made = list('cl-clone', String(body?.name), find(one)?.member_count ?? 0, true, { source_type: 'CLONE', source_label: 'Cloned', vetted: true, parent_contact_list: one ?? null, parent_name: find(one)?.name })
        listsNow = [made, ...listsNow]
        return json(made, 201)
      }
      if (path.endsWith('/governance/')) return json({ total: 3, sendable: 2, not_sendable: 1, statuses: GOVERNANCE.map((line) => (line.code === 'HARD_BOUNCE' ? { ...line, count: 0 } : line)), checked_at: '2026-09-21T10:00:00Z' })
      if (path.endsWith('/report/')) return new Response('line,email,outcome\n2,a@x.example,Imported\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
      if (path.endsWith('/usage/')) {
        const item = find(one)
        return json({
          campaigns: item?.attached_campaigns ? [{ id: 'c1', name: 'Fall Promo Email', code: 'CMP-1', status: 'PRODUCTION_PUBLISHED', channel: 'EMAIL', scheduled_at: null, attached_at: '2026-09-01T00:00:00Z', live: true, frozen_lists: 1 }] : [],
          attached_campaigns: item?.attached_campaigns ?? 0, live_campaigns: item?.live_campaigns ?? 0, added_this_week: 2,
        })
      }
      if (path.endsWith('/members/remove/')) {
        const ids = (body?.ids as number[]) ?? []
        membersNow = membersNow.filter((row) => !ids.includes(row.id))
        return json({ removed: ids.length, member_count: membersNow.length })
      }
      if (path.endsWith('/members/') && method === 'POST') {
        const wanted = (body?.contacts as { email: string }[]) ?? []
        const valid = wanted.filter((row) => row.email.includes('@'))
        membersNow = [...valid.map((row, index) => ({ ...listMembers[0], id: 100 + index, email: row.email, first_name: null, last_name: null, source: 'MANUAL' })), ...membersNow]
        return json({ added: valid.length, already_in_list: 0, new_people: valid.length, invalid: wanted.filter((row) => !row.email.includes('@')).map((row) => row.email), member_count: membersNow.length })
      }
      if (path.endsWith('/members/')) {
        const needle = query.get('search')?.toLowerCase() ?? ''
        const rows = membersNow.filter((row) => `${row.email} ${row.first_name} ${row.last_name}`.toLowerCase().includes(needle))
        return json({ count: rows.length, page: 1, page_size: 50, results: rows })
      }
      // uploads are background jobs: a request only queues; the "worker" finishes the step by the time of the next poll
      const jobId = /\/imports\/([^/]+)\//.exec(path)?.[1]
      const job = jobsNow.find((item) => item.id === jobId)
      const put = (next: ListImport) => { jobsNow = jobsNow.map((item) => (item.id === next.id ? next : item)); return next }
      // the "worker": an import that was requested is finished once options.listImportMs have passed, whoever asks
      for (const item of jobsNow) {
        if (item.status === 'APPLYING' && (importDoneAt.get(item.id) ?? Infinity) <= Date.now()) {
          listsNow = listsNow.map((entry) => (entry.id === item.contact_list ? { ...entry, status: 'ACTIVE', member_count: 4 } : entry))
          put({ ...item, status: 'APPLIED', phase: 'Imported', working: false, applied_count: 3, new_people: 3, consents_recorded: 0, list_status: 'ACTIVE', completed_at: '2026-09-21T10:02:00Z',
                summary: { ...uploadSummary, result: { added: 3, already_in_list: 1, list_members_now: 4, new_people: 3, consents_recorded: 0 } } })
        }
      }
      if (path.endsWith('/contact-lists/imports/')) return json(jobsNow)
      if (path.endsWith('/imports/') && method === 'POST') {
        const custom = options.onListUpload?.(call)
        if (custom) return custom
        const made: ListImport = { ...stagedImport, id: `imp-${jobsNow.length + 1}`, contact_list: String(one), list_name: find(one)?.name ?? '' }
        jobsNow = [made, ...jobsNow]
        return json(made, 201)
      }
      if (job && path.endsWith('/review/')) {
        return json(put({ ...job, status: 'MATCHING', phase: 'Checking the rows', working: true, mapping_confirmed: true, mapping: body?.mapping as Record<string, string>, review: null,
                          progress: { done: 3, total: 6, percent: 50, unit: 'rows' } }), 202)
      }
      if (job && path.endsWith('/apply/')) {
        importDoneAt.set(job.id, Date.now() + (options.listImportMs ?? 0))
        return json(put({ ...job, status: 'APPLYING', phase: 'Adding contacts to the list', working: true, progress: { done: 2, total: 6, percent: 33, unit: 'rows' } }), 202)
      }
      if (job && path.endsWith('/cancel/')) return json(put({ ...job, status: 'CANCELLED', phase: 'Cancelled', working: false }))
      if (job && method === 'GET') {
        if (options.listUploadFails && job.status === 'UPLOADED') {
          return json(put({ ...job, status: 'FAILED', phase: 'Failed', working: false, error: 'The file has more than 250,000 rows. Split it and upload the parts as separate lists.' }))
        }
        if (job.status === 'UPLOADED') return json(put({ ...job, status: 'STAGED', phase: 'Read. Match the columns to continue', working: false, row_count: 6, progress: { done: 6, total: 6, percent: 100, unit: 'rows' } }))
        if (job.status === 'MATCHING') {
          return json(put({ ...job, status: 'REVIEW', phase: 'Checked. Review it to continue', working: false, review: REVIEW, summary: uploadSummary, progress: { done: 6, total: 6, percent: 100, unit: 'rows' },
                            issues: [{ line: 5, kind: 'error', message: 'Same email address as line 3', value: 'A@x.example' }, { line: 4, kind: 'warning', message: 'Mobile number not recognised: left out', value: 'b@x.example' }] }))
        }
        return json(jobsNow.find((item) => item.id === job.id))
      }
      if (path.endsWith('/contact-lists/') && method === 'POST') {
        if (listsNow.some((item) => item.name.toLowerCase() === String(body?.name).toLowerCase())) {
          return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { name: 'Another list already has this name.' } }, 400)
        }
        const made = list('cl-new', String(body?.name), 0, true, { status: 'DRAFT', description: (body?.description as string) || null, list_environment: String(body?.list_environment ?? 'PRODUCTION') })
        listsNow = [made, ...listsNow]
        return json(made, 201)
      }
      if (path.endsWith('/contact-lists/')) {
        const sources: Record<string, string[]> = { UPLOAD: ['UPLOAD'], BI: ['BI', 'EXTRACTION', 'SEGMENT'], CLONE: ['CLONE'] }
        const rows = listsNow.filter((item) => (query.get('status') ? item.status === query.get('status') : item.status !== 'DRAFT')
          && (!query.get('list_environment') || item.list_environment === query.get('list_environment'))
          && (!query.get('source') || sources[query.get('source') as string].includes(item.source_type))
          && item.name.toLowerCase().includes((query.get('search') ?? '').toLowerCase()))
        return json({ next: null, previous: null, results: rows })
      }
      if (one && method === 'PATCH') {
        listsNow = listsNow.map((item) => (item.id === one ? { ...item, ...(body as Partial<ContactList>) } : item))
        return json(find(one))
      }
      if (one && method === 'DELETE') {
        if (find(one)?.attached_campaigns) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'This list is attached to a campaign. Detach it there first, or archive the list.' }, 409)
        listsNow = listsNow.filter((item) => item.id !== one)
        return json(null, 204)
      }
      if (one) return find(one) ? json(find(one)) : json({ type: 'about:blank', title: 'Not found', status: 404 }, 404)
    }
    const handled = handleCampaigns({ path, url, method, body }, campaignState)
    if (handled) return handled
    const one = /\/campaigns\/([^/]+)\/$/.exec(path)?.[1]
    if ((method === 'POST' && path.endsWith('/campaigns/')) || (method === 'PATCH' && one)) {
      const custom = options.onSave?.(call)
      if (custom) return custom
      // as the API does: the body's ids come back with the names and details the pages show
      const before = campaignState.campaigns.find((item) => item.id === one)
      const input = body as Partial<Campaign>
      if (input.ab_config?.enabled && !input.ab_config.subject_b?.trim()) {
        return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { ab_config: ['Enter the second subject line, or switch the test off.'] } }, 400)
      }
      const details = [...((input.contact_lists ?? before?.contact_lists ?? []) as string[]).map((id) => ({ id, role: 'INCLUDE' as const })),
                       ...((input.excluded_lists ?? before?.excluded_lists ?? []) as string[]).map((id) => ({ id, role: 'EXCLUDE' as const }))]
        .map(({ id, role }) => { const found = listsNow.find((item) => item.id === id); return { id, name: found?.name ?? id, list_kind: found?.list_kind ?? 'STATIC', is_master: found?.is_master ?? false,
                                   list_environment: found?.list_environment ?? 'PRODUCTION', status: found?.status ?? 'ACTIVE', member_count: found?.member_count ?? 0, role } })
      const saved = makeCampaign({ ...before, ...input, id: before?.id ?? 'c-new', code: (body?.code as string) ?? before?.code ?? 'CMP-2026-0009', row_version: (before?.row_version ?? 1) + 1,
                                   status: before?.status ?? 'DRAFT', runs: before?.runs ?? [], contact_list_details: details,
                                   setup_step: Math.max(before?.setup_step ?? 0, (input.setup_step as number | undefined) ?? (before ? 0 : 6)), // only forward, as the API
                                   template_name: templates.find((item) => item.id === (input.template ?? before?.template))?.name ?? null,
                                   sender_profile_name: senders.find((item) => item.id === (input.sender_profile ?? before?.sender_profile))?.display_name ?? null })
      campaignState.campaigns = before ? campaignState.campaigns.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...campaignState.campaigns]
      return json(saved, method === 'POST' ? 201 : 200)
    }
    if (method === 'DELETE') return json(null, 204)
    if (one) {
      const found = campaignState.campaigns.find((item) => item.id === one)
      return found ? json(found) : json({ type: 'about:blank', title: 'Not found', status: 404, detail: 'No campaign matches the given query.' }, 404)
    }
    if (path.endsWith('/campaigns/')) return listCampaigns(url, campaignState.campaigns)
    return json({ next: null, previous: null, results: [] })
  })
  return calls
}

export function signIn(path = '/') {
  window.localStorage.setItem('cep.access', 'access-1')
  window.localStorage.setItem('cep.refresh', 'refresh-1')
  window.localStorage.setItem('cep.tenant', 'NWA')
  window.history.pushState({}, '', path)
}

export const problem = (status: number, body: Record<string, unknown>) => json({ type: 'about:blank', status, ...body }, status)
