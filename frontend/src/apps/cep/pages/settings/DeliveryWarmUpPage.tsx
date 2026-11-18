/**
 * Settings → Engagement · Sending → Delivery Warm-Up (docs/mockups/domain-ip-warmup.html): a new sending IP or domain sends
 * a little more each day. The plan is the hourly schedule sized to the workspace plan's contacts, hourly (round the clock) or
 * daily (inside a sending window). Every day has its own lists and template, changeable from today on; CEP's warm-up emails go
 * out as Warm-Up campaigns, and every marketing email of the workspace waits for the hour's limit, its own campaigns first.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Thermometer } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Checkbox } from '@/components/Checkbox'
import { Field, Select, TextInput, buttonDanger, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { ProgressBar } from '@/components/ProgressBar'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { ChoiceCard, ChoiceGroup } from '@/apps/cep/features/campaigns/parts'
import { problemText } from '@/apps/cep/features/contact-lists/problem'
import { ChangeDayDialog } from '@/apps/cep/features/warmup/ChangeDayDialog'
import { STATUS_TAG, WARM_UP_KEY, changeable, dayLabel, ipModeLabel, isOpen, planLabel, planLine, rate, windowWords } from '@/apps/cep/features/warmup/warmUpWords'
import { api } from '@/lib/api'
import { formatNumber, formatPercent } from '@/lib/format'
import type { ContactList, Page, SenderProfile, Template, WarmUp, WarmUpAdvance, WarmUpDay, WarmUpIpMode, WarmUpOverview, WarmUpPlanKind, WarmUpPlans } from '@/lib/types'

const TABLE_HEAD = 'px-3 py-2 text-left text-xs font-semibold text-ink-800'
const CELL = 'px-3 py-2.5 align-top text-sm'

/** the lists, templates and senders the warm-up may use: production lists, email templates with a design, email senders */
function useOptions() {
  const lists = useQuery({ queryKey: ['contact-lists', 'warm-up-options'], queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { status: 'ACTIVE', page_size: 200 }, signal) })
  const templates = useQuery({ queryKey: ['templates', 'warm-up-options'], queryFn: ({ signal }) => api.get<Page<Template>>('/templates/', { page_size: 200 }, signal) })
  const senders = useQuery({ queryKey: ['sender-profiles', 'options'], queryFn: ({ signal }) => api.get<SenderProfile[]>('/sender-profiles/', undefined, signal) })
  return {
    lists: (lists.data?.results ?? []).filter((list) => list.is_master && list.list_environment === 'PRODUCTION'),
    templates: (templates.data?.results ?? []).filter((template) => template.channel === 'EMAIL' && template.status !== 'ARCHIVED' && template.latest_version !== 0 && template.latest_version !== null),
    senders: (senders.data ?? []).filter((sender) => sender.channel === 'EMAIL'),
  }
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line-subtle bg-surface px-4 py-3">
      <p className="text-helper text-ink-800">{label}</p>
      <p className="cep-num mt-0.5 text-lg font-semibold text-ink-900">{value}{sub && <span className="ml-1 text-sm font-normal text-ink-800">{sub}</span>}</p>
    </div>
  )
}

