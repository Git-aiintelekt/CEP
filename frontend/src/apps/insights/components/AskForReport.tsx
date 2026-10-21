/**
 * AI · Ask for a Report (docs/mockups/report-builder.html): a prompt box above the report list. The person writes what they
 * want, picks a model (Claude or OpenAI, whichever the platform has switched on and the workspace allows; the last choice is
 * remembered per browser) and presses Generate. What comes back is a draft (in words, with a preview count; Open in Editor
 * makes it a private report and opens it), one question with its answers as buttons, or "no field for this" with the
 * closest prompts. The model sees the prompt and the field names, never customer rows. Only a draft counts against the month.
 * The prompt may run to 4,000 characters over several lines, and up to three images may go with it (Add Images, or paste or drop
 * them on the box): a sketch of the report, a screenshot of a chart or a table. They go to the model and are not kept.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary, Counter, TextArea } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'
import { Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useSingleDropdown } from '@/lib/useSingleDropdown'
import { assistantApi, keys, useAssistant, useCatalog } from '../api'
import { IMAGE_BYTES_MAX, IMAGE_TYPES, IMAGES_MAX, isImage, shrink } from '../askImages'
import { columnWords, ruleWords } from '../editor/definition'
import type { AskResult, AssistantModel, CatalogDataset, ReportSummary } from '../types'

const MODEL_KEY = 'insights.ai.model'
const PROMPT_MAX = 4000
type Attached = { file: File; url: string }
const VIEW_LABEL: Record<ReportSummary['view_type'], string> = { grid: 'Grid', chart: 'Chart', pivot: 'Pivot', hierarchy: 'Hierarchy', influencers: 'Key Influencers', decomposition: 'Decomposition Tree' }

function readModel(): string | null {
  try {
    return window.localStorage.getItem(MODEL_KEY)
  } catch {
    return null
  }
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
  const [imageError, setImageError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const shown = useRef<Attached[]>([])                                                     // the previews to let go of when the box goes
  useEffect(() => { shown.current = images }, [images])
  useEffect(() => () => shown.current.forEach((image) => URL.revokeObjectURL(image.url)), [])
  const [modelId, setModelId] = useState<string | null>(readModel)
  const [result, setResult] = useState<AskResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const menu = useSingleDropdown<'model'>()
  const ask = useMutation({
    mutationFn: ({ body, files }: { body: { prompt: string; model: string; answer_to?: string }; files: File[] }) => assistantApi.ask(body, files),
    onMutate: () => setFailure(null),
    onSuccess: (reply) => { setResult(reply); void client.invalidateQueries({ queryKey: keys.assistant }) },
    onError: (error) => setFailure(error instanceof ApiError ? error.message : 'The request did not go through.'),
  })
  const open = useMutation({
    mutationFn: (id: string) => assistantApi.open(id),
    onSuccess: (report) => { void client.invalidateQueries({ queryKey: ['insights', 'reports'] }); navigate(`/insights/reports/${report.id}/edit`) },
    onError: (error) => setFailure(error instanceof ApiError ? error.message : 'The report was not created.'),
  })

  if (!state.data?.enabled) return null
  const data = state.data
  const models = data.models
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === data.default_model) ?? models[0]
  const pick = (id: string) => { setModelId(id); try { window.localStorage.setItem(MODEL_KEY, id) } catch { /* no memory of the choice */ } menu.close({ restoreFocus: true }) }
  const send = (text: string, answerTo?: string) => {
    if (text.trim() && model) ask.mutate({ body: { prompt: text.trim(), model: model.id, ...(answerTo ? { answer_to: answerTo } : {}) }, files: images.map((image) => image.file) })
  }
  const attach = async (files: File[]) => {
    setImageError(null)
    const room = IMAGES_MAX - images.length
    const wrong = files.find((file) => !isImage(file))
    if (wrong) setImageError(`${wrong.name || 'That file'} is not a PNG, JPEG, GIF or WebP image.`)
    const taken = files.filter(isImage)
    if (taken.length > room) setImageError(`Add up to ${IMAGES_MAX} images.`)
    const ready = await Promise.all(taken.slice(0, Math.max(0, room)).map(shrink))
    const big = ready.find((file) => file.size > IMAGE_BYTES_MAX)
    if (big) setImageError(`${big.name} is ${(big.size / 1_000_000).toFixed(1)} MB; an image may be up to ${(IMAGE_BYTES_MAX / 1_000_000).toFixed(1)} MB.`)
    const fits = ready.filter((file) => file.size <= IMAGE_BYTES_MAX).map((file) => ({ file, url: URL.createObjectURL(file) }))
    if (fits.length) setImages((now) => [...now, ...fits].slice(0, IMAGES_MAX))
  }
  const detach = (image: Attached) => { URL.revokeObjectURL(image.url); setImages((now) => now.filter((other) => other !== image)); setImageError(null) }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); void attach(files) }
  }
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    setDragging(false)
    void attach(Array.from(event.dataTransfer.files))
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(prompt) } }
  const edit = (text: string) => { setPrompt(text); setResult(null); box.current?.focus() }
  const dataset = (key: string | undefined) => catalog.data?.datasets.find((d) => d.key === key) ?? null
  const showExamples = !result && data.recent.length === 0

  return (
    <section aria-label="Ask for a Report" className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 ${dragging ? 'border-focus' : 'border-line'}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <div className="flex flex-wrap items-center gap-2">
        <AiPill />
        <h2 className="text-sm font-semibold text-ink-900">Ask for a Report</h2>
        {data.usage && <span className="ml-auto text-xs text-ink-800">{data.usage.words}</span>}
      </div>
      <label className="sr-only" htmlFor="ai-prompt">What do you want to see?</label>
      <TextArea id="ai-prompt" ref={box} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKey} onPaste={onPaste} rows={5} maxLength={PROMPT_MAX}
        placeholder={'e.g. Revenue by channel and month for the last quarter, as a pivot.\nAdd the details on more lines: the filters, the order, what to compare.'} className="!mt-0 min-h-32 resize-y" />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={picker} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden aria-hidden tabIndex={-1}
          onChange={(event) => { void attach(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <button type="button" className={`${buttonSecondary} h-8 px-2.5 text-sm`} onClick={() => picker.current?.click()} disabled={images.length >= IMAGES_MAX}>
          <ImagePlus size={16} strokeWidth={1.5} aria-hidden />Add Images
        </button>
        <span className="text-xs text-ink-800">{images.length ? `${images.length} of ${IMAGES_MAX}` : `Up to ${IMAGES_MAX}: a sketch, or a screenshot of a chart or a table. Paste or drop them here too.`}</span>
        <span className="ml-auto"><Counter used={prompt.length} max={PROMPT_MAX} /></span>
      </div>
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Images">
          {images.map((image) => (
            <li key={image.url} className="relative">
              <img src={image.url} alt={image.file.name} className="h-16 w-16 rounded-md border border-line object-cover" />
              <IconButton label={`Remove ${image.file.name}`} icon={X} size="sm" onClick={() => detach(image)} className="absolute -top-2 -right-2 border border-line bg-surface" />
            </li>
          ))}
        </ul>
      )}
      {imageError && <p role="alert" className="text-sm text-danger-text">{imageError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button type="button" {...menu.triggerProps('model')} className="flex h-8 min-w-56 items-center gap-2 rounded-control-md border border-line-control bg-surface px-2.5 text-sm text-ink-900 hover:bg-surface-hover">
            {model && <Mark model={model} />}
            <span className="flex-1 text-left">{model?.label ?? 'Choose a model'}</span>
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
        <span className="text-xs text-ink-800">{images.length ? 'Sends your prompt, the images and the field names, never your data. The images are not kept.' : 'Sends your prompt and the field names, never your data.'}</span>
        <button type="button" className={`${buttonPrimary} ml-auto`} onClick={() => send(prompt)} disabled={!prompt.trim() || !model || ask.isPending}>
          {ask.isPending ? <><Spinner size="sm" /> Thinking</> : 'Generate Report'}
        </button>
      </div>
      {failure && <p role="alert" className="text-sm text-danger-text">{failure}</p>}

      {result && (
        <ResultCard result={result} dataset={dataset(result.dataset)} busy={ask.isPending || open.isPending}
          onRetry={() => send(result.prompt)} onEdit={() => edit(result.prompt)} onOpen={() => open.mutate(result.id)}
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

function ResultCard({ result, dataset, busy, onRetry, onEdit, onOpen, onAnswer }: {
  result: AskResult; dataset: CatalogDataset | null; busy: boolean; onRetry: () => void; onEdit: () => void; onOpen: () => void; onAnswer: (prompt: string) => void
}) {
  const seconds = (result.duration_ms / 1000).toFixed(1)
  const definition = result.definition
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
        <span className="ml-auto text-xs text-ink-800">{result.model.label} · {seconds} s</span>
      </div>
      <p className="text-sm text-ink-800">“{result.prompt}”</p>
      {result.kind === 'draft' && (
        <>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-semibold text-ink-900">Name</dt><dd className="text-ink-900">{result.name}</dd>
            <dt className="font-semibold text-ink-900">View</dt><dd><Tag tone="brand">{VIEW_LABEL[result.view?.type ?? 'grid']}</Tag></dd>
            <dt className="font-semibold text-ink-900">Data</dt><dd className="text-ink-900">{result.dataset_label}</dd>
            {rows.length > 0 && <><dt className="font-semibold text-ink-900">Rows</dt><dd className="text-ink-900">{rows.join(', then ')}</dd></>}
            {columns.length > 0 && <><dt className="font-semibold text-ink-900">Columns</dt><dd className="text-ink-900">{columns.join(', ')}</dd></>}
            {values.length > 0 && <><dt className="font-semibold text-ink-900">Values</dt><dd className="text-ink-900">{values.join(', ')}</dd></>}
            {filters.length > 0 && <><dt className="font-semibold text-ink-900">Filter</dt><dd className="text-ink-900">{filters.join(definition?.filters?.combinator === 'or' ? ' or ' : ' and ')}</dd></>}
          </dl>
          {result.preview && <p className="text-xs text-ink-800">Preview: {result.preview.rows}{result.preview.more ? ' or more' : ''} row{result.preview.rows === 1 ? '' : 's'}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonSecondary} onClick={onRetry} disabled={busy}>Try Again</button>
            <button type="button" className={buttonSecondary} onClick={onEdit} disabled={busy}>Edit Prompt</button>
            <button type="button" className={buttonPrimary} onClick={onOpen} disabled={busy}>Open in Editor</button>
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
