/** The campaign module's part of the in-memory API: a stateful set of campaigns that answers the way the real endpoints do. */
import type { Campaign, CampaignActivity, CampaignAudience, CampaignChecklist, CampaignMetrics, CampaignRun } from '@/lib/types'

const ACTIONS: Record<string, Campaign['actions']> = {
  DRAFT: ['edit', 'clone', 'test_publish', 'publish', 'archive'], TEST_PUBLISHED: ['edit', 'clone', 'test_publish', 'publish', 'archive'],
  SCHEDULED: ['cancel_schedule', 'clone', 'archive'], PRODUCTION_PUBLISHED: ['pause', 'clone', 'results', 'archive'], ACTIVE: ['pause', 'clone', 'results', 'archive'],
  PAUSED: ['resume', 'clone', 'results', 'archive'], COMPLETED: ['clone', 'results', 'archive'], CANCELLED: ['clone', 'results', 'archive'], ARCHIVED: ['unarchive', 'clone'],
}
const LABEL: Record<string, string> = {
  DRAFT: 'Draft', TEST_PUBLISHED: 'Test Published', PRODUCTION_PUBLISHED: 'Production Published', SCHEDULED: 'Scheduled', ACTIVE: 'Active', PAUSED: 'Paused',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', ARCHIVED: 'Archived',
}

/** the fields the API derives from the status: what a campaign shows as, and what can be done with it */
export function derived(campaign: Pick<Campaign, 'status' | 'runs' | 'setup_step'>): Pick<Campaign, 'display_status' | 'display_status_label' | 'status_label' | 'actions' | 'next_run_at' | 'setup_complete'> {
  const next = campaign.runs.filter((run) => !run.test_mode && run.status === 'SCHEDULED' && run.scheduled_at && new Date(run.scheduled_at).getTime() > Date.now())
    .map((run) => run.scheduled_at as string).sort()[0] ?? null
  const shown = campaign.status === 'PRODUCTION_PUBLISHED' && next ? 'SCHEDULED' : campaign.status
  return { display_status: shown, display_status_label: LABEL[shown] ?? shown, status_label: LABEL[campaign.status] ?? campaign.status, actions: ACTIONS[shown] ?? [], next_run_at: next,
           setup_complete: !['DRAFT', 'TEST_PUBLISHED'].includes(campaign.status) || campaign.setup_step >= 6 }
}

export const moduleDefaults = {
  excluded_lists: [] as string[], tags: [] as string[], send_type: 'IMMEDIATE' as const, send_timezone: null, recurring_config: null, drip_config: null, respect_governance: true,
  rate_limit_per_hour: null, timezone_optimization: false, targets: null, published_at: null, completed_at: null, archived_at: null, list_count: 1, audience_size: 90,
  owner_name: 'Aby John', triggered_by: 'MANUAL' as const, setup_step: 6,
}

export const audienceEstimate: CampaignAudience = {
  lists: [{ id: 'cl-master', name: 'Fall Master Audience', member_count: 90, updated_at: '2026-09-02T10:00:00Z', list_environment: 'PRODUCTION', source_type: 'UPLOAD', role: 'INCLUDE' }],
  gross: 120, unique: 100, duplicates_removed: 20, excluded_by_list: 0, after_exclusions: 100, estimated_recipients: 88, excluded_by_governance: 12, marketing: true, channel: 'EMAIL',
  statuses: [{ code: 'MARKETABLE', label: 'Can receive marketing email', sendable: true, count: 88 }, { code: 'UNSUBSCRIBED', label: 'Unsubscribed', sendable: false, count: 9 },
             { code: 'HARD_BOUNCE', label: 'Bounced: the address does not exist', sendable: false, count: 3 }],
  sample: [{ party_id: 'P-1', address: 'd.alvarez@northwind.example', first_name: 'Dolores', last_name: 'Alvarez', status: 'MARKETABLE', status_label: 'Can receive marketing email' },
           { party_id: 'P-3', address: 's.ramachandran@tailspin.example', first_name: 'Sana', last_name: 'Ramachandran', status: 'UNSUBSCRIBED', status_label: 'Unsubscribed' }],
  note: 'An estimate as of today. The Campaign List is frozen, and governance decided for real, when the send starts.',
}

