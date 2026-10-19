/** Matching a report's values to map shapes: US states by code or name, countries by ISO code (two or three letters) or name. */
import type { GeoSet } from '../components/geo/shapes'

export type Geography = 'us' | 'world'

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[.’']/g, '').replace(/\s+/g, ' ')

/** a lookup from every code and name a value may use to the shape's id */
export function lookup(set: GeoSet): Map<string, string> {
  const out = new Map<string, string>()
  for (const shape of set.shapes) {
    for (const key of [shape.id, shape.name, ...shape.codes, ...(shape.alt ?? [])]) out.set(norm(key), shape.id)
  }
  return out
}

/** which geography the values belong to: what the dimension is called first, then which set matches more of them */
export function guess(field: { key: string; label: string }, values: unknown[], sets: Record<Geography, GeoSet>): Geography {
  const words = `${field.key} ${field.label}`.toLowerCase()
  if (/country|nation/.test(words)) return 'world'
  if (/state|region|province/.test(words)) return 'us'
  const us = lookup(sets.us)
  const world = lookup(sets.world)
  const hits = (map: Map<string, string>) => values.filter((v) => map.has(norm(v))).length
  return hits(us) > hits(world) ? 'us' : 'world'
}

export function match(set: GeoSet, values: { value: unknown; amount: number }[]): { byShape: Map<string, number>; missing: string[] } {
  const keys = lookup(set)
  const byShape = new Map<string, number>()
  const missing: string[] = []
  for (const item of values) {
    const id = keys.get(norm(item.value))
    if (id) byShape.set(id, (byShape.get(id) ?? 0) + item.amount)
    else missing.push(item.value === null || item.value === undefined || item.value === '' ? 'Empty' : String(item.value))
  }
  return { byShape, missing }
}

export { norm }
