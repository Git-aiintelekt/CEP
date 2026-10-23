/**
 * AI · Ask for a Report (docs/mockups/report-builder.html): a prompt box above the report list. The person writes what they
 * want, picks a model (Claude or OpenAI, whichever the platform has switched on and the workspace allows; the last choice is
 * remembered per browser) and presses Generate. What comes back is a draft (in words, with a preview count; Open in Editor
 * makes it a private report and opens it), one question with its answers as buttons, or "no field for this" with the
 * closest prompts. The model sees the prompt and the field names, never customer rows. Only a draft counts against the month.
 * The prompt may run to 100,000 characters over several lines (the counter shows from 90,000), and up to five images (a sketch, a
 * screenshot of a chart or a table) and three documents (the report's spec as PDF, Word, Excel, CSV, text or Markdown) may go with it. They go
 * to the model and are not kept. One box holds "Ask About" (the data the prompt is about; AskAbout.tsx), the attachments, the text
 * and a bar with the paperclip, the counter, the model and Generate (docs/mockups/ask-for-report-data-and-specs.html, option A);
 * files dragged anywhere over the panel show the drop target on it, and pasting into the text adds them too. "Add To" beside the
 * model files the report under a component of the suite (docs/mockups/report-component.html, option A); Automatic is its data's.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Paperclip, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary, Counter, TextInput } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'
import { Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { assistantApi, keys, useAssistant, useCatalog } from '../api'
import { ATTACHMENTS_BYTES_MAX, DOCUMENT_ACCEPT, DOCUMENT_BYTES_MAX, documentKind, DOCUMENTS_MAX, KIND_LABEL, sizeWords, type DocumentKind } from '../askDocuments'
import { IMAGE_BYTES_MAX, IMAGE_TYPES, IMAGES_MAX, isImage, shrink } from '../askImages'
import { databaseOf, plural, remember, remembered, rememberedScope, rememberedUnmapped, useAskData, usableScope } from '../askScope'
import { columnWords, ruleWords } from '../editor/definition'
import { useComponents } from '../reportComponents'
import type { AskResult, AskScope, AssistantModel, CatalogDataset, ReportSummary } from '../types'
import { AskAbout } from './AskAbout'
import { AskProgress } from './AskProgress'
import { ComponentSelect } from './ComponentSelect'

const MODEL_KEY = 'insights.ai.model'
const PROMPT_MAX = 100_000
const COUNTER_FROM = 90_000
type Attached = { file: File; url: string }
type AttachedDocument = { file: File; kind: DocumentKind }
const VIEW_LABEL: Record<ReportSummary['view_type'], string> = { grid: 'Grid', chart: 'Chart', pivot: 'Pivot', hierarchy: 'Hierarchy', influencers: 'Key Influencers', decomposition: 'Decomposition Tree' }
const DOCUMENT_MARK: Record<DocumentKind, { text: string; tone: string }> = {
  pdf: { text: 'PDF', tone: 'bg-danger-bg text-danger-text' }, word: { text: 'DOC', tone: 'bg-brand-100 text-brand-800' },
  excel: { text: 'XLS', tone: 'bg-success-bg text-success-text' }, csv: { text: 'CSV', tone: 'bg-fill-subtle text-ink-800' },
  text: { text: 'TXT', tone: 'bg-fill-subtle text-ink-800' }, markdown: { text: 'MD', tone: 'bg-fill-subtle text-ink-800' },
}

function joined(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/** an id the box and the server share for one prompt's steps */
function newProgressId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16))
}

export function AiPill() {
  return <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-plum-100 px-1.5 text-[11px] font-bold tracking-wide text-plum-700" aria-label="AI">AI</span>
}

function Mark({ model }: { model: Pick<AssistantModel, 'mark' | 'provider_name'> }) {
  return <span aria-hidden className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border border-line bg-surface-subtle text-[10px] font-bold text-ink-900">{model.mark}</span>
}

