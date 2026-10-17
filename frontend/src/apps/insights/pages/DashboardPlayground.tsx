/** /dev/dashboard: a dashboard on sample data, with no backend: viewing, or ?edit=1 for the editor's controls. For design review and screenshots. */
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { DashboardBody } from '../dashboards/DashboardBody'
import { PeriodBar } from '../dashboards/PeriodBar'
import { SlicerBar } from '../dashboards/SlicerBar'
import { activeSlicers, periodBounds, periodWords, toggleValue } from '../dashboards/layout'
import type { DashboardLayout, DashboardTile, Period, ResultColumn, RunResult, SlicerSelection, TileResult } from '../types'

const LAYOUT: DashboardLayout = {
  rows: [
    { width: '4', tiles: [
      { id: 't1', report_id: 'r1', show: 'figure', measure: 'sent', title: 'Sent' }, { id: 't2', report_id: 'r2', show: 'figure', measure: 'delivered_rate', title: 'Delivered Rate' },
      { id: 't3', report_id: 'r3', show: 'figure', measure: 'amount', title: 'Attributed Revenue' }, { id: 't4', report_id: 'r4', show: 'figure', measure: 'unsubscribed', title: 'Unsubscribed' },
    ] },
    { width: '2-1', tiles: [{ id: 't5', report_id: 'r5', show: 'chart', title: 'Sends by Week and Channel' }, { id: 't6', report_id: 'r6', show: 'grid', title: 'Top Campaigns by Revenue' }] },
    { width: '2', tiles: [{ id: 't7', report_id: 'r7', show: 'pivot', title: 'Revenue by Channel and Month' }, { id: 't8', report_id: 'r8', show: 'hierarchy', title: 'Contacts by Store and Consent' }] },
    { width: '2', tiles: [{ id: 't9', report_id: 'r5', show: 'chart', title: 'Sends by Channel' }, { id: 't10', report_id: 'r9', show: 'chart', title: 'Journey Funnel' }] },
  ],
  slicers: [{ field: 'channel', label: 'Channel' }],
}

