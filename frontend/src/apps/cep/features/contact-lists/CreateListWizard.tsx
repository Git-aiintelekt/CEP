/**
 * New Contact List: one dialog, four ways in.
 *   Upload a file        name -> file -> match columns -> tag values -> consent -> review -> done   (the list is a DRAFT until the import is added)
 *   Look Up in C360      name, databases and role -> a file of IDs -> tag values -> consent -> review -> done   (the people come from the CRM)
 *   BI / extraction      name -> choose an audience -> done
 *   Clone a list         name -> choose the list to copy -> done
 * A file is never processed while the operator waits on a request: the upload answers at once and a background worker
 * reads, checks and imports it. The wizard shows the progress; "Continue in the background" closes it and leaves the job
 * running (the header's upload button and an alert tell the operator when it is done; the uploads page resumes it).
 * Cancel removes the draft and stops its job, so a half-finished upload never becomes a list.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Copy, Database, Download, FileSpreadsheet, FlaskConical, Layers, Mail, MessageSquare, Plus, Search, Upload, Users } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { Field, Select, TextArea, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { InputGroup } from '@/components/InputGroup'
import { PillRadioGroup } from '@/components/PillRadioGroup'
import { SetupDialog } from '@/components/SetupDialog'
import { Spinner } from '@/components/States'
import { Stepper } from '@/components/Stepper'
import { StatusBadge, Tag } from '@/components/StatusBadge'
import { buttonClass } from '@/components/buttonStyles'
import { ChoiceCard as SetupCard, ChoiceGroup } from '@/apps/cep/features/campaigns/parts'
import { useFieldRules } from '@/lib/fieldRules'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Audience, ConsentBasis, ContactList, ListImport, ListLookupSources, ListSource, Page, ListChannel, TagValueChoice } from '@/lib/types'

import { ProblemExtras } from '@/components/ProblemExtras'
import { saveFailure, type SaveFailure } from '@/lib/saveFeedback'

import { problemText } from './problem'
import { sourceLabel } from './sourceLabel'
import { POLL_MS, watchedUploads } from './uploadJobs'
import { ReportDownload, UploadReport } from './UploadReport'
import { ProgressCount } from './ProgressCount'
import { downloadLookupTemplate, downloadTemplate, formatLine, uploadColumns } from './uploadTemplate'
import { ProgressBar } from './UploadsIndicator'
import { TagValuesReview, TagValuesStep } from './TagValuesStep'

type Step = 'source' | 'method' | 'file' | 'map' | 'tags' | 'consent' | 'review' | 'importing' | 'audience' | 'clone' | 'done'

const STEPS: Record<ListSource, Step[]> = {
  UPLOAD: ['method', 'file', 'map', 'tags', 'consent', 'review', 'done'],                // 'importing' is the tail of the review step
  LOOKUP: ['method', 'file', 'tags', 'consent', 'review', 'done'],                        // C360 fills every field: no columns to match
  BI: ['method', 'audience', 'done'],
  CLONE: ['method', 'clone', 'done'],
}

const TITLES: Record<Step, [string, string]> = {
  source: ['Choose a Source', 'Pick an audience or a list to copy.'],
  method: ['New Contact List', ''],
  file: ['Add Your File', 'Upload the CSV that holds your contacts.'],
  map: ['Match Your Columns', 'Tell C360 what each column in your file means.'],
  tags: ['Tag Values', 'Where each of the template’s tags gets its value.'],
  consent: ['Where Did These People Agree?', 'Every upload records its consent basis. It is kept with the list and shown on its compliance record.'],
  review: ['Review Before Importing', 'Check what comes in and what gets held back.'],
  importing: ['Importing Your Contacts', 'This runs in the background. You can keep working.'],
  audience: ['Choose an Audience', 'Pick an audience your data team already defined.'],
  clone: ['Choose a List to Copy', 'Pick the list you want to start from.'],
  done: ['List Created', "Here's where to find it and what happens next."],
}

/** each step's name on the set-up frame's step line ("Step 3 of 6 · Match Columns") */
const STEP_NAME: Record<Step, string> = {
  source: 'Source', method: 'List Details', file: 'Upload File', map: 'Match Columns', tags: 'Tag Values', consent: 'Consent', review: 'Review', importing: 'Importing',
  audience: 'Choose an Audience', clone: 'Choose a List to Copy', done: 'Done',
}

const SOURCES: { value: ListSource; title: string; text: string; icon: ReactNode; badge?: string }[] = [
  { value: 'UPLOAD', title: 'Upload a File', text: 'Import a CSV, map the columns, review before adding.', icon: <Upload size={20} strokeWidth={1.5} />, badge: 'Most Common' },
  { value: 'LOOKUP', title: 'Look Up in C360', text: 'A file of IDs. Names, numbers and emails come from C360, checked for solicitation and DND.', icon: <Search size={20} strokeWidth={1.5} /> },
  { value: 'BI', title: 'BI or Extraction Tool', text: 'Choose an audience someone already defined.', icon: <Database size={20} strokeWidth={1.5} /> },
  { value: 'CLONE', title: 'Clone a List', text: 'Copy a list you have and adjust from there.', icon: <Copy size={20} strokeWidth={1.5} /> },
]

const BASIS_TEXT: Record<ConsentBasis, string> = {
  WEB_FORM: 'A form with a marketing opt-in. The form name goes in the evidence.',
  IN_STORE: 'Paper or POS sign-up with a marketing tick box.',
  CUSTOMER_REQUEST: 'An email, a call or a message to customer service, recorded there.',
  IMPLIED: 'Bought from us in the last two years and never opted out. Marketing texts cannot use this basis.',
}

const TYPES = [
  { value: 'PRODUCTION', title: 'Production', text: 'Available to Corporate Communication Governance sends.', icon: <Users size={20} strokeWidth={1.5} /> },
  { value: 'TEST', title: 'Test', text: 'Held out of governed sends until you promote it.', icon: <FlaskConical size={20} strokeWidth={1.5} /> },
]

const CHANNELS: { value: ListChannel; title: string; text: string; icon: ReactNode }[] = [
  { value: 'EMAIL', title: 'Email', text: 'An email address per row. For email campaigns.', icon: <Mail size={20} strokeWidth={1.5} /> },
  { value: 'SMS', title: 'Texts', text: 'A mobile number per row; an address is optional. For SMS and MMS campaigns.', icon: <MessageSquare size={20} strokeWidth={1.5} /> },
  { value: 'BOTH', title: 'Email and Texts', text: 'An address and a number per row. One list for every channel.', icon: <Layers size={20} strokeWidth={1.5} /> },
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
            className={`rounded-sm border px-2 py-0.5 text-xs ${column.required ? 'border-link bg-brand-100 font-semibold text-brand-800' : 'border-line bg-surface-subtle text-ink-800'}`}>
            {column.header}{column.required ? ' · required' : ''}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-800">Column names are matched by meaning, so “Email Address”, “Surname” or “Cell” work too; you confirm the matching on the next step.</p>
    </div>
  )
}

