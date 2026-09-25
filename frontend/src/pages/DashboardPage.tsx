import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { Campaign, DashboardSummary } from '@/lib/types'
import { useCursorList } from '@/lib/useCursorList'

function StatCard({ label, value, hint, to, loading }: { label: string; value: number; hint: string; to: string; loading: boolean }) {
  return (
    <Link to={to} className="rounded-lg border border-line bg-surface p-5 transition-colors hover:border-brand-600">
      <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-ink-900 tabular-nums">{loading ? <Spinner /> : formatNumber(value)}</p>
      <p className="mt-1 text-sm text-ink-500">{hint}</p>
    </Link>
  )
}

const recentColumns: Column<Campaign>[] = [
  {
    key: 'name',
    header: 'Campaign',
    render: (row) => (
      <div>
        <p className="font-medium text-ink-900">{row.name}</p>
        <p className="text-xs text-ink-500">{row.code}</p>
      </div>
    ),
  },
  { key: 'channel', header: 'Channel', render: (row) => <Tag>{row.channel}</Tag> },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} label={row.status_label} /> },
  { key: 'updated', header: 'Updated', render: (row) => formatDateTime(row.updated_at) },
]

export function DashboardPage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const campaigns = useCursorList<Campaign>('campaigns')
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: ({ signal }) => api.get<DashboardSummary>('/dashboard/summary/', undefined, signal),
  })
  const firstName = me?.principal.display_name?.split(' ')[0]

  return (
    <section>
      <PageHeader title={firstName ? `Welcome back, ${firstName}` : 'Overview'} />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Campaigns"
          value={summary.data?.campaigns_total ?? 0}
          hint={`${summary.data?.campaigns_live ?? 0} live right now`}
          to="/campaigns"
          loading={summary.isPending}
        />
        <StatCard
          label="Contact Lists"
          value={summary.data?.contact_lists_total ?? 0}
          hint={`${formatNumber(summary.data?.audience_total ?? 0)} members in total`}
          to="/contact-lists"
          loading={summary.isPending}
        />
        <StatCard label="Templates" value={summary.data?.templates_total ?? 0} hint="Email, SMS / MMS and e-receipt" to="/templates" loading={summary.isPending} />
        <StatCard
          label="Journeys"
          value={summary.data?.journeys_total ?? 0}
          hint={`${summary.data?.journeys_active ?? 0} active`}
          to="/journeys"
          loading={summary.isPending}
        />
      </div>

      <h2 className="mb-3 font-display text-section-title font-semibold text-ink-900">Recent Campaigns</h2>
      {campaigns.isError ? (
        <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
      ) : (
        <DataTable
          columns={recentColumns}
          rows={campaigns.rows.slice(0, 5)}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/campaigns/${row.id}`)}
          caption="Recent Campaigns"
        />
      )}
    </section>
  )
}
