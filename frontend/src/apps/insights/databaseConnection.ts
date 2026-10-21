/** A Report Database connection's form values and the rules between them, shared by Settings → Report Databases and New Report's
 * Connect a Database (components/DatabaseConnectionForm.tsx draws the fields). */
import type { DatabaseEngine, ReportDatabase, ReportDatabaseTest } from './types'

export const ENGINE_LABEL: Record<DatabaseEngine, string> = { mysql57: 'MySQL 5.7', mysql80: 'MySQL 8.0', postgresql: 'PostgreSQL', clickhouse: 'ClickHouse' }
const ENGINE_PORT: Record<DatabaseEngine, number> = { mysql57: 3306, mysql80: 3306, postgresql: 5432, clickhouse: 8443 }
const CLICKHOUSE_PLAIN_PORT = 8123
export type Ssl = 'REQUIRED' | 'PREFERRED' | 'OFF'
export type ConnectionForm = { name: string; engine: DatabaseEngine; ssl: Ssl; host: string; port: string; database: string; schema: string; username: string; password: string }

export function connectionForm(database: ReportDatabase | null): ConnectionForm {
  return { name: database?.name ?? '', engine: database?.engine ?? 'mysql80', ssl: database?.ssl_mode ?? 'REQUIRED', host: database?.host ?? '', port: String(database?.port ?? 3306),
    database: database?.database_name ?? '', schema: database?.schema_name ?? 'public', username: database?.username ?? '', password: '' }
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
    schema: form.schema, username: form.username, password: form.password || undefined }
}

export function testWords(outcome: ReportDatabaseTest): string {
  if (!outcome.ok) return outcome.error ?? 'the server did not answer.'
  if (outcome.read_only === false) return `the account can write (${(outcome.offending ?? []).join('; ')}).`
  return 'connected.'
}