const LOOKUP_FILLS = ['First Name', 'Last Name', 'Mobile Number', 'Email', 'Postal Code', 'Loyalty ID', 'Time Zone', 'Text Consent Date', 'Email Consent Date']
const FILL_LABEL: Record<string, string> = { first_name: 'Name', mobile: 'Mobile Number', email: 'Email', loyalty_id: 'Loyalty ID', postal_code: 'Postal Code', timezone: 'Time Zone',
  sms_consent_date: 'Text Consent', consent_date: 'Email Consent' }

/** Look Up in C360, under the drop zone: one column of IDs, and what C360 brings back for each */
function LookupTemplateNote({ idLabel }: { idLabel: string }) {
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-4" data-lookup-template>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">File Format</p>
          <p className="mt-1 text-xs text-ink-800">A CSV with a header row and one {idLabel} per row. Other columns are kept with each list entry, ready for a template’s tags.</p>
        </div>
        <button type="button" className={buttonSecondary} onClick={() => downloadLookupTemplate(idLabel)}>
          <Download size={16} strokeWidth={1.5} aria-hidden />Download Sample CSV
        </button>
      </div>
      <p className="mt-3"><span className="rounded-sm border border-link bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">{idLabel} · required</span></p>
      <p className="mt-2 text-xs text-ink-800">Filled from C360:</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Filled from C360">
        {LOOKUP_FILLS.map((name) => <li key={name} className="rounded-sm border border-dashed border-line bg-surface-subtle px-2 py-0.5 text-xs text-ink-800">{name}</li>)}
      </ul>
    </div>
  )
}

