/**
 * Settings → Suppressions: every address and number the engine will not send to, why, and since when. A bounce or a block
 * by a person can be undone here; an opt-out or a complaint cannot, because the person has to opt in again. Reading needs
 * campaign.view, changing needs consent.edit; every change is written to the consent record with who made it.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { Field, TextArea, TextInput, buttonDanger, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { SegmentedControl } from '@/components/SegmentedControl'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag, type TagTone } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { buttonClass } from '@/components/buttonStyles'
import { ApiError, api, request } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import { saveFile } from '@/lib/saveFile'
import type { SuppressionBlockResult, SuppressionGroup, SuppressionPage, SuppressionRow, SuppressionSummary } from '@/lib/types'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const PAGE_SIZE = 25
type ChannelFilter = 'ALL' | 'EMAIL' | 'PHONE'
type ReasonFilter = 'ALL' | SuppressionGroup

const CHANNELS: { value: ChannelFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone' },
]
const REASONS: { value: ReasonFilter; label: string }[] = [
  { value: 'ALL', label: 'Every Reason' },
  { value: 'UNSUBSCRIBED', label: 'Unsubscribed' },
  { value: 'BOUNCED', label: 'Bounced' },
  { value: 'COMPLAINED', label: 'Complained' },
  { value: 'BLOCKED', label: 'Blocked by You' },
]
const GROUP_HINT: Record<SuppressionGroup, string> = {
  UNSUBSCRIBED: 'by link, a STOP reply, or a person',
  BOUNCED: 'blocked after the provider said so',
  COMPLAINED: 'never sent to again',
  BLOCKED: 'imported or added by hand',
}
const GROUP_TONE: Record<SuppressionGroup, TagTone> = { UNSUBSCRIBED: 'neutral', BOUNCED: 'error', COMPLAINED: 'error', BLOCKED: 'warning' }
const SUMMARY_KEY = ['suppressions', 'summary']

export function SuppressionsPage() {
  const { can } = useAuth()
  const canChange = can('consent.edit')
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<ChannelFilter>('ALL')
  const [reason, setReason] = useState<ReasonFilter>('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [unblocking, setUnblocking] = useState<SuppressionRow | null>(null)
  const [importing, setImporting] = useState(false)
  const [exportProblem, setExportProblem] = useState('')
  const needle = useDebouncedValue(search.trim())

  const filters = { ...(channel === 'ALL' ? {} : { channel }), ...(reason === 'ALL' ? {} : { reason }), ...(needle ? { search: needle } : {}) }
  const summary = useQuery({ queryKey: SUMMARY_KEY, queryFn: ({ signal }) => api.get<SuppressionSummary>('/suppressions/summary/', undefined, signal) })
  const rows = useQuery({
    queryKey: ['suppressions', 'list', filters, page],
    queryFn: ({ signal }) => api.get<SuppressionPage>('/suppressions/', { ...filters, page, page_size: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['suppressions'] })

  async function exportCsv() {
    setExportProblem('')
    try {
      saveFile(await api.download('/suppressions/export.csv', filters), 'cep-suppressions.csv')
    } catch (error) {
      setExportProblem(`The export was not produced. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  const data = rows.data
  const total = data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = channel !== 'ALL' || reason !== 'ALL' || needle !== ''

  const columns: Column<SuppressionRow>[] = [
    {
      key: 'contact',
      header: 'Contact',
      render: (row) => (
        <div className="min-w-0">
          <p className="cep-num truncate font-semibold text-ink-900">{row.contact}</p>
          <p className="truncate text-xs text-ink-800">{[row.party_id, row.name].filter(Boolean).join(' · ') || 'No person on file'}</p>
        </div>
      ),
    },
    { key: 'channel', header: 'Channel', render: (row) => (row.channel === 'EMAIL' ? 'Email' : 'Phone'), phoneOptional: true },
    { key: 'reason', header: 'Reason', render: (row) => <Tag tone={GROUP_TONE[row.group]}>{row.reason_label}</Tag> },
    {
      key: 'source',
      header: 'Source',
      render: (row) => <span className="text-ink-800">{row.source_label ?? '—'}{row.detail ? <span className="block text-xs text-ink-800">{row.detail}</span> : null}</span>,
      phoneOptional: true,
    },
    { key: 'since', header: 'Since', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDate(row.since)}</span> },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (row) =>
        canChange && row.can_unblock ? (
          <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} aria-label={`Unblock ${row.contact}`} onClick={() => setUnblocking(row)}>Unblock</button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">Suppressions</h2>
          <p className="mt-0.5 text-sm text-ink-800">
            {summary.data ? `${formatNumber(summary.data.total)} addresses and numbers held back · ${formatNumber(summary.data.this_week)} added this week` : 'Every address and number the engine will not send to.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass({ variant: 'secondary' })} onClick={() => void exportCsv()}><Download size={16} strokeWidth={1.5} aria-hidden />Export CSV</button>
          {canChange && <button type="button" className={buttonClass({ variant: 'primary' })} onClick={() => setImporting(true)}><Upload size={16} strokeWidth={1.5} aria-hidden />Import Suppressions</button>}
        </div>
      </div>
      {exportProblem && <p role="alert" className="text-sm text-danger-text">{exportProblem}</p>}

      {summary.isError ? <ErrorState title="The counts could not be loaded" error={summary.error} onRetry={() => void summary.refetch()} /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(summary.data?.groups ?? []).map((group) => (
            <button key={group.key} type="button" aria-pressed={reason === group.key}
              onClick={() => { setReason(reason === group.key ? 'ALL' : group.key); setPage(1) }}
              className={`rounded-lg border p-4 text-left transition-colors duration-fast ease-standard ${reason === group.key ? 'border-brand-600 bg-brand-100' : 'border-line bg-surface hover:border-brand-600'}`}>
              <span className="block text-xs font-semibold tracking-wide text-ink-800 uppercase">{group.label}</span>
              <span className="mt-1 block font-display text-3xl font-semibold text-ink-900 tabular-nums">{formatNumber(group.count)}</span>
              <span className="mt-1 block text-helper text-ink-800">{GROUP_HINT[group.key]}</span>
            </button>
          ))}
        </div>
      )}

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-subtle px-4 py-3">
          <div className="flex flex-wrap gap-3">
            <SegmentedControl label="Channel" options={CHANNELS} value={channel} onChange={(next) => { setChannel(next); setPage(1) }} />
            <SegmentedControl label="Reason" options={REASONS} value={reason} onChange={(next) => { setReason(next); setPage(1) }} />
          </div>
          <div className="w-full sm:w-72">
            <TextInput type="search" aria-label="Search suppressions" placeholder="Search an address, number or party ID" value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          </div>
        </div>
        {rows.isError ? (
          <div className="p-4"><ErrorState title="The suppressions could not be loaded" error={rows.error} onRetry={() => void rows.refetch()} /></div>
        ) : !data ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
        ) : data.results.length === 0 ? (
          <div className="p-4">
            <EmptyState title={filtered ? 'No Matching Suppressions' : 'Nothing Is Held Back'}
              hint={filtered ? 'Try another channel or reason, or clear the search.' : 'Bounces, complaints, opt-outs and blocks appear here as they happen.'} variant="plain" />
          </div>
        ) : (
          <>
            <DataTable caption="Suppressed addresses and numbers" columns={columns} rows={data.results} rowKey={(row) => `${row.kind}-${row.id}`} inset="card" />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle px-4 py-3 text-helper text-ink-800">
              <span className="cep-num">Showing {formatNumber((page - 1) * PAGE_SIZE + 1)}–{formatNumber(Math.min(page * PAGE_SIZE, total))} of {formatNumber(total)}</span>
              <div className="flex gap-2">
                <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
        <p className="border-t border-line-subtle px-4 py-3 text-xs text-ink-800">
          An opt-out or a complaint cannot be undone here: the person has to opt in again. A bounce or a block by you can. Every change is written to the consent record with who made it.
        </p>
      </section>

      {unblocking && <UnblockModal row={unblocking} onClose={() => setUnblocking(null)} onDone={() => { setUnblocking(null); refresh() }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={refresh} />}
    </div>
  )
}

function UnblockModal({ row, onClose, onDone }: { row: SuppressionRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const unblock = useMutation({
    mutationFn: () => api.post(`/suppressions/${row.kind}/${row.id}/unblock/`),
    onSuccess: () => { toast.success('Contact unblocked', `${row.contact} can be sent to again from the next send.`); onDone() },
  })
  return (
    <Modal
      title="Unblock this contact?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Keep Blocked</button>
          <button type="button" className={buttonDanger} disabled={unblock.isPending} onClick={() => unblock.mutate()}>{unblock.isPending && <Spinner size="sm" />}Unblock</button>
        </>
      }
    >
      <div className="space-y-2 text-sm text-ink-800">
        <p><strong className="cep-num text-ink-900">{row.contact}</strong> is held back: {row.reason_label.toLowerCase()}{row.detail ? ` (${row.detail})` : ''}, since {formatDate(row.since)}.</p>
        <p>Once unblocked it can be sent to again, from the next send that includes it. The history of the block is kept.</p>
        {unblock.isError && <ErrorState title="The contact was not unblocked" error={unblock.error} />}
      </div>
    </Modal>
  )
}

type ImportMode = 'paste' | 'file'
const IMPORT_MODES: { value: ImportMode; label: string }[] = [
  { value: 'paste', label: 'Paste Addresses' },
  { value: 'file', label: 'Upload CSV' },
]

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<ImportMode>('paste')
  const [values, setValues] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const block = useMutation({
    mutationFn: () => {
      if (mode === 'file' && file) {
        const form = new FormData()
        form.append('file', file)
        if (note.trim()) form.append('note', note.trim())
        return request<SuppressionBlockResult>('/suppressions/block/', { method: 'POST', body: form })
      }
      return api.post<SuppressionBlockResult>('/suppressions/block/', { values: values.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean), note: note.trim() })
    },
    onSuccess: onDone,
  })
  const errors = block.error instanceof ApiError && block.error.status === 400 ? block.error.fieldErrors : {}
  const other = block.isError && Object.keys(errors).length === 0 ? block.error : null
  const ready = mode === 'file' ? file !== null : values.trim() !== ''
  const result = block.data

  return (
    <Modal title="Import Suppressions" subtitle="Addresses and numbers to stop sending to" onClose={onClose}
      footer={result ? <button type="button" className={buttonPrimary} onClick={onClose}>Done</button> : (
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" form="suppression-import" className={buttonPrimary} disabled={!ready || block.isPending}>{block.isPending && <Spinner size="sm" tone="onBrand" />}Block Them</button>
        </>
      )}>
      {result ? (
        <div role="status" className="space-y-2 text-sm text-ink-800">
          <p><strong className="cep-num text-ink-900">{formatNumber(result.blocked)}</strong> blocked, <span className="cep-num">{formatNumber(result.already_blocked)}</span> already blocked{result.invalid_count ? <>, <span className="cep-num">{formatNumber(result.invalid_count)}</span> not an address or a number</> : ''}.</p>
          {result.invalid.length > 0 && (
            <div>
              <p className="text-helper text-ink-800">{result.invalid_count > result.invalid.length ? `The first ${result.invalid.length} that were left out:` : 'Left out:'}</p>
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-sm border border-line bg-surface-subtle px-3 py-2 cep-num text-xs text-ink-800">
                {result.invalid.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <form id="suppression-import" noValidate className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); if (ready) block.mutate() }}>
          <SegmentedControl label="How" options={IMPORT_MODES} value={mode} onChange={setMode} />
          {mode === 'paste' ? (
            <Field label="Addresses and Numbers" required error={errors.values} hint="One per line, or separated by commas. Up to 5,000 at a time. A ten-digit North American number gets +1.">
              {(ids) => <TextArea {...ids} rows={6} value={values} onChange={(event) => setValues(event.target.value)} placeholder={'promo@competitor.example\n+14045550102'} />}
            </Field>
          ) : (
            <Field label="CSV File" required error={errors.file} hint="Any cell that looks like an address or a number is blocked. Up to 5 MB.">
              {(ids) => <input {...ids} type="file" accept=".csv,text/csv" className="block w-full text-sm text-ink-800" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
            </Field>
          )}
          <Field label="Note" error={errors.note} help="Kept on the consent record of every address blocked by this import, so the reason can be shown later: a legal hold list, a request by phone." hint="Why they are blocked, for the consent record: a legal hold list, a request by phone.">
            {(ids) => <TextInput {...ids} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />}
          </Field>
          {other && <ErrorState title="Nothing was blocked" error={other} />}
        </form>
      )}
    </Modal>
  )
}
