/**
 * One figure for the whole period: a KPI card (the value, its target and how far it got, and its trend when the report runs
 * along dates) or a gauge (an arc filled to the value, the target marked on it). The value is the engine's grand total.
 */
import { formatCell } from '../components/resultWords'
import type { ReportView, RunResult } from '../types'
import { figureOf } from './figure'
import { Sparkline } from './Sparkline'
import { VisualReason } from './common'

const reach = (value: number | null, target: number | undefined) => (value !== null && target ? value / target : null)

export function KpiCard({ result, view, minHeight }: { result: RunResult; view: ReportView; minHeight: number }) {
  const figure = figureOf(result)
  if (!figure) return <VisualReason minHeight={minHeight}>A KPI card needs a value, such as Delivered Rate.</VisualReason>
  const share = reach(figure.value, view.target)
  const met = share !== null && share >= 1
  return (
    <div data-kpi className="flex flex-col gap-1 rounded-md border border-line px-3 py-2.5" style={{ minHeight: Math.min(minHeight, 200) }}>
      <span className="text-sm font-medium text-ink-800">{figure.measure.label}</span>
      <span className="cep-num font-display text-kpi font-semibold text-ink-900">{formatCell(figure.measure, figure.value)}</span>
      {view.target !== undefined ? (
        <span className="cep-num text-sm text-ink-800">
          Target {formatCell(figure.measure, view.target)}
          {share !== null && <> · <span className={`font-semibold ${met ? 'text-success-text' : 'text-danger-text'}`}>{(share * 100).toFixed(1)}% of target</span></>}
        </span>
      ) : <span className="text-sm text-ink-700">No target set</span>}
      {figure.trend && figure.trend.length > 1 && <Sparkline values={figure.trend} width={180} height={36} label={`${figure.measure.label} over the period`} />}
    </div>
  )
}

/** the point on a half circle at `share` of the way round (0 left, 1 right) */
const at = (cx: number, cy: number, r: number, share: number) => {
  const angle = Math.PI * (1 - Math.min(1, Math.max(0, share)))
  return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)]
}

export function Gauge({ result, view, minHeight }: { result: RunResult; view: ReportView; minHeight: number }) {
  const figure = figureOf(result)
  if (!figure) return <VisualReason minHeight={minHeight}>A gauge needs a value, such as Delivered Rate.</VisualReason>
  const value = figure.value ?? 0
  const target = view.target
  const max = figure.measure.format === 'percent' && !target ? 100 : Math.max(target ? target * 1.25 : 0, value * 1.1, 1)
  const width = 280
  const cx = width / 2
  const cy = 150
  const r = 110
  const arc = (share: number) => {
    const [x, y] = at(cx, cy, r, share)
    return `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  const share = reach(figure.value, target)
  const [tx1, ty1] = target ? at(cx, cy, r - 18, target / max) : [0, 0]
  const [tx2, ty2] = target ? at(cx, cy, r + 18, target / max) : [0, 0]
  return (
    <figure className="flex flex-col items-center gap-1" style={{ minHeight: Math.min(minHeight, 220) }}>
      <svg width={width} height={170} role="img" aria-label={`${figure.measure.label}: ${formatCell(figure.measure, figure.value)}${target ? ` of a ${formatCell(figure.measure, target)} target` : ''}`}>
        <path d={arc(1)} fill="none" stroke="var(--color-fill-subtle)" strokeWidth={22} />
        {value > 0 && <path data-gauge-value d={arc(value / max)} fill="none" stroke="var(--color-chart-1)" strokeWidth={22} />}
        {target !== undefined && <line data-gauge-target x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--color-ink-900)" strokeWidth={2.5} />}
        <text x={cx} y={cy - 18} textAnchor="middle" fontSize={30} fontWeight={600} fill="var(--color-ink-900)">{formatCell(figure.measure, figure.value)}</text>
        <text x={cx - r} y={cy + 18} textAnchor="middle" fontSize={11} fill="var(--color-ink-800)">{formatCell(figure.measure, 0)}</text>
        <text x={cx + r} y={cy + 18} textAnchor="middle" fontSize={11} fill="var(--color-ink-800)">{formatCell(figure.measure, max)}</text>
      </svg>
      <span className="text-sm font-medium text-ink-900">{figure.measure.label}</span>
      {target !== undefined ? (
        <span className="cep-num text-sm text-ink-800">Target {formatCell(figure.measure, target)}{share !== null && <> · <span className={`font-semibold ${share >= 1 ? 'text-success-text' : 'text-danger-text'}`}>{(share * 100).toFixed(1)}% of target</span></>}</span>
      ) : <span className="text-sm text-ink-700">No target set</span>}
    </figure>
  )
}

