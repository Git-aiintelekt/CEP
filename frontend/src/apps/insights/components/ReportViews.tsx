/**
 * The four views of one report, and the bar that switches them. Grid: the rows (ResultGrid). Chart: the chart kit on the
 * first dimension, one series per value of the dimension across, else one per measure; a pie or a funnel of the first
 * measure by the first dimension. Hierarchy: the dimensions as
 * levels that fold, with subtotals. Pivot: the dimension across as columns, one measure in the cells, totals on both
 * edges. Any report switches between them without losing its fields; the chosen view and its settings save with the
 * definition (`view`).
 */
import { ChartArea, ChartColumn, ChartLine, ChartPie, ChevronDown, ChevronRight, Funnel, Grid3x3, ListTree, Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Chart } from '@/components/charts/Chart'
import { FunnelChart } from '@/components/charts/FunnelChart'
import { PieChart } from '@/components/charts/PieChart'
import { Select } from '@/components/Form'
import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl'
import type { ChartKind, ReportView, ResultColumn, RunResult, ViewType } from '../types'
import { ResultGrid } from './ResultGrid'
import { formatCell } from './resultWords'
import { chartShape, hierarchyShape, pivotShape, split, type HierarchyNode } from './shape'

export const VIEW_LABEL: Record<ViewType, string> = { grid: 'Grid', chart: 'Chart', hierarchy: 'Hierarchy', pivot: 'Pivot' }
const VIEWS: SegmentOption<ViewType>[] = [
  { value: 'grid', label: 'Grid', icon: Table2 }, { value: 'chart', label: 'Chart', icon: ChartColumn },
  { value: 'hierarchy', label: 'Hierarchy', icon: ListTree }, { value: 'pivot', label: 'Pivot', icon: Grid3x3 },
]
const CHARTS: SegmentOption<ChartKind>[] = [
  { value: 'bar', label: 'Bars', icon: ChartColumn }, { value: 'line', label: 'Lines', icon: ChartLine }, { value: 'area', label: 'Area', icon: ChartArea },
  { value: 'pie', label: 'Pie', icon: ChartPie }, { value: 'funnel', label: 'Funnel', icon: Funnel },
]
/** a pie or a funnel takes one measure by one dimension: the series dimension does not apply */
const ONE_SERIES: ChartKind[] = ['pie', 'funnel']

export const DEFAULT_VIEW: ReportView = { type: 'grid' }

const number = (column: ResultColumn) => (value: number) => formatCell(column, value)

/** The view switch, the chart's kind, and for a chart or a pivot which dimension goes across: the controls above the result. */
export function ViewBar({ view, onChange, columns, dimensions }: { view: ReportView; onChange: (next: ReportView) => void; columns?: ResultColumn[]; dimensions: { key: string; label: string }[] }) {
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
    </div>
  )
}

function Reason({ children, minHeight }: { children: string; minHeight: number }) {
  return <div className="flex items-center justify-center rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-800" style={{ minHeight }}>{children}</div>
}

/** The result in the chosen view. `onPick` (a dashboard's cross-filter) gets the dimension and the value clicked on a chart or a grid cell. */
export function ReportResult({ result, view, label = 'Report rows', minHeight = 360, onPick: pickAny }: { result: RunResult; view: ReportView; label?: string; minHeight?: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  // a date, bucketed or not, is the period's business, not a slicer's: only text, yes/no and number dimensions can be picked
  const onPick = pickAny ? (column: ResultColumn, value: unknown) => { if (!column.bucket && column.type !== 'date' && column.type !== 'datetime' && value !== null && value !== undefined) pickAny(column, value) } : undefined
  switch (view.type) {
    case 'chart': return <ReportChart result={result} view={view} minHeight={minHeight} onPick={onPick} />
    case 'hierarchy': return <Hierarchy result={result} label={label} minHeight={minHeight} />
    case 'pivot': return <Pivot result={result} view={view} label={label} minHeight={minHeight} />
    default: return <ResultGrid result={result} label={label} minHeight={minHeight} onPick={onPick} />
  }
}

function ReportChart({ result, view, minHeight, onPick }: { result: RunResult; view: ReportView; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const kind = view.chart ?? 'bar'
  const shape = useMemo(() => chartShape(result, ONE_SERIES.includes(kind) ? undefined : view.across), [result, view.across, kind])
  if (shape.reason) return <Reason minHeight={minHeight}>{shape.reason}</Reason>
  const title = `${shape.measure.label} by ${shape.categoryHeader}`
  const pick = onPick ? (index: number) => onPick(shape.axis, shape.categories[index].value) : undefined
  const first = shape.series[0]
  return (
    <div className="rounded-md border border-line p-4">
      {kind === 'pie' ? (
        <PieChart title={title} categoryHeader={shape.categoryHeader} valueLabel={shape.measure.label} height={Math.max(200, Math.min(280, minHeight - 120))} formatValue={number(shape.measure)} onSelect={pick}
          slices={shape.categories.map((category, index) => ({ key: category.key, label: category.label, value: first?.values[index] ?? 0 }))} />
      ) : kind === 'funnel' ? (
        <FunnelChart title={title} valueLabel={shape.measure.label} formatValue={number(shape.measure)} onSelect={pick}
          stages={shape.categories.map((category, index) => ({ key: category.key, label: category.label, value: first?.values[index] ?? 0 }))} />
      ) : (
        <Chart title={title} categoryHeader={shape.categoryHeader} categories={shape.categories} series={shape.series} type={kind} height={Math.max(240, minHeight - 80)} formatValue={number(shape.measure)} onSelect={pick} />
      )}
    </div>
  )
}

const cell = 'cep-num px-3 text-right whitespace-nowrap'
const dash = '—'

function Hierarchy({ result, label, minHeight }: { result: RunResult; label: string; minHeight: number }) {
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
                  </td>
                  {shape.measures.map((measure, m) => <td key={measure.key} className={cell}>{group ? format(measure, node.totals[m]) : formatCell(measure, node.row?.[m])}</td>)}
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

function Pivot({ result, view, label, minHeight }: { result: RunResult; view: ReportView; label: string; minHeight: number }) {
  const { meas } = split(result, view.across)
  const [measureKey, setMeasureKey] = useState<string | undefined>(undefined)
  const shape = useMemo(() => pivotShape(result, view.across, measureKey), [result, view.across, measureKey])
  if (shape.reason) return <Reason minHeight={minHeight}>{shape.reason}</Reason>
  const format = (value: number | null) => (value === null ? dash : formatCell(shape.measure, value))
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
                <th scope="row" className="px-3 text-left font-normal whitespace-nowrap">{row.label}</th>
                {row.cells.map((value, c) => <td key={shape.columns[c].key} className={cell}>{format(value)}</td>)}
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