export const metrics: CampaignMetrics = {
  counts: { queued: 0, sent: 80, failed: 1, delivered: 76, opened: 40, clicked: 12, bounced: 4, complained: 0, unsubscribed: 2, replied: 0 },
  conversions: 5, revenue: '1250.00',
  rates: { delivery: 95, open: 52.6, click: 15.8, bounce: 5, unsubscribe: 2.6, conversion: 6.6 },
  targets: [{ measure: 'Clicks', target: 40, actual: 12, percent: 30 }, { measure: 'Revenue', target: 25000, actual: 1250, percent: 5 }],
  breakdown: { by: 'domain', rows: [{ key: 'northwind.example', sent: 50, delivered: 49, opened: 30, bounced: 1 }], note: null },
  runs: 1, test_runs: 0,
}

export const activityLog: CampaignActivity[] = [
  { id: 'a2', event_type: 'WARNING', severity: 'WARNING', message: 'Corporate frequency limits are switched off for this marketing campaign.', detail: null, actor_name: 'Aby John', campaign_run_id: null, occurred_at: '2026-09-02T11:00:00Z' },
  { id: 'a1', event_type: 'CREATED', severity: 'INFO', message: 'Created as a draft (Regular Marketing, Email).', detail: null, actor_name: 'Aby John', campaign_run_id: null, occurred_at: '2026-09-01T10:00:00Z' },
]

interface Request { path: string; url: string; method: string; body: Record<string, unknown> | null }
interface State { campaigns: Campaign[]; make: (overrides: Partial<Campaign>) => Campaign; onSave?: (call: never) => Response | null }

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const conflict = (detail: string) => json({ type: 'about:blank', title: 'Conflict', status: 409, detail }, 409)

function run(campaign: string, overrides: Partial<CampaignRun>): CampaignRun {
  return { id: `r-${Math.random().toString(36).slice(2, 8)}`, tenant: 't1', created_at: '2026-09-21T10:00:00Z', updated_at: '2026-09-21T10:00:00Z', row_version: 1, campaign, run_number: 1,
           run_type: 'ONE_TIME', status: 'SCHEDULED', test_mode: false, scheduled_at: null, started_at: null, completed_at: null, ...overrides } as CampaignRun
}

