/**
 * Create Report (docs/mockups/create-report-dialog-v2.html), in the frame every create pop-up shares. Step 1: the report's name
 * and component, then how to start: from data, with AI (only where the workspace has AI Reports), from a Base Reports pack, or
 * by writing a query. Step 2 picks the data: C360's datasets, the workspace's databases and its uploaded files. Connect a
 * Database and Upload a File are screens of step 2, so nobody leaves the pop-up: connect, test and pick a table; or drop a
 * file and review its columns. Create Report opens the editor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Code2, Database, FileSpreadsheet, FileUp, LayoutTemplate, Mail, Plus, Route, ShoppingCart, Sparkles, Table2, Upload, Users, type LucideIcon } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { ChoiceCard } from '@/apps/cep/features/campaigns/parts'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Field, TextInput } from '@/components/Form'
import { SearchField } from '@/components/SearchField'
import { SetupDialog, type SetupPrimary } from '@/components/SetupDialog'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { insightsApi, keys, uploadsApi, useCatalog } from '../api'
import { useComponents } from '../reportComponents'
import { starterDefinition } from '../starter'
import type { CatalogDataset, QueryTarget, ReportDatabase, UploadedFile } from '../types'
import { BaseReportsDialog } from './BaseReportsDialog'
import { ComponentSelect } from './ComponentSelect'
import { ConnectionStepFields, PickSourceFields } from './ConnectDatabaseDrawer'
import { useConnectionStep, usePickSource } from './connectDatabase'
import { UploadReviewFields } from './UploadReviewDialog'
import { useUploadReview } from './uploadReview'

const STEPS = ['Name and How to Start', 'Choose Your Data']
const ACCEPT = '.csv,.txt,.tsv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DATASET_ICON: Record<string, LucideIcon> = { messages: Mail, attributed_orders: ShoppingCart, contacts: Users, journey_enrolments: Route }

type Start = 'data' | 'ai' | 'base' | 'query'
type Screen = 'pick' | 'connect' | 'tables' | 'upload' | 'review'
type Choice = { kind: 'dataset'; key: string } | { kind: 'query'; id: string }

/** a few fields people would group or count by, in plain words, never personal data */
function fieldWords(dataset: CatalogDataset): string {
  const open = dataset.fields.filter((f) => f.sensitivity !== 'PII')
  const labels = [...open.filter((f) => f.role === 'dimension'), ...open.filter((f) => f.role === 'measure')].map((f) => f.label)
  return labels.length > 5 ? `${labels.slice(0, 5).join(', ')}…` : labels.join(', ')
}

