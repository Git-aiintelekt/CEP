/**
 * Recipients: one row per person a run was sent to, with what became of the message — C360's record, the events behind it,
 * the engine's calls in the integration log, and the engine's own word on it (Check with Postal). Beside it, Blocked &
 * Unsubscribed: who on this campaign's lists is held back, why, from where and since when — the Suppressions rows kept to
 * this campaign's people. Both export to CSV.
 */
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { ClearFiltersLink, SelectFilter } from '@/components/FilterChip'
import { buttonSecondary } from '@/components/Form'
import { SearchField } from '@/components/SearchField'
import { Modal } from '@/components/Modal'
import { SegmentedControl } from '@/components/SegmentedControl'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag, type TagTone } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { problemText } from '@/apps/cep/features/contact-lists/problem'
import { api } from '@/lib/api'
import { formatNumber, titleize } from '@/lib/format'
import { saveFile } from '@/lib/saveFile'
import type { Campaign, CampaignRun, CampaignSuppressions, ProviderMessageStatus, RunRecipient, RunRecipientDetail, RunRecipientPage, SuppressionGroup, SuppressionRow } from '@/lib/types'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

import { whenInZone } from '../dripSequence'
import { dripStepsQuery } from '../dripSteps'
import { dateTimeInZone } from '../zone'

type View = 'recipients' | 'blocked'
const LIVE = new Set(['SCHEDULED', 'PREPARING', 'SENDING'])
const STATUS_TONE: Record<string, TagTone> = {
  QUEUED: 'neutral', SUBMITTED: 'warning', DELIVERED: 'success', OPENED: 'success', CLICKED: 'success', RESPONDED: 'success',
  BOUNCED: 'error', COMPLAINED: 'error', FAILED: 'error', OPTED_OUT: 'error',
}
const STATUS_LABEL: Record<string, string> = { SUBMITTED: 'Sent', COMPLAINED: 'Marked as Spam', OPTED_OUT: 'Opted Out', RESPONDED: 'Replied', NOT_SENT: 'Not Sent' }
const statusLabel = (code: string) => STATUS_LABEL[code] ?? titleize(code)
const NOT_SENT_WHY: Record<string, string> = { STOPPED_EARLY: 'Stopped early' }

/** queued but never sent (a drip stopped early): grey, never a failure */
function StatusTag({ row }: { row: Pick<RunRecipient, 'status' | 'not_sent_reason'> }) {
  if (row.status === 'NOT_SENT') {
    const why = row.not_sent_reason ? NOT_SENT_WHY[row.not_sent_reason] ?? titleize(row.not_sent_reason) : null
    return <Tag>{why ? `Not Sent · ${why}` : 'Not Sent'}</Tag>
  }
  return <Tag tone={STATUS_TONE[row.status] ?? 'neutral'}>{statusLabel(row.status)}</Tag>
}
const GROUP_TONE: Record<SuppressionGroup, TagTone> = { UNSUBSCRIBED: 'neutral', BOUNCED: 'error', COMPLAINED: 'error', BLOCKED: 'warning' }
const PAGE_SIZE = 50

