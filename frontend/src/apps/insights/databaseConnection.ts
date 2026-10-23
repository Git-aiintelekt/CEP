/** A Report Database connection's form values and the rules between them, shared by Settings → Report Databases and New Report's
 * Connect a Database (components/DatabaseConnectionForm.tsx draws the fields). */
import type { DatabaseEngine, LimitProfile, ReportDatabase, ReportDatabaseTest } from './types'

export const ENGINE_LABEL: Record<DatabaseEngine, string> = { mysql57: 'MySQL 5.7', mysql80: 'MySQL 8.0', postgresql: 'PostgreSQL', clickhouse: 'ClickHouse' }
const ENGINE_PORT: Record<DatabaseEngine, number> = { mysql57: 3306, mysql80: 3306, postgresql: 5432, clickhouse: 8443 }
const CLICKHOUSE_PLAIN_PORT = 8123
export type Ssl = 'REQUIRED' | 'PREFERRED' | 'OFF'
export type ConnectionForm = { name: string; engine: DatabaseEngine; ssl: Ssl; host: string; port: string; database: string; schema: string; username: string; password: string
  limitProfile: LimitProfile; timeout: string; concurrent: string }

/** how reports treat a database (apps/insights/connection_limits.py): Standard follows the workspace's limits, the next two are fixed */
export const LIMIT_PRESETS: { profile: Exclude<LimitProfile, 'CUSTOM'>; title: string; description: string; timeout_s: number | null; concurrent: number | null }[] = [
  { profile: 'STANDARD', title: 'Standard', description: 'A reporting copy or a small database.', timeout_s: null, concurrent: null },
  { profile: 'LARGE', title: 'Large or Slow', description: 'Big tables, or a server behind a slow link.', timeout_s: 60, concurrent: 2 },
  { profile: 'LIVE', title: 'Live Production Database', description: 'The database the business runs on. Gentle.', timeout_s: 60, concurrent: 1 },
]
export const TIMEOUT_RANGE = [5, 110] as const
export const CONCURRENT_RANGE = [1, 4] as const

export function limitWords(timeout_s: number, concurrent: number): string {
  return `${timeout_s} seconds · ${concurrent} at once`
}

export function connectionForm(database: ReportDatabase | null): ConnectionForm {
  return { name: database?.name ?? '', engine: database?.engine ?? 'mysql80', ssl: database?.ssl_mode ?? 'REQUIRED', host: database?.host ?? '', port: String(database?.port ?? 3306),
    database: database?.database_name ?? '', schema: database?.schema_name ?? 'public', username: database?.username ?? '', password: '',
    limitProfile: database?.limit_profile ?? 'STANDARD', timeout: String(database?.limits.timeout_s ?? 15), concurrent: String(database?.limits.concurrent ?? 4) }
}

/** a change to one field, with the port following the engine (and ClickHouse's port following HTTPS) while it still holds a default */
export function changed<K extends keyof ConnectionForm>(form: ConnectionForm, key: K, value: ConnectionForm[K]): ConnectionForm {
  const next = { ...form, [key]: value }
  if (key === 'engine') {
    const engine = value as DatabaseEngine
    if (form.port === String(ENGINE_PORT[form.engine]) || form.port === String(CLICKHOUSE_PLAIN_PORT) || !form.port) next.port = String(ENGINE_PORT[engine])
    if (engine === 'clickhouse' && form.ssl === 'PREFERRED') next.ssl = 'REQUIRED'
  }
  if (key === 'ssl' && form.engine === 'clickhouse') {
    if (value === 'OFF' && form.port === String(ENGINE_PORT.clickhouse)) next.port = String(CLICKHOUSE_PLAIN_PORT)
    if (value === 'REQUIRED' && form.port === String(CLICKHOUSE_PLAIN_PORT)) next.port = String(ENGINE_PORT.clickhouse)
  }
  return next
}

export function connectionBody(form: ConnectionForm, database: ReportDatabase | null) {
  return { ...(database ? { id: database.id } : {}), name: form.name, engine: form.engine, ssl: form.ssl, host: form.host, port: Number(form.port) || undefined, database: form.database,
    schema: form.schema, username: form.username, password: form.password || undefined, limit_profile: form.limitProfile,
    ...(form.limitProfile === 'CUSTOM' ? { query_timeout_s: Number(form.timeout) || undefined, max_concurrent: Number(form.concurrent) || undefined } : {}) }
}

/** the test passed and the account may be used: read-only, or able to write where the installation does not require read-only */
export function testUsable(outcome: ReportDatabaseTest): boolean {
  return outcome.ok && (outcome.read_only !== false || outcome.read_only_required === false)
}

export function testWords(outcome: ReportDatabaseTest): string {
  if (!outcome.ok) return outcome.error ?? 'the server did not answer.'
  if (outcome.read_only === false) return `the account can write (${(outcome.offending ?? []).join('; ')}).`
  return 'connected.'
}