/** initialDataset: ?dataset= (a file just saved on Uploaded Files), opened on step 2 with it picked; wanted: ?component= */
export function CreateReportDialog({ onClose, initialDataset, wanted, canConnect }: { onClose: () => void; initialDataset?: string | null; wanted?: string | null; canConnect: boolean }) {
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const { can, me } = useAuth()
  const catalog = useCatalog()
  const components = useComponents()
  const targets = useQuery({ queryKey: ['workspace', 'report-databases', 'targets'], queryFn: ({ signal }) => api.get<{ databases: QueryTarget[] }>('/workspace/report-databases/targets/', undefined, signal), retry: false })
  const uploads = useQuery({ queryKey: keys.uploads, queryFn: ({ signal }) => uploadsApi.list(signal), enabled: canConnect, retry: false })

  const [step, setStep] = useState(initialDataset ? 2 : 1)
  const [name, setName] = useState('')
  const [component, setComponent] = useState<string | null | undefined>(undefined)           // undefined: not chosen here
  const [start, setStart] = useState<Start>('data')
  const [screen, setScreen] = useState<Screen>('pick')
  const [choice, setChoice] = useState<Choice | null>(initialDataset ? { kind: 'dataset', key: initialDataset } : null)
  const [search, setSearch] = useState('')
  const [base, setBase] = useState(false)
  const [database, setDatabase] = useState<ReportDatabase | null>(null)
  const [draft, setDraft] = useState<UploadedFile | null>(null)
  const chooser = useRef<HTMLInputElement>(null)

  const narrowed = (catalog.data?.datasets ?? []).filter((d) => !wanted || d.component.key === wanted)
  // opened from a component with no datasets of its own (reports filed under it): every dataset, the report filed there
  const datasets = narrowed.length || !catalog.data ? narrowed : catalog.data.datasets
  const chosen = choice?.kind === 'dataset' ? datasets.find((d) => d.key === choice.key) ?? null : null
  const filed = component === undefined ? (wanted && !narrowed.length && components.nameOf(wanted) ? wanted : null) : component
  const naming = { name, component: filed }
  const reportName = (label: string) => name.trim() || `${label} report`

  const create = useMutation({
    mutationFn: (dataset: CatalogDataset) => insightsApi.create({ name: reportName(dataset.label), dataset: dataset.key, definition: starterDefinition(dataset), ...(filed ? { component: filed } : {}) }),
    onSuccess: (report) => navigate(`/insights/reports/${report.id}/edit`, { replace: true }),
    onError: (error) => toast.failure(error, 'The report was not created'),
  })
  const createFromKey = useMutation({
    mutationFn: async (key: string) => {
      const fresh = await client.fetchQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => insightsApi.catalog(signal), staleTime: 0 })
      const shape = fresh.datasets.find((d) => d.key === key)
      if (!shape) throw new Error('The new dataset is not in the catalogue yet. Try again in a moment.')
      return insightsApi.create({ name: reportName(shape.label), dataset: shape.key, definition: starterDefinition(shape), ...(filed ? { component: filed } : {}) })
    },
    onSuccess: (report) => navigate(`/insights/reports/${report.id}/edit`, { replace: true }),
    onError: (error) => toast.failure(error, 'The report was not created'),
  })
  const connection = useConnectionStep((saved) => { setDatabase(saved); setScreen('tables') })
  const pick = usePickSource(database, naming)
  const review = useUploadReview(draft, (saved) => createFromKey.mutate(saved.key))
  const upload = useMutation({
    mutationFn: (file: File) => uploadsApi.upload(file),
    onSuccess: (read) => { client.invalidateQueries({ queryKey: keys.uploads }); setDraft(read); setScreen('review') },
    onError: (error) => toast.failure(error, 'The file was not read'),
  })

  const askAi = can('report.edit') && Boolean(me?.insights?.ai_reports)
  const canUpload = canConnect && Boolean(uploads.data?.ready)
  const term = search.trim().toLowerCase()
  const found = (d: CatalogDataset) => !term || [d.label, d.description ?? '', ...d.fields.map((f) => f.label)].some((text) => text.toLowerCase().includes(term))
  const platform = datasets.filter((d) => !d.database && d.kind !== 'upload' && found(d))
  const own = datasets.filter((d) => d.database && found(d))
  const files = datasets.filter((d) => d.kind === 'upload' && found(d))
  const queryTargets = (targets.data?.databases ?? []).filter((t) => !term || `${t.name} ${t.database_name}`.toLowerCase().includes(term))
  const queryOnly = start === 'query'

  if (base) return <BaseReportsDialog onClose={onClose} />

  const next = () => {
    if (start === 'ai') navigate(`/insights/ai-reports${name.trim() ? `?name=${encodeURIComponent(name.trim())}` : ''}`)
    else if (start === 'base') setBase(true)
    else { setStep(2); setScreen('pick'); setChoice(null); setSearch('') }
  }
  const back = () => {
    if (screen === 'tables') setScreen('connect')
    else if (screen === 'review') setScreen('upload')
    else if (screen !== 'pick') setScreen('pick')
    else setStep(1)
  }
  const finish = () => {
    if (choice?.kind === 'query') navigate(`/insights/reports/new/query/${choice.id}`)
    else if (chosen) create.mutate(chosen)
  }

  const primary: SetupPrimary =
    step === 1 ? { label: start === 'ai' ? 'Open AI Reports' : start === 'base' ? 'Choose a Pack' : 'Next', onClick: next }
    : screen === 'connect' ? { label: 'Save and Continue', form: 'create-report-connect', disabled: !connection.usable, busy: connection.save.isPending, busyLabel: 'Saving' }
    : screen === 'tables' ? { label: 'Create Report', disabled: !pick.chosen, busy: pick.create.isPending, busyLabel: 'Creating', onClick: () => pick.chosen && pick.create.mutate(pick.chosen) }
    : screen === 'upload' ? { label: 'Next', disabled: true }
    : screen === 'review' ? (review.confirming
        ? { label: 'Change Anyway', busy: review.save.isPending || createFromKey.isPending, busyLabel: 'Creating', onClick: () => review.save.mutate(true) }
        : { label: 'Save and Create Report', disabled: !review.name.trim(), busy: review.save.isPending || createFromKey.isPending, busyLabel: 'Creating', onClick: () => review.save.mutate(false) })
    : { label: choice?.kind === 'query' ? 'Write the Query' : 'Create Report', disabled: !choice, busy: create.isPending, busyLabel: 'Creating', onClick: finish }

  const trail = (...steps: { label: string; to?: Screen }[]) => (
    <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1.5 text-helper text-ink-800">
      {steps.map((item, index) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {index > 0 && <ChevronRight size={12} strokeWidth={1.5} aria-hidden />}
          {item.to ? <button type="button" className="font-medium text-link hover:underline" onClick={() => setScreen(item.to as Screen)}>{item.label}</button> : <span aria-current="step" className="font-semibold text-ink-900">{item.label}</span>}
        </span>
      ))}
    </nav>
  )
  const dropped = (event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) upload.mutate(file)
  }

  const tiles: { id: Start; title: string; text: string; icon: LucideIcon }[] = [
    { id: 'data', title: 'Start from Data', text: 'Pick a dataset, one of your databases or a file, then choose what to show.', icon: Table2 },
    ...(askAi ? [{ id: 'ai' as const, title: 'Ask AI', text: 'Describe the report in your own words, and AI drafts it for you to check.', icon: Sparkles }] : []),
    { id: 'base', title: 'Use Base Reports', text: 'Add a ready-made pack, such as Email Campaign Reports, as your own copies.', icon: LayoutTemplate },
    { id: 'query', title: 'Write a Query', text: 'Pick tables and columns, or write the SELECT, on one of your databases.', icon: Code2 },
  ]

  return (
    <SetupDialog title="Create Report" steps={STEPS} step={step} onClose={onClose} onBack={step === 2 ? back : undefined} primary={primary}
      extraActions={screen === 'connect' && step === 2 ? <Button variant="secondary" loading={connection.test.isPending} onClick={() => connection.test.mutate()}>Test Connection</Button> : undefined}>
      {step === 1 ? (
        <>
          <div className="flex flex-col gap-5">
            <Field label="Report Name" hint="You can rename it later." strong>
              {({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} value={name} onChange={(event) => setName(event.target.value)} maxLength={200} placeholder="Named after its data unless you name it" autoFocus />}
            </Field>
            {components.ready && (
              <Field label="Component" hint="Where the report is listed. Automatic files it with its data." strong>
                {({ id, describedBy }) => <ComponentSelect id={id} describedBy={describedBy} value={filed} auto={chosen?.component.key ?? null} onChange={setComponent} />}
              </Field>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <h3 id="create-report-start" className="text-sm font-semibold text-ink-900">How Do You Want to Start?</h3>
            <div role="radiogroup" aria-labelledby="create-report-start" className={`grid grid-cols-1 gap-3 ${tiles.length === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
              {tiles.map((tile) => (
                <ChoiceCard key={tile.id} tile selected={start === tile.id} onSelect={() => setStart(tile.id)} title={tile.title} text={tile.text}
                  icon={<tile.icon size={20} strokeWidth={1.5} />} badge={tile.id === 'data' ? 'Most Common' : undefined} />
              ))}
            </div>
          </div>
        </>
      ) : screen === 'connect' ? (
        <>
          {trail({ label: 'Choose Your Data', to: 'pick' }, { label: 'Connect a Database' })}
          <ConnectionStepFields step={connection} formId="create-report-connect" />
        </>
      ) : screen === 'tables' ? (
        <>
          {trail({ label: 'Choose Your Data', to: 'pick' }, { label: 'Connect a Database', to: 'connect' }, { label: 'A Table or View' })}
          <PickSourceFields pick={pick} />
        </>
      ) : screen === 'upload' ? (
        <>
          {trail({ label: 'Choose Your Data', to: 'pick' }, { label: 'Upload a File' })}
          <div onDragOver={(event) => event.preventDefault()} onDrop={dropped}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-control bg-surface-subtle px-6 py-10 text-center">
            <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-md bg-brand-100 text-brand-800"><Upload size={20} strokeWidth={1.5} /></span>
            {upload.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Reading the file</p> : (
              <>
                <p className="text-sm font-semibold text-ink-900">Drop a CSV or Excel file here</p>
                <p className="max-w-md text-helper text-ink-800">
                  or <button type="button" className="font-medium text-link hover:underline" onClick={() => chooser.current?.click()}>choose a file</button>. The first row names the columns; in a workbook the first sheet is read.
                  {uploads.data?.limits ? ` Up to ${formatNumber(uploads.data.limits.rows)} rows, ${uploads.data.limits.columns} columns and ${Math.round(uploads.data.limits.bytes / 1048576)} MB.` : ''}
                </p>
              </>
            )}
            <input ref={chooser} type="file" accept={ACCEPT} className="hidden" aria-label="Choose a file to upload" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload.mutate(file) }} />
          </div>
        </>
      ) : screen === 'review' ? (
        <>
          {trail({ label: 'Choose Your Data', to: 'pick' }, { label: 'Upload a File', to: 'upload' }, { label: 'Review the Columns' })}
          {draft && <p className="text-helper text-ink-800">{draft.file_name} · {formatNumber(draft.row_count)} rows · {draft.columns.length} columns</p>}
          <UploadReviewFields review={review} />
          {review.confirming && review.conflict && <p className="text-helper text-ink-800">{review.conflict.problem?.detail}</p>}
        </>
      ) : catalog.isPending ? <Spinner label="Loading the datasets" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : (
        <>
          <SearchField label="Search your data" value={search} onChange={setSearch} wide />
          {!queryOnly && platform.length > 0 && (
            <DataGroup title="C360 Data">
              {platform.map((d) => <DataCard key={d.key} icon={DATASET_ICON[d.key] ?? Table2} title={d.label} text={d.description ?? ''} detail={fieldWords(d)} selected={choice?.kind === 'dataset' && choice.key === d.key} onSelect={() => setChoice({ kind: 'dataset', key: d.key })} />)}
            </DataGroup>
          )}
          {(queryTargets.length + own.length > 0 || canConnect) && (
            <DataGroup title="Your Databases">
              {queryTargets.map((t) => <DataCard key={t.id} icon={Code2} title={`Query ${t.name}`} text={`${t.engine_name} · ${t.database_name}`} detail="Pick tables, joins and calculations, or write the SELECT." selected={choice?.kind === 'query' && choice.id === t.id} onSelect={() => setChoice({ kind: 'query', id: t.id })} />)}
              {!queryOnly && own.map((d) => <DataCard key={d.key} icon={Database} title={d.label} text={[`${d.database?.name} (${d.database?.engine_name})`, d.kind === 'query' ? 'from a query' : null].filter(Boolean).join(' · ')} detail={fieldWords(d)} selected={choice?.kind === 'dataset' && choice.key === d.key} onSelect={() => setChoice({ kind: 'dataset', key: d.key })} />)}
              {canConnect && <AddCard icon={Plus} title="Connect a Database" text="MySQL, PostgreSQL or ClickHouse, read-only. Set it up here." onClick={() => setScreen('connect')} />}
            </DataGroup>
          )}
          {!queryOnly && (files.length > 0 || canUpload) && (
            <DataGroup title="Your Files">
              {files.map((d) => <DataCard key={d.key} icon={FileSpreadsheet} title={d.label} text={`${d.upload?.file_name} · ${formatNumber(d.upload?.row_count ?? 0)} rows`} detail={fieldWords(d)} selected={choice?.kind === 'dataset' && choice.key === d.key} onSelect={() => setChoice({ kind: 'dataset', key: d.key })} />)}
              {canUpload && <AddCard icon={FileUp} title="Upload a File" text="A CSV or Excel file. Review its columns here, then report on it." onClick={() => setScreen('upload')} />}
            </DataGroup>
          )}
          {term && platform.length + own.length + files.length + queryTargets.length === 0 && <p className="text-sm text-ink-800">Nothing matches “{search.trim()}”.</p>}
        </>
      )}
    </SetupDialog>
  )
}

function DataGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <div role="radiogroup" aria-label={title} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function DataCard({ icon: Icon, title, text, detail, selected, onSelect }: { icon: LucideIcon; title: string; text: string; detail: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={title} onClick={onSelect}
      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-fast ease-standard ${selected ? 'border-link bg-brand-100' : 'border-line bg-surface hover:bg-surface-hover'}`}>
      <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-surface text-link' : 'bg-fill-subtle text-ink-800'}`}><Icon size={16} strokeWidth={1.5} /></span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${selected ? 'text-brand-800' : 'text-ink-900'}`}>{title}</span>
        {text && <span className="block text-helper text-ink-800">{text}</span>}
        {detail && <span className="mt-0.5 block truncate text-xs text-ink-700">{detail}</span>}
      </span>
    </button>
  )
}

function AddCard({ icon: Icon, title, text, onClick }: { icon: LucideIcon; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-lg border border-dashed border-line-control bg-surface p-3 text-left transition-colors duration-fast ease-standard hover:bg-surface-hover">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-dashed border-line-control text-link"><Icon size={16} strokeWidth={1.5} /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-link">{title}</span>
        <span className="block text-helper text-ink-800">{text}</span>
      </span>
    </button>
  )
}
