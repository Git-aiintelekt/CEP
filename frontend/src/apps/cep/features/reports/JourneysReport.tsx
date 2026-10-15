/** The Journeys dataset on the Reports page: per journey per day over the period (GET /reports/journeys/), narrowed to one
 * journey when chosen. Tiles, the day-by-day curve of entries and conversions, one row per journey, and the CSV of every
 * journey's every day (/reports/journeys.csv). Nothing new is collected: enrollments, goals and the journeys' generated
 * campaigns' messages, as the API already records them. */
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/DataTable'
import { Field, Select } from '@/components/Form'
import { StatusBadge } from '@/components/StatusBadge'
import { Chart } from '@/components/charts/Chart'
import { formatMoney, formatNumber } from '@/lib/format'
import type { JourneysReport as JourneysReportData } from '@/lib/types'

import { daysBetween, formatDay, percent } from './period'

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-ink-800 uppercase">{label}</p>
      <p className="mt-1 font-display text-display font-semibold text-ink-900 tabular-nums">{value}</p>
      <p className="mt-1 text-helper text-ink-800">{hint}</p>
    </div>
  )
}

export function JourneyFilter({ data, value, onChange }: { data: JourneysReportData | undefined; value: string; onChange: (next: string) => void }) {
  return (
    <div className="w-64">
      <Field label="Journey">
        {(ids) => (
          <Select {...ids} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Every Journey</option>
            {(data?.journeys ?? []).map((journey) => <option key={journey.id} value={journey.id}>{journey.name}</option>)}
          </Select>
        )}
      </Field>
    </div>
  )
}

export function JourneysReport({ data }: { data: JourneysReportData }) {
  const { totals, rates } = data
  const byDay = new Map(data.days.map((day) => [day.day, day]))
  const days = daysBetween(data.period.from, data.period.to)
  const columns: Column<JourneysReportData['by_journey'][number]>[] = [
    { key: 'name', header: 'Journey', render: (row) => <Link to={`/journeys/${row.id}`} className="font-semibold text-ink-900 hover:underline">{row.name}</Link> },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} />, phoneOptional: true },
    { key: 'entered', header: 'Entered', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.entered)}</span> },
    { key: 'converted', header: 'Converted', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.converted)}{row.entered ? <span className="block text-xs text-ink-800">{percent(row.rates.conversion)}</span> : null}</span> },
    { key: 'revenue', header: 'Revenue', align: 'right', render: (row) => <span className="cep-num">{row.revenue ? formatMoney(row.revenue) : '—'}</span>, phoneOptional: true },
    { key: 'sent', header: 'Sent', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.sent)}</span> },
    { key: 'delivered', header: 'Delivered', align: 'right', render: (row) => <span className="cep-num">{row.sent ? percent(row.rates.delivery) : '—'}</span>, phoneOptional: true },
    { key: 'open', header: 'Open Rate', align: 'right', render: (row) => <span className="cep-num">{row.delivered ? percent(row.rates.open) : '—'}</span> },
    { key: 'click', header: 'Click Rate', align: 'right', render: (row) => <span className="cep-num">{row.delivered ? percent(row.rates.click) : '—'}</span>, phoneOptional: true },
    { key: 'held', header: 'Held Back', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.held_back)}</span>, phoneOptional: true },
    { key: 'failed', header: 'Failed', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.failed)}</span>, phoneOptional: true },
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Entered" value={formatNumber(totals.entered)} hint={`${formatNumber(totals.journeys)} journey${totals.journeys === 1 ? '' : 's'} with activity`} />
        <Tile label="Converted" value={formatNumber(totals.converted)} hint={`${percent(rates.conversion)} of those entered${totals.revenue ? ` · ${formatMoney(totals.revenue, { whole: true })} attributed` : ''}`} />
        <Tile label="Messages Sent" value={formatNumber(totals.sent)} hint={`Delivered ${percent(rates.delivery)} · ${formatNumber(totals.held_back)} held back · ${formatNumber(totals.failed)} failed`} />
        <Tile label="Opened" value={percent(rates.open)} hint={`${formatNumber(totals.opened)} of those delivered · ${percent(rates.click)} clicked`} />
      </div>
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 font-display text-card-heading font-semibold text-ink-900">Entered and Converted by Day</h2>
        <Chart
          title="Customers entered and converted per day"
          categoryHeader="Day"
          categories={days.map((day) => ({ key: day, label: formatDay(day, { day: 'numeric', month: 'short' }), detail: formatDay(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }))}
          series={[
            { key: 'entered', label: 'Entered', values: days.map((day) => byDay.get(day)?.entered ?? 0) },
            { key: 'converted', label: 'Converted', values: days.map((day) => byDay.get(day)?.converted ?? 0) },
          ]}
          type={days.length > 31 ? 'area' : 'bar'}
          formatValue={formatNumber}
          emptyText="Nobody entered a journey in this period. Try a longer period or another journey."
        />
      </section>
      <section className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
          <h2 className="font-display text-card-heading font-semibold text-ink-900">Journeys in the Period</h2>
          <span className="text-helper text-ink-800">Each journey added up over the period; the CSV has every journey’s every day.</span>
        </div>
        {data.by_journey.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-800">No journey had entries, conversions or messages in this period. Try a longer period or another journey.</p>
        ) : (
          <DataTable caption="Journeys in the period" columns={columns} rows={data.by_journey} rowKey={(row) => row.id} inset="card" />
        )}
      </section>
    </div>
  )
}
