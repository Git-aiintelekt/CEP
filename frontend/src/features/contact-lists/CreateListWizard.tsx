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
import { CheckCircle2, Copy, Database, FileSpreadsheet, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'

import { Field, Select, TextArea, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Audience, ContactList, ListImport, ListSource, Page } from '@/lib/types'

import { problemText } from './problem'
import { POLL_MS, watchedUploads } from './uploadJobs'
import { UploadReport } from './UploadReport'
import { ProgressBar } from './UploadsIndicator'

type Step = 'method' | 'file' | 'map' | 'review' | 'importing' | 'audience' | 'clone' | 'done'

const STEPS: Record<ListSource, Step[]> = {
  UPLOAD: ['method', 'file', 'map', 'review', 'done'],                                   // 'importing' is the tail of the review step
  BI: ['method', 'audience', 'done'],
  CLONE: ['method', 'clone', 'done'],
}

const TITLES: Record<Step, [string, string]> = {
  method: ['New Contact List', ''],
  file: ['Add your file', 'Upload the CSV that holds your contacts.'],
  map: ['Match your columns', 'Tell CEP what each column in your file means.'],
  review: ['Review before importing', 'Check what comes in and what gets held back.'],
  importing: ['Importing your contacts', 'This runs in the background. You can keep working.'],
  audience: ['Choose an audience', 'Pick an audience your data team already defined.'],
  clone: ['Choose a list to copy', 'Pick the list you want to start from.'],
  done: ['List created', "Here's where to find it and what happens next."],
}

const SOURCES: { value: ListSource; title: string; text: string; icon: ReactNode; badge?: string }[] = [
  { value: 'UPLOAD', title: 'Upload a file', text: 'Import a CSV, map the columns, review before adding.', icon: <Upload size={18} strokeWidth={1.5} aria-hidden />, badge: 'Most common' },
  { value: 'BI', title: 'BI or extraction tool', text: 'Choose an audience someone already defined.', icon: <Database size={18} strokeWidth={1.5} aria-hidden /> },
  { value: 'CLONE', title: 'Clone a list', text: 'Copy a list you have and adjust from there.', icon: <Copy size={18} strokeWidth={1.5} aria-hidden /> },
]

const TYPES = [
  { value: 'PRODUCTION', title: 'Production', text: 'Available to Corporate Communication Governance sends.' },
  { value: 'TEST', title: 'Test', text: 'Held out of governed sends until you promote it.' },
]

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
        {icon && <span className={selected ? 'text-brand-600' : 'text-ink-700'}>{icon}</span>}
        {title}
      </span>
      <span className="text-xs text-ink-500">{text}</span>
      {badge && <span className="mt-1 rounded-sm bg-line-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">{badge}</span>}
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
}

