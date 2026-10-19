/**
 * Scatter and bubble: one point per value of the first dimension, the first value along the bottom, the second up the side,
 * and for a bubble the third as the point's size. A click on a point picks its value (a dashboard's cross-filter).
 */
import { useState } from 'react'

import { niceTicks } from '@/components/charts/scale'
import { formatCell } from '../components/resultWords'
import { split } from '../components/shape'
import type { ResultColumn, RunResult } from '../types'
import { NumbersTable, Tip, TipLine, VisualReason } from './common'
import { useBoxWidth } from './useBoxWidth'

const PAD = { right: 16, top: 12, bottom: 40 }
const MAX_POINTS = 400

export function ScatterChart({ result, bubble, minHeight, onPick }: { result: RunResult; bubble: boolean; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const [box, width] = useBoxWidth()
  const [active, setActive] = useState<number | null>(null)
  const { dims, meas } = split(result)
  const need = bubble ? 3 : 2
  if (dims.length === 0) return <VisualReason minHeight={minHeight}>A {bubble ? 'bubble' : 'scatter'} chart needs a dimension: each of its values is a point, such as Campaign.</VisualReason>
  if (meas.length < need) return <VisualReason minHeight={minHeight}>{bubble ? 'A bubble chart needs three values: along the bottom, up the side, and the size, such as Sent, Opened and Clicked.' : 'A scatter chart needs two values: one along the bottom and one up the side, such as Sent Count and Delivered Rate.'}</VisualReason>
  const label = dims[0]
  const [x, y, size] = meas
  const points = result.rows.slice(0, MAX_POINTS).map((row) => ({ value: row[label.index], name: formatCell(label.column, row[label.index]), x: Number(row[x.index]), y: Number(row[y.index]), size: size ? Number(row[size.index]) : 0 }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  const height = Math.max(260, minHeight - 60)
  const xTicks = niceTicks(Math.max(0, ...points.map((p) => p.x)), 5, points.every((p) => Number.isInteger(p.x)))
  const yTicks = niceTicks(Math.max(0, ...points.map((p) => p.y)), 4, points.every((p) => Number.isInteger(p.y)))
  const PAD_LEFT = 30 + Math.max(...yTicks.map((tick) => formatCell(y.column, tick).length)) * 7.5     // the axis title, then the widest tick label
  const plotWidth = Math.max(1, width - PAD_LEFT - PAD.right)
  const plotHeight = Math.max(1, height - PAD.top - PAD.bottom)
  const sx = (v: number) => PAD_LEFT + plotWidth * (v / xTicks.at(-1)!)
  const sy = (v: number) => PAD.top + plotHeight * (1 - v / yTicks.at(-1)!)
  const biggest = Math.max(1, ...points.map((p) => Math.abs(p.size)))
  const radius = (p: { size: number }) => (bubble ? 4 + 20 * Math.sqrt(Math.abs(p.size) / biggest) : 5)
  const labelled = points.length <= 12
  const shown = active === null ? null : points[active]
  const title = bubble ? `${y.column.label} by ${x.column.label}, sized by ${size.column.label}, per ${label.column.label}` : `${y.column.label} by ${x.column.label}, per ${label.column.label}`
  return (
    <figure className="flex flex-col gap-3">
      <div ref={box} className="relative">
        <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line x1={PAD_LEFT} x2={PAD_LEFT + plotWidth} y1={sy(tick)} y2={sy(tick)} stroke={tick === 0 ? 'var(--color-line)' : 'var(--color-line-subtle)'} shapeRendering="crispEdges" />
              <text x={PAD_LEFT - 8} y={sy(tick) + 4} textAnchor="end" fontSize={12} fill="var(--color-ink-800)">{formatCell(y.column, tick)}</text>
            </g>
          ))}
          {xTicks.map((tick) => <text key={`x${tick}`} x={sx(tick)} y={height - 22} textAnchor="middle" fontSize={12} fill="var(--color-ink-800)">{formatCell(x.column, tick)}</text>)}
          <text x={PAD_LEFT + plotWidth / 2} y={height - 4} textAnchor="middle" fontSize={12} fill="var(--color-ink-800)">{x.column.label}</text>
          <text transform={`translate(12 ${PAD.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="var(--color-ink-800)">{y.column.label}</text>
          {points.map((p, i) => (
            <g key={i}>
              <circle data-point cx={sx(p.x)} cy={sy(p.y)} r={radius(p)} fill="var(--color-chart-1)" fillOpacity={active === null || active === i ? 0.7 : 0.25} stroke="var(--color-surface)" strokeWidth={1}
                className={onPick ? 'cursor-pointer' : undefined} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onClick={() => onPick?.(label.column, p.value)} />
              {labelled && <text x={sx(p.x) + radius(p) + 4} y={sy(p.y) + 4} fontSize={11} fill="var(--color-ink-800)" pointerEvents="none">{p.name}</text>}
            </g>
          ))}
        </svg>
        {shown && (
          <Tip x={sx(shown.x)} y={sy(shown.y)} width={width}>
            <span className="text-xs font-semibold text-ink-900">{shown.name}</span>
            <TipLine label={x.column.label} value={formatCell(x.column, shown.x)} />
            <TipLine label={y.column.label} value={formatCell(y.column, shown.y)} />
            {bubble && <TipLine label={size.column.label} value={formatCell(size.column, shown.size)} />}
          </Tip>
        )}
      </div>
      {result.rows.length > MAX_POINTS && <p className="text-xs text-ink-800">The first {MAX_POINTS} points are shown.</p>}
      <NumbersTable title={title} header={[label.column.label, x.column.label, y.column.label, ...(bubble ? [size.column.label] : [])]}
        rows={points.map((p) => [p.name, formatCell(x.column, p.x), formatCell(y.column, p.y), ...(bubble ? [formatCell(size.column, p.size)] : [])])} />
    </figure>
  )
}
