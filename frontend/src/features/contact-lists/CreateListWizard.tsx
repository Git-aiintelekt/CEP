/**
 * New Contact List: one dialog, three ways in.
 *   Upload a file        name -> file -> match columns -> review -> done   (the list is a DRAFT until the import is added)
 *   BI / extraction      name -> choose an audience -> done
 *   Clone a list         name -> choose the list to copy -> done
 * A file is never processed while the operator waits on a request: the upload answers at once and a background worker
 * reads, checks and imports it. The wizard shows the progress; "Continue in the background" closes it and leaves the job
 * running (the header's upload button and an alert tell the operator when it is done; the uploads page resumes it).
 * Cancel removes the draft and stops its job, so a half-finished upload never becomes a list.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, Database, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { Field, Select, TextArea, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { useFieldRules } from '@/lib/fieldRules'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Audience, ConsentBasis, ContactList, ListImport, ListSource, Page, ListChannel } from '@/lib/types'

import { problemText } from './problem'
import { POLL_MS, watchedUploads } from './uploadJobs'
import { UploadReport } from './UploadReport'
import { downloadTemplate, formatLine, uploadColumns } from './uploadTemplate'
import { ProgressBar } from './UploadsIndicator'

type Step = 'method' | 'file' | 'map' | 'consent' | 'review' | 'importing' | 'audience' | 'clone' | 'done'

const STEPS: Record<ListSource, Step[]> = {
  UPLOAD: ['method', 'file', 'map', 'consent', 'review', 'done'],                        // 'importing' is the tail of the review step
  BI: ['method', 'audience', 'done'],
  CLONE: ['method', 'clone', 'done'],
}

const TITLES: Record<Step, [string, string]> = {
  method: ['New Contact List', ''],
  file: ['Add Your File', 'Upload the CSV that holds your contacts.'],
  map: ['Match Your Columns', 'Tell CEP what each column in your file means.'],
  consent: ['Where Did These People Agree?', 'Every upload records its consent basis. It is kept with the list and shown on its compliance record.'],
  review: ['Review Before Importing', 'Check what comes in and what gets held back.'],
  importing: ['Importing Your Contacts', 'This runs in the background. You can keep working.'],
  audience: ['Choose an Audience', 'Pick an audience your data team already defined.'],
  clone: ['Choose a List to Copy', 'Pick the list you want to start from.'],
  done: ['List Created', "Here's where to find it and what happens next."],
}

const SOURCES: { value: ListSource; title: string; text: string; icon: ReactNode; badge?: string }[] = [
  { value: 'UPLOAD', title: 'Upload a File', text: 'Import a CSV, map the columns, review before adding.', icon: <Upload size={18} strokeWidth={1.5} aria-hidden />, badge: 'Most Common' },
  { value: 'BI', title: 'BI or Extraction Tool', text: 'Choose an audience someone already defined.', icon: <Database size={18} strokeWidth={1.5} aria-hidden /> },
  { value: 'CLONE', title: 'Clone a List', text: 'Copy a list you have and adjust from there.', icon: <Copy size={18} strokeWidth={1.5} aria-hidden /> },
]

const BASIS_TEXT: Record<ConsentBasis, string> = {
  WEB_FORM: 'A form with a marketing opt-in. The form name goes in the evidence.',
  IN_STORE: 'Paper or POS sign-up with a marketing tick box.',
  CUSTOMER_REQUEST: 'An email, a call or a message to customer service, recorded there.',
  IMPLIED: 'Bought from us in the last two years and never opted out. Marketing texts cannot use this basis.',
}

const TYPES = [
  { value: 'PRODUCTION', title: 'Production', text: 'Available to Corporate Communication Governance sends.' },
  { value: 'TEST', title: 'Test', text: 'Held out of governed sends until you promote it.' },
]

const CHANNELS: { value: ListChannel; title: string; text: string }[] = [
  { value: 'EMAIL', title: 'Email', text: 'An email address per row. For email campaigns.' },
  { value: 'SMS', title: 'Texts', text: 'A mobile number per row; an address is optional. For SMS and MMS campaigns.' },
  { value: 'BOTH', title: 'Email and Texts', text: 'An address and a number per row. One list for every channel.' },
]

/** Under the drop zone: the file format in one line, the columns the import knows, and the sample to download. */
function TemplateNote({ channel }: { channel: ListChannel }) {
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-4" data-upload-template>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">File Format</p>
          <p className="mt-1 text-xs text-ink-800">{formatLine(channel)}</p>
        </div>
        <button type="button" className={buttonSecondary} onClick={() => downloadTemplate(channel)}>
          <Download size={16} strokeWidth={1.5} aria-hidden />Download Sample CSV
        </button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Columns the import recognises">
        {uploadColumns(channel).map((column) => (
          <li key={column.header} title={column.note || undefined}
            className={`rounded-sm border px-2 py-0.5 text-xs ${column.required ? 'border-brand-600 bg-brand-100 font-semibold text-brand-800' : 'border-line bg-surface-subtle text-ink-800'}`}>
            {column.header}{column.required ? ' · required' : ''}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-800">Column names are matched by meaning, so “Email Address”, “Surname” or “Cell” work too; you confirm the matching on the next step.</p>
    </div>
  )
}

function fileSize(bytes: number | null): string {
  if (!bytes) return ''
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function ChoiceCard({ selected, onSelect, title, text, icon, badge }: { selected: boolean; onSelect: () => void; title: string; text: string; icon?: ReactNode; badge?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex h-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${selected ? 'border-brand-600 bg-callout-bg' : 'border-line bg-surface hover:bg-surface-subtle'}`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon && <span className={selected ? 'text-brand-600' : 'text-ink-800'}>{icon}</span>}
        {title}
      </span>
      <span className="text-xs text-ink-800">{text}</span>
      {badge && <span className="mt-1 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-800">{badge}</span>}
    </button>
  )
}

interface WizardProps {
  onClose: () => void
  /** called once the list exists (after the import for an upload) */
  onCreated?: (list: ContactList) => void
  /** opened from campaign setup: the closing message says what happened to the campaign's audience */
  inCampaign?: boolean
  /** pick up an upload that was left running or waiting (from the uploads page) */
  resume?: { listId: string; importId: string }
  /** which way of making a list is chosen when the wizard opens (it can still be changed on the first step) */
  initialSource?: ListSource
  /** the ways of making a list offered on the first step (default: all three) */
  sources?: ListSource[]
  /** drawn inside another dialog (the campaign's Add Contact List pop-up) instead of its own */
  embedded?: boolean
}

export function CreateListWizard({ onClose, onCreated, inCampaign = false, resume, initialSource = 'UPLOAD', sources, embedded = false }: WizardProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('method')
  const [channel, setChannel] = useState<ListChannel>('EMAIL')
  const [source, setSource] = useState<ListSource>(initialSource)
  const [name, setName] = useState('')
  const rule = useFieldRules('new_contact_list')
  const [description, setDescription] = useState('')
  const [environment, setEnvironment] = useState('PRODUCTION')
  const [draft, setDraft] = useState<ContactList | null>(null)
  const [upload, setUpload] = useState<ListImport | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [basis, setBasis] = useState<ConsentBasis | ''>('')
  const [collectedAt, setCollectedAt] = useState('')
  const [attested, setAttested] = useState(false)
  const [audience, setAudience] = useState('')
  const [parent, setParent] = useState('')
  const [filter, setFilter] = useState('')
  const [created, setCreated] = useState<ContactList | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const audiences = useQuery({ queryKey: ['contact-lists', 'audiences'], queryFn: ({ signal }) => api.get<Audience[]>('/contact-lists/audiences/', undefined, signal), enabled: step === 'audience' })
  const lists = useQuery({
    queryKey: ['contact-lists', 'clone-options'],
    queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { page_size: 200 }, signal),
    enabled: step === 'clone',
  })

  // ---- the background job: polled while a worker is on it; what it reports replaces what the wizard holds
  const polled = useQuery({
    queryKey: ['contact-lists', 'import', upload?.contact_list, upload?.id],
    queryFn: ({ signal }) => api.get<ListImport>(`/contact-lists/${upload?.contact_list}/imports/${upload?.id}/`, undefined, signal),
    enabled: Boolean(upload) && step !== 'done' && step !== 'method',
    refetchInterval: (query) => ((query.state.data ?? upload)?.working ? POLL_MS : false),
  })
  const job = polled.data && polled.data.id === upload?.id ? polled.data : upload

  // ---- while the wizard is open on an upload, the header does not raise alerts about it
  const watchedId = upload?.id
  useEffect(() => {
    if (!watchedId) return
    watchedUploads.add(watchedId)
    return () => {
      watchedUploads.delete(watchedId)
    }
  }, [watchedId])

  // ---- picking up an upload that was left running or waiting
  useEffect(() => {
    if (!resume) return
    let alive = true
    void (async () => {
      try {
        const [list, staged] = await Promise.all([
          api.get<ContactList>(`/contact-lists/${resume.listId}/`),
          api.get<ListImport>(`/contact-lists/${resume.listId}/imports/${resume.importId}/`),
        ])
        if (!alive) return
        setDraft(list)
        setName(list.name)
        setDescription(list.description ?? '')
        setEnvironment(list.list_environment)
        setChannel((list.channel as ListChannel) || 'EMAIL')
        setUpload(staged)
        setMapping(staged.mapping)
        if (staged.consent?.basis) { setBasis(staged.consent.basis); setCollectedAt(staged.consent.collected_at ?? ''); setAttested(Boolean(staged.consent.attested_at)) }
        const declared = !staged.consent?.required || Boolean(staged.consent?.attested_at)
        setStep(staged.status === 'APPLYING' ? 'importing' : (staged.status === 'REVIEW' || staged.status === 'MATCHING' || staged.mapping_confirmed) ? (declared ? 'review' : 'consent') : 'map')
      } catch (problem) {
        if (alive) setError(problemText(problem))
      }
    })()
    return () => {
      alive = false
    }
  }, [resume])

  // ---- the import finished while the wizard was open
  const finished = step === 'importing' && job?.status === 'APPLIED'
  useEffect(() => {
    if (!finished || !draft) return
    let alive = true
    void api.get<ContactList>(`/contact-lists/${draft.id}/`).then((list) => {
      if (!alive) return
      setCreated(list)
      setStep('done')
      void queryClient.invalidateQueries({ queryKey: ['contact-lists'] })
      onCreated?.(list)
    })
    return () => {
      alive = false
    }
    // onCreated identity changes with every render of the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, draft?.id])

  const steps = STEPS[source]
  const index = step === 'importing' ? steps.indexOf('review') : steps.indexOf(step)
  const [title, subtitle] = TITLES[step]

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (problem) {
      setError(problemText(problem))
    } finally {
      setBusy(false)
    }
  }

  /** leaving before the end: the draft (and what it staged) goes */
  const abandon = () => {
    if (draft && !created) void api.delete(`/contact-lists/${draft.id}/`).catch(() => undefined)
    onClose()
  }

  const finish = (list: ContactList) => {
    setCreated(list)
    setStep('done')
    void queryClient.invalidateQueries({ queryKey: ['contact-lists'] })
    onCreated?.(list)
  }

  const fromMethod = () =>
    run(async () => {
      if (source !== 'UPLOAD') {
        setStep(source === 'BI' ? 'audience' : 'clone')
        return
      }
      const body = { name, description, list_environment: environment, channel }
      setDraft(draft ? await api.patch<ContactList>(`/contact-lists/${draft.id}/`, body) : await api.post<ContactList>('/contact-lists/', body))
      setStep('file')
    })

  const takeFile = (file: File | undefined) => {
    if (!file || !draft) return
    void run(async () => {
      if (upload && !['APPLIED', 'FAILED', 'CANCELLED'].includes(upload.status)) {
        await api.post(`/contact-lists/${draft.id}/imports/${upload.id}/cancel/`).catch(() => undefined)     // "Replace": the first file is dropped
      }
      const staged = await api.upload<ListImport>(`/contact-lists/${draft.id}/imports/`, file)
      setUpload(staged)
      setMapping(staged.mapping)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
    })
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    takeFile(event.dataTransfer.files[0])
  }

  const review = () =>
    run(async () => {
      if (!draft || !upload) return
      const queued = await api.post<ListImport>(`/contact-lists/${draft.id}/imports/${upload.id}/review/`, { mapping })
      setUpload(queued)
      queryClient.setQueryData(['contact-lists', 'import', queued.contact_list, queued.id], queued)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
      // the check runs in the background while the consent questions are answered
      setStep(queued.consent?.required === false ? 'review' : 'consent')
    })

  /** where the file's people agreed, and the uploader's word that they did: kept on the import and the list's compliance record */
  const declare = () =>
    run(async () => {
      if (!draft || !upload || !basis) return
      const declared = await api.post<ListImport>(`/contact-lists/${draft.id}/imports/${upload.id}/consent/`, { basis, collected_at: collectedAt, attested })
      setUpload(declared)
      queryClient.setQueryData(['contact-lists', 'import', declared.contact_list, declared.id], declared)
      setStep('review')
    })

  const apply = () =>
    run(async () => {
      if (!draft || !upload) return
      const queued = await api.post<ListImport>(`/contact-lists/${draft.id}/imports/${upload.id}/apply/`)
      setUpload(queued)
      queryClient.setQueryData(['contact-lists', 'import', queued.contact_list, queued.id], queued)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
      setStep('importing')
    })

  /** the job goes on without the wizard: the header's upload button and an alert report on it */
  const leaveRunning = () => {
    void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
    onClose()
  }

  const fromAudience = () => run(async () => finish(await api.post<ContactList>('/contact-lists/from-audience/', { name, description, list_environment: environment, channel, audience })))
  const fromClone = () => run(async () => finish(await api.post<ContactList>(`/contact-lists/${parent}/clone/`, { name, description, list_environment: environment, channel })))

  const back = () => {
    setError('')
    setStep(steps[Math.max(0, index - 1)])
  }

  // ---- what each column is: a property is used once, the email address must be there
  const columnOf = (property: string) => mapping[property] ?? ''
  const propertyOf = (column: string) => Object.keys(mapping).find((key) => mapping[key] === column) ?? ''
  const choose = (column: string, property: string) =>
    setMapping((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== column && key !== property))
      return property ? { ...next, [property]: column } : next
    })
  const mappedCount = upload ? upload.columns.filter((column) => propertyOf(column.name)).length : 0
  const missing = (upload?.properties ?? []).filter((item) => item.required && columnOf(item.key) === '')
  const emailMapped = missing.length === 0

  // ---- consent: the bases the list may use, and what the policy will do with people who have no date
  const consent = job?.consent ?? upload?.consent
  const basisAllowed = (consent?.bases ?? []).find((item) => item.key === basis)?.allowed ?? false
  const consentKey = channel === 'SMS' ? 'sms_consent_date' : 'consent_date'
  const consentMapped = columnOf(consentKey) !== ''
  const refuses = consent?.policy.without_consent === 'REFUSE'
  const textsNeedDate = Boolean(consent?.policy.texts_need_date) && channel !== 'EMAIL' && columnOf('sms_consent_date') === ''

  const primary: { label: string; action: () => void; disabled: boolean } | null =
    step === 'method' ? { label: 'Continue', action: fromMethod, disabled: name.trim() === '' }
    : step === 'file' ? { label: 'Continue', action: () => setStep('map'), disabled: !upload || job?.status === 'FAILED' || job?.status === 'CANCELLED' }
    : step === 'map' ? { label: 'Continue', action: review, disabled: !emailMapped }
    : step === 'consent' ? { label: 'Continue', action: declare, disabled: basis === '' || !basisAllowed || !attested }
    : step === 'review' ? { label: 'Import Contacts', action: apply, disabled: !job?.review || job.working || job.review.ready === 0 }
    : step === 'audience' ? { label: 'Create List', action: fromAudience, disabled: audience === '' }
    : step === 'clone' ? { label: 'Create List', action: fromClone, disabled: parent === '' }
    : null

  const footer =
    step === 'done' ? (
      <button type="button" className={buttonPrimary} onClick={onClose}>
        Done
      </button>
    ) : (
      <div className="flex w-full items-center gap-2">
        {step !== 'importing' && (
          <button type="button" className={buttonSecondary} onClick={abandon}>
            Cancel
          </button>
        )}
        {index > 0 && step !== 'importing' && (
          <button type="button" className={buttonSecondary} onClick={back} disabled={busy || (step === 'review' && Boolean(job?.working))}>
            Back
          </button>
        )}
        <span className="grow" />
        {(step === 'importing' || (step === 'review' && job?.working)) && job?.status !== 'FAILED' && (
          <button type="button" className={buttonSecondary} onClick={leaveRunning}>
            Continue in the Background
          </button>
        )}
        {busy && <Spinner className="h-4 w-4" />}
        {primary && (
          <button type="button" className={buttonPrimary} onClick={primary.action} disabled={primary.disabled || busy}>
            {primary.label}
          </button>
        )}
      </div>
    )

  const needle = filter.trim().toLowerCase()
  const shownAudiences = (audiences.data ?? []).filter((item) => `${item.name} ${item.code} ${item.description ?? ''}`.toLowerCase().includes(needle))
  const shownLists = (lists.data?.results ?? []).filter((item) => item.status === 'ACTIVE' && item.name.toLowerCase().includes(needle))
  const review_ = job?.working ? null : job?.review
  const failed = job?.status === 'FAILED'

  const close = step === 'done' ? onClose : step === 'importing' || (step === 'review' && job?.working) ? leaveRunning : abandon
  // a function, not a component: a component made here would remount the fields on every keystroke
  const frame = (children: ReactNode) => embedded ? (
    <div data-embedded-wizard>
      <h3 className="mb-1 text-card-title font-semibold text-ink-900">{title}</h3>
      {children}
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line-subtle pt-4">{footer}</div>
    </div>
  ) : <Modal title={title} onClose={close} footer={footer} size="lg">{children}</Modal>

  return frame(
    <>
      <p className="mb-4 text-xs text-ink-800" aria-live="polite">
        {step === 'done' ? subtitle : `Step ${index + 1} of ${steps.length}${subtitle ? ` · ${subtitle}` : ''}`}
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-sm border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}

      {step === 'method' && (
        <div className="space-y-5">
          <Field label="List Name" required limit={{ used: name.length, max: rule('name')?.max ?? 200 }} help="How the list is listed everywhere, including a campaign's Send To table and the Set-Up page. It can be changed later on the list's Edit Details.">
            {(ids) => (
              <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Lapsed buyers — West Q3" maxLength={rule('name')?.max ?? 200} autoFocus />
            )}
          </Field>
          <Field label="Description" hint="Optional. Shown under the name in the table.">
            {(ids) => (
              <TextArea {...ids} value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
            )}
          </Field>
          <div>
            <p id="cl-source" className="mb-2 text-sm font-semibold text-ink-900">Where the Contacts Come From</p>
            <div role="radiogroup" aria-labelledby="cl-source" className={`grid gap-3 ${sources && sources.length < 3 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
              {SOURCES.filter((item) => !sources || sources.includes(item.value)).map((item) => (
                <ChoiceCard key={item.value} selected={source === item.value} onSelect={() => !draft && setSource(item.value)} {...item} />
              ))}
            </div>
            {draft && <p className="mt-2 text-xs text-ink-800">The file upload has started for this list. Cancel to choose another source.</p>}
          </div>
          <div>
            <p id="cl-channel" className="mb-2 text-sm font-semibold text-ink-900">What the List Is For</p>
            <div role="radiogroup" aria-labelledby="cl-channel" className="grid gap-3 sm:grid-cols-3">
              {CHANNELS.map((item) => (
                <ChoiceCard key={item.value} selected={channel === item.value} onSelect={() => !draft && setChannel(item.value)} title={item.title} text={item.text} />
              ))}
            </div>
          </div>
          <div>
            <p id="cl-type" className="mb-2 text-sm font-semibold text-ink-900">List Type</p>
            <div role="radiogroup" aria-labelledby="cl-type" className="grid gap-3 sm:grid-cols-2">
              {TYPES.map((item) => (
                <ChoiceCard key={item.value} selected={environment === item.value} onSelect={() => setEnvironment(item.value)} title={item.title} text={item.text} />
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'file' && (
        <div>
          <input ref={picker} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV File" onChange={(event) => takeFile(event.target.files?.[0])} />
          {upload ? (
            <div className="rounded-lg border border-line p-4">
              <p className="mb-2 text-xs font-semibold text-ink-800">Attached File</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-fill-subtle text-ink-800"><FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden /></span>
                <div className="min-w-0 grow">
                  <p className="truncate text-sm font-semibold text-ink-900">{upload.file_name} <span className="ml-1 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-[11px] font-semibold text-success-text">{job?.status === 'FAILED' ? 'Failed' : 'Received'}</span></p>
                  <p className="text-xs text-ink-800">
                    {job && job.row_count > 0 ? `${formatNumber(job.row_count)} rows · ` : ''}{upload.columns.length} columns{upload.file_size ? ` · ${fileSize(upload.file_size)}` : ''}
                  </p>
                  {job?.working && (
                    <p className="mt-1 text-xs text-ink-800" aria-live="polite">{job.phase}{job.progress.percent > 0 ? ` · ${job.progress.percent}%` : ''}. You can match the columns meanwhile.</p>
                  )}
                  {job?.status === 'FAILED' && (
                    <p role="alert" className="mt-1 text-xs font-medium text-danger-plain">{job.error ?? 'This file could not be read.'} Choose Replace to upload another file.</p>
                  )}
                </div>
                <button type="button" className={buttonSecondary} onClick={() => picker.current?.click()} disabled={busy}>
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center ${dragging ? 'border-brand-600 bg-callout-bg' : 'border-line bg-surface-subtle'}`}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface text-ink-800"><Upload size={20} strokeWidth={1.5} aria-hidden /></span>
              <p className="text-sm font-semibold text-ink-900">Drag and drop your file here, or browse</p>
              <p className="text-xs text-ink-800">CSV only · up to 50 MB · 250,000 rows</p>
              <button type="button" className={buttonSecondary} onClick={() => picker.current?.click()} disabled={busy}>
                {busy ? 'Reading the file' : 'Choose File'}
              </button>
            </div>
          )}
          {!upload && <TemplateNote channel={channel} />}
        </div>
      )}

      {step === 'map' && upload && (
        <div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Columns of {upload.file_name} and what they mean</caption>
              <thead className="bg-surface-subtle text-xs font-semibold text-ink-900">
                <tr>
                  <th scope="col" className="px-3 py-2">Column in Your File</th>
                  <th scope="col" className="px-3 py-2">CEP Property</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {upload.columns.map((column) => {
                  const property = propertyOf(column.name)
                  return (
                    <tr key={column.name}>
                      <th scope="row" className="px-3 py-2 align-top font-medium text-ink-900">
                        {column.name}
                        <span className="block max-w-[240px] truncate text-xs font-normal text-ink-800">{column.samples.join(', ') || 'no values'}</span>
                      </th>
                      <td className="px-3 py-2 align-top">
                        <Select aria-label={`CEP Property for ${column.name}`} value={property} onChange={(event) => choose(column.name, event.target.value)}>
                          <option value="">Skip This Column</option>
                          {upload.properties.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}{item.required ? ' (required)' : ''}
                            </option>
                          ))}
                        </Select>
                        {property && upload.properties.find((item) => item.key === property)?.help && (
                          <p className="mt-1 max-w-xs text-xs text-ink-800">{upload.properties.find((item) => item.key === property)?.help}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${property ? 'bg-fill-subtle text-success-text' : 'bg-fill-subtle text-ink-800'}`}>{property ? 'Mapped' : 'Unmapped'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className={`mt-3 text-sm ${emailMapped ? 'text-ink-800' : 'font-medium text-danger-plain'}`} aria-live="polite">
            {mappedCount} of {upload.columns.length} columns mapped{emailMapped ? '' : ` · ${missing.map((item) => item.label.toLowerCase()).join(' and ')} still ${missing.length === 1 ? 'needs' : 'need'} a column`}
          </p>
        </div>
      )}

      {step === 'consent' && upload && consent && (
        <div className="space-y-5">
          <div>
            <p id="cl-basis" className="mb-2 text-sm font-semibold text-ink-900">Consent Basis <span aria-hidden className="text-danger-text">*</span></p>
            <div role="radiogroup" aria-labelledby="cl-basis" className="space-y-2">
              {consent.bases.map((item) => (
                <ChoiceCard key={item.key} selected={basis === item.key} onSelect={() => item.allowed && setBasis(item.key)} title={item.label} text={BASIS_TEXT[item.key]}
                  badge={!item.allowed ? 'Not for Texts' : undefined} />
              ))}
              <ChoiceCard selected={false} onSelect={() => undefined} title="Bought or rented list" text="Cannot be imported. CEP sends only to people who agreed to hear from the workspace." badge="Not Allowed" />
            </div>
            {basis && !basisAllowed && (
              <p role="alert" className="mt-3 rounded-sm border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
                A texts list needs express consent: marketing texts need a written opt-in with a date (TCPA, CASL). Map a Text consent date column, or choose a basis where people opted in.
              </p>
            )}
          </div>
          <Field label="Where the Consent Was Collected" hint="Optional. A form name, a store, a campaign: whatever lets you find the proof later." help="Kept as the evidence on every consent written from this file and shown on the list's compliance record, so the proof can be found if anyone asks." limit={{ used: collectedAt.length, max: 300 }}>
            {(ids) => <TextInput {...ids} value={collectedAt} onChange={(event) => setCollectedAt(event.target.value)} maxLength={300} placeholder="e.g. Fall 2026 sign-up form" />}
          </Field>
          <div className="rounded-lg border border-line bg-surface-subtle p-3">
            <Checkbox label={consent.attestation} checked={attested} onChange={(event: ChangeEvent<HTMLInputElement>) => setAttested(event.target.checked)} />
            <p className="mt-1 pl-6 text-xs text-ink-800">
              Recorded with your name and the time.{' '}
              {consentMapped
                ? `${upload.properties.find((item) => item.key === consentKey)?.label ?? 'Consent date'} is mapped: a valid date becomes an opt-in for people CEP has no answer for.`
                : 'No consent date column is mapped.'}
            </p>
          </div>
          {textsNeedDate ? (
            <p role="status" className="rounded-sm border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
              Workspace policy: a number needs a text consent date. No Text consent date column is mapped, so every row will be refused. Go back and map the column.
            </p>
          ) : !consentMapped && refuses ? (
            <p role="status" className="rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-text">
              Workspace policy refuses new people without a consent date. No consent date column is mapped, so new people will not be imported. Go back and map a column, or ask an admin to change the policy.
            </p>
          ) : (
            <p role="status" className="rounded-sm border border-line bg-callout-bg px-3 py-2 text-sm text-callout-text">
              {refuses
                ? 'Workspace policy: rows without a valid consent date are refused.'
                : 'People without a consent date are imported and held back until they confirm. Workspace policy: hold back people without consent.'}
              {consent.policy.approval_before_send ? ' The list will wait for approval before any campaign sends to it.' : ''}
            </p>
          )}
        </div>
      )}

      {(step === 'importing' || (step === 'review' && !review_)) && job && (
        <div className="space-y-3" aria-live="polite">
          {failed ? (
            <p role="alert" className="rounded-sm border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">{job.error ?? 'The upload failed.'}</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink-900">{job.phase}{job.progress.percent > 0 ? ` · ${job.progress.percent}%` : ''}</p>
              <ProgressBar job={job} />
              <p className="text-sm text-ink-800">
                {job.row_count > 0 ? `${formatNumber(job.row_count)} rows. ` : ''}Large files take a few minutes and are handled a chunk at a time, so the rest of CEP stays fast.
                You can wait here, or continue in the background: the upload button at the top shows the progress and you get an alert when it is done.
              </p>
            </>
          )}
        </div>
      )}

      {step === 'review' && review_ && upload && job && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line px-4 py-3">
            <p className="text-sm text-ink-800">Ready to Import <span className="cep-num ml-1 text-base font-semibold text-ink-900">{formatNumber(review_.ready)} contacts</span></p>
            <p className="cep-num text-sm text-ink-800">{formatNumber(review_.held_back)} rows held back</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['New', review_.new, 'not in CEP yet'], ['Existing', review_.existing, 'already known'], ['Warnings', review_.warnings, 'imported with a remark'], ['Errors', review_.errors, 'held back']] as const).map(
              ([label, value, hint]) => (
                <div key={label} className="rounded-lg border border-line px-3 py-2">
                  <dd className="cep-num text-lg font-semibold text-ink-900">{formatNumber(value)}</dd>
                  <dt className="text-xs font-semibold text-ink-800">{label}</dt>
                  <p className="text-xs text-ink-800">{hint}</p>
                </div>
              ),
            )}
          </dl>
          {(job.issues ?? []).length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-800">Rows to Look At{(job.issues ?? []).length >= 50 ? ' (first 50)' : ''}</p>
              <ul className="max-h-44 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line text-sm">
                {(job.issues ?? []).map((issue) => (
                  <li key={`${issue.line}-${issue.kind}`} className="flex items-start gap-3 px-3 py-1.5">
                    <span className="cep-num w-14 shrink-0 text-xs text-ink-800">Line {issue.line}</span>
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${issue.kind === 'error' ? 'bg-danger-bg text-danger-text' : 'bg-warning-bg text-warning-text'}`}>
                      {issue.kind === 'error' ? 'Held Back' : 'Warning'}
                    </span>
                    <span className="min-w-0 text-ink-800">{issue.message}{issue.value ? <span className="text-ink-800"> · {issue.value}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <UploadReport job={job} />
          {review_.new > 0 && <p className="text-xs text-ink-800">New contacts have no consent answer in CEP unless the file gives a consent date, so marketing sends will leave them out until they opt in.</p>}
        </div>
      )}

      {(step === 'audience' || step === 'clone') && (
        <div>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={step === 'audience' ? 'Search audiences' : 'Search lists'}
            aria-label={step === 'audience' ? 'Search audiences' : 'Search lists'}
            className="mb-3 h-10 w-full rounded-control-lg border border-line bg-surface px-3 text-sm"
          />
          {(step === 'audience' ? audiences.isPending : lists.isPending) ? (
            <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner className="h-4 w-4" /> Loading</p>
          ) : (
            <div role="radiogroup" aria-label={step === 'audience' ? 'Audiences' : 'Lists'} className="max-h-72 space-y-2 overflow-y-auto">
              {step === 'audience' &&
                shownAudiences.map((item) => (
                  <ChoiceCard key={item.id} selected={audience === item.id} onSelect={() => setAudience(item.id)} title={item.name}
                    text={`${formatNumber(item.member_count)} contacts today · ${item.source_system}${item.description ? ` · ${item.description}` : ''}`} />
                ))}
              {step === 'clone' &&
                shownLists.map((item) => (
                  <ChoiceCard key={item.id} selected={parent === item.id} onSelect={() => setParent(item.id)} title={item.name}
                    text={`${formatNumber(item.member_count)} contacts · ${item.source_label ?? item.source_type} · ${item.list_environment === 'TEST' ? 'Test' : 'Production'}`} />
                ))}
              {(step === 'audience' ? shownAudiences : shownLists).length === 0 && (
                <p className="rounded-lg border border-line px-3 py-6 text-center text-sm text-ink-800">
                  {step === 'audience' ? 'No audience matches. Audiences are defined by your data team in the BI / extraction tool.' : 'No list matches.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'done' && created && (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-success-text"><CheckCircle2 size={22} strokeWidth={1.5} aria-hidden /></span>
          <div className="space-y-2 text-sm text-ink-800">
            <p className="text-base font-semibold text-ink-900">{created.name} is ready</p>
            {source === 'UPLOAD' && upload && (
              <>
                {job?.summary && <div className="mb-3"><UploadReport job={job} /></div>}
                <p className="cep-num">{formatNumber(job?.applied_count ?? 0)} contacts imported · {formatNumber(job?.review?.held_back ?? 0)} rows skipped</p>
                <p>{inCampaign ? 'It came from an upload, so it waits in Send To as Needs review. Check it, then confirm it there.' : "This list came from an upload, so you'll need to pick it manually when you attach it to a campaign."}</p>
              </>
            )}
            {source === 'BI' && (
              <>
                <p className="cep-num">{formatNumber(created.member_count)} contacts · refreshes with its audience every hour</p>
                <p>{inCampaign ? 'It comes from a vetted audience, so it is attached to this campaign already.' : 'This list now appears in your Contact Lists table and refreshes with its source audience.'}</p>
              </>
            )}
            {source === 'CLONE' && (
              <>
                <p className="cep-num">{formatNumber(created.member_count)} contacts copied</p>
                <p>{inCampaign ? "It is a copy of a list you already had, so it is attached to this campaign already. It's a snapshot: the list you copied won't change it." : "This list now appears in your Contact Lists table. It's a snapshot — the list you copied won't change it."}</p>
              </>
            )}
          </div>
        </div>
      )}
    </>,
  )
}
