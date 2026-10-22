/** Finding a table among 1,000+ (docs/mockups/report-database-catalogue.html, option A): the pinned tables first, the views, then
 * groups by name prefix (sales_, inv_ ...); under GROUP_FROM tables one plain list. The names come from the server, read live. */
import type { SourceInfo } from './types'

export const GROUP_FROM = 50                                   // fewer tables than this: one plain list
export const GROUP_MIN = 5                                     // a prefix shared by fewer tables goes under Other
export const PAGE = 50                                         // names drawn at once; Show 50 More draws the next

export interface SourceGroup {
  key: string
  label: string | null
  items: SourceInfo[]
}

export function prefixOf(name: string): string | null {
  const at = name.indexOf('_')
  return at > 0 ? name.slice(0, at + 1).toLowerCase() : null
}

export function matches(source: SourceInfo, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || source.name.toLowerCase().includes(q)
}

/** The groups of what is listed: Pinned (in the order pinned), Views, then each prefix of GROUP_MIN tables or more, then Other. */
export function groupSources(sources: SourceInfo[], pinned: string[], total: number): SourceGroup[] {
  if (total < GROUP_FROM) return sources.length ? [{ key: 'all', label: null, items: sources }] : []
  const byName = new Map(sources.map((s) => [s.name, s]))
  const pins = pinned.map((name) => byName.get(name)).filter((s): s is SourceInfo => Boolean(s))
  const views = sources.filter((s) => s.kind === 'view')
  const tables = sources.filter((s) => s.kind === 'table')
  const counts = new Map<string, number>()
  for (const s of tables) {
    const p = prefixOf(s.name)
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  const prefixes = [...counts.entries()].filter(([, n]) => n >= GROUP_MIN).map(([p]) => p).sort()
  const kept = new Set(prefixes)
  const out: SourceGroup[] = []
  if (pins.length) out.push({ key: 'pinned', label: 'Pinned', items: pins })
  if (views.length) out.push({ key: 'views', label: 'Views', items: views })
  for (const p of prefixes) out.push({ key: `prefix:${p}`, label: p, items: tables.filter((s) => prefixOf(s.name) === p) })
  const other = tables.filter((s) => !kept.has(prefixOf(s.name) ?? ''))
  if (other.length) out.push({ key: 'other', label: 'Other', items: other })
  return out
}
