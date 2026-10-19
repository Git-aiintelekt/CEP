/**
 * The four views of one report, and the bar that switches them. Grid: the rows (ResultGrid). Chart: the chart kit on the
 * first dimension, one series per value of the dimension across, else one per measure; a pie or a funnel of the first
 * measure by the first dimension. Hierarchy: the dimensions as
 * levels that fold, with subtotals. Pivot: the dimension across as columns, one measure in the cells, totals on both
 * edges. Any report switches between them without losing its fields; the chosen view and its settings save with the
 * definition (`view`).
 */
import { ChartArea, ChartBarStacked, ChartColumn, ChartColumnStacked, ChartLine, ChartNoAxesCombined, ChartPie, ChevronDown, ChevronRight, ChevronsDown, CircleAlert, Funnel, Grid3x3, ListTree, Paintbrush, Table2, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Chart } from '@/components/charts/Chart'
import { FunnelChart } from '@/components/charts/FunnelChart'
import { PieChart } from '@/components/charts/PieChart'
import { Select } from '@/components/Form'
import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl'
import type { Bucket, ChartKind, ChartSignal, ColumnFormat, ReportView, ResultColumn, RunResult, ViewType } from '../types'
import { fillOf, formatOf, rangeOf, toneClass } from './formats'
import { ResultGrid } from './ResultGrid'
import { formatCell } from './resultWords'
import { chartShape, hierarchyShape, pivotShape, split, type HierarchyNode } from './shape'
import { anomalies, flagWords, forecast, HORIZON, MIN_FLAGS, MIN_FORECAST, nextDates, signalsApply, WINDOW } from './signals'

export const VIEW_LABEL: Record<ViewType, string> = { grid: 'Grid', chart: 'Chart', hierarchy: 'Hierarchy', pivot: 'Pivot' }
const VIEWS: SegmentOption<ViewType>[] = [
  { value: 'grid', label: 'Grid', icon: Table2 }, { value: 'chart', label: 'Chart', icon: ChartColumn },
  { value: 'hierarchy', label: 'Hierarchy', icon: ListTree }, { value: 'pivot', label: 'Pivot', icon: Grid3x3 },
]
const CHARTS: SegmentOption<ChartKind>[] = [
  { value: 'bar', label: 'Bars', icon: ChartColumn }, { value: 'line', label: 'Lines', icon: ChartLine }, { value: 'area', label: 'Area', icon: ChartArea },
  { value: 'stacked', label: 'Stacked', icon: ChartColumnStacked }, { value: 'stacked100', label: '100% Stacked', icon: ChartBarStacked },
  { value: 'combo', label: 'Combo', icon: ChartNoAxesCombined }, { value: 'pie', label: 'Pie', icon: ChartPie }, { value: 'funnel', label: 'Funnel', icon: Funnel },
]
/** a pie, a funnel or a combo reads the measures by one dimension: the series dimension does not apply */
const ONE_SERIES: ChartKind[] = ['pie', 'funnel', 'combo']
const percent = (value: number) => `${value.toFixed(1)}%`

export const DEFAULT_VIEW: ReportView = { type: 'grid' }

const SIGNALS: { value: ChartSignal; label: string; icon: typeof TrendingUp }[] = [
  { value: 'forecast', label: 'Forecast', icon: TrendingUp }, { value: 'anomalies', label: 'Flag Anomalies', icon: CircleAlert },
]


const number = (column: ResultColumn) => (value: number) => formatCell(column, value)

