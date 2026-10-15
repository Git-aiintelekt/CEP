/** /customers: find a customer by name, email address, mobile number or id (GET /customers/?q=), then open their record.
 * Reached from Contact Lists; the record itself is /customers/:partyId. */
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { buttonSecondary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { PageHelp } from '@/help/HelpPanel'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { CustomerSearchPage, CustomerSearchRow } from '@/lib/types'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

const PAGE_SIZE = 25

export function CustomersPage() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const settled = useDebouncedValue(search.trim(), 300)
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['customers', 'search', settled, page],
    queryFn: ({ signal }) => api.get<CustomerSearchPage>('/customers/', { q: settled || undefined, page, page_size: PAGE_SIZE }, signal),
    enabled: settled !== '',
    placeholderData: (previous) => previous,
  })
  const rows = query.data?.results ?? []
  const total = query.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const columns: Column<CustomerSearchRow>[] = [
    { key: 'name', header: 'Customer', render: (row) => <Link to={`/customers/${encodeURIComponent(row.party_id)}`} className="font-semibold text-ink-900 hover:underline">{row.name}</Link> },
    { key: 'email', header: 'Email', render: (row) => <span className="text-ink-800">{row.email ?? '—'}</span> },
    { key: 'phone', header: 'Mobile', render: (row) => <span className="cep-num text-ink-800">{row.phone ?? '—'}</span>, phoneOptional: true },
    { key: 'id', header: 'Customer ID', render: (row) => <span className="cep-num text-ink-800">{row.party_id}</span>, phoneOptional: true },
    { key: 'source', header: 'Source', render: (row) => <Tag>{row.source_system}</Tag>, phoneOptional: true },
    { key: 'synced', header: 'Updated', render: (row) => <span className="cep-num whitespace-nowrap text-ink-800">{formatDateTime(row.synced_at)}</span>, phoneOptional: true },
  ]
  return (
    <section>
      <PageHeader title="Customers" help={<PageHelp chapter="contact-lists" />} description="Everyone in the customer records, as C360 syncs them or an upload added them. Open one to see their consent, lists, events, orders, messages and journeys in one place."
        actions={<Link to="/contact-lists" className={buttonSecondary}>Contact Lists</Link>} />
      <label className="relative mb-5 block w-full sm:w-96">
        <span className="sr-only">Search customers</span>
        <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-800" />
        <input type="search" value={search} autoFocus placeholder="Name, email address, mobile number or customer id"
          onChange={(event) => { setSearch(event.target.value); setPage(1); setParams(event.target.value.trim() ? { q: event.target.value.trim() } : {}, { replace: true }) }}
          className="h-10 w-full rounded-control-lg border border-line-control bg-surface pr-3 pl-9 text-sm text-ink-900" />
      </label>
      {settled === '' ? (
        <EmptyState title="Find a customer" hint="Type part of a name, an email address, a mobile number or a customer id." icon={Search} />
      ) : query.isPending ? (
        <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Searching</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No customer matches" hint="A customer has to be in the records before C360 can reach them: C360 syncs them, or a contact list upload adds them." />
      ) : (
        <section className="rounded-lg border border-line bg-surface">
          <DataTable caption="Customers" columns={columns} rows={rows} rowKey={(row) => row.party_id} inset="card" />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2 text-sm text-ink-800">
            <span className="cep-num">Showing {formatNumber(rows.length)} of {formatNumber(total)}</span>
            {pages > 1 && (
              <span className="flex items-center gap-2">
                <button type="button" className={buttonSecondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="cep-num">Page {page} of {formatNumber(pages)}</span>
                <button type="button" className={buttonSecondary} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </span>
            )}
          </div>
        </section>
      )}
    </section>
  )
}
