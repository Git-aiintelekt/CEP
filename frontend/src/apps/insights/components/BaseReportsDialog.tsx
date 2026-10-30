/**
 * Add Base Reports (docs/mockups/add-base-reports.html): the platform's ready-made report packs, added as this workspace's own
 * copies, in the frame every create pop-up shares. 1 Choose a Pack, with what is in it shown up front. 2 Connect Your Email
 * Data: the connection reaching the pack's tables (connected here when the workspace has none), the databases on it holding
 * campaign mail (ticked for you), and More Options (where campaign names live, words to leave out, the unsubscribe link).
 * 3 Check and Add: each dataset is test-run as the step opens, then Add makes everything in one go. Then what was made.
 * Later versions of a pack never change what was added; adding it again makes new copies.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, FileBarChart, Info, LayoutDashboard, Mails, ShieldCheck, Table2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { ChoiceCard } from '@/apps/cep/features/campaigns/parts'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Checkbox } from '@/components/Checkbox'
import { Field, Select, TextInput, buttonSecondary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { SetupDialog, type SetupPrimary } from '@/components/SetupDialog'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { formatDate } from '@/lib/format'
import { baseReportsApi } from '../api'
import { ENGINE_LABEL } from '../databaseConnection'
import type { BasePack, BasePackAdded, BasePackCheck, BasePackOptions, BasePackSources, DatabaseEngine } from '../types'
import { ConnectionStepFields } from './ConnectDatabaseDrawer'
import { useConnectionStep } from './connectDatabase'

const NO_NAMES = ''
const STEPS = ['Choose a Pack', 'Connect Your Email Data', 'Check and Add']
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function BaseReportsDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const { tenant } = useAuth()
  const catalog = useQuery({ queryKey: ['insights', 'base-reports'], queryFn: ({ signal }) => baseReportsApi.list(signal) })
  const [step, setStep] = useState(1)
  const [packKey, setPackKey] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[] | null>(null)
  const [names, setNames] = useState<string | null>(null)
  const [leaveOut, setLeaveOut] = useState('test')
  const [unsubscribe, setUnsubscribe] = useState('unsubscribe')
  const [everyDatabase, setEveryDatabase] = useState(false)
  const [checked, setChecked] = useState<BasePackCheck | null>(null)
  const [added, setAdded] = useState<BasePackAdded | null>(null)

  const packs = catalog.data?.packs ?? []
  const pack: BasePack | undefined = packs.find((p) => p.key === packKey) ?? packs[0]
  const readable = (catalog.data?.connections ?? []).filter((c) => pack && c.engine.startsWith(pack.needs.engine))
  // a new connection can only be one the pack reads: MySQL 5.7 or 8.0 for the Postal pack
  const packEngines = pack ? (Object.keys(ENGINE_LABEL) as DatabaseEngine[]).filter((engine) => engine.startsWith(pack.needs.engine)) : undefined
  const connection = readable.find((c) => c.id === connectionId) ?? readable.find((c) => c.usable) ?? null
  const showConnect = connecting || (step === 2 && !connection)
  const sources = useQuery({
    queryKey: ['insights', 'base-reports', pack?.key, 'sources', connection?.id],
    queryFn: () => baseReportsApi.sources((pack as BasePack).key, (connection as { id: string }).id),
    enabled: Boolean(pack && connection && step >= 2 && !showConnect), retry: false,
  })
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
  const words = leaveOut.split(',').map((w) => w.trim()).filter(Boolean)
  const namedFrom = found?.names.find((n) => JSON.stringify(n) === namesKey)

  const connect = useConnectionStep((saved) => {
    void client.invalidateQueries({ queryKey: ['insights', 'base-reports'] })
    setConnectionId(saved.id)
    setConnecting(false)
    setPicked(null)
    setNames(null)
  })
  const check = useMutation({
    mutationFn: () => baseReportsApi.check((pack as BasePack).key, (connection as { id: string }).id, options),
    onSuccess: setChecked,
    onError: (error) => toast.failure(error, 'The check did not run'),
  })
  const add = useMutation({
    mutationFn: () => baseReportsApi.add((pack as BasePack).key, (connection as { id: string }).id, options),
    onSuccess: (made) => { void client.invalidateQueries({ queryKey: ['insights'] }); setAdded(made) },
    onError: (error) => toast.failure(error, `${pack?.name} was not added`),
  })

  const changed = () => setChecked(null)
  const toStep3 = () => { setStep(3); setChecked(null); check.mutate() }
  const back = () => {
    if (step === 2 && connecting && connection) setConnecting(false)
    else setStep(step - 1)
  }
  const canAdd = Boolean(catalog.data?.can_add)

  if (added && pack) {
    const main = added.dashboards[added.dashboards.length - 1]
    return (
      <SetupDialog title="Add Base Reports" onClose={onClose} hideCancel
        primary={main ? { label: `Open ${main.name}`, onClick: () => { onClose(); navigate(`/insights/dashboards/${main.id}`) } } : { label: 'Close', onClick: onClose }}
        extraActions={<button type="button" className={buttonSecondary} onClick={() => { onClose(); navigate(`/insights/reports?folder=${added.folder.id}`) }}>See the Reports</button>}>
        <div className="flex flex-col items-center gap-2 text-center">
          <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success-text"><Check size={24} strokeWidth={2} /></span>
          <h3 className="font-display text-section-title font-semibold text-ink-900">{pack.name} Added</h3>
          <p className="max-w-md text-sm text-ink-800">They are yours to edit, filed in the {added.folder.name} folder. Later versions of the pack never change them.</p>
        </div>
        <dl className="flex flex-col rounded-lg border border-line text-sm">
          {([['Dashboards', added.dashboards.map((d) => d.name)], ['Reports', added.reports.map((r) => r.name)], ['Datasets', added.datasets.map((d) => d.label)], ['Folder', [added.folder.name]]] as [string, string[]][]).map(([label, items]) => (
            <div key={label} className="flex gap-3 border-b border-line-subtle px-3.5 py-2.5 last:border-b-0">
              <dt className="w-24 shrink-0 text-label font-medium text-ink-800">{label}</dt>
              <dd className="min-w-0 flex-1 text-ink-900">{items.join(', ')}</dd>
              <dd className="cep-num text-helper text-ink-800">{items.length}</dd>
            </div>
          ))}
        </dl>
        {!added.recorded && <p className="text-helper text-ink-800">The workspace does not record which packs it added until database patch 0079 is applied.</p>}
      </SetupDialog>
    )
  }

  const primary: SetupPrimary =
    step === 1 ? { label: pack?.added[0] ? 'Add Again' : 'Next', disabled: !pack || !canAdd, onClick: () => setStep(2) }
    : step === 2 && showConnect ? { label: 'Save and Continue', form: 'base-reports-connect', disabled: !connect.usable, busy: connect.save.isPending, busyLabel: 'Saving' }
    : step === 2 ? { label: 'Next', disabled: !connection || databases.length === 0 || sources.isPending, onClick: toStep3 }
    : checked?.ok ? { label: `Add ${plural(pack?.contents.reports.length ?? 0, 'Report')} and ${plural(pack?.contents.dashboards.length ?? 0, 'Dashboard')}`, busy: add.isPending, busyLabel: 'Adding', onClick: () => add.mutate() }
    : { label: 'Check Again', busy: check.isPending, busyLabel: 'Checking', disabled: check.isPending, onClick: () => check.mutate() }

  return (
    <SetupDialog title="Add Base Reports" steps={STEPS} step={step} onClose={onClose} onBack={step > 1 ? back : undefined} primary={primary} locked={add.isPending}
      extraActions={step === 2 && showConnect ? <Button variant="secondary" loading={connect.test.isPending} onClick={() => connect.test.mutate()}>Test Connection</Button> : undefined}>
      {catalog.isPending ? <Spinner label="Loading the base reports" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : !pack ? (
        <p className="text-sm text-ink-800">No base reports are offered yet.</p>
      ) : step === 1 ? (
        <>
          <p className="text-sm text-ink-800">Ready-made reports and dashboards from the platform, added as your own copies so you can change them.</p>
          {packs.length > 1 && (
            <div role="radiogroup" aria-label="Packs" className="grid gap-3 sm:grid-cols-2">
              {packs.map((p) => <ChoiceCard key={p.key} tile selected={p.key === pack.key} onSelect={() => { setPackKey(p.key); setConnectionId(null); setPicked(null); setNames(null) }} title={p.name} text={p.summary} icon={<Mails size={20} strokeWidth={1.5} />} />)}
            </div>
          )}
          <PackDetail pack={pack} />
          {!canAdd && <Notice tone="info">A report administrator adds base reports.</Notice>}
          {canAdd && pack.added[0] && <p className="text-helper text-ink-800">Already added. Adding it again makes a second set of copies{tenant ? ` for ${tenant}` : ''}, on the data you connect now.</p>}
        </>
      ) : step === 2 && showConnect ? (
        <>
          <div className="flex gap-3 rounded-lg bg-callout-bg p-3.5 text-sm text-callout-text">
            <Info size={20} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-callout-icon" />
            <p>These reports read your <span className="font-semibold">email sending records</span>: every message, delivery, open and click, as kept by Postal, the server that sends your campaigns. They sit in a MySQL database: connect it once, here.</p>
          </div>
          <ConnectionStepFields step={connect} formId="base-reports-connect" engines={packEngines} />
        </>
      ) : step === 2 && connection ? (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-line p-3.5">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success-bg text-success-text"><ShieldCheck size={20} strokeWidth={1.5} /></span>
            <span className="min-w-0 flex-1">
              {readable.length > 1 ? (
                <Select aria-label="Connection" controlSize="sm" value={connection.id} onChange={(event) => { setConnectionId(event.target.value); setPicked(null); setNames(null); changed() }}>
                  {readable.map((c) => <option key={c.id} value={c.id} disabled={!c.usable}>{c.usable ? c.name : `${c.name} (test it first)`}</option>)}
                </Select>
              ) : <span className="block text-sm font-semibold text-ink-900">{connection.name}</span>}
              <span className="block text-helper text-ink-800">MySQL · connected and read-only</span>
            </span>
            <button type="button" className="shrink-0 text-sm font-medium text-link hover:underline" onClick={() => setConnecting(true)}>Connect Another</button>
          </div>
          {sources.isPending ? <Spinner label="Finding Postal's tables" /> : sources.isError ? <ErrorState error={sources.error} onRetry={() => sources.refetch()} /> : found && (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold text-ink-900">Which Databases Hold Your Campaign Mail?</legend>
                <p className="-mt-1 text-helper text-ink-800">Insights looked for Postal's tables and ticked the ones with campaign emails.</p>
                {found.databases.length === 0 && <p className="text-sm text-ink-800">No database on this connection holds every table the pack reads ({pack.needs.tables.join(', ')}).</p>}
                {found.databases.filter((d) => everyDatabase || (d.marketing ?? 1) > 0 || databases.includes(d.name)).map((d) => {
                  const on = databases.includes(d.name)
                  return (
                    <div key={d.name} className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 ${on ? 'border-link bg-brand-100' : 'border-line bg-surface'}`}>
                      <Checkbox className="min-w-0 flex-1 text-sm" checked={on}
                        label={`${d.name} · ${d.messages.toLocaleString()} messages${d.marketing === null ? '' : d.marketing ? ` · ${d.marketing.toLocaleString()} campaign emails` : ' · no campaign email found'}`}
                        onChange={(event) => { setPicked(event.target.checked ? [...databases, d.name] : databases.filter((n) => n !== d.name)); changed() }} />
                      {(d.marketing ?? 0) > 0 && <Tag tone="success">Campaign mail found</Tag>}
                    </div>
                  )
                })}
                {quiet > 0 && (
                  <button type="button" className="self-start text-helper font-semibold text-link hover:underline" onClick={() => setEveryDatabase(!everyDatabase)}>
                    {everyDatabase ? 'Show Only Databases With Campaign Mail' : `Show ${quiet} More Without Campaign Mail`}
                  </button>
                )}
              </fieldset>
              <details className="group rounded-lg border border-line">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-sm font-semibold text-ink-900">
                  <ChevronDown size={16} strokeWidth={1.5} aria-hidden className="shrink-0 transition-transform group-open:rotate-180" /><span className="shrink-0 whitespace-nowrap">More Options</span>
                  <span className="min-w-0 truncate font-normal text-helper text-ink-800">
                    · {namedFrom ? `names from ${namedFrom.table}` : 'names from the subject and first send'} · {words.length ? `leaving out “${words.join('”, “')}”` : 'leaving nothing out'} · {unsubscribe.trim() ? `unsubscribe links contain “${unsubscribe.trim()}”` : 'no unsubscribe link'}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 px-3.5 pb-3.5">
                  <Field label="Campaign Names" hint="Optional. Without a table, a campaign is named from its subject and first send.">
                    {(ids) => (
                      <Select id={ids.id} describedBy={ids.describedBy} value={namesKey} onChange={(event) => { setNames(event.target.value); changed() }}>
                        {found.names.map((n) => <option key={`${n.table}.${n.id}`} value={JSON.stringify(n)}>{`${n.table} (${n.id} → ${n.name})`}</option>)}
                        <option value={NO_NAMES}>None: the subject and first send</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Leave Out" hint="Campaigns whose name contains any of these words, separated by commas: test sends and internal mail">
                    {(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={leaveOut} maxLength={200} onChange={(event) => { setLeaveOut(event.target.value); changed() }} />}
                  </Field>
                  <Field label="Unsubscribe Link Contains" hint="Clicks on links with this in the address count as unsubscribes, not clicks">
                    {(ids) => <TextInput id={ids.id} describedBy={ids.describedBy} value={unsubscribe} maxLength={40} onChange={(event) => { setUnsubscribe(event.target.value); changed() }} />}
                  </Field>
                </div>
              </details>
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-ink-800">Each dataset runs once on your data before anything is added. Nothing is made unless every check passes.</p>
          <ul aria-label="Checks" className="flex flex-col rounded-lg border border-line">
            {(checked?.datasets ?? pack.contents.datasets.map((label) => ({ label, ok: false, seconds: 0, error: undefined as string | undefined, waiting: true }))).map((d) => (
              <li key={d.label} className="flex items-center gap-3 border-b border-line-subtle px-3.5 py-2.5 text-sm last:border-b-0">
                {'waiting' in d ? <Spinner size="sm" label={`Checking ${d.label}`} /> : d.ok ? <Check size={16} strokeWidth={2} aria-hidden className="shrink-0 text-success-text" /> : <X size={16} strokeWidth={2} aria-hidden className="shrink-0 text-danger-text" />}
                <span className="text-ink-900">{d.label}</span>
                <span className="ml-auto text-helper text-ink-800">{'waiting' in d ? (check.isPending ? 'Checking' : '') : d.ok ? `ran in ${d.seconds} s` : d.error ?? 'does not fit'}</span>
              </li>
            ))}
          </ul>
          {checked && !checked.ok && <Notice tone="error">{checked.problems.join(' ')}</Notice>}
          {checked?.ok && checked.campaigns !== null && (
            <p className="flex items-center gap-2 rounded-lg bg-success-bg px-3.5 py-2.5 text-sm text-success-text">
              <Check size={16} strokeWidth={2} aria-hidden />{checked.campaigns === 0 ? `No campaign sent in the last ${checked.days} days: the reports will be empty until one is.` : `${plural(checked.campaigns, 'campaign')} sent in the last ${checked.days} days.`}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Count label="Folder" value={pack.name} small="New, for these reports" />
            <Count label="Dashboards" value={pack.contents.dashboards.length} />
            <Count label="Reports" value={pack.contents.reports.length} />
            <Count label="Datasets" value={pack.contents.datasets.length} />
          </div>
        </>
      )}
    </SetupDialog>
  )
}

/** a pack's name, version, what it needs or when it was added, its summary, and what is in it */
function PackDetail({ pack }: { pack: BasePack }) {
  const latest = pack.added[0]
  return (
    <section aria-label={pack.name} className="flex flex-col gap-3 rounded-lg border border-link bg-brand-100 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Mails size={20} strokeWidth={1.5} aria-hidden className="text-link" />
        <h3 className="text-base font-semibold text-brand-800">{pack.name}</h3>
        <Tag tone="neutral">{`Version ${pack.version}`}</Tag>
        {pack.source && <Tag tone="neutral">{`From ${pack.source}`}</Tag>}
        {pack.chosen && !latest && <Tag tone="neutral">Chosen at Onboarding</Tag>}
        {latest ? <Tag tone="success">{`Added ${formatDate(latest.at)} · Version ${latest.version}`}</Tag> : <Tag tone="neutral">{`Needs ${pack.needs.label}`}</Tag>}
      </div>
      <p className="text-sm text-ink-800">{pack.summary}</p>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Contents icon={<LayoutDashboard size={16} strokeWidth={1.5} />} label="Dashboards" items={pack.contents.dashboards} />
        <Contents icon={<FileBarChart size={16} strokeWidth={1.5} />} label="Reports" items={pack.contents.reports} />
        <Contents icon={<Table2 size={16} strokeWidth={1.5} />} label="Datasets" items={pack.contents.datasets} />
      </div>
    </section>
  )
}

function Contents({ icon, label, items }: { icon: ReactNode; label: string; items: string[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 4)
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line-subtle bg-surface p-3">
      <span className="flex items-center gap-2 text-label font-semibold text-ink-900">
        <span aria-hidden className="text-link">{icon}</span>{label}<span className="cep-num ml-auto font-display text-lg font-semibold">{items.length}</span>
      </span>
      <ul aria-label={label} className="text-xs leading-relaxed text-ink-800">{shown.map((item) => <li key={item}>{item}</li>)}</ul>
      {items.length > shown.length && <button type="button" className="self-start text-xs font-medium text-link hover:underline" onClick={() => setAll(true)}>See All {items.length}</button>}
    </div>
  )
}

function Count({ label, value, small }: { label: string; value: string | number; small?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line p-3">
      <span className="text-xs text-ink-800">{label}</span>
      <span className={`cep-num font-semibold text-ink-900 ${typeof value === 'number' ? 'font-display text-kpi' : 'text-sm'}`}>{value}</span>
      {small && <span className="text-xs text-ink-700">{small}</span>}
    </div>
  )
}

