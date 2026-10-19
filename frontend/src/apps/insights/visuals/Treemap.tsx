/** Treemap: the first value by the first dimension as boxes sized by their share, the largest first; more than 24 fold into Other. */
import { useState } from 'react'

import { CHART_COLORS } from '@/components/charts/scale'
import { formatCell } from '../components/resultWords'
import { split } from '../components/shape'
import type { ResultColumn, RunResult } from '../types'
import { squarify } from './layout'
import { NumbersTable, Tip, TipLine, VisualReason } from './common'
import { useBoxWidth } from './useBoxWidth'

const MAX_BOXES = 24

export function Treemap({ result, minHeight, onPick }: { result: RunResult; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const [box, width] = useBoxWidth()
  const [active, setActive] = useState<number | null>(null)
  const { dims, meas } = split(result)
  if (!dims.length || !meas.length) return <VisualReason minHeight={minHeight}>A treemap needs a dimension and a value, such as Sent Count by Campaign.</VisualReason>
  const dim = dims[0]
  const measure = meas[0]
  const totals = new Map<string, { raw: unknown; label: string; amount: number }>()
  for (const row of result.rows) {
    const key = String(row[dim.index] ?? '')
    const amount = Number(row[measure.index]) || 0
    const line = totals.get(key) ?? { raw: row[dim.index], label: formatCell(dim.column, row[dim.index]), amount: 0 }
    line.amount += amount
    totals.set(key, line)
  }
  const positive = [...totals.values()].filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount)
  if (!positive.length) return <VisualReason minHeight={minHeight}>A treemap shows positive values; this report has none.</VisualReason>
  const kept = positive.slice(0, MAX_BOXES)
  const other = positive.slice(MAX_BOXES).reduce((sum, item) => sum + item.amount, 0)
  const items = [...kept.map((item) => ({ ...item, value: item.amount, other: false })), ...(other ? [{ raw: null as unknown, value: other, label: 'Other', amount: other, other: true }] : [])]
  const whole = items.reduce((sum, item) => sum + item.value, 0)
  const height = Math.max(240, minHeight - 60)
  const laid = squarify(items, { x: 0, y: 0, w: width, h: height })
  const shown = active === null ? null : laid[active]
  const share = (amount: number) => `${((amount / whole) * 100).toFixed(1)}%`
  const title = `${measure.column.label} by ${dim.column.label}`
  return (
    <figure className="flex flex-col gap-3">
      <div ref={box} className="relative">
        <svg width={width} height={height} role="img" aria-label={title} className="block">
          {laid.map((tile, i) => {
            const roomy = tile.w > 70 && tile.h > 36
            return (
              <g key={tile.label} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onClick={() => { if (!tile.other) onPick?.(dim.column, tile.raw) }}
                className={onPick && !tile.other ? 'cursor-pointer' : undefined}>
                <rect data-treemap-box x={tile.x + 1} y={tile.y + 1} width={Math.max(0, tile.w - 2)} height={Math.max(0, tile.h - 2)} rx={3}
                  fill={tile.other ? 'var(--color-chart-4)' : CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={active === null || active === i ? 0.9 : 0.5} />
                {roomy && (
                  <text x={tile.x + 8} y={tile.y + 18} fontSize={12} fill="var(--color-on-brand)" pointerEvents="none">
                    <tspan fontWeight={600}>{tile.label.length > tile.w / 7 ? `${tile.label.slice(0, Math.max(3, Math.floor(tile.w / 7) - 1))}…` : tile.label}</tspan>
                    <tspan x={tile.x + 8} dy={15}>{formatCell(measure.column, tile.amount)}</tspan>
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {shown && (
          <Tip x={shown.x + shown.w / 2} y={shown.y + 8} width={width}>
            <span className="text-xs font-semibold text-ink-900">{shown.label}</span>
            <TipLine label={measure.column.label} value={formatCell(measure.column, shown.amount)} />
            <TipLine label="Share" value={share(shown.amount)} />
          </Tip>
        )}
      </div>
      <NumbersTable title={title} header={[dim.column.label, measure.column.label, 'Share']} rows={items.map((item) => [item.label, formatCell(measure.column, item.amount), share(item.amount)])} />
    </figure>
  )
}
