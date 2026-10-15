import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { SaveTick } from '@/components/SaveTick'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { buttonClass } from '@/components/buttonStyles'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import type { Integration, IntegrationHealth, IntegrationLogDetail, IntegrationLogPage, IntegrationLogRow, IntegrationMetrics, IntegrationOutcome } from '@/lib/types'

const INTEGRATIONS = ['integrations']
const PAGE_SIZES = [10, 25, 50, 100]
const ROWS_KEY = 'cep.integrations.logRows'                                       // the rows per page this browser chose

function readRows(): number {
  try {
    const stored = Number(window.localStorage.getItem(ROWS_KEY))
    return PAGE_SIZES.includes(stored) ? stored : 25
  } catch {
    return 25
  }
}

const HEALTH: Record<IntegrationHealth, { status: string; label: string }> = {
  healthy: { status: 'ACTIVE', label: 'Healthy' },
  degraded: { status: 'PAUSED', label: 'Degraded' },
  circuit_open: { status: 'FAILED', label: 'Circuit Open' },
  paused: { status: 'PAUSED', label: 'Paused' },
  idle: { status: 'ARCHIVED', label: 'No Calls Yet' },
}

const OUTCOME: Record<IntegrationOutcome, { status: string; label: string }> = {
  OK: { status: 'ACTIVE', label: 'OK' },
  REJECTED: { status: 'ARCHIVED', label: 'Rejected' },
  RETRY: { status: 'PAUSED', label: 'Retried' },
  ERROR: { status: 'FAILED', label: 'Error' },
  THROTTLED: { status: 'PAUSED', label: 'Throttled' },
  BREAKER: { status: 'FAILED', label: 'Circuit Open' },
  PAUSED: { status: 'ARCHIVED', label: 'Paused' },
}

function OutcomeBadge({ outcome }: { outcome: IntegrationOutcome }) {
  const item = OUTCOME[outcome] ?? { status: 'ARCHIVED', label: outcome }
  return <StatusBadge status={item.status} label={item.label} />
}

const bytes = (n: number | null | undefined) => n == null ? '—' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
const ms = (n: number | null | undefined) => n == null ? '—' : `${formatNumber(n)} ms`

