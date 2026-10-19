/**
 * Map: the first value by the first dimension on US states or the world's countries, shaded from light to strong blue. The
 * shapes load the first time a map is shown. Values that match no shape are listed under the map.
 */
import { useEffect, useState } from 'react'

import { formatCell } from '../components/resultWords'
import { split } from '../components/shape'
import type { GeoSet } from '../components/geo/shapes'
import type { ResultColumn, ReportView, RunResult } from '../types'
import { guess, match, type Geography } from './geo'
import { NumbersTable, Tip, TipLine, VisualReason } from './common'
import { useBoxWidth } from './useBoxWidth'

type Sets = Record<Geography, GeoSet>
let loaded: Promise<Sets> | null = null
const loadShapes = () => (loaded ??= import('../components/geo/shapes').then((m) => ({ us: m.US_STATES, world: m.WORLD })))

export function MapChart({ result, view, minHeight, onPick }: { result: RunResult; view: ReportView; minHeight: number; onPick?: (column: ResultColumn, value: unknown) => void }) {
  const [box, width] = useBoxWidth()
  const [sets, setSets] = useState<Sets | null>(null)
  const [active, setActive] = useState<{ id: string; x: number; y: number } | null>(null)
  useEffect(() => {
    let live = true
    loadShapes().then((value) => { if (live) setSets(value) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  const { dims, meas } = split(result)
  if (!dims.length || !meas.length) return <VisualReason minHeight={minHeight}>A map needs a place and a value, such as Contacts by Country or by State.</VisualReason>
  if (!sets) return <div ref={box} className="flex items-center justify-center text-sm text-ink-800" style={{ minHeight }}>Loading the map…</div>
  const dim = dims[0]
  const measure = meas[0]
  const values = result.rows.map((row) => ({ value: row[dim.index], amount: Number(row[measure.index]) || 0 }))
  const geography: Geography = view.geo && view.geo !== 'auto' ? view.geo : guess(dim.column, values.map((v) => v.value), sets)
  const set = sets[geography]
  const { byShape, missing } = match(set, values)
  const amounts = [...byShape.values()]
  const low = Math.min(0, ...amounts)
  const high = Math.max(...amounts, 0)
  const shade = (amount: number) => 0.15 + 0.85 * ((amount - low) / (high - low || 1))
  const height = Math.round((width * set.height) / set.width)
  const scale = width / set.width
  const raw = new Map(result.rows.map((row) => [String(row[dim.index] ?? '').trim().toLowerCase(), row[dim.index]]))
  const pickOf = (id: string) => {
    const shape = set.shapes.find((s) => s.id === id)
    if (!shape) return undefined
    for (const key of [shape.id, shape.name, ...shape.codes]) { const found = raw.get(key.toLowerCase()); if (found !== undefined) return found }
    return undefined
  }
  const shown = active ? set.shapes.find((s) => s.id === active.id) : null
  const title = `${measure.column.label} by ${dim.column.label}, on a map of ${geography === 'us' ? 'US states' : 'the world'}`
  return (
    <figure className="flex flex-col gap-3">
      <div ref={box} className="relative" onMouseLeave={() => setActive(null)}>
        <svg width={width} height={height} viewBox={`0 0 ${set.width} ${set.height}`} role="img" aria-label={title} className="block">
          {set.shapes.map((shape) => {
            const amount = byShape.get(shape.id)
            return (
              <path key={shape.id} data-shape={shape.id} d={shape.d} fill={amount === undefined ? 'var(--color-fill-subtle)' : 'var(--color-chart-1)'} fillOpacity={amount === undefined ? 1 : shade(amount)}
                stroke="var(--color-surface)" strokeWidth={0.75 / Math.max(scale, 0.5)} className={amount !== undefined && onPick ? 'cursor-pointer' : undefined}
                onMouseMove={(event) => { const r = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setActive({ id: shape.id, x: event.clientX - r.left, y: event.clientY - r.top }) }}
                onClick={() => { const v = pickOf(shape.id); if (amount !== undefined && v !== undefined) onPick?.(dim.column, v) }} />
            )
          })}
        </svg>
        {shown && active && (
          <Tip x={active.x} y={active.y} width={width}>
            <span className="text-xs font-semibold text-ink-900">{shown.name}</span>
            <TipLine label={measure.column.label} value={byShape.has(shown.id) ? formatCell(measure.column, byShape.get(shown.id)) : 'No data'} />
          </Tip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-800">
        <span className="cep-num">{formatCell(measure.column, low)}</span>
        <span aria-hidden className="h-2 w-32 rounded-full" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--color-chart-1) 15%, transparent), var(--color-chart-1))' }} />
        <span className="cep-num">{formatCell(measure.column, high)}</span>
        <span className="ml-2">{geography === 'us' ? 'US states' : 'Countries'} · grey has no data</span>
      </div>
      {missing.length > 0 && <p className="text-xs text-ink-800">Not on the map: {missing.slice(0, 12).join(', ')}{missing.length > 12 ? ` and ${missing.length - 12} more` : ''}.</p>}
      <NumbersTable title={title} header={[dim.column.label, measure.column.label]} rows={values.map((v) => [formatCell(dim.column, v.value), formatCell(measure.column, v.amount)])} />
    </figure>
  )
}
