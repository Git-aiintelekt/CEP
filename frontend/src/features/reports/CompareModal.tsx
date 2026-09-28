/** Two to six campaigns side by side: their results as a table, and their opens (or deliveries, for texts) day by day. */
import { useQuery } from '@tanstack/react-query'

import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { Chart } from '@/components/charts/Chart'
import { api } from '@/lib/api'
import { formatMoney, formatNumber } from '@/lib/format'
import type { ReportCompareCampaign } from '@/lib/types'

import { formatDay, percent } from './period'

type Row = { label: string; value: (campaign: ReportCompareCampaign) => string }

const ROWS: Row[] = [
  { label: 'Sent', value: (campaign) => formatNumber(campaign.metrics.counts.sent) },
  { label: 'Delivered', value: (campaign) => percent(campaign.metrics.rates.delivery) },
  { label: 'Open Rate', value: (campaign) => (campaign.channel === 'SMS' ? '—' : percent(campaign.metrics.rates.open)) },
  { label: 'Click Rate', value: (campaign) => percent(campaign.metrics.rates.click) },
  { label: 'Bounce Rate', value: (campaign) => percent(campaign.metrics.rates.bounce) },
  { label: 'Unsubscribe Rate', value: (campaign) => percent(campaign.metrics.rates.unsubscribe) },
  { label: 'Conversions', value: (campaign) => formatNumber(campaign.metrics.conversions) },
  { label: 'Revenue', value: (campaign) => (campaign.metrics.revenue ? formatMoney(campaign.metrics.revenue) : '—') },
]

export function CompareModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const compare = useQuery({
    queryKey: ['reports', 'compare', ids],
    queryFn: ({ signal }) => api.get<{ campaigns: ReportCompareCampaign[] }>('/reports/compare/', { ids: ids.join(',') }, signal),
  })
  const campaigns = compare.data?.campaigns ?? []
  const allTexts = campaigns.length > 0 && campaigns.every((campaign) => campaign.channel === 'SMS')
  const measure = allTexts ? 'delivered' : 'opened'
  const days = [...new Set(campaigns.flatMap((campaign) => campaign.days.map((point) => point.at.slice(0, 10))))].sort()

  return (
    <Modal title="Compare Campaigns" subtitle={`${ids.length} campaigns side by side`} size="xl" scrollBody onClose={onClose}>
      {compare.isError ? (
        <ErrorState title="The comparison could not be loaded" error={compare.error} onRetry={() => void compare.refetch()} />
      ) : compare.isPending ? (
        <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading the campaigns</p>
      ) : (
        <div className="space-y-5">
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">Campaign results side by side</caption>
              <thead>
                <tr className="border-b border-line bg-surface-subtle">
                  <th scope="col" className="h-10 px-4 text-left text-xs font-semibold text-ink-700">Measure</th>
                  {campaigns.map((campaign) => <th key={campaign.id} scope="col" className="h-10 px-4 text-right text-xs font-semibold text-ink-700">{campaign.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-line-subtle last:border-b-0">
                    <th scope="row" className="h-11 px-4 text-left font-medium text-ink-700">{row.label}</th>
                    {campaigns.map((campaign) => <td key={campaign.id} className="cep-num px-4 text-right text-ink-900">{row.value(campaign)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section>
            <h3 className="mb-2 font-display text-card-heading font-semibold text-ink-900">{allTexts ? 'Delivered by Day' : 'Opened by Day'}</h3>
            <Chart
              title={allTexts ? 'Messages delivered per day, per campaign' : 'Messages opened per day, per campaign'}
              categoryHeader="Day"
              categories={days.map((day) => ({ key: day, label: formatDay(day, { day: 'numeric', month: 'short' }), detail: formatDay(day) }))}
              series={campaigns.map((campaign) => {
                const byDay = new Map(campaign.days.map((point) => [point.at.slice(0, 10), point[measure]]))
                return { key: campaign.id, label: campaign.name, values: days.map((day) => byDay.get(day) ?? 0) }
              })}
              type="line"
              formatValue={formatNumber}
              emptyText="None of these campaigns has sent anything yet."
            />
          </section>
        </div>
      )}
    </Modal>
  )
}
