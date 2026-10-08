/**
 * /journeys/:id (phase 6d): the journey's own page — performance metrics, a read-only Setup summary, the
 * enrollment-over-time chart, Generated Campaigns and a derived Activity log. Reached from JourneysPage's row
 * preview popover and its own "View Details" link, which this replaces (both used to open a not-built-yet dialog).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Bookmark, CalendarX, ChevronLeft, Copy, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { Counter, TextArea, buttonDanger, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { EmptyState, ErrorState, SkeletonLine, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { CardLink, DetailCard, Fact, FACTS_GRID, Metric } from '@/features/campaigns/parts'
import { problemText } from '@/features/contact-lists/problem'
import { PageHelp } from '@/help/HelpPanel'
import { api } from '@/lib/api'
import { useFieldRules } from '@/lib/fieldRules'
import { failureText } from '@/lib/saveFeedback'
import { formatDate, formatDateTime, formatNumber, formatPercent, titleize } from '@/lib/format'
import type {
  Journey, JourneyAudience, JourneyEntryRule, JourneyGeneratedCampaignRow, JourneyMessageMetrics, JourneyMetrics, JourneyTrendWeek,
  JourneyVersion, JourneyActivityEntry,
} from '@/lib/types'

import { CHANNEL_META } from './channelMeta'
import { CustomersCard } from './CustomersCard'
import { NeedsAttentionCard } from './NeedsAttentionCard'
import { SuppressionsCard } from './SuppressionsCard'
import { SaveAsTemplateModal } from './templates/SaveAsTemplateModal'
import { WebhookCallsCard } from './WebhookCallsCard'
import { EnrollmentTrendChart } from './EnrollmentTrendChart'
import { activityLine } from './JourneyPreviewPopover'
import { entrySummary } from './SettingsSidebar'
import { FAMILY_META } from './triggerFamily'

interface PerformanceResponse {
  summary: { active_enrollment_count: number; completed_count: number; exited_count: number; status: string | null; last_refreshed_at: string } | null
  metrics: JourneyMetrics
  messages?: JourneyMessageMetrics
}

function MessagesBlock({ messages }: { messages: JourneyMessageMetrics | undefined }) {
  if (!messages) return null
  const pct = (value: number | null) => (value === null ? undefined : `${formatPercent(value)} of sent`)
  const held = messages.held_back_reasons.length ? messages.held_back_reasons.map((item) => `${item.reason} ${formatNumber(item.count)}`).join(' · ') : undefined
  return (
    <div className="mt-4 rounded-lg border border-line p-4">
      <h3 className="text-card-title font-semibold text-ink-900">Messages, All Steps</h3>
      <p className="mt-0.5 text-helper text-ink-800">Every message step added up, last 30 days. Each step’s own figures are on its generated campaign.</p>
      <dl className={`${FACTS_GRID} mt-3`}>
        <MetricCard label="Sent" value={messages.sent} />
        <MetricCard label="Delivered" value={messages.delivered} sub={pct(messages.delivered_pct)} />
        <MetricCard label="Opened" value={messages.opened} sub={pct(messages.opened_pct)} />
        <MetricCard label="Clicked" value={messages.clicked} sub={pct(messages.clicked_pct)} />
        <MetricCard label="Bounced" value={messages.bounced} />
        <MetricCard label="Complained" value={messages.complained} />
        <MetricCard label="Unsubscribed" value={messages.unsubscribed} />
        <MetricCard label="Held Back" value={messages.held_back} sub={held} />
        <MetricCard label="Failed" value={messages.failed} />
      </dl>
    </div>
  )
}

const LIFECYCLE_LABEL: Record<string, string> = { DRAFT: 'Publish Journey', ACTIVE: 'Pause Journey', PAUSED: 'Resume Journey' }

function MetricCard({ label, value, sub }: { label: string; value: number | string | null | undefined; sub?: string }) {
  return <Metric label={label} value={value === null || value === undefined ? '—' : typeof value === 'number' ? formatNumber(value) : value} note={sub} />
}

/** Click to edit Goal / Exit criteria inline. Full editing is the Setup modal's job (6e, not built yet) — this is
 * the "simple inline edit" fallback called for when that gap was flagged. */
