/** Reports, suppressions, notifications and approvals for the mock API: shaped like the backend's answers, stateful where a test writes. */
import type {
  JourneysReport,
  ApprovalSettings, HomeOverview, NotificationSettings, PosReceived, PosSettings, PreferenceCenterSettings, ReportCompareCampaign, ReportSchedule, ReportSummary, Store, SubscriptionTopic,
  SuppressionRow, SuppressionSummary,
} from '@/lib/types'

interface Request {
  path: string
  url: string
  method: string
  body: Record<string, unknown> | null
}

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const invalid = (errors: Record<string, string[]>) => json({ type: 'about:blank', title: 'Invalid input', status: 400, errors }, 400)
const rates = (delivery: number, open: number, click: number, bounce: number, unsubscribe: number) => ({ delivery, open, click, bounce, unsubscribe })

const journeyCounts = (entered: number, converted: number, revenue: number, sent: number, delivered: number, opened: number, clicked: number, held_back = 0, failed = 0) =>
  ({ entered, converted, revenue, sent, delivered, opened, clicked, bounced: 0, held_back, failed })
const journeyRates = (row: { entered: number; converted: number; sent: number; delivered: number; opened: number; clicked: number }) => ({
  conversion: row.entered ? Math.round((row.converted / row.entered) * 1000) / 10 : null, delivery: row.sent ? Math.round((row.delivered / row.sent) * 1000) / 10 : null,
  open: row.delivered ? Math.round((row.opened / row.delivered) * 1000) / 10 : null, click: row.delivered ? Math.round((row.clicked / row.delivered) * 1000) / 10 : null,
})
const welcome = { id: 'j1', name: 'Welcome Series', status: 'ACTIVE', population_mode: 'EVENT_TRIGGERED' }
const winBack = { id: 'j2', name: 'Win-Back Lapsed Customers', status: 'PAUSED', population_mode: 'CONTINUOUSLY_QUALIFYING' }
const welcomeTotals = journeyCounts(312, 48, 2140.5, 900, 870, 410, 95, 12, 3)
const winBackTotals = journeyCounts(140, 9, 610, 280, 270, 90, 20, 30, 0)
const allTotals = journeyCounts(452, 57, 2750.5, 1180, 1140, 500, 115, 42, 3)
export const journeysReport: JourneysReport = {
  period: { from: '2026-09-01', to: '2026-09-30', timezone: 'America/New_York', days: 30 },
  journey: null,
  journeys: [welcome, winBack],
  totals: { ...allTotals, journeys: 2 },
  rates: journeyRates(allTotals),
  days: [{ day: '2026-09-02', ...journeyCounts(120, 10, 400, 300, 290, 120, 30) }, { day: '2026-09-15', ...journeyCounts(332, 47, 2350.5, 880, 850, 380, 85, 42, 3) }],
  by_journey: [{ ...welcome, ...welcomeTotals, rates: journeyRates(welcomeTotals) }, { ...winBack, ...winBackTotals, rates: journeyRates(winBackTotals) }],
  rows: [{ journey_id: 'j1', journey_name: 'Welcome Series', day: '2026-09-02', ...journeyCounts(120, 10, 400, 300, 290, 120, 30) },
         { journey_id: 'j1', journey_name: 'Welcome Series', day: '2026-09-15', ...journeyCounts(192, 38, 1740.5, 600, 580, 290, 65, 12, 3) },
         { journey_id: 'j2', journey_name: 'Win-Back Lapsed Customers', day: '2026-09-15', ...journeyCounts(140, 9, 610, 280, 270, 90, 20, 30, 0) }],
}

