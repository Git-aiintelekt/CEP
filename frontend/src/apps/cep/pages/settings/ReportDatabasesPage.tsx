/**
 * Settings → Report Databases (Option 1 of docs/mockups/report-databases.html): a workspace's own MySQL, PostgreSQL or ClickHouse databases, read
 * by the report engine and nothing else. One card per connection with its engine, host and database, the account and whether it is
 * read-only, the datasets mapped from it and the last test; Connect a Database opens the dialog, Test Connection proves the four facts
 * before Save. The datasets mapped from every database sit in a table under the cards.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/Button'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { ConnectionFields, LimitFields, TestChecks } from '@/apps/insights/components/DatabaseConnectionForm'
import { connectionBody, connectionForm, LIMIT_PRESETS, testUsable, testWords, type ConnectionForm } from '@/apps/insights/databaseConnection'
import type { ReportDatabase, ReportDatabaseTest, ReportDatabases } from '@/apps/insights/types'
import { DATABASES_KEY, engineMark } from './reportDatabases'

export function ReportDatabasesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<ReportDatabase | 'new' | null>(null)
  const list = useQuery({ queryKey: DATABASES_KEY, queryFn: ({ signal }) => api.get<ReportDatabases>('/workspace/report-databases/', undefined, signal) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: DATABASES_KEY })
  const test = useMutation({
    mutationFn: (id: string) => api.post<{ test: ReportDatabaseTest; database: ReportDatabase }>(`/workspace/report-databases/${id}/test/`, {}),
    onSuccess: ({ test: outcome, database }) => {
      if (outcome.ok && outcome.read_only) toast.success(`${database.name}: connected and read-only`)
      else if (testUsable(outcome)) toast.success(`${database.name}: connected`, 'The account can write; it is used because read-only is not required here.')
      else toast.failure(new Error(testWords(outcome)), `${database.name}: the test failed`)
      void refresh()
    },
    onError: (error) => toast.failure(error, 'The connection was not tested'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/workspace/report-databases/${id}/`),
    onSuccess: () => { toast.success('The database was removed'); void refresh() },
    onError: (error) => toast.failure(error, 'The database was not removed'),
  })

  if (list.isError) return <ErrorState title="The databases could not be loaded" error={list.error} onRetry={() => void list.refetch()} />
  if (list.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = list.data
  const datasets = data.databases.flatMap((db) => (db.datasets ?? []).map((d) => ({ ...d, database: db })))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">Report Databases</h2>
          <p className="mt-0.5 text-sm text-ink-800">Your own databases, read by the report engine to build reports. Read-only: the engine only ever selects.</p>
        </div>
        {data.ready && <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}><Plus size={16} strokeWidth={1.5} aria-hidden />Connect a Database</button>}
      </div>

      {!data.ready ? (
        <EmptyState title="Not Available Yet" hint="The platform has not switched on Report Databases for this installation (database patch 0056)." />
      ) : data.databases.length === 0 ? (
        <>
          <EmptyState title="No Databases Connected" hint="Connect a MySQL 5.7, MySQL 8.0 or PostgreSQL database with a SELECT-only account. Then map a table or view as a dataset and it appears in New Report and Ask for a Report, for this workspace only."
            action={<button type="button" className={buttonPrimary} onClick={() => setEditing('new')}>Connect a Database</button>} />
          <GrantCard examples={data.grant_examples} />
        </>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3" aria-label="Databases">
          {data.databases.map((db) => (
            <li key={db.id} className={`flex flex-col gap-2.5 rounded-lg border bg-surface p-4 ${db.read_only === false && !db.usable ? 'border-danger-text' : 'border-line'}`} aria-label={db.name}>
              <div className="flex items-start gap-3">
                <span aria-hidden className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[10px] leading-tight font-bold ${db.usable ? 'bg-brand-100 text-brand-800' : 'bg-fill-subtle text-ink-800'}`}>{engineMark(db.engine)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900">{db.name}</p>
                  <p className="text-xs text-ink-800">{db.engine_name}{db.server_version ? ` ${db.server_version}` : ''} · {db.host}:{db.port} / {db.database_name}{db.engine === 'postgresql' ? ` · ${db.schema_name}` : ''}</p>
                </div>
              </div>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-800">Connects as</dt><dd className="text-ink-900"><span className="font-mono">{db.username}</span> <ReadOnlyMark db={db} /></dd>
                <dt className="text-ink-800">Limits</dt><dd className="flex flex-wrap items-center gap-1.5 text-ink-900"><LimitsMark db={db} /></dd>
                <dt className="text-ink-800">Datasets</dt><dd className="text-ink-900">{db.datasets?.length ? db.datasets.map((d) => d.label).join(', ') : 'None yet'}</dd>
                <dt className="text-ink-800">Last test</dt><dd className="text-ink-900">{db.last_tested_at ? `${formatDateTime(db.last_tested_at)}${db.last_test_ok ? '' : ' · refused'}` : 'Not tested'}</dd>
              </dl>
              {db.last_test_ok === false && db.last_test_error && <p className="text-xs text-danger-text">{db.last_test_error}{db.read_only === false ? ' Give the engine a SELECT-only account before mapping a dataset.' : ''}</p>}
              <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                <Button variant="secondary" size="sm" loading={test.isPending && test.variables === db.id} onClick={() => test.mutate(db.id)}>Test Connection</Button>
                {db.usable && <Link to={`/settings/report-databases/${db.id}/map`} className={`${buttonSecondary} h-8 px-3 text-xs`}>Map a Dataset</Link>}
                {db.usable && <Link to={`/settings/report-databases/${db.id}/query`} className={`${buttonSecondary} h-8 px-3 text-xs`}>Query</Link>}
                <Button variant="secondary" size="sm" onClick={() => setEditing(db)}>Edit</Button>
                {!db.datasets?.length && <Button variant="danger" size="sm" disabled={remove.isPending} onClick={() => window.confirm(`Remove ${db.name}? The engine forgets the connection and its password.`) && remove.mutate(db.id)}>Remove</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {datasets.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-900">Datasets from Your Databases</h3>
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full text-sm" aria-label="Datasets from your databases">
              <thead><tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase"><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Database</th><th className="px-3 py-2">From</th><th className="px-3 py-2">Fields</th><th className="px-3 py-2">Reports</th><th className="px-3 py-2">Freshness</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id} className="border-t border-line-subtle">
                    <td className="px-3 py-2"><span className="font-medium text-ink-900">{d.label}</span><span className="block text-xs text-ink-800">{[d.description, d.kind === 'query' ? 'From a query' : null].filter(Boolean).join(' · ')}</span></td>
                    <td className="px-3 py-2 text-ink-800">{d.database.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-800">{d.kind === 'query' ? `query · ${d.field_count} columns` : d.joins.length ? `${d.source} + ${d.joins.length} join${d.joins.length === 1 ? '' : 's'}` : d.source}</td>
                    <td className="cep-num px-3 py-2 text-ink-800">{d.field_count}{d.pii_count ? ` · ${d.pii_count} personal` : ''}</td>
                    <td className="cep-num px-3 py-2 text-ink-800">{formatNumber(d.reports)}</td>
                    <td className="px-3 py-2"><Tag tone="success">Live</Tag></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{d.kind === 'query' && <Link to={`/settings/report-databases/${d.connection_id}/query/${d.id}`} className={`${buttonSecondary} mr-1.5 h-8 px-3 text-xs`}>Edit Query</Link>}<Link to={`/settings/report-databases/${d.connection_id}/map/${d.id}`} className={`${buttonSecondary} h-8 px-3 text-xs`}>Edit Fields</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.databases.length > 0 && <GrantCard examples={data.grant_examples} compact />}
      {editing && <ConnectDialog database={editing === 'new' ? null : editing} workspace={data.limits_ready === false ? undefined : data.workspace_limits} limitsReady={data.limits_ready !== false}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh() }} />}
    </div>
  )
}

function LimitsMark({ db }: { db: ReportDatabase }) {
  const title = db.limit_profile === 'CUSTOM' ? 'Custom' : LIMIT_PRESETS.find((p) => p.profile === db.limit_profile)?.title ?? 'Standard'
  return <><Tag tone={db.limit_profile === 'LIVE' ? 'warning' : 'neutral'}>{title}</Tag><span className="cep-num">{db.limits.timeout_s} s · {db.limits.concurrent} at once</span></>
}

function ReadOnlyMark({ db }: { db: ReportDatabase }) {
  if (db.read_only === true) return <span className="ml-1 font-semibold text-success-text">✓ Read-only</span>
  if (db.read_only === false && db.usable) return <span className="ml-1 font-semibold text-warning-text" title="Used because read-only is not required here; C360 still reads only">! Can write</span>
  if (db.read_only === false) return <span className="ml-1 font-semibold text-danger-text">✕ Can write</span>
  return <span className="ml-1 text-ink-700">· not tested</span>
}

function GrantCard({ examples, compact = false }: { examples: ReportDatabases['grant_examples']; compact?: boolean }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-4 ${compact ? 'max-w-3xl' : ''}`}>
      <p className="text-sm font-semibold text-ink-900">The account to create <span className="font-normal text-ink-800">· SELECT only</span></p>
      <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div><p className="mb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">MySQL 5.7 and 8.0</p><pre className="overflow-x-auto rounded-md bg-surface-sunken p-2.5 font-mono text-xs leading-relaxed text-ink-900">{examples.mysql}</pre></div>
        <div><p className="mb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">PostgreSQL</p><pre className="overflow-x-auto rounded-md bg-surface-sunken p-2.5 font-mono text-xs leading-relaxed text-ink-900">{examples.postgresql}</pre></div>
        {examples.clickhouse && <div><p className="mb-1 text-xs font-semibold tracking-wide text-ink-800 uppercase">ClickHouse</p><pre className="overflow-x-auto rounded-md bg-surface-sunken p-2.5 font-mono text-xs leading-relaxed text-ink-900">{examples.clickhouse}</pre></div>}
      </div>
      <p className="mt-2 text-xs text-ink-800">Grant SELECT on the schema, or on the views alone to hide tables the engine should never see. Nothing else: an account that can write or change the schema is refused.</p>
    </section>
  )
}

function ConnectDialog({ database, workspace, limitsReady, onClose, onSaved }: {
  database: ReportDatabase | null
  workspace?: { timeout_s: number; concurrent: number }
  /** patch 0074: without it every database stays on Standard */
  limitsReady: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<ConnectionForm>(() => connectionForm(database))
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [outcome, setOutcome] = useState<ReportDatabaseTest | null>(null)
  const body = () => connectionBody(form, database)
  const test = useMutation({
    mutationFn: () => api.post<{ test: ReportDatabaseTest }>('/workspace/report-databases/test/', body()),
    onSuccess: ({ test: result }) => { setOutcome(result); setErrors({}) },
    onError: (error) => setErrors(error instanceof ApiError ? error.fieldErrors : { host: 'The connection was not tested.' }),
  })
  const save = useMutation({
    mutationFn: () => (database ? api.put<ReportDatabase>(`/workspace/report-databases/${database.id}/`, { ...body(), row_version: database.row_version }) : api.post<ReportDatabase>('/workspace/report-databases/', body())),
    onSuccess: (saved) => { toast.success(database ? 'The database was saved' : `${saved.name} connected`, saved.test && !(saved.test.ok && saved.test.read_only) ? testWords(saved.test) : undefined); onSaved() },
    onError: (error) => setErrors(error instanceof ApiError ? error.fieldErrors : { name: 'The database was not saved.' }),
  })
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate() }
  return (
    <Modal title={database ? `Edit ${database.name}` : 'Connect a Database'} subtitle="Read-only. The engine only ever selects from it." onClose={onClose} size="lg"
      footer={<><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>Test Connection</Button><button type="submit" form="db-form" className={buttonPrimary} disabled={save.isPending}>Save</button></>}>
      <form id="db-form" className="flex flex-col gap-4" onSubmit={submit}>
        <ConnectionFields form={form} onChange={setForm} errors={errors} editing={Boolean(database)} database={database} />
        {limitsReady && <LimitFields form={form} onChange={setForm} errors={errors} workspace={workspace} />}
        {outcome && <TestChecks outcome={outcome} engine={form.engine} />}
        <p className="text-xs text-ink-800">The engine connects from CEP's server with this account, opens every session read-only with the time limit above, and runs only the SELECT statements it builds from a report. Give the account SELECT and nothing else.</p>
      </form>
    </Modal>
  )
}
