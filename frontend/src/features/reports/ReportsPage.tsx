/**
 * Reports: the workspace over a period, its campaigns compared, exported, and emailed every week. Everything comes from the
 * API's figures (sends, deliveries, opens, clicks, unsubscribes and revenue already recorded); nothing new is collected here.
 */
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { Field, TextInput } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { Chart } from '@/components/charts/Chart'
import { buttonClass } from '@/components/buttonStyles'
import { api } from '@/lib/api'
import { formatMoney, formatNumber } from '@/lib/format'
import { saveFile } from '@/lib/saveFile'
import type { ReportCampaignRow, ReportHighlight, ReportSummary } from '@/lib/types'

import { CompareModal } from './CompareModal'
import { ScheduleModal } from './ScheduleModal'
import { PERIOD_OPTIONS, daysBetween, formatDay, percent, periodFor, type Period, type PeriodKey } from './period'

type ChannelFilter = 'ALL' | 'EMAIL' | 'SMS'
const CHANNELS: { value: ChannelFilter; label: string }[] = [
  { value: 'ALL', label: 'All Channels' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
]
const CHANNEL_LABEL: Record<string, string> = { EMAIL: 'Email', SMS: 'SMS', MMS: 'MMS', E_RECEIPT: 'E-Receipt' }
/** two to six campaigns side by side, the API's limits */
const COMPARE_MIN = 2
const COMPARE_MAX = 6

export function ReportsPage() {
  const { can, me } = useAuth()
  const zone = me?.tenant.timezone || 'UTC'
  const [periodKey, setPeriodKey] = useState<PeriodKey>('month')
  const [custom, setCustom] = useState<Period>(() => periodFor('month', zone))
  const [channel, setChannel] = useState<ChannelFilter>('ALL')
  const [selected, setSelected] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [exportProblem, setExportProblem] = useState('')

  const period = periodKey === 'custom' ? custom : periodFor(periodKey, zone)
  const customValid = periodKey !== 'custom' || (custom.from !== '' && custom.to !== '' && custom.from <= custom.to)
  const query = { from: period.from, to: period.to, ...(channel === 'ALL' ? {} : { channel }) }
  const summary = useQuery({
    queryKey: ['reports', 'summary', query],
    queryFn: ({ signal }) => api.get<ReportSummary>('/reports/summary/', query, signal),
    enabled: can('report.view') && customValid,
    placeholderData: (previous) => previous,
  })

  if (!can('report.view')) {
    return <ErrorState title="Reports need the report.view permission" error={new Error('Ask a workspace administrator to give your role report.view.')} />
  }

  async function exportCsv() {
    setExportProblem('')
    try {
      saveFile(await api.download('/reports/campaigns.csv', query), `cep-report-${period.from}-to-${period.to}.csv`)
    } catch (error) {
      setExportProblem(`The export was not produced. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  const data = summary.data
  const toggle = (id: string) => setSelected((was) => (was.includes(id) ? was.filter((item) => item !== id) : was.length >= COMPARE_MAX ? was : [...was, id]))

  return (
    <section>
      <PageHeader
        title="Reports"
        description={data ? `${formatDay(data.period.from)} – ${formatDay(data.period.to)} · ${data.period.timezone}` : 'How the workspace performed over a period, campaign by campaign.'}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('user.admin') && <button type="button" className={buttonClass({ variant: 'secondary' })} onClick={() => setScheduling(true)}>Schedule Report</button>}
            <button type="button" className={buttonClass({ variant: 'primary' })} disabled={!data} onClick={() => void exportCsv()}>
              <Download size={16} strokeWidth={1.5} aria-hidden />Export CSV
            </button>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <SegmentedControl label="Period" options={PERIOD_OPTIONS} value={periodKey} onChange={(next) => { setPeriodKey(next); setSelected([]) }} />
        {periodKey === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40"><Field label="From">{(ids) => <TextInput {...ids} type="date" value={custom.from} max={custom.to || undefined} onChange={(event) => setCustom((was) => ({ ...was, from: event.target.value }))} />}</Field></div>
            <div className="w-40"><Field label="To">{(ids) => <TextInput {...ids} type="date" value={custom.to} min={custom.from || undefined} onChange={(event) => setCustom((was) => ({ ...was, to: event.target.value }))} />}</Field></div>
          </div>
        )}
        <SegmentedControl label="Channel" options={CHANNELS} value={channel} onChange={(next) => { setChannel(next); setSelected([]) }} />
        {summary.isFetching && data && <span className="flex items-center gap-2 text-helper text-ink-500"><Spinner size="sm" /> Updating</span>}
      </div>

      {!customValid && <p role="alert" className="mb-4 text-sm text-danger-text">Choose a start date on or before the end date.</p>}
      {exportProblem && <p role="alert" className="mb-4 text-sm text-danger-text">{exportProblem}</p>}

      {summary.isError && !data ? (
        <ErrorState title="The report could not be loaded" error={summary.error} onRetry={() => void summary.refetch()} />
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading the report</p>
      ) : (
        <div className="space-y-5">
          <Tiles data={data} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="mb-3 font-display text-card-heading font-semibold text-ink-900">Sent and Opened by Day</h2>
              <DailyChart data={data} />
            </section>
            <Highlights data={data} />
          </div>
          <CampaignsTable
            rows={data.campaigns}
            selected={selected}
            onToggle={toggle}
            onCompare={() => setComparing(true)}
          />
        </div>
      )}

      {comparing && <CompareModal ids={selected} onClose={() => setComparing(false)} />}
      {scheduling && <ScheduleModal zone={zone} onClose={() => setScheduling(false)} />}
    </section>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold text-ink-900 tabular-nums">{value}</p>
      <p className="mt-1 text-helper text-ink-500">{hint}</p>
    </div>
  )
}

function Tiles({ data }: { data: ReportSummary }) {
  const { totals, rates } = data
  const channels = Object.entries(data.by_channel).filter(([, counts]) => counts.sent > 0).length
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Sent" value={formatNumber(totals.sent)}
        hint={`${formatNumber(totals.campaigns)} campaign${totals.campaigns === 1 ? '' : 's'} · ${channels} channel${channels === 1 ? '' : 's'}`} />
      <Tile label="Delivered" value={percent(rates.delivery)} hint={`Bounced ${percent(rates.bounce)} · ${formatNumber(totals.complained)} complaint${totals.complained === 1 ? '' : 's'}`} />
      <Tile label="Opened" value={percent(rates.open)} hint={`${formatNumber(totals.opened)} of those delivered · ${percent(rates.unsubscribe)} unsubscribed`} />
      <Tile label="Clicked" value={percent(rates.click)}
        hint={`${formatNumber(totals.conversions)} conversion${totals.conversions === 1 ? '' : 's'}${totals.revenue ? ` · ${formatMoney(totals.revenue, { whole: true })} attributed` : ''}`} />
    </div>
  )
}

function DailyChart({ data }: { data: ReportSummary }) {
  const byDay = new Map(data.days.map((day) => [day.day, day]))
  const days = daysBetween(data.period.from, data.period.to)
  const texts = data.channel === 'SMS'
  return (
    <Chart
      title={texts ? 'Messages sent and delivered per day' : 'Messages sent and opened per day'}
      categoryHeader="Day"
      categories={days.map((day) => ({ key: day, label: formatDay(day, { day: 'numeric', month: 'short' }), detail: formatDay(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }))}
      series={[
        { key: 'sent', label: 'Sent', values: days.map((day) => byDay.get(day)?.sent ?? 0) },
        texts
          ? { key: 'delivered', label: 'Delivered', values: days.map((day) => byDay.get(day)?.delivered ?? 0) }
          : { key: 'opened', label: 'Opened', values: days.map((day) => byDay.get(day)?.opened ?? 0) },
      ]}
      type={days.length > 31 ? 'area' : 'bar'}
      formatValue={formatNumber}
      emptyText="Nothing was sent in this period. Try a longer period or another channel."
    />
  )
}

function HighlightRow({ label, highlight, value, tone }: { label: string; highlight: ReportHighlight | null; value: (item: ReportHighlight) => string; tone: string }) {
  return (
    <div className="border-b border-line-subtle px-4 py-3 last:border-b-0">
      <p className="text-helper text-ink-500">{label}</p>
      {highlight ? (
        <p className="text-sm font-semibold text-ink-900">
          <Link to={`/campaigns/${highlight.id}`} className="hover:underline">{highlight.name}</Link> <span className={`cep-num ${tone}`}>{value(highlight)}</span>
        </p>
      ) : <p className="text-sm text-ink-500">Not enough sends yet</p>}
    </div>
  )
}

function Highlights({ data }: { data: ReportSummary }) {
  const { highlights } = data
  const hour = highlights.best_send_hour
  const clock = (value: number) => `${String(value).padStart(2, '0')}:00`
  return (
    <section className="rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line-subtle px-4 py-3 font-display text-card-heading font-semibold text-ink-900">Best and Worst</h2>
      <HighlightRow label="Highest Open Rate" highlight={highlights.highest_open_rate} value={(item) => percent(item.rates.open)} tone="text-success-text" />
      <HighlightRow label="Highest Click Rate" highlight={highlights.highest_click_rate} value={(item) => percent(item.rates.click)} tone="text-success-text" />
      <HighlightRow label="Most Unsubscribes" highlight={highlights.most_unsubscribes} value={(item) => percent(item.rates.unsubscribe)} tone="text-danger-text" />
      <div className="px-4 py-3">
        <p className="text-helper text-ink-500">Best Send Hour</p>
        {hour ? <p className="text-sm font-semibold text-ink-900"><span className="cep-num">{clock(hour.hour)}–{clock((hour.hour + 1) % 24)}</span> <span className="cep-num font-normal text-ink-500">{percent(hour.open_rate)} opens · {data.period.timezone}</span></p>
          : <p className="text-sm text-ink-500">Not enough sends yet</p>}
      </div>
      <p className="border-t border-line-subtle px-4 py-2 text-xs text-ink-500">Rates over fewer than 50 sends are left out of these.</p>
    </section>
  )
}

function CampaignsTable({ rows, selected, onToggle, onCompare }: { rows: ReportCampaignRow[]; selected: string[]; onToggle: (id: string) => void; onCompare: () => void }) {
  const full = selected.length >= COMPARE_MAX
  const columns: Column<ReportCampaignRow>[] = [
    {
      key: 'select',
      header: 'Select',
      className: 'w-10',
      render: (row) => (
        <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)}
          disabled={full && !selected.includes(row.id)} onChange={() => onToggle(row.id)} />
      ),
    },
    { key: 'name', header: 'Campaign', render: (row) => <Link to={`/campaigns/${row.id}`} className="font-semibold text-ink-900 hover:underline">{row.name}</Link> },
    { key: 'channel', header: 'Channel', render: (row) => <Tag>{CHANNEL_LABEL[row.channel] ?? row.channel}</Tag>, phoneOptional: true },
    { key: 'first', header: 'First Sent', render: (row) => <span className="cep-num whitespace-nowrap text-ink-700">{row.first_sent_at ? formatDay(row.first_sent_at.slice(0, 10)) : '—'}</span>, phoneOptional: true },
    { key: 'sent', header: 'Sent', align: 'right', render: (row) => <span className="cep-num">{formatNumber(row.sent)}</span> },
    { key: 'delivered', header: 'Delivered', align: 'right', render: (row) => <span className="cep-num">{row.sent ? percent(row.rates.delivery) : '—'}</span>, phoneOptional: true },
    { key: 'open', header: 'Open Rate', align: 'right', render: (row) => <span className="cep-num">{row.sent && row.channel !== 'SMS' ? percent(row.rates.open) : '—'}</span> },
    { key: 'click', header: 'Click Rate', align: 'right', render: (row) => <span className="cep-num">{row.sent ? percent(row.rates.click) : '—'}</span> },
    { key: 'unsub', header: 'Unsub.', align: 'right', render: (row) => <span className="cep-num">{row.sent ? percent(row.rates.unsubscribe) : '—'}</span>, phoneOptional: true },
    { key: 'revenue', header: 'Revenue', align: 'right', render: (row) => <span className="cep-num">{row.revenue ? formatMoney(row.revenue) : '—'}</span>, phoneOptional: true },
  ]
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
        <h2 className="font-display text-card-heading font-semibold text-ink-900">Campaigns in the Period</h2>
        <div className="flex items-center gap-3">
          <span className="text-helper text-ink-500" aria-live="polite">{selected.length ? `${selected.length} selected` : `Select ${COMPARE_MIN} to ${COMPARE_MAX} to compare`}</span>
          <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} disabled={selected.length < COMPARE_MIN} onClick={onCompare}>
            Compare {selected.length >= COMPARE_MIN ? `${selected.length} Selected` : 'Selected'}
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-500">No campaign sent anything in this period. Try a longer period or another channel.</p>
      ) : (
        <DataTable caption="Campaigns in the period" columns={columns} rows={rows} rowKey={(row) => row.id} inset="card" />
      )}
    </section>
  )
}
