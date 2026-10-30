/**
 * One tile: a saved report in one of its views, or one of its figures over the dashboard's period. The tile runs itself
 * through `load` (the API on a dashboard page, sample data on the playground) and shows the figure with its change, or
 * the rows in the view, or why it could not run. Editing controls come in through `controls`. A chart tile over a report
 * with more than one level has Drill Down: while it is on, a click drills that tile (the path above the chart goes back
 * up) instead of filtering the other tiles. Under the title a line says what the tile reads (its own dates, a click filtering the
 * others, or its report); viewing, its ⋯ opens the report, shows the numbers, exports them as CSV or starts a comment. A run
 * refused because the workspace is busy is tried again a few times before the tile says so.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronsDown, Download, ExternalLink, MessageSquare, Table2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { ApiError } from '@/lib/api'
import { canDrill, deeper, throughable } from '../components/drill'
import { DrillBar } from '../components/DrillBar'
import { DrillThroughMenu, type ThroughTarget } from '../components/DrillThroughMenu'
import { AiPill } from '../components/AskForReport'
import { ReportResult } from '../components/ReportViews'
import { formatCell } from '../components/resultWords'
import { RowMenu } from '../components/RowMenu'
import type { DashboardSlicer, DashboardTile, DrillStep, Period, ResultColumn, SlicerSelection, TileResult, ViewType } from '../types'
import { activeSlicers, crossFilterable, periodWords } from './layout'
import { downloadCsv, tileTable } from './tileExport'

export type TileLoader = (tile: DashboardTile, period: Period, compare: boolean, slicers?: SlicerSelection, drill?: DrillStep[]) => Promise<TileResult>

/** the workspace ran as many reports as it may at once: worth a few more tries */
class Busy extends Error {
  readonly result: TileResult
  constructor(result: TileResult) { super('busy'); this.result = result }
}
const BUSY_TRIES = 4
const isBusy = (data: TileResult) => data.kind === 'refused' && /busy/i.test(data.detail)

const CLICKABLE: DashboardTile['show'][] = ['chart', 'grid', 'pivot', 'hierarchy']
/** what a click on the tile picks: a bar, a slice, a stage, else a value */
function clickWords(data: TileResult): string {
  const chart = data.kind === 'view' && data.view.type === 'chart' ? data.view.chart ?? 'bar' : null
  const thing = chart === 'pie' ? 'slice' : chart === 'funnel' ? 'stage' : chart && ['bar', 'stacked', 'stacked100', 'combo', 'waterfall'].includes(chart) ? 'bar' : 'value'
  return `Click a ${thing} to filter the other tiles`
}