export function DeliveryWarmUpPage() {
  const { can } = useAuth()
  const canEdit = can('provider.edit')
  const overview = useQuery({ queryKey: WARM_UP_KEY, queryFn: ({ signal }) => api.get<WarmUpOverview>('/warmup/', undefined, signal), refetchInterval: 60_000 })
  const [starting, setStarting] = useState(false)

  if (overview.isError) return <ErrorState title="The warm-up could not be loaded" error={overview.error} onRetry={() => void overview.refetch()} />
  if (overview.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = overview.data
  const warmUp = data.warmup

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Delivery Warm-Up</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-ink-800">
          Inboxes trust a sending IP and domain they know. A new one sends a little more each day, from your lists and templates, and every campaign waits for the hour's limit until the warm-up is done.
        </p>
      </div>
      {!data.present ? (
        <Notice tone="warning">Delivery Warm-Up needs patch 0083 on this workspace's database. Ask your platform team.</Notice>
      ) : warmUp && (isOpen(warmUp) || !starting) ? (
        <Running overview={data} warmUp={warmUp} canEdit={canEdit} onStartAgain={() => setStarting(true)} />
      ) : (
        <Start overview={data} canEdit={canEdit} onStarted={() => setStarting(false)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- a warm-up running (or finished)
function Running({ overview, warmUp, canEdit, onStartAgain }: { overview: WarmUpOverview; warmUp: WarmUp; canEdit: boolean; onStartAgain: () => void }) {
  const queryClient = useQueryClient()
  const options = useOptions()
  const [changing, setChanging] = useState<WarmUpDay | null>(null)
  const [stopping, setStopping] = useState(false)
  const [extras, setExtras] = useState(false)
  const act = useMutation({
    mutationFn: (action: string) => api.post<WarmUpOverview>('/warmup/actions/', { action }),
    onSuccess: (next) => { queryClient.setQueryData(WARM_UP_KEY, next); setStopping(false) },
  })
  const settings = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<WarmUpOverview>('/warmup/', body),
    onSuccess: (next) => queryClient.setQueryData(WARM_UP_KEY, next),
  })
  const open = isOpen(warmUp)
  const today = warmUp.today
  const tag = STATUS_TAG[warmUp.status]
  const sentRate = today.limit_day ? Math.min(100, (today.sent / today.limit_day) * 100) : 0
  const bounceRate = rate(today.bounced, today.sent)
  const complaintRate = rate(today.complained, today.sent)
  const busy = act.isPending || settings.isPending

  return (
    <>
      <section className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={tag.status} label={tag.label} />
          <span className="text-sm text-ink-800">{ipModeLabel(warmUp.ip_mode)} · {planLabel(warmUp.plan_kind)} · {warmUp.advance_mode === 'AUTO' ? 'Automatic' : 'Approve Each Step'} · {warmUp.sender.display_name} &lt;{warmUp.sender.from_address}&gt;</span>
          {canEdit && (
            <span className="ml-auto flex flex-wrap gap-2">
              {warmUp.status === 'WARMING' && <button type="button" className={buttonSecondary} disabled={busy} onClick={() => act.mutate('pause')}>Pause</button>}
              {warmUp.status === 'PAUSED' && <button type="button" className={buttonSecondary} disabled={busy} onClick={() => act.mutate('resume')}>Resume</button>}
              {open && <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setStopping(true)}>Stop</button>}
              {!open && <button type="button" className={buttonPrimary} onClick={onStartAgain}>Start a New Warm-Up</button>}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 empty:hidden">
          {warmUp.status_note && open && <Notice layout="banner" tone="warning" title="Paused">{warmUp.status_note}</Notice>}
          {warmUp.offered_day && open && (
            <Notice layout="banner" title={`Ready for day ${warmUp.offered_day}: ${formatNumber(overview.days.find((day) => day.day === warmUp.offered_day)?.daily_limit)} a day`}
              action={canEdit && <span className="flex flex-wrap gap-2">
                <button type="button" className={buttonPrimary} disabled={busy} onClick={() => act.mutate('approve')}>Approve Day {warmUp.offered_day}</button>
                <button type="button" className={buttonSecondary} disabled={busy} onClick={() => act.mutate('stay')}>Stay on Day {warmUp.current_day}</button>
                {warmUp.current_day > 1 && <button type="button" className={buttonSecondary} disabled={busy} onClick={() => act.mutate('back')}>Back to Day {warmUp.current_day - 1}</button>}
              </span>}>
              Day {warmUp.current_day} was healthy. Approving raises the limit at once; until then it stays at day {warmUp.current_day}'s.
            </Notice>
          )}
          {warmUp.people.no_template > 0 && open && (
            <Notice layout="banner" tone="warning" title={`${formatNumber(warmUp.people.no_template)} ${warmUp.people.no_template === 1 ? 'person has' : 'people have'} had every template`}
              action={canEdit && <button type="button" className={buttonSecondary} onClick={() => setExtras(true)}>Add Templates</button>}>
              Nobody gets the same warm-up template twice, so they were skipped this round. Add another template for people the warm-up reaches again.
            </Notice>
          )}
          {act.isError && <Notice tone="error">{problemText(act.error)}</Notice>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Fact label="Warm-Up Day" value={formatNumber(warmUp.current_day)} sub={`of ${warmUp.days_total}`} />
          <Fact label="Today's Limit" value={formatNumber(today.limit_day)} sub={`${formatNumber(today.limit_hour)} an hour`} />
          <Fact label="Sent Today" value={formatNumber(today.sent)} />
          <Fact label="Workspace Plan" value={warmUp.contacts_target ? formatNumber(warmUp.contacts_target) : 'No limit'} sub={warmUp.contacts_target ? 'contacts' : undefined} />
        </div>
        {open && (
          <>
            <div className="mt-3"><ProgressBar value={sentRate} label={`${formatNumber(today.sent)} of ${formatNumber(today.limit_day)} sent today`} /></div>
            <p className="mt-2 text-helper text-ink-800">
              {formatNumber(today.limit_hour)} an hour {windowWords(warmUp)} ({warmUp.time_zone}). This hour ({today.hour}): {formatNumber(today.sent_this_hour)} let out.
              {' '}Waiting: {formatNumber(today.waiting_own)} from your campaigns, {formatNumber(today.waiting_warm_up)} warm-up. Your campaigns go first.
              {!today.in_window && ' Outside the sending window: nothing goes out until it opens.'}
            </p>
            <p className="mt-1 text-helper text-ink-800">
              Today so far: bounces {formatPercent(bounceRate)} (the day holds over {formatPercent(warmUp.limits.bounce * 100, 0)}), complaints {formatPercent(complaintRate, 2)} (over {formatPercent(warmUp.limits.complaint * 100)}).
              {' '}{warmUp.advance_mode === 'AUTO' ? 'A healthy day moves the plan on at midnight; two days over a limit go back a day and pause.' : 'A healthy day offers the next one for approval at midnight.'}
            </p>
          </>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-subtle px-4 py-3">
          <h3 className="font-display text-card-heading font-semibold text-ink-900">Day by Day</h3>
          <p className="text-helper text-ink-800">Each day sends from its lists with its template. Today's and later days can be changed; each day's sends are Warm-Up campaigns in Campaigns.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse">
            <thead className="bg-surface-subtle">
              <tr className="border-b border-line">
                <th scope="col" className={`${TABLE_HEAD} text-right`}>Day</th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>Limit</th>
                <th scope="col" className={TABLE_HEAD}>Lists</th>
                <th scope="col" className={TABLE_HEAD}>Template</th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>Sent</th>
                <th scope="col" className={`${TABLE_HEAD} text-right`}>Opened</th>
                <th scope="col" className={TABLE_HEAD}>Campaigns</th>
                <th scope="col" className={TABLE_HEAD}><span className="sr-only">Change</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {overview.days.map((day) => (
                <tr key={day.day} data-day={day.day} data-state={day.state} className={day.state === 'TODAY' ? 'bg-callout-bg' : ''}>
                  <td className={`${CELL} cep-num text-right whitespace-nowrap`}>
                    <span className="font-semibold text-ink-900">{day.day}</span>
                    <span className="block text-helper text-ink-800">{dayLabel(day.date)}</span>
                  </td>
                  <td className={`${CELL} cep-num text-right whitespace-nowrap`}>
                    {formatNumber(day.daily_limit)}
                    <span className="block text-helper text-ink-800">{formatNumber(day.hourly_limit)} an hour</span>
                  </td>
                  <td className={CELL}>{day.lists.map((list) => list.name).join(', ') || '—'}</td>
                  <td className={CELL}>{day.template?.name ?? '—'}</td>
                  <td className={`${CELL} cep-num text-right`}>
                    {day.state === 'PLANNED' ? <span className="text-ink-300">—</span> : formatNumber(day.sent)}
                    {day.health && day.health.outcome !== 'DONE' && <span className="block text-helper text-ink-800">{day.health.outcome === 'QUIET' ? 'Nothing sent: held' : 'Over a limit: held'}</span>}
                  </td>
                  <td className={`${CELL} cep-num text-right`}>{day.state === 'PLANNED' || !day.sent ? <span className="text-ink-300">—</span> : formatPercent(rate(day.opened, day.sent), 0)}</td>
                  <td className={CELL}>
                    {day.campaigns.length ? (
                      <ul className="space-y-1">
                        {day.campaigns.map((campaign) => (
                          <li key={campaign.id} className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={campaign.status} />
                            <Link to={`/campaigns/${campaign.id}`} className="text-helper font-semibold text-brand-800 hover:underline">{campaign.name}</Link>
                          </li>
                        ))}
                      </ul>
                    ) : <span className="text-helper text-ink-300">{day.state === 'PLANNED' ? 'Planned' : '—'}</span>}
                  </td>
                  <td className={`${CELL} text-right`}>
                    {canEdit && changeable(warmUp, day) && (
                      <button type="button" className={day.state === 'TODAY' ? buttonSecondary : 'text-sm font-semibold text-brand-800 hover:underline'} onClick={() => setChanging(day)}>Change</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line-subtle px-4 py-3 text-xs text-ink-800">
          After day {warmUp.days_total} there is no limit. The plan was sized to {warmUp.contacts_target ? `${formatNumber(warmUp.contacts_target)} contacts` : 'the whole schedule'}: the last day sends them all in one day.
        </p>
      </section>

      {open && canEdit && (
        <section className="rounded-lg border border-line bg-surface p-5">
          <h3 className="font-display text-card-heading font-semibold text-ink-900">How It Runs</h3>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-ink-800">How the Day Moves On</p>
              <div className="mt-1.5">
                <SegmentedControl<WarmUpAdvance> label="How the day moves on" value={warmUp.advance_mode} disabled={busy}
                  options={[{ value: 'AUTO', label: 'Automatic' }, { value: 'APPROVE', label: 'Approve Each Step' }]}
                  onChange={(value) => settings.mutate({ advance_mode: value })} />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-ink-800">Templates for People Reached Again</p>
              <p className="mt-1.5 text-sm text-ink-900">{overview.extra_templates?.length ? overview.extra_templates.map((item) => item.name).join(', ') : 'Only the days\' templates'}</p>
              <button type="button" className="mt-1 text-sm font-semibold text-brand-800 hover:underline" onClick={() => setExtras(true)}>Change</button>
            </div>
          </div>
          {settings.isError && <div className="mt-3"><Notice tone="error">{problemText(settings.error)}</Notice></div>}
        </section>
      )}

      {changing && <ChangeDayDialog warmUp={warmUp} day={changing} days={overview.days} lists={options.lists} templates={options.templates} onClose={() => setChanging(null)} />}
      {extras && <ExtraTemplatesDialog warmUp={warmUp} templates={options.templates} onClose={() => setExtras(false)} />}
      {stopping && (
        <Modal title="Stop the Warm-Up?" onClose={() => setStopping(false)}
          footer={<>
            <button type="button" className={buttonSecondary} onClick={() => setStopping(false)}>Keep Warming</button>
            <button type="button" className={buttonDanger} disabled={act.isPending} onClick={() => act.mutate('stop')}>Stop the Warm-Up</button>
          </>}>
          <p className="text-sm text-ink-900">Warm-up emails still waiting are not sent, and your campaigns go out as fast as the engine sends. Stopping early on a new IP or domain risks the spam folder.</p>
        </Modal>
      )}
    </>
  )
}

function ExtraTemplatesDialog({ warmUp, templates, onClose }: { warmUp: WarmUp; templates: Template[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [chosen, setChosen] = useState(warmUp.extra_template_ids)
  const save = useMutation({
    mutationFn: () => api.patch<WarmUpOverview>('/warmup/', { extra_template_ids: chosen }),
    onSuccess: (next) => { queryClient.setQueryData(WARM_UP_KEY, next); onClose() },
  })
  return (
    <Modal title="Templates for People Reached Again" onClose={onClose} scrollBody
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={buttonPrimary} disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
      </>}>
      <p className="text-sm text-ink-800">Someone the warm-up reaches again gets a template they have not had: the next days' templates first, then these, in this order.</p>
      <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2" aria-label="Templates">
        {templates.map((template) => (
          <li key={template.id} className="rounded-md px-2 py-1.5 hover:bg-surface-hover">
            <Checkbox checked={chosen.includes(template.id)} label={template.name} className="text-sm"
              onChange={(event) => { const { checked } = event.target; setChosen((current) => (checked ? [...current, template.id] : current.filter((id) => id !== template.id))) }} />
          </li>
        ))}
      </ul>
      {save.isError && <div className="mt-3"><Notice tone="error">{problemText(save.error)}</Notice></div>}
    </Modal>
  )
}

// ---------------------------------------------------------------- starting one
function Start({ overview, canEdit, onStarted }: { overview: WarmUpOverview; canEdit: boolean; onStarted: () => void }) {
  const queryClient = useQueryClient()
  const options = useOptions()
  const [ipMode, setIpMode] = useState<WarmUpIpMode>('DEDICATED')
  const [planKind, setPlanKind] = useState<WarmUpPlanKind>('DAILY')
  const [windowStart, setWindowStart] = useState('08:00')
  const [windowEnd, setWindowEnd] = useState('21:00')
  const [advance, setAdvance] = useState<WarmUpAdvance>('AUTO')
  const [listIds, setListIds] = useState<string[]>([])
  const [templateId, setTemplateId] = useState('')
  const [senderId, setSenderId] = useState('')
  const windowOk = /^\d\d:\d\d$/.test(windowStart) && /^\d\d:\d\d$/.test(windowEnd) && windowEnd > windowStart
  const plans = useQuery({
    queryKey: ['warmup', 'plans', windowStart, windowEnd],
    queryFn: ({ signal }) => api.get<WarmUpPlans>('/warmup/plans/', { window_start: windowStart, window_end: windowEnd }, signal),
    enabled: windowOk,
  })
  const start = useMutation({
    mutationFn: () => api.post<WarmUpOverview>('/warmup/', { ip_mode: ipMode, plan_kind: planKind, window_start: windowStart, window_end: windowEnd, advance_mode: advance,
      list_ids: listIds, template_id: templateId, sender_profile: chosenSender }),
    onSuccess: (next) => { queryClient.setQueryData(WARM_UP_KEY, next); onStarted() },
  })
  const chosenSender = senderId || options.senders.find((sender) => sender.is_default)?.id || options.senders[0]?.id || ''
  const plan = plans.data?.plans[`${ipMode}_${planKind}`] ?? []
  const people = options.lists.filter((list) => listIds.includes(list.id)).reduce((sum, list) => sum + list.member_count, 0)
  const contacts = plans.data?.contacts_target ?? overview.contacts_target
  const format = (value: number) => formatNumber(value)
  const line = (ip: WarmUpIpMode, kind: WarmUpPlanKind) => planLine(plans.data?.plans[`${ip}_${kind}`] ?? [], format)
  const verified = options.senders.filter((sender) => sender.verification_status === 'VERIFIED')
  const ready = canEdit && windowOk && listIds.length > 0 && Boolean(templateId) && options.senders.length > 0 && !start.isPending

  return (
    <section className="space-y-6 rounded-lg border border-line bg-surface p-5">
      <Notice layout="banner" icon={Thermometer} title={contacts ? `Sized to your workspace plan: ${overview.plan_name ?? 'your plan'}, ${formatNumber(contacts)} contacts` : 'Your workspace plan has no contact limit: the whole schedule, 42 days'}>
        The warm-up ends on the first day {contacts ? `all ${formatNumber(contacts)}` : 'the schedule'} can be emailed. A bigger workspace plan later continues it down the schedule. <Link to="/settings/plan" className="font-semibold text-brand-800 hover:underline">Plan &amp; Usage</Link>
      </Notice>

      <ChoiceGroup label="1 · How Mail Leaves" strong>
        <ChoiceCard selected={ipMode === 'DEDICATED'} onSelect={() => setIpMode('DEDICATED')} title="Dedicated IP"
          text={`An IP address of your own: the IP and the domain warm up together from day 1 of the schedule. ${line('DEDICATED', planKind)}.`} />
        <ChoiceCard selected={ipMode === 'SHARED'} onSelect={() => setIpMode('SHARED')} title="Shared IP Pool"
          text={`Already warm IP addresses shared with other workspaces: only the domain is new, so the plan starts further along. ${line('SHARED', planKind)}.`} />
      </ChoiceGroup>

      <div className="space-y-3">
        <ChoiceGroup label="2 · Plan" strong>
          <ChoiceCard selected={planKind === 'HOURLY'} onSelect={() => setPlanKind('HOURLY')} title="Hourly Plan"
            text={`The schedule's limit every hour, day and night (20 an hour on its first day). ${line(ipMode, 'HOURLY')}.`} />
          <ChoiceCard selected={planKind === 'DAILY'} onSelect={() => setPlanKind('DAILY')} title="Daily Plan"
            text={`The same hourly limit, only inside a sending window, added up per day: nothing goes out at night. ${line(ipMode, 'DAILY')}.`} />
        </ChoiceGroup>
        {planKind === 'DAILY' && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Sending Window From">{(ids) => <TextInput {...ids} type="time" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} className="w-32" />}</Field>
            <Field label="To">{(ids) => <TextInput {...ids} type="time" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} className="w-32" invalid={!windowOk} />}</Field>
            {!windowOk && <p className="pb-2 text-helper font-medium text-danger-text">The window must end after it starts, on the same day.</p>}
          </div>
        )}
        {plan.length > 0 && (
          <details className="rounded-lg border border-line-subtle">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-900">The Plan, Day by Day ({plan.length} days)</summary>
            <div className="max-h-72 overflow-y-auto border-t border-line-subtle">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-surface-subtle"><tr>
                  <th scope="col" className={`${TABLE_HEAD} text-right`}>Day</th>
                  <th scope="col" className={`${TABLE_HEAD} text-right`}>An Hour</th>
                  <th scope="col" className={`${TABLE_HEAD} text-right`}>A Day</th>
                </tr></thead>
                <tbody className="divide-y divide-line-subtle">
                  {plan.map((day) => (
                    <tr key={day.day}><td className={`${CELL} cep-num text-right`}>{day.day}</td><td className={`${CELL} cep-num text-right`}>{formatNumber(day.hourly)}</td><td className={`${CELL} cep-num text-right`}>{formatNumber(day.daily)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink-900">3 · Lists for Every Day</legend>
        <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-2" aria-label="Lists">
          {options.lists.length === 0 && <li className="px-2 py-1.5 text-sm text-ink-800">No production list yet. <Link to="/contact-lists" className="font-semibold text-brand-800 hover:underline">Contact Lists</Link></li>}
          {options.lists.map((list) => (
            <li key={list.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover">
              <Checkbox checked={listIds.includes(list.id)} label={list.name} className="text-sm"
                onChange={(event) => { const { checked } = event.target; setListIds((current) => (checked ? [...current, list.id] : current.filter((id) => id !== list.id))) }} />
              <span className="cep-num shrink-0 text-helper text-ink-800">{formatNumber(list.member_count)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-helper text-ink-800">
          {listIds.length ? `${formatNumber(people)} people. ` : ''}Each hour takes the next people of the list, the most engaged first; everyone is reached once before anyone twice. Start with your most engaged list and add others on later days.
        </p>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="4 · Template for Every Day" strong hint="Change any day's template once the warm-up runs. Nobody gets the same template twice.">
          {(ids) => <Select {...ids} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">Choose a template</option>
            {options.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </Select>}
        </Field>
        <Field label="Sender" strong hint={verified.length ? 'The From address stays for the whole warm-up.' : 'No verified email sender yet: production sends need one.'}>
          {(ids) => <Select {...ids} value={chosenSender} onChange={(event) => setSenderId(event.target.value)}>
            {options.senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.display_name} &lt;{sender.from_address}&gt;{sender.verification_status === 'VERIFIED' ? '' : ' (not verified)'}</option>)}
          </Select>}
        </Field>
      </div>

      <ChoiceGroup label="5 · How the Day Moves On" strong>
        <ChoiceCard selected={advance === 'AUTO'} onSelect={() => setAdvance('AUTO')} title="Automatic" text="The next day at midnight after a healthy day that sent mail; two days over a limit go back a day and pause." />
        <ChoiceCard selected={advance === 'APPROVE'} onSelect={() => setAdvance('APPROVE')} title="Approve Each Step" text="A healthy day offers the next one; someone with delivery rights approves it, stays or goes back a day." />
      </ChoiceGroup>

      {start.isError && <Notice tone="error">{problemText(start.error)}</Notice>}
      {canEdit && (
        <div className="flex justify-end">
          <button type="button" className={buttonPrimary} disabled={!ready} onClick={() => start.mutate()}>Start Warm-Up</button>
        </div>
      )}
    </section>
  )
}
