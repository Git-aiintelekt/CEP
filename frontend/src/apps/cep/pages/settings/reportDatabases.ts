/** Settings → Report Databases: what the list page and the mapping page share. */
import type { DatabaseEngine } from '@/apps/insights/types'

export const DATABASES_KEY = ['workspace', 'report-databases'] as const

export function engineMark(engine: DatabaseEngine): string {
  return engine === 'postgresql' ? 'PG' : engine === 'clickhouse' ? 'CH' : engine === 'mysql57' ? 'MY 5.7' : 'MY 8.0'
}
