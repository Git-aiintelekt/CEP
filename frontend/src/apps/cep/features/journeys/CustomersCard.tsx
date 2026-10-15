/** The journey page's Customers card: everyone enrolled, newest first, with where they are now; opening one shows their
 * timeline in a drawer — entry, every step with its outcome and delivery record, the current position, conversion, exit.
 * The reason filter keeps the customers a step held back for one reason (GET .../customers/reasons/ lists them). The drawer
 * links to the customer's record. GET /journeys/{id}/customers/ and GET /journeys/{id}/customers/{enrollment}/
 * (apps/journeys/timeline.py). */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

import { Drawer } from '@/components/Drawer'
import { DataTable } from '@/components/DataTable'
import { buttonSecondary } from '@/components/Form'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { DetailCard } from '@/apps/cep/features/campaigns/parts'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { JourneyCustomerRow, JourneyCustomersPage, JourneyHeldBackReason, JourneyTimeline, JourneyTimelineStep } from '@/lib/types'

const PAGE_SIZE = 25
const STATUS_FILTERS = [{ value: '', label: 'Everyone' }, { value: 'ACTIVE', label: 'In Journey' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'EXITED', label: 'Exited Early' }]
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'In Journey', COMPLETED: 'Completed', EXITED: 'Exited Early' }

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** What the step did, in words, from its outcome and delivery record. */
export function stepOutcome(step: JourneyTimelineStep): string {
  const result = step.result ?? {}
  if (step.status === 'FAILED') return `failed${result.reason ? `: ${String(result.reason)}` : ''}`
  if (step.status === 'SKIPPED') return `held back${result.reason ? `: ${String(result.reason).toLowerCase().replace(/_/g, ' ')}` : ''}`
  switch (step.node_type) {
    case 'START':
      return 'entered'
    case 'WAIT':
      return result.reason ? String(result.reason).toLowerCase() : 'done'
    case 'CONDITION':
      return typeof result.met === 'boolean' ? (result.met ? 'Yes' : 'No') : 'checked'
    case 'GOAL':
      return result.reached ? `reached${result.revenue ? ` · ${money(Number(result.revenue))}` : ''}${result.while ? ` · while ${String(result.while)}` : ''}` : 'not yet'
    case 'EMAIL':
    case 'SMS':
    case 'MMS': {
      const delivery = step.delivery
      if (!delivery) return result.skipped_for_test ? 'skipped (test)' : 'sent'
      const parts: string[] = []
      if (delivery.bounced_at) parts.push(`bounced ${formatDateTime(delivery.bounced_at)}`)
      else if (delivery.failed_at) parts.push(`failed ${formatDateTime(delivery.failed_at)}`)
      else if (delivery.delivered_at) parts.push(`delivered ${formatDateTime(delivery.delivered_at)}`)
      else parts.push(delivery.status.toLowerCase())
      if (step.node_type === 'EMAIL') {
        parts.push(delivery.opened_at ? `opened ${formatDateTime(delivery.opened_at)}` : 'not opened')
        if (delivery.clicked_at) parts.push(`clicked ${formatDateTime(delivery.clicked_at)}`)
      } else if (delivery.responded_at) parts.push(`replied ${formatDateTime(delivery.responded_at)}`)
      return parts.join(' · ')
    }
    case 'COUPON_ISSUE':
      return result.coupon ? `requested ${String(result.coupon)}` : 'requested'
    case 'LOYALTY_CHANGE':
      return result.tier ? `set to ${String(result.name ?? result.tier)}` : 'done'
    case 'SEGMENT_UPDATE':
      return result.changed === false ? 'already so' : 'done'
    case 'EXIT':
      return 'exited'
    default:
      return result.finished ? String(result.finished).toLowerCase() : 'done'
  }
}