/** The view switch, the chart's kind, and for a chart or a pivot which dimension goes across: the controls above the result. */
export function ViewBar({ view, onChange, columns, dimensions, onFormat }: { view: ReportView; onChange: (next: ReportView) => void; columns?: ResultColumn[]; dimensions: { key: string; label: string }[]; onFormat?: () => void }) {
  const dims = columns ? columns.filter((column) => !column.aggregate).map((column) => ({ key: column.key, label: column.label })) : dimensions
  const acrossNeeded = (view.type === 'chart' && !ONE_SERIES.includes(view.chart ?? 'bar')) || view.type === 'pivot'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl label="View" options={VIEWS} value={view.type} onChange={(type) => onChange({ ...view, type })} />
      {view.type === 'chart' && <SegmentedControl label="Chart kind" options={CHARTS} value={view.chart ?? 'bar'} onChange={(chart) => onChange({ ...view, chart })} />}
      {acrossNeeded && (
        <label className="flex items-center gap-1.5 text-xs text-ink-800">
          <span>Across</span>
          <span className="w-40"><Select aria-label="Across" controlSize="sm" value={view.across ?? ''} onChange={(event) => onChange({ ...view, across: event.target.value || undefined })}>
            <option value="">{view.type === 'pivot' ? 'Choose a dimension' : 'Each value on its own'}</option>
            {dims.map((dim) => <option key={dim.key} value={dim.key}>{dim.label}</option>)}
          </Select></span>
        </label>
      )}
      {signalsApply(view) && (
        <div role="group" aria-label="Signals" className="flex items-center gap-1.5">
          {SIGNALS.map(({ value, label, icon: Icon }) => {
            const on = view.signals?.includes(value) ?? false
            const signals = on ? (view.signals ?? []).filter((item) => item !== value) : [...(view.signals ?? []), value]
            return (
              <button key={value} type="button" aria-pressed={on} onClick={() => onChange({ ...view, signals: signals.length ? signals : undefined })}
                className={`inline-flex h-8 items-center gap-1.5 rounded-control-md border px-2.5 text-xs font-semibold ${on ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>
                <Icon size={14} strokeWidth={1.5} aria-hidden />{label}
              </button>
            )
          })}
        </div>
      )}
      {onFormat && view.type !== 'chart' && (
        <button type="button" onClick={onFormat} className="inline-flex h-8 items-center gap-1.5 rounded-control-md border border-line bg-surface px-2.5 text-xs font-semibold text-ink-900 hover:bg-surface-hover">
          <Paintbrush size={14} strokeWidth={1.5} aria-hidden />Format Values{view.formats?.length ? ` · ${view.formats.length}` : ''}
        </button>
      )}
    </div>
  )
}

function Reason({ children, minHeight }: { children: string; minHeight: number }) {
  return <div className="flex items-center justify-center rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-800" style={{ minHeight }}>{children}</div>
}

/** The result in the chosen view. `onPick` (a dashboard's cross-filter) gets the dimension and the value clicked on a chart or a grid cell. */
export function ReportResult({ result, view, label = 'Report rows', minHeight = 360, onPick, onContext }: { result: RunResult; view: ReportView; label?: string; minHeight?: number; onPick?: (column: ResultColumn, value: unknown) => void; onContext?: (column: ResultColumn, value: unknown, at: { x: number; y: number }) => void }) {
  switch (view.type) {
    case 'chart': return <ReportChart result={result} view={view} minHeight={minHeight} onPick={onPick} onContext={onContext} />
    case 'hierarchy': return <Hierarchy result={result} label={label} minHeight={minHeight} formats={view.formats} onPick={onPick} />
    case 'pivot': return <Pivot result={result} view={view} label={label} minHeight={minHeight} onPick={onPick} />
    default: return <ResultGrid result={result} label={label} minHeight={minHeight} onPick={onPick} formats={view.formats} onContext={onContext} />
  }
}

function ReportChart({ result, view, minHeight, onPick, onContext }: { result: RunResult; view: ReportView; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void; onContext?: (column: ResultColumn, value: unknown, at: { x: number; y: number }) => void }) {
  const kind = view.chart ?? 'bar'
  const shape = useMemo(() => chartShape(result, ONE_SERIES.includes(kind) ? undefined : view.across), [result, view.across, kind])
  if (shape.reason) return <Reason minHeight={minHeight}>{shape.reason}</Reason>
  const title = `${shape.measure.label} by ${shape.categoryHeader}`
  const pick = onPick ? (index: number) => onPick(shape.axis, shape.categories[index].value) : undefined
  const context = onContext ? (index: number, at: { x: number; y: number }) => onContext(shape.axis, shape.categories[index].value, at) : undefined
  const first = shape.series[0]
  if (kind === 'combo' && shape.series.length < 2) return <Reason minHeight={minHeight}>A combo chart needs two values: the first as bars, the others as lines.</Reason>
  const measureOf = (key: string) => result.columns.find((column) => column.key === key && column.aggregate) ?? shape.measure
  const peak = (values: number[]) => Math.max(0, ...values.map((value) => Math.abs(value)))
  // a combo: the first value as bars; the others as lines, read on the right when their format or size differs from the bars'
  const comboSeries = kind === 'combo' ? shape.series.map((item, index) => {
    if (index === 0) return { ...item, mark: 'bar' as const }
    const column = measureOf(item.key)
    const ratio = peak(item.values) && peak(first.values) ? peak(item.values) / peak(first.values) : 1
    const right = column.format !== shape.measure.format || ratio > 4 || ratio < 0.25
    return { ...item, mark: 'line' as const, format: number(column), ...(right ? { axis: 'right' as const } : {}) }
  }) : null
  // 100% stacked: each category's series as their share of it
  const shareSeries = kind === 'stacked100' ? shape.series.map((item) => ({ ...item, values: item.values.map((value, index) => {
    const total = shape.series.reduce((sum, other) => sum + Math.max(0, other.values[index] || 0), 0)
    return total ? (Math.max(0, value) / total) * 100 : 0
  }) })) : null
  const signals = signalsApply(view) && view.signals?.length ? chartSignals(shape, view.signals) : null
  return (
    <div className="rounded-md border border-line p-4">
      {kind === 'pie' ? (
        <PieChart title={title} categoryHeader={shape.categoryHeader} valueLabel={shape.measure.label} height={Math.max(200, Math.min(280, minHeight - 120))} formatValue={number(shape.measure)} onSelect={pick} onContext={context}
          slices={shape.categories.map((category, index) => ({ key: category.key, label: category.label, value: first?.values[index] ?? 0 }))} />
      ) : kind === 'funnel' ? (
        <FunnelChart title={title} valueLabel={shape.measure.label} formatValue={number(shape.measure)} onSelect={pick} onContext={context}
          stages={shape.categories.map((category, index) => ({ key: category.key, label: category.label, value: first?.values[index] ?? 0 }))} />
      ) : (
        <Chart title={kind === 'stacked100' ? `${title}, as shares` : title} categoryHeader={shape.categoryHeader} categories={signals?.categories ?? shape.categories} series={signals?.series ?? comboSeries ?? shareSeries ?? shape.series}
          type={kind === 'line' || kind === 'area' ? kind : 'bar'} stacked={kind === 'stacked' || kind === 'stacked100'} height={Math.max(240, minHeight - 80)}
          formatValue={kind === 'stacked100' ? percent : number(shape.measure)} formatTick={kind === 'stacked100' ? (value) => `${Math.round(value)}%` : undefined}
          onSelect={pick ? (index) => { if (index < shape.categories.length) pick(index) } : undefined} onContext={context ? (index, at) => { if (index < shape.categories.length) context(index, at) } : undefined}
          reference={signals?.reference} flags={signals?.flags} />
      )}
      {signals && <p className="mt-3 text-xs text-ink-800">{signals.words}</p>}
    </div>
  )
}

type Shape = ReturnType<typeof chartShape>

/** the forecast line and the flags on the first series, when the chart runs along dates with a bucket: the categories and series
 * carried on for the forecast's periods (the series empty there), and a sentence on how they were worked out */
function chartSignals(shape: Shape, wanted: ChartSignal[]) {
  const bucket = shape.axis.bucket as Bucket | undefined
  const first = shape.series[0]
  if (!first || !bucket || (shape.axis.type !== 'date' && shape.axis.type !== 'datetime')) {
    return { categories: undefined, series: undefined, reference: undefined, flags: undefined, words: 'Forecasts and anomaly flags need dates along the bottom, grouped by day, week, month, quarter or year.' }
  }
  const words: string[] = []
  let categories = shape.categories
  let series = shape.series
  let reference
  if (wanted.includes('forecast')) {
    if (first.values.length < MIN_FORECAST) words.push(`A forecast needs ${MIN_FORECAST} periods or more.`)
    else {
      const last = shape.categories.at(-1)?.value
      const ahead = typeof last === 'string' ? nextDates(last, bucket) : []
      if (ahead.length) {
        categories = [...shape.categories, ...ahead.map((iso) => ({ key: `ahead-${iso}`, label: formatCell(shape.axis, iso), value: iso }))]
        series = shape.series.map((item) => ({ ...item, values: [...item.values, ...ahead.map(() => NaN)] }))
        reference = { key: 'forecast', label: `Forecast: ${first.label}`, values: forecast(first.values) }
        words.push(`The forecast carries the straight-line trend of the last ${Math.min(WINDOW, first.values.length)} ${bucket}s of ${first.label} ${HORIZON} ${bucket}s on; it is a trend, not a promise.`)
      }
    }
  }
  let flags
  if (wanted.includes('anomalies')) {
    if (first.values.length < MIN_FLAGS) words.push(`Flagging anomalies needs ${MIN_FLAGS} periods or more.`)
    else {
      const found = anomalies(first.values)
      flags = found.map((flag) => ({ index: flag.index, label: flagWords(flag) }))
      words.push(found.length ? `${found.length} ${found.length === 1 ? 'point sits' : 'points sit'} far off the trend of ${first.label}, ringed in red.` : `No point of ${first.label} sits far off its trend.`)
    }
  }
  return { categories, series, reference, flags, words: words.join(' ') }
}

const cell = 'cep-num px-3 text-right whitespace-nowrap'
const dash = '—'

function Hierarchy({ result, label, minHeight, formats, onPick }: { result: RunResult; label: string; minHeight: number; formats?: ColumnFormat[]; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const shape = useMemo(() => hierarchyShape(result), [result])
  const [allOpen, setAllOpen] = useState(false)
  const [toggled, setToggled] = useState<Set<string>>(() => new Set())
  if (shape.reason) return <Reason minHeight={minHeight}>{shape.reason}</Reason>
  const path = (node: HierarchyNode, parent: string) => `${parent}\u001f${node.key}`
  // the first level starts open and the rest closed; a click flips a group; Expand All opens everything, Collapse All closes the first level
  const show = (id: string, depth: number) => (allOpen ? !toggled.has(id) : (depth === 0) !== toggled.has(id))
  const toggle = (id: string) => setToggled((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const lines: { node: HierarchyNode; id: string; open: boolean }[] = []
  const walk = (nodes: HierarchyNode[], parent: string) => {
    for (const node of nodes) {
      const id = path(node, parent)
      const open = node.children.length > 0 && show(id, node.depth)
      lines.push({ node, id, open })
      if (open) walk(node.children, id)
    }
  }
  walk(shape.roots, '')
  const format = (column: ResultColumn, value: number | null) => (value === null ? dash : formatCell(column, value))
  const leafValues = (m: number) => { const out: unknown[] = []; const visit = (nodes: HierarchyNode[]) => nodes.forEach((n) => (n.children.length ? visit(n.children) : out.push(n.row?.[m]))); visit(shape.roots); return out }
  const ranges = shape.measures.map((measure, m) => (formatOf(formats, measure.key) ? rangeOf(leafValues(m)) : null))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-ink-800">
        <span>{shape.levels.map((level) => level.label).join(', then ')}</span>
        <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => { setAllOpen(true); setToggled(new Set()) }}>Expand All</button>
        <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => { setAllOpen(false); setToggled(new Set(shape.roots.map((node) => path(node, '')))) }}>Collapse All</button>
      </div>
      <div className="overflow-x-auto rounded-md border border-line" role="region" aria-label={label} style={{ minHeight }}>
        <table className="min-w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead className="bg-surface-subtle text-xs text-ink-800">
            <tr className="h-9 border-b border-line">
              <th scope="col" className="px-3 text-left font-semibold">{shape.levels.map((level) => level.label).join(' / ')}</th>
              {shape.measures.map((measure) => <th key={measure.key} scope="col" className="px-3 text-right font-semibold">{measure.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ node, id, open }) => {
              const group = node.children.length > 0
              return (
                <tr key={id} className={`h-9 border-b border-line-subtle ${group ? 'bg-surface-subtle/60 font-medium text-ink-900' : 'text-ink-900'}`}>
                  <td className="px-3" style={{ paddingLeft: 12 + node.depth * 20 }}>
                    {group ? (
                      <button type="button" aria-expanded={open} onClick={() => toggle(id)} className="inline-flex items-center gap-1 text-left hover:text-brand-800">
                        {open ? <ChevronDown size={14} strokeWidth={1.5} aria-hidden /> : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
                        {node.label}
                        {!open && <span className="ml-1 text-xs font-normal text-ink-700">{node.children.length} {node.children.length === 1 ? 'item' : 'items'}</span>}
                      </button>
                    ) : <span className="inline-flex items-center gap-1"><span className="inline-block w-3.5" aria-hidden />{node.label}</span>}
                    {group && node.depth === 0 && onPick && (
                      <button type="button" aria-label={`Drill into ${node.label}`} onClick={() => onPick(shape.levels[0], node.value)} className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-control-sm text-ink-700 align-middle hover:bg-surface-hover hover:text-brand-800">
                        <ChevronsDown size={13} strokeWidth={1.5} aria-hidden />
                      </button>
                    )}
                  </td>
                  {shape.measures.map((measure, m) => {
                    const rule = group ? undefined : formatOf(formats, measure.key)
                    return <td key={measure.key} className={`${cell} ${toneClass(rule, node.row?.[m])}`} style={group ? undefined : fillOf(rule, node.row?.[m], ranges[m])}>{group ? format(measure, node.totals[m]) : formatCell(measure, node.row?.[m])}</td>
                  })}
                </tr>
              )
            })}
            <tr className="h-9 border-t border-line font-semibold text-ink-900">
              <td className="px-3">Total</td>
              {shape.measures.map((measure, m) => <td key={measure.key} className={cell}>{format(measure, shape.grand[m])}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Pivot({ result, view, label, minHeight, onPick }: { result: RunResult; view: ReportView; label: string; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const { meas } = split(result, view.across)
  const [measureKey, setMeasureKey] = useState<string | undefined>(undefined)
  const shape = useMemo(() => pivotShape(result, view.across, measureKey), [result, view.across, measureKey])
  if (shape.reason) return <Reason minHeight={minHeight}>{shape.reason}</Reason>
  const format = (value: number | null) => (value === null ? dash : formatCell(shape.measure, value))
  const rule = formatOf(view.formats, shape.measure.key)
  const range = rule ? rangeOf(shape.rows.flatMap((row) => row.cells)) : null
  const edge = 'border-l border-line'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-ink-800">
        <span>{shape.measure.label} · {shape.rowHeader} down, {result.columns.find((column) => column.key === view.across)?.label} across</span>
        {meas.length > 1 && (
          <span className="w-40"><Select aria-label="Pivot value" controlSize="sm" value={shape.measure.key} onChange={(event) => setMeasureKey(event.target.value)}>
            {meas.map(({ column }) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </Select></span>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-line" role="region" aria-label={label} style={{ minHeight }}>
        <table className="min-w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead className="bg-surface-subtle text-xs text-ink-800">
            <tr className="h-9 border-b border-line">
              <th scope="col" className="px-3 text-left font-semibold whitespace-nowrap">{shape.rowHeader}</th>
              {shape.columns.map((column) => <th key={column.key} scope="col" className="px-3 text-right font-semibold whitespace-nowrap">{column.label}</th>)}
              <th scope="col" className={`px-3 text-right font-semibold ${edge}`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {shape.rows.map((row) => (
              <tr key={row.key} className="h-9 border-b border-line-subtle text-ink-900">
                <th scope="row" className="px-3 text-left font-normal whitespace-nowrap">
                  {onPick && shape.rowColumn ? <button type="button" className="text-left hover:text-brand-800 hover:underline" onClick={() => onPick(shape.rowColumn as ResultColumn, row.value)}>{row.label}</button> : row.label}
                </th>
                {row.cells.map((value, c) => <td key={shape.columns[c].key} className={`${cell} ${toneClass(rule, value)}`} style={fillOf(rule, value, range)}>{format(value)}</td>)}
                <td className={`${cell} ${edge} font-semibold`}>{format(row.total)}</td>
              </tr>
            ))}
            <tr className="h-9 border-t border-line font-semibold text-ink-900">
              <td className="px-3">Total</td>
              {shape.columnTotals.map((value, c) => <td key={shape.columns[c].key} className={cell}>{format(value)}</td>)}
              <td className={`${cell} ${edge}`}>{format(shape.grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
