/**
 * The four views of one report, and the bar that switches them. Grid: the rows (ResultGrid). Chart: the chart kit on the
 * first dimension, one series per value of the dimension across, else one per measure; a pie or a funnel of the first
 * measure by the first dimension. Hierarchy: the dimensions as
 * levels that fold, with subtotals. Pivot: the dimension across as columns, one measure in the cells, totals on both
 * edges. Any report switches between them without losing its fields; the chosen view and its settings save with the
 * definition (`view`).
 */
import { ChartArea, ChartBarStacked, ChartColumn, ChartColumnStacked, ChartLine, ChartNoAxesCombined, ChartPie, ChartColumnDecreasing, ChartScatter, ChevronDown, ChevronRight, ChevronsDown, CircleAlert, CircleDot, Funnel, Gauge as GaugeIcon, Grid3x3, LayoutGrid, Lightbulb, ListTree, Map as MapIcon, Network, Paintbrush, SlidersHorizontal, Table2, Target, TrendingUp } from 'lucide-react'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'

import { Chart } from '@/components/charts/Chart'
import { FunnelChart } from '@/components/charts/FunnelChart'
import { PieChart } from '@/components/charts/PieChart'
import { Select, TextInput } from '@/components/Form'
import { SingleSelectMenu, type MenuOption } from '@/components/FilterChip'
import { Popover } from '@/components/Popover'
import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl'
import { Switch } from '@/components/Switch'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { TooltipReport } from './TooltipReport'
import type { AnalysisSource, Bucket, ChartKind, ChartSignal, ColumnFormat, ReportView, ResultColumn, RunResult, ViewType } from '../types'
import { DecompositionTree } from '../visuals/DecompositionTree'
import { Gauge, KpiCard } from '../visuals/Figures'
import { Influencers } from '../visuals/Influencers'
import { ScatterChart } from '../visuals/ScatterChart'
import { Sparkline } from '../visuals/Sparkline'
import { Treemap } from '../visuals/Treemap'
import { Waterfall } from '../visuals/Waterfall'
import { fillOf, formatOf, rangeOf, toneClass } from './formats'
import { ResultGrid } from './ResultGrid'
import { formatCell } from './resultWords'
import { chartShape, distinct, hierarchyShape, pivotShape, split, type HierarchyNode } from './shape'
import { anomalies, flagWords, forecast, HORIZON, MIN_FLAGS, MIN_FORECAST, nextDates, signalsApply, WINDOW } from './signals'

export const VIEW_LABEL: Record<ViewType, string> = { grid: 'Grid', chart: 'Chart', hierarchy: 'Hierarchy', pivot: 'Pivot', influencers: 'Key Influencers', decomposition: 'Decomposition Tree' }
const VIEWS: SegmentOption<ViewType>[] = [
  { value: 'grid', label: 'Grid', icon: Table2 }, { value: 'chart', label: 'Chart', icon: ChartColumn },
  { value: 'hierarchy', label: 'Hierarchy', icon: ListTree }, { value: 'pivot', label: 'Pivot', icon: Grid3x3 },
]
/** the analysing views, picked from Analyse; the one in use joins the switch */
const ANALYSE: SegmentOption<ViewType>[] = [{ value: 'influencers', label: 'Key Influencers', icon: Lightbulb }, { value: 'decomposition', label: 'Decomposition Tree', icon: Network }]
/** the charts past the eight in the switch */
const MORE_CHARTS: SegmentOption<ChartKind>[] = [
  { value: 'scatter', label: 'Scatter', icon: ChartScatter }, { value: 'bubble', label: 'Bubble', icon: CircleDot }, { value: 'treemap', label: 'Treemap', icon: LayoutGrid },
  { value: 'waterfall', label: 'Waterfall', icon: ChartColumnDecreasing }, { value: 'kpi', label: 'KPI Card', icon: Target }, { value: 'gauge', label: 'Gauge', icon: GaugeIcon },
  { value: 'map', label: 'Map', icon: MapIcon },
]
const MULTIPLE_KINDS: ChartKind[] = ['bar', 'line', 'area', 'stacked', 'stacked100', 'pie']
const MapChart = lazy(() => import('../visuals/MapChart').then((m) => ({ default: m.MapChart })))
const CHARTS: SegmentOption<ChartKind>[] = [
  { value: 'bar', label: 'Bars', icon: ChartColumn }, { value: 'line', label: 'Lines', icon: ChartLine }, { value: 'area', label: 'Area', icon: ChartArea },
  { value: 'stacked', label: 'Stacked', icon: ChartColumnStacked }, { value: 'stacked100', label: '100% Stacked', icon: ChartBarStacked },
  { value: 'combo', label: 'Combo', icon: ChartNoAxesCombined }, { value: 'pie', label: 'Pie', icon: ChartPie }, { value: 'funnel', label: 'Funnel', icon: Funnel },
]
/** a pie, a funnel or a combo reads the measures by one dimension: the series dimension does not apply */
const ONE_SERIES: ChartKind[] = ['pie', 'funnel', 'combo', 'scatter', 'bubble', 'treemap', 'waterfall', 'gauge', 'kpi', 'map']
const percent = (value: number) => `${value.toFixed(1)}%`

