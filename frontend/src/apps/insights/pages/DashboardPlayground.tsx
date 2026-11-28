/**
 * /dev/dashboard: a dashboard on sample data, with no backend, for design review and screenshots: viewing, or ?edit=1 for the
 * editor's bar, settings line and grid (?canvas=1 for a free canvas, ?phone=1 for the phone preview, ?theme=berry for a theme).
 * ?board=engagement shows the Engagement Overview of the Engagement Reports pack (?sparse=1: a period with little sent;
 * ?sparse=2: nothing sent).
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ChevronLeft, Pencil, Plus, RefreshCw, Share2 } from 'lucide-react'

import { IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Switch } from '@/components/Switch'
import { ActionsMenu, MenuGap } from '../components/ActionsMenu'
import { DashboardBody } from '../dashboards/DashboardBody'
import { PeriodMenu } from '../dashboards/PeriodMenu'
import { SlicerBar } from '../dashboards/SlicerBar'
import { activeSlicers, periodBounds, toggleValue } from '../dashboards/layout'
import { bottom, rowsToCells } from '../dashboards/canvas'
import { themeStyle } from '../dashboards/themes'
import type { DashboardLayout, DashboardTheme, DashboardTile, DrillStep, Period, ResultColumn, RunResult, SlicerSelection, TileResult } from '../types'

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

/** ?board=engagement: the Engagement Overview dashboard as the Engagement Reports pack makes it, on sample figures */
const ENGAGEMENT: DashboardLayout = {
  rows: [
    { width: '4', tiles: [
      { id: 'e1', report_id: 'r1', show: 'figure', measure: 'sent', title: 'Sent' }, { id: 'e2', report_id: 'r1', show: 'figure', measure: 'delivered_rate', title: 'Delivered' },
      { id: 'e3', report_id: 'r1', show: 'figure', measure: 'open_rate', title: 'Opened' }, { id: 'e4', report_id: 'r1', show: 'figure', measure: 'click_rate', title: 'Clicked' },
    ] },
    { width: '2-1', tiles: [{ id: 'e5', report_id: 'r2', show: 'chart', title: 'Sent and Opened by Day' }, { id: 'e6', report_id: 'r3', show: 'chart', title: 'Best by Open Rate' }] },
    { width: '4', tiles: [
      { id: 'e7', report_id: 'r3', show: 'figure', measure: 'c_open_rate', line: 'first', title: 'Highest Open Rate' }, { id: 'e8', report_id: 'r4', show: 'figure', measure: 'c_click_rate', line: 'first', title: 'Highest Click Rate' },
      { id: 'e9', report_id: 'r5', show: 'figure', measure: 'c_unsubscribe_rate', line: 'first', title: 'Most Unsubscribes' }, { id: 'e10', report_id: 'r6', show: 'figure', measure: 'c_open_rate', line: 'first', title: 'Best Send Hour' },
    ] },
    { width: '1', tiles: [{ id: 'e11', report_id: 'r7', show: 'grid', title: 'Campaigns in the Period',
      tick: { field: 'campaign_name', report_id: 'r9', parameter: 'campaign', period: 'period', label: 'Compare Campaigns', min: 2, max: 6 },
      empty: { title: 'No Campaign Sent in This Period', text: 'Results show here from the first send. Try a longer period, or send a campaign.', label: 'Go to Campaigns', to: '/campaigns' } }] },
    { width: '1', tiles: [{ id: 'e12', report_id: 'r8', show: 'grid', title: 'Journeys in the Period' }] },
  ],
  slicers: [{ field: 'channel', label: 'Channel' }],
}
const RATE = (key: string, label: string) => col(key, label, 'number', 'percent', { aggregate: 'calc' })
const CAMPAIGN = col('campaign_name', 'Campaign', 'string', null)
Object.assign(FIGURES, {
  e1: { value: 184220, previous: 171900, column: col('sent', 'Sent Count', 'number', 'integer', { aggregate: 'sum' }), name: 'Engagement Totals' },
  e2: { value: 97.6, previous: 97.1, column: RATE('delivered_rate', 'Delivered Rate'), name: 'Engagement Totals' },
  e3: { value: 31.4, previous: 29.8, column: RATE('open_rate', 'Open Rate'), name: 'Engagement Totals' },
  e4: { value: 4.8, previous: 5.1, column: RATE('click_rate', 'Click Rate'), name: 'Engagement Totals' },
})
/** the figures read from a report's first line: the line's name, its value, and where they come from */
const FIRST: Record<string, { value: number; label: string; column: ResultColumn; from: ResultColumn; name: string }> = {
  e7: { value: 36.2, label: 'Winter Coat Launch', column: RATE('c_open_rate', 'Open Rate'), from: CAMPAIGN, name: 'Best Campaigns by Open Rate' },
  e8: { value: 7.4, label: 'Weekend Flash Sale', column: RATE('c_click_rate', 'Click Rate'), from: CAMPAIGN, name: 'Best Campaigns by Click Rate' },
  e9: { value: 0.9, label: 'Store Opening, Decatur', column: RATE('c_unsubscribe_rate', 'Unsubscribe Rate'), from: CAMPAIGN, name: 'Campaigns by Unsubscribe Rate' },
  e10: { value: 34.1, label: '10 AM', column: RATE('c_open_rate', 'Open Rate'), from: col('c_send_hour', 'Send Hour', 'string', null), name: 'Open Rate by Send Hour' },
}
const DAILY = [5200, 6100, 4800, 7400, 9100, 3900, 2600, 5600, 6900, 5100, 8200, 11800, 4200, 2900, 6100, 7300, 5400, 9800, 14200, 5100, 3300, 6800, 8100, 5900, 10400, 12900, 4600, 3100, 7200, 8300]
const BY_DAY: RunResult = {
  columns: [col('submitted_at', 'Sent', 'date', 'datetime', { bucket: 'day' }), col('sent', 'Sent Count', 'number', 'integer', { aggregate: 'sum' }), col('opened', 'Opened', 'number', 'integer', { aggregate: 'sum' })],
  rows: DAILY.map((sent, d) => [new Date(Date.UTC(2026, 8, 16 + d)).toISOString().slice(0, 10), sent, Math.round(sent * (0.27 + (d % 5) * 0.02))]),
  row_count: DAILY.length, duration_ms: 58, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const BEST_OPEN: RunResult = {
  columns: [CAMPAIGN, RATE('c_open_rate', 'Open Rate')],
  rows: [['Winter Coat Launch', 36.2], ['Loyalty Double Points', 33.1], ['Black Friday Preview', 29.8], ['Store Opening, Decatur', 27.5], ['Weekly Newsletter', 24.9]],
  row_count: 5, duration_ms: 44, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const CAMPAIGNS: RunResult = {
  columns: [CAMPAIGN, col('campaign_channel', 'Channel', 'string', null), col('first_sent', 'First Sent', 'datetime', 'date', { aggregate: 'min' }), col('sent', 'Sent', 'number', 'integer', { aggregate: 'sum' }),
    RATE('delivered_rate', 'Delivered'), RATE('open_rate', 'Open Rate'), RATE('click_rate', 'Click Rate'), RATE('unsubscribe_rate', 'Unsub.'),
    col('attributed_orders.amount', 'Revenue', 'number', 'money', { aggregate: 'sum' })],
  rows: [['Back in Stock Alerts', 'SMS', '2026-10-11T15:00:00Z', 20600, 95.8, null, 6.1, 0.5, 4180], ['Store Opening, Decatur', 'EMAIL', '2026-10-09T14:00:00Z', 9820, 97.2, 27.5, 3.2, 0.9, null],
    ['Black Friday Preview', 'EMAIL', '2026-10-07T15:00:00Z', 51300, 98.1, 29.8, 4.1, 0.4, 22750], ['Weekend Flash Sale', 'SMS', '2026-09-28T16:30:00Z', 21400, 96.2, null, 7.4, 0.6, 9310],
    ['Loyalty Double Points', 'EMAIL', '2026-09-26T15:00:00Z', 38900, 97.9, 33.1, 4.9, 0.3, 12960], ['Winter Coat Launch', 'EMAIL', '2026-09-22T15:00:00Z', 42180, 98.4, 36.2, 5.8, 0.2, 18420]],
  row_count: 6, duration_ms: 73, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
const JOURNEYS: RunResult = {
  columns: [col('journey_name', 'Journey', 'string', null), col('journey_status', 'Status', 'string', null), col('enrollments', 'Entered', 'number', 'integer', { aggregate: 'count' }),
    col('converted', 'Converted', 'number', 'integer', { aggregate: 'sum' }), RATE('conversion_rate', 'Conversion Rate'), col('revenue', 'Revenue', 'number', 'money', { aggregate: 'sum' }),
    col('journey_steps.sent', 'Sent', 'number', 'integer', { aggregate: 'sum' }), RATE('journey_steps.delivered_rate', 'Delivered'), col('journey_steps.held_back', 'Held Back', 'number', 'integer', { aggregate: 'sum' })],
  rows: [['Welcome Series', 'ACTIVE', 3240, 412, 12.7, 8900, 9410, 98.0, 86], ['Cart Reminder', 'ACTIVE', 1880, 301, 16.0, 11240, 3620, 97.4, 41], ['Win-Back 90 Days', 'PAUSED', 640, 22, 3.4, 510, 1150, 94.9, 12]],
  row_count: 3, duration_ms: 51, truncated: false, offset: 0, limit: 200, freshness: 'LIVE', cached: false,
}
Object.assign(VIEWS, {
  e5: { result: BY_DAY, name: 'Sent and Opened by Day' }, e6: { result: BEST_OPEN, name: 'Best Campaigns by Open Rate' },
  e11: { result: CAMPAIGNS, name: 'Campaigns in the Period' }, e12: { result: JOURNEYS, name: 'Journeys in the Period' },
})
const SPARSENESS = new URLSearchParams(window.location.search).get('sparse')
const SPARSE = SPARSENESS === '1' || SPARSENESS === '2'
const NOTHING = SPARSENESS === '2'
/** the campaign or the journey behind each name of a sample grid, as a tile run names them */
const LINKS: Record<string, { column: string; kind: 'campaign' | 'journey' }> = { e11: { column: 'campaign_name', kind: 'campaign' }, e12: { column: 'journey_name', kind: 'journey' } }
const linksOf = (tileId: string, result: RunResult) => (LINKS[tileId] ? [{ ...LINKS[tileId], ids: Object.fromEntries(result.rows.map((row, at) => [String(row[0]), `sample-${at + 1}`])) }] : undefined)
/** the four key figures of a period with one text campaign sent */
const LITTLE: Record<string, number | null> = { e1: 20600, e2: 95.8, e3: null, e4: 6.1 }
const few = (result: RunResult, keep: number): RunResult => ({ ...result, rows: result.rows.slice(0, keep), row_count: Math.min(keep, result.rows.length) })

/** the Channel slicer's picks (a values slicer) */
function channelOf(slicers?: SlicerSelection): unknown[] {
  const picked = slicers?.channel
  return Array.isArray(picked) ? picked : []
}

/** the sample rows narrowed by the Channel slicer, as the engine would narrow them */
function sliced(result: RunResult, slicers?: SlicerSelection): RunResult {
  const channel = channelOf(slicers)
  const at = result.columns.findIndex((column) => column.key === 'channel')
  if (!channel.length || at < 0) return result
  const rows = result.rows.filter((row) => channel.some((value) => String(value) === String(row[at])))
  return { ...result, rows, row_count: rows.length }
}

/** Sends by Week and Channel drills from weeks to their days: the week's figures spread over its seven days */
const WEEKLY_LEVELS = [{ field: 'submitted_at', bucket: 'week' as const, label: 'Sent by Week' }, { field: 'submitted_at', bucket: 'day' as const, label: 'Sent by Day' }]
function daysOf(week: string): RunResult {
  const start = new Date(`${week}T00:00:00Z`)
  const share = [0.18, 0.17, 0.16, 0.15, 0.14, 0.11, 0.09]
  const rows = SENDS.rows.filter((row) => row[0] === week).flatMap((row) => share.map((part, d) => [new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10), row[1], Math.round(Number(row[2]) * part)]))
  return { ...SENDS, columns: [{ ...SENDS.columns[0], bucket: 'day' }, ...SENDS.columns.slice(1)], rows, row_count: rows.length }
}

async function load(tile: DashboardTile, period: Period, compare: boolean, slicers?: SlicerSelection, drill?: DrillStep[]): Promise<TileResult> {
  const bounds = periodBounds(period, new Date('2026-10-15T12:00:00Z'))
  const figure = FIGURES[tile.id]
  const channelSlice = channelOf(slicers).length ? ['channel'] : []
  const first = FIRST[tile.id]
  if (first) {
    return { kind: 'figure', line: 'first', value: SPARSE ? null : first.value, label: SPARSE ? null : first.label, label_column: first.from, previous: null, compared: false, column: first.column, own_dates: false, bounds,
      report: report(tile.report_id, first.name), cached: false, sliced: channelSlice }
  }
  if (SPARSE && figure && tile.id in LITTLE) return { kind: 'figure', value: NOTHING ? (tile.id === 'e1' ? 0 : null) : LITTLE[tile.id], previous: null, compared: false, column: figure.column, own_dates: false, bounds, report: report(tile.report_id, figure.name), cached: false, sliced: channelSlice }
  if (SPARSE && tile.id in VIEWS && tile.id.startsWith('e')) {
    const view = VIEWS[tile.id]
    return { kind: 'view', view: { type: tile.show === 'chart' ? 'chart' : 'grid', chart: 'bar' }, result: few(view.result, tile.id === 'e11' && !NOTHING ? 1 : 0), own_dates: false, bounds, report: report(tile.report_id, view.name), sliced: [],
      links: linksOf(tile.id, few(view.result, tile.id === 'e11' && !NOTHING ? 1 : 0)) }
  }
  if (figure) return { kind: 'figure', value: figure.value, previous: figure.previous, compared: compare, column: figure.column, own_dates: false, bounds, report: report(tile.report_id, figure.name), cached: false, sliced: channelSlice }
  const view = VIEWS[tile.id] ?? VIEWS.t6
  if (tile.id === 't5') {
    const path = drill ?? []
    const rows = path.length ? daysOf(String(path[0].value)) : view.result
    return { kind: 'view', view: { type: 'chart', chart: 'bar', across: 'channel' }, result: sliced(rows, slicers), own_dates: false, bounds, report: report(tile.report_id, view.name),
      sliced: channelSlice, drill: { levels: WEEKLY_LEVELS, path, depth: path.length } }
  }
  const has = view.result.columns.some((column) => column.key === 'channel')
  return { kind: 'view', view: { type: tile.show === 'figure' || tile.show === 'summary' || tile.show === 'text' || tile.show === 'button' ? 'grid' : tile.show, chart: view.chart ?? 'bar', across: view.across }, result: sliced(view.result, slicers), own_dates: Boolean(view.own), bounds,
    report: report(tile.report_id, view.name), sliced: has ? channelSlice : [], links: linksOf(tile.id, view.result) }
}

export default function DashboardPlayground() {
  const [params] = useSearchParams()
  const editing = params.get('edit') === '1'
  const engagement = params.get('board') === 'engagement'
  const [layout, setLayout] = useState<DashboardLayout>(() => (engagement ? ENGAGEMENT : params.get('canvas') === '1' ? { ...LAYOUT, rows: [], canvas: true, cells: [...rowsToCells(LAYOUT.rows),
    { id: 'n1', report_id: '', show: 'text', title: 'How to Read This', text: 'Sends and revenue for the period above.\n\n- **Figures** compare with the period before\n- Click a bar to filter the other tiles', x: 0, y: bottom(rowsToCells(LAYOUT.rows)), w: 6, h: 2 },
    { id: 'b1', report_id: '', show: 'button', label: 'Email Only', action: { kind: 'view', id: 'v1' }, x: 6, y: bottom(rowsToCells(LAYOUT.rows)), w: 3, h: 1, hide_on_phone: true }] } : LAYOUT))
  const [period, setPeriod] = useState<Period>({ preset: '30d' })
  const [compare, setCompare] = useState(true)
  const [selection, setSelection] = useState<SlicerSelection>({})
  const [extra, setExtra] = useState<{ field: string; label: string }[]>([])
  const bounds = periodBounds(period, new Date('2026-10-15T12:00:00Z'))
  const pick = (column: ResultColumn, value: unknown) => {
    if (column.key !== 'channel' && !extra.some((item) => item.field === column.key)) setExtra((now) => [...now, { field: column.key, label: column.label }])
    setSelection((now) => toggleValue(now, column.key, value))
  }
  const canvas = Boolean(layout.canvas)
  const body = (
    <div style={themeStyle((params.get('theme') ?? undefined) as DashboardTheme | undefined)}>
      <DashboardBody layout={layout} period={period} compare={compare} load={load} keyPrefix={['dev', 'dashboard']} selection={activeSlicers(selection)} onPick={pick} phone={params.get('phone') === '1'}
        editing={editing ? { onChange: setLayout, grid: !canvas, onAddTile: () => undefined, onEditTile: () => undefined } : undefined} onAction={() => undefined}
        comments={editing ? undefined : { count: () => 0, open: () => undefined }} />
    </div>
  )
  if (editing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header aria-label="Editor" className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface pr-4 pl-3">
          <IconButton label="Back to Dashboard" icon={ChevronLeft} size="md" onClick={() => undefined} />
          <span aria-hidden className="h-6 w-px shrink-0 bg-line-subtle" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-xs text-ink-800">Dashboards</p>
            <p className="flex items-center gap-3 font-display text-section-title font-semibold text-ink-900">Marketing Weekly
              <span className="inline-flex items-center gap-1.5 font-body text-helper font-medium text-warning-text"><span aria-hidden className="h-2 w-2 rounded-full bg-warning" />Unsaved Changes</span></p>
          </div>
          <span className={buttonSecondary}>Discard Changes</span><span className={buttonPrimary}>Save</span>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-6 py-3">
          <PeriodMenu period={period} onPeriod={setPeriod} bounds={bounds} />
          <Switch checked={compare} onChange={setCompare} label="Compare With Previous Period" />
          <span aria-hidden className="mx-1 h-6 w-px bg-line-subtle" />
          <SegmentedControl label="Layout" options={[{ value: 'grid', label: 'Grid' }, { value: 'canvas', label: 'Free Canvas' }]} value={canvas ? 'canvas' : 'grid'} onChange={() => undefined} />
          <span className="ml-auto"><span className={buttonPrimary}><Plus size={16} strokeWidth={1.5} aria-hidden />Add</span></span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-canvas px-6 py-5">{body}</div>
      </div>
    )
  }
  return (
    <div className="report-density flex min-h-0 flex-1 flex-col gap-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-3 inline-flex items-center gap-1 text-helper text-brand-800"><ChevronLeft size={16} strokeWidth={1.5} aria-hidden /> Dashboards</p>
          <h1 className="font-display text-page-title font-semibold text-ink-900">{engagement ? 'Engagement Overview' : 'Marketing Weekly'}</h1>
          <p className="mt-1 text-sm text-ink-800">{engagement ? 'The workspace’s campaigns and journeys over a period.' : 'Sends, revenue and the top campaigns, by week'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-helper text-ink-800">Updated just now</span>
          <IconButton label="Refresh" icon={RefreshCw} onClick={() => undefined} />
          <span className={buttonSecondary}><Share2 size={16} strokeWidth={1.5} aria-hidden />Share</span>
          <span className={buttonPrimary}><Pencil size={16} strokeWidth={1.5} aria-hidden />Edit</span>
          <ActionsMenu>{(act) => (
            <>
              {['Comments', 'Schedule'].map((title) => <MenuRow key={title} role="menuitem" divider={false} title={title} onClick={() => act(() => undefined)} />)}
              <MenuGap />
              {['Export PDF', 'Export PowerPoint'].map((title) => <MenuRow key={title} role="menuitem" divider={false} title={title} onClick={() => act(() => undefined)} />)}
              <MenuGap />
              <MenuRow role="menuitem" divider={false} title="Embed on Another Site" onClick={() => act(() => undefined)} />
              <MenuGap />
              <MenuRow role="menuitem" divider={false} tone="error" title="Delete" onClick={() => act(() => undefined)} />
            </>
          )}</ActionsMenu>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PeriodMenu period={period} onPeriod={setPeriod} bounds={bounds} />
        <Switch checked={compare} onChange={setCompare} label="Compare With Previous Period" />
        <span aria-hidden className="mx-1 h-6 w-px bg-line-subtle" />
        <SlicerBar slicers={layout.slicers ?? []} extra={extra} selection={selection} onChange={(field, values) => setSelection((now) => ({ ...now, [field]: values }))}
          onRemoveExtra={(field) => { setExtra((now) => now.filter((item) => item.field !== field)); setSelection((now) => ({ ...now, [field]: [] })) }}
          loadValues={async (field) => ({ field, label: 'Channel', values: ['EMAIL', 'SMS'], datasets: 2 })} queryKey={['dev', 'dashboard', 'slicers']} />
        <span className={`${buttonSecondary} ml-auto`}>View: Default</span>
      </div>
      {body}
    </div>
  )
}
