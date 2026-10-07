/** The campaign module's part of the in-memory API: a stateful set of campaigns that answers the way the real endpoints do. */
import type { Campaign, CampaignActivity, CampaignAudience, CampaignChecklist, CampaignMetrics, CampaignRun, CampaignRunVariant, DripStep } from '@/lib/types'

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
export function derived(campaign: Pick<Campaign, 'status' | 'runs' | 'setup_step'> & { is_journey_generated?: boolean; approval_required?: boolean; approval?: Campaign['approval']; campaign_type?: string }): Pick<Campaign, 'display_status' | 'display_status_label' | 'status_label' | 'actions' | 'next_run_at' | 'setup_complete'> {
  const next = campaign.runs.filter((run) => !run.test_mode && run.status === 'SCHEDULED' && run.scheduled_at && new Date(run.scheduled_at).getTime() > Date.now())
    .map((run) => run.scheduled_at as string).sort()[0] ?? null
  const shown = campaign.status === 'PRODUCTION_PUBLISHED' && next ? 'SCHEDULED' : campaign.status
  // with approval required: the author asks while it is a draft or test published; anyone but the person who asked (u1 is the signed-in user) decides
  const approval: Campaign['actions'] = []
  if (campaign.approval_required && ['DRAFT', 'TEST_PUBLISHED'].includes(campaign.status)) {
    if (!campaign.approval || campaign.approval.status === 'RETURNED') approval.push('request_approval')
    else if (campaign.approval.status === 'REQUESTED' && campaign.approval.requested_by !== 'u1') approval.push('approve', 'send_back')
  }
  // a running or paused drip can stop its remaining messages (drip_lifecycle.actions)
  const own = campaign.campaign_type === 'DRIP' && ['ACTIVE', 'PAUSED'].includes(shown) ? (ACTIONS[shown] ?? []).flatMap((action) => (action === 'clone' ? ['stop' as const, action] : [action])) : ACTIONS[shown]
  // journey campaigns: view and clone only, as the API says
  return { display_status: shown, display_status_label: LABEL[shown] ?? shown, status_label: LABEL[campaign.status] ?? campaign.status,
           actions: [...(own ?? []).filter((action) => !campaign.is_journey_generated || action === 'clone' || action === 'results'), ...approval], next_run_at: next,
           setup_complete: !['DRAFT', 'TEST_PUBLISHED'].includes(campaign.status) || campaign.setup_step >= 6 }
}

