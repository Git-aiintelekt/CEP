/**
 * Add Base Reports (docs/mockups/base-reports.html, option 1): the platform's ready-made report packs, added as this workspace's own
 * copies in three steps. Pick a pack; connect it to this workspace's data (the connection, the databases on it holding the pack's
 * tables, where campaign names live, campaigns to leave out), checked by test-running each dataset; then what was made. Later
 * versions of a pack never change what was added; adding it again makes new copies.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { Checkbox } from '@/components/Checkbox'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { formatDate } from '@/lib/format'
import { baseReportsApi } from '../api'
import type { BasePack, BasePackAdded, BasePackCheck, BasePackOptions, BasePackSources, BaseReportsCatalog } from '../types'

const NO_NAMES = ''

export function BaseReportsDialog({ onClose }: { onClose: () => void }) {
  const catalog = useQuery({ queryKey: ['insights', 'base-reports'], queryFn: ({ signal }) => baseReportsApi.list(signal) })
  const [pack, setPack] = useState<BasePack | null>(null)
  const [added, setAdded] = useState<BasePackAdded | null>(null)

  if (added && pack) return <Added pack={pack} added={added} onClose={onClose} />
  if (pack && catalog.data) return <Connect pack={pack} catalog={catalog.data} onBack={() => setPack(null)} onAdded={setAdded} onClose={onClose} />
  return (
    <Modal title="Add Base Reports" subtitle="Ready-made reports from the platform, added as this workspace's own copies." size="lg" scrollBody onClose={onClose}
      footer={<div className="flex justify-end"><button type="button" className={buttonSecondary} onClick={onClose}>Close</button></div>}>
      {catalog.isPending ? <Spinner label="Loading the base reports" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : (
        <ul className="flex flex-col gap-3" aria-label="Base packs">
          {catalog.data.packs.map((one) => <PackCard key={one.key} pack={one} catalog={catalog.data} onAdd={() => setPack(one)} />)}
        </ul>
      )}
    </Modal>
  )
}

function PackCard({ pack, catalog, onAdd }: { pack: BasePack; catalog: BaseReportsCatalog; onAdd: () => void }) {
  const { tenant } = useAuth()
  const [open, setOpen] = useState(false)
  const latest = pack.added[0]
  const readable = catalog.connections.filter((c) => c.engine.startsWith(pack.needs.engine))
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-ink-900">{pack.name}</h3>
        <Tag tone="neutral">{`Version ${pack.version}`}</Tag>
        {pack.chosen && !latest && <Tag tone="neutral">Chosen at Onboarding</Tag>}
        {latest ? <Tag tone="success">{`Added ${formatDate(latest.at)} · Version ${latest.version}`}</Tag> : <Tag tone="neutral">{`Needs ${pack.needs.label}`}</Tag>}
      </div>
      <p className="max-w-prose text-sm text-ink-800">{pack.summary}</p>
      <p className="text-xs text-ink-800">
        <span className="font-semibold text-ink-900">{pack.contents.datasets.length}</span> datasets · <span className="font-semibold text-ink-900">{pack.contents.reports.length}</span> reports ·{' '}
        <span className="font-semibold text-ink-900">{pack.contents.dashboards.length}</span> dashboards{pack.source ? ` · From ${pack.source}` : ''}
      </p>
      {open && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border border-line-subtle p-3 text-xs">
          <dt className="font-semibold text-ink-800">Datasets</dt><dd className="text-ink-900">{pack.contents.datasets.join(', ')}</dd>
          <dt className="font-semibold text-ink-800">Reports</dt><dd className="text-ink-900">{pack.contents.reports.join(', ')}</dd>
          <dt className="font-semibold text-ink-800">Dashboards</dt><dd className="text-ink-900">{pack.contents.dashboards.join(', ')}</dd>
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonSecondary} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide What's in It" : "See What's in It"}</button>
        {catalog.can_add && readable.length > 0 && <button type="button" className={buttonPrimary} onClick={onAdd}>{latest ? 'Add Again' : tenant ? `Add to ${tenant}` : 'Add to This Workspace'}</button>}
        {catalog.can_add && readable.length === 0 && (
          <span className="text-xs text-ink-800">Connect a MySQL database that holds Postal's tables first. <Link to="/settings/report-databases" className="font-semibold text-brand-800 hover:underline">Open Report Databases</Link></span>
        )}
        {!catalog.can_add && <span className="text-xs text-ink-800">A report administrator adds base reports.</span>}
      </div>
    </li>
  )
}

function Connect({ pack, catalog, onBack, onAdded, onClose }: { pack: BasePack; catalog: BaseReportsCatalog; onBack: () => void; onAdded: (added: BasePackAdded) => void; onClose: () => void }) {
  const toast = useToast()
  const client = useQueryClient()
  const readable = catalog.connections.filter((c) => c.engine.startsWith(pack.needs.engine))
  const [connectionId, setConnectionId] = useState(readable.find((c) => c.usable)?.id ?? '')
  const [picked, setPicked] = useState<string[] | null>(null)
  const [names, setNames] = useState<string | null>(null)
  const [leaveOut, setLeaveOut] = useState('test')
  const [unsubscribe, setUnsubscribe] = useState('unsubscribe')
  const [checked, setChecked] = useState<BasePackCheck | null>(null)
  const [everyDatabase, setEveryDatabase] = useState(false)
  const sources = useQuery({ queryKey: ['insights', 'base-reports', pack.key, 'sources', connectionId], queryFn: () => baseReportsApi.sources(pack.key, connectionId), enabled: Boolean(connectionId), retry: false })
  const found: BasePackSources | undefined = sources.data
  const databases = picked ?? (found?.databases.filter((d) => (d.marketing ?? 1) > 0).map((d) => d.name) ?? [])
  const quiet = found?.databases.filter((d) => d.marketing === 0 && !databases.includes(d.name)).length ?? 0
  const namesKey = names ?? (found?.names[0] ? JSON.stringify(found.names[0]) : NO_NAMES)
  const options: BasePackOptions = {
    databases,
    names: namesKey ? JSON.parse(namesKey) : null,
    leave_out: leaveOut.split(',').map((w) => w.trim()).filter(Boolean),
    unsubscribe: unsubscribe.trim() || undefined,
  }
  const changed = () => setChecked(null)
  const check = useMutation({ mutationFn: () => baseReportsApi.check(pack.key, connectionId, options), onSuccess: setChecked, onError: (error) => toast.failure(error, 'The check did not run') })
  const add = useMutation({
    mutationFn: () => baseReportsApi.add(pack.key, connectionId, options),
    onSuccess: (made) => { void client.invalidateQueries({ queryKey: ['insights'] }); onAdded(made) },
    onError: (error) => toast.failure(error, `${pack.name} was not added`),
  })
  const ready = Boolean(connectionId) && databases.length > 0
  return (
    <Modal title={`Add ${pack.name}`} subtitle="Step 2 of 3 · Your data" size="lg" scrollBody onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          <button type="button" className={buttonSecondary} onClick={onBack}>Back</button>
          <span className="flex-1" />
          {checked?.ok
            ? <button type="button" className={buttonPrimary} disabled={add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Adding…' : 'Add Reports'}</button>
            : <button type="button" className={buttonPrimary} disabled={!ready || check.isPending} onClick={() => check.mutate()}>{check.isPending ? 'Checking…' : 'Check'}</button>}
        </div>
      )}>
      <div className="flex flex-col gap-4">
        <Field label="Connection" hint={`The connection that reaches ${pack.needs.label}`}>
          {(ids) => (
            <Select id={ids.id} describedBy={ids.describedBy} value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setPicked(null); setNames(null); changed() }}>
              {readable.map((c) => <option key={c.id} value={c.id} disabled={!c.usable}>{c.usable ? c.name : `${c.name} (test it first)`}</option>)}
            </Select>
          )}
        </Field>
        {sources.isPending && connectionId ? <Spinner label="Finding Postal's tables" /> : sources.isError ? <ErrorState error={sources.error} onRetry={() => sources.refetch()} /> : found && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-ink-900">Postal Databases</legend>
              {found.databases.length === 0 && <p className="text-sm text-ink-800">No database on this connection holds every table the pack reads ({pack.needs.tables.join(', ')}).</p>}
              {found.databases.filter((d) => everyDatabase || (d.marketing ?? 1) > 0 || databases.includes(d.name)).map((d) => (
                <Checkbox key={d.name} className="text-sm" checked={databases.includes(d.name)}
                  label={`${d.name} · ${d.messages.toLocaleString()} messages${d.marketing === null ? '' : d.marketing ? ` · ${d.marketing.toLocaleString()} campaign emails` : ' · no campaign email found'}`}
                  onChange={(event) => { setPicked(event.target.checked ? [...databases, d.name] : databases.filter((n) => n !== d.name)); changed() }} />
              ))}
              {quiet > 0 && (
                <button type="button" className="self-start text-xs font-semibold text-brand-800 hover:underline" onClick={() => setEveryDatabase(!everyDatabase)}>
                  {everyDatabase ? 'Show Only Databases With Campaign Mail' : `Show ${quiet} More Without Campaign Mail`}
                </button>
              )}
            </fieldset>
            <Field label="Campaign Names" hint="Optional. Without a table, a campaign is named from its subject and first send.">
              {(ids) => (
                <Select id={ids.id} describedBy={ids.describedBy} value={namesKey} onChange={(event) => { setNames(event.target.value); changed() }}>
                  {found.names.map((n) => <option key={`${n.table}.${n.id}`} value={JSON.stringify(n)}>{`${n.table} (${n.id} → ${n.name})`}</option>)}
                  <option value={NO_NAMES}>None: the subject and first send</option>
                </Select>
              )}
            </Field>
            <Field label="Leave Out" hint="Campaigns whose name contains any of these words, separated by commas">
              {(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={leaveOut} maxLength={200} onChange={(event) => { setLeaveOut(event.target.value); changed() }} />}
            </Field>
            <Field label="Unsubscribe Link Contains" hint="Clicks on links with this in the address count as unsubscribes, not clicks">
              {(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={unsubscribe} maxLength={40} onChange={(event) => { setUnsubscribe(event.target.value); changed() }} />}
            </Field>
          </>
        )}
        {checked && <CheckResult result={checked} />}
      </div>
    </Modal>
  )
}

function CheckResult({ result }: { result: BasePackCheck }) {
  return (
    <section aria-label="Check" className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-subtle p-3 text-sm">
      {result.datasets.map((d) => (
        <p key={d.label} className="flex items-start gap-2">
          {d.ok ? <Check size={16} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0 text-success-text" /> : <X size={16} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0 text-danger-text" />}
          <span>{d.label} <span className="text-xs text-ink-800">· {d.ok ? `ran in ${d.seconds} s` : d.error ?? 'does not fit'}</span></span>
        </p>
      ))}
      {result.ok && result.campaigns !== null && (
        <p className="text-ink-800">{result.campaigns === 0 ? `No campaign sent in the last ${result.days} days: the reports will be empty until one is.` : `${result.campaigns} campaign${result.campaigns === 1 ? '' : 's'} sent in the last ${result.days} days.`}</p>
      )}
      {!result.ok && <Notice tone="error">{result.problems.join(' ')}</Notice>}
    </section>
  )
}

function Added({ pack, added, onClose }: { pack: BasePack; added: BasePackAdded; onClose: () => void }) {
  const navigate = useNavigate()
  const main = added.dashboards[added.dashboards.length - 1]
  const rows: [string, string[]][] = [['Datasets', added.datasets.map((d) => d.label)], ['Reports', added.reports.map((r) => r.name)], ['Dashboards', added.dashboards.map((d) => d.name)], ['Folder', [added.folder.name]]]
  return (
    <Modal title={`${pack.name} Added`} subtitle="Step 3 of 3" size="lg" scrollBody onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-800">Yours to edit; the platform's later versions do not change them.</span>
          <span className="flex-1" />
          <button type="button" className={buttonSecondary} onClick={onClose}>Close</button>
          {main && <button type="button" className={buttonPrimary} onClick={() => { onClose(); navigate(`/insights/dashboards/${main.id}`) }}>{`Open ${main.name}`}</button>}
        </div>
      )}>
      <dl className="flex flex-col rounded-md border border-line-subtle text-sm">
        {rows.map(([label, items]) => (
          <div key={label} className="flex gap-3 border-b border-line-subtle px-3 py-2 last:border-b-0">
            <dt className="w-24 shrink-0 text-xs font-semibold text-ink-800">{label}</dt>
            <dd className="flex-1 text-ink-900">{items.join(', ')}</dd>
            <dd className="text-xs text-ink-800">{items.length}</dd>
          </div>
        ))}
      </dl>
      {!added.recorded && <p className="mt-3 text-xs text-ink-800">The workspace does not record which packs it added until database patch 0079 is applied.</p>}
    </Modal>
  )
}