export function AskForReport() {
  const state = useAssistant()
  const catalog = useCatalog()
  const client = useQueryClient()
  const navigate = useNavigate()
  const box = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState<Attached[]>([])
  const [documents, setDocuments] = useState<AttachedDocument[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [scope, setScope] = useState<AskScope>(rememberedScope)
  const [unmapped, setUnmapped] = useState(rememberedUnmapped)
  const [component, setComponent] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const shown = useRef<Attached[]>([])                                                     // the previews to let go of when the box goes
  useEffect(() => { shown.current = images }, [images])
  useEffect(() => () => shown.current.forEach((image) => URL.revokeObjectURL(image.url)), [])
  const [modelId, setModelId] = useState<string | null>(() => remembered(MODEL_KEY))
  const [result, setResult] = useState<AskResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const menu = useSingleDropdown<'model' | 'data'>()
  const askData = useAskData(catalog.data?.datasets)
  const [progressId, setProgressId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const ask = useMutation({
    mutationFn: ({ body, files, docs }: { body: Parameters<typeof assistantApi.ask>[0]; files: File[]; docs: File[] }) => assistantApi.ask(body, files, docs),
    onMutate: () => setFailure(null),
    onSuccess: (reply) => { setResult(reply); void client.invalidateQueries({ queryKey: keys.assistant }) },
    onError: (error) => setFailure(error instanceof ApiError ? error.message : 'The request did not go through.'),
  })
  const open = useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) => assistantApi.open(id, name),
    onSuccess: (report) => {
      void client.invalidateQueries({ queryKey: ['insights', 'reports'] })
      void client.invalidateQueries({ queryKey: keys.catalog })                                // a draft on tables not mapped yet mapped a dataset
      navigate(`/insights/reports/${report.id}/edit`)
    },
    onError: (error) => setFailure(error instanceof ApiError ? error.message : 'The report was not created.'),
  })

  // the server's steps for the prompt under way, every second while the box waits, and the clock beside the one under way
  const live = useQuery({ queryKey: ['insights', 'assistant', 'progress', progressId], queryFn: ({ signal }) => assistantApi.progress(progressId as string, signal),
    enabled: ask.isPending && Boolean(progressId), refetchInterval: 1000, retry: false })
  useEffect(() => {
    if (!ask.isPending) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ask.isPending])
  if (!state.data?.enabled) return null
  const data = state.data
  const models = data.models
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === data.default_model) ?? models[0]
  const pick = (id: string) => { setModelId(id); remember(MODEL_KEY, id); menu.close({ restoreFocus: true }) }
  const asking = usableScope(scope, askData)
  const database = databaseOf(asking, askData)
  const send = (text: string, answerTo?: string) => {
    if (!text.trim() || !model) return
    const progress = newProgressId()
    setProgressId(progress)
    setStartedAt(Date.now())
    setNow(Date.now())
    ask.mutate({ body: { prompt: text.trim(), model: model.id, progress, ...(answerTo ? { answer_to: answerTo } : {}), ...(asking !== 'all' ? { scope: asking } : {}), ...(database && unmapped ? { unmapped: true } : {}), ...(component ? { component } : {}) },
      files: images.map((image) => image.file), docs: documents.map((document) => document.file) })
  }
  const attach = async (files: File[]) => {
    const errors: string[] = []
    const over = (taken: File[], room: number, most: number, what: string) => {
      if (taken.length <= room) return
      const left = taken.slice(Math.max(0, room)).map((file) => file.name)
      errors.push(`Add up to ${most} ${what}. ${left.join(', ')} ${left.length === 1 ? 'was' : 'were'} not added.`)
    }
    const wrong = files.find((file) => !isImage(file) && !documentKind(file))
    if (wrong) errors.push(`${wrong.name || 'That file'} is not an image (PNG, JPEG, GIF, WebP) or a document (PDF, Word, Excel, CSV, text, Markdown).`)
    let room = ATTACHMENTS_BYTES_MAX - [...images, ...documents].reduce((sum, item) => sum + item.file.size, 0)
    const fitsTogether = (file: File) => {
      if (file.size > room) { errors.push(`Images and documents may come to ${ATTACHMENTS_BYTES_MAX / 1_000_000} MB together. ${file.name} was not added.`); return false }
      room -= file.size
      return true
    }

    const docs = files.filter((file) => !isImage(file) && documentKind(file))
    over(docs, DOCUMENTS_MAX - documents.length, DOCUMENTS_MAX, 'documents')
    const bigDoc = docs.slice(0, Math.max(0, DOCUMENTS_MAX - documents.length)).filter((file) => file.size > DOCUMENT_BYTES_MAX)
    for (const file of bigDoc) errors.push(`${file.name} is ${(file.size / 1_000_000).toFixed(1)} MB; a document may be up to ${DOCUMENT_BYTES_MAX / 1_000_000} MB.`)
    const takenDocs = docs.slice(0, Math.max(0, DOCUMENTS_MAX - documents.length)).filter((file) => file.size <= DOCUMENT_BYTES_MAX).filter(fitsTogether)
    if (takenDocs.length) setDocuments((now) => [...now, ...takenDocs.map((file) => ({ file, kind: documentKind(file) as DocumentKind }))].slice(0, DOCUMENTS_MAX))

    const taken = files.filter(isImage)
    const imageRoom = IMAGES_MAX - images.length
    over(taken, imageRoom, IMAGES_MAX, 'images')
    const ready = await Promise.all(taken.slice(0, Math.max(0, imageRoom)).map(shrink))
    const big = ready.find((file) => file.size > IMAGE_BYTES_MAX)
    if (big) errors.push(`${big.name} is ${(big.size / 1_000_000).toFixed(1)} MB; an image may be up to ${(IMAGE_BYTES_MAX / 1_000_000).toFixed(1)} MB.`)
    const fits = ready.filter((file) => file.size <= IMAGE_BYTES_MAX).filter(fitsTogether).map((file) => ({ file, url: URL.createObjectURL(file) }))
    if (fits.length) setImages((now) => [...now, ...fits].slice(0, IMAGES_MAX))
    setFileError(errors.length ? errors.join(' ') : null)
  }
  const detach = (image: Attached) => { URL.revokeObjectURL(image.url); setImages((now) => now.filter((other) => other !== image)); setFileError(null) }
  const detachDocument = (document: AttachedDocument) => { setDocuments((now) => now.filter((other) => other !== document)); setFileError(null) }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); void attach(files) }
  }
  const onDrop = (event: DragEvent<HTMLElement>) => {
    setDragging(false)
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    void attach(Array.from(event.dataTransfer.files))
  }
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }
  // leaving a child for another one inside the panel is not leaving the panel
  const onDragLeave = (event: DragEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }
  const full = images.length >= IMAGES_MAX && documents.length >= DOCUMENTS_MAX
  const attachedWords = [documents.length ? plural(documents.length, 'document') : '', images.length ? plural(images.length, 'image') : ''].filter(Boolean).join(' · ')
  const fieldWords = database ? `the names of ${database.name}’s fields${unmapped ? ' and tables' : ''}` : asking === 'platform' ? 'the platform’s field names' : asking === 'uploads' ? 'the uploaded files’ field names' : 'the field names'
  const attachedKinds = documents.length && images.length ? 'documents and images' : documents.length ? 'documents' : 'images'
  const sends = images.length || documents.length
    ? `Sends your prompt, the ${attachedKinds} and ${fieldWords}, never your data. ${attachedKinds.charAt(0).toUpperCase()}${attachedKinds.slice(1)} are not kept.`
    : `Sends your prompt and ${fieldWords}, never your data.`
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(prompt) } }
  const edit = (text: string) => { setPrompt(text); setResult(null); box.current?.focus() }
  const dataset = (key: string | undefined) => catalog.data?.datasets.find((d) => d.key === key) ?? null
  const showExamples = !result && data.recent.length === 0

  return (
    <section aria-label="Ask for a Report" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="flex flex-wrap items-center gap-2">
        <AiPill />
        <h2 className="text-sm font-semibold text-ink-900">Ask for a Report</h2>
        {data.usage && <span className="ml-auto text-xs text-ink-800">{data.usage.words}</span>}
      </div>
      <div className="relative flex min-w-0 flex-col rounded-md border border-line-control bg-surface transition-colors duration-base ease-standard focus-within:border-focus focus-within:shadow-focus">
        <AskAbout scope={asking} unmapped={unmapped} data={askData} menu={menu} onScope={setScope} onUnmapped={setUnmapped} />
        {(documents.length > 0 || images.length > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1">
            {documents.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Documents">
                {documents.map((document) => (
                  <li key={`${document.file.name}-${document.file.size}`} className="relative flex h-16 w-[220px] items-center gap-2.5 rounded-md border border-line bg-surface px-2.5" title={document.file.name}>
                    <span aria-hidden className={`flex h-10 w-8 shrink-0 items-end justify-center rounded-xs pb-1 text-[9px] font-bold ${DOCUMENT_MARK[document.kind].tone}`}>{DOCUMENT_MARK[document.kind].text}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-xs font-semibold text-ink-900">{document.file.name}</span>
                      <span className="text-[11px] leading-[14px] text-ink-700">{KIND_LABEL[document.kind]} · {sizeWords(document.file.size)}</span>
                    </span>
                    <IconButton label={`Remove ${document.file.name}`} icon={X} size="xs" onClick={() => detachDocument(document)} className="absolute -top-2 -right-2 border border-line bg-surface" />
                  </li>
                ))}
              </ul>
            )}
            {images.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Images">
                {images.map((image) => (
                  <li key={image.url} className="relative flex w-16 flex-col gap-0.5" title={image.file.name}>
                    <img src={image.url} alt={image.file.name} className="h-16 w-16 rounded-md border border-line object-cover" />
                    <span className="truncate text-[11px] leading-[14px] text-ink-700">{image.file.name}</span>
                    <IconButton label={`Remove ${image.file.name}`} icon={X} size="xs" onClick={() => detach(image)} className="absolute -top-2 -right-2 border border-line bg-surface" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <label className="sr-only" htmlFor="ai-prompt">What do you want to see?</label>
        <textarea id="ai-prompt" ref={box} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKey} onPaste={onPaste} rows={4} maxLength={PROMPT_MAX}
          placeholder={'e.g. Revenue by channel and month for the last quarter, as a pivot.\nOr attach the report’s spec, a PDF or Word document, and say “build this”.'}
          className="cep-input-bare min-h-24 w-full resize-y border-none bg-transparent px-3 pt-2.5 pb-1 text-sm text-ink-900 outline-none" />
        {ask.isPending && (
          <div className="px-3 pb-1" role="status">
            {live.data?.steps.length
              ? <AskProgress steps={live.data.steps} elapsed={startedAt ? (now - startedAt) / 1000 : undefined} />
              : <p className="flex items-center gap-2 text-xs text-ink-800"><Spinner size="sm" /> Sending your prompt</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-2">
          <input ref={picker} type="file" accept={[...IMAGE_TYPES, ...DOCUMENT_ACCEPT].join(',')} multiple hidden aria-hidden tabIndex={-1}
            onChange={(event) => { void attach(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          <IconButton label="Add Images or Documents" title={full ? `${IMAGES_MAX} images and ${DOCUMENTS_MAX} documents is the most` : 'Add Images or Documents'} icon={Paperclip} size="md" onClick={() => picker.current?.click()} disabled={full} />
          <span className="text-xs text-ink-800">{attachedWords || `Drop, paste or attach up to ${IMAGES_MAX} images and ${DOCUMENTS_MAX} documents`}</span>
          <span className="ml-auto">{prompt.length >= COUNTER_FROM && <Counter used={prompt.length} max={PROMPT_MAX} />}</span>
          <ComponentSelect inline label="Add To" value={component} auto={null} onChange={setComponent} />
          <div className="relative">
            <button type="button" {...menu.triggerProps('model')} className="flex h-8 items-center gap-2 rounded-control-md px-2 text-sm text-ink-900 hover:bg-surface-hover">
              {model && <Mark model={model} />}
              <span className="text-left">{model?.label ?? 'Choose a model'}</span>
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" />
            </button>
            {menu.isOpen('model') && (
              <Popover label="Model" width={280} {...menu.panelProps('model')} className="p-1.5">
                {Array.from(new Map(models.map((m) => [m.provider, m.provider_name])).entries()).map(([provider, name]) => (
                  <div key={provider}>
                    <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-800 uppercase">{name}</p>
                    {models.filter((m) => m.provider === provider).map((m) => (
                      <MenuRow key={m.id} title={m.label} leading={<Mark model={m} />} trailing={<span className="text-xs text-ink-800">{m.note}</span>} selected={m.id === model?.id} divider={false} onClick={() => pick(m.id)} />
                    ))}
                  </div>
                ))}
              </Popover>
            )}
          </div>
          <button type="button" className={buttonPrimary} onClick={() => send(prompt)} disabled={!prompt.trim() || !model || ask.isPending}>
            {ask.isPending ? 'Generating…' : 'Generate Report'}
          </button>
        </div>
        {dragging && (
          <div aria-hidden className="pointer-events-none absolute -inset-px flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-brand-600 bg-brand-100 text-center">
            <Upload size={24} strokeWidth={1.5} className="text-brand-800" />
            <span className="text-base font-semibold text-brand-800">Drop images or documents here</span>
            <span className="text-xs text-ink-800">PNG, JPEG, GIF, WebP · PDF, Word, Excel, CSV, text, Markdown · up to {IMAGES_MAX} images and {DOCUMENTS_MAX} documents</span>
          </div>
        )}
      </div>
      {fileError && <p role="alert" className="text-sm text-danger-text">{fileError}</p>}
      <p className="text-xs text-ink-800">{sends}</p>
      {failure && <p role="alert" className="text-sm text-danger-text">{failure}</p>}

      {result && (
        <ResultCard result={result} dataset={dataset(result.dataset)} busy={ask.isPending || open.isPending}
          onRetry={() => send(result.prompt)} onEdit={() => edit(result.prompt)} onOpen={(name) => open.mutate({ id: result.id, name })}
          onAnswer={(text) => send(text, result.kind === 'question' ? result.id : undefined)} />
      )}

      {showExamples ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Try One of These</h3>
          <div className="flex flex-wrap gap-1.5">
            {(data.examples ?? []).map((example) => (
              <button key={example} type="button" onClick={() => edit(example)} className="h-7 rounded-control-md border border-line bg-surface px-2.5 text-xs text-ink-900 hover:bg-surface-hover">{example}</button>
            ))}
          </div>
          <p className="text-xs text-ink-800">The report opens in the editor as a draft. Check it before you save or share it.</p>
        </div>
      ) : data.recent.length > 0 && !result ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Recent Prompts</h3>
          <table className="w-full text-sm" aria-label="Recent prompts">
            <tbody>
              {data.recent.map((item) => (
                <tr key={item.id} className="border-t border-line-subtle">
                  <td className="py-1.5 pr-3">
                    <button type="button" onClick={() => edit(item.prompt)} className="line-clamp-3 text-left whitespace-pre-line text-ink-900 hover:underline">{item.prompt}</button>
                    <span className="block text-xs text-ink-800">{item.model} · {item.report_id && item.report_name ? <>saved as <Link to={`/insights/reports/${item.report_id}`} className="hover:underline">{item.report_name}</Link></> : item.outcome === 'DRAFT' ? 'not saved' : item.outcome === 'QUESTION' ? 'asked a question' : item.outcome === 'NO_FIELD' ? 'no field for it' : 'did not answer'}</span>
                  </td>
                  <td className="cep-num py-1.5 text-right text-xs whitespace-nowrap text-ink-800">{formatDateTime(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

const TITLE: Record<AskResult['kind'], string> = { draft: 'Draft Report', question: 'One Question First', no_field: 'No Field for This', failed: 'Nothing Came Back' }

function ResultCard({ result, dataset: known, busy, onRetry, onEdit, onOpen, onAnswer }: {
  result: AskResult; dataset: CatalogDataset | null; busy: boolean; onRetry: () => void; onEdit: () => void; onOpen: (name: string) => void; onAnswer: (prompt: string) => void
}) {
  const seconds = (result.duration_ms / 1000).toFixed(1)
  const [name, setName] = useState(result.name ?? '')
  const [showSteps, setShowSteps] = useState(result.kind === 'failed')
  const steps = result.steps ?? []
  const definition = result.definition
  const fresh = result.new_dataset
  const dataset = known ?? fresh?.dataset ?? null
  const components = useComponents()
  const filedUnder = result.component ? components.nameOf(result.component) : dataset ? `${components.nameOf(dataset.component.key) ?? dataset.component.name} (Automatic)` : null
  const read = result.read ? [...result.read.documents.map((d) => `${d.name} (${KIND_LABEL[d.kind]})`), ...(result.read.images ? [plural(result.read.images, 'image')] : [])] : []
  const across = result.view?.across
  const rows = definition && dataset ? definition.columns.filter((c) => !c.aggregate && c.field !== across).map((c) => columnWords(dataset, c)) : []
  const columns = definition && dataset && across ? definition.columns.filter((c) => c.field === across).map((c) => columnWords(dataset, c)) : []
  const values = definition && dataset ? definition.columns.filter((c) => c.aggregate).map((c) => columnWords(dataset, c)) : []
  const filters = definition && dataset ? (definition.filters?.rules ?? []).map((rule) => ('rules' in rule ? 'a group of rules' : ruleWords(dataset, rule))) : []
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-subtle p-4" role="region" aria-label={TITLE[result.kind]}>
      <div className="flex flex-wrap items-center gap-2">
        <AiPill />
        <h3 className="text-sm font-semibold text-ink-900">{TITLE[result.kind]}</h3>
        <span className="ml-auto text-xs text-ink-800">
          {result.model.label} · built in {seconds} s{read.length ? ` · read ${joined(read)}` : ''}
          {steps.length > 0 && <> · {plural(steps.length, 'step')} <button type="button" aria-expanded={showSteps} onClick={() => setShowSteps((open) => !open)} className="font-medium text-link hover:underline">{showSteps ? 'Hide' : 'Show'}</button></>}
        </span>
      </div>
      {showSteps && steps.length > 0 && <AskProgress steps={steps} label="Steps taken" />}
      <p className="text-sm text-ink-800">“{result.prompt}”</p>
      {result.kind === 'draft' && (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="pt-1.5 font-semibold text-ink-900"><label htmlFor={`ai-name-${result.id}`}>Name</label></dt>
            <dd><TextInput id={`ai-name-${result.id}`} controlSize="sm" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} className="!mt-0 w-full max-w-md" /></dd>
            <dt className="font-semibold text-ink-900">View</dt><dd><Tag tone="brand">{VIEW_LABEL[result.view?.type ?? 'grid']}</Tag></dd>
            <dt className="font-semibold text-ink-900">Data</dt>
            <dd className="flex flex-wrap items-center gap-2 text-ink-900">
              {fresh ? <>{fresh.database} · {[fresh.source, ...fresh.joins].join(' + ')} <Tag tone="warning">Not Mapped Yet</Tag></> : result.dataset_label}
            </dd>
            {components.ready && filedUnder && <><dt className="font-semibold text-ink-900">Component</dt><dd className="text-ink-900">{filedUnder}</dd></>}
            {rows.length > 0 && <><dt className="font-semibold text-ink-900">Rows</dt><dd className="text-ink-900">{rows.join(', then ')}</dd></>}
            {columns.length > 0 && <><dt className="font-semibold text-ink-900">Columns</dt><dd className="text-ink-900">{columns.join(', ')}</dd></>}
            {values.length > 0 && <><dt className="font-semibold text-ink-900">Values</dt><dd className="text-ink-900">{values.join(', ')}</dd></>}
            {filters.length > 0 && <><dt className="font-semibold text-ink-900">Filter</dt><dd className="text-ink-900">{filters.join(definition?.filters?.combinator === 'or' ? ' or ' : ' and ')}</dd></>}
            {result.note && <><dt className="font-semibold text-ink-900">Note</dt><dd className="text-ink-900">{result.note}</dd></>}
          </dl>
          {fresh && (
            <p className="text-xs text-ink-800">
              Open in Editor maps {fresh.source}{fresh.joins.length ? ` joined to ${joined(fresh.joins)}` : ''} as the dataset “{fresh.label}” ({plural(fresh.fields, 'field')}) in {fresh.database}, then opens the report. Nothing is mapped until then.
            </p>
          )}
          {result.preview && <p className="text-xs text-ink-800">Preview: {result.preview.rows}{result.preview.more ? ' or more' : ''} row{result.preview.rows === 1 ? '' : 's'}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonSecondary} onClick={onRetry} disabled={busy}>Try Again</button>
            <button type="button" className={buttonSecondary} onClick={onEdit} disabled={busy}>Edit Prompt</button>
            <button type="button" className={buttonPrimary} onClick={() => onOpen(name.trim())} disabled={busy || !name.trim()}>Open in Editor</button>
          </div>
        </>
      )}
      {result.kind === 'question' && (
        <>
          <p className="text-sm text-ink-900">{result.question}</p>
          <div className="flex flex-wrap gap-2">
            {(result.answers ?? []).map((answer) => <button key={answer.prompt} type="button" className={buttonSecondary} onClick={() => onAnswer(answer.prompt)} disabled={busy}>{answer.label}</button>)}
          </div>
          <p className="text-xs text-ink-800">Answering does not use another prompt.</p>
        </>
      )}
      {result.kind === 'no_field' && (
        <>
          <p className="text-sm text-ink-900">{result.message}</p>
          {(result.suggestions ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(result.suggestions ?? []).map((item) => <button key={item.prompt} type="button" className={buttonSecondary} onClick={() => onAnswer(item.prompt)} disabled={busy}>{item.label}</button>)}
            </div>
          )}
          <p className="text-xs text-ink-800">To report on that, ask your platform team to map the data.</p>
        </>
      )}
      {result.kind === 'failed' && (
        <>
          <p className="text-sm text-ink-900">{result.message ?? 'The model did not answer.'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonSecondary} onClick={onRetry} disabled={busy}>Try Again</button>
            <button type="button" className={buttonSecondary} onClick={onEdit} disabled={busy}>Edit Prompt</button>
          </div>
        </>
      )}
    </div>
  )
}
