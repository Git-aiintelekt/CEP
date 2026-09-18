/** In-memory stand-in for the CEP API used by the component tests. */
import { vi } from 'vitest'

import type { ApiKey, AuthOptions, Campaign, ContactList, Invoice, MailServerSettings, Me, MediaAsset, Message, PersonalizationTag, Role, SecuritySettings, SenderProfile, SettingsUser, SupportAccess, Template, TemplateStarter,
              Usage, Workspace } from '@/lib/types'

export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

const audit = { tenant: 't1', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', row_version: 1 }

export const me = {
  principal: { kind: 'user', id: 'u1', email: 'aby.john@aiintelekt.com', display_name: 'Aby John', is_platform_admin: false,
               permissions: ['campaign.edit', 'campaign.publish', 'template.edit', 'user.admin'] },
  tenant: { id: 't1', code: 'NWA', timezone: 'America/New_York', db_alias: 'default', db_status: 'ACTIVE' },
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

const list = (id: string, name: string, member_count: number, is_master = false): ContactList => ({
  ...audit, id, name, description: null, source_type: 'UPLOAD', list_kind: 'STATIC', is_master, refresh_mode: 'MANUAL',
  last_refreshed_at: null, list_environment: 'PRODUCTION', status: 'ACTIVE', member_count, parent_contact_list: null,
})
export const contactLists: ContactList[] = [list('cl-master', 'Fall Master Audience', 90, true), list('cl-ga', 'Georgia only', 30)]

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
  return {
    ...audit, id: 'c1', code: 'CMP-2026-0001', name: 'Fall Launch', description: 'Seasonal launch', campaign_type: 'REGULAR_MARKETING',
    channel: 'EMAIL', status: 'DRAFT', status_label: 'Draft', solicitation_type: 'MARKETING', is_journey_generated: false, scheduled_at: null,
    template: 'tpl-email', sender_profile: 'snd-email', origin_journey: null, owner_user: 'u1', template_name: 'Fall Email',
    sender_profile_name: 'Northwind Rewards', contact_lists: ['cl-master'],
    contact_list_details: [{ id: 'cl-master', name: 'Fall Master Audience', list_kind: 'STATIC', is_master: true, list_environment: 'PRODUCTION', status: 'ACTIVE', member_count: 90 }],
    runs: [], ...overrides,
  }
}

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface MockOptions {
  campaign?: Campaign
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
  /** GET /auth/options/ ; default: no single sign-on */
  authOptions?: Partial<AuthOptions>
  /** GET /auth/mfa/ starts from this */
  mfaEnabled?: boolean
  /** answer for PUT /workspace/security/ ; default merges the body into the stored settings */
  onSecurityWrite?: (call: Call) => Response | null
  /** GET /workspace/mail-server/ starts from this */
  mailServer?: Partial<MailServerSettings>
}

/** the code the mock authenticator "shows" */
export const MFA_CODE = '123456'

/** Installs a fetch mock; returns the recorded calls. Call signIn() to start authenticated. */
export function installMockApi(options: MockOptions = {}) {
  const calls: Call[] = []
  const campaign = options.campaign ?? makeCampaign()
  let mfaEnabled = options.mfaEnabled ?? false
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
    if (path.endsWith('/contact-lists/')) return json({ next: null, previous: null, results: contactLists })
    if (path.endsWith('/publish/')) return json({ id: 'r1', run_number: 1 }, 201)
    if ((method === 'POST' && path.endsWith('/campaigns/')) || method === 'PATCH') {
      const custom = options.onSave?.(call)
      if (custom) return custom
      return json(makeCampaign({ ...(body as Partial<Campaign>), id: method === 'POST' ? 'c-new' : campaign.id, code: (body?.code as string) ?? 'CMP-2026-0009', row_version: 2 }), method === 'POST' ? 201 : 200)
    }
    if (method === 'DELETE') return json(null, 204)
    if (/\/campaigns\/[^/]+\/$/.test(path)) return json(campaign)
    if (path.endsWith('/campaigns/')) return json({ next: null, previous: null, results: [campaign] })
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
