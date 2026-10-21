/**
 * The fields of a Report Database connection and what Test Connection proved, shared by Settings → Report Databases (the
 * dialog) and New Report's Connect a Database panel: MySQL 5.7 and 8.0, PostgreSQL (with its schema) or ClickHouse (read over
 * its HTTP interface: HTTPS on 8443, or plain HTTP on 8123 on a private network).
 */
import { Field, Select, TextInput } from '@/components/Form'
import { formatNumber } from '@/lib/format'
import { changed, ENGINE_LABEL, type ConnectionForm, type Ssl } from '../databaseConnection'
import type { DatabaseEngine, ReportDatabaseTest } from '../types'

const SSL_LABEL = { REQUIRED: 'Required', PREFERRED: 'Preferred', OFF: 'Off' } as const
const CLICKHOUSE_SSL_LABEL = { REQUIRED: 'HTTPS', OFF: 'Off (plain HTTP)' } as const

export function ConnectionFields({ form, onChange, errors, editing = false }: {
  form: ConnectionForm
  onChange: (form: ConnectionForm) => void
  errors: Record<string, string | undefined>
  /** a saved connection: the password may stay empty to keep the stored one */
  editing?: boolean
}) {
  const set = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => onChange(changed(form, key, value))
  const pg = form.engine === 'postgresql'
  const ch = form.engine === 'clickhouse'
  const sslLabels: Partial<Record<Ssl, string>> = ch ? CLICKHOUSE_SSL_LABEL : SSL_LABEL
  return (
    <>
      <Field label="Name" required error={errors.name} hint="What people see in New Report.">{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Engine" error={errors.engine}>{({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={form.engine} onChange={(e) => set('engine', e.target.value as DatabaseEngine)}>{(Object.keys(ENGINE_LABEL) as DatabaseEngine[]).map((k) => <option key={k} value={k}>{ENGINE_LABEL[k]}</option>)}</Select>}</Field>
        <Field label="SSL" error={errors.ssl} hint={ch ? 'ClickHouse is read over HTTP: 8443 with HTTPS, 8123 without.' : 'Required, Preferred, or Off for a private network.'}>
          {({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={form.ssl} onChange={(e) => set('ssl', e.target.value as Ssl)}>{(Object.keys(sslLabels) as Ssl[]).map((k) => <option key={k} value={k}>{sslLabels[k]}</option>)}</Select>}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Host" required error={errors.host}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.host} onChange={(e) => set('host', e.target.value)} />}</Field>
        <Field label={ch ? 'HTTP Port' : 'Port'} error={errors.port}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value)} />}</Field>
      </div>
      <div className={`grid gap-4 ${pg ? 'sm:grid-cols-2' : ''}`}>
        <Field label="Database" required error={errors.database}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.database} onChange={(e) => set('database', e.target.value)} />}</Field>
        {pg && <Field label="Schema" error={errors.schema} hint="Where the tables and views live.">{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.schema} onChange={(e) => set('schema', e.target.value)} />}</Field>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="User" required error={errors.username}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />}</Field>
        <Field label="Password" required={!editing} error={errors.password} hint={editing ? 'Leave empty to keep the stored password.' : 'Stored encrypted and never shown again.'}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />}</Field>
      </div>
    </>
  )
}

export function TestChecks({ outcome, engine }: { outcome: ReportDatabaseTest; engine: DatabaseEngine }) {
  const ok = (text: string) => <li className="flex items-start gap-2"><span aria-hidden className="text-success-text">✓</span><span>{text}</span></li>
  const bad = (text: string) => <li className="flex items-start gap-2"><span aria-hidden className="text-danger-text">✕</span><span>{text}</span></li>
  return (
    <ul className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-subtle p-3 text-sm text-ink-900" aria-label="Test Connection">
      {!outcome.ok ? bad(outcome.error ?? 'The server did not answer.') : (
        <>
          {ok(`Reached the server · ${ENGINE_LABEL[engine]} ${outcome.version ?? ''} · ${outcome.ms} ms`)}
          {ok(`The account can read ${formatNumber(outcome.tables ?? 0)} table${outcome.tables === 1 ? '' : 's'} and ${formatNumber(outcome.views ?? 0)} view${outcome.views === 1 ? '' : 's'}`)}
          {outcome.read_only ? ok('Read-only: the account holds SELECT and no write or schema right') : bad(`Not read-only: the account holds ${(outcome.offending ?? []).join('; ')}`)}
          {ok(`Time zone of the server: ${outcome.timezone ?? 'unknown'} · reports convert to the workspace’s zone`)}
        </>
      )}
      {outcome.ok && !outcome.read_only && <li className="text-xs text-ink-800">The connection can be saved but not used until the account holds SELECT only.</li>}
    </ul>
  )
}
