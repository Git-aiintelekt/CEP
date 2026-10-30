/**
 * The fields of a Report Database connection and what Test Connection proved, shared by Settings → Report Databases (the
 * dialog) and New Report's Connect a Database panel: MySQL 5.7 and 8.0, PostgreSQL (with its schema) or ClickHouse (read over
 * its HTTP interface: HTTPS on 8443, or plain HTTP on 8123 on a private network).
 */
import { useMutation } from '@tanstack/react-query'

import { Button } from '@/components/Button'
import { Field, Select, TextInput } from '@/components/Form'
import { InputGroup } from '@/components/InputGroup'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { changed, connectionBody, CONCURRENT_RANGE, ENGINE_LABEL, LIMIT_PRESETS, limitWords, TIMEOUT_RANGE, type ConnectionForm, type Ssl } from '../databaseConnection'
import type { DatabaseEngine, FoundDatabases, LimitProfile, ReportDatabase, ReportDatabaseTest } from '../types'

const RADIO =
  'mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-line-control bg-surface transition-colors duration-base ease-standard checked:border-brand-600 checked:bg-brand-600 checked:shadow-[inset_0_0_0_3px_var(--color-surface)]'

const SSL_LABEL = { REQUIRED: 'Required', PREFERRED: 'Preferred', OFF: 'Off' } as const
const CLICKHOUSE_SSL_LABEL = { REQUIRED: 'HTTPS', OFF: 'Off (plain HTTP)' } as const

export function ConnectionFields({ form, onChange, errors, editing = false, database = null, engines }: {
  form: ConnectionForm
  onChange: (form: ConnectionForm) => void
  errors: Record<string, string | undefined>
  /** a saved connection: the password may stay empty to keep the stored one */
  editing?: boolean
  /** the saved connection, so Find Databases can use its stored password */
  database?: ReportDatabase | null
  /** the engines this connection may use, when only some will do (Base Reports read MySQL) */
  engines?: DatabaseEngine[]
}) {
  const set = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => onChange(changed(form, key, value))
  const pg = form.engine === 'postgresql'
  // Find Databases: what the account can see (MySQL, ClickHouse) or the database's schemas (PostgreSQL), names only
  const find = useMutation({ mutationFn: () => api.post<FoundDatabases>('/workspace/report-databases/find-databases/', connectionBody(form, database)) })
  const found = find.data?.found ?? null
  const findError = find.error ? (find.error instanceof ApiError ? Object.values(find.error.fieldErrors)[0] ?? find.error.message : 'The server did not answer.') : null
  const picker = (value: string, onPick: (name: string) => void, id: string, describedBy?: string) => (
    <Select id={id} describedBy={describedBy} value={value} onChange={(e) => onPick(e.target.value)}>
      {!found?.some((d) => d.name === value) && <option value={value}>{value || 'Choose one'}</option>}
      {found?.map((d) => <option key={d.name} value={d.name}>{d.name}{d.tables != null ? ` · ${formatNumber(d.tables)} tables and views` : ''}</option>)}
    </Select>
  )
  const ch = form.engine === 'clickhouse'
  const sslLabels: Partial<Record<Ssl, string>> = ch ? CLICKHOUSE_SSL_LABEL : SSL_LABEL
  return (
    <>
      <Field label="Name" required error={errors.name} hint="The name people pick this database by when they create a report.">{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Engine" error={errors.engine} hint={engines ? `These reports read ${engines.map((k) => ENGINE_LABEL[k]).join(' or ')}.` : undefined}>{({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={form.engine} onChange={(e) => set('engine', e.target.value as DatabaseEngine)}>{(engines ?? (Object.keys(ENGINE_LABEL) as DatabaseEngine[])).map((k) => <option key={k} value={k}>{ENGINE_LABEL[k]}</option>)}</Select>}</Field>
        <Field label="SSL" error={errors.ssl} hint={ch ? 'ClickHouse is read over HTTP: 8443 with HTTPS, 8123 without.' : 'Required, Preferred, or Off for a private network.'}>
          {({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={form.ssl} onChange={(e) => set('ssl', e.target.value as Ssl)}>{(Object.keys(sslLabels) as Ssl[]).map((k) => <option key={k} value={k}>{sslLabels[k]}</option>)}</Select>}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Host" required error={errors.host}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.host} onChange={(e) => set('host', e.target.value)} />}</Field>
        <Field label={ch ? 'HTTP Port' : 'Port'} error={errors.port}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value)} />}</Field>
      </div>
      <div className={`grid gap-4 ${pg ? 'sm:grid-cols-2' : ''}`}>
        <Field label="Database" required error={errors.database} hint={!pg && found ? 'The databases this account can see. One that holds only reporting tables or views keeps the list short and the live tables out of reach.' : undefined}>
          {({ id, describedBy, invalid }) => !pg && found ? picker(form.database, (name) => set('database', name), id, describedBy) : <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.database} onChange={(e) => set('database', e.target.value)} />}
        </Field>
        {pg && <Field label="Schema" error={errors.schema} hint={found ? 'The schemas of this database the account may use.' : 'Where the tables and views live.'}>
          {({ id, describedBy, invalid }) => found ? picker(form.schema, (name) => set('schema', name), id, describedBy) : <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.schema} onChange={(e) => set('schema', e.target.value)} />}
        </Field>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="User" required error={errors.username}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />}</Field>
        <Field label="Password" required={!editing} error={errors.password} hint={editing ? 'Leave empty to keep the stored password.' : 'Stored encrypted and never shown again.'}>{({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />}</Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" loading={find.isPending} onClick={() => find.mutate()}>{pg ? 'Find Schemas' : 'Find Databases'}</Button>
        <span className="text-helper text-ink-800" role="status">
          {findError ?? (found ? `${formatNumber(found.length)} found: pick one above. Names only; no table was read.` : pg ? 'Lists the schemas of this database the account may use.' : 'Lists the databases this account can see, so you can pick one.')}
        </span>
      </div>
    </>
  )
}