export function CreateListWizard({ onClose, onCreated, inCampaign = false, resume }: WizardProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('method')
  const [source, setSource] = useState<ListSource>('UPLOAD')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [environment, setEnvironment] = useState('PRODUCTION')
  const [draft, setDraft] = useState<ContactList | null>(null)
  const [upload, setUpload] = useState<ListImport | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
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
        setUpload(staged)
        setMapping(staged.mapping)
        setStep(staged.status === 'APPLYING' ? 'importing' : staged.status === 'REVIEW' || staged.status === 'MATCHING' || staged.mapping_confirmed ? 'review' : 'map')
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
      const body = { name, description, list_environment: environment }
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

  const fromAudience = () => run(async () => finish(await api.post<ContactList>('/contact-lists/from-audience/', { name, description, list_environment: environment, audience })))
  const fromClone = () => run(async () => finish(await api.post<ContactList>(`/contact-lists/${parent}/clone/`, { name, description, list_environment: environment })))

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
  const emailMapped = columnOf('email') !== ''

  const primary: { label: string; action: () => void; disabled: boolean } | null =
    step === 'method' ? { label: 'Continue', action: fromMethod, disabled: name.trim() === '' }
    : step === 'file' ? { label: 'Continue', action: () => setStep('map'), disabled: !upload || job?.status === 'FAILED' || job?.status === 'CANCELLED' }
    : step === 'map' ? { label: 'Continue', action: review, disabled: !emailMapped }
    : step === 'review' ? { label: 'Import contacts', action: apply, disabled: !job?.review || job.working || job.review.ready === 0 }
    : step === 'audience' ? { label: 'Create list', action: fromAudience, disabled: audience === '' }
    : step === 'clone' ? { label: 'Create list', action: fromClone, disabled: parent === '' }
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
            Continue in the background
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

  return (
    <Modal title={title} onClose={step === 'done' ? onClose : step === 'importing' || (step === 'review' && job?.working) ? leaveRunning : abandon} footer={footer} size="lg">
      <p className="mb-4 text-xs text-ink-500" aria-live="polite">
        {step === 'done' ? subtitle : `Step ${index + 1} of ${steps.length}${subtitle ? ` · ${subtitle}` : ''}`}
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-sm border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}

      {step === 'method' && (
        <div className="space-y-5">
          <Field label="List name" required>
            {(ids) => (
              <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Lapsed buyers — West Q3" maxLength={200} autoFocus />
            )}
          </Field>
          <Field label="Description" hint="Optional. Shown under the name in the table.">
            {(ids) => (
              <TextArea {...ids} value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
            )}
          </Field>
          <div>
            <p id="cl-source" className="mb-2 text-sm font-semibold text-ink-900">Where the contacts come from</p>
            <div role="radiogroup" aria-labelledby="cl-source" className="grid gap-3 sm:grid-cols-3">
              {SOURCES.map((item) => (
                <ChoiceCard key={item.value} selected={source === item.value} onSelect={() => !draft && setSource(item.value)} {...item} />
              ))}
            </div>
            {draft && <p className="mt-2 text-xs text-ink-500">The file upload has started for this list. Cancel to choose another source.</p>}
          </div>
          <div>
            <p id="cl-type" className="mb-2 text-sm font-semibold text-ink-900">List type</p>
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
          <input ref={picker} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(event) => takeFile(event.target.files?.[0])} />
          {upload ? (
            <div className="rounded-lg border border-line p-4">
              <p className="mb-2 text-xs font-semibold text-ink-700">Attached file</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-line-subtle text-ink-700"><FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden /></span>
                <div className="min-w-0 grow">
                  <p className="truncate text-sm font-semibold text-ink-900">{upload.file_name} <span className="ml-1 rounded-sm bg-line-subtle px-1.5 py-0.5 text-[11px] font-semibold text-success-text">{job?.status === 'FAILED' ? 'Failed' : 'Received'}</span></p>
                  <p className="text-xs text-ink-500">
                    {job && job.row_count > 0 ? `${formatNumber(job.row_count)} rows · ` : ''}{upload.columns.length} columns{upload.file_size ? ` · ${fileSize(upload.file_size)}` : ''}
                  </p>
                  {job?.working && (
                    <p className="mt-1 text-xs text-ink-500" aria-live="polite">{job.phase}{job.progress.percent > 0 ? ` · ${job.progress.percent}%` : ''}. You can match the columns meanwhile.</p>
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
              <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface text-ink-700"><Upload size={20} strokeWidth={1.5} aria-hidden /></span>
              <p className="text-sm font-semibold text-ink-900">Drag and drop your file here, or browse</p>
              <p className="text-xs text-ink-500">CSV only · up to 50 MB · 250,000 rows</p>
              <button type="button" className={buttonSecondary} onClick={() => picker.current?.click()} disabled={busy}>
                {busy ? 'Reading the file' : 'Choose file'}
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'map' && upload && (
        <div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Columns of {upload.file_name} and what they mean</caption>
              <thead className="bg-surface-subtle text-xs font-semibold text-ink-700">
                <tr>
                  <th scope="col" className="px-3 py-2">Column in your file</th>
                  <th scope="col" className="px-3 py-2">CEP property</th>
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
                        <span className="block max-w-[240px] truncate text-xs font-normal text-ink-500">{column.samples.join(', ') || 'no values'}</span>
                      </th>
                      <td className="px-3 py-2 align-top">
                        <Select aria-label={`CEP property for ${column.name}`} value={property} onChange={(event) => choose(column.name, event.target.value)}>
                          <option value="">Skip this column</option>
                          {upload.properties.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}{item.required ? ' (required)' : ''}
                            </option>
                          ))}
                        </Select>
                        {property && upload.properties.find((item) => item.key === property)?.help && (
                          <p className="mt-1 max-w-xs text-xs text-ink-500">{upload.properties.find((item) => item.key === property)?.help}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${property ? 'bg-line-subtle text-success-text' : 'bg-line-subtle text-ink-700'}`}>{property ? 'Mapped' : 'Unmapped'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className={`mt-3 text-sm ${emailMapped ? 'text-ink-500' : 'font-medium text-danger-plain'}`} aria-live="polite">
            {mappedCount} of {upload.columns.length} columns mapped{emailMapped ? '' : ' · email still needs a column'}
          </p>
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
              <p className="text-sm text-ink-700">
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
            <p className="text-sm text-ink-700">Ready to import <span className="cep-num ml-1 text-base font-semibold text-ink-900">{formatNumber(review_.ready)} contacts</span></p>
            <p className="cep-num text-sm text-ink-500">{formatNumber(review_.held_back)} rows held back</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['New', review_.new, 'not in CEP yet'], ['Existing', review_.existing, 'already known'], ['Warnings', review_.warnings, 'imported with a remark'], ['Errors', review_.errors, 'held back']] as const).map(
              ([label, value, hint]) => (
                <div key={label} className="rounded-lg border border-line px-3 py-2">
                  <dd className="cep-num text-lg font-semibold text-ink-900">{formatNumber(value)}</dd>
                  <dt className="text-xs font-semibold text-ink-700">{label}</dt>
                  <p className="text-xs text-ink-500">{hint}</p>
                </div>
              ),
            )}
          </dl>
          {(job.issues ?? []).length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-700">Rows to look at{(job.issues ?? []).length >= 50 ? ' (first 50)' : ''}</p>
              <ul className="max-h-44 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line text-sm">
                {(job.issues ?? []).map((issue) => (
                  <li key={`${issue.line}-${issue.kind}`} className="flex items-start gap-3 px-3 py-1.5">
                    <span className="cep-num w-14 shrink-0 text-xs text-ink-500">Line {issue.line}</span>
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${issue.kind === 'error' ? 'bg-danger-bg text-danger-text' : 'bg-warning-bg text-warning-text'}`}>
                      {issue.kind === 'error' ? 'Held back' : 'Warning'}
                    </span>
                    <span className="min-w-0 text-ink-700">{issue.message}{issue.value ? <span className="text-ink-500"> · {issue.value}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <UploadReport job={job} />
          {review_.new > 0 && <p className="text-xs text-ink-500">New contacts have no consent answer in CEP unless the file gives a consent date, so marketing sends will leave them out until they opt in.</p>}
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
            className="mb-3 h-10 w-full rounded-sm border border-line bg-surface px-3 text-sm"
          />
          {(step === 'audience' ? audiences.isPending : lists.isPending) ? (
            <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner className="h-4 w-4" /> Loading</p>
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
                <p className="rounded-lg border border-line px-3 py-6 text-center text-sm text-ink-500">
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
          <div className="space-y-2 text-sm text-ink-700">
            <p className="text-base font-semibold text-ink-900">{created.name} is ready</p>
            {source === 'UPLOAD' && upload && (
              <>
                {job?.summary && <div className="mb-3"><UploadReport job={job} /></div>}
                <p className="cep-num">{formatNumber(job?.applied_count ?? 0)} contacts imported · {formatNumber(job?.review?.held_back ?? 0)} rows skipped</p>
                <p>{inCampaign ? 'It came from an upload, so it is not attached to this campaign yet. Check it, then tick it in the list below.' : "This list came from an upload, so you'll need to pick it manually when you attach it to a campaign."}</p>
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
    </Modal>
  )
}