export const reportSummary: ReportSummary = {
  period: { from: '2026-09-01', to: '2026-09-26', timezone: 'America/New_York', days: 26 },
  channel: null,
  totals: { sent: 18_402, delivered: 17_924, opened: 7_491, clicked: 1_129, bounced: 350, complained: 4, failed: 128, unsubscribed: 22, replied: 3, campaigns: 3, revenue: 48_210.5, conversions: 212 },
  rates: rates(97.4, 41.8, 6.3, 1.9, 0.1),
  by_channel: {
    EMAIL: { sent: 18_102, delivered: 17_630, opened: 7_491, clicked: 1_120, bounced: 350, complained: 4, failed: 122 },
    SMS: { sent: 300, delivered: 294, opened: 0, clicked: 9, bounced: 0, complained: 0, failed: 6 },
  },
  days: [
    { day: '2026-09-09', sent: 12_000, delivered: 11_700, opened: 5_100, clicked: 800 },
    { day: '2026-09-19', sent: 6_402, delivered: 6_224, opened: 2_391, clicked: 329 },
  ],
  campaigns: [
    { id: 'c1', name: 'Fall Launch', channel: 'EMAIL', campaign_type: 'REGULAR_MARKETING', first_sent_at: '2026-09-09T12:00:00Z', sent: 12_000, delivered: 11_700, opened: 5_100, clicked: 800, bounced: 300,
      complained: 3, failed: 0, unsubscribed: 15, revenue: 31_880, conversions: 150, rates: rates(97.5, 43.6, 6.8, 2.5, 0.1) },
    { id: 'c2', name: 'Spring Clearance', channel: 'EMAIL', campaign_type: 'REGULAR_MARKETING', first_sent_at: '2026-09-19T14:00:00Z', sent: 6_102, delivered: 5_930, opened: 2_391, clicked: 320,
      bounced: 50, complained: 1, failed: 122, unsubscribed: 7, revenue: 16_330.5, conversions: 62, rates: rates(97.2, 40.3, 5.4, 0.8, 0.1) },
    { id: 'c3', name: 'Weekend SMS', channel: 'SMS', campaign_type: 'REGULAR_MARKETING', first_sent_at: '2026-09-19T15:00:00Z', sent: 300, delivered: 294, opened: 0, clicked: 9, bounced: 0,
      complained: 0, failed: 6, unsubscribed: 0, revenue: null, conversions: 0, rates: rates(98, 0, 3.1, 0, 0) },
  ],
  highlights: {
    highest_open_rate: { id: 'c1', name: 'Fall Launch', rates: rates(97.5, 43.6, 6.8, 2.5, 0.1) },
    highest_click_rate: { id: 'c1', name: 'Fall Launch', rates: rates(97.5, 43.6, 6.8, 2.5, 0.1) },
    most_unsubscribes: { id: 'c2', name: 'Spring Clearance', rates: rates(97.2, 40.3, 5.4, 0.8, 0.1) },
    best_send_hour: { hour: 10, open_rate: 46.3 },
  },
}

function compared(id: string): ReportCompareCampaign {
  const row = reportSummary.campaigns.find((item) => item.id === id) ?? reportSummary.campaigns[0]
  return {
    id: row.id, name: row.name, channel: row.channel, campaign_type: row.campaign_type, status: 'COMPLETED', published_at: row.first_sent_at,
    metrics: {
      counts: { queued: 0, sent: row.sent, failed: row.failed, delivered: row.delivered, opened: row.opened, clicked: row.clicked, bounced: row.bounced, complained: row.complained, unsubscribed: row.unsubscribed, replied: 0 },
      conversions: row.conversions, revenue: row.revenue, rates: { ...row.rates, conversion: 1.2 }, targets: [], breakdown: { by: 'domain', rows: [], note: null },
    } as unknown as ReportCompareCampaign['metrics'],
    days: [{ at: `${(row.first_sent_at ?? '2026-09-01T00:00:00Z').slice(0, 10)}T00:00:00Z`, sent: row.sent, delivered: row.delivered, opened: row.opened, clicked: row.clicked }],
  }
}