export const DEFAULT_VIEW: ReportView = { type: 'grid' }

const SIGNALS: { value: ChartSignal; label: string; icon: typeof TrendingUp }[] = [
  { value: 'forecast', label: 'Forecast', icon: TrendingUp }, { value: 'anomalies', label: 'Flag Anomalies', icon: CircleAlert },
]


const number = (column: ResultColumn) => (value: number) => formatCell(column, value)

/** the chart kinds, in the Chart Type menu's three groups of five */
const KIND_GROUPS: { label: string; kinds: ChartKind[] }[] = [
  { label: 'Compare', kinds: ['bar', 'line', 'area', 'combo', 'scatter'] },
  { label: 'Parts of a Whole', kinds: ['stacked', 'stacked100', 'pie', 'treemap', 'funnel'] },
  { label: 'More Charts', kinds: ['kpi', 'gauge', 'waterfall', 'bubble', 'map'] },
]
const KIND = new Map([...CHARTS, ...MORE_CHARTS].map((item) => [item.value, item]))
const BAR_BUTTON = 'inline-flex h-8 items-center gap-1.5 rounded-control-md border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors duration-fast ease-standard'
const barButton = (on = false) => `${BAR_BUTTON} ${on ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`

/** a toolbar button that opens a small menu under it */
function BarMenu({ label, text, icon: Icon, count = 0, align = 'start', width, children }: { label: string; text: ReactNode; icon?: typeof Table2; count?: number; align?: 'start' | 'end'; width?: number; children: (close: () => void) => ReactNode }) {
  const menus = useSingleDropdown<'menu'>()
  const open = menus.isOpen('menu')
  return (
    <span className="relative inline-flex">
      <button type="button" {...menus.triggerProps('menu')} aria-label={count ? `${label} · ${count} on` : label} className={barButton(open)}>
        {Icon && <Icon size={14} strokeWidth={1.5} aria-hidden />}{text}
        {count > 0 && <span aria-hidden className="cep-num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-xs text-on-brand">{count}</span>}
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden className={`transition-transform duration-fast ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <Popover {...menus.panelProps('menu')} label={label} placement={align === 'end' ? 'bottom-end' : 'bottom-start'} width={width}>{children(() => menus.close())}</Popover>}
    </span>
  )
}

/** a choice in the toolbar, looking like Show and Analyse: "Across Placed", its menu the options */
function BarChoice<V extends string>({ label, name = label, value, options, onChange }: { label: string; /** the accessible name, when it says more than the label */ name?: string; value: V; options: MenuOption<V>[]; onChange: (value: V) => void }) {
  const chosen = options.find((option) => option.value === value)?.label ?? ''
  return (
    <BarMenu label={`${name}: ${chosen}`} text={<><span className="font-normal text-ink-800">{label}</span>{chosen}</>} width={260}>
      {(close) => <SingleSelectMenu label={name} options={options} value={value} onChange={(next) => { onChange(next); close() }} />}
    </BarMenu>
  )
}

function MenuSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return <div className="flex min-h-9 items-center justify-between gap-3 px-3 py-1.5 text-sm text-ink-900"><span>{label}</span><Switch ariaLabel={label} checked={checked} onChange={onChange} /></div>
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex items-center gap-1.5 text-xs text-ink-800"><span>{label}</span>{children}</label>
}

/**
 * The result's toolbar, the same three slots in every view: the view switch; then what shapes the view (the chart's
 * type, Across, Target, Map Of; a pivot's Across and Value; what Key Influencers explains or the tree splits); then Show
 * (what can be switched on: Forecast, Flag Anomalies and Repeat By for a chart, All Values and Trend Column for a pivot,
 * with a count of those on), a hierarchy's Expand All and Collapse All, Format Values in the editor, and Analyse.
 */
export function ViewBar({ view, onChange, columns, dimensions, onFormat, onFold }: { view: ReportView; onChange: (next: ReportView) => void; columns?: ResultColumn[]; dimensions: { key: string; label: string }[]; onFormat?: () => void
  /** a hierarchy's Expand All (true) and Collapse All (false) */
  onFold?: (open: boolean) => void }) {
  const dims = columns ? columns.filter((column) => !column.aggregate).map((column) => ({ key: column.key, label: column.label })) : dimensions
  const values = (columns ?? []).filter((column) => column.aggregate && !column.compare)
  const kind = view.chart ?? 'bar'
  const shown = KIND.get(kind) ?? CHARTS[0]
  const without = (key: keyof ReportView) => { const { [key]: _gone, ...rest } = view; return rest as ReportView }
  const acrossNeeded = (view.type === 'chart' && !ONE_SERIES.includes(kind)) || view.type === 'pivot'
  const repeat = view.type === 'chart' && MULTIPLE_KINDS.includes(kind) && dims.length > 1
  const signals = signalsApply(view)
  const showCount = view.type === 'chart' ? (view.signals?.length ?? 0) + (view.multiples ? 1 : 0) : view.type === 'pivot' ? Number(Boolean(view.matrix)) + Number(Boolean(view.sparklines)) : 0
  const showMenu = (view.type === 'chart' && (signals || repeat)) || view.type === 'pivot'
  const toggleSignal = (value: ChartSignal) => {
    const on = view.signals?.includes(value) ?? false
    const next = on ? (view.signals ?? []).filter((item) => item !== value) : [...(view.signals ?? []), value]
    onChange({ ...view, signals: next.length ? next : undefined })
  }
  const middle: ReactNode[] = []
  if (view.type === 'chart') {
    middle.push(
      <BarMenu key="kind" label="Chart type" text={shown.label} icon={shown.icon} width={420}>
        {(close) => (
          <div className="flex flex-col gap-1 p-2">
            {KIND_GROUPS.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <p className="px-1 pt-1 pb-1.5 text-xs font-semibold text-ink-800">{group.label}</p>
                <div className="grid grid-cols-5 gap-1">
                  {group.kinds.map((value) => {
                    const item = KIND.get(value)!
                    const Icon = item.icon ?? ChartColumn
                    const on = value === kind
                    return (
                      <button key={value} type="button" aria-pressed={on} onClick={() => { onChange({ ...view, chart: value }); close() }}
                        className={`flex h-16 flex-col items-center justify-center gap-1.5 rounded-md px-1 text-center text-xs leading-tight ${on ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-800 hover:bg-surface-hover'}`}>
                        <Icon size={20} strokeWidth={1.5} aria-hidden />{item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </BarMenu>,
    )
  }
  if (acrossNeeded) {
    middle.push(
      <BarChoice key="across" label="Across" value={view.across ?? ''} onChange={(across) => onChange({ ...view, across: across || undefined })}
        options={[{ value: '', label: view.type === 'pivot' ? 'Choose a Dimension' : 'Each Value on Its Own' }, ...dims.map((dim) => ({ value: dim.key, label: dim.label }))]} />,
    )
  }
  if (view.type === 'pivot' && !view.matrix && values.length > 1) {
    middle.push(
      <BarChoice key="value" label="Value" name="Pivot value" value={view.measure ?? values[0].key} onChange={(measure) => onChange({ ...view, measure })}
        options={values.map((value) => ({ value: value.key, label: value.label }))} />,
    )
  }
  if (view.type === 'chart' && (kind === 'kpi' || kind === 'gauge')) {
    middle.push(
      <Labelled key="target" label="Target">
        <span className="w-28"><TextInput aria-label="Target" controlSize="sm" type="number" step="any" value={view.target ?? ''}
          onChange={(event) => onChange(event.target.value === '' || !Number.isFinite(Number(event.target.value)) ? without('target') : { ...view, target: Number(event.target.value) })} /></span>
      </Labelled>,
    )
  }
  if (view.type === 'chart' && kind === 'map') {
    middle.push(
      <BarChoice key="geo" label="Map Of" value={view.geo ?? 'auto'} onChange={(geo) => onChange(geo === 'auto' ? without('geo') : { ...view, geo: geo as 'us' | 'world' })}
        options={[{ value: 'auto', label: 'Worked Out' }, { value: 'us', label: 'US States' }, { value: 'world', label: 'Countries' }]} />,
    )
  }
  if ((view.type === 'influencers' || view.type === 'decomposition') && values.length > 1) {
    middle.push(
      <BarChoice key="measure" label={view.type === 'influencers' ? 'Explain' : 'Split'} name={view.type === 'influencers' ? 'Value to explain' : 'Value to split'} value={view.measure ?? values[0].key}
        onChange={(measure) => onChange({ ...view, measure })} options={values.map((value) => ({ value: value.key, label: value.label }))} />,
    )
  }
  return (
    <div role="toolbar" aria-label="Report view" className="flex flex-wrap items-center gap-2">
      <SegmentedControl label="View" options={[...VIEWS, ...ANALYSE.filter((item) => item.value === view.type)]} value={view.type} onChange={(type) => onChange({ ...view, type })} />
      {middle.length > 0 && <span aria-hidden className="mx-1 h-6 w-px bg-line-subtle" />}
      {middle}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {showMenu && (
          <BarMenu label="Show" text="Show" icon={SlidersHorizontal} count={showCount} align="end" width={280}>
            {() => (
              <div className="py-1">
                {view.type === 'chart' && signals && SIGNALS.map(({ value, label }) => <MenuSwitch key={value} label={label} checked={view.signals?.includes(value) ?? false} onChange={() => toggleSignal(value)} />)}
                {view.type === 'chart' && repeat && (
                  <label className="flex min-h-9 items-center justify-between gap-3 px-3 py-1.5 text-sm text-ink-900">
                    <span>Repeat By</span>
                    <span className="w-36"><Select aria-label="Repeat by" controlSize="sm" value={view.multiples ?? ''} onChange={(event) => onChange(event.target.value ? { ...view, multiples: event.target.value } : without('multiples'))}>
                      <option value="">One Chart</option>
                      {dims.filter((dim) => dim.key !== view.across).map((dim) => <option key={dim.key} value={dim.key}>{dim.label}</option>)}
                    </Select></span>
                  </label>
                )}
                {view.type === 'chart' && signals && <p className="px-3 pt-1 pb-2 text-helper text-ink-800">Forecast and Flag Anomalies read the first value along dates.</p>}
                {view.type === 'pivot' && <>
                  <MenuSwitch label="All Values" checked={Boolean(view.matrix)} onChange={(on) => onChange(on ? { ...view, matrix: true } : without('matrix'))} />
                  <MenuSwitch label="Trend Column" checked={Boolean(view.sparklines)} onChange={(on) => onChange(on ? { ...view, sparklines: true } : without('sparklines'))} />
                </>}
              </div>
            )}
          </BarMenu>
        )}
        {view.type === 'hierarchy' && onFold && <>
          <button type="button" className={barButton()} onClick={() => onFold(true)}>Expand All</button>
          <button type="button" className={barButton()} onClick={() => onFold(false)}>Collapse All</button>
        </>}
        {onFormat && view.type !== 'chart' && (
          <button type="button" onClick={onFormat} className={barButton()}>
            <Paintbrush size={14} strokeWidth={1.5} aria-hidden />Format Values{view.formats?.length ? ` · ${view.formats.length}` : ''}
          </button>
        )}
        <BarMenu label="Analyse" text="Analyse" align="end" width={240}>
          {(close) => (
            <ul className="py-1">
              {ANALYSE.map((item) => {
                const Icon = item.icon ?? Lightbulb
                return (
                  <li key={item.value}>
                    <button type="button" aria-pressed={view.type === item.value} onClick={() => { onChange({ ...view, type: item.value }); close() }}
                      className={`flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm ${view.type === item.value ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}>
                      <Icon size={16} strokeWidth={1.5} aria-hidden />{item.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </BarMenu>
      </div>
    </div>
  )
}

function Reason({ children, minHeight }: { children: string; minHeight: number }) {
  return <div className="flex items-center justify-center rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-800" style={{ minHeight }}>{children}</div>
}

/** The result in the chosen view. `onPick` (a dashboard's cross-filter) gets the dimension and the value clicked on a chart or a grid cell;
 * `analysis` is where Key Influencers and the Decomposition Tree read from (the saved report, or the editor's draft). */
export function ReportResult({ result, view, label = 'Report rows', minHeight = 360, onPick, onContext, analysis, notes, tooltips = false, inCard = false, fold }: { result: RunResult; view: ReportView; label?: string; minHeight?: number; onPick?: (column: ResultColumn, value: unknown) => void; onContext?: (column: ResultColumn, value: unknown, at: { x: number; y: number }) => void; analysis?: AnalysisSource
  /** comments pinned to values: a chart marks them */
  notes?: Note[]
  /** a chart's tooltip report shows on hover (the viewer and dashboards) */
  tooltips?: boolean
  /** inside a ResultCard: the toolbar holds a pivot's Value and a hierarchy's Expand All, the footer their captions, and a chart drops its own frame */
  inCard?: boolean
  /** a hierarchy's last Expand All (open) or Collapse All, counted so each press applies again */
  fold?: { open: boolean; count: number } }) {
  switch (view.type) {
    case 'chart': return view.multiples ? <SmallMultiples result={result} view={view} minHeight={minHeight} onPick={onPick} /> : <ReportChart result={result} view={view} minHeight={minHeight} onPick={onPick} onContext={onContext} notes={notes} tooltips={tooltips} bare={inCard} />
    case 'influencers': return <Influencers source={analysis} view={view} result={result} minHeight={Math.min(minHeight, 280)} />
    case 'decomposition': return <DecompositionTree key={view.measure ?? ''} source={analysis} view={view} result={result} minHeight={Math.min(minHeight, 280)} />
    case 'hierarchy': return <Hierarchy key={fold?.count ?? 0} result={result} label={label} minHeight={minHeight} formats={view.formats} onPick={onPick} inCard={inCard} folded={fold ? (fold.open ? 'open' : 'closed') : null} />
    case 'pivot': return <Pivot result={result} view={view} label={label} minHeight={minHeight} onPick={onPick} inCard={inCard} />
    default: return <ResultGrid result={result} label={label} minHeight={minHeight} onPick={onPick} formats={view.formats} onContext={onContext} />
  }
}

/** a comment pinned to one value of a field */
export interface Note { field: string; value: unknown; label: string }

const PANELS = 12
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

/** the chart repeated per value of a dimension, every panel on one scale */
function SmallMultiples({ result, view, minHeight, onPick }: { result: RunResult; view: ReportView; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const at = result.columns.findIndex((column) => column.key === view.multiples)
  const one = { ...view, multiples: undefined }
  const panels = useMemo(() => (at < 0 ? [] : distinct(result, at).map((value) => ({
    value, label: formatCell(result.columns[at], value),
    result: { ...result, totals: undefined, columns: result.columns.filter((_, i) => i !== at), rows: result.rows.filter((row) => same(row[at], value)).map((row) => row.filter((_, i) => i !== at)) },
  }))), [result, at])
  if (at < 0) return <ReportChart result={result} view={one} minHeight={minHeight} onPick={onPick} />
  const kind = view.chart ?? 'bar'
  const top = kind === 'pie' || kind === 'stacked100' ? undefined : Math.max(0, ...panels.slice(0, PANELS).flatMap((panel) => {
    const shape = chartShape(panel.result, view.across)
    return kind === 'stacked' ? shape.categories.map((_, i) => shape.series.reduce((sum, s) => sum + Math.max(0, s.values[i] || 0), 0)) : shape.series.flatMap((s) => s.values)
  }))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-800">One chart per {result.columns[at].label}{panels.length > PANELS ? `; the first ${PANELS} of ${panels.length}` : ''}, all on one scale.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {panels.slice(0, PANELS).map((panel) => (
          <section key={String(panel.value ?? '')} aria-label={panel.label} data-multiple className="flex min-w-0 flex-col gap-1">
            <h3 className="truncate text-xs font-semibold text-ink-900">{panel.label}</h3>
            <ReportChart result={panel.result} view={one} minHeight={260} onPick={onPick} yMax={top} compact />
          </section>
        ))}
      </div>
    </div>
  )
}

function ReportChart({ result, view, minHeight, onPick, onContext, yMax, compact = false, notes = [], tooltips = false, bare = false }: { result: RunResult; view: ReportView; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void; onContext?: (column: ResultColumn, value: unknown, at: { x: number; y: number }) => void; yMax?: number; compact?: boolean; notes?: Note[]; tooltips?: boolean
  /** no frame of its own: the card around it is the frame */
  bare?: boolean }) {
  const frame = bare ? '' : 'rounded-md border border-line p-4'
  const kind = view.chart ?? 'bar'
  const shape = useMemo(() => chartShape(result, ONE_SERIES.includes(kind) ? undefined : view.across), [result, view.across, kind])
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null)
  if (kind === 'scatter' || kind === 'bubble') return <div className={frame}><ScatterChart result={result} bubble={kind === 'bubble'} minHeight={minHeight} onPick={onPick} /></div>
  if (kind === 'treemap') return <div className={frame}><Treemap result={result} minHeight={minHeight} onPick={onPick} /></div>
  if (kind === 'waterfall') return <div className={frame}><Waterfall result={result} minHeight={minHeight} onPick={onPick} /></div>
  if (kind === 'kpi') return <KpiCard result={result} view={view} minHeight={minHeight} />
  if (kind === 'gauge') return <div className={frame}><Gauge result={result} view={view} minHeight={minHeight} /></div>
  if (kind === 'map') return <div className={frame}><Suspense fallback={<div className="text-sm text-ink-800" style={{ minHeight }}>Loading the map…</div>}><MapChart result={result} view={view} minHeight={minHeight} onPick={onPick} /></Suspense></div>
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
  const marks = notes.filter((note) => note.field === shape.axis.key).flatMap((note) => {
    const index = shape.categories.findIndex((category) => String(category.value ?? '') === String(note.value ?? ''))
    return index < 0 ? [] : [{ index, label: note.label }]
  })
  const tooltipId = tooltips ? view.tooltip : undefined
  return (
    <div className={`relative ${bare ? '' : `rounded-md border border-line ${compact ? 'p-2' : 'p-4'}`}`}>
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
          reference={signals?.reference} flags={signals?.flags} yMax={yMax} legend={compact && shape.series.length < 2 ? 'none' : 'top'} notes={marks}
          onActive={tooltipId ? (index, x) => setHover(index === null || index >= shape.categories.length ? null : { index, x }) : undefined} />
      )}
      {tooltipId && hover && (
        <TooltipReport key={`${tooltipId}:${hover.index}`} reportId={tooltipId} field={shape.axis.key} value={shape.categories[hover.index].value} valueWords={shape.categories[hover.index].label} x={hover.x} />
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

const path = (node: HierarchyNode, parent: string) => `${parent}\u001f${node.key}`

/** `folded`: the toolbar's last Expand All ('open') or Collapse All ('closed'); the hierarchy starts again from it */
function Hierarchy({ result, label, minHeight, formats, onPick, inCard = false, folded = null }: { result: RunResult; label: string; minHeight: number; formats?: ColumnFormat[]; onPick?: (column: ResultColumn, value: unknown) => void; inCard?: boolean; folded?: 'open' | 'closed' | null }) {
  const shape = useMemo(() => hierarchyShape(result), [result])
  const [allOpen, setAllOpen] = useState(folded === 'open')
  const [toggled, setToggled] = useState<Set<string>>(() => new Set(folded === 'closed' ? shape.roots.map((node) => path(node, '')) : []))
  if (shape.reason) return <Reason minHeight={minHeight}>{shape.reason}</Reason>
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
      {!inCard && <div className="flex items-center gap-3 text-xs text-ink-800">
        <span>{shape.levels.map((level) => level.label).join(', then ')}</span>
        <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => { setAllOpen(true); setToggled(new Set()) }}>Expand All</button>
        <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => { setAllOpen(false); setToggled(new Set(shape.roots.map((node) => path(node, '')))) }}>Collapse All</button>
      </div>}
      <div className="overflow-x-auto rounded-md border border-line" role="region" aria-label={label} style={{ minHeight }}>
        <table className="min-w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead className="bg-surface-subtle text-xs text-ink-800">
            <tr className="h-8 border-b border-line">
              <th scope="col" className="px-3 text-left font-semibold">{shape.levels.map((level) => level.label).join(' / ')}</th>
              {shape.measures.map((measure) => <th key={measure.key} scope="col" className="px-3 text-right font-semibold">{measure.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ node, id, open }) => {
              const group = node.children.length > 0
              return (
                <tr key={id} className={`h-8 border-b border-line-subtle ${group ? 'bg-surface-subtle/60 font-medium text-ink-900' : 'text-ink-900'}`}>
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

function Pivot({ result, view, label, minHeight, onPick, inCard = false }: { result: RunResult; view: ReportView; label: string; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void; inCard?: boolean }) {
  const { meas } = split(result, view.across)
  const [picked, setMeasureKey] = useState<string | undefined>(undefined)
  const measureKey = inCard ? view.measure : picked
  const values = meas.filter(({ column }) => !column.compare)
  const matrix = Boolean(view.matrix) && values.length > 1
  const shapes = matrix ? values.map(({ column }) => pivotShape(result, view.across, column.key)) : [pivotShape(result, view.across, measureKey)]
  const shape = shapes[0]
  if (shape.reason) return <Reason minHeight={minHeight}>{shape.reason}</Reason>
  const trend = Boolean(view.sparklines)
  const span = shapes.length
  const format = (measure: ResultColumn, value: number | null) => (value === null ? dash : formatCell(measure, value))
  const rules = shapes.map((s) => formatOf(view.formats, s.measure.key))
  const ranges = shapes.map((s, m) => (rules[m] ? rangeOf(s.rows.flatMap((row) => row.cells)) : null))
  const edge = 'border-l border-line'
  const acrossLabel = result.columns.find((column) => column.key === view.across)?.label
  return (
    <div className="flex flex-col gap-2">
      {!inCard && <div className="flex items-center gap-2 text-xs text-ink-800">
        <span>{matrix ? shapes.map((s) => s.measure.label).join(', ') : shape.measure.label} · {shape.rowHeader} down, {acrossLabel} across</span>
        {!matrix && meas.length > 1 && (
          <span className="w-40"><Select aria-label="Pivot value" controlSize="sm" value={shape.measure.key} onChange={(event) => setMeasureKey(event.target.value)}>
            {meas.map(({ column }) => <option key={column.key} value={column.key}>{column.label}</option>)}
          </Select></span>
        )}
      </div>}
      <div className="overflow-x-auto rounded-md border border-line" role="region" aria-label={label} style={{ minHeight }}>
        <table className="min-w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead className="bg-surface-subtle text-xs text-ink-800">
            <tr className="h-8 border-b border-line">
              <th scope="col" rowSpan={matrix ? 2 : 1} className="px-3 text-left font-semibold whitespace-nowrap">{shape.rowHeader}</th>
              {shape.columns.map((column) => <th key={column.key} scope="col" colSpan={span} className={`px-3 font-semibold whitespace-nowrap ${matrix ? `${edge} text-center` : 'text-right'}`}>{column.label}</th>)}
              <th scope="col" colSpan={span} className={`px-3 font-semibold ${edge} ${matrix ? 'text-center' : 'text-right'}`}>Total</th>
              {trend && <th scope="col" colSpan={span} className={`px-3 font-semibold ${edge} ${matrix ? 'text-center' : 'text-left'}`}>Trend</th>}
            </tr>
            {matrix && (
              <tr className="h-8 border-b border-line">
                {[...shape.columns.map((column) => column.key), 'total', ...(trend ? ['trend'] : [])].flatMap((group) => shapes.map((s, m) => (
                  <th key={`${group}:${s.measure.key}`} scope="col" className={`px-3 font-medium whitespace-nowrap ${group === 'trend' ? 'text-left' : 'text-right'} ${m === 0 ? edge : ''}`}>{s.measure.label}</th>
                )))}
              </tr>
            )}
          </thead>
          <tbody>
            {shape.rows.map((row, r) => (
              <tr key={row.key} className="h-9 border-b border-line-subtle text-ink-900">
                <th scope="row" className="px-3 text-left font-normal whitespace-nowrap">
                  {onPick && shape.rowColumn ? <button type="button" className="text-left hover:text-brand-800 hover:underline" onClick={() => onPick(shape.rowColumn as ResultColumn, row.value)}>{row.label}</button> : row.label}
                </th>
                {shape.columns.flatMap((column, c) => shapes.map((s, m) => {
                  const value = s.rows[r]?.cells[c] ?? null
                  return <td key={`${column.key}:${s.measure.key}`} className={`${cell} ${toneClass(rules[m], value)} ${matrix && m === 0 ? edge : ''}`} style={fillOf(rules[m], value, ranges[m])}>{format(s.measure, value)}</td>
                }))}
                {shapes.map((s, m) => <td key={`total:${s.measure.key}`} className={`${cell} ${m === 0 ? edge : ''} font-semibold`}>{format(s.measure, s.rows[r]?.total ?? null)}</td>)}
                {trend && shapes.map((s, m) => (
                  <td key={`trend:${s.measure.key}`} className={`px-3 ${m === 0 ? edge : ''}`}><Sparkline values={s.rows[r]?.cells ?? []} label={`${s.measure.label} for ${row.label} across ${acrossLabel}`} /></td>
                ))}
              </tr>
            ))}
            <tr className="h-9 border-t border-line font-semibold text-ink-900">
              <td className="px-3">Total</td>
              {shape.columns.flatMap((column, c) => shapes.map((s, m) => <td key={`${column.key}:${s.measure.key}`} className={`${cell} ${matrix && m === 0 ? edge : ''}`}>{format(s.measure, s.columnTotals[c])}</td>))}
              {shapes.map((s, m) => <td key={`grand:${s.measure.key}`} className={`${cell} ${m === 0 ? edge : ''}`}>{format(s.measure, s.grand)}</td>)}
              {trend && shapes.map((s, m) => <td key={`trend:${s.measure.key}`} className={`px-3 ${m === 0 ? edge : ''}`}><Sparkline values={s.columnTotals} label={`${s.measure.label} in total across ${acrossLabel}`} /></td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
