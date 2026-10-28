/**
 * New Report's Connect a Database (Option 1 of docs/mockups/new-report-sources.html): a 480px panel over the page in two steps.
 * 1 Connection: the same fields as Settings → Report Databases (MySQL, PostgreSQL or ClickHouse); Save and Continue only once
 * Test Connection has shown the account read-only. 2 What to Report On: a table or view of it, which becomes a dataset with every
 * readable column (the one already mapped from that table when there is one) and a report opened in the editor; or the query
 * window, to write a SELECT. A report author (Report Edit) may do this; changing or removing the connection stays in Settings.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Drawer } from '@/components/Drawer'
import { buttonPrimary, buttonSecondary, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { formatNumber } from '@/lib/format'
import { PAGE } from '../sourceGroups'
import type { DatabaseEngine, ReportDatabase } from '../types'
import { ENGINE_LABEL, testWords } from '../databaseConnection'
import { useConnectionStep, usePickSource, type ConnectionStep, type PickSource } from './connectDatabase'
import { ConnectionFields, LimitFields, TestChecks } from './DatabaseConnectionForm'

export function ConnectDatabaseDrawer({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<ReportDatabase | null>(null)
  return saved ? <PickSourceDrawer database={saved} onBack={() => setSaved(null)} onClose={onClose} /> : <ConnectionDrawer onSaved={setSaved} onClose={onClose} />
}

function ConnectionDrawer({ onSaved, onClose }: { onSaved: (database: ReportDatabase) => void; onClose: () => void }) {
  const step = useConnectionStep(onSaved)
  return (
    <Drawer title="Connect a Database" eyebrow="1 Connection · 2 What to Report On" onClose={onClose}
      footer={<>
        <Button variant="secondary" loading={step.test.isPending} onClick={() => step.test.mutate()}>Test Connection</Button>
        <button type="submit" form="connect-database" className={`${buttonPrimary} ml-auto`} disabled={!step.usable || step.save.isPending}>Save and Continue</button>
      </>}>
      <ConnectionStepFields step={step} formId="connect-database" />
    </Drawer>
  )
}

/** the connection's fields, the test's checks and what to do next; formId: the form a footer's submit button names */
export function ConnectionStepFields({ step, formId, engines }: { step: ConnectionStep; formId: string; engines?: DatabaseEngine[] }) {
  const { form, setForm, errors, outcome, retest, submit } = step
  return (
    <form id={formId} className="flex flex-col gap-4" onSubmit={submit}>
      <p className="text-sm text-ink-800">Read-only. The password stays on the server, and the engine only ever selects from the database.</p>
      <ConnectionFields form={form} onChange={setForm} errors={errors} engines={engines} />
      <LimitFields form={form} onChange={setForm} errors={errors} />
      {outcome && <TestChecks outcome={outcome} engine={form.engine} />}
      {retest && outcome?.ok && (
        <p className="rounded-md bg-callout-bg p-3 text-sm text-callout-text">Ask whoever runs the database for an account that can only read, then test again.</p>
      )}
      {!outcome && <p className="text-xs text-ink-800">Test the connection first: it is saved once the test passes.</p>}
    </form>
  )
}

function PickSourceDrawer({ database, onBack, onClose }: { database: ReportDatabase; onBack: () => void; onClose: () => void }) {
  const pick = usePickSource(database)
  return (
    <Drawer title={database.name} eyebrow="1 Connection · 2 What to Report On" onClose={onClose}
      footer={<>
        <button type="button" className={buttonSecondary} onClick={onBack}>Back</button>
        <button type="button" className={`${buttonPrimary} ml-auto`} disabled={!pick.chosen || pick.create.isPending} onClick={() => pick.chosen && pick.create.mutate(pick.chosen)}>Create Report</button>
      </>}>
      <PickSourceFields pick={pick} />
    </Drawer>
  )
}

/** the connected database's tables and views to pick from, and the way to the query window */
export function PickSourceFields({ pick }: { pick: PickSource }) {
  const navigate = useNavigate()
  const { database, search, setSearch, chosen, setChosen, sources, all, found, more } = pick
  if (!database) return null
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-800">{ENGINE_LABEL[database.engine]}{database.server_version ? ` ${database.server_version}` : ''} · {database.database_name} · connected and read-only</p>
      <div>
        <p className="text-label font-medium text-ink-900">A Table or View</p>
        <p className="text-helper text-ink-800">It becomes a dataset of this workspace: its columns are read and typed, and the editor opens on it.</p>
      </div>
      {sources.isPending ? <Spinner label="Reading the tables and views" /> : sources.isError ? <ErrorState error={sources.error} onRetry={() => void sources.refetch()} /> : sources.data && (
        <>
          <TextInput aria-label="Search tables and views" placeholder={`Search ${formatNumber(sources.data.sources.length)} tables and views`} value={search} onChange={(e) => setSearch(e.target.value)} />
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
              <button type="button" className="font-medium text-link hover:underline" onClick={more}>Show {formatNumber(Math.min(PAGE, all.length - found.length))} More</button>
            </p>
          )}
        </>
      )}
      <p className="text-sm text-ink-800">
        Or <button type="button" className="font-medium text-link hover:underline" onClick={() => navigate(`/insights/reports/new/query/${database.id}`)}>write a query</button>: tables, joins and calculations, or your own SELECT.
      </p>
      {database.test && !(database.test.ok && database.test.read_only) && <p className="text-sm text-danger-text">{testWords(database.test)}</p>}
    </div>
  )
}
