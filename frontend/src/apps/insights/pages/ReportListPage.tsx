/**
 * Insights → Reports: every report this person may see, grouped by the component whose data it uses (the shared list of
 * docs/mockups/report-builder.html). ?component=cep opens it on one component's reports, as each component's Insights
 * menu item does. New Report starts from a dataset.
 */
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { formatDateTime } from '@/lib/format'
import { useCatalog, useReports } from '../api'
import type { ReportSummary } from '../types'

const VIEW_LABEL: Record<ReportSummary['view_type'], string> = { grid: 'Grid', chart: 'Chart', pivot: 'Pivot', hierarchy: 'Hierarchy' }

export function ReportListPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const component = params.get('component') ?? ''
  const [q, setQ] = useState('')
  const reports = useReports({ component: component || undefined, q: q.trim() || undefined })
  const catalog = useCatalog()
  const components = Array.from(new Map((catalog.data?.datasets ?? []).map((d) => [d.component.key, d.component])).values())
  const rows = reports.data?.reports ?? []
  const groups = Array.from(new Map(rows.map((r) => [r.component.key, r.component])).values()).map((c) => ({ component: c, reports: rows.filter((r) => r.component.key === c.key) }))
  const canCreate = can('report.edit') || can('report.admin')

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="All Reports"
        description={reports.data ? `${rows.length} report${rows.length === 1 ? '' : 's'}${component ? '' : ' · grouped by component'}` : undefined}
        actions={canCreate ? <button type="button" className={buttonPrimary} onClick={() => navigate(`/insights/reports/new${component ? `?component=${component}` : ''}`)}><Plus size={16} strokeWidth={1.5} aria-hidden />New Report</button> : undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Search all reports</span>
          <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search all reports"
            className="h-8 w-56 rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
        </label>
        <div role="group" aria-label="Component" className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={!component} onClick={() => setParams({})} className={chip(!component)}>All Components</button>
          {components.map((c) => (
            <button key={c.key} type="button" aria-pressed={component === c.key} onClick={() => setParams({ component: c.key })} className={chip(component === c.key)}>{c.name}</button>
          ))}
        </div>
      </div>

      {reports.isPending ? (
        <Spinner label="Loading the reports" />
      ) : reports.isError ? (
        <ErrorState error={reports.error} onRetry={() => reports.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No Reports Yet" hint={canCreate ? 'Start one with New Report: pick a dataset, choose its columns, and save it for the workspace.' : 'Nobody has shared a report with the workspace yet.'} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm" aria-label="Reports">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                <th className="px-3 py-2">Report</th><th className="px-3 py-2">View</th><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupRows key={group.component.key} name={group.component.name} count={group.reports.length} reports={group.reports} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function chip(on: boolean): string {
  return `h-7 rounded-control-md border px-2.5 text-xs font-semibold transition-colors ${on ? 'border-brand-100 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`
}

function GroupRows({ name, count, reports }: { name: string; count: number; reports: ReportSummary[] }) {
  return (
    <>
      <tr className="bg-surface-subtle"><th scope="rowgroup" colSpan={5} className="px-3 py-1.5 text-left text-sm font-semibold text-ink-900">{name} <span className="font-normal text-ink-800">{count}</span></th></tr>
      {reports.map((report) => (
        <tr key={report.id} className="border-t border-line-subtle">
          <td className="px-3 py-2"><Link to={`/insights/reports/${report.id}`} className="font-medium text-ink-900 hover:underline">{report.name}</Link>{report.description && <span className="block text-xs text-ink-800">{report.description}</span>}</td>
          <td className="px-3 py-2"><Tag tone="brand">{VIEW_LABEL[report.view_type]}</Tag></td>
          <td className="px-3 py-2 text-ink-800">{report.dataset_label}</td>
          <td className="px-3 py-2 text-ink-800">{report.owner_name ?? '—'}{report.visibility === 'PRIVATE' && <span className="ml-1.5 text-xs text-ink-700">· private</span>}</td>
          <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{report.last_run_at ? formatDateTime(report.last_run_at) : '—'}</td>
        </tr>
      ))}
    </>
  )
}
