/**
 * Waterfall: the first value by the first dimension, in the report's order, as steps that float from the running total
 * before them; rises in blue, falls in plum, and the whole at the end in grey. Bars are at most BAR_MAX wide, like every bar chart.
 */
import { useState } from 'react'

import { BAR_MAX, niceTicks } from '@/components/charts/scale'
import { formatCell } from '../components/resultWords'
import { split } from '../components/shape'
import type { ResultColumn, RunResult } from '../types'
import { waterfallSteps } from './layout'
import { NumbersTable, Tip, TipLine, VisualReason } from './common'
import { useBoxWidth } from './useBoxWidth'

const PAD = { left: 64, right: 12, top: 12, bottom: 30 }
const COLOR = { up: 'var(--color-chart-1)', down: 'var(--color-chart-2)', total: 'var(--color-chart-4)' }
const WORDS = { up: 'Rise', down: 'Fall', total: 'Total' }
const MAX_STEPS = 40

export function Waterfall({ result, minHeight, onPick }: { result: RunResult; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const [box, width] = useBoxWidth()
  const [active, setActive] = useState<number | null>(null)
  const { dims, meas } = split(result)
  if (!dims.length || !meas.length) return <VisualReason minHeight={minHeight}>A waterfall needs a dimension along the bottom and a value, such as Amount by Month.</VisualReason>
  const dim = dims[0]
  const measure = meas[0]
  const rows = result.rows.slice(0, MAX_STEPS)
  const steps = waterfallSteps(rows.map((row) => Number(row[measure.index]) || 0))
  const labels = [...rows.map((row) => formatCell(dim.column, row[dim.index])), 'Total']
  const low = Math.min(0, ...steps.map((s) => Math.min(s.start, s.end)))
  const high = Math.max(0, ...steps.map((s) => Math.max(s.start, s.end)))
  const span = niceTicks(high - low || 1, 4, steps.every((s) => Number.isInteger(s.end)))
  const step = span[1] - span[0] || 1
  const bottom = Math.floor(low / step) * step
  const top = Math.max(bottom + span.at(-1)!, Math.ceil(high / step) * step)
  const ticks: number[] = []
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v)
  const height = Math.max(240, minHeight - 60)
  const plotWidth = Math.max(1, width - PAD.left - PAD.right)
  const plotHeight = Math.max(1, height - PAD.top - PAD.bottom)
  const band = plotWidth / steps.length
  const barWidth = Math.min(BAR_MAX, band * 0.7)
  const inset = (band - barWidth) / 2
  const y = (v: number) => PAD.top + plotHeight * (1 - (v - bottom) / (top - bottom || 1))
  const every = Math.max(1, Math.ceil(steps.length / Math.max(1, Math.floor(plotWidth / 80))))
  const shown = active === null ? null : steps[active]
  const title = `${measure.column.label} step by step by ${dim.column.label}`
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4 text-sm text-ink-800" aria-hidden>
        {(['up', 'down', 'total'] as const).map((kind) => <span key={kind} className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: COLOR[kind] }} />{WORDS[kind]}</span>)}
      </div>
      <div ref={box} className="relative">
        <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'var(--color-line)' : 'var(--color-line-subtle)'} strokeWidth={tick === 0 ? 1.5 : 1} shapeRendering="crispEdges" />
              <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={12} fill="var(--color-ink-800)">{formatCell(measure.column, tick)}</text>
            </g>
          ))}
          {steps.map((s, i) => {
            const x = PAD.left + band * i + inset
            const yTop = y(Math.max(s.start, s.end))
            const h = Math.max(1, Math.abs(y(s.start) - y(s.end)))
            return (
              <g key={i} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onClick={() => { if (s.kind !== 'total') onPick?.(dim.column, rows[i][dim.index]) }}
                className={onPick && s.kind !== 'total' ? 'cursor-pointer' : undefined}>
                <rect data-step={s.kind} x={x} y={yTop} width={barWidth} height={h} rx={2} fill={COLOR[s.kind]} fillOpacity={active === null || active === i ? 1 : 0.4} />
                {i < steps.length - 1 && <line x1={x + barWidth} x2={x + band} y1={y(s.end)} y2={y(s.end)} stroke="var(--color-ink-300)" strokeDasharray="2 2" />}
                {i % every === 0 && <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize={12} fill="var(--color-ink-800)">{labels[i].length > 12 ? `${labels[i].slice(0, 11)}…` : labels[i]}</text>}
              </g>
            )
          })}
        </svg>
        {shown && active !== null && (
          <Tip x={PAD.left + band * (active + 0.5)} y={y(Math.max(shown.start, shown.end))} width={width}>
            <span className="text-xs font-semibold text-ink-900">{labels[active]}</span>
            <TipLine label={shown.kind === 'total' ? 'Total' : WORDS[shown.kind]} value={formatCell(measure.column, shown.kind === 'total' ? shown.end : shown.end - shown.start)} />
            {shown.kind !== 'total' && <TipLine label="Running Total" value={formatCell(measure.column, shown.end)} />}
          </Tip>
        )}
      </div>
      {result.rows.length > MAX_STEPS && <p className="text-xs text-ink-800">The first {MAX_STEPS} steps are shown.</p>}
      <NumbersTable title={title} header={[dim.column.label, measure.column.label, 'Running Total']}
        rows={steps.map((s, i) => [labels[i], formatCell(measure.column, s.kind === 'total' ? s.end : s.end - s.start), formatCell(measure.column, s.end)])} />
    </figure>
  )
}
