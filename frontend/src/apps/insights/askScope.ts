/** The data Ask for a Report asks about (components/AskAbout.tsx): the catalogue grouped as the menu offers it, the choice remembered
 * per browser, and the words for it. */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { AskScope, CatalogDataset, QueryTarget } from './types'

export const SCOPE_KEY = 'insights.ai.scope'
export const UNMAPPED_KEY = 'insights.ai.unmapped'

export function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch { /* no memory of the choice */ }
}

export function rememberedScope(): AskScope {
  const stored = remembered(SCOPE_KEY)
  return stored === 'platform' || stored === 'uploads' || stored?.startsWith('db:') ? (stored as AskScope) : 'all'
}

export function rememberedUnmapped(): boolean {
  return remembered(UNMAPPED_KEY) !== 'false'
}

export interface AskDatabase { id: string; name: string; engine_name: string; engine: string; datasets: CatalogDataset[] }
export interface AskData { platform: CatalogDataset[]; databases: AskDatabase[]; uploads: CatalogDataset[] }

/** the catalogue grouped as the menu offers it; a database with nothing mapped yet comes from the query targets */
export function useAskData(datasets: CatalogDataset[] | undefined): AskData | null {
  const targets = useQuery({ queryKey: ['workspace', 'report-databases', 'targets'], queryFn: ({ signal }) => api.get<{ databases: QueryTarget[] }>('/workspace/report-databases/targets/', undefined, signal),
    retry: false, staleTime: 60_000 })
  if (!datasets) return null
  const databases = new Map<string, AskDatabase>()
  for (const target of targets.data?.databases ?? []) databases.set(target.id, { id: target.id, name: target.name, engine: target.engine, engine_name: target.engine_name, datasets: [] })
  for (const d of datasets) {
    if (!d.database) continue
    const known = databases.get(d.database.id) ?? { id: d.database.id, name: d.database.name, engine: d.database.engine, engine_name: d.database.engine_name, datasets: [] }
    databases.set(d.database.id, { ...known, datasets: [...known.datasets, d] })
  }
  return {
    platform: datasets.filter((d) => !d.database && d.kind !== 'upload'),
    databases: Array.from(databases.values()).sort((a, b) => a.name.localeCompare(b.name)),
    uploads: datasets.filter((d) => d.kind === 'upload'),
  }
}

/** the scope as it can be asked: a remembered database that is no longer there is All My Data */
export function usableScope(scope: AskScope, data: AskData | null): AskScope {
  if (!data) return scope
  if (scope.startsWith('db:') && !data.databases.some((d) => `db:${d.id}` === scope)) return 'all'
  return scope
}

export function databaseOf(scope: AskScope, data: AskData | null): AskDatabase | null {
  return scope.startsWith('db:') ? data?.databases.find((d) => `db:${d.id}` === scope) ?? null : null
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function engineMark(engine: string): string {
  return engine.startsWith('mysql') ? 'MY' : engine === 'postgresql' ? 'PG' : engine === 'clickhouse' ? 'CH' : 'DB'
}

export function listed(labels: string[], most = 4): string {
  return labels.length > most ? `${labels.slice(0, most).join(', ')} …` : labels.join(', ')
}

/** the pill's words for a scope: its name and a short detail */
export function scopeWords(scope: AskScope, data: AskData | null, unmapped: boolean): { mark: string; name: string; detail: string } {
  const db = databaseOf(scope, data)
  if (db) return { mark: engineMark(db.engine), name: db.name, detail: `${plural(db.datasets.length, 'dataset')}${unmapped ? ' · and its tables' : ''}` }
  if (scope === 'platform') return { mark: 'C360', name: 'C360 Datasets', detail: data ? plural(data.platform.length, 'dataset') : '' }
  if (scope === 'uploads') return { mark: 'CSV', name: 'Uploaded Files', detail: data ? plural(data.uploads.length, 'file') : '' }
  return { mark: 'ALL', name: 'All My Data', detail: '' }
}
