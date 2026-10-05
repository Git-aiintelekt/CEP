/**
 * /journeys/:id (phase 6d): the journey's own page — performance metrics, a read-only Setup summary, the
 * enrollment-over-time chart, Generated Campaigns and a derived Activity log. Reached from JourneysPage's row
 * preview popover and its own "View Details" link, which this replaces (both used to open a not-built-yet dialog).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Copy, Lock, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { TextArea, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { EmptyState, ErrorState, SkeletonLine, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { CardLink, DetailCard, Fact, FACTS_GRID, Metric } from '@/features/campaigns/parts'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import { formatDate, formatDateTime, formatNumber, formatPercent, titleize } from '@/lib/format'
import type {
  Journey, JourneyAudience, JourneyEntryRule, JourneyGeneratedCampaignRow, JourneyMetrics, JourneyTrendWeek,
  JourneyVersion, JourneyActivityEntry,
} from '@/lib/types'

import { CHANNEL_META } from './channelMeta'
import { EnrollmentTrendChart } from './EnrollmentTrendChart'
import { activityLine } from './JourneyPreviewPopover'
import { entrySummary } from './SettingsSidebar'
import { FAMILY_META } from './triggerFamily'

interface PerformanceResponse {
  summary: { active_enrollment_count: number; completed_count: number; exited_count: number; status: string | null; last_refreshed_at: string } | null
  metrics: JourneyMetrics
}

const LIFECYCLE_LABEL: Record<string, string> = { DRAFT: 'Publish Journey', ACTIVE: 'Pause Journey', PAUSED: 'Resume Journey' }

function MetricCard({ label, value, sub }: { label: string; value: number | string | null | undefined; sub?: string }) {
  return <Metric label={label} value={value === null || value === undefined ? '—' : typeof value === 'number' ? formatNumber(value) : value} note={sub} />
}

/** Click to edit Goal / Exit criteria inline. Full editing is the Setup modal's job (6e, not built yet) — this is
 * the "simple inline edit" fallback called for when that gap was flagged. */
function EditableFact({ label, value, placeholder, onSave, editable }: { label: string; value: string | null; placeholder: string; onSave: (value: string) => Promise<unknown>; editable: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  if (editing) {
    return (
      <div>
        <dt className="text-helper font-semibold text-ink-800">{label}</dt>
        <TextArea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} className="mt-1 w-full" autoFocus />
        <div className="mt-1.5 flex gap-2">
          <Button size="sm" variant="primary" loading={saving} onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); setEditing(false) }}>Save</Button>
          <Button size="sm" onClick={() => { setDraft(value ?? ''); setEditing(false) }}>Cancel</Button>
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
  const saveField = useMutation({
    mutationFn: (body: Partial<Pick<Journey, 'goal_description' | 'exit_criteria_description'>>) => api.patch<Journey>(`/journeys/${id}/`, body),
    onSuccess: (updated) => queryClient.setQueryData(['journeys', 'detail', id], updated),
  })

  if (journeyQuery.isPending) return <p className="flex items-center gap-3 text-sm text-ink-800"><Spinner /> Loading journey</p>
  if (journeyQuery.isError) return <ErrorState error={journeyQuery.error} onRetry={() => void journeyQuery.refetch()} />

  const journey = journeyQuery.data
  const metrics = performanceQuery.data?.metrics
  const family = journey.trigger_family ? FAMILY_META[journey.trigger_family] : null
  const editable = can('journey.edit')
  const canActivate = can('journey.activate')
  const trigger = entryRulesQuery.data?.graph.entry_rules[0]
  const busy = pause.isPending || resume.isPending || duplicate.isPending

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
          <h1 className="font-display text-page-title font-semibold break-words text-ink-900">{journey.name}</h1>
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
          {journey.status === 'DRAFT' && editable && (
            <Link to={`/journeys/${journey.id}/build`} className={buttonSecondary}>{LIFECYCLE_LABEL.DRAFT}</Link>
          )}
          {journey.status === 'ACTIVE' && canActivate && (
            <Button disabled={busy} loading={pause.isPending} onClick={() => pause.mutate()}>{LIFECYCLE_LABEL.ACTIVE}</Button>
          )}
          {journey.status === 'PAUSED' && canActivate && (
            <Button variant="primary" disabled={busy} loading={resume.isPending} onClick={() => resume.mutate()}>{LIFECYCLE_LABEL.PAUSED}</Button>
          )}
          {editable && <Link to={`/journeys/${journey.id}/build`} className={buttonPrimary}>Edit Journey</Link>}
        </div>
      </header>

      <div className="mt-5 flex flex-col gap-3 empty:hidden">
        <NoticeBanner journey={journey} metrics={metrics} />
        {actionError != null && <p role="alert" className="text-sm font-medium text-danger-text">{problemText(actionError)}</p>}
      </div>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-card-heading font-semibold text-ink-900">Performance</h2>
        <dl className={FACTS_GRID}>
          <MetricCard label="Enrolled" value={metrics?.enrolled} sub={`Since ${formatDate(journey.created_at)}`} />
          <MetricCard label="In Journey" value={metrics?.in_journey} sub="Waiting at a delay" />
          <MetricCard label="Goal Converted" value={metrics?.goal_converted} sub={journey.status === 'DRAFT' ? 'Not published' : formatPercent(metrics?.goal_converted_pct) + ' of enrolled'} />
          <MetricCard label="Exited Early" value={metrics?.exited_early} sub={journey.status === 'DRAFT' ? 'Not published' : formatPercent(metrics?.exited_early_pct) + ' of enrolled'} />
        </dl>
      </section>

      <section className="mt-6 flex flex-col gap-6">
        <DetailCard title="Setup" tag={<Tag icon={Lock}>Edit in the Builder</Tag>}>
          <dl className={FACTS_GRID}>
            <Fact label="Trigger">{trigger ? entrySummary(trigger) : entryRulesQuery.isPending ? 'Loading…' : 'Not set'}</Fact>
            <EditableFact label="Goal" value={journey.goal_description} placeholder="Not set" editable={editable}
              onSave={(value) => saveField.mutateAsync({ goal_description: value })} />
            <EditableFact label="Exit Criteria" value={journey.exit_criteria_description} placeholder="Not set" editable={editable}
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

    </section>
  )
}
