/**
 * Insights → Usage, for report administrators: which reports and dashboards are opened, by how many people, how often
 * through an embed link, who opens the most, and the reports nobody opened in the period (candidates to tidy away).
 * Opening the same item again within ten minutes counts once.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { BarList } from '@/components/charts/BarList'
import { PageHeader } from '@/components/ResourceList'
import { SegmentedControl } from '@/components/SegmentedControl'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { formatDateTime, formatNumber } from '@/lib/format'
import { usageApi } from '../api'

const head = 'px-3 py-2'
const num = 'cep-num px-3 py-2 text-right text-ink-800'

export function UsagePage() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const usage = useQuery({ queryKey: ['insights', 'usage', days], queryFn: ({ signal }) => usageApi.report(Number(days), signal), placeholderData: (previous) => previous })
  const data = usage.data
  const total = data ? data.daily.reduce((sum, day) => sum + day.opens, 0) : 0
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Usage" description={data?.ready ? `${formatNumber(total)} opening${total === 1 ? '' : 's'} in the last ${days} days` : 'What people open, and what nobody opens.'} help={<PageHelp chapter="insights" />} />
      <SegmentedControl label="Period" options={[{ value: '7', label: '7 Days' }, { value: '30', label: '30 Days' }, { value: '90', label: '90 Days' }]} value={days} onChange={setDays} />
      {usage.isPending ? <Spinner label="Loading the usage" /> : usage.isError ? <ErrorState error={usage.error} onRetry={() => usage.refetch()} /> : !usage.data.ready ? (
        <EmptyState title="Usage Starts With Patch 0061" hint="Openings are counted once database patch 0061 is applied to this workspace." />
      ) : usage.data.items.length === 0 ? (
        <EmptyState title="Nothing Opened in This Period" hint="Openings of reports and dashboards show up here." />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-label="Most opened" className="flex flex-col gap-3 rounded-md border border-line p-4">
              <h2 className="text-sm font-semibold text-ink-900">Most Opened</h2>
              <BarList title="Openings by report and dashboard" rows={usage.data.items.slice(0, 8).map((item) => ({ key: `${item.kind}-${item.item_id}`, label: item.name, value: item.opens }))} formatValue={formatNumber} />
            </section>
            <section aria-label="Who opens" className="flex flex-col gap-3 rounded-md border border-line p-4">
              <h2 className="text-sm font-semibold text-ink-900">Who Opens the Most</h2>
              <BarList title="Openings by person" rows={usage.data.people.slice(0, 8).map((person) => ({ key: person.user_id, label: person.name, value: person.opens }))} formatValue={formatNumber} />
            </section>
          </div>
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full text-sm" aria-label="Openings">
              <thead>
                <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                  <th className={head}>Report or Dashboard</th><th className={`${head} text-right`}>Openings</th><th className={`${head} text-right`}>People</th>
                  <th className={`${head} text-right`}>Through Embeds</th><th className={head}>Last Opened</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.items.map((item) => (
                  <tr key={`${item.kind}-${item.item_id}`} className="border-t border-line-subtle">
                    <td className="px-3 py-2">
                      <Link to={`/insights/${item.kind === 'report' ? 'reports' : 'dashboards'}/${item.item_id}`} className="font-medium text-ink-900 hover:underline">{item.name}</Link>
                      <span className="block text-xs text-ink-800">{item.kind === 'report' ? 'Report' : 'Dashboard'}</span>
                    </td>
                    <td className={num}>{formatNumber(item.opens)}</td>
                    <td className={num}>{formatNumber(item.people)}</td>
                    <td className={num}>{formatNumber(item.embedded)}</td>
                    <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(item.last_opened)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data?.ready && data.unopened.length > 0 && (
        <section aria-label="Not opened" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-900">Reports Nobody Opened in {days} Days</h2>
          <ul className="divide-y divide-line-subtle rounded-md border border-line">
            {data.unopened.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <Link to={`/insights/reports/${report.id}`} className="font-medium text-ink-900 hover:underline">{report.name}</Link>
                <span className="text-xs text-ink-800">{report.owner_name ?? 'No owner'} · last changed {formatDateTime(report.updated_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