function TimelineDrawer({ journeyId, enrollmentId, onClose }: { journeyId: string; enrollmentId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['journeys', journeyId, 'customers', enrollmentId],
    queryFn: ({ signal }) => api.get<JourneyTimeline>(`/journeys/${journeyId}/customers/${enrollmentId}/`, undefined, signal),
  })
  const found = query.data
  const headline = found
    ? `Entered ${formatDateTime(found.enrolled_at)} · version ${found.version_number} · ${found.converted_at ? 'Converted' : STATUS_LABEL[found.status] ?? found.status}`
    : undefined
  return (
    <Drawer title={found?.name ?? 'Customer'} eyebrow={found?.email ?? undefined} onClose={onClose}
      footer={found ? <Link to={`/customers/${encodeURIComponent(found.party_id)}`} className={buttonSecondary}>View Customer Record</Link> : undefined}>
      {query.isPending ? <div className="p-6"><Spinner /></div>
        : query.isError ? <div className="p-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
        : (
          <div className="px-6 py-4">
            <p className="text-sm text-ink-800">{headline}</p>
            {found!.exit_reason && <p className="mt-1 text-sm text-ink-800">{found!.status === 'COMPLETED' ? 'Completed' : 'Exited'}: {found!.exit_reason}</p>}
            {found!.attributed_revenue !== null && found!.attributed_revenue !== undefined && <p className="mt-1 text-sm text-ink-800">Attributed revenue {money(found!.attributed_revenue)}</p>}
            <ol className="mt-4 flex flex-col" aria-label="Customer timeline">
              {found!.steps.map((step, index) => (
                <li key={`${step.at}-${index}`} className="flex items-start gap-3 border-b border-line-subtle py-3 first:pt-0 last:border-0">
                  <span className="cep-num w-36 shrink-0 text-xs text-ink-800">{formatDateTime(step.at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{step.label}</p>
                    <p className="text-helper text-ink-800">{stepOutcome(step)}</p>
                  </div>
                </li>
              ))}
              {found!.now && (
                <li className="flex items-start gap-3 py-3" data-timeline-now>
                  <span className="cep-num w-36 shrink-0 text-xs text-ink-800">now</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{found!.now.label}</p>
                    <p className="text-helper text-ink-800">
                      {found!.now.pending ? 'sending' : found!.now.next_scheduled_at ? `waiting until ${formatDateTime(found!.now.next_scheduled_at)}` : 'waiting'}
                    </p>
                  </div>
                </li>
              )}
              {found!.steps.length === 0 && !found!.now && <li className="py-3 text-sm text-ink-800">Nothing recorded yet.</li>}
            </ol>
          </div>
        )}
    </Drawer>
  )
}

export function CustomersCard({ journeyId, published, initialOpen = null }: { journeyId: string; published: boolean; initialOpen?: string | null }) {
  const { can } = useAuth()
  const [exportProblem, setExportProblem] = useState<string | null>(null)
  const exportCsv = async () => {
    try {
      const blob = await api.download(`/journeys/${journeyId}/customers/export/`, { q: search.trim() || undefined, status: status || undefined, reason: reason || undefined })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'journey-customers.csv'
      link.click()
      URL.revokeObjectURL(url)
      setExportProblem(null)
    } catch {
      setExportProblem('The customers were not exported.')
    }
  }
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(initialOpen)
  const query = useQuery({
    queryKey: ['journeys', journeyId, 'customers', { q: search.trim(), status, reason, page }],
    queryFn: ({ signal }) => api.get<JourneyCustomersPage>(`/journeys/${journeyId}/customers/`, { q: search.trim() || undefined, status: status || undefined, reason: reason || undefined, page, page_size: PAGE_SIZE }, signal),
    enabled: published,
    placeholderData: (previous) => previous,
  })
  const reasons = useQuery({
    queryKey: ['journeys', journeyId, 'customers', 'reasons'],
    queryFn: ({ signal }) => api.get<{ results: JourneyHeldBackReason[] }>(`/journeys/${journeyId}/customers/reasons/`, undefined, signal),
    enabled: published,
  })
  const reasonOptions = reasons.data?.results ?? []
  const rows: JourneyCustomerRow[] = query.data?.results ?? []
  const total = query.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <DetailCard title="Customers" flush>
      {!published ? (
        <div className="p-6"><EmptyState title="Nobody has entered yet" hint="Publish the journey to see customers and their path through it." /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
            <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search customers" aria-label="Search customers"
              className="h-9 w-full rounded-control-lg border border-line-control bg-surface px-3 text-sm sm:w-64" />
            <select aria-label="Customer Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}
              className="h-9 rounded-control-lg border border-line-control bg-surface px-3 text-sm text-ink-900">
              {STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {reasonOptions.length > 0 && (
              <select aria-label="Held Back Reason" value={reason} onChange={(event) => { setReason(event.target.value); setPage(1) }}
                className="h-9 rounded-control-lg border border-line-control bg-surface px-3 text-sm text-ink-900">
                <option value="">Any Reason</option>
                {reasonOptions.map((item) => <option key={item.reason} value={item.reason}>Held back: {item.label} ({formatNumber(item.customers)})</option>)}
              </select>
            )}
          </div>
          {query.isPending ? <div className="p-6"><Spinner /></div>
            : query.isError ? <div className="p-6"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
            : rows.length === 0 ? <div className="p-6"><EmptyState title="No customers" hint={search || status || reason ? 'Nobody matches this search.' : 'Nobody has entered yet.'} /></div>
            : (
              <DataTable rows={rows} rowKey={(row) => row.id} caption="Customers in the journey" inset="card" framed={false} primary="customer" columns={[
                { key: 'customer', header: 'Customer', render: (row) => (
                  <span className="flex flex-col">
                    <button type="button" onClick={() => setOpen(row.id)} className="text-left text-card-title font-semibold text-ink-900 transition-colors duration-fast ease-standard hover:text-link">{row.name}</button>
                    {row.email && <span className="text-helper text-ink-800">{row.email}</span>}
                  </span>
                ) },
                { key: 'entered', header: 'Entered', render: (row) => <span className="cep-num text-ink-800">{formatDateTime(row.enrolled_at)}<span className="block text-xs">version {row.version_number}</span></span> },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} label={STATUS_LABEL[row.status] ?? row.status} /> },
                { key: 'where', header: 'Where Now', render: (row) => (
                  <span className="text-ink-800">
                    {row.where ? <>{row.where.label}{row.where.next_scheduled_at && <span className="block text-xs">until {formatDateTime(row.where.next_scheduled_at)}</span>}</>
                      : row.exit_reason ? <span className="text-xs">{row.exit_reason}</span> : <span className="text-ink-300">—</span>}
                  </span>
                ) },
                { key: 'converted', header: 'Converted', render: (row) => row.converted_at ? <Tag>{row.attributed_revenue ? money(row.attributed_revenue) : 'Converted'}</Tag> : <span className="text-ink-300">—</span> },
              ]} />
            )}
          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 text-sm text-ink-800">
              <span className="cep-num">Showing {formatNumber(rows.length)} of {formatNumber(total)}</span>
              {can('journey.export') && <button type="button" className={buttonSecondary} onClick={() => void exportCsv()}>Export CSV</button>}
              {exportProblem && <span role="alert" className="text-danger-text">{exportProblem}</span>}
              {pages > 1 && (
                <span className="flex items-center gap-2">
                  <button type="button" className={buttonSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <span className="cep-num">Page {page} of {formatNumber(pages)}</span>
                  <button type="button" className={buttonSecondary} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
                </span>
              )}
            </div>
          )}
        </>
      )}
      {open && <TimelineDrawer journeyId={journeyId} enrollmentId={open} onClose={() => setOpen(null)} />}
    </DetailCard>
  )
}