/** Answers the campaign endpoints that are not plain create / update; null hands the request back to the general mock. */
export function handleCampaigns(request: Request, state: State): Response | null {
  const { path, url, method, body } = request
  if (!path.includes('/campaigns/')) return null
  const query = new URL(url, 'http://mock').searchParams
  const put = (next: Campaign) => {
    const fresh = { ...next, ...derived(next) }
    state.campaigns = state.campaigns.map((item) => (item.id === fresh.id ? fresh : item))
    return fresh
  }

  if (path.endsWith('/campaigns/form-options/')) {
    return json({ owners: [{ id: 'u1', name: 'Aby John', email: 'aby.john@aiintelekt.com' }, { id: 'u2', name: 'Devon Okafor', email: 'devon@example.com' }], tags: ['Fall', 'VIP'],
                  timezones: ['America/Chicago', 'America/New_York', 'Asia/Kolkata', 'Europe/London'], workspace_timezone: 'America/New_York' })
  }
  if (path.endsWith('/campaigns/calendar/')) {
    // one span per campaign with a production run (or, for a live e-receipt campaign, going on from its publish), filtered by channel as the list is
    const spans = state.campaigns.filter((item) => item.status !== 'ARCHIVED' && (!query.get('channel') || item.channel === query.get('channel'))).flatMap((item) => {
      const moments = item.runs.filter((one) => !one.test_mode && one.status !== 'CANCELLED').map((one) => ({ at: (one.started_at ?? one.scheduled_at) as string, state: one.status === 'COMPLETED' || one.status === 'FAILED' ? 'SENT' : 'WAITING', label: one.sequence_label ?? null }))
      const ongoing = item.campaign_type === 'E_RECEIPT' && ['ACTIVE', 'PRODUCTION_PUBLISHED'].includes(item.status)
      if (moments.length === 0 && !ongoing) return []
      const start = moments.length ? moments.map((moment) => moment.at).sort()[0] : (item.published_at ?? item.created_at)
      return [{ campaign: item.id, name: item.name, code: item.code, channel: item.channel, campaign_type: item.campaign_type, display_status: item.display_status, is_journey_generated: item.is_journey_generated,
                setup_step: item.setup_step, setup_complete: item.setup_complete, actions: item.actions, timezone: item.send_timezone ?? 'America/New_York', start,
                end: ongoing ? null : moments.map((moment) => moment.at).sort().at(-1), ongoing, failed: item.runs.length > 0 && item.runs.every((one) => one.status === 'FAILED'), sends: moments }]
    })
    return json({ date_from: query.get('date_from'), date_to: query.get('date_to'), timezone: 'America/New_York', spans })
  }
  if (path.endsWith('/campaigns/audience-estimate/')) {
    const excluded = (query.get('exclude') ?? '').split(',').filter(Boolean).length
    return json({ ...audienceEstimate, excluded_by_list: excluded * 10, after_exclusions: 100 - excluded * 10, estimated_recipients: 88 - excluded * 10 })
  }
  if (path.endsWith('/campaigns/bulk/') && method === 'POST') {
    const ids = (body?.ids as string[]) ?? []
    const done = ids.map((id) => state.campaigns.find((item) => item.id === id)).filter((item): item is Campaign => Boolean(item)).map((item) => {
      if (body?.action === 'archive') return put({ ...item, status: 'ARCHIVED' })
      const copy = state.make({ ...item, id: `${item.id}-copy`, name: `Copy of ${item.name}`, status: 'DRAFT', runs: [], actions: undefined })
      state.campaigns = [copy, ...state.campaigns]
      return copy
    })
    return json({ action: body?.action, done: done.map((item) => ({ id: item.id, name: item.name })), skipped: [] })
  }

  const match = /\/campaigns\/([^/]+)\/(.+)\/$/.exec(path)
  if (!match) return null
  const [, id, action] = match
  const campaign = state.campaigns.find((item) => item.id === id)
  if (!campaign) return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404)

  if (action === 'checklist') {
    const problems: Record<string, string> = {}
    if (!campaign.template) problems.template = 'Choose a template.'
    if (campaign.contact_lists.length === 0 && campaign.campaign_type !== 'E_RECEIPT') problems.contact_lists = 'Attach at least one contact list.'
    if (!campaign.sender_profile) problems.sender_profile = 'Choose a sender.'
    const tested = campaign.runs.some((item) => item.test_mode)
    const answer: CampaignChecklist = {
      ready: Object.keys(problems).length === 0, problems, test_sent: tested,
      items: [...([['template', 'Template content finalized'], ['contact_lists', 'Campaign List attached'], ['sender_profile', 'Verified sender chosen']] as const)
        .map(([key, label]) => ({ key, label, ok: !(key in problems), problem: problems[key] ?? null })),
        { key: 'test', label: 'Test message sent and reviewed', ok: tested, problem: tested ? null : 'Send yourself a test before publishing.', advisory: true }],
    }
    return json(answer)
  }
  if (action === 'audience') return json({ ...audienceEstimate, ...(campaign.actions.includes('results') ? { frozen: { members: 100, generated_at: '2026-09-18T10:00:00Z', eligible: 88, suppressed: { UNSUBSCRIBED: 9, HARD_BOUNCE: 3 } } } : {}) })
  if (action === 'sample-customers') return json([{ party_id: 'P-1', name: 'Dolores Alvarez', address: 'd.alvarez@northwind.example' }])
  if (action === 'preview') {
    if (!campaign.template && !query.get('template')) return conflict('Choose a template first.')
    const text = campaign.channel === 'SMS' || campaign.channel === 'MMS'
    const who = query.get('party_id') ? 'Dolores' : 'Jordan'
    return json({ subject: text ? null : `Fall is here, ${who}`, html: text ? null : `<p>Hello ${who}</p>`, text: `Northwind: Hi ${who}. Reply STOP to opt out.`, version: 3,
                  template: query.get('template') === 'tpl-sms' ? 'Fall SMS' : 'Fall Email', tags_used: ['first_name'], customer: query.get('party_id') })
  }
  if (action === 'metrics') return json(metrics)
  if (action === 'metrics/timeseries') return json({ bucket: query.get('bucket') ?? 'hour', points: [{ at: '2026-09-18T10:00:00Z', sent: 50, delivered: 48, opened: 20, clicked: 5 }, { at: '2026-09-18T11:00:00Z', sent: 30, delivered: 28, opened: 20, clicked: 7 }] })
  if (action === 'activity') return json(activityLog)
  if (method !== 'POST') return null

  if (action === 'test-publish') {
    const to = [...((body?.to as string[]) ?? []), ...((body?.user_ids as string[]) ?? []).map((user) => (user === 'u2' ? 'devon@example.com' : 'aby.john@aiintelekt.com'))]
    const after = put({ ...campaign, status: campaign.status === 'DRAFT' ? 'TEST_PUBLISHED' : campaign.status, runs: [...campaign.runs, run(campaign.id, { test_mode: true, status: 'COMPLETED', run_number: campaign.runs.length + 1, sequence_label: 'Test' })] })
    return json({ run: 'r-test', status: after.status, results: to.map((address) => ({ to: address, ok: !address.includes('bad'), detail: address.includes('bad') ? '550 mailbox unavailable' : 'msg-1' })) })
  }
  if (action === 'publish') {
    if (!campaign.template) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { template: ['Choose a template.'] } }, 400)
    const later = campaign.send_type === 'SCHEDULED' ? campaign.scheduled_at : null
    const created = run(campaign.id, { scheduled_at: later, run_number: campaign.runs.length + 1 })
    put({ ...campaign, status: 'PRODUCTION_PUBLISHED', published_at: '2026-09-21T10:00:00Z', runs: [...campaign.runs, created] })
    return json(created, 201)
  }
  if (action === 'pause') return campaign.actions.includes('pause') ? json(put({ ...campaign, status: 'PAUSED' })) : conflict(`A ${campaign.status_label.toLowerCase()} campaign cannot be paused.`)
  if (action === 'resume') return campaign.actions.includes('resume') ? json(put({ ...campaign, status: 'ACTIVE' })) : conflict('Only a paused campaign can be resumed.')
  if (action === 'cancel-schedule') return json(put({ ...campaign, status: 'DRAFT', runs: campaign.runs.map((item) => (item.status === 'SCHEDULED' ? { ...item, status: 'CANCELLED' } : item)) }))
  if (action === 'archive') return json(put({ ...campaign, status: 'ARCHIVED', archived_at: '2026-09-21T10:00:00Z' }))
  if (action === 'unarchive') return json(put({ ...campaign, status: campaign.runs.some((item) => !item.test_mode) ? 'COMPLETED' : 'DRAFT', archived_at: null }))
  if (action === 'clone') {
    const copy = state.make({ ...campaign, id: `${campaign.id}-copy`, code: 'CMP-2026-0010', name: `Copy of ${campaign.name}`, status: 'DRAFT', runs: [], actions: undefined })
    state.campaigns = [copy, ...state.campaigns]
    return json(copy, 201)
  }
  return null
}

/** GET /campaigns/ : status / search / type filters, ordering by name, and numbered pages */
export function listCampaigns(url: string, campaigns: Campaign[]): Response {
  const query = new URL(url, 'http://mock').searchParams
  const status = query.get('status')
  const search = (query.get('search') ?? '').toLowerCase()
  let rows = campaigns.filter((item) => (status ? item.display_status === status : item.status !== 'ARCHIVED'))
    .filter((item) => item.name.toLowerCase().includes(search) && (!query.get('type') || item.campaign_type === query.get('type')) && (!query.get('channel') || item.channel === query.get('channel'))
      && (!query.get('tag') || item.tags.includes(query.get('tag') as string)))
  const ordering = query.get('ordering') ?? ''
  if (ordering.replace('-', '') === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name) * (ordering.startsWith('-') ? -1 : 1))
  const size = Number(query.get('page_size') ?? 50)
  const page = Number(query.get('page') ?? 1)
  return json({ count: rows.length, next: page * size < rows.length ? `?page=${page + 1}` : null, previous: page > 1 ? `?page=${page - 1}` : null, results: rows.slice((page - 1) * size, page * size) })
}