export const moduleDefaults = {
  excluded_lists: [] as string[], tags: [] as string[], send_type: 'IMMEDIATE' as const, send_timezone: null, recurring_config: null, drip_config: null, respect_governance: true,
  rate_limit_per_hour: null, timezone_optimization: false, targets: null, published_at: null, completed_at: null, archived_at: null, list_count: 1, audience_size: 90,
  owner_name: 'Aby John', triggered_by: 'MANUAL' as const, setup_step: 6, approval_required: false, approval: null, ab_config: null,
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
interface State {
  campaigns: Campaign[]; tags?: string[]; make: (overrides: Partial<Campaign>) => Campaign; onSave?: (call: never) => Response | null
  /** merged over the audience answer */
  audience?: Partial<CampaignAudience>
  audienceExportFails?: boolean
  metrics?: Partial<CampaignMetrics>
  activity?: CampaignActivity[]
  activityFails?: boolean
  estimate?: Partial<CampaignAudience>
  /** a production run's subject line test (GET /campaigns/{id}/runs/{run}/) */
  variants?: CampaignRunVariant[]
  /** a drip's messages by campaign id (GET /campaigns/{id}/steps/); a drip not listed has the API's Day-0 message */
  steps?: Record<string, DripStep[]>
  /** drip messages whose test send fails (by step id) */
  dripTestFails?: string[]
  /** GET /campaigns/{id}/resume-plan/ ; default: nothing missed */
  resumePlan?: { missed: unknown[]; moved: unknown[]; unchanged: unknown[] }
  /** extra review warnings by step id (GET steps/review/ adds TOO_CLOSE itself) */
  dripWarnings?: Record<string, { code: 'TOO_CLOSE' | 'FREQUENCY' | 'QUIET_HOURS'; message: string }[]>
}

/** one message of a drip, as GET /campaigns/{id}/steps/ answers it: Day 0, no template yet, unless overridden */
export function makeStep(overrides: Partial<DripStep> = {}): DripStep {
  return {
    id: `st-${Math.random().toString(36).slice(2, 8)}`, position: 1, day: 0, name: '', send_time: null, effective_send_time: null, scheduled_for: null, template: null,
    subject_line: null, preheader: null, ab_config: null, problems: overrides.template ? [] : ['NEEDS_TEMPLATE'], text_excerpt: null, row_version: 1, run: null,
    test: { status: 'NOT_SENT', sent_at: null, error: null, run_id: null }, ...overrides,
  }
}

/** A and B half-way: 3 each sent, 24 waiting for the winner by open rate */
export const waitingVariants: CampaignRunVariant[] = (['A', 'B'] as const).map((key) => ({
  variant_key: key, subject_line: key === 'A' ? 'Fall is here, Jordan' : 'A reward just landed for you', allocation_pct: 10, is_winner: null, winner_metric: 'OPEN_RATE', metric_value: null,
  sent: 3, delivered: 3, opened: key === 'A' ? 1 : 2, clicked: 0, open_rate: key === 'A' ? 33.3 : 66.7, click_rate: 0, waiting_for_winner: 24, decide_at: '2026-09-29T14:00:00Z',
}))

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const conflict = (detail: string) => json({ type: 'about:blank', title: 'Conflict', status: 409, detail }, 409)

function run(campaign: string, overrides: Partial<CampaignRun>): CampaignRun {
  return { id: `r-${Math.random().toString(36).slice(2, 8)}`, tenant: 't1', created_at: '2026-09-21T10:00:00Z', updated_at: '2026-09-21T10:00:00Z', row_version: 1, campaign, run_number: 1,
           run_type: 'ONE_TIME', status: 'SCHEDULED', test_mode: false, scheduled_at: null, started_at: null, completed_at: null, ...overrides } as CampaignRun
}

const badRequest = (errors: Record<string, string[]>) => json({ type: 'about:blank', title: 'Bad Request', status: 400, errors }, 400)

/** the drip's messages as the API keeps them: in day order, numbered, each with what it still needs */
function settle(campaign: Campaign, steps: DripStep[]): DripStep[] {
  const sorted = [...steps].sort((a, b) => a.day - b.day).map((step, index) => ({ ...step, position: index + 1 }))
  return sorted.map((step) => {
    const kept = step.problems.filter((problem) => problem === 'NEEDS_TEXT' && step.template)
    const problems: DripStep['problems'] = !step.template ? ['NEEDS_TEMPLATE'] : campaign.channel === 'EMAIL' && !step.subject_line ? ['NEEDS_SUBJECT'] : kept
    return { ...step, problems: [...problems, ...(sorted.filter((other) => other.day === step.day).length > 1 ? ['SAME_DAY' as const] : [])] }
  })
}

let copies = 0
const copyOf = (campaign: Campaign, source: { id: string } | null | undefined) => {
  copies += 1
  return source ? { id: `${source.id}-copy-${copies}`, name: `${campaign.name} · copy ${copies}`, channel: campaign.channel, status: 'DRAFT' } : null
}

/** GET/POST /steps/, PATCH/DELETE /steps/{step}/, POST /steps/{step}/copy-as-next/ and /test/ (apps/campaigns/drip.py's rules) */
function handleSteps(campaign: Campaign, action: string, method: string, body: Record<string, unknown> | null, state: State): Response {
  const id = campaign.id
  state.steps = state.steps ?? {}
  const steps = (state.steps[id] = state.steps[id] ?? [makeStep({ id: `${id}-day-0` })])
  const save = (next: DripStep[]) => { state.steps![id] = settle(campaign, next); return state.steps![id] }
  const listed = () => json([...steps].sort((a, b) => a.day - b.day).map((step, index) => ({ ...step, position: index + 1 })))
  const sorted = [...steps].sort((a, b) => a.day - b.day)
  const add = (values: Partial<DripStep>) => {
    if (steps.length >= 30) return badRequest({ day: ['A drip has at most 30 messages.'] })
    const day = typeof values.day === 'number' ? values.day : sorted.length ? Math.min(365, sorted[sorted.length - 1].day + 3) : 0
    if (steps.some((step) => step.day === day)) return badRequest({ day: ['Another message is already on this day.'] })
    const created = makeStep({ ...values, id: `st-new-${steps.length + 1}-${copies}`, day })
    const after = save([...steps, created])
    return json(after.find((step) => step.id === created.id), 201)
  }

  if (action === 'steps' && method === 'GET') return listed()
  if (action === 'steps' && method === 'POST') {
    if (body?.start_from === 'copy') {
      const source = steps.find((step) => step.id === body.source_step) ?? sorted[sorted.length - 1]
      return add({ template: copyOf(campaign, source?.template), subject_line: source?.subject_line ?? null, preheader: source?.preheader ?? null, send_time: source?.send_time ?? null })
    }
    if (body?.start_from === 'blank') return add({ template: copyOf(campaign, { id: 'blank' }) })
    if (body?.start_from === 'template') {
      const from = (body.template ?? (body.starter ? `starter-${String(body.starter)}` : null)) as string | null
      if (!from) return badRequest({ template: ['Choose a template or a gallery template to start from.'] })
      return add({ template: copyOf(campaign, { id: from }) })
    }
    return badRequest({ start_from: ['Start from a copy, a template or a blank message.'] })
  }

  const match = /^steps\/([^/]+)(?:\/(copy-as-next|test|retry))?$/.exec(action)
  const step = match ? steps.find((item) => item.id === match[1]) : undefined
  if (!match || !step) return json({ type: 'about:blank', title: 'Not found', status: 404, detail: 'No such message in this drip.' }, 404)
  if (match[2] === 'copy-as-next') return add({ template: copyOf(campaign, step.template), subject_line: step.subject_line, preheader: step.preheader, send_time: step.send_time })
  if (match[2] === 'retry') {
    const position = sorted.findIndex((item) => item.id === step.id) + 1
    if (step.run?.status !== 'FAILED') return conflict(`Message ${position} hasn't failed, so there is nothing to retry.`)
    if (step.run.sent > 0) return conflict(`Part of message ${position} went out, so it can't be retried.`)
    const retried = { ...step.run, id: `${step.run.id}-retry`, status: 'SCHEDULED', sent: 0 }
    state.steps![id] = steps.map((item) => (item.id === step.id ? { ...item, run: retried } : item))
    return json({ id: retried.id, campaign: id, run_number: 9, run_type: 'DRIP_INSTANCE', status: 'SCHEDULED', test_mode: false, scheduled_at: DRIP_NOW, started_at: null, completed_at: null, drip_step: step.id }, 201)
  }
  if (match[2] === 'test') return json({ status: 'TEST_PUBLISHED', messages: dripTests(campaign, state, [step.id], body) })
  if (method === 'DELETE') {
    if (steps.length <= 1) return conflict('A drip needs at least one message. Add another message before removing this one.')
    save(steps.filter((item) => item.id !== step.id))
    return json(null, 204)
  }
  if (method === 'PATCH') {
    if (body?.row_version !== undefined && body.row_version !== step.row_version) return conflict('Someone else changed this message after you opened it. Reload to see their changes.')
    const changes: Partial<DripStep> = {}
    if ('day' in (body ?? {})) {
      const day = Number(body?.day)
      if (steps.some((item) => item.id !== step.id && item.day === day)) return badRequest({ day: ['Another message is already on this day.'] })
      changes.day = day
    }
    if (body && 'ab_config' in body) {
      const config = body.ab_config as DripStep['ab_config']
      const other = sorted.find((item) => item.id !== step.id && item.ab_config?.enabled)
      if (config?.enabled && other) return badRequest({ ab_config: [`Message ${sorted.indexOf(other) + 1} is already being tested. One message per drip can have an A/B test.`] })
      if (config?.enabled && campaign.channel !== 'EMAIL') return badRequest({ ab_config: ['A subject line test is for email: texts have no subject.'] })
      changes.ab_config = config
    }
    for (const field of ['name', 'send_time', 'subject_line', 'preheader'] as const) if (body && field in body) (changes as Record<string, unknown>)[field] = body[field]
    if (body?.template) changes.template = copyOf(campaign, { id: String(body.template) })
    const after = save(steps.map((item) => (item.id === step.id ? { ...item, ...changes, row_version: item.row_version + 1 } : item)))
    return json(after.find((item) => item.id === step.id))
  }
  return json({ type: 'about:blank', title: 'Method not allowed', status: 405 }, 405)
}


/** the mock's "now" for drips: a start date before it has passed */
export const DRIP_NOW = '2026-10-07T14:42:00Z'
const PHRASES: Record<string, string> = { NEEDS_TEMPLATE: 'needs a template', NEEDS_SUBJECT: 'needs a subject line', NEEDS_TEXT: 'needs its text', SAME_DAY: 'shares its day with another message' }
const dayOrder = (steps: DripStep[]) => [...steps].sort((a, b) => a.day - b.day)
const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()

/** apps/campaigns/drip_publish.problems and checklist_items, with the same wording */
function dripChecklist(campaign: Campaign, all: DripStep[]): { problems: Record<string, string>; items: CampaignChecklist['items'] } {
  const steps = dayOrder(all)
  const label = (step: DripStep, position: number) => `Message ${position}${step.name ? ` (${step.name})` : ''}`
  const found: Record<string, string> = {}
  const ready = steps.flatMap((step, index) => (step.problems.length ? [`${label(step, index + 1)} ${step.problems.map((code) => PHRASES[code]).join(' and ')}.`] : []))
  if (ready.length) found.messages_ready = ready.join('\n')
  if (steps.every((step) => !step.test || step.test.status === 'NOT_SENT')) found.messages_tested = `Send the test to all ${steps.length} message${steps.length === 1 ? '' : 's'}.`
  else {
    const lines = steps.flatMap((step, index) => {
      const status = step.test?.status
      if (status === 'CHANGED') return [`Message ${index + 1} changed after its test. Resend it.`]
      if (status === 'FAILED') return [`Message ${index + 1}'s test failed. Resend it.`]
      if (status === 'NOT_SENT' || status === 'SENDING') return [`Message ${index + 1} hasn't been tested. Send its test.`]
      return []
    })
    if (lines.length) found.messages_tested = lines.join('\n')
  }
  if (!campaign.scheduled_at) found.start_date = 'Choose a start date.'
  else if (campaign.scheduled_at <= DRIP_NOW) found.start_date = 'The start date, Mon 5 Oct, has passed. Choose a new one.'
  if (campaign.contact_lists.length === 0) found.contact_lists = 'Attach at least one contact list.'
  if (!campaign.sender_profile) found.sender_profile = 'Choose a sender.'
  const items = ([['messages_ready', `All ${steps.length} message${steps.length === 1 ? '' : 's'} ready`], ['messages_content', "Every message's template is sendable"], ['messages_tested', 'Every message tested'],
    ['start_date', 'Start date in the future'], ['contact_lists', 'Campaign List attached'], ['sender_profile', 'Verified sender chosen']] as const)
    .map(([key, text]) => ({ key, label: text, ok: !(key in found), problem: found[key] ?? null }))
  return { problems: found, items }
}

/** drip_publish.send_tests: each message in day order, its test state stamped on the step */
function dripTests(campaign: Campaign, state: State, ids: string[], body: Record<string, unknown> | null) {
  const all = dayOrder(state.steps?.[campaign.id] ?? [])
  const to = [...((body?.to as string[]) ?? []), ...((body?.user_ids as string[]) ?? []).map((user) => (user === 'u2' ? 'devon@example.com' : 'aby.john@aiintelekt.com'))]
  const messages = all.filter((step) => ids.includes(step.id)).map((step) => {
    const position = all.indexOf(step) + 1
    const failed = state.dripTestFails?.includes(step.id) ?? false
    const error = failed ? `${to[0] ?? 'the tester'}: 550 mailbox unavailable` : null
    return { step: step.id, position, run: `r-test-${position}`, status: failed ? 'FAILED' : 'SENT', error, results: to.map((address) => ({ to: address, ok: !failed, detail: failed ? '550 mailbox unavailable' : null })) }
  })
  state.steps = state.steps ?? {}
  state.steps[campaign.id] = all.map((step) => {
    const answer = messages.find((message) => message.step === step.id)
    return answer ? { ...step, row_version: step.row_version + 1, test: { status: answer.status as 'SENT' | 'FAILED', sent_at: DRIP_NOW, error: answer.error, run_id: answer.run } } : step
  })
  return messages
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
    return json({ owners: [{ id: 'u1', name: 'Aby John', email: 'aby.john@aiintelekt.com' }, { id: 'u2', name: 'Devon Okafor', email: 'devon@example.com' }], tags: state.tags ?? ['Fall', 'VIP'],
                  timezones: ['America/Chicago', 'America/New_York', 'Asia/Kolkata', 'Europe/London'], workspace_timezone: 'America/New_York' })
  }
  if (path.endsWith('/campaigns/calendar/')) {
    // one span per campaign with a production run (or, for a live e-receipt campaign, going on from its publish), filtered by channel as the list is
    const spans = state.campaigns.filter((item) => item.status !== 'ARCHIVED' && (!query.get('channel') || item.channel === query.get('channel'))).flatMap((item) => {
      // a drip's send names its message; a paused drip's waiting messages go on hold, with no day (service.calendar_spans)
      const dripSteps = item.campaign_type === 'DRIP' ? dayOrder(state.steps?.[item.id] ?? []) : []
      const about = (one: CampaignRun) => {
        const index = dripSteps.findIndex((step) => step.id === one.drip_step)
        return index < 0 ? {} : { position: index + 1, count: dripSteps.length, name: dripSteps[index].name, step_id: dripSteps[index].id }
      }
      const held = (one: CampaignRun) => item.campaign_type === 'DRIP' && item.status === 'PAUSED' && one.status === 'SCHEDULED'
      const live = item.runs.filter((one) => !one.test_mode && one.status !== 'CANCELLED')
      const moments = live.filter((one) => !held(one)).map((one) => ({ at: (one.started_at ?? one.scheduled_at) as string, state: one.status === 'COMPLETED' || one.status === 'FAILED' ? 'SENT' : one.status === 'SENDING' ? 'SENDING' : 'WAITING', label: one.sequence_label ?? null, ...about(one) }))
      const onHold = live.filter(held).map((one) => ({ ...about(one), state: 'ON_HOLD' }))
      const ongoing = item.campaign_type === 'E_RECEIPT' && ['ACTIVE', 'PRODUCTION_PUBLISHED'].includes(item.status)
      if (moments.length === 0 && !ongoing) return []
      const start = moments.length ? moments.map((moment) => moment.at).sort()[0] : (item.published_at ?? item.created_at)
      return [{ campaign: item.id, name: item.name, code: item.code, channel: item.channel, campaign_type: item.campaign_type, display_status: item.display_status, is_journey_generated: item.is_journey_generated,
                setup_step: item.setup_step, setup_complete: item.setup_complete, actions: item.actions, timezone: item.send_timezone ?? 'America/New_York', start,
                end: ongoing ? null : moments.map((moment) => moment.at).sort().at(-1), ongoing, failed: item.runs.length > 0 && item.runs.every((one) => one.status === 'FAILED'), sends: moments, ...(onHold.length ? { on_hold: onHold } : {}) }]
    })
    return json({ date_from: query.get('date_from'), date_to: query.get('date_to'), timezone: 'America/New_York', spans })
  }
  if (path.endsWith('/campaigns/audience-estimate/')) {
    const excluded = (query.get('exclude') ?? '').split(',').filter(Boolean).length
    return json({ ...audienceEstimate, excluded_by_list: excluded * 10, after_exclusions: 100 - excluded * 10, estimated_recipients: 88 - excluded * 10, ...state.estimate })
  }
  if (path.endsWith('/campaigns/bulk/') && method === 'POST') {
    const ids = (body?.ids as string[]) ?? []
    const done = ids.map((id) => state.campaigns.find((item) => item.id === id)).filter((item): item is Campaign => Boolean(item)).map((item) => {
      if (body?.action === 'archive') return put({ ...item, status: 'ARCHIVED' })
      if (body?.action === 'pause') return put({ ...item, status: 'PAUSED' })
      if (body?.action === 'resume') return put({ ...item, status: 'ACTIVE' })
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

  if ((action === 'steps' || action.startsWith('steps/')) && action !== 'steps/review') {
    if (campaign.campaign_type !== 'DRIP') return conflict('Only a drip campaign has a series of messages.')
    return handleSteps(campaign, action, method, body, state)
  }

  if (action === 'resume-plan' && method === 'GET') return json(state.resumePlan ?? { missed: [], moved: [], unchanged: [] })
  if (action === 'stop' && method === 'POST') {
    if (!campaign.actions.includes('stop')) return conflict('Only a running or paused drip can be stopped.')
    const steps = state.steps?.[id] ?? []
    const cancelled = steps.filter((step) => !step.run || ['SCHEDULED', 'PAUSED'].includes(step.run.status))
    if (state.steps) state.steps[id] = steps.map((step) => (cancelled.includes(step) && step.run ? { ...step, run: { ...step.run, status: 'CANCELLED', completed_at: DRIP_NOW } } : step))
    return json(put({ ...campaign, status: 'COMPLETED', completed_at: DRIP_NOW, paused: null, stopped_early: { at: DRIP_NOW, by_name: 'Aby John', cancelled: cancelled.length } }))
  }
  if (action === 'checklist' && campaign.campaign_type === 'DRIP') {
    const { problems, items } = dripChecklist(campaign, state.steps?.[id] ?? [makeStep({ id: `${id}-day-0` })])
    const holdup = campaign.approval_required && campaign.approval?.status !== 'APPROVED' ? 'Needs approval before a production publish.' : null
    if (holdup) problems.approval = holdup
    return json({ ready: Object.keys(problems).length === 0, problems, test_sent: campaign.runs.some((item) => item.test_mode),
                  items: [...items, ...(campaign.approval_required ? [{ key: 'approval', label: 'Approved for production', ok: !holdup, problem: holdup }] : [])] })
  }
  if (action === 'steps/review' && method === 'GET') {
    const steps = dayOrder(state.steps?.[id] ?? [makeStep({ id: `${id}-day-0` })])
    const messages = steps.map((step, index) => ({
      id: step.id, position: index + 1, name: step.name, day: step.day, scheduled_for: campaign.scheduled_at ? plusDays(campaign.scheduled_at, step.day) : null,
      subject: step.subject_line, estimated_recipients: 88,
      warnings: [...(index && step.day - steps[index - 1].day < 2 ? [{ code: 'TOO_CLOSE' as const, message: `Only ${step.day - steps[index - 1].day} day${step.day - steps[index - 1].day === 1 ? '' : 's'} after message ${index}.` }] : []),
                 ...(state.dripWarnings?.[step.id] ?? [])],
    }))
    return json({ messages, summary: { count: messages.length, first_send_at: messages[0]?.scheduled_for ?? null, last_send_at: messages.at(-1)?.scheduled_for ?? null, estimated_recipients: 88 } })
  }
  if (action === 'checklist') {
    const problems: Record<string, string> = {}
    if (!campaign.template) problems.template = 'Choose a template.'
    if (campaign.contact_lists.length === 0 && campaign.campaign_type !== 'E_RECEIPT') problems.contact_lists = 'Attach at least one contact list.'
    if (!campaign.sender_profile) problems.sender_profile = 'Choose a sender.'
    const tested = campaign.runs.some((item) => item.test_mode)
    if (campaign.approval_required && campaign.approval?.status !== 'APPROVED') problems.approval = 'Needs approval before a production publish.'
    const answer: CampaignChecklist = {
      ready: Object.keys(problems).length === 0, problems, test_sent: tested,
      items: [...([['template', 'Template content finalized'], ['contact_lists', 'Campaign List attached'], ['sender_profile', 'Verified sender chosen']] as const)
        .map(([key, label]) => ({ key, label, ok: !(key in problems), problem: problems[key] ?? null })),
        { key: 'test', label: 'Test message sent and reviewed', ok: tested, problem: tested ? null : 'Send yourself a test before publishing.', advisory: true },
        ...(campaign.approval_required ? [{ key: 'approval', label: 'Approved for production', ok: !problems.approval, problem: problems.approval ?? null }] : [])],
    }
    return json(answer)
  }
  if (action === 'audience' && (query.get('local_time') === '1' || campaign.timezone_optimization)) {
    return json({ ...audienceEstimate, local_time: { people: 88, local_time_known: 70 }, ...state.audience })
  }
  if (action === 'audience') return json({ ...audienceEstimate, ...(campaign.actions.includes('results') ? { frozen: { members: 100, generated_at: '2026-09-18T10:00:00Z', eligible: 88, suppressed: { UNSUBSCRIBED: 9, HARD_BOUNCE: 3 } } } : {}), ...state.audience })
  if (action === 'audience/export') {
    return state.audienceExportFails ? json({ type: 'about:blank', title: 'Export failed', status: 503, detail: 'The export service is not answering.' }, 503)
      : new Response('party_id,email\nP-1,d.alvarez@northwind.example\n', { headers: { 'Content-Type': 'text/csv' } })
  }
  if (action === 'sample-customers') return json([{ party_id: 'P-1', name: 'Dolores Alvarez', address: 'd.alvarez@northwind.example' }])
  if (action === 'preview') {
    if (!campaign.template && !query.get('template')) return conflict('Choose a template first.')
    const text = campaign.channel === 'SMS' || campaign.channel === 'MMS'
    const who = query.get('party_id') ? 'Dolores' : 'Jordan'
    const templateId = query.get('template') || campaign.template
    const templateChannel = templateId === 'tpl-sms' ? 'SMS' : templateId === 'tpl-receipt' ? 'E_RECEIPT' : 'EMAIL'
    const filled = (value: string) => value.replace(/\{\{\s*first_name\s*\}\}/g, who)
    const step = query.get('step') ? state.steps?.[id]?.find((item) => item.id === query.get('step')) : undefined
    return json({ subject: text ? null : filled(step?.subject_line ?? campaign.subject_line ?? 'Fall is here, {{first_name}}'), preheader: text ? '' : filled(campaign.preheader ?? ''), html: text ? null : `<p>Hello ${who}</p>`, text: `Northwind: Hi ${who}. Reply STOP to opt out.`, version: 3,
                  template: templateId === 'tpl-sms' ? 'Fall SMS' : 'Fall Email', template_id: templateId, channel: templateChannel, tags_used: ['first_name'], customer: query.get('party_id') })
  }
  const runPath = /^runs\/([^/]+)(\/choose-winner)?$/.exec(action)
  if (runPath) {
    const found = campaign.runs.find((item) => item.id === runPath[1])
    if (!found) return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404)
    if (runPath[2] && method === 'POST') {
      state.variants = (state.variants ?? waitingVariants).map((item) => ({ ...item, is_winner: item.variant_key === body?.variant }))
      return json({ winner: body?.variant })
    }
    return json({ ...found, variants: state.variants ?? [] })
  }
  if (action === 'metrics') return json({ ...metrics, ...state.metrics })
  if (action === 'metrics/timeseries') return json({ bucket: query.get('bucket') ?? 'hour', points: [{ at: '2026-09-18T10:00:00Z', sent: 50, delivered: 48, opened: 20, clicked: 5 }, { at: '2026-09-18T11:00:00Z', sent: 30, delivered: 28, opened: 20, clicked: 7 }] })
  if (action === 'activity') {
    return state.activityFails ? json({ type: 'about:blank', title: 'Unavailable', status: 503, detail: 'The activity service is not answering.' }, 503) : json(state.activity ?? activityLog)
  }
  if (method !== 'POST') return null

  if (action === 'test-publish' && campaign.campaign_type === 'DRIP') {
    const messages = dripTests(campaign, state, (state.steps?.[id] ?? []).map((step) => step.id), body)
    const after = put({ ...campaign, status: campaign.status === 'DRAFT' && messages.some((message) => message.status === 'SENT') ? 'TEST_PUBLISHED' : campaign.status,
                        runs: [...campaign.runs, run(campaign.id, { test_mode: true, status: 'COMPLETED', run_number: campaign.runs.length + 1, sequence_label: 'Test 1' })] })
    return json({ messages, status: after.status })
  }
  if (action === 'test-publish') {
    const to = [...((body?.to as string[]) ?? []), ...((body?.user_ids as string[]) ?? []).map((user) => (user === 'u2' ? 'devon@example.com' : 'aby.john@aiintelekt.com'))]
    const after = put({ ...campaign, status: campaign.status === 'DRAFT' ? 'TEST_PUBLISHED' : campaign.status, runs: [...campaign.runs, run(campaign.id, { test_mode: true, status: 'COMPLETED', run_number: campaign.runs.length + 1, sequence_label: 'Test' })] })
    // with a subject line test each address gets both, as the API does
    const variants = campaign.ab_config?.enabled && campaign.ab_config.subject_b ? (['A', 'B'] as const) : [undefined]
    return json({ run: 'r-test', status: after.status, results: to.flatMap((address) => variants.map((variant) => ({
      to: address, ok: !address.includes('bad'), detail: address.includes('bad') ? '550 mailbox unavailable' : 'msg-1', ...(variant ? { variant, subject: variant === 'A' ? 'Fall is here, Jordan' : campaign.ab_config?.subject_b } : {}) }))) })
  }
  if (action === 'request-approval') {
    return json(put({ ...campaign, approval: { status: 'REQUESTED', requested_by: 'u1', requested_by_name: 'Aby John', requested_at: '2026-09-29T09:14:00Z', note: String(body?.note ?? '') || null,
                                               decided_by_name: null, decided_at: null, decision_note: null } }))
  }
  if (action === 'approve' || action === 'send-back') {
    if (action === 'send-back' && !String(body?.note ?? '').trim()) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { note: ['Say what to change.'] } }, 400)
    return json(put({ ...campaign, approval: { ...(campaign.approval as NonNullable<Campaign['approval']>), status: action === 'approve' ? 'APPROVED' : 'RETURNED', decided_by_name: 'Maria Chen',
                                               decided_at: '2026-09-29T10:00:00Z', decision_note: String(body?.note ?? '') || null } }))
  }
  if (action === 'publish' && campaign.campaign_type === 'DRIP') {
    const { problems } = dripChecklist(campaign, state.steps?.[id] ?? [])
    if (Object.keys(problems).length) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: Object.fromEntries(Object.entries(problems).map(([key, text]) => [key, [text]])) }, 400)
    if (campaign.approval_required && campaign.approval?.status !== 'APPROVED') return conflict('This campaign needs approval before a production publish.')
    const created = run(campaign.id, { scheduled_at: campaign.scheduled_at, run_number: campaign.runs.length + 1, sequence_label: 'Day 0' })
    put({ ...campaign, status: 'PRODUCTION_PUBLISHED', published_at: DRIP_NOW, runs: [...campaign.runs, created] })
    return json(created, 201)
  }
  if (action === 'publish') {
    if (campaign.approval_required && campaign.approval?.status !== 'APPROVED') return conflict('This campaign needs approval before a production publish.')
    if (!campaign.template) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { template: ['Choose a template.'] } }, 400)
    const later = campaign.send_type === 'SCHEDULED' ? campaign.scheduled_at : null
    const created = run(campaign.id, { scheduled_at: later, run_number: campaign.runs.length + 1 })
    put({ ...campaign, status: 'PRODUCTION_PUBLISHED', published_at: '2026-09-21T10:00:00Z', runs: [...campaign.runs, created] })
    return json(created, 201)
  }
  if (action === 'pause') return campaign.actions.includes('pause') ? json(put({ ...campaign, status: 'PAUSED', paused: { at: DRIP_NOW, by_name: 'Aby John' } })) : conflict(`A ${campaign.status_label.toLowerCase()} campaign cannot be paused.`)
  if (action === 'resume') return campaign.actions.includes('resume') ? json(put({ ...campaign, status: 'ACTIVE', paused: null })) : conflict('Only a paused campaign can be resumed.')
  if (action === 'cancel-schedule') return json(put({ ...campaign, status: 'DRAFT', runs: campaign.runs.map((item) => (item.status === 'SCHEDULED' ? { ...item, status: 'CANCELLED' } : item)) }))
  if (action === 'archive') return json(put({ ...campaign, status: 'ARCHIVED', archived_at: '2026-09-21T10:00:00Z' }))
  if (action === 'unarchive') return json(put({ ...campaign, status: campaign.runs.some((item) => !item.test_mode) ? 'COMPLETED' : 'DRAFT', archived_at: null }))
  if (action === 'clone') {
    // {name?, scheduled_at?}: the name is checked like any campaign name; a start date must be ahead
    const name = String(body?.name ?? '').trim() || `Copy of ${campaign.name}`
    if (state.campaigns.some((item) => item.name.toLowerCase() === name.toLowerCase())) return badRequest({ name: ['Another campaign already has this name.'] })
    if (body?.scheduled_at && new Date(String(body.scheduled_at)).getTime() <= Date.now()) return badRequest({ scheduled_at: ['Choose a time in the future.'] })
    const copy = state.make({ ...campaign, id: `${campaign.id}-copy`, code: 'CMP-2026-0010', name, status: 'DRAFT', runs: [], actions: undefined, paused: null, stopped_early: null, drip_progress: null,
                              scheduled_at: campaign.campaign_type === 'DRIP' ? ((body?.scheduled_at as string | undefined) ?? null) : campaign.scheduled_at })
    state.campaigns = [copy, ...state.campaigns]
    if (campaign.campaign_type === 'DRIP' && state.steps?.[campaign.id]) {
      state.steps[copy.id] = state.steps[campaign.id].map((step) => ({ ...step, id: `${step.id}-copy`, run: null, test: { status: 'NOT_SENT', sent_at: null, error: null, run_id: null }, template: copyOf(copy, step.template) }))
    }
    return json(copy, 201)
  }
  return null
}

