import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { Campaign, ContactList, Journey, Template } from '@/lib/types'
import { useCursorList } from '@/lib/useCursorList'

function StatCard({ label, value, hint, to, loading }: { label: string; value: number; hint: string; to: string; loading: boolean }) {
  return (
    <Link to={to} className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-brand-500">
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
  const lists = useCursorList<ContactList>('contact-lists')
  const templates = useCursorList<Template>('templates')
  const journeys = useCursorList<Journey>('journeys')

  const live = campaigns.rows.filter((row) => ['ACTIVE', 'PRODUCTION_PUBLISHED'].includes(row.status)).length
  const audience = lists.rows.reduce((total, row) => total + (row.member_count ?? 0), 0)
  const firstName = me?.principal.display_name?.split(' ')[0]

  return (
    <section>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Overview'}
        description="Figures cover the most recent page of each collection; reporting endpoints will replace them."
      />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Campaigns" value={campaigns.rows.length} hint={`${live} live right now`} to="/campaigns" loading={campaigns.isPending} />
        <StatCard label="Contact lists" value={lists.rows.length} hint={`${formatNumber(audience)} members in total`} to="/contact-lists" loading={lists.isPending} />
        <StatCard label="Templates" value={templates.rows.length} hint="Email, SMS / MMS and e-receipt" to="/templates" loading={templates.isPending} />
        <StatCard
          label="Journeys"
          value={journeys.rows.length}
          hint={`${journeys.rows.filter((row) => row.status === 'ACTIVE').length} active`}
          to="/journeys"
          loading={journeys.isPending}
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-ink-900">Recent campaigns</h2>
      {campaigns.isError ? (
        <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
      ) : (
        <DataTable
          columns={recentColumns}
          rows={campaigns.rows.slice(0, 5)}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/campaigns/${row.id}`)}
          caption="Recent campaigns"
        />
      )}
    </section>
  )
}