const col = (key: string, label: string, type: ResultColumn['type'], format: ResultColumn['format'], extra: Partial<ResultColumn> = {}): ResultColumn => ({ key, label, type, format, ...extra })
const report = (id: string, name: string) => ({ id, name, version: 2 })
const FIGURES: Record<string, { value: number; previous: number; column: ResultColumn; name: string }> = {
  t1: { value: 391520, previous: 361180, column: col('sent', 'Sent Count', 'number', 'integer', { aggregate: 'sum' }), name: 'Sends by Campaign' },
  t2: { value: 97.6, previous: 97.3, column: col('delivered_rate', 'Delivered Rate', 'number', 'percent', { aggregate: 'avg' }), name: 'Delivery by Campaign' },
  t3: { value: 94970, previous: 84720, column: col('amount', 'Amount', 'number', 'money', { aggregate: 'sum' }), name: 'Revenue by Campaign' },
  t4: { value: 412, previous: 389, column: col('unsubscribed', 'Unsubscribed', 'number', 'integer', { aggregate: 'count' }), name: 'Unsubscribes' },
}
const SENDS: RunResult = {
  columns: [col('submitted_at', 'Sent', 'date', 'datetime', { bucket: 'week' }), col('channel', 'Channel', 'string', null), col('sent', 'Sent Count', 'number', 'integer', { aggregate: 'sum' })],
  rows: [['2026-09-14', 'EMAIL', 92300], ['2026-09-14', 'SMS', 11800], ['2026-09-21', 'EMAIL', 118400], ['2026-09-21', 'SMS', 19600], ['2026-09-28', 'EMAIL', 130200], ['2026-09-28', 'SMS', 13900], ['2026-10-05', 'EMAIL', 103900], ['2026-10-05', 'SMS', 24100]],
  row_count: 8, duration_ms: 61, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const TOP: RunResult = {
  columns: [col('campaign_name', 'Campaign', 'string', null), col('amount', 'Revenue', 'number', 'money', { aggregate: 'sum' })],
  rows: [['Fall Collection Launch', 48210], ['VIP Early Access', 17980], ['Weekend Flash Sale', 12940], ['Weekly Newsletter', 7050], ['Back in Stock Alerts', 5310], ['Loyalty Double Points', 3480]],
  row_count: 6, duration_ms: 48, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const REVENUE: RunResult = {
  columns: [col('channel', 'Channel', 'string', null), col('ordered_at', 'Ordered', 'date', 'datetime', { bucket: 'month' }), col('amount', 'Revenue', 'number', 'money', { aggregate: 'sum' })],
  rows: [['EMAIL', '2026-09-01', 73240], ['EMAIL', '2026-10-01', 31170], ['SMS', '2026-09-01', 18250], ['SMS', '2026-10-01', 15400]],
  row_count: 4, duration_ms: 55, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const CONTACTS: RunResult = {
  columns: [col('store', 'Store', 'string', null), col('consent', 'Consent', 'string', null), col('contacts', 'Contacts', 'number', 'integer', { aggregate: 'count' })],
  rows: [['Downtown', 'Email and text', 2870], ['Downtown', 'Email only', 1250], ['Riverside', 'Email and text', 1960], ['Riverside', 'Email only', 1000]],
  row_count: 4, duration_ms: 39, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const BY_CHANNEL: RunResult = {
  columns: [col('channel', 'Channel', 'string', null), col('sent', 'Sent Count', 'number', 'integer', { aggregate: 'sum' })],
  rows: [['EMAIL', 444800], ['SMS', 69400]], row_count: 2, duration_ms: 31, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const JOURNEY: RunResult = {
  columns: [col('status', 'Status', 'string', null), col('enrollments', 'Enrollments', 'number', 'integer', { aggregate: 'count' })],
  rows: [['Entered', 12400], ['Welcome sent', 12050], ['Opened', 7320], ['Clicked', 2910], ['Converted', 860]], row_count: 5, duration_ms: 27, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const VIEWS: Record<string, { result: RunResult; across?: string; name: string; own?: boolean; chart?: 'bar' | 'pie' | 'funnel' }> = {
  t5: { result: SENDS, across: 'channel', name: 'Sends by Week and Channel' }, t6: { result: TOP, name: 'Top Campaigns by Revenue', own: true },
  t7: { result: REVENUE, across: 'ordered_at', name: 'Revenue by Channel and Month' }, t8: { result: CONTACTS, name: 'Contacts by Store and Consent' },
  t9: { result: BY_CHANNEL, name: 'Sends by Channel', chart: 'pie' }, t10: { result: JOURNEY, name: 'Journey Funnel', chart: 'funnel' },
}

/** the sample rows narrowed by the Channel slicer, as the engine would narrow them */
function sliced(result: RunResult, slicers?: SlicerSelection): RunResult {
  const channel = slicers?.channel
  const at = result.columns.findIndex((column) => column.key === 'channel')
  if (!channel?.length || at < 0) return result
  const rows = result.rows.filter((row) => channel.some((value) => String(value) === String(row[at])))
  return { ...result, rows, row_count: rows.length }
}

async function load(tile: DashboardTile, period: Period, compare: boolean, slicers?: SlicerSelection): Promise<TileResult> {
  const bounds = periodBounds(period, new Date('2026-10-15T12:00:00Z'))
  const figure = FIGURES[tile.id]
  const channelSlice = slicers?.channel?.length ? ['channel'] : []
  if (figure) return { kind: 'figure', value: figure.value, previous: figure.previous, compared: compare, column: figure.column, own_dates: false, bounds, report: report(tile.report_id, figure.name), cached: false, sliced: channelSlice }
  const view = VIEWS[tile.id] ?? VIEWS.t6
  const has = view.result.columns.some((column) => column.key === 'channel')
  return { kind: 'view', view: { type: tile.show === 'figure' ? 'grid' : tile.show, chart: view.chart ?? 'bar', across: view.across }, result: sliced(view.result, slicers), own_dates: Boolean(view.own), bounds,
    report: report(tile.report_id, view.name), sliced: has ? channelSlice : [] }
}

export default function DashboardPlayground() {
  const [params] = useSearchParams()
  const editing = params.get('edit') === '1'
  const [layout, setLayout] = useState(LAYOUT)
  const [period, setPeriod] = useState<Period>({ preset: '30d' })
  const [compare, setCompare] = useState(true)
  const [selection, setSelection] = useState<SlicerSelection>({})
  const [extra, setExtra] = useState<{ field: string; label: string }[]>([])
  const bounds = periodBounds(period, new Date('2026-10-15T12:00:00Z'))
  const pick = (column: ResultColumn, value: unknown) => {
    if (column.key !== 'channel' && !extra.some((item) => item.field === column.key)) setExtra((now) => [...now, { field: column.key, label: column.label }])
    setSelection((now) => toggleValue(now, column.key, value))
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title="Marketing Weekly" description={editing ? undefined : `Sends, revenue and the top campaigns, by week · ${periodWords(bounds)}`}
        actions={<div className="flex gap-2">{editing ? <><span className={buttonSecondary}>Add Tile</span><span className={buttonPrimary}>Done</span></> : <span className={buttonSecondary}>Edit</span>}</div>} />
      <PeriodBar period={period} onPeriod={setPeriod} compare={compare} onCompare={setCompare} bounds={bounds} />
      {!editing && <SlicerBar slicers={layout.slicers ?? []} extra={extra} selection={selection} onChange={(field, values) => setSelection((now) => ({ ...now, [field]: values }))}
        onRemoveExtra={(field) => { setExtra((now) => now.filter((item) => item.field !== field)); setSelection((now) => ({ ...now, [field]: [] })) }}
        loadValues={async (field) => ({ field, label: 'Channel', values: ['EMAIL', 'SMS'], datasets: 2 })} queryKey={['dev', 'dashboard', 'slicers']} />}
      <DashboardBody layout={layout} period={period} compare={compare} load={load} keyPrefix={['dev', 'dashboard']} selection={activeSlicers(selection)} onPick={pick} editing={editing ? { onChange: setLayout, onAddTile: () => undefined } : undefined} />
    </div>
  )
}