/** GET /campaigns/ : status (a comma list) / search / type / channel / tag / owner / triggered_by filters, ordering by name, and numbered pages */
export function listCampaigns(url: string, campaigns: Campaign[]): Response {
  const query = new URL(url, 'http://mock').searchParams
  const statuses = query.get('status')?.split(',') ?? []
  const search = (query.get('search') ?? '').toLowerCase()
  const view = query.get('view')
  const today = new Date().toISOString().slice(0, 10)
  let rows = campaigns.filter((item) => (statuses.length ? statuses.includes(item.display_status) : item.status !== 'ARCHIVED'))
    .filter((item) => item.name.toLowerCase().includes(search) && (!query.get('type') || item.campaign_type === query.get('type')) && (!query.get('channel') || item.channel === query.get('channel'))
      && (!query.get('tag') || item.tags.includes(query.get('tag') as string)) && (!query.get('owner') || item.owner_user === query.get('owner'))
      && (!query.get('triggered_by') || item.triggered_by === query.get('triggered_by')!.toUpperCase())
      && (!query.get('approval') || item.approval?.status === query.get('approval')!.toUpperCase())
      && (view !== 'mine' || item.owner_user === 'u1') && (view !== 'sending_today' || (item.next_run_at ?? '').startsWith(today) || item.status === 'ACTIVE')
      && (view !== 'attention' || item.status === 'PAUSED' || item.approval?.status === 'REQUESTED' || item.display_status === 'FAILED'))
  const ordering = query.get('ordering') ?? ''
  if (ordering.replace('-', '') === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name) * (ordering.startsWith('-') ? -1 : 1))
  const size = Number(query.get('page_size') ?? 50)
  const page = Number(query.get('page') ?? 1)
  return json({ count: rows.length, next: page * size < rows.length ? `?page=${page + 1}` : null, previous: page > 1 ? `?page=${page - 1}` : null, results: rows.slice((page - 1) * size, page * size) })
}