function EditableFact({ label, value, placeholder, onSave, editable, max }: {
  label: string; value: string | null; placeholder: string; onSave: (value: string) => Promise<unknown>; editable: boolean; max: number
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = `fact-${label.toLowerCase().replace(/\W+/g, '-')}`

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (problem) {
      // beside the text being edited, in CEP's words (lib/saveFeedback): the field's own message, or why it failed and what to do
      setError(failureText(problem, `The ${label.toLowerCase()} was not saved`))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div>
        <dt className="flex items-baseline justify-between gap-2 text-helper font-semibold text-ink-800">
          <label htmlFor={inputId}>{label}</label>
          <Counter used={draft.length} max={max} />
        </dt>
        <TextArea id={inputId} value={draft} maxLength={max} invalid={error !== null} onChange={(event) => setDraft(event.target.value)} rows={2} className="mt-1 w-full" autoFocus />
        {error && <p role="alert" className="mt-1 text-helper font-medium text-danger-text">{error}</p>}
        <div className="mt-1.5 flex gap-2">
          <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
          <Button size="sm" onClick={() => { setDraft(value ?? ''); setError(null); setEditing(false) }}>Cancel</Button>
        </div>
      </div>
    )
  }
  return (
    <div data-fact={label}>
      <dt className="flex items-center gap-1.5 text-helper font-semibold text-ink-800">
        {label}
        {editable && (
          <button type="button" aria-label={`Edit ${label}`} onClick={() => setEditing(true)} className="text-ink-800 hover:text-ink-900">
            <Pencil size={12} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </dt>
      <dd className="text-card-title break-words text-ink-900">{value || <span className="text-ink-300">{placeholder}</span>}</dd>
    </div>
  )
}

function NoticeBanner({ journey, metrics }: { journey: Journey; metrics: JourneyMetrics | undefined }) {
  if (journey.status === 'DRAFT') {
    return <Notice tone="info" layout="banner">Not published — no contacts enrolled yet.</Notice>
  }
  if (journey.status === 'PAUSED') {
    const held = metrics?.in_journey
    return (
      <Notice tone="warning" layout="banner">
        Paused {formatDate(journey.updated_at)} · new enrollments halted, {held === null || held === undefined ? 'some' : formatNumber(held)} contact{held === 1 ? '' : 's'} held in place.
      </Notice>
    )
  }
  if (journey.status === 'ACTIVE') return null
  // Test / Approved / Archived: the real prototype's Journey Details only specifies Draft/Paused/Active copy —
  // reuse the List page preview popover's wording for the rest, rather than invent new copy for them.
  return <Notice tone={journey.status === 'TEST' ? 'info' : 'warning'} layout="banner">{activityLine(journey, undefined, metrics?.in_journey ?? null)}</Notice>
}

export function JourneyDetailsPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<unknown>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [searchParams] = useSearchParams()
  const rule = useFieldRules('journey')

  const journeyQuery = useQuery({ queryKey: ['journeys', 'detail', id], queryFn: ({ signal }) => api.get<Journey>(`/journeys/${id}/`, undefined, signal) })
  const versionsQuery = useQuery({
    queryKey: ['journeys', 'versions', id],
    queryFn: ({ signal }) => api.get<JourneyVersion[]>(`/journeys/${id}/versions/`, undefined, signal),
    enabled: journeyQuery.isSuccess,
  })
  const version = versionsQuery.data?.find((item) => item.id === journeyQuery.data?.current_version)
    ?? versionsQuery.data?.slice().sort((a, b) => b.version_number - a.version_number)[0]
  const entryRulesQuery = useQuery({
    queryKey: ['journeys', 'version', id, version?.version_number],
    queryFn: ({ signal }) => api.get<{ graph: { entry_rules: JourneyEntryRule[] } }>(`/journeys/${id}/versions/${version!.version_number}/`, undefined, signal),
    enabled: version !== undefined,
  })
  const performanceQuery = useQuery({
    queryKey: ['journeys', 'performance', id],
    queryFn: ({ signal }) => api.get<PerformanceResponse>(`/journeys/${id}/performance/`, undefined, signal),
    enabled: journeyQuery.isSuccess,
  })
  const audienceQuery = useQuery({
    queryKey: ['journeys', 'audience', id],
    queryFn: ({ signal }) => api.get<JourneyAudience>(`/journeys/${id}/audience/`, undefined, signal),
    enabled: journeyQuery.isSuccess,
  })
  const notDraft = journeyQuery.data !== undefined && journeyQuery.data.status !== 'DRAFT'
  const trendQuery = useQuery({
    queryKey: ['journeys', 'enrollment-trend', id],
    queryFn: ({ signal }) => api.get<JourneyTrendWeek[]>(`/journeys/${id}/enrollment-trend/`, undefined, signal),
    enabled: notDraft,
  })
  const campaignsQuery = useQuery({
    queryKey: ['journeys', 'campaigns', id],
    queryFn: ({ signal }) => api.get<JourneyGeneratedCampaignRow[]>(`/journeys/${id}/campaigns/`, undefined, signal),
    enabled: journeyQuery.isSuccess,
  })
  const activityQuery = useQuery({
    queryKey: ['journeys', 'activity', id],
    queryFn: ({ signal }) => api.get<JourneyActivityEntry[]>(`/journeys/${id}/activity/`, undefined, signal),
    enabled: journeyQuery.isSuccess,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['journeys'] })
  }
  const pause = useMutation({
    mutationFn: () => api.post<Journey>(`/journeys/${id}/pause/`),
    onSuccess: (updated) => { queryClient.setQueryData(['journeys', 'detail', id], updated); invalidate(); toast.success(`“${updated.name}” is paused.`) },
    onError: setActionError,
  })
  const resume = useMutation({
    mutationFn: () => api.post<Journey>(`/journeys/${id}/resume/`),
    onSuccess: (updated) => { queryClient.setQueryData(['journeys', 'detail', id], updated); invalidate(); toast.success(`“${updated.name}” is running again.`) },
    onError: setActionError,
  })
  const duplicate = useMutation({
    mutationFn: () => api.post<Journey>(`/journeys/${id}/duplicate/`),
    onSuccess: (copy) => { invalidate(); toast.success(`“${copy.name}” was created as a draft.`); navigate(`/journeys/${copy.id}/build`) },
    onError: setActionError,
  })
  const archive = useMutation({
    mutationFn: () => api.post<Journey & { ended: number }>(`/journeys/${id}/archive/`),
    onSuccess: (updated) => {
      setConfirmArchive(false)
      queryClient.setQueryData(['journeys', 'detail', id], updated)
      invalidate()
      toast.success(updated.ended ? `“${updated.name}” is archived; ${formatNumber(updated.ended)} customer${updated.ended === 1 ? '' : 's'} left it.` : `“${updated.name}” is archived.`)
    },
    onError: (error) => { setConfirmArchive(false); setActionError(error) },
  })
  const cancelSchedule = useMutation({
    mutationFn: () => api.post<Journey>(`/journeys/${id}/cancel-schedule/`),
    onSuccess: (updated) => {
      queryClient.setQueryData(['journeys', 'detail', id], updated)
      invalidate()
      toast.success(updated.status === 'TEST' ? `“${updated.name}” will not go live; approve it again from Test Publish.`
                                                : 'The new version will not go live; the live version carries on. Approve it again from Test Publish.')
    },
    onError: setActionError,
  })
  const saveField = useMutation({
    mutationFn: (body: Partial<Pick<Journey, 'goal_description' | 'exit_criteria_description'>>) => api.patch<Journey>(`/journeys/${id}/`, body),
    onSuccess: (updated, body) => {
      toast.success('goal_description' in body ? 'Goal saved' : 'Exit criteria saved')
      queryClient.setQueryData(['journeys', 'detail', id], updated)
    },
  })

  if (journeyQuery.isPending) return <p className="flex items-center gap-3 text-sm text-ink-800"><Spinner /> Loading journey</p>
  if (journeyQuery.isError) return <ErrorState error={journeyQuery.error} onRetry={() => void journeyQuery.refetch()} />

  const journey = journeyQuery.data
  const metrics = performanceQuery.data?.metrics
  const family = journey.trigger_family ? FAMILY_META[journey.trigger_family] : null
  const editable = can('journey.edit')
  const canActivate = can('journey.activate')
  const trigger = entryRulesQuery.data?.graph.entry_rules[0]
  const busy = pause.isPending || resume.isPending || duplicate.isPending || archive.isPending || cancelSchedule.isPending
  const live = journey.status === 'ACTIVE' || journey.status === 'PAUSED' || journey.status === 'APPROVED'
  const canArchive = journey.status !== 'ARCHIVED' && (live ? canActivate : editable)
  const versions = (versionsQuery.data ?? []).slice().sort((a, b) => b.version_number - a.version_number)
  const running = journey.status === 'ACTIVE' || journey.status === 'PAUSED'
  const nextVersion = running ? versions.find((row) => row.status === 'DRAFT' || row.status === 'TEST_PUBLISHED') : undefined
  const nextScheduled = nextVersion !== undefined && journey.scheduled_activate_at !== null && journey.current_version === nextVersion.id

  const campaignColumns: Column<JourneyGeneratedCampaignRow>[] = [
    { key: 'campaign', header: 'Campaign', render: (row) => <Link to={`/campaigns/${row.campaign_id}`} className="font-medium text-brand-800 hover:underline">{row.campaign_name}</Link> },
    { key: 'node', header: 'Node', render: (row) => <span className="text-ink-900">{titleize(row.node_key)} <span className="text-ink-800">· {titleize(row.node_type)}</span></span> },
    { key: 'last_run', header: 'Last Run', render: (row) => formatDateTime(row.last_run_at) },
    { key: 'recipients', header: 'Recipients', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.recipients)}</span> },
    { key: 'status', header: 'Status', render: (row) => (row.status ? <StatusBadge status={row.status} /> : <span className="text-ink-300">—</span>) },
  ]

  return (
    <section>
      <Link to="/journeys" className="mb-3 inline-flex items-center gap-1 text-helper text-brand-800 hover:underline">
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden /> Journeys
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3">
          <span className="flex min-w-0 items-start gap-1.5"><h1 className="font-display text-page-title font-semibold break-words text-ink-900">{journey.name}</h1><PageHelp chapter="journeys" /></span>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={journey.status} />
            {family && <Tag icon={family.icon}>{family.label}</Tag>}
            {journey.channels.map((channel) => {
              const meta = CHANNEL_META[channel]
              return <Tag key={channel} icon={meta?.icon}>{meta?.label ?? channel}</Tag>
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {editable && <Button iconStart={Copy} disabled={busy} loading={duplicate.isPending} onClick={() => duplicate.mutate()}>Duplicate</Button>}
          {editable && journey.status !== 'ARCHIVED' && <Button iconStart={Bookmark} disabled={busy} onClick={() => setSavingTemplate(true)}>Save as Template</Button>}
          {journey.status === 'DRAFT' && editable && (
            <Link to={`/journeys/${journey.id}/build`} className={buttonSecondary}>{LIFECYCLE_LABEL.DRAFT}</Link>
          )}
          {journey.status === 'ACTIVE' && canActivate && (
            <Button disabled={busy} loading={pause.isPending} onClick={() => pause.mutate()}>{LIFECYCLE_LABEL.ACTIVE}</Button>
          )}
          {journey.status === 'PAUSED' && canActivate && (
            <Button variant="primary" disabled={busy} loading={resume.isPending} onClick={() => resume.mutate()}>{LIFECYCLE_LABEL.PAUSED}</Button>
          )}
          {nextVersion && !nextScheduled && editable && (
            <Link to={`/journeys/${journey.id}/test-publish`} className={buttonSecondary}>Test Publish Version {nextVersion.version_number}</Link>
          )}
          {journey.status !== 'ARCHIVED' && journey.scheduled_activate_at && canActivate && (
            <Button iconStart={CalendarX} disabled={busy} loading={cancelSchedule.isPending} onClick={() => cancelSchedule.mutate()}>Cancel Schedule</Button>
          )}
          {canArchive && <Button iconStart={Archive} disabled={busy} onClick={() => setConfirmArchive(true)}>Archive Journey</Button>}
          {editable && journey.status !== 'ARCHIVED' && <Link to={`/journeys/${journey.id}/build`} className={buttonPrimary}>Edit Journey</Link>}
        </div>
      </header>

      <div className="mt-5 flex flex-col gap-3 empty:hidden">
        <NoticeBanner journey={journey} metrics={metrics} />
        {nextVersion && (
          <Notice tone="info" layout="banner">
            {nextScheduled && journey.scheduled_activate_at
              ? `Version ${nextVersion.version_number} replaces the live version on ${formatDateTime(journey.scheduled_activate_at)}; the live version keeps running until then.`
              : nextVersion.status === 'DRAFT'
                ? `Version ${nextVersion.version_number} is a draft. The live version keeps running; test publish the new one, then approve it to replace the live version.`
                : `Version ${nextVersion.version_number} is tested and waiting for approval. The live version keeps running until it is approved.`}
          </Notice>
        )}
        {actionError != null && <p role="alert" className="text-sm font-medium text-danger-text">{problemText(actionError)}</p>}
      </div>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-card-heading font-semibold text-ink-900">Performance</h2>
        <dl className={FACTS_GRID}>
          <MetricCard label="Enrolled" value={metrics?.enrolled} sub={`Since ${formatDate(journey.created_at)}`} />
          <MetricCard label="In Journey" value={metrics?.in_journey} sub="Waiting at a delay" />
          <MetricCard label={metrics?.has_goal ? 'Converted' : 'Goal Converted'} value={metrics?.goal_converted}
            sub={journey.status === 'DRAFT' ? 'Not published' : `${formatPercent(metrics?.goal_converted_pct)} of enrolled`} />
          <MetricCard label="Exited Early" value={metrics?.exited_early} sub={journey.status === 'DRAFT' ? 'Not published' : formatPercent(metrics?.exited_early_pct) + ' of enrolled'} />
        </dl>
        {metrics?.has_goal && journey.status !== 'DRAFT' && (
          <dl className={`${FACTS_GRID} mt-4`} data-goal-figures>
            <MetricCard label="Attributed Revenue" value={metrics.attributed_revenue === null || metrics.attributed_revenue === undefined ? null : formatNumber(metrics.attributed_revenue)} sub="Within the goal’s window, from the Attribution settings" />
            <MetricCard label="Average per Conversion" value={metrics.revenue_per_conversion === null || metrics.revenue_per_conversion === undefined ? null : formatNumber(metrics.revenue_per_conversion)} />
          </dl>
        )}
        {journey.status !== 'DRAFT' && <MessagesBlock messages={performanceQuery.data?.messages} />}
      </section>

      <section className="mt-6 flex flex-col gap-6">
        <DetailCard title="Setup" tag={<Tag icon={Lock}>Edit in the Builder</Tag>}>
          <dl className={FACTS_GRID}>
            <Fact label="Trigger">{trigger ? entrySummary(trigger) : entryRulesQuery.isPending ? 'Loading…' : 'Not set'}</Fact>
            <EditableFact label="Goal" value={journey.goal_description} placeholder="Not set" editable={editable} max={rule('goal_description')?.max ?? 500}
              onSave={(value) => saveField.mutateAsync({ goal_description: value })} />
            <EditableFact label="Exit Criteria" value={journey.exit_criteria_description} placeholder="Not set" editable={editable} max={rule('exit_criteria_description')?.max ?? 500}
              onSave={(value) => saveField.mutateAsync({ exit_criteria_description: value })} />
            <Fact label="Re-Entry">
              {titleize(journey.reentry_policy)}
              {journey.reentry_policy === 'AFTER_X_DAYS' && journey.reentry_after_days ? ` · ${journey.reentry_after_days} days` : ''}
            </Fact>
          </dl>

          <h3 className="mt-6 mb-3 text-card-title font-semibold text-ink-900">Audience &amp; Enrollment</h3>
          {audienceQuery.isPending ? (
            <div className="flex flex-col gap-2"><SkeletonLine width="40%" /><SkeletonLine width="30%" /></div>
          ) : audienceQuery.isError ? (
            <ErrorState error={audienceQuery.error} onRetry={() => void audienceQuery.refetch()} />
          ) : (
            <dl className={FACTS_GRID}>
              <Fact label="Source Lists">
                {audienceQuery.data!.source_lists.length === 0
                  ? <span className="text-ink-300">—</span>
                  : <span className="flex flex-wrap gap-1.5">{audienceQuery.data!.source_lists.map((list) => <Tag key={list.id}>{list.name}</Tag>)}</span>}
              </Fact>
              <Fact label="Eligible Pool">{audienceQuery.data!.eligible_pool === null ? 'Not calculated' : `${formatNumber(audienceQuery.data!.eligible_pool)} contacts`}</Fact>
              <Fact label="Enrollment Rate">{audienceQuery.data!.enrollment_rate_per_day === null ? '—' : `${formatNumber(audienceQuery.data!.enrollment_rate_per_day)} / day average`}</Fact>
            </dl>
          )}
        </DetailCard>

        {notDraft && (
          <DetailCard title="Enrollment Over Time">
            <EnrollmentTrendChart weeks={trendQuery.data} loading={trendQuery.isPending} error={trendQuery.error} onRetry={() => void trendQuery.refetch()} />
          </DetailCard>
        )}

        <NeedsAttentionCard journeyId={journey.id} published={journey.status !== 'DRAFT'} />

        <CustomersCard journeyId={journey.id} published={journey.status !== 'DRAFT'} initialOpen={searchParams.get('customer')} />

        <SuppressionsCard journeyId={journey.id} />

        {journey.step_types.includes('WEBHOOK') && <WebhookCallsCard journeyId={journey.id} />}

        <DetailCard title="Versions" flush>
          {versionsQuery.isPending ? (
            <div className="p-6"><Spinner /></div>
          ) : versionsQuery.isError ? (
            <div className="p-6"><ErrorState error={versionsQuery.error} onRetry={() => void versionsQuery.refetch()} /></div>
          ) : (
            <DataTable rows={versions} rowKey={(row) => row.id} caption="Journey versions" inset="card" framed={false} columns={[
              { key: 'version', header: 'Version', render: (row) => (
                <span className="flex items-center gap-2 font-medium text-ink-900">
                  Version {row.version_number}
                  {row.status === 'ACTIVE' && <Tag>Live</Tag>}
                  {nextScheduled && row.id === nextVersion?.id && <Tag>Scheduled</Tag>}
                </span>
              ) },
              { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
              { key: 'published', header: 'Went Live', render: (row) => (row.published_at ? formatDateTime(row.published_at) : <span className="text-ink-300">—</span>) },
              { key: 'created', header: 'Created', render: (row) => formatDateTime(row.created_at) },
            ]} />
          )}
        </DetailCard>

        <DetailCard title="Generated Campaigns" actions={<CardLink to="/campaigns">See All</CardLink>} flush>
          {campaignsQuery.isPending ? (
            <div className="p-6"><Spinner /></div>
          ) : campaignsQuery.isError ? (
            <div className="p-6"><ErrorState error={campaignsQuery.error} onRetry={() => void campaignsQuery.refetch()} /></div>
          ) : campaignsQuery.data!.length === 0 ? (
            <div className="p-6"><EmptyState title="No campaigns generated yet" hint="Publish the journey to start generating campaigns." /></div>
          ) : (
            <DataTable columns={campaignColumns} rows={campaignsQuery.data!} rowKey={(row) => row.id} caption="Generated campaigns" inset="card" framed={false} />
          )}
        </DetailCard>

        <DetailCard title="Activity">
          {activityQuery.isPending ? (
            <div className="flex flex-col gap-5">{['60%', '48%', '56%'].map((width) => <SkeletonLine key={width} width={width} />)}</div>
          ) : activityQuery.isError ? (
            <ErrorState error={activityQuery.error} onRetry={() => void activityQuery.refetch()} />
          ) : activityQuery.data!.length === 0 ? (
            <p className="text-sm text-ink-800">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col" aria-label="Journey activity">
              {activityQuery.data!.map((entry, index) => (
                <li key={`${entry.occurred_at}-${index}`} className="flex items-start gap-3 border-b border-line-subtle py-3 first:pt-0 last:border-0 last:pb-0">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-300" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                        {titleize(entry.event_type)}
                        {entry.version_number !== null && <Tag>{`v${entry.version_number}`}</Tag>}
                      </p>
                      <p className="text-sm text-ink-800">{entry.message}</p>
                    </div>
                    <p className="cep-num shrink-0 text-helper text-ink-800 sm:text-right">{entry.actor_name ?? 'System'} · {formatDateTime(entry.occurred_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DetailCard>
      </section>

      {savingTemplate && <SaveAsTemplateModal journey={journey} versionNumber={version?.version_number ?? journey.latest_version ?? 1} onClose={() => setSavingTemplate(false)} />}
      {confirmArchive && (
        <Modal title="Archive This Journey?" onClose={() => setConfirmArchive(false)} footer={(
          <>
            <button type="button" className={buttonSecondary} onClick={() => setConfirmArchive(false)}>Cancel</button>
            <button type="button" className={buttonDanger} disabled={archive.isPending} onClick={() => archive.mutate()}>Archive Journey</button>
          </>
        )}>
          <p className="text-sm text-ink-900">
            Nobody new enters, and {metrics?.in_journey ? `the ${formatNumber(metrics.in_journey)} customer${metrics.in_journey === 1 ? '' : 's'} in it leave` : 'anyone still in it leaves'} their path now.
            Its live and tested versions are retired and any scheduled start is dropped.
          </p>
          <p className="mt-2 text-sm text-ink-800">This can’t be undone. Duplicate starts the same journey again as a draft.</p>
        </Modal>
      )}
    </section>
  )
}