export function RecipientsTab({ campaign, zone, live }: { campaign: Campaign; zone: string; live: boolean }) {
  const [view, setView] = useState<View>('recipients')
  return (
    <div className="space-y-5">
      <SegmentedControl label="Show" value={view} onChange={setView}
        options={[{ value: 'recipients', label: 'Recipients' }, { value: 'blocked', label: 'Blocked & Unsubscribed' }]} />
      {view === 'recipients' ? <Recipients campaign={campaign} zone={zone} live={live} /> : <Blocked campaign={campaign} zone={zone} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------- recipients of a run
function Recipients({ campaign, zone, live }: { campaign: Campaign; zone: string; live: boolean }) {
  const runs = [...campaign.runs].sort((a, b) => b.run_number - a.run_number)
  const drip = campaign.campaign_type === 'DRIP'
  const steps = useQuery({ ...dripStepsQuery(campaign.id), enabled: drip })
  /** a drip's production run reads as its message: "Message 1 · Welcome · Mon 12 Oct" */
  const runLabel = (item: CampaignRun) => {
    const step = drip && !item.test_mode ? steps.data?.find((candidate) => candidate.id === item.drip_step) : undefined
    if (step) {
      const when = whenInZone(item.started_at ?? item.scheduled_at, zone)
      return `Message ${step.position} · ${step.name || 'Untitled Message'}${when ? ` · ${when.day}` : ''} · ${titleize(item.status)}`
    }
    return `#${item.run_number}${item.sequence_label ? ` · ${item.sequence_label}` : ''}${item.test_mode ? ' · test' : ''} · ${titleize(item.status)}`
  }
  const firstRun = (runs.find((run) => !run.test_mode) ?? runs[0])?.id ?? ''
  const [runId, setRunId] = useState<string>(firstRun)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<RunRecipient | null>(null)
  const [problem, setProblem] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const run = runs.find((item) => item.id === runId)
  const recipients = useQuery({
    queryKey: ['campaign-runs', runId, 'recipients', { status, q, page }],
    queryFn: ({ signal }) => api.get<RunRecipientPage>(`/campaign-runs/${runId}/recipients/`, { status: status || undefined, q: q || undefined, page, page_size: PAGE_SIZE }, signal),
    enabled: Boolean(runId),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (live && LIVE.has(query.state.data?.run.status ?? run?.status ?? '') ? 5000 : false),
  })

  if (runs.length === 0) return <EmptyState title="Nothing Sent Yet" hint="Every recipient of a run appears here with what became of the message: delivered, opened, clicked, bounced, or why it failed." variant="plain" />

  async function exportCsv() {
    setProblem('')
    try {
      saveFile(await api.download(`/campaign-runs/${runId}/recipients/export.csv`, { status: status || undefined, q: q || undefined }), `${campaign.code ?? campaign.name}-run-${run?.run_number ?? ''}-recipients.csv`)
    } catch (error) {
      setProblem(`The export was not produced. ${problemText(error)}`)
    }
  }

  const data = recipients.data
  const texts = data?.run.family === 'SMS'
  const columns: Column<RunRecipient>[] = [
    { key: 'address', header: 'Recipient', render: (row) => (
      <button type="button" className="text-left" onClick={() => setOpen(row)}>
        <span className="block font-medium text-brand-800 hover:underline">{row.address}</span>
        {(row.first_name || row.last_name) && <span className="block text-xs text-ink-500">{[row.first_name, row.last_name].filter(Boolean).join(' ')}</span>}
      </button>
    ) },
    { key: 'status', header: 'Status', render: (row) => <StatusTag row={row} /> },
    { key: 'reason', header: 'Reason', render: (row) => <span className="block max-w-xs truncate text-ink-700" title={row.status_reason ?? undefined}>{row.status_reason ?? (row.bounce_type ? `${titleize(row.bounce_type)} bounce` : '')}</span>, phoneOptional: true },
    { key: 'sent', header: 'Sent', render: (row) => <span className="cep-num whitespace-nowrap">{dateTimeInZone(row.submitted_at, zone)}</span>, phoneOptional: true },
    { key: 'delivered', header: 'Delivered', render: (row) => <span className="cep-num whitespace-nowrap">{dateTimeInZone(row.delivered_at, zone)}</span>, phoneOptional: true },
    ...(texts ? [] : [
      { key: 'opened', header: 'Opened', render: (row: RunRecipient) => <span className="cep-num whitespace-nowrap">{dateTimeInZone(row.opened_at, zone)}</span>, phoneOptional: true },
      { key: 'clicked', header: 'Clicked', render: (row: RunRecipient) => <span className="cep-num whitespace-nowrap">{dateTimeInZone(row.clicked_at, zone)}</span>, phoneOptional: true },
    ]),
    { key: 'engine', header: 'Engine ID', render: (row) => <span className="block max-w-[10rem] truncate text-xs text-ink-500" title={row.provider_message_id ?? undefined}>{row.provider_message_id ?? '—'}</span>, phoneOptional: true },
  ]
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-3">
        <SearchField label="Search recipients" placeholder={texts ? 'Number, name or customer ID' : 'Address, name or customer ID'} value={search} onChange={(next) => { setSearch(next); setPage(1) }} />
        {runs.length > 0 && <SelectFilter label="Run" value={runId} defaultValue={firstRun} showValue menuWidth={300} onChange={(next) => { setRunId(next); setPage(1) }}
          options={runs.map((item: CampaignRun) => ({ value: item.id, label: runLabel(item) }))} />}
        <SelectFilter label="Status" value={status} onChange={(next) => { setStatus(next); setPage(1) }}
          options={[{ value: '', label: 'All Statuses' }, ...(data?.statuses ?? []).map((code) => ({ value: code, label: `${statusLabel(code)}${data?.by_status[code] ? ` (${formatNumber(data.by_status[code])})` : ''}` }))]} />
        {(search || status || runId !== firstRun) && <ClearFiltersLink onClick={() => { setSearch(''); setStatus(''); setRunId(firstRun); setPage(1) }} />}
        <button type="button" className={`${buttonSecondary} ml-auto`} onClick={() => void exportCsv()} disabled={!data || data.count === 0}><Download size={16} strokeWidth={1.5} aria-hidden />Export CSV</button>
      </div>
      {problem && <p role="alert" className="px-4 pt-3 text-sm text-danger-text">{problem}</p>}
      {recipients.isError ? <div className="p-4"><ErrorState error={recipients.error} onRetry={() => void recipients.refetch()} /></div>
      : !data ? <p className="flex items-center gap-2 p-4 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
      : data.count === 0 ? <div className="p-4"><EmptyState title="No Recipients" hint={status || q ? 'Nothing matches these filters.' : 'This run queued no messages.'} variant="plain" /></div>
      : <>
          <DataTable columns={columns} rows={data.results} rowKey={(row) => String(row.id)} caption={`Recipients of run ${data.run.run_number}`} framed={false} phone="table" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle px-4 py-3 text-sm text-ink-700">
            <span className="cep-num">{formatNumber(data.count)} recipient{data.count === 1 ? '' : 's'} · page {data.page} of {pages}</span>
            <span className="flex gap-2">
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </span>
          </div>
        </>}
      {open && runId && <RecipientModal runId={runId} recipient={open} zone={zone} texts={Boolean(texts)} onClose={() => setOpen(null)} />}
    </section>
  )
}

function RecipientModal({ runId, recipient, zone, texts, onClose }: { runId: string; recipient: RunRecipient; zone: string; texts: boolean; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['campaign-runs', runId, 'recipients', recipient.id], queryFn: ({ signal }) => api.get<RunRecipientDetail>(`/campaign-runs/${runId}/recipients/${recipient.id}/`, undefined, signal) })
  const check = useMutation({ mutationFn: () => api.post<ProviderMessageStatus>(`/campaign-runs/${runId}/recipients/${recipient.id}/check/`) })
  const data = detail.data
  const standing = data?.standing
  return (
    <Modal title={recipient.address} subtitle={[[recipient.first_name, recipient.last_name].filter(Boolean).join(' '), `Customer ${recipient.party_id}`].filter(Boolean).join(' · ')} size="lg" scrollBody onClose={onClose}
      footer={<div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-500">{recipient.provider_message_id ? <>Engine ID <span className="cep-num">{recipient.provider_message_id}</span></> : 'The engine never confirmed this message.'}</span>
        <span className="flex gap-2">
          {!texts && <button type="button" className={buttonSecondary} disabled={check.isPending || !recipient.provider_message_id} onClick={() => check.mutate()}>{check.isPending ? 'Asking the engine' : 'Check with the Engine'}</button>}
          <button type="button" className={buttonSecondary} onClick={onClose}>Done</button>
        </span>
      </div>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusTag row={recipient} />
          {recipient.status_reason && <span className="text-ink-700">{recipient.status_reason}</span>}
          {recipient.attempts > 1 && <span className="cep-num text-xs text-ink-500">{recipient.attempts} attempts</span>}
          {recipient.variant_key && <Tag>{`Subject ${recipient.variant_key}`}</Tag>}
        </div>

        {detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        : !data ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
        : <>
            <section>
              <h3 className="text-card-title font-semibold text-ink-900">What Happened</h3>
              <ol className="mt-2 divide-y divide-line-subtle border-y border-line-subtle" aria-label="Timeline">
                {data.events.map((event, index) => (
                  <li key={index} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                    <span className="cep-num w-40 shrink-0 text-ink-500">{dateTimeInZone(event.at, zone)}</span>
                    <span className="font-medium text-ink-900">{event.kind === 'callback' ? `Engine said: ${event.what}` : event.what}</span>
                    {event.detail && <span className="min-w-0 truncate text-ink-700" title={event.detail}>{event.detail}</span>}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-ink-500">
                {data.callbacks === 0
                  ? 'No callback from the engine has reached this message: delivered, opened and bounced can only be known once the engine calls back. Check the webhook under Settings, Sending Engines.'
                  : `${formatNumber(data.callbacks)} callback${data.callbacks === 1 ? '' : 's'} from the engine.`}
              </p>
            </section>

            {standing && (standing.blocked || standing.consent === 'OPTED_OUT' || standing.hard_bounces || standing.soft_bounces || standing.complaints) ? (
              <section>
                <h3 className="text-card-title font-semibold text-ink-900">This Address Now</h3>
                <p className="mt-1 text-sm text-ink-700">
                  {standing.blocked ? `Blocked (${titleize(standing.block_reason ?? 'manual')}). ` : ''}
                  {standing.consent === 'OPTED_OUT' ? `Unsubscribed${standing.opt_out_method ? ` via ${titleize(standing.opt_out_method)}` : ''}. ` : ''}
                  {standing.hard_bounces ? `${formatNumber(standing.hard_bounces)} hard bounce${standing.hard_bounces === 1 ? '' : 's'}. ` : ''}
                  {standing.soft_bounces ? `${formatNumber(standing.soft_bounces)} soft bounce${standing.soft_bounces === 1 ? '' : 's'}. ` : ''}
                  {standing.complaints ? `${formatNumber(standing.complaints)} spam complaint${standing.complaints === 1 ? '' : 's'}. ` : ''}
                  <Link to="/settings/suppressions" className="font-medium text-brand-800 hover:underline">Open Suppressions</Link>
                </p>
              </section>
            ) : null}

            {data.log.length > 0 && (
              <section>
                <h3 className="text-card-title font-semibold text-ink-900">Engine Calls</h3>
                <ul className="mt-2 divide-y divide-line-subtle border-y border-line-subtle" aria-label="Engine calls">
                  {data.log.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                      <span className="cep-num w-40 shrink-0 text-ink-500">{dateTimeInZone(row.at, zone)}</span>
                      <span className="font-medium text-ink-900">{row.direction === 'OUT' ? 'Sent to the engine' : 'Engine called back'}</span>
                      <Tag tone={row.outcome === 'OK' ? 'success' : 'error'}>{`${row.outcome}${row.response_status != null ? ` ${row.response_status}` : ''}`}</Tag>
                      {row.error && <span className="text-danger-text">{row.error}</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-500">The full request and answer of each call is under <Link to="/settings/integrations" className="font-medium text-brand-800 hover:underline">Settings, Integrations</Link> (search <span className="cep-num">mailer_execution:{recipient.id}</span>).</p>
              </section>
            )}
          </>}

        {check.isError && <ErrorState title="The engine did not answer" error={check.error} />}
        {check.data && (
          <section aria-label="The engine's record">
            <h3 className="text-card-title font-semibold text-ink-900">{check.data.provider} Says</h3>
            <p className="mt-1 text-sm text-ink-700">
              Status <Tag tone={check.data.status === 'Sent' ? 'success' : check.data.held ? 'warning' : 'neutral'}>{check.data.status ?? 'unknown'}</Tag>
              {check.data.held && <span> · held{check.data.hold_expiry ? ` until ${dateTimeInZone(check.data.hold_expiry, zone)}` : ''}</span>}
              {check.data.last_delivery_attempt && <span> · last delivery attempt {dateTimeInZone(check.data.last_delivery_attempt, zone)}</span>}
              {check.data.sent_at && <span> · accepted {dateTimeInZone(check.data.sent_at, zone)}</span>}
            </p>
            {check.data.deliveries.length > 0 ? (
              <ul className="mt-2 divide-y divide-line-subtle border-y border-line-subtle" aria-label="Delivery attempts">
                {check.data.deliveries.map((attempt, index) => (
                  <li key={index} className="py-2 text-sm">
                    <span className="cep-num mr-3 text-ink-500">{dateTimeInZone(attempt.at, zone)}</span>
                    <Tag tone={attempt.status === 'Sent' ? 'success' : attempt.status === 'SoftFail' ? 'warning' : 'error'}>{attempt.status ?? '?'}</Tag>
                    {attempt.details && <span className="ml-2 text-ink-700">{attempt.details}</span>}
                    {attempt.output && <span className="mt-1 block break-all text-xs text-ink-500">{attempt.output}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-xs text-ink-500">The engine lists no delivery attempt for it yet.</p>}
          </section>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------------- blocked and unsubscribed
function Blocked({ campaign, zone }: { campaign: Campaign; zone: string }) {
  const [reason, setReason] = useState('')
  const [channel, setChannel] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [problem, setProblem] = useState('')
  const q = useDebouncedValue(search.trim(), 300)
  const rows = useQuery({
    queryKey: ['campaigns', campaign.id, 'suppressions', { reason, channel, q, page }],
    queryFn: ({ signal }) => api.get<CampaignSuppressions>(`/campaigns/${campaign.id}/suppressions/`, { reason: reason || undefined, channel: channel || undefined, search: q || undefined, page, page_size: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  })

  async function exportCsv() {
    setProblem('')
    try {
      saveFile(await api.download(`/campaigns/${campaign.id}/suppressions/export.csv`, { reason: reason || undefined, channel: channel || undefined, search: q || undefined }), `${campaign.code ?? campaign.name}-blocked-and-unsubscribed.csv`)
    } catch (error) {
      setProblem(`The export was not produced. ${problemText(error)}`)
    }
  }

  const data = rows.data
  const columns: Column<SuppressionRow>[] = [
    { key: 'contact', header: 'Contact', render: (row) => <span><span className="block font-medium text-ink-900">{row.contact ?? row.party_id}</span>{row.name && <span className="block text-xs text-ink-500">{row.name}</span>}</span> },
    { key: 'channel', header: 'Channel', render: (row) => (row.channel === 'PHONE' ? 'Texts' : 'Email'), phoneOptional: true },
    { key: 'reason', header: 'Reason', render: (row) => <Tag tone={GROUP_TONE[row.group]}>{row.reason_label}</Tag> },
    { key: 'source', header: 'Source', render: (row) => <span><span className="block text-ink-900">{row.source_label ?? '—'}</span>{row.detail && <span className="block max-w-xs truncate text-xs text-ink-500" title={row.detail}>{row.detail}</span>}</span>, phoneOptional: true },
    { key: 'since', header: 'Since', render: (row) => <span className="cep-num whitespace-nowrap">{dateTimeInZone(row.since, zone)}</span> },
  ]
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line-subtle px-4 py-3">
        <p className="text-sm text-ink-700">People on this campaign's lists who cannot be sent to: unsubscribed, bounced, marked as spam, or blocked. A hard bounce or a complaint blocks the address for every campaign; the rest of the workspace is under <Link to="/settings/suppressions" className="font-medium text-brand-800 hover:underline">Settings, Suppressions</Link>.</p>
        {data && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="By reason">
            {data.summary.groups.map((group) => (
              <li key={group.key}>
                <button type="button" aria-pressed={reason === group.key} onClick={() => { setReason(reason === group.key ? '' : group.key); setPage(1) }}
                  className={`rounded-sm border px-3 py-1 text-sm ${reason === group.key ? 'border-link bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-700 hover:bg-surface-hover'}`}>
                  {group.label} <span className="cep-num font-semibold">{formatNumber(group.count)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-3">
        <SearchField label="Search blocked people" placeholder="Address, number, name or ID" value={search} onChange={(next) => { setSearch(next); setPage(1) }} />
        <SelectFilter label="Channel" value={channel} onChange={(next) => { setChannel(next); setPage(1) }}
          options={[{ value: '', label: 'All Channels' }, { value: 'EMAIL', label: 'Email' }, { value: 'PHONE', label: 'Texts' }]} />
        {(search || channel || reason) && <ClearFiltersLink onClick={() => { setSearch(''); setChannel(''); setReason(''); setPage(1) }} />}
        <button type="button" className={`${buttonSecondary} ml-auto`} onClick={() => void exportCsv()} disabled={!data || data.count === 0}><Download size={16} strokeWidth={1.5} aria-hidden />Export CSV</button>
      </div>
      {problem && <p role="alert" className="px-4 pt-3 text-sm text-danger-text">{problem}</p>}
      {rows.isError ? <div className="p-4"><ErrorState error={rows.error} onRetry={() => void rows.refetch()} /></div>
      : !data ? <p className="flex items-center gap-2 p-4 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
      : data.count === 0 ? <div className="p-4"><EmptyState title="Nobody Is Held Back" hint={reason || channel || q ? 'Nothing matches these filters.' : 'Everyone on this campaign\'s lists can be sent to.'} variant="plain" /></div>
      : <>
          <DataTable columns={columns} rows={data.results} rowKey={(row) => `${row.kind}-${row.id}`} caption="Blocked and unsubscribed" framed={false} phone="table" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle px-4 py-3 text-sm text-ink-700">
            <span className="cep-num">{formatNumber(data.count)} {data.count === 1 ? 'person' : 'people'} · page {data.page} of {pages}</span>
            <span className="flex gap-2">
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </span>
          </div>
        </>}
    </section>
  )
}