export function TileCard({ tile, period, compare, load, keyPrefix, controls, onTitle, selection, slicers, onPick, drillState, onComment, fill = false }: {
  tile: DashboardTile; period: Period; compare: boolean; load: TileLoader; keyPrefix: readonly unknown[]
  /** the editing controls at the right of the header */
  controls?: ReactNode
  /** when given, the title is an input (editing) */
  onTitle?: (title: string) => void
  /** the slicers' picked values, sent with the run; the tile says when its dataset lacks a picked field */
  selection?: SlicerSelection
  slicers?: DashboardSlicer[]
  /** a dimension value clicked on the tile: the dashboard's cross-filter */
  onPick?: (column: ResultColumn, value: unknown) => void
  /** the drill, held by the dashboard (a saved view keeps it); without it the tile holds its own */
  drillState?: { on: boolean; path: DrillStep[]; set: (next: { on: boolean; path: DrillStep[] }) => void }
  /** viewing: a comment on this tile; with it the tile has its ⋯ */
  onComment?: () => void
  /** fills its place on a canvas, the content scrolling inside */
  fill?: boolean
}) {
  const navigate = useNavigate()
  const [numbers, setNumbers] = useState(false)
  const active = activeSlicers(selection ?? {})
  const [ownDrilling, setOwnDrilling] = useState(false)
  const [ownPath, setOwnPath] = useState<DrillStep[]>([])
  const drilling = drillState ? drillState.on : ownDrilling
  const path = drillState ? drillState.path : ownPath
  const setPath = (next: DrillStep[]) => (drillState ? drillState.set({ on: true, path: next }) : setOwnPath(next))
  const setDrilling = (on: boolean) => (drillState ? drillState.set({ on, path: on ? path : [] }) : setOwnDrilling(on))
  const [through, setThrough] = useState<ThroughTarget | null>(null)
  const query = useQuery({
    queryKey: [...keyPrefix, tile.id, tile.report_id, tile.show, tile.measure ?? '', period, compare, active, path],
    queryFn: async () => {
      const result = await load(tile, period, compare, Object.keys(active).length ? active : undefined, path.length ? path : undefined)
        .catch((error: unknown) => (error instanceof ApiError && error.status === 422 ? (error.problem as unknown as TileResult) : Promise.reject(error)))
      if (isBusy(result)) throw new Busy(result)
      return result
    },
    retry: (count, error) => error instanceof Busy && count < BUSY_TRIES,
    retryDelay: (count) => 1500 * (count + 1),
    placeholderData: (previous) => previous,
  })
  const busy = query.error instanceof Busy ? query.error.result : null
  const data = query.data ?? busy ?? undefined
  const name = tile.title || (data && 'report' in data ? data.report.name : '')
  const unfiltered = data && 'sliced' in data ? Object.keys(active).filter((field) => !(data.sliced ?? []).includes(field)).map((field) => slicers?.find((item) => item.field === field)?.label ?? field) : []
  const info = data?.kind === 'view' ? data.drill : undefined
  const drillable = tile.show === 'chart' && Boolean(info)
  const pick = (column: ResultColumn, value: unknown) => {
    if (drilling && info) {
      if (canDrill(info, column)) setPath(deeper(info, value))
    } else if (crossFilterable(column, value)) onPick?.(column, value)
  }
  const toggleDrill = () => { if (drilling && !drillState) setOwnPath([]); setDrilling(!drilling) }
  const context = data?.kind === 'view' && data.report.dataset && !onTitle ? (column: ResultColumn, value: unknown, at: { x: number; y: number }) => {
    if (throughable(column)) setThrough({ dataset: data.report.dataset as string, field: column.key, fieldLabel: column.label, value, valueWords: formatCell(column, value), at, from: { id: data.report.id, name: tile.title || data.report.name } })
  } : undefined
  const reads = !data || data.kind === 'missing' || data.kind === 'refused' ? null
    : 'own_dates' in data && data.own_dates ? `Own dates · ${periodWords(data.bounds)}`
    : drilling ? 'A click drills this tile'
    : onPick && CLICKABLE.includes(tile.show) ? clickWords(data)
    : tile.title && tile.title !== data.report.name ? data.report.name : null
  const table = data ? tileTable(data) : null
  const report = data && 'report' in data ? data.report : null
  const menu = onComment && !onTitle ? (
    <RowMenu label={`Actions for ${name || 'this tile'}`} groups={[
      [
        report && { title: 'Open the Report', icon: <ExternalLink size={16} strokeWidth={1.5} aria-hidden />, onSelect: () => navigate(`/insights/reports/${report.id}`) },
        table && { title: 'Show the Numbers', icon: <Table2 size={16} strokeWidth={1.5} aria-hidden />, onSelect: () => setNumbers(true) },
        table && { title: 'Export CSV', icon: <Download size={16} strokeWidth={1.5} aria-hidden />, onSelect: () => downloadCsv(table, name) },
      ],
      [{ title: 'Comment', icon: <MessageSquare size={16} strokeWidth={1.5} aria-hidden />, onSelect: onComment }],
    ]} />
  ) : null
  return (
    <section aria-label={name || 'Tile'} className={`flex min-w-0 flex-col rounded-md border border-line bg-surface ${fill ? 'h-full' : ''}`}>
      <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2">
        {onTitle ? (
          <input aria-label="Tile title" value={tile.title ?? ''} placeholder={data && 'report' in data ? data.report.name : 'Title'} onChange={(event) => onTitle(event.target.value)} maxLength={100}
            className="h-7 min-w-0 flex-1 rounded-control-sm border border-transparent bg-transparent px-1.5 text-sm font-semibold text-ink-900 hover:border-line focus:border-focus focus:outline-none" />
        ) : (
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-ink-900">{name || '\u00a0'}</h3>
            {(reads || unfiltered.length > 0) && (
              <p className="truncate text-xs text-ink-800">
                {reads}
                {unfiltered.length > 0 && <span title={`This tile's data has no ${unfiltered.join(', ')} field, so that slicer does not narrow it.`}>{reads ? ' · ' : ''}Not sliced by {unfiltered.join(', ')}</span>}
              </p>
            )}
          </div>
        )}
        {drillable && !onTitle && (
          <button type="button" aria-pressed={drilling} onClick={toggleDrill} title={drilling ? 'A click drills this tile; turn off to filter the other tiles' : 'Turn on to drill into this tile with a click'}
            className={`inline-flex h-6 items-center gap-1 rounded-control-sm px-1.5 text-xs font-semibold transition-colors ${drilling ? 'bg-brand-100 text-brand-800' : 'text-ink-800 hover:bg-surface-hover'}`}>
            <ChevronsDown size={14} strokeWidth={1.5} aria-hidden />Drill Down
          </button>
        )}
        {controls}
        {menu}
      </header>
      <div className={`min-w-0 flex-1 ${tile.show === 'figure' ? 'p-3' : 'p-2'} ${fill ? 'min-h-0 overflow-auto' : ''}`}>
        {query.isPending && !busy ? <div className="flex min-h-24 items-center justify-center"><Spinner label={query.failureCount > 0 ? 'Waiting for a free moment' : 'Running the tile'} /></div>
          : query.isError && !busy ? <ErrorState error={query.error} onRetry={() => query.refetch()} />
          : (
            <div className="flex flex-col gap-1.5">
              {drilling && info && <DrillBar info={info} onPath={setPath} compact />}
              <TileBody data={data as TileResult} tile={tile} onPick={onPick || drilling ? pick : undefined} onContext={context} />
            </div>
          )}
        {through && <DrillThroughMenu target={through} onClose={() => setThrough(null)} />}
      </div>
      {numbers && table && (
        <Modal title={name || 'The Numbers'} subtitle={report ? `From ${report.name}` : undefined} onClose={() => setNumbers(false)} size="lg" scrollBody>
          <NumbersTable table={table} label={`${name || 'Tile'} numbers`} />
        </Modal>
      )}
    </section>
  )
}