export const suppressionRows: SuppressionRow[] = [
  { kind: 'CONTACT_POINT', id: 'cp-1', channel: 'EMAIL', contact: 'd.alvarez@northwind.example', party_id: 'P-1', name: 'Dolores Alvarez', reason: 'HARD_BOUNCE', reason_label: 'Hard Bounce',
    group: 'BOUNCED', source: 'POSTAL', source_label: 'Postal', detail: '5.1.1 user unknown', since: '2026-09-19T09:00:00Z', can_unblock: true },
  { kind: 'CONSENT', id: 'cs-2', channel: 'PHONE', contact: '+14045550002', party_id: 'P-2', name: 'Miriam Okonkwo', reason: 'OPTED_OUT', reason_label: 'Opted Out',
    group: 'UNSUBSCRIBED', source: 'SMS_STOP', source_label: 'Replied STOP', detail: null, since: '2026-09-17T09:00:00Z', can_unblock: false },
  { kind: 'CONTACT_POINT', id: 'cp-3', channel: 'EMAIL', contact: 'j.lee@fabrikam.example', party_id: 'P-9', name: 'Jordan Lee', reason: 'COMPLAINT', reason_label: 'Complaint',
    group: 'COMPLAINED', source: 'SENDGRID', source_label: 'SendGrid', detail: 'spam report', since: '2026-09-03T09:00:00Z', can_unblock: false },
  { kind: 'CONTACT_POINT', id: 'cp-4', channel: 'EMAIL', contact: 'promo@competitor.example', party_id: null, name: null, reason: 'MANUAL', reason_label: 'Blocked',
    group: 'BLOCKED', source: 'IMPORT', source_label: 'Import', detail: 'legal hold list', since: '2026-09-12T09:00:00Z', can_unblock: true },
]

const CATALOGUE = [
  { key: 'send_completed', label: 'Send completed', hint: 'with sent and failed counts' },
  { key: 'send_failed', label: 'Send failed', hint: 'the run could not start or nothing went out' },
  { key: 'approval_requested', label: 'Approval requested', hint: 'everyone who can approve is always emailed; this adds the recipients and the webhook' },
  { key: 'approval_decided', label: 'Approved or sent back', hint: 'to the person who asked' },
  { key: 'engine_trouble', label: 'Sending engine trouble', hint: 'a circuit opened after repeated failures' },
  { key: 'ab_winner', label: 'A/B winner chosen', hint: 'with the two rates' },
  { key: 'weekly_report', label: 'Weekly report', hint: 'Monday 08:00 in the workspace\'s time zone, the last 7 days' },
]
const ALL_OFF = { owner: false, recipients: false, webhook: false }

export interface WorkspaceToolsState {
  /** GET /home/overview/: the same answer whatever the period, channel or campaigns asked for */
  overview: HomeOverview
  schedule: ReportSchedule
  suppressions: SuppressionRow[]
  notifications: NotificationSettings
  approvals: ApprovalSettings
  preferenceCenter: PreferenceCenterSettings
  topics: SubscriptionTopic[]
  pos: PosSettings
  stores: Store[]
  received: PosReceived[]
}

/** Home's overview for the busy sample workspace: two alerts, a fortnight of revenue against cost, governance holds, three journeys */
export function homeOverview(): HomeOverview {
  const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
  return {
    period: { from: '2026-09-01', to: '2026-09-30', timezone: 'America/New_York', days: 30 },
    attention: { failed_ids: ['c-failed'], awaiting_publish: 2, awaiting_approval: 1 },
    revenue_cost: {
      granularity: 'day',
      points: days.map((day, index) => ({ day, revenue: 6_000 + index * 500, cost: 400 + index * 10, target_pace: 7_000 })),
      by_campaign: { top: [{ id: 'c1', name: 'Fall Launch', revenue: 31_880 }, { id: 'c2', name: 'Spring Clearance', revenue: 8_120 }], others: { count: 3, revenue: 2_400 } },
      summary: { revenue: 42_400, cost: 2_100, roi: 20.19, revenue_per_1000_delivered: 2_365.6 },
    },
    governance: { contacted: 12_380, held_back: 940, reasons: { frequency_cap: 500, no_consent: 300, suppression: 140 } },
    journeys: {
      rows: [
        { id: 'j-cart', name: 'Cart Recovery', status: 'FAILED', channels: ['EMAIL', 'SMS'], paused_at: null, paused_by: null, failing_since: '2026-09-30T04:12:00Z', failing_step: 'SMS', in_flight: 1_206, entered: 9_480, completed: 1_223, conversion_rate: 12.9 },
        { id: 'j-birthday', name: 'Birthday Reward', status: 'PAUSED', channels: ['EMAIL'], paused_at: '2026-09-28T15:00:00Z', paused_by: 'Maya Patel', failing_since: null, failing_step: null, in_flight: 640, entered: 1_880, completed: 286, conversion_rate: 15.2 },
        { id: 'j-welcome', name: 'Welcome Series', status: 'ACTIVE', channels: ['EMAIL', 'SMS'], paused_at: null, paused_by: null, failing_since: null, failing_step: null, in_flight: 3_842, entered: 6_120, completed: 514, conversion_rate: 8.4 },
      ],
      total: 3,
    },
  }
}