function pretty(text: string | null): string {
  if (!text) return ''
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

// ---------------------------------------------------------------------------------------------------- the day's chart
const STEP = 15
const SLOTS = (24 * 60) / STEP
const BAR = 6
const CHART_H = 44

/** 24 hours of 15-minute bars: calls, with the failed and throttled share on top in their own colours. One scale for every bar. */
function DayChart({ integrationId, name }: { integrationId: string; name: string }) {
  const metrics = useQuery({
    queryKey: [...INTEGRATIONS, 'metrics', integrationId],
    queryFn: ({ signal }) => api.get<IntegrationMetrics>(`/integrations/${integrationId}/metrics/`, { hours: 24 }, signal),
    refetchInterval: 60_000,
  })
  const now = metrics.dataUpdatedAt || 0                                              // the fetch time, stable across renders
  const start = Math.floor((now - 24 * 60 * 60_000) / (STEP * 60_000)) * STEP * 60_000
  const slots = Array.from({ length: SLOTS }, () => ({ calls: 0, failed: 0, throttled: 0, p95: 0 }))
  for (const bucket of metrics.data?.buckets ?? []) {
    const index = Math.floor((new Date(bucket.bucket).getTime() - start) / (STEP * 60_000))
    if (index < 0 || index >= SLOTS) continue
    slots[index].calls += bucket.calls
    slots[index].failed += bucket.failed
    slots[index].throttled += bucket.throttled
    slots[index].p95 = Math.max(slots[index].p95, bucket.p95_ms ?? 0)
  }
  const peak = Math.max(1, ...slots.map((slot) => slot.calls))
  const busiest = slots.reduce((best, slot, index) => (slot.calls > slots[best].calls ? index : best), 0)
  const total = slots.reduce((sum, slot) => sum + slot.calls, 0)
  if (metrics.isPending) return <div className="mt-3 h-[60px] animate-pulse rounded-sm bg-surface-subtle" aria-busy><span className="sr-only">Loading the day's chart</span></div>
  if (metrics.isError) return <p className="mt-3 text-xs text-danger-text">The chart could not be loaded.</p>
  if (total === 0) return <p className="mt-3 text-xs text-ink-800">No calls in the last 24 hours.</p>
  const width = SLOTS * BAR
  const y = (value: number) => CHART_H - (value / peak) * CHART_H
  return (
    <figure className="mt-3" data-day-chart>
      <svg viewBox={`0 0 ${width} ${CHART_H}`} preserveAspectRatio="none" className="block h-[52px] w-full" role="img"
        aria-label={`${name}: calls per 15 minutes over the last 24 hours, up to ${formatNumber(peak)} at the busiest`}>
        {slots.map((slot, index) => slot.calls > 0 && (
          <g key={index}>
            <rect x={index * BAR + 1} y={y(slot.calls)} width={BAR - 2} height={CHART_H - y(slot.calls)} className="fill-chart-soft" />
            {slot.throttled > 0 && <rect x={index * BAR + 1} y={y(slot.throttled)} width={BAR - 2} height={CHART_H - y(slot.throttled)} className="fill-warning" />}
            {slot.failed > 0 && <rect x={index * BAR + 1} y={y(slot.failed)} width={BAR - 2} height={CHART_H - y(slot.failed)} className="fill-danger-plain" />}
          </g>
        ))}
        <line x1="0" x2={width} y1={CHART_H - 0.5} y2={CHART_H - 0.5} className="stroke-line" strokeWidth="1" />
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-ink-800">
        <span>24 h ago</span>
        <span className="cep-num">Busiest {formatNumber(slots[busiest].calls)} calls at {formatDateTime(new Date(start + busiest * STEP * 60_000).toISOString())}{slots[busiest].p95 ? ` · p95 ${formatNumber(slots[busiest].p95)} ms` : ''}</span>
        <span>Now</span>
      </figcaption>
      <p className="mt-1 flex items-center gap-3 text-xs text-ink-800">
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-xs bg-brand-100" aria-hidden />Calls</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-xs bg-danger-plain" aria-hidden />Failed</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-xs bg-warning" aria-hidden />Throttled</span>
      </p>
    </figure>
  )
}

// ---------------------------------------------------------------------------------------------------- status cards
function Figure({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'danger' }) {
  const colour = tone === 'danger' ? 'text-danger-text' : tone === 'warning' ? 'text-warning-text' : 'text-ink-900'
  return (
    <div>
      <dt className="text-xs text-ink-800">{label}</dt>
      <dd className={`cep-num text-base font-semibold ${colour}`}>{value}</dd>
    </div>
  )
}

type AlertsSave = UseMutationResult<unknown, unknown, { item: Integration; enabled: boolean }>

function IntegrationCard({ item, onToggle, onShowLog, onAlerts, alertsSave, busy }: { item: Integration; onToggle: () => void; onShowLog: () => void; onAlerts: (enabled: boolean) => void; alertsSave: AlertsSave; busy: boolean }) {
  const health = HEALTH[item.health] ?? HEALTH.idle
  const limit = item.direction === 'IN' ? item.effective_limit_per_minute ?? item.throttle_per_minute : item.throttle_per_minute
  const lastCall = item.last_call_at
    ? `${formatRelative(item.last_call_at)}${item.last_outcome ? ` · ${OUTCOME[item.last_outcome]?.label ?? item.last_outcome}` : ''}`
    : 'No Calls Yet'
  return (
    <li className="rounded-lg border border-line bg-surface p-4" aria-label={item.name}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-card-title font-semibold text-ink-900">{item.name}</h3>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-800">
            <Tag>{item.direction === 'IN' ? 'Receives' : 'Sends'}</Tag>
            <span>{item.system}{limit ? ` · ${formatNumber(limit)} per minute` : ' · no limit'}</span>
          </p>
        </div>
        <StatusBadge status={health.status} label={health.label} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Calls, 24 h" value={formatNumber(item.calls_24h)} />
        <Figure label="Failures" value={`${item.error_rate_24h.toFixed(1)}%`} tone={item.error_rate_24h >= 5 ? 'danger' : item.error_rate_24h > 0 ? 'warning' : 'default'} />
        <Figure label="p95" value={ms(item.p95_ms)} />
        <Figure label="Throttled" value={formatNumber(item.throttled_24h)} tone={item.throttled_24h > 0 ? 'warning' : 'default'} />
      </dl>
      <p className="mt-3 text-xs text-ink-800">Last Call: {lastCall}</p>
      <DayChart integrationId={item.id} name={item.name} />
      {item.breaker_open_seconds > 0 && <p className="mt-1 text-xs font-medium text-danger-text">Circuit open for {item.breaker_open_seconds} s more after {item.breaker_failures} failures in a row. Resume closes it now.</p>}
      {item.last_error && item.health !== 'healthy' && <p className="mt-1 truncate text-xs text-danger-text" title={item.last_error}>{item.last_error}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-3">
        <span className="flex items-center gap-2 text-xs text-ink-800" title="A circuit opening on this integration notifies the workspace by the channels set under Settings → Notifications">
          <Switch checked={item.alerts_enabled !== false} onChange={onAlerts} ariaLabel={`Email Alerts for ${item.name}`} disabled={busy} />
          Email Alerts
          <SaveTick mutation={alertsSave} of={alertsSave.variables?.item.id === item.id} />
        </span>
        <span className="flex gap-1">
        <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={onShowLog}>View Log</button>
        <button type="button" className={buttonClass({ variant: item.status === 'PAUSED' ? 'link' : 'danger', size: 'sm' })} disabled={busy} onClick={onToggle}>
          {item.status === 'PAUSED' ? 'Resume' : 'Pause'}
        </button>
        </span>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------------------------------- log detail
function Block({ title, headers, body, size }: { title: string; headers: Record<string, string> | null; body: string | null; size: number | null }) {
  return (
    <section className="rounded-lg border border-line">
      <h3 className="border-b border-line bg-surface-subtle px-3 py-2 text-xs font-semibold text-ink-800">{title}{size != null && <span className="ml-2 font-normal text-ink-800">{bytes(size)}</span>}</h3>
      {headers && Object.keys(headers).length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 border-b border-line-subtle px-3 py-2 text-xs">
          {Object.entries(headers).map(([key, value]) => <div key={key} className="contents"><dt className="text-ink-800">{key}</dt><dd className="break-all text-ink-900">{value}</dd></div>)}
        </dl>
      )}
      <pre className="cep-num max-h-80 overflow-auto px-3 py-2 text-xs whitespace-pre-wrap break-all text-ink-900">{body ? pretty(body) : <span className="text-ink-800">No body.</span>}</pre>
    </section>
  )
}

/** a send that failed can be handed back to the engine; a provider's callback can be applied again */
function rowActions(data: IntegrationLogDetail): { retry: boolean; replay: boolean } {
  const provider = data.kind === 'PROVIDER'
  return { retry: provider && data.direction === 'OUT' && data.outcome !== 'OK' && data.method !== 'REPLAY', replay: provider && data.direction === 'IN' && data.method !== 'REPLAY' && Boolean(data.request_body) }
}

function LogDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const queryClient = useQueryClient()
  const row = useQuery({ queryKey: [...INTEGRATIONS, 'log', id], queryFn: ({ signal }) => api.get<IntegrationLogDetail>(`/integrations/log/${id}/`, undefined, signal) })
  const [copied, setCopied] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const retry = useMutation({
    mutationFn: () => api.post<{ queued: boolean; note: string }>(`/integrations/log/${id}/retry/`),
    onSuccess: (result) => { setOutcome(`Queued again. ${result.note}`); void queryClient.invalidateQueries({ queryKey: INTEGRATIONS }) },
  })
  const replay = useMutation({
    mutationFn: () => api.post<{ received: number; applied: number; ignored: number; unmatched: number; failed: number }>(`/integrations/log/${id}/replay/`),
    onSuccess: (result) => {
      setOutcome(`Replayed: ${result.applied} of ${result.received} event${result.received === 1 ? '' : 's'} applied${result.ignored ? `, ${result.ignored} ignored` : ''}${result.unmatched ? `, ${result.unmatched} unmatched` : ''}${result.failed ? `, ${result.failed} failed` : ''}. The replay is a new row in the log.`)
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS })
    },
  })
  const data = row.data
  const actions = data ? rowActions(data) : { retry: false, replay: false }
  const busy = retry.isPending || replay.isPending
  return (
    <Modal title={data ? `${data.method === 'REPLAY' ? 'Replayed' : `${data.method} ${data.direction === 'IN' ? 'Received' : 'Sent'}`} · ${formatDateTime(data.started_at)}` : 'Call'} size="lg" scrollBody onClose={onClose}
      subtitle={data ? `${data.system}${data.related_ref ? ` · ${data.related_ref}` : ''}${data.attempt > 1 ? ` · attempt ${data.attempt}` : ''}` : undefined}
      footer={
        <>
          {actions.replay && <button type="button" className={buttonSecondary} disabled={busy || Boolean(outcome)} onClick={() => replay.mutate()}>{replay.isPending ? 'Replaying' : 'Replay Callback'}</button>}
          {actions.retry && <button type="button" className={buttonSecondary} disabled={busy || Boolean(outcome)} onClick={() => retry.mutate()}>{retry.isPending ? 'Queuing' : 'Retry Send'}</button>}
          <button type="button" className={buttonSecondary} onClick={onClose}>Close</button>
        </>
      }>
      {row.isError ? <ErrorState error={row.error} onRetry={() => void row.refetch()} />
        : !data ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading the call</p>
        : (
          <div className="space-y-4">
            {outcome && <p role="status" className="rounded-lg border border-success bg-success-bg px-3 py-2 text-sm text-success-text">{outcome}</p>}
            {(retry.isError || replay.isError) && <ErrorState title="That did not work" error={retry.error ?? replay.error} />}
            {actions.retry && !outcome && <p className="text-xs text-ink-800">Retry Send hands this message back to the engine: it is queued again and goes out on the dispatcher's next pass, as a new attempt in the log.</p>}
            {actions.replay && !outcome && <p className="text-xs text-ink-800">Replay Callback applies what the engine sent once more, for a callback that failed to apply. Opens and clicks already counted are counted again only if the first pass failed.</p>}
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-ink-800">Outcome</dt><dd className="mt-0.5"><OutcomeBadge outcome={data.outcome} /></dd></div>
              <div><dt className="text-xs text-ink-800">Status</dt><dd className="cep-num mt-0.5 font-medium text-ink-900">{data.response_status ?? '—'}</dd></div>
              <div><dt className="text-xs text-ink-800">Duration</dt><dd className="cep-num mt-0.5 font-medium text-ink-900">{ms(data.duration_ms)}</dd></div>
              <div><dt className="text-xs text-ink-800">Correlation ID</dt>
                <dd className="mt-0.5 flex items-center gap-1 font-medium break-all text-ink-900">{data.correlation_id ?? '—'}
                  {data.correlation_id && <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })}
                    onClick={() => void navigator.clipboard?.writeText(data.correlation_id as string).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy'}</button>}
                </dd></div>
            </dl>
            <p className="break-all text-sm text-ink-800">{data.url}</p>
            {data.error_message && <p className="rounded-lg border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">{data.error_class ? `${data.error_class}: ` : ''}{data.error_message}</p>}
            <Block title={data.direction === 'IN' ? 'What Was Received' : 'What Was Sent'} headers={data.request_headers} body={data.request_body} size={data.request_bytes} />
            <Block title={data.direction === 'IN' ? 'What Was Answered' : 'What Came Back'} headers={data.response_headers} body={data.response_body} size={data.response_bytes} />
            <p className="text-xs text-ink-800">Credentials and card numbers are masked before a call is stored. Bodies above the integration's cap keep their start and a digest.{data.worker ? ` Handled by ${data.worker}.` : ''}</p>
          </div>
        )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- page
interface Filters { integration: string; direction: string; failed: boolean; q: string }

export function IntegrationsPage() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const allowed = can('provider.edit')
  const [filters, setFiltersOnly] = useState<Filters>({ integration: '', direction: '', failed: false, q: '' })
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState(readRows)
  const setFilters = (next: Filters) => { setFiltersOnly(next); setPage(1) }                   // a new question starts on page 1
  const chooseRows = (next: number) => {
    setRows(next)
    setPage(1)
    try { window.localStorage.setItem(ROWS_KEY, String(next)) } catch { /* a private window forgets */ }
  }
  const [open, setOpen] = useState<number | null>(null)

  const integrations = useQuery({ queryKey: INTEGRATIONS, queryFn: ({ signal }) => api.get<Integration[]>('/integrations/', undefined, signal), enabled: allowed, refetchInterval: 60_000 })
  const log = useQuery({
    queryKey: [...INTEGRATIONS, 'log', filters, page, rows],
    queryFn: ({ signal }) => api.get<IntegrationLogPage>('/integrations/log/', {
      integration: filters.integration || undefined, direction: filters.direction || undefined, failed: filters.failed ? '1' : undefined, q: filters.q || undefined, page, page_size: rows,
    }, signal),
    placeholderData: keepPreviousData,                                                       // the table stays while the next page loads
    enabled: allowed,
  })
  const toggle = useMutation({
    mutationFn: (item: Integration) => api.post<Integration>(`/integrations/${item.id}/${item.status === 'PAUSED' ? 'resume' : 'pause'}/`),
    onSuccess: (_next, item) => {
      if (item.status === 'PAUSED') toast.success('Integration resumed', `“${item.name}” is running again.`)
      else toast.success('Integration paused', item.direction === 'IN' ? `Calls from “${item.name}” are refused until it is resumed.` : `Sends through “${item.name}” wait until it is resumed.`)
      return queryClient.invalidateQueries({ queryKey: INTEGRATIONS })
    },
  })
  const alerts = useMutation({
    mutationFn: ({ item, enabled }: { item: Integration; enabled: boolean }) => api.post<{ id: string; alerts_enabled: boolean }>(`/integrations/${item.id}/alerts/`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INTEGRATIONS }),
  })

  if (!allowed) return <ErrorState title="Integration settings need the provider.edit permission" detail="Ask a workspace administrator to add it to your role." />
  if (integrations.isError) return <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} />

  const items = integrations.data ?? []
  const names = Object.fromEntries(items.map((item) => [item.id, item.name]))
  const calls = log.data?.results ?? []
  const pages = log.data ? Math.max(1, Math.ceil(log.data.count / log.data.page_size)) : 1
  const columns: Column<IntegrationLogRow>[] = [
    { key: 'time', header: 'Time', render: (row) => <span className="cep-num whitespace-nowrap text-ink-900">{formatDateTime(row.started_at)}</span> },
    { key: 'integration', header: 'Integration', render: (row) => (
      <div><p className="font-medium text-ink-900">{(row.integration_id && names[row.integration_id]) || row.system}</p>
        <p className="text-xs text-ink-800">{row.direction === 'IN' ? 'Received' : 'Sent'}{row.related_ref ? ` · ${row.related_ref}` : ''}</p></div>) },
    { key: 'call', header: 'Call', render: (row) => <span className="block max-w-xs truncate text-ink-800" title={row.url}>{row.method} {row.url}</span> },
    { key: 'outcome', header: 'Outcome', render: (row) => <span className="flex items-center gap-2"><OutcomeBadge outcome={row.outcome} />{row.response_status != null && <span className="cep-num text-xs text-ink-800">{row.response_status}</span>}</span> },
    { key: 'duration', header: 'Duration', align: 'right', render: (row) => <span className="cep-num">{ms(row.duration_ms)}</span> },
  ]

  function toggleWithConfirm(item: Integration) {
    if (item.status === 'PAUSED' || window.confirm(item.direction === 'IN'
      ? `Pause ${item.name}? Calls from the outside system are refused until it is resumed.`
      : `Pause ${item.name}? Sends through it wait until it is resumed.`)) toggle.mutate(item)
  }

  return (
    <div className="space-y-8">
      {toggle.isError && <ErrorState title={toggle.variables?.status === 'PAUSED' ? 'The integration was not resumed' : 'The integration was not paused'} error={toggle.error} />}
      {alerts.isError && <ErrorState title="The alert switch was not saved" error={alerts.error} />}

      <section aria-labelledby="integrations-heading">
        <div className="mb-3">
          <h2 id="integrations-heading" className="font-display text-section-title font-semibold text-ink-900">Integrations</h2>
          <p className="text-sm text-ink-800">Every outside system this workspace exchanges data with: the point of sale that sends receipts in, and the engines that carry email and texts out. Figures are for the last 24 hours. Pausing an integration is the kill switch: inbound calls are refused with 503, outbound sends wait. Limits and log retention are set per workspace by the platform team.</p>
        </div>
        {integrations.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading integrations</p>
          : items.length === 0 ? <EmptyState title="No Integration Yet" hint="Add a sending engine under Sending engines, or send the first receipt from the point of sale, and it appears here." />
          : <ul aria-label="Integrations" className="grid gap-4 lg:grid-cols-2">
              {items.map((item) => <IntegrationCard key={item.id} item={item} busy={toggle.isPending || alerts.isPending} onToggle={() => toggleWithConfirm(item)}
                onAlerts={(enabled) => alerts.mutate({ item, enabled })} alertsSave={alerts} onShowLog={() => setFilters({ integration: item.id, direction: '', failed: false, q: '' })} />)}
            </ul>}
      </section>

      <section aria-labelledby="log-heading">
        <div className="mb-3">
          <h2 id="log-heading" className="font-display text-section-title font-semibold text-ink-900">Call Log</h2>
          <p className="text-sm text-ink-800">Every request and answer in either direction, newest first. Open a call to see exactly what was sent and what came back. Search by the correlation id a caller sent, or by a reference such as receipt:R-1001.</p>
        </div>
        <form className="mb-3 grid gap-3 rounded-lg border border-line bg-surface-subtle p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" noValidate
          onSubmit={(event: FormEvent) => { event.preventDefault(); setFilters({ ...filters, q: search.trim() }) }}>
          <Field label="Integration">
            {(ids) => <Select {...ids} controlSize="sm" value={filters.integration} onChange={(event) => setFilters({ ...filters, integration: event.target.value })}>
              <option value="">All Integrations</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>}
          </Field>
          <Field label="Correlation ID or Reference">
            {(ids) => <TextInput {...ids} controlSize="sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="receipt:R-1001" autoComplete="off" />}
          </Field>
          <Field label="Direction">
            {(ids) => <Select {...ids} controlSize="sm" value={filters.direction} onChange={(event) => setFilters({ ...filters, direction: event.target.value })}>
              <option value="">Both</option><option value="IN">Received</option><option value="OUT">Sent</option>
            </Select>}
          </Field>
          <label className="flex h-8 items-center gap-2 text-sm text-ink-900"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={filters.failed} onChange={(event) => setFilters({ ...filters, failed: event.target.checked })} /> Failures Only</label>
          <button type="submit" className="sr-only">Search</button>
        </form>
        {log.isError ? <ErrorState error={log.error} onRetry={() => void log.refetch()} />
          : log.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading the log</p>
          : calls.length === 0 ? <EmptyState title="No Calls Match" hint={filters.q || filters.integration || filters.direction || filters.failed ? 'Widen the filters, or check the correlation id.' : 'Calls appear here as soon as the point of sale sends a receipt or a campaign goes out.'} />
          : (<>
              <DataTable columns={columns} rows={calls} rowKey={(row) => String(row.id)} caption="Call Log" onRowClick={(row) => setOpen(row.id)} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-ink-800">
                <span className="cep-num">{formatNumber(log.data!.count)} call{log.data!.count === 1 ? '' : 's'} · page {log.data!.page} of {pages}</span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2">Rows per Page
                    <Select controlSize="sm" value={String(rows)} onChange={(event) => chooseRows(Number(event.target.value))} aria-label="Rows per Page">
                      {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                    </Select>
                  </label>
                  <span className="flex gap-2">
                    <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page <= 1 || log.isFetching} onClick={() => setPage(page - 1)}>Previous</button>
                    <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page >= pages || log.isFetching} onClick={() => setPage(page + 1)}>Next</button>
                  </span>
                </span>
              </div>
            </>)}
      </section>

      {open !== null && <LogDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