/**
 * How reports treat this database (docs/mockups/report-database-limits.html, option B): three presets named by the kind of
 * database, and Custom with the time limit and reports at once. Standard follows the workspace's limits (`workspace`).
 */
export function LimitFields({ form, onChange, errors, workspace }: {
  form: ConnectionForm
  onChange: (form: ConnectionForm) => void
  errors: Record<string, string | undefined>
  workspace?: { timeout_s: number; concurrent: number }
}) {
  const pick = (profile: LimitProfile) => onChange({ ...form, limitProfile: profile })
  const presetWords = (timeout: number | null, concurrent: number | null) =>
    timeout != null && concurrent != null ? limitWords(timeout, concurrent) : workspace ? limitWords(workspace.timeout_s, workspace.concurrent) : 'The workspace’s limits'
  const custom = form.limitProfile === 'CUSTOM'
  const card = (profile: LimitProfile, title: string, description: string, words: string) => (
    <label key={profile} className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 transition-colors duration-base ease-standard ${form.limitProfile === profile ? 'border-link bg-callout-bg' : 'border-line bg-surface hover:bg-surface-hover'}`}>
      <input type="radio" name="limit-profile" className={RADIO} checked={form.limitProfile === profile} onChange={() => pick(profile)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{title}</span>
        <span className="block text-helper text-ink-800">{description}</span>
        <span className="cep-num mt-0.5 block text-xs text-ink-900">{words}</span>
      </span>
    </label>
  )
  return (
    <fieldset className="flex flex-col gap-2.5 border-t border-line-subtle pt-4">
      <legend className="sr-only">How reports treat this database</legend>
      <div>
        <p className="text-sm font-semibold text-ink-900" aria-hidden>How Reports Treat This Database</p>
        <p className="text-helper text-ink-800">The next report uses it; nothing restarts.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {LIMIT_PRESETS.map((p) => card(p.profile, p.title, p.description, presetWords(p.timeout_s, p.concurrent)))}
        {card('CUSTOM', 'Custom', 'Set the two values yourself.', custom ? limitWords(Number(form.timeout) || 0, Number(form.concurrent) || 0) : `${TIMEOUT_RANGE[0]}–${TIMEOUT_RANGE[1]} seconds · ${CONCURRENT_RANGE[0]}–${CONCURRENT_RANGE[1]} at once`)}
      </div>
      {custom && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time Limit" error={errors.query_timeout_s} hint={`${TIMEOUT_RANGE[0]} to ${TIMEOUT_RANGE[1]}. A report that needs longer is stopped with advice to narrow it.`}>
            {({ id, describedBy, invalid }) => <InputGroup id={id} describedBy={describedBy} invalid={invalid} controlSize="md" inputMode="numeric" suffix="seconds" value={form.timeout}
              onChange={(e) => onChange({ ...form, timeout: e.target.value.replace(/\D/g, '') })} />}
          </Field>
          <Field label="Reports at Once" error={errors.max_concurrent} hint={`${CONCURRENT_RANGE[0]} to ${CONCURRENT_RANGE[1]}. Others wait their turn.`}>
            {({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={form.concurrent} onChange={(e) => onChange({ ...form, concurrent: e.target.value })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}
          </Field>
        </div>
      )}
      {errors.limit_profile && <p role="alert" className="text-sm text-danger-text">{errors.limit_profile}</p>}
      {form.limitProfile === 'LIVE' && <p className="text-helper text-warning-text">One report at a time reads it: others wait their turn. Schedule heavy reports outside working hours.</p>}
    </fieldset>
  )
}

export function TestChecks({ outcome, engine }: { outcome: ReportDatabaseTest; engine: DatabaseEngine }) {
  const ok = (text: string) => <li className="flex items-start gap-2"><span aria-hidden className="text-success-text">✓</span><span>{text}</span></li>
  const bad = (text: string) => <li className="flex items-start gap-2"><span aria-hidden className="text-danger-text">✕</span><span>{text}</span></li>
  const warn = (text: string) => <li className="flex items-start gap-2"><span aria-hidden className="font-semibold text-warning-text">!</span><span>{text}</span></li>
  const writerAllowed = outcome.read_only === false && outcome.read_only_required === false
  return (
    <ul className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-subtle p-3 text-sm text-ink-900" aria-label="Test Connection">
      {!outcome.ok ? bad(outcome.error ?? 'The server did not answer.') : (
        <>
          {ok(`Reached the server · ${ENGINE_LABEL[engine]} ${outcome.version ?? ''} · ${outcome.ms} ms`)}
          {ok(`The account can read ${formatNumber(outcome.tables ?? 0)} table${outcome.tables === 1 ? '' : 's'} and ${formatNumber(outcome.views ?? 0)} view${outcome.views === 1 ? '' : 's'}`)}
          {outcome.read_only ? ok('Read-only: the account holds SELECT and no write or schema right')
            : writerAllowed ? warn(`Can write: the account holds ${(outcome.offending ?? []).join('; ')}. Allowed here, because read-only is not required; C360 still opens every session read-only and runs SELECT only`)
            : bad(`Not read-only: the account holds ${(outcome.offending ?? []).join('; ')}`)}
          {ok(`Time zone of the server: ${outcome.timezone ?? 'unknown'} · reports convert to the workspace’s zone`)}
        </>
      )}
      {outcome.ok && !outcome.read_only && !writerAllowed && <li className="text-xs text-ink-800">The connection can be saved but not used until the account holds SELECT only.</li>}
    </ul>
  )
}