export const topicRows: SubscriptionTopic[] = [
  { id: 'top-1', code: 'rewards_and_offers', name: 'Rewards and offers', description: 'Member offers, points balance and birthday rewards.', channels: ['EMAIL', 'SMS'], is_shown: true, sort_order: 10, opted_out: 312, campaigns: 2, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
  { id: 'top-2', code: 'new_arrivals', name: 'New arrivals', description: 'What is new in store and online, about twice a month.', channels: ['EMAIL'], is_shown: true, sort_order: 20, opted_out: 1048, campaigns: 0, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
]

export function workspaceToolsState(overrides: Partial<WorkspaceToolsState> = {}): WorkspaceToolsState {
  return {
    overview: homeOverview(),
    schedule: { enabled: false, weekday: 0, hour: 8, recipients: [], last_sent_on: null },
    suppressions: suppressionRows.map((row) => ({ ...row })),
    notifications: {
      emails: [], webhook_url: '', webhook_tested_at: null, muted_integrations: [], catalogue: CATALOGUE,
      events: {
        send_completed: { owner: true, recipients: false, webhook: true }, send_failed: { owner: true, recipients: true, webhook: true },
        approval_requested: { ...ALL_OFF, webhook: true }, approval_decided: { ...ALL_OFF, owner: true }, engine_trouble: { ...ALL_OFF, recipients: true, webhook: true },
        ab_winner: { ...ALL_OFF, owner: true }, weekly_report: { ...ALL_OFF, recipients: true },
      },
    },
    approvals: { require_approval: false, permission: 'campaign.approve', awaiting: 0, approvers: [{ id: 'u1', name: 'Aby John', email: 'aby.john@aiintelekt.com' }, { id: 'u3', name: 'Maria Chen', email: 'maria@example.com' }] },
    preferenceCenter: { enabled: false, brand_name: '', heading: 'Choose what you receive', email_description: 'Offers, news and events by email.', sms_description: 'Offers and reminders by text. Message and data rates may apply.',
                        footer: '', privacy_url: '', allow_opt_in: true, workspace_name: 'Northwind Apparel', tag: '{{preference_url}}', preview_url: 'https://cep.example.com/api/v1/public/preferences/?t=preview',
                        stats: { days: 30, opened: 1284, unsubscribed: 61, opted_in: 9, topics_unticked: 286 }, topics: 2 },
    topics: topicRows.map((row) => ({ ...row })),
    pos: { campaign: null, return_campaign: null, text_campaign: null, default_country: 'US', endpoint: 'https://cep.example.com/api/v1/pos/transactions/', tenant_key: 'NWA', headers: ['X-Tenant-Key', 'accessTokenKey'], scope: 'receipts:send',
           campaigns: [{ id: 'c-receipt', name: 'Store E-Receipt', code: 'CMP-2026-0004', status: 'ACTIVE', channel: 'EMAIL', ready: true }, { id: 'c-receipt-draft', name: 'Holiday Receipt', code: null, status: 'DRAFT', channel: 'EMAIL', ready: false },
                       { id: 'c-receipt-text', name: 'Text Receipt', code: 'CMP-2026-0009', status: 'ACTIVE', channel: 'SMS', ready: true }], stores: 1 },
    stores: [{ id: 'st-801', store_number: '801', name: 'Northwind Apparel Buckhead', brand: 'Northwind Apparel', address1: '1200 Peachtree St NE', address2: null, city: 'Atlanta', state: 'GA', postal_code: '30309', country: 'US',
               district: null, phone: '(404) 555-0100', email: null, manager: 'Dana Reyes', return_policy: 'Returns within 30 days with this receipt.', url1: null, url2: null, url3: null, url4: null, image_url: null, is_active: true,
               created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' }],
    received: [
      { id: 901, at: '2026-09-30T18:07:20Z', transaction_id: '243309', code: 'S100', code_label: 'Receipt sent', message: null, http_status: 200, outcome: 'OK', execution_id: 5001, message_id: 'm-1@postal.example', bytes: 18_402, duration_ms: 412 },
      { id: 902, at: '2026-09-30T18:09:03Z', transaction_id: '243310', code: 'S101', code_label: 'No email address', message: 'Accepted; the recipient has no email address, so no e-receipt was sent.', http_status: 200, outcome: 'OK', execution_id: null, message_id: null, bytes: 17_990, duration_ms: 88 },
      { id: 903, at: '2026-09-30T18:12:41Z', transaction_id: null, code: 'E103', code_label: 'Document refused', message: 'The document does not follow TTDR 3.2.2: line 3: TTDRVersion', http_status: 400, outcome: 'REJECTED', execution_id: null, message_id: null, bytes: 2_100, duration_ms: 15 },
    ],
    ...overrides,
  }
}

function summaryOf(rows: SuppressionRow[]): SuppressionSummary {
  const groups = (['UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'BLOCKED'] as const).map((key) => {
    const own = rows.filter((row) => row.group === key)
    return { key, label: key === 'BLOCKED' ? 'Blocked by You' : key.charAt(0) + key.slice(1).toLowerCase(), count: own.length,
             email: own.filter((row) => row.channel === 'EMAIL').length, phone: own.filter((row) => row.channel === 'PHONE').length, this_week: 0 }
  })
  return { total: rows.length, this_week: 1, groups }
}

export function handleWorkspaceTools({ path, url, method, body }: Request, state: WorkspaceToolsState): Response | null {
  const query = new URL(url, 'http://mock').searchParams
  if (path.endsWith('/home/overview/')) return json({ ...state.overview, period: { ...state.overview.period, from: query.get('from') ?? state.overview.period.from, to: query.get('to') ?? state.overview.period.to } })
  if (path.endsWith('/reports/summary/')) {
    const channel = query.get('channel')
    const campaigns = reportSummary.campaigns.filter((row) => !channel || row.channel === channel)
    return json({ ...reportSummary, channel, period: { ...reportSummary.period, from: query.get('from') ?? reportSummary.period.from, to: query.get('to') ?? reportSummary.period.to }, campaigns })
  }
  if (path.endsWith('/reports/campaigns.csv')) return new Response('campaign,channel,sent\nFall Launch,EMAIL,12000\n', { headers: { 'Content-Type': 'text/csv' } })
  if (path.endsWith('/reports/journeys/')) {
    const journey = query.get('journey')
    const rows = journeysReport.rows.filter((row) => !journey || row.journey_id === journey)
    const by_journey = journeysReport.by_journey.filter((row) => !journey || row.id === journey)
    const totals = { ...journeysReport.totals, entered: rows.reduce((sum, row) => sum + row.entered, 0), journeys: by_journey.length }
    return json({ ...journeysReport, journey, period: { ...journeysReport.period, from: query.get('from') ?? journeysReport.period.from, to: query.get('to') ?? journeysReport.period.to }, rows, by_journey, totals })
  }
  if (path.endsWith('/reports/journeys.csv')) return new Response('journey,day,entered\nWelcome Series,2026-09-02,120\n', { headers: { 'Content-Type': 'text/csv' } })
  if (path.endsWith('/reports/compare/')) return json({ campaigns: (query.get('ids') ?? '').split(',').filter(Boolean).map(compared) })
  if (path.endsWith('/reports/schedule/')) {
    if (method === 'PUT') {
      const recipients = (body?.recipients as string[]) ?? []
      const bad = recipients.find((item) => !item.includes('@'))
      if (bad) return invalid({ recipients: [`${bad} is not an email address.`] })
      state.schedule = { ...state.schedule, ...(body as Partial<ReportSchedule>), recipients }
    }
    return json(state.schedule)
  }

  if (path.endsWith('/suppressions/summary/')) return json(summaryOf(state.suppressions))
  if (path.endsWith('/suppressions/export.csv')) return new Response('contact,channel,reason\nd.alvarez@northwind.example,EMAIL,HARD_BOUNCE\n', { headers: { 'Content-Type': 'text/csv' } })
  if (path.endsWith('/suppressions/block/') && method === 'POST') {
    const values = body ? ((body.values as string[]) ?? []) : ['from-file@example.com']
    const invalidValues = values.filter((item) => !item.includes('@') && !/^\+?\d{10,15}$/.test(item))
    const fresh = values.filter((item) => !invalidValues.includes(item) && !state.suppressions.some((row) => row.contact === item))
    state.suppressions = [...fresh.map((contact, index) => ({ kind: 'CONTACT_POINT' as const, id: `cp-new-${index}`, channel: contact.includes('@') ? 'EMAIL' as const : 'PHONE' as const, contact, party_id: null, name: null,
      reason: 'MANUAL', reason_label: 'Blocked', group: 'BLOCKED' as const, source: 'CSR', source_label: 'By hand', detail: body?.note ? String(body.note) : null, since: '2026-09-29T10:00:00Z', can_unblock: true })), ...state.suppressions]
    return json({ blocked: fresh.length, already_blocked: values.length - fresh.length - invalidValues.length, invalid: invalidValues.slice(0, 20), invalid_count: invalidValues.length })
  }
  const unblock = /\/suppressions\/([A-Z_]+)\/([^/]+)\/unblock\/$/.exec(path)
  if (unblock && method === 'POST') {
    const row = state.suppressions.find((item) => item.id === unblock[2])
    if (!row?.can_unblock) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'An opt-out or a complaint cannot be undone here.' }, 409)
    state.suppressions = state.suppressions.filter((item) => item.id !== row.id)
    return json({ unblocked: true })
  }
  if (path.endsWith('/suppressions/')) {
    const needle = (query.get('search') ?? '').toLowerCase()
    const rows = state.suppressions.filter((row) => (!query.get('channel') || row.channel === query.get('channel')) && (!query.get('reason') || row.group === query.get('reason'))
      && (!needle || row.contact.toLowerCase().includes(needle) || (row.party_id ?? '').toLowerCase().includes(needle)))
    const page = Number(query.get('page') ?? 1)
    const size = Number(query.get('page_size') ?? 25)
    return json({ count: rows.length, page, page_size: size, results: rows.slice((page - 1) * size, page * size) })
  }

  if (path.endsWith('/workspace/notifications/test/') && method === 'POST') {
    const config = state.notifications
    const hooked = config.webhook_url !== '' && !config.webhook_url.includes('broken')
    if (hooked) state.notifications = { ...config, webhook_tested_at: '2026-09-29T10:00:00Z' }
    return json({ email: config.emails.length, webhook: hooked, webhook_configured: config.webhook_url !== '', emails_configured: config.emails.length })
  }
  if (path.endsWith('/workspace/notifications/')) {
    if (method === 'PUT') {
      const url = String(body?.webhook_url ?? '')
      if (url && !/^https?:\/\//.test(url)) return invalid({ webhook_url: ['The webhook must be an http:// or https:// address.'] })
      state.notifications = { ...state.notifications, emails: (body?.emails as string[]) ?? state.notifications.emails, webhook_url: url,
                              events: (body?.events as NotificationSettings['events']) ?? state.notifications.events, webhook_tested_at: url === state.notifications.webhook_url ? state.notifications.webhook_tested_at : null }
    }
    return json(state.notifications)
  }
  if (path.endsWith('/workspace/pos/received/')) {
    const code = query.get('code'), q = query.get('q')
    return json({ results: state.received.filter((row) => (!code || row.code === code) && (!q || (row.transaction_id ?? '').includes(q))), more: false, next_before: null, days: 30 })
  }
  if (path.endsWith('/workspace/pos/')) {
    if (method === 'PUT') {
      const next = body as Partial<PosSettings>
      for (const key of ['campaign', 'return_campaign'] as const) {
        if (key in next && next[key] && !state.pos.campaigns.some((c) => c.id === next[key])) return invalid({ [key]: ["Choose one of this workspace's e-receipt campaigns."] })
      }
      state.pos = { ...state.pos, ...next }
    }
    return json({ ...state.pos, stores: state.stores.length })
  }
  if (path.endsWith('/stores/import/')) { state.stores = [...state.stores, { ...state.stores[0], id: 'st-802', store_number: '802', name: 'Northwind Apparel Midtown' }]; return json({ added: 1, updated: 0, problems: [] }) }
  if (path.endsWith('/stores/') && !path.includes('/report-databases/')) {
    if (method === 'POST') {
      const input = body as Partial<Store>
      if (!input.store_number) return invalid({ store_number: ['Give the store its number, as the point of sale sends it.'] })
      if (state.stores.some((row) => row.store_number === input.store_number)) return invalid({ store_number: [`Store ${input.store_number} is already listed.`] })
      const row = { ...state.stores[0], ...input, id: `st-${input.store_number}`, is_active: input.is_active !== false } as Store
      state.stores = [...state.stores, row]
      return json(row, 201)
    }
    return json(state.stores)
  }
  const store = path.includes('/report-databases/') ? null : path.match(/\/stores\/([^/]+)\/$/)
  if (store) {
    const index = state.stores.findIndex((row) => row.id === store[1])
    if (index < 0) return json({ detail: 'Not found.' }, 404)
    if (method === 'DELETE') { state.stores = state.stores.filter((row) => row.id !== store[1]); return json(null, 204) }
    if (method === 'PATCH') state.stores[index] = { ...state.stores[index], ...(body as Partial<Store>) }
    return json(state.stores[index])
  }
  if (path.endsWith('/workspace/preference-center/')) {
    if (method === 'PUT') {
      const next = body as Partial<PreferenceCenterSettings>
      if (typeof next.privacy_url === 'string' && next.privacy_url && !/^https?:\/\//.test(next.privacy_url)) return invalid({ privacy_url: ['A full address, starting with https://.'] })
      state.preferenceCenter = { ...state.preferenceCenter, ...next }
    }
    return json({ ...state.preferenceCenter, topics: state.topics.length })
  }
  if (path.endsWith('/subscription-topics/')) {
    if (method === 'POST') {
      const input = body as Record<string, unknown>
      if (!String(input.name ?? '').trim()) return invalid({ name: ['Give the topic a name.'] })
      const row: SubscriptionTopic = { id: `top-${state.topics.length + 1}`, code: String(input.name).toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: String(input.name), description: (input.description as string) || null,
                                       channels: (input.channels as SubscriptionTopic['channels']) ?? ['EMAIL'], is_shown: input.is_shown !== false, sort_order: (state.topics.at(-1)?.sort_order ?? 0) + 10, opted_out: 0, campaigns: 0,
                                       created_at: '2026-09-26T10:00:00Z', updated_at: '2026-09-26T10:00:00Z' }
      state.topics = [...state.topics, row]
      return json(row, 201)
    }
    return json({ enabled: state.preferenceCenter.enabled, results: state.topics })
  }
  const topic = path.match(/\/subscription-topics\/([^/]+)\/$/)
  if (topic) {
    const index = state.topics.findIndex((row) => row.id === topic[1])
    if (index < 0) return json({ detail: 'Not found.' }, 404)
    if (method === 'DELETE') { state.topics = state.topics.filter((row) => row.id !== topic[1]); return json(null, 204) }
    if (method === 'PATCH') { state.topics[index] = { ...state.topics[index], ...(body as Partial<SubscriptionTopic>) } }
    return json(state.topics[index])
  }
  if (path.endsWith('/workspace/approvals/')) {
    if (method === 'PUT') {
      if (body?.require_approval && state.approvals.approvers.length === 0) return invalid({ require_approval: ['Give a role the campaign.approve permission first (Settings → Roles), so someone can approve.'] })
      state.approvals = { ...state.approvals, require_approval: Boolean(body?.require_approval) }
    }
    return json(state.approvals)
  }
  return null
}