function TileBody({ data, tile, onPick, onContext }: { data: TileResult; tile: DashboardTile; onPick?: (column: ResultColumn, value: unknown) => void; onContext?: (column: ResultColumn, value: unknown, at: { x: number; y: number }) => void }) {
  if (data.kind === 'missing' || data.kind === 'refused') {
    return <p className="flex min-h-24 items-center justify-center text-center text-sm text-ink-800">{data.detail}</p>
  }
  if (data.kind === 'figure') {
    const value = data.value === null ? '—' : formatCell(data.column, data.value)
    const change = data.compared && data.previous !== null && data.value !== null && Number(data.previous) !== 0 ? (Number(data.value) - Number(data.previous)) / Math.abs(Number(data.previous)) : null
    return (
      <div className="flex flex-col gap-0.5">
        <span className="cep-num font-display text-kpi font-semibold text-ink-900">{value}</span>
        {data.compared && (
          <span className="cep-num text-xs font-semibold text-ink-800">
            {change === null ? 'No previous period to compare' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change * 100).toFixed(1)}% vs previous`}
          </span>
        )}
        <span className="text-xs text-ink-700">{data.column.label}</span>
      </div>
    )
  }
  if (data.kind === 'summary') {
    if (!data.summary) return <p className="flex min-h-24 items-center justify-center text-center text-sm text-ink-800">{data.detail ?? 'No summary yet.'}</p>
    return (
      <div className="flex flex-col gap-2 p-1">
        <p className="text-sm text-ink-900">{data.summary}</p>
        {data.points && data.points.length > 0 && <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-900">{data.points.map((point, index) => <li key={index}>{point}</li>)}</ul>}
        {data.caution && <p className="text-xs text-ink-800">{data.caution}</p>}
        <p className="flex items-center gap-1.5 text-xs text-ink-700"><AiPill />{data.model ? `Written by ${data.model.label}` : 'Written by AI'} from {data.report.name}{data.cached ? ', kept from earlier today' : ''}. Check the figures before you act on them.</p>
      </div>
    )
  }
  return <ReportResult result={data.result} view={{ ...data.view, type: tile.show === 'figure' ? 'grid' : tile.show as ViewType }} label={`${tile.title || data.report.name} rows`} minHeight={200} onPick={onPick} onContext={onContext} />
}

function NumbersTable({ table, label }: { table: ReturnType<typeof tileTable> & object; label: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table aria-label={label} className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-subtle text-left text-label font-medium text-ink-900">
            {table.columns.map((column) => <th key={column.key} className={`px-3 py-2 ${column.type === 'number' ? 'text-right' : ''}`}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-t border-line-subtle first:border-t-0">
              {row.map((value, at) => <td key={at} className={`cep-num px-3 py-1.5 text-ink-900 ${table.columns[at]?.type === 'number' ? 'text-right' : ''}`}>{table.columns[at] ? formatCell(table.columns[at], value) : String(value ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
