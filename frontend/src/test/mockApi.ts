/** In-memory stand-in for the CEP API used by the component tests. */
import { vi } from 'vitest'

import { derived, handleCampaigns, listCampaigns, moduleDefaults } from './mockCampaigns'

import type { ApiKey, Audience, AuthOptions, Campaign, ContactList, GovernanceLine, ListImport, ListMember, UploadSummary, DeliveryProvider, DeliverySender, Invoice, MailServerSettings, Me, MediaAsset, Message, PersonalizationTag, ProviderType, Role, RunResults,
              SecuritySettings, SenderProfile, SettingsUser, SmsReply, SupportAccess, Template, TemplateStarter, Usage, Workspace } from '@/lib/types'

export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

const audit = { tenant: 't1', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', row_version: 1 }

export const me = {
  principal: { kind: 'user', id: 'u1', email: 'aby.john@aiintelekt.com', display_name: 'Aby John', is_platform_admin: false,
               permissions: ['campaign.view', 'campaign.edit', 'campaign.publish', 'template.edit', 'provider.edit', 'user.admin', 'list.view', 'list.edit', 'list.import'] },
  tenant: { id: 't1', code: 'NWA', timezone: 'America/New_York', db_alias: 'default', db_status: 'ACTIVE' },
  session: { idle_timeout_minutes: 120, idle_warning_seconds: 60 },
}

export const templates: Template[] = [
  { ...audit, id: 'tpl-email', name: 'Fall Email', description: null, channel: 'EMAIL', status: 'ACTIVE', cloned_from: null },
  { ...audit, id: 'tpl-sms', name: 'Fall SMS', description: null, channel: 'SMS', status: 'ACTIVE', cloned_from: null },
  { ...audit, id: 'tpl-old', name: 'Retired Email', description: null, channel: 'EMAIL', status: 'ARCHIVED', cloned_from: null },
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
  default_value: null, static_value: null, is_active: true,
})
export const tags: PersonalizationTag[] = [tag('first_name', 'First name', 'STANDARD', 'Jordan'), tag('offer_code', 'Offer code', 'CUSTOM', 'FALL017')]

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
    { key: 'api_key', label: 'Server API key', required: true, secret: true, help: 'Credentials -> type API.', placeholder: '', kind: 'text' }] },
  { provider_type: 'SENDGRID', label: 'SendGrid', description: 'Twilio SendGrid.', supports_webhooks: true, manageable: true, channel: 'EMAIL', fields: [
    { key: 'api_key', label: 'API key', required: true, secret: true, help: 'Needs the Mail Send permission.', placeholder: '', kind: 'text' },
    { key: 'api_base', label: 'API address', required: false, secret: false, help: 'Leave empty for the global region.', placeholder: 'https://api.sendgrid.com', kind: 'url' }] },
  { provider_type: 'SMTP', label: 'SMTP (your mail server)', description: 'Follows Settings -> Email server.', supports_webhooks: false, manageable: false, channel: 'EMAIL', fields: [] },
  { provider_type: 'SANDBOX_SMS', label: 'Sandbox (sends nothing)', description: 'Accepts SMS and MMS without sending them.', supports_webhooks: true, manageable: true, channel: 'SMS', supports_mms: true, fields: [
    { key: 'reject_numbers', label: 'Numbers to refuse', required: false, secret: false, help: 'Comma-separated.', placeholder: '', kind: 'text' }] },
]
export const deliveryProviders: DeliveryProvider[] = [
  { id: 'prov-postal', provider_type: 'POSTAL', channel: 'EMAIL', name: 'Postal (self-hosted)', config: { endpoint: 'https://postal.cep.example.com' }, has_secret: true, secret_ref: null,
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
export const runResults: RunResults = {
  id: 'r1', status: 'COMPLETED', started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z',
  audience: { members: 90, eligible: 72, suppressed: { NO_CONSENT: 11, UNSUBSCRIBED: 4, BLOCKED_ADDRESS: 2, FREQUENCY_CAP: 1 } },
  messages: { queued: 0, sent: 71, failed: 1, delivered: 68, opened: 30, clicked: 9, bounced: 2, complained: 0 }, by_status: {},
}

export const starters: TemplateStarter[] = [
  { key: 'promotion', name: 'Sale announcement', channel: 'EMAIL', category: 'Promotion', description: 'A time-limited offer.', subject_line: '{{first_name}}, a sale',
    preheader: '', html_content: '<html><body><p>Hi {{first_name}}</p></body></html>', sms_body: null },
  { key: 'sms_promotion', name: 'SMS offer', channel: 'SMS', category: 'Promotion', description: 'One-part text.', subject_line: '', preheader: '', html_content: null,
    sms_body: 'Hi {{first_name}}, code {{offer_code}}. Reply STOP to opt out.' },
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
    runs: [],
  }
}

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface MockOptions {
  campaign?: Campaign
  /** the workspace's campaigns (GET /campaigns/); default: the one campaign above */
  campaigns?: Campaign[]
  /** answer for POST /campaigns/ and PATCH /campaigns/{id}/ ; default echoes a saved campaign */
  onSave?: (call: Call) => Response | null
  /** answer for POST /templates/ ; default echoes a created draft */
  onSaveTemplate?: (call: Call) => Response | null
  /** what GET /templates/{id}/ and /message/ answer */
  template?: Template
  message?: Message
  /** answer for POST /templates/{id}/message/ ; default echoes version n+1 */
  onSaveMessage?: (call: Call) => Response | null
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
}

/** the code the mock authenticator "shows" */
export const MFA_CODE = '123456'

/** Installs a fetch mock; returns the recorded calls. Call signIn() to start authenticated. */
export function installMockApi(options: MockOptions = {}) {
  const calls: Call[] = []
  const campaign = options.campaign ?? makeCampaign()
  let mfaEnabled = options.mfaEnabled ?? false
  const campaignState = { campaigns: options.campaigns ?? [campaign], make: makeCampaign }
  let listsNow: ContactList[] = [...contactLists]
  let membersNow: ListMember[] = [...listMembers]
  let jobsNow: ListImport[] = [...(options.listUploads ?? [])]
  const importDoneAt = new Map<string, number>()
  let securityNow: SecuritySettings = { ...security }
  let mailNow: MailServerSettings = { server: null, platform_shared: false, platform_host: null, in_use: 'console', sender_profile: null, ...options.mailServer }

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = init.body && !(init.body instanceof FormData) ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const call = { url, method, headers, body }
    calls.push(call)
    const path = url.split('?')[0]

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
      return json({ ...deliveryProviders[0], ...rest, id: 'prov-new', has_secret: true, is_default: false, webhook_url: 'http://localhost:8000/api/v1/webhooks/delivery/NWA/prov-new/tok/' }, 201)
    }
    if (path.includes('/delivery-providers/') && method === 'PATCH') return json({ ...deliveryProviders[0], ...(body as Partial<DeliveryProvider>) })
    if (path.endsWith('/delivery-providers/')) return json(options.texts ? [...deliveryProviders, textEngine] : deliveryProviders)
    if (path.endsWith('/sms-inbound/')) return json(options.texts ? smsReplies : [])
    if (/\/delivery-senders\/[^/]+\/verify\/$/.test(path)) return json({ ok: true, detail: null, to: body?.to, verification_status: 'VERIFIED' })
    if (path.endsWith('/delivery-senders/') && method === 'POST') return json({ ...deliverySenders[0], ...(body as Partial<DeliverySender>), id: 'snd-new', verification_status: 'PENDING', is_default: false }, 201)
    if (path.endsWith('/delivery-senders/')) return json(options.texts ? [...deliverySenders, textSender] : deliverySenders)
    if (path.endsWith('/results/')) return json(options.texts ? textResults : runResults)
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
        const shared = Boolean(rest.use_platform_server)
        const server = { host: '', port: 587, security: 'STARTTLS', username: null, from_name: null, reply_to: null, is_active: true, campaign_sender: false, last_tested_at: null, last_test_ok: null, last_test_error: null,
                         ...(mailNow.server ?? {}), ...rest, has_password: Boolean(password) || Boolean(mailNow.server?.has_password) } as NonNullable<MailServerSettings['server']>
        const sender = server.campaign_sender ? { id: 'snd-smtp', display_name: server.from_name ?? server.from_email, from_address: server.from_email, verification_status: server.last_test_ok ? 'VERIFIED' as const : 'PENDING' as const, is_default: false } : null
        mailNow = { ...mailNow, in_use: shared ? 'platform-shared' : 'tenant', server, sender_profile: sender }
      }
      return json(mailNow)
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
    if (path.endsWith('/users/')) return json(settingsUsers)
    if (path.endsWith('/roles/permissions/')) return json(permissionCatalogue)
    if (path.endsWith('/roles/')) return json(roles)
    if (path.endsWith('/api-clients/scopes/')) return json({ scopes: ['campaign:view', 'campaign:edit', 'events:ingest'] })
    if (path.endsWith('/api-clients/')) return json(apiKeys)
    if (path.endsWith('/me/')) return json({ ...me, ...options.me })
    if (path.endsWith('/dashboard/summary/')) {
      const liveCampaigns = campaignState.campaigns.filter((item) => ['ACTIVE', 'PRODUCTION_PUBLISHED'].includes(item.status))
      const realLists = listsNow.filter((item) => item.status !== 'DRAFT')
      return json({
        campaigns_total: campaignState.campaigns.length,
        campaigns_live: liveCampaigns.length,
        contact_lists_total: realLists.length,
        audience_total: realLists.reduce((total, item) => total + (item.member_count ?? 0), 0),
        templates_total: templates.length,
        journeys_total: 0,
        journeys_active: 0,
      })
    }
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
    if (path.endsWith('/personalization-tags/')) return json({ next: null, previous: null, results: tags })
    if (path.endsWith('/template-starters/')) return json(starters.filter((item) => url.includes(`channel=${item.channel}`)))
    if (path.endsWith('/media-assets/') && method === 'POST') return json({ ...mediaLibrary[0], id: 'img-up', file_name: 'uploaded.png', mime_type: 'image/png' }, 201)
    if (path.endsWith('/media-assets/')) return json({ next: null, previous: null, results: mediaLibrary })
    if (path.endsWith('/activate/')) return json({ ...(options.template ?? templates[1]), status: 'ACTIVE' })
    if (/\/templates\/[^/]+\/$/.test(path) && method === 'GET') return json(options.template ?? templates[1])
    if (path.endsWith('/templates/') && method === 'POST') {
      return options.onSaveTemplate?.(call) ?? json({ ...templates[0], ...(body as Partial<Template>), id: 'tpl-new', status: 'DRAFT', latest_version: 0 }, 201)
    }
    if (path.endsWith('/templates/')) return json({ next: null, previous: null, results: templates })
    if (path.endsWith('/sender-profiles/')) return json(senders)
    // ---- contact lists: stateful, so what a test creates is there afterwards
    if (path.includes('/contact-lists/')) {
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
