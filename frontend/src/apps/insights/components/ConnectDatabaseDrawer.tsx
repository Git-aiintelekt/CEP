/**
 * New Report's Connect a Database (Option 1 of docs/mockups/new-report-sources.html): a 480px panel over the page in two steps.
 * 1 Connection: the same fields as Settings → Report Databases (MySQL, PostgreSQL or ClickHouse); Save and Continue only once
 * Test Connection has shown the account read-only. 2 What to Report On: a table or view of it, which becomes a dataset with every
 * readable column (the one already mapped from that table when there is one) and a report opened in the editor; or the query
 * window, to write a SELECT. A report author (Report Edit) may do this; changing or removing the connection stays in Settings.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Drawer } from '@/components/Drawer'
import { buttonPrimary, buttonSecondary, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { insightsApi, keys } from '../api'
import { starterDefinition } from '../starter'
import { matches, PAGE } from '../sourceGroups'
import type { ReportDatabase, ReportDatabaseTest, ReportDataset, SourceList } from '../types'
import { connectionBody, connectionForm, ENGINE_LABEL, testWords, type ConnectionForm } from '../databaseConnection'
import { ConnectionFields, LimitFields, TestChecks } from './DatabaseConnectionForm'

export function ConnectDatabaseDrawer({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<ReportDatabase | null>(null)
  return saved ? <PickSource database={saved} onBack={() => setSaved(null)} onClose={onClose} /> : <ConnectionStep onSaved={setSaved} onClose={onClose} />
}

function ConnectionStep({ onSaved, onClose }: { onSaved: (database: ReportDatabase) => void; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ConnectionForm>(() => connectionForm(null))
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [outcome, setOutcome] = useState<ReportDatabaseTest | null>(null)
  const [tested, setTested] = useState<string | null>(null)                    // the form as it was when the test passed
  const snapshot = JSON.stringify(form)
  const readOnly = Boolean(outcome?.ok && outcome.read_only) && tested === snapshot
  const test = useMutation({
    mutationFn: () => api.post<{ test: ReportDatabaseTest }>('/workspace/report-databases/test/', connectionBody(form, null)),
    onSuccess: ({ test: result }) => { setOutcome(result); setTested(snapshot); setErrors({}) },
    onError: (error) => setErrors(error instanceof ApiError ? error.fieldErrors : { host: 'The connection was not tested.' }),
  })
  const save = useMutation({
    mutationFn: () => api.post<ReportDatabase>('/workspace/report-databases/', connectionBody(form, null)),
    onSuccess: (database) => {
      void queryClient.invalidateQueries({ queryKey: ['workspace', 'report-databases'] })
      if (database.usable) onSaved(database)
      else if (database.test) { setOutcome(database.test); setTested(null) }
    },
    onError: (error) => setErrors(error instanceof ApiError ? error.fieldErrors : { name: 'The database was not saved.' }),
  })
  const submit = (event: FormEvent) => { event.preventDefault(); if (readOnly) save.mutate() }
  return (
    <Drawer title="Connect a Database" eyebrow="1 Connection · 2 What to Report On" onClose={onClose}
      footer={<>
        <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>Test Connection</Button>
        <button type="submit" form="connect-database" className={`${buttonPrimary} ml-auto`} disabled={!readOnly || save.isPending}>Save and Continue</button>
      </>}>
      <form id="connect-database" className="flex flex-col gap-4" onSubmit={submit}>
        <p className="text-sm text-ink-800">Read-only. The password stays on the server, and the engine only ever selects from the database.</p>
        <ConnectionFields form={form} onChange={setForm} errors={errors} />
        <LimitFields form={form} onChange={setForm} errors={errors} />
        {outcome && <TestChecks outcome={outcome} engine={form.engine} />}
        {outcome && !readOnly && tested === snapshot && outcome.ok && (
          <p className="rounded-md bg-callout-bg p-3 text-sm text-callout-text">Ask whoever runs the database for an account that can only read, then test again.</p>
        )}
        {!outcome && <p className="text-xs text-ink-800">Test the connection first: it is saved only once the account is shown to read and nothing else.</p>}
      </form>
    </Drawer>
  )
}

function PickSource({ database, onBack, onClose }: { database: ReportDatabase; onBack: () => void; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const sources = useQuery({
    queryKey: ['workspace', 'report-database', database.id, 'sources'],
    queryFn: ({ signal }) => api.get<SourceList>(`/workspace/report-databases/${database.id}/sources/`, undefined, signal),
  })
  const create = useMutation({
    mutationFn: async (source: string) => {
      const dataset = await api.post<ReportDataset>(`/workspace/report-databases/${database.id}/datasets/`, { source })
      const catalog = await queryClient.fetchQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => insightsApi.catalog(signal), staleTime: 0 })
      const shape = catalog.datasets.find((d) => d.key === dataset.key)
      if (!shape) throw new Error('The new dataset is not in the catalogue yet. Try again in a moment.')
      return insightsApi.create({ name: `${dataset.label} report`, dataset: dataset.key, definition: starterDefinition(shape) })
    },
    onSuccess: (report) => navigate(`/insights/reports/${report.id}/edit`),
    onError: (error) => toast.failure(error, 'The report was not created'),
  })
  const [shown, setShown] = useState(PAGE)
  const all = (sources.data?.sources ?? []).filter((s) => s.mappable && matches(s, search))
  const pinned = new Set(sources.data?.pinned ?? [])
  const found = [...all.filter((s) => pinned.has(s.name)), ...all.filter((s) => !pinned.has(s.name))].slice(0, shown)   // a 1,000-table database draws PAGE at a time
  return (
    <Drawer title={database.name} eyebrow="1 Connection · 2 What to Report On" onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onBack}>Back</button>
        <button type="button" className={`${buttonPrimary} ml-auto`} disabled={!chosen || create.isPending} onClick={() => chosen && create.mutate(chosen)}>Create Report</button>
      </>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-800">{ENGINE_LABEL[database.engine]}{database.server_version ? ` ${database.server_version}` : ''} · {database.database_name} · connected and read-only</p>
        <div>
          <p className="text-label font-medium text-ink-900">A Table or View</p>
          <p className="text-helper text-ink-800">It becomes a dataset of this workspace: its columns are read and typed, and the editor opens on it.</p>
        </div>
        {sources.isPending ? <Spinner label="Reading the tables and views" /> : sources.isError ? <ErrorState error={sources.error} onRetry={() => void sources.refetch()} /> : (
          <>
            <TextInput aria-label="Search tables and views" placeholder={`Search ${formatNumber(sources.data.sources.length)} tables and views`} value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE) }} />
            <ul className="max-h-80 overflow-y-auto rounded-md border border-line" aria-label="Tables and views">
              {found.map((s) => (
                <li key={s.name} className="border-b border-line last:border-b-0">
                  <label className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${chosen === s.name ? 'bg-brand-100/40' : 'hover:bg-surface-hover'}`}>
                    <input type="radio" name="source" value={s.name} checked={chosen === s.name} onChange={() => setChosen(s.name)} className="mt-1" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-900">{s.name}</span>
                      <span className="block text-xs text-ink-800">{[s.kind === 'view' ? 'View' : 'Table', s.columns != null ? `${formatNumber(s.columns)} columns` : null, s.rows !== null ? `${formatNumber(s.rows)} rows` : null, s.mapped_as ? `mapped as ${s.mapped_as}` : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                </li>
              ))}
              {found.length === 0 && <li className="px-3 py-4 text-center text-sm text-ink-800">{search ? 'Nothing matches the search.' : 'The account can read no table or view here.'}</li>}
            </ul>
            {all.length > found.length && (
              <p className="flex items-center justify-between text-xs text-ink-800">
                <span>{formatNumber(found.length)} of {formatNumber(all.length)} shown{search ? ' that match' : ''}: search to narrow them</span>
                <button type="button" className="font-medium text-link hover:underline" onClick={() => setShown((n) => n + PAGE)}>Show {formatNumber(Math.min(PAGE, all.length - found.length))} More</button>
              </p>
            )}
          </>
        )}
        <p className="text-sm text-ink-800">
          Or <button type="button" className="font-medium text-link hover:underline" onClick={() => navigate(`/insights/reports/new/query/${database.id}`)}>write a query</button>: tables, joins and calculations, or your own SELECT.
        </p>
        {database.test && !(database.test.ok && database.test.read_only) && <p className="text-sm text-danger-text">{testWords(database.test)}</p>}
      </div>
    </Drawer>
  )
}