/** The review's first section for a file of IDs: what C360 found and why rows were left out, then how full each field is */
function LookupSection({ job }: { job: ListImport }) {
  const lookup = job.lookup
  const result = lookup?.result
  if (!lookup || !result) return null
  const seconds = result.seconds < 60 ? `${Math.max(1, Math.round(result.seconds))} s` : `${Math.floor(result.seconds / 60)} min ${Math.round(result.seconds % 60)} s`
  const of = Math.max(result.usable, 1)
  return (
    <section className="rounded-lg border border-line" aria-label="Looked Up in C360" data-lookup-section>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-subtle px-4 py-2.5">
        <p className="text-sm font-semibold text-ink-900">Looked Up in C360</p>
        <p className="cep-num text-xs text-ink-800">{[lookup.databases.join(', '), lookup.role_label && `role ${lookup.role_label}`, `${formatNumber(result.ids)} ${lookup.id_label}s in ${seconds}`].filter(Boolean).join(' · ')}</p>
      </div>
      <ul className="divide-y divide-line-subtle text-sm">
        <li className="flex justify-between gap-3 px-4 py-1.5"><span className="text-ink-800">Found in C360</span><span className="cep-num font-medium text-ink-900">{formatNumber(result.found)}</span></li>
        {result.held.map((item) => (
          <li key={item.reason} className="flex justify-between gap-3 px-4 py-1.5">
            <span className="flex items-center gap-2 text-ink-800"><Tag tone="error">Held Back</Tag>{item.reason}</span>
            <span className="cep-num font-medium text-ink-900">{formatNumber(item.count)}</span>
          </li>
        ))}
        {result.warnings.map((item) => (
          <li key={item.reason} className="flex justify-between gap-3 px-4 py-1.5">
            <span className="flex items-center gap-2 text-ink-800"><Tag tone="warning">Warning</Tag>{item.reason}</span>
            <span className="cep-num font-medium text-ink-900">{formatNumber(item.count)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-y border-line-subtle px-4 py-2.5">
        <p className="text-sm font-semibold text-ink-900">Filled From C360</p>
        <p className="cep-num text-xs text-ink-800">of the {formatNumber(result.usable)} that can be used</p>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 px-4 py-2 sm:grid-cols-2">
        {Object.entries(FILL_LABEL).map(([key, label]) => {
          const percent = Math.round(((result.filled[key] ?? 0) * 100) / of)
          return (
            <div key={key} className="flex items-center gap-3 py-1 text-sm">
              <dt className="w-32 shrink-0 text-ink-800">{label}</dt>
              <dd className="flex grow items-center gap-3">
                <span aria-hidden className="h-1.5 grow overflow-hidden rounded-full bg-fill-subtle"><span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, percent)}%` }} /></span>
                <span className="cep-num w-10 text-right text-ink-900">{percent}%</span>
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

/** "An Email column is required." / "A Mobile Number column is required." / "Email and Mobile Number columns are required." */
function requiredColumns(channel: ListChannel): string {
  const names = uploadColumns(channel).filter((column) => column.required).map((column) => column.header === 'Mobile number' ? 'Mobile Number' : column.header)
  return names.length === 1 ? `${/^[AEIOU]/i.test(names[0]) ? 'An' : 'A'} ${names[0]} column is required.` : `${names.join(' and ')} columns are required.`
}

/** one answer to "How did these people opt in?": a full-width row with a radio mark; Blue 100 and a Blue 600 border when chosen */
function OptInRow({ selected, disabled = false, onSelect, title, text, tag }: { selected: boolean; disabled?: boolean; onSelect: () => void; title: string; text?: string; tag?: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-disabled={disabled || undefined} onClick={() => !disabled && onSelect()}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-fast ease-standard ${selected ? 'border-link bg-brand-100 text-brand-800' : disabled ? 'cursor-not-allowed border-line bg-surface-subtle text-ink-800' : 'border-line bg-surface text-ink-900 hover:bg-surface-hover'}`}>
      <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-surface ${selected ? 'border-link' : 'border-line-control'}`}>
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />}
      </span>
      <span className="flex min-w-0 grow flex-col">
        <span className="text-sm font-semibold">{title}</span>
        {text && <span className={`text-helper font-normal ${selected ? 'text-brand-800' : 'text-ink-800'}`}>{text}</span>}
      </span>
      {tag && <Tag>{tag}</Tag>}
    </button>
  )
}

interface SourceRowData { kind: 'audience' | 'list'; id: string; name: string; tag: string; count: number }

/** one audience or list to start from: a radio row with its name, kind and size */
function SourceRow({ selected, onSelect, row }: { selected: boolean; onSelect: () => void; row: SourceRowData }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-fast ease-standard ${selected ? 'bg-brand-100 text-brand-800' : 'bg-surface text-ink-900 hover:bg-surface-hover'}`}>
      <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-surface ${selected ? 'border-link' : 'border-line-control'}`}>
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />}
      </span>
      <span className="flex min-w-0 grow flex-col items-start gap-1.5">
        <span className="text-card-title font-semibold">{row.name}</span>
        <Tag>{row.tag}</Tag>
      </span>
      <span className="cep-num shrink-0 text-sm">{formatNumber(row.count)} contacts</span>
    </button>
  )
}

/** "Email 2 of 2" over an 8px bar */
function ReachRow({ label, count, of }: { label: string; count: number; of: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm"><span className="text-ink-900">{label}</span><span className="cep-num font-semibold text-ink-900">{formatNumber(count)} of {formatNumber(of)}</span></div>
      <div role="img" aria-label={`${formatNumber(count)} of ${formatNumber(of)} can be contacted by ${label.toLowerCase()} today`} className="mt-1.5 h-2 overflow-hidden rounded-pill bg-fill-subtle">
        <div className="h-full rounded-pill bg-success" style={{ width: `${of ? (count * 100) / of : 0}%` }} />
      </div>
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
      className={`flex h-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${selected ? 'border-link bg-brand-100' : 'border-line bg-surface hover:border-link'}`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon && <span className={selected ? 'text-link' : 'text-ink-800'}>{icon}</span>}
        {title}
      </span>
      <span className="text-xs text-ink-800">{text}</span>
      {badge && <span className="mt-1 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-xs font-medium text-ink-800">{badge}</span>}
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
  /** what "Use for" starts on (the campaign's own channel) */
  defaultChannel?: ListChannel
  /** embedded: whether the wizard is on its first screen with nothing started, where the pop-up shows its way-in cards */
  onAtStart?: (atStart: boolean) => void
  /** embedded: the list is made (the pop-up's title says so) */
  onDone?: (done: boolean) => void
  /** embedded: "Review List" on the last screen: the pop-up closes and the page brings the list into view */
  onReview?: (list: ContactList) => void
  /** opened from a campaign: its template, whose tags the Tag Values step asks about */
  templateId?: string
}

const UPLOAD_STEP_NAMES = ['Details', 'File', 'Columns', 'Tags', 'Consent', 'Review']
/** Audience or Clone in the campaign's pop-up: pick the source, then the details */
const MAKE_STEPS: Step[] = ['source', 'method', 'done']
const MAKE_STEP_NAMES = ['Source', 'Details']
const CHANNEL_OPTIONS: { value: ListChannel; label: string }[] = [{ value: 'EMAIL', label: 'Email' }, { value: 'SMS', label: 'Texts' }, { value: 'BOTH', label: 'Email and Texts' }]
const TYPE_OPTIONS = [{ value: 'PRODUCTION', label: 'Production' }, { value: 'TEST', label: 'Test' }]

export function CreateListWizard({ onClose, onCreated, inCampaign = false, resume, initialSource = 'UPLOAD', sources, embedded = false, defaultChannel, onAtStart, onDone, onReview, templateId }: WizardProps) {
  const queryClient = useQueryClient()
  /** Audience or Clone, inside the pop-up: one Source list of audiences and lists, then the details */
  const making = embedded && initialSource !== 'UPLOAD'
  const [step, setStep] = useState<Step>(making ? 'source' : 'method')
  const [nameEdited, setNameEdited] = useState(false)
  const [channel, setChannel] = useState<ListChannel>(defaultChannel ?? 'EMAIL')
  const [showDescription, setShowDescription] = useState(false)
  const useForId = useId()
  const listTypeId = useId()
  const basisId = useId()
  const [source, setSource] = useState<ListSource>(initialSource)
  const [name, setName] = useState('')
  const rule = useFieldRules('new_contact_list')
  const [description, setDescription] = useState('')
  const [environment, setEnvironment] = useState('PRODUCTION')
  const [draft, setDraft] = useState<ContactList | null>(null)
  const [upload, setUpload] = useState<ListImport | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  /** the Tag Values step: the template checked against ('' = skipped) and where each of its tags gets its value */
  const [tagTemplate, setTagTemplate] = useState(templateId ?? '')
  const [tagChoices, setTagChoices] = useState<Record<string, TagValueChoice>>({})
  const [basis, setBasis] = useState<ConsentBasis | ''>('')
  const [collectedAt, setCollectedAt] = useState('')
  const [attested, setAttested] = useState(false)
  const [audience, setAudience] = useState('')
  const [parent, setParent] = useState('')
  const [filter, setFilter] = useState('')
  const [created, setCreated] = useState<ContactList | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** C360's own problem (a reference): Copy Details and a known problem's note under the message */
  const [problemFailure, setProblemFailure] = useState<SaveFailure | null>(null)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  /** Look Up in C360: the databases in the order ticked (the first that has the ID wins), and the role the people must hold */
  const [lookupDbs, setLookupDbs] = useState<string[]>([])
  const [role, setRole] = useState('CUSTOMER')
  const lookupSources = useQuery({
    queryKey: ['contact-lists', 'lookup-sources'],
    queryFn: ({ signal }) => api.get<ListLookupSources>('/contact-lists/lookup-sources/', undefined, signal),
    enabled: !embedded, retry: false, staleTime: 60_000,
  })
  const offered = lookupSources.data?.sources ?? []
  const roleChoices = lookupSources.data?.roles ?? []
  const lookingUp = source === 'LOOKUP'

  const audiences = useQuery({ queryKey: ['contact-lists', 'audiences'], queryFn: ({ signal }) => api.get<Audience[]>('/contact-lists/audiences/', undefined, signal), enabled: step === 'audience' || making })
  const lists = useQuery({
    queryKey: ['contact-lists', 'clone-options'],
    queryFn: ({ signal }) => api.get<Page<ContactList>>('/contact-lists/', { page_size: 200 }, signal),
    enabled: step === 'clone' || making,
  })

  // ---- the background job: polled while a worker is on it; what it reports replaces what the wizard holds
  const polled = useQuery({
    queryKey: ['contact-lists', 'import', upload?.contact_list, upload?.id],
    queryFn: ({ signal }) => api.get<ListImport>(`/contact-lists/${upload?.contact_list}/imports/${upload?.id}/`, undefined, signal),
    enabled: Boolean(upload) && step !== 'done' && step !== 'method',
    refetchInterval: (query) => ((query.state.data ?? upload)?.working ? POLL_MS : false),
  })
  const job = polled.data && polled.data.id === upload?.id ? polled.data : upload
  /** what the file's IDs are called: Customer ID for a list of customers, Party ID when no role is checked */
  const idLabel = job?.lookup?.id_label ?? (role ? roleChoices.find((item) => item.key === role)?.id_label ?? 'Customer ID' : 'Party ID')

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
        if (staged.tag_values) { setTagTemplate(staged.tag_values.template_id); setTagChoices(staged.tag_values.tags) }
        if (staged.lookup) { setSource('LOOKUP'); setRole(staged.lookup.role ?? '') }
        if (staged.consent?.basis) { setBasis(staged.consent.basis); setCollectedAt(staged.consent.collected_at ?? ''); setAttested(Boolean(staged.consent.attested_at)) }
        const declared = !staged.consent?.required || Boolean(staged.consent?.attested_at)
        setStep(staged.status === 'APPLYING' ? 'importing' : (staged.lookup || staged.status === 'REVIEW' || staged.status === 'MATCHING' || staged.mapping_confirmed) ? (declared ? 'review' : 'consent') : 'map')
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

  /** the redesigned upload flow, inside the campaign's pop-up: a stepper over the steps, no Cancel (the pop-up's close does it) */
  const fresh = embedded
  const nameMax = rule('name')?.max ?? 200
  /** the counter shows only when the name is near its limit */
  const nameLimit = name.length >= nameMax * 0.8 ? { used: name.length, max: nameMax } : undefined
  const steps = making ? MAKE_STEPS : STEPS[source]
  const index =step === 'importing' ? steps.indexOf('review') : steps.indexOf(step)
  const [title, subtitle] = lookingUp && step === 'file' ? [`Add Your ${idLabel}s`, `Add your ${idLabel}s. C360 looks each one up and brings the rest of the person with it.`] : TITLES[step]

  /** `what`: what failed, in the message's first words ("The file was not uploaded") */
  const run = async (work: () => Promise<void>, what = '') => {
    setBusy(true)
    setError('')
    setProblemFailure(null)
    try {
      await work()
    } catch (problem) {
      setError(problemText(problem, what))
      const failure = saveFailure(problem, what)
      setProblemFailure(failure.reference ? failure : null)
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
      if (source !== 'UPLOAD' && source !== 'LOOKUP') {
        setStep(source === 'BI' ? 'audience' : 'clone')
        return
      }
      const body = { name, description, list_environment: environment, channel }
      setDraft(draft ? await api.patch<ContactList>(`/contact-lists/${draft.id}/`, body) : await api.post<ContactList>('/contact-lists/', body))
      setStep('file')
    }, 'The list was not saved')

  const takeFile = (file: File | undefined) => {
    if (!file || !draft) return
    void run(async () => {
      if (upload && !['APPLIED', 'FAILED', 'CANCELLED'].includes(upload.status)) {
        await api.post(`/contact-lists/${draft.id}/imports/${upload.id}/cancel/`).catch(() => undefined)     // "Replace": the first file is dropped
      }
      const staged = await api.upload<ListImport>(`/contact-lists/${draft.id}/imports/`, file,
        lookingUp ? { lookup_connections: (offered.length === 1 ? [offered[0].id] : lookupDbs).join(','), lookup_role: role } : {})
      setUpload(staged)
      setMapping(staged.mapping)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
    }, 'The file was not uploaded')
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    takeFile(event.dataTransfer.files[0])
  }

  const review = () =>
    run(async () => {
      if (!draft || !upload) return
      const tag_values = lookingUp ? undefined : tagTemplate ? { template_id: tagTemplate, tags: tagChoices } : null
      const queued = await api.post<ListImport>(`/contact-lists/${draft.id}/imports/${upload.id}/review/`, tag_values === undefined ? { mapping } : { mapping, tag_values })
      setUpload(queued)
      queryClient.setQueryData(['contact-lists', 'import', queued.contact_list, queued.id], queued)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
      // the check runs in the background while the consent questions are answered
      setStep(queued.consent?.required === false ? 'review' : 'consent')
    }, 'The columns were not checked')

  /** Look Up in C360: the lookup and the check run on their own, so the Tag Values step is saved by itself and read when the rows are ready */
  const saveTags = () =>
    run(async () => {
      if (!draft || !upload) return
      const saved = await api.post<ListImport>(`/contact-lists/${draft.id}/imports/${upload.id}/tag-values/`,
        { tag_values: tagTemplate ? { template_id: tagTemplate, tags: tagChoices } : null })
      setUpload(saved)
      queryClient.setQueryData(['contact-lists', 'import', saved.contact_list, saved.id], saved)
      setStep(saved.consent?.required === false ? 'review' : 'consent')
    }, 'The tag values were not saved')

  /** where the file's people agreed, and the uploader's word that they did: kept on the import and the list's compliance record */
  const declare = () =>
    run(async () => {
      if (!draft || !upload || !basis) return
      const declared = await api.post<ListImport>(`/contact-lists/${draft.id}/imports/${upload.id}/consent/`, { basis, collected_at: collectedAt, attested })
      setUpload(declared)
      queryClient.setQueryData(['contact-lists', 'import', declared.contact_list, declared.id], declared)
      setStep('review')
    }, 'The consent was not saved')

  const apply = () =>
    run(async () => {
      if (!draft || !upload) return
      const queued = await api.post<ListImport>(`/contact-lists/${draft.id}/imports/${upload.id}/apply/`)
      setUpload(queued)
      queryClient.setQueryData(['contact-lists', 'import', queued.contact_list, queued.id], queued)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
      setStep('importing')
    }, 'The import did not start')

  /** the job goes on without the wizard: the header's upload button and an alert report on it */
  const leaveRunning = () => {
    leaving.current.keep = true
    void queryClient.invalidateQueries({ queryKey: ['contact-lists', 'imports'] })
    onClose()
  }

  const fromAudience = () => run(async () => finish(await api.post<ContactList>('/contact-lists/from-audience/', { name, description, list_environment: environment, channel, audience })), 'The list was not made')
  const fromClone = () => run(async () => finish(await api.post<ContactList>(`/contact-lists/${parent}/clone/`, { name, description, list_environment: environment, channel })), 'The list was not copied')

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
  const consentMapped = lookingUp || columnOf(consentKey) !== ''        // a lookup brings the consent dates from C360
  const refuses = consent?.policy.without_consent === 'REFUSE'
  const textsNeedDate = Boolean(consent?.policy.texts_need_date) && channel !== 'EMAIL' && !lookingUp && columnOf('sms_consent_date') === ''

  const primary: { label: string; action: () => void; disabled: boolean } | null =
    making && step === 'source' ? { label: 'Next', action: () => setStep('method'), disabled: audience === '' && parent === '' }
    : making && step === 'method' ? { label: 'Create List', action: source === 'BI' ? fromAudience : fromClone, disabled: name.trim() === '' }
    : step === 'method' ? { label: 'Next', action: fromMethod, disabled: name.trim() === '' || (lookingUp && (offered.length === 0 || (offered.length > 1 && lookupDbs.length === 0))) }
    : step === 'file' ? { label: 'Next', action: () => setStep(lookingUp ? 'tags' : 'map'), disabled: !upload || job?.status === 'FAILED' || job?.status === 'CANCELLED' }
    : step === 'map' ? { label: 'Next', action: () => setStep('tags'), disabled: !emailMapped }
    : step === 'tags' ? { label: tagTemplate ? 'Next' : 'Skip', action: lookingUp ? saveTags : review, disabled: !lookingUp && !emailMapped }
    : step === 'consent' ? { label: 'Next', action: declare, disabled: basis === '' || !basisAllowed || !attested }
    : step === 'review' ? { label: 'Create List', action: apply, disabled: !job?.review || job.working || job.review.ready === 0 }
    : step === 'audience' ? { label: 'Create List', action: fromAudience, disabled: audience === '' }
    : step === 'clone' ? { label: 'Create List', action: fromClone, disabled: parent === '' }
    : null

  const footer =
    step === 'done' && making ? (
      <div className="flex w-full items-center justify-end"><button type="button" className={buttonPrimary} onClick={onClose}>Done</button></div>
    ) : step === 'done' && fresh ? (
      <div className="flex w-full items-center justify-end gap-2">
        <button type="button" className={buttonClass({ variant: 'ghost' })} onClick={onClose}>Close</button>
        {created && <button type="button" className={buttonPrimary} onClick={() => onReview?.(created)}>Review List</button>}
      </div>
    ) : step === 'done' ? (
      <button type="button" className={buttonPrimary} onClick={onClose}>
        Done
      </button>
    ) : (
      <div className="flex w-full items-center gap-2">
        {step !== 'importing' && !fresh && (
          <button type="button" className={buttonSecondary} onClick={abandon}>
            Cancel
          </button>
        )}
        {index > 0 && step !== 'importing' && (
          <button type="button" className={fresh ? buttonClass({ variant: 'ghost' }) : buttonSecondary} onClick={back} disabled={busy || (step === 'review' && Boolean(job?.working))}>
            {fresh && <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />}Back
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
  /** Audience or Clone: audiences and lists in one list, each with its kind and its size */
  const sourceRows: SourceRowData[] = [
    ...shownAudiences.map((item) => ({ kind: 'audience' as const, id: item.id, name: item.name, tag: sourceLabel('SEGMENT'), count: item.member_count })),
    ...shownLists.map((item) => ({ kind: 'list' as const, id: item.id, name: item.name, tag: sourceLabel(item.source_type), count: item.member_count })),
  ]
  const picked = audience !== ''
    ? (audiences.data ?? []).filter((item) => item.id === audience).map((item) => ({ name: item.name, tag: sourceLabel('SEGMENT'), count: item.member_count }))[0]
    : (lists.data?.results ?? []).filter((item) => item.id === parent).map((item) => ({ name: item.name, tag: sourceLabel(item.source_type), count: item.member_count }))[0]
  const chooseSource = (row: SourceRowData) => {
    setAudience(row.kind === 'audience' ? row.id : '')
    setParent(row.kind === 'list' ? row.id : '')
    setSource(row.kind === 'audience' ? 'BI' : 'CLONE')
    if (!nameEdited) setName(`Copy of ${row.name}`)
  }
  const review_ = job?.working ? null : job?.review
  /** the ways in on step 1: Look Up in C360 only when the workspace offers a database for it */
  const shownSources = SOURCES.filter((item) => (!sources || sources.includes(item.value))
    && (item.value !== 'LOOKUP' || offered.length > 0))
  const failed = job?.status === 'FAILED'

  const close = step === 'done' ? onClose : step === 'importing' || (step === 'review' && job?.working) ? leaveRunning : abandon
  const running = (step === 'importing' || (step === 'review' && Boolean(job?.working))) && job?.status !== 'FAILED'

  useEffect(() => { onAtStart?.(making ? step === 'source' : step === 'method' && !draft) }, [making, step, draft, onAtStart])
  useEffect(() => { onDone?.(fresh && step === 'done') }, [fresh, step, onDone])
  // the pop-up's own close leaves no half-made list behind, unless an import is running or the list is made
  const leaving = useRef({ draftId: '', keep: false })
  useEffect(() => { leaving.current.draftId = !draft || created || running ? '' : draft.id }, [draft, created, running])
  useEffect(() => () => {
    if (embedded && leaving.current.draftId && !leaving.current.keep) void api.delete(`/contact-lists/${leaving.current.draftId}/`).catch(() => undefined)
  }, [embedded])
  const framePrimary = step === 'done' ? { label: 'Done', onClick: onClose }
    : step === 'importing' ? { label: 'Continue in the Background', onClick: leaveRunning }
    : primary ? { label: primary.label, onClick: primary.action, disabled: primary.disabled, busy } : { label: 'Next', disabled: true }
  // a function, not a component: a component made here would remount the fields on every keystroke
  const enterToContinue = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (event.key !== 'Enter' || !primary || primary.disabled || busy || target.tagName !== 'INPUT') return
    event.preventDefault()
    primary.action()
  }
  const frame = (children: ReactNode) => fresh ? (
    <div data-embedded-wizard onKeyDown={enterToContinue}>
      {step !== 'done' && <div className="mb-6"><Stepper steps={making ? MAKE_STEP_NAMES : UPLOAD_STEP_NAMES} current={index} /></div>}
      {(step === 'importing' || (step === 'review' && !review_)) && <h3 className="mb-3 text-card-title font-semibold text-ink-900">{title}</h3>}
      {children}
      <div className="-mx-4 mt-6 flex flex-wrap justify-end gap-2 border-t border-line px-4 pt-4">{footer}</div>
    </div>
  ) : embedded ? (
    <div data-embedded-wizard>
      <h3 className="mb-1 text-card-title font-semibold text-ink-900">{title}</h3>
      {children}
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line-subtle pt-4">{footer}</div>
    </div>
  ) : (
    <SetupDialog title="Create Contact List" steps={steps.map((item, at) => (lookingUp && item === 'file' ? idLabel + 's' : STEP_NAME[at === index ? step : item]))} step={index + 1} onClose={close}
      onBack={index > 0 && step !== 'importing' && step !== 'done' && !(step === 'review' && job?.working) ? back : undefined}
      primary={framePrimary} hideCancel={step === 'done' || step === 'importing'} locked={busy}
      extraActions={running && step !== 'importing' ? <button type="button" className={buttonSecondary} onClick={leaveRunning}>Continue in the Background</button> : undefined}
      error={error ? { title: 'That Didn’t Work', message: <><p>{error}</p><ProblemExtras failure={problemFailure} /></> } : null}>
      {children}
    </SetupDialog>
  )

  return frame(
    <>
      {fresh ? null : embedded ? (
        <p className="mb-4 text-xs text-ink-800" aria-live="polite">
          {step === 'done' ? subtitle : `Step ${index + 1} of ${steps.length}${subtitle ? ` · ${subtitle}` : ''}`}
        </p>
      ) : subtitle && <p className="-mb-2 text-helper text-ink-800" aria-live="polite">{subtitle}</p>}
      {error && embedded && (
        <div role="alert" className="mb-4 rounded-sm border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
          <p>{error}</p>
          <ProblemExtras failure={problemFailure} />
        </div>
      )}

      {step === 'source' && making && (
        <div className="flex flex-col gap-4">
          <InputGroup controlSize="md" type="search" aria-label="Search audiences and lists" placeholder="Search audiences and lists" value={filter}
            onChange={(event) => setFilter(event.target.value)} start={<Search size={16} strokeWidth={1.5} aria-hidden />} autoFocus />
          {audiences.isPending || lists.isPending ? (
            <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner className="h-4 w-4" /> Loading</p>
          ) : (
            <div role="radiogroup" aria-label="Source to copy" className="max-h-80 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line">
              {sourceRows.map((row) => (
                <SourceRow key={`${row.kind}-${row.id}`} selected={row.kind === 'audience' ? audience === row.id : parent === row.id} onSelect={() => chooseSource(row)} row={row} />
              ))}
              {sourceRows.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-ink-800">No audience or list matches. Audiences are defined by your data team in the BI / extraction tool.</p>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'method' && fresh && (
        <div className="flex flex-col gap-5">
          {making && picked && (
            <div className="flex items-center gap-4 rounded-lg border border-line bg-surface-subtle px-4 py-3">
              <div className="min-w-0 grow">
                <p className="text-helper text-ink-800">Copying from</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-card-title font-semibold text-ink-900">
                  <span className="truncate">{picked.name}</span><Tag>{picked.tag}</Tag>
                  <span className="cep-num text-sm font-normal text-ink-800">{formatNumber(picked.count)} contacts</span>
                </p>
              </div>
              <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => setStep('source')}>Change</button>
            </div>
          )}
          <Field label="List Name" strong limit={nameLimit}>
            {(ids) => (
              <TextInput {...ids} value={name} onChange={(event) => { setName(event.target.value); setNameEdited(true) }} placeholder="e.g. Lapsed buyers — West Q3" maxLength={nameMax} data-autofocus />
            )}
          </Field>
          <div>
            <span id={useForId} className="block text-sm font-semibold text-ink-900">Use For</span>
            <div className="mt-1.5"><PillRadioGroup labelledBy={useForId} value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} disabled={Boolean(draft)} /></div>
          </div>
          <div>
            <span id={listTypeId} className="block text-sm font-semibold text-ink-900">List Type</span>
            <div className="mt-1.5"><PillRadioGroup labelledBy={listTypeId} value={environment as 'PRODUCTION' | 'TEST'} onChange={setEnvironment} options={TYPE_OPTIONS} /></div>
            <p className="mt-1.5 text-helper text-ink-800">Test lists are held out of live sends until you promote them.</p>
          </div>
          {showDescription || description !== '' ? (
            <Field label="Description" strong hint="Shown under the name in the table.">
              {(ids) => <TextArea {...ids} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="e.g. Gold and Platinum members who joined before October" autoFocus={showDescription} />}
            </Field>
          ) : (
            <div>
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => setShowDescription(true)}>
                <Plus size={16} strokeWidth={1.5} aria-hidden />Add Description
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'method' && !fresh && (
        <div className="flex flex-col gap-6">
          <Field label="List Name" required strong limit={{ used: name.length, max: rule('name')?.max ?? 200 }} help="How the list is listed everywhere, including a campaign's Send To table and the Set-Up page. It can be changed later on the list's Edit Details.">
            {(ids) => (
              <TextInput {...ids} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Lapsed buyers — West Q3" maxLength={rule('name')?.max ?? 200} data-autofocus />
            )}
          </Field>
          <ChoiceGroup label="Where the Contacts Come From" required strong columns={`grid-cols-1 ${shownSources.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
            hint={draft ? 'The file upload has started for this list. Cancel to choose another source.' : undefined}>
            {shownSources.map((item) => (
              <SetupCard key={item.value} tile selected={source === item.value} disabled={Boolean(draft) && source !== item.value} onSelect={() => !draft && setSource(item.value)} title={item.title} text={item.text} icon={item.icon} badge={item.badge} />
            ))}
          </ChoiceGroup>
          {lookingUp && (
            <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-subtle p-4" data-lookup-options>
              {offered.length > 1 && (
                <fieldset disabled={Boolean(draft)}>
                  <legend className="text-sm font-semibold text-ink-900">Look Up In <span aria-hidden className="text-danger-text">*</span></legend>
                  <p className="mt-0.5 text-xs text-ink-800">Tick one or more. They are searched in the order ticked; the first that has the ID is used.</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {offered.map((item) => {
                      const at = lookupDbs.indexOf(item.id)
                      return (
                        <Checkbox key={item.id} label={at >= 0 && lookupDbs.length > 1 ? `${item.name} (${at + 1})` : item.name} checked={at >= 0}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => setLookupDbs((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
                      )
                    })}
                  </div>
                </fieldset>
              )}
              <Field label="Role" strong hint="Only people who hold this role in C360 are imported. It also names the IDs in your file.">
                {(ids) => (
                  <Select {...ids} value={role} onChange={(event) => setRole(event.target.value)} disabled={Boolean(draft)}>
                    {roleChoices.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                    <option value="">Any Role (Party ID)</option>
                  </Select>
                )}
              </Field>
            </div>
          )}
          <ChoiceGroup label="What the List Is For" required strong columns="grid-cols-1 sm:grid-cols-3">
            {CHANNELS.map((item) => (
              <SetupCard key={item.value} tile selected={channel === item.value} disabled={Boolean(draft) && channel !== item.value} onSelect={() => !draft && setChannel(item.value)} title={item.title} text={item.text} icon={item.icon} />
            ))}
          </ChoiceGroup>
          <ChoiceGroup label="List Type" required strong columns="grid-cols-1 sm:grid-cols-2">
            {TYPES.map((item) => (
              <SetupCard key={item.value} tile selected={environment === item.value} onSelect={() => setEnvironment(item.value)} title={item.title} text={item.text} icon={item.icon} />
            ))}
          </ChoiceGroup>
          <Field label="Description (Optional)" strong hint="Shown under the name in the table.">
            {(ids) => (
              <TextArea {...ids} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="e.g. Gold and Platinum members who joined before October" />
            )}
          </Field>
        </div>
      )}

      {step === 'file' && fresh && (
        <div className="flex flex-col gap-4">
          <input ref={picker} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV File" onChange={(event) => takeFile(event.target.files?.[0])} />
          {upload ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-fill-subtle text-ink-800"><FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden /></span>
              <div className="min-w-0 grow">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <span className="truncate">{upload.file_name}</span>
                  {job?.status === 'FAILED'
                    ? <span className="text-danger-plain"><CircleAlert size={16} strokeWidth={1.5} aria-label="Could not be read" /></span>
                    : <span className="text-success-text"><CheckCircle2 size={16} strokeWidth={1.5} aria-label="Received" /></span>}
                </p>
                <p className="text-helper text-ink-800">
                  {job && job.row_count > 0 ? `${formatNumber(job.row_count)} rows · ` : ''}{upload.columns.length} columns{upload.file_size ? ` · ${fileSize(upload.file_size)}` : ''}
                </p>
                {job?.working && (
                  <p className="mt-1 text-helper text-ink-800" aria-live="polite">{job.phase}{job.progress.percent > 0 ? ` · ${job.progress.percent}%` : ''}. You can match the columns meanwhile.</p>
                )}
                {job?.status === 'FAILED' && (
                  <p role="alert" className="mt-1 text-helper font-medium text-danger-plain">{job.error ?? 'This file could not be read.'} Choose Replace to upload another file.</p>
                )}
              </div>
              <button type="button" className={buttonClass({ variant: 'secondary', size: 'sm' })} onClick={() => picker.current?.click()} disabled={busy}>Replace</button>
            </div>
          ) : (
            <div
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center ${dragging ? 'border-link bg-callout-bg' : 'border-line bg-surface-subtle'}`}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-fill-subtle text-ink-800"><Upload size={20} strokeWidth={1.5} aria-hidden /></span>
              <p className="text-sm font-semibold text-ink-900">Drop Your CSV Here</p>
              <button type="button" className={buttonClass({ variant: 'secondary' })} onClick={() => picker.current?.click()} disabled={busy}>
                {busy ? 'Reading the File' : 'Choose File'}
              </button>
              <p className="text-helper text-ink-800">Up to 50 MB and 250,000 rows. {requiredColumns(channel)}</p>
            </div>
          )}
          {!upload && (
            <div>
              <button type="button" className={buttonClass({ variant: 'link', size: 'sm' })} onClick={() => downloadTemplate(channel)}>
                <Download size={16} strokeWidth={1.5} aria-hidden />Download Sample CSV
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'file' && !fresh && (
        <div>
          <input ref={picker} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV File" onChange={(event) => takeFile(event.target.files?.[0])} />
          {upload ? (
            <div className="rounded-lg border border-line p-4">
              <p className="mb-2 text-xs font-semibold text-ink-800">Attached File</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-fill-subtle text-ink-800"><FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden /></span>
                <div className="min-w-0 grow">
                  <p className="truncate text-sm font-semibold text-ink-900">{upload.file_name} <span className="ml-1 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-xs font-medium text-success-text">{job?.status === 'FAILED' ? 'Failed' : 'Received'}</span></p>
                  <p className="text-xs text-ink-800">
                    {lookingUp
                      ? `${job && job.row_count > 0 ? `${formatNumber(job.row_count)} ${idLabel}s` : 'Reading the IDs'}${upload.file_size ? ` · ${fileSize(upload.file_size)}` : ''}`
                      : <>{job && job.row_count > 0 ? `${formatNumber(job.row_count)} rows · ` : ''}{upload.columns.length} columns{upload.file_size ? ` · ${fileSize(upload.file_size)}` : ''}</>}
                  </p>
                  {job?.working && (
                    <p className="mt-1 text-xs text-ink-800" aria-live="polite">{job.phase}{job.progress.percent > 0 ? ` · ${job.progress.percent}%` : ''}. {lookingUp ? 'You can answer the consent questions meanwhile.' : 'You can match the columns meanwhile.'}</p>
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
              className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center ${dragging ? 'border-link bg-callout-bg' : 'border-line bg-surface-subtle'}`}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface text-ink-800"><Upload size={20} strokeWidth={1.5} aria-hidden /></span>
              <p className="text-sm font-semibold text-ink-900">Drag and drop your file here, or browse</p>
              <p className="text-xs text-ink-800">{lookingUp ? `CSV only · up to 50 MB · 2,000,000 ${idLabel}s` : 'CSV only · up to 50 MB · 250,000 rows'}</p>
              <button type="button" className={buttonSecondary} onClick={() => picker.current?.click()} disabled={busy}>
                {busy ? 'Reading the file' : 'Choose File'}
              </button>
            </div>
          )}
          {!upload && (lookingUp ? <LookupTemplateNote idLabel={idLabel} /> : <TemplateNote channel={channel} />)}
        </div>
      )}

      {step === 'map' && upload && fresh && (
        <div className="flex flex-col gap-4">
          <p className={`flex items-center gap-2 text-sm font-semibold ${emailMapped ? 'text-ink-900' : 'text-danger-plain'}`} aria-live="polite">
            {emailMapped
              ? <><Check size={16} strokeWidth={2} aria-hidden className="text-success-text" />{mappedCount} of {upload.columns.length} columns matched</>
              : <>{mappedCount} of {upload.columns.length} columns matched · {missing.map((item) => item.label.toLowerCase()).join(' and ')} still {missing.length === 1 ? 'needs' : 'need'} a column</>}
          </p>
          <div className="max-h-[360px] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[520px] text-left text-sm">
              <caption className="sr-only">Columns of {upload.file_name} and what they mean</caption>
              <thead className="sticky top-0 bg-surface-subtle text-xs font-semibold text-ink-900">
                <tr>
                  <th scope="col" className="px-4 py-2.5">In Your File</th>
                  <th scope="col" className="px-4 py-2.5">Maps To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {upload.columns.map((column) => {
                  const property = propertyOf(column.name)
                  return (
                    <tr key={column.name}>
                      <th scope="row" className="px-4 py-3 align-middle font-semibold text-ink-900">
                        <span className="flex items-center gap-2">{column.name}{!property && <Tag tone="warning">Not Matched</Tag>}</span>
                        <span className="block max-w-[260px] truncate text-helper font-normal text-ink-800">{column.samples.slice(0, 2).join(', ') || 'no values'}</span>
                      </th>
                      <td className="px-4 py-3 align-middle">
                        <Select aria-label={`C360 Property for ${column.name}`} value={property} className="mt-0! w-[260px]" onChange={(event) => choose(column.name, event.target.value)}>
                          <option value="">Skip This Column</option>
                          {upload.properties.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}{item.required ? ' (required)' : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'map' && upload && !fresh && (
        <div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Columns of {upload.file_name} and what they mean</caption>
              <thead className="bg-surface-subtle text-xs font-semibold text-ink-900">
                <tr>
                  <th scope="col" className="px-3 py-2">Column in Your File</th>
                  <th scope="col" className="px-3 py-2">C360 Property</th>
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
                        <Select aria-label={`C360 Property for ${column.name}`} value={property} onChange={(event) => choose(column.name, event.target.value)}>
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

      {step === 'tags' && upload && (
        <TagValuesStep upload={upload} mapping={lookingUp ? job?.mapping ?? {} : mapping} channel={channel} campaignTemplate={templateId} template={tagTemplate} onTemplate={setTagTemplate}
          choices={tagChoices} onChoices={setTagChoices} />
      )}

      {step === 'consent' && upload && consent && fresh && (
        <div className="flex flex-col gap-5">
          <h3 id={basisId} className="font-display text-card-heading font-semibold text-ink-900">How did these people opt in?</h3>
          <div role="radiogroup" aria-labelledby={basisId} className="-mt-2 flex flex-col gap-2">
            {consent.bases.map((item) => (
              <OptInRow key={item.key} selected={basis === item.key} disabled={!item.allowed} onSelect={() => setBasis(item.key)} title={item.label}
                text={item.key === 'IMPLIED' ? 'Bought in the last two years and never opted out. Not valid for texts.' : undefined} tag={!item.allowed ? 'Not for Texts' : undefined} />
            ))}
            <OptInRow selected={false} disabled onSelect={() => undefined} title="Bought or Rented List" tag="Not Allowed" />
          </div>
          {basis && !basisAllowed && (
            <p role="alert" className="rounded-sm border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
              A texts list needs express consent: marketing texts need a written opt-in with a date (TCPA, CASL). Map a Text consent date column, or choose a basis where people opted in.
            </p>
          )}
          <Field label="Where It Was Collected (Optional)" strong>
            {(ids) => <TextInput {...ids} value={collectedAt} onChange={(event) => setCollectedAt(event.target.value)} maxLength={300} placeholder="e.g. Fall 2026 sign-up form" />}
          </Field>
          <div className="rounded-lg border border-line bg-surface-subtle p-4">
            <Checkbox label={consent.attestation} checked={attested} onChange={(event: ChangeEvent<HTMLInputElement>) => setAttested(event.target.checked)} />
            <p className="mt-1 pl-6 text-helper text-ink-800">
              Recorded with your name and the time.{' '}
              {lookingUp
                ? 'Consent dates come from C360: Allow Solicitation Y becomes an opt-in, dated by the solicitation change date, for people C360 has no answer for.'
                : consentMapped
                ? `${upload.properties.find((item) => item.key === consentKey)?.label ?? 'Consent date'} is mapped: a valid date becomes an opt-in for people C360 has no answer for.`
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

      {step === 'consent' && upload && consent && !fresh && (
        <div className="space-y-5">
          <div>
            <p id="cl-basis" className="mb-2 text-sm font-semibold text-ink-900">Consent Basis <span aria-hidden className="text-danger-text">*</span></p>
            <div role="radiogroup" aria-labelledby="cl-basis" className="space-y-2">
              {consent.bases.map((item) => (
                <ChoiceCard key={item.key} selected={basis === item.key} onSelect={() => item.allowed && setBasis(item.key)} title={item.label} text={BASIS_TEXT[item.key]}
                  badge={!item.allowed ? 'Not for Texts' : undefined} />
              ))}
              <ChoiceCard selected={false} onSelect={() => undefined} title="Bought or rented list" text="Cannot be imported. C360 sends only to people who agreed to hear from the workspace." badge="Not Allowed" />
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
              {lookingUp
                ? 'Consent dates come from C360: Allow Solicitation Y becomes an opt-in, dated by the solicitation change date, for people C360 has no answer for.'
                : consentMapped
                ? `${upload.properties.find((item) => item.key === consentKey)?.label ?? 'Consent date'} is mapped: a valid date becomes an opt-in for people C360 has no answer for.`
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
              <ProgressCount job={job} />
              <p className="text-sm text-ink-800">
                {job.row_count > 0 ? `${formatNumber(job.row_count)} ${lookingUp ? `${idLabel}s` : 'rows'}. ` : ''}Large files take a few minutes and are handled a chunk at a time, so the rest of C360 stays fast.
                You can wait here, or continue in the background: the upload button at the top shows the progress and you get an alert when it is done.
              </p>
            </>
          )}
        </div>
      )}

      {step === 'review' && review_ && upload && job && fresh && (
        <div className="flex flex-col gap-5">
          <div>
            <p className="font-display text-section-title font-semibold text-ink-900">{formatNumber(review_.ready)} contacts ready to import</p>
            <p className="text-sm text-ink-800">{upload.file_name}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['New', review_.new, ''], ['Already in C360', review_.existing, ''], ['Warnings', review_.warnings, 'warning'], ['Held Back', review_.errors, 'danger']] as const).map(([label, value, tone]) => (
              <div key={label} data-tile={label}
                className={`rounded-lg border px-4 py-3 ${value > 0 && tone === 'warning' ? 'border-warning bg-warning-bg text-warning-text' : value > 0 && tone === 'danger' ? 'border-danger bg-danger-bg text-danger-text' : 'border-line text-ink-800'}`}>
                <dd className={`cep-num text-section-title font-semibold ${value > 0 && tone ? '' : 'text-ink-900'}`}>{formatNumber(value)}</dd>
                <dt className="text-sm">{label}</dt>
              </div>
            ))}
          </dl>
          {job.summary && (
            <div className="rounded-lg border border-line p-4">
              <p className="mb-3 text-sm font-semibold text-ink-900">Can Be Contacted Today</p>
              <div className="flex flex-col gap-3">
                <ReachRow label="Email" count={job.summary.governance.sendable} of={job.summary.ready.total} />
                {job.summary.mobile && <ReachRow label="Texts" count={Math.max(0, job.summary.mobile.with_number - job.summary.mobile.blocked)} of={job.summary.ready.total} />}
              </div>
            </div>
          )}
          {job.summary && !job.summary.balanced && (
            <p role="alert" className="text-helper font-medium text-danger-plain">These numbers do not add up. Download the row-by-row report and tell support.</p>
          )}
          <TagValuesReview job={job} />
          {(job.issues ?? []).length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-800">Rows to Look At{(job.issues ?? []).length >= 50 ? ' (first 50)' : ''}</p>
              <ul className="max-h-44 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line text-sm">
                {(job.issues ?? []).map((issue) => (
                  <li key={`${issue.line}-${issue.kind}`} className="flex items-start gap-3 px-3 py-1.5">
                    <span className="cep-num w-14 shrink-0 text-xs text-ink-800">Line {issue.line}</span>
                    <Tag tone={issue.kind === 'error' ? 'error' : 'warning'}>{issue.kind === 'error' ? 'Held Back' : 'Warning'}</Tag>
                    <span className="min-w-0 text-ink-800">{issue.message}{issue.value ? <span className="text-ink-800"> · {issue.value}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review_.new > 0 && <p className="text-helper text-ink-800">New contacts have no consent answer in C360 unless the file gives a consent date, so marketing sends will leave them out until they opt in.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <ReportDownload job={job} className={buttonClass({ variant: 'link', size: 'sm' })}>
              <Download size={16} strokeWidth={1.5} aria-hidden />Download Row-by-Row Report
            </ReportDownload>
          </div>
        </div>
      )}

      {step === 'review' && review_ && upload && job && !fresh && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line px-4 py-3">
            <p className="text-sm text-ink-800">Ready to Import <span className="cep-num ml-1 text-base font-semibold text-ink-900">{formatNumber(review_.ready)} contacts</span></p>
            <p className="cep-num text-sm text-ink-800">{formatNumber(review_.held_back)} rows held back</p>
          </div>
          <LookupSection job={job} />
          <TagValuesReview job={job} />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['New', review_.new, 'not in C360 yet'], ['Existing', review_.existing, 'already known'], ['Warnings', review_.warnings, 'imported with a remark'], ['Errors', review_.errors, 'held back']] as const).map(
              ([label, value, hint]) => (
                <div key={label} className="rounded-lg border border-line px-3 py-2">
                  <dd className="cep-num text-section-title font-semibold text-ink-900">{formatNumber(value)}</dd>
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
                    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium ${issue.kind === 'error' ? 'bg-danger-bg text-danger-text' : 'bg-warning-bg text-warning-text'}`}>
                      {issue.kind === 'error' ? 'Held Back' : 'Warning'}
                    </span>
                    <span className="min-w-0 text-ink-800">{issue.message}{issue.value ? <span className="text-ink-800"> · {issue.value}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <UploadReport job={job} />
          {review_.new > 0 && <p className="text-xs text-ink-800">New contacts have no consent answer in C360 unless the file gives a consent date, so marketing sends will leave them out until they opt in.</p>}
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

      {step === 'done' && created && making && (
        <div className="flex items-center gap-4 rounded-lg border border-line p-4">
          <div className="min-w-0 grow">
            <p className="truncate text-card-title font-semibold text-link">{created.name}</p>
            <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-800"><Tag>{source === 'CLONE' ? 'Clone' : sourceLabel(created.source_type)}</Tag><span className="cep-num">{formatNumber(created.member_count)} contacts</span></p>
          </div>
        </div>
      )}

      {step === 'done' && created && fresh && !making && (
        <div className="flex items-center gap-4 rounded-lg border border-line p-4">
          <div className="min-w-0 grow">
            <p className="truncate text-card-title font-semibold text-link">{created.name}</p>
            <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-800"><Tag>Upload</Tag><span className="cep-num">{formatNumber(created.member_count)} contacts</span></p>
          </div>
          <StatusBadge status="PAUSED" label="Needs Review" />
        </div>
      )}

      {step === 'done' && created && !fresh && (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-success-text"><CheckCircle2 size={22} strokeWidth={1.5} aria-hidden /></span>
          <div className="space-y-2 text-sm text-ink-800">
            <p className="text-base font-semibold text-ink-900">{created.name} is ready</p>
            {(source === 'UPLOAD' || source === 'LOOKUP') && upload && (
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
