/**
 * The report editor: one definition, two ways to build it. Field Wells (drag or click fields into Rows, Values and
 * Filters, like a spreadsheet pivot) or Steps (Data, Filter, Summarize, Group By, Sort and Limit, read top to bottom).
 * The switch is in the header and remembered per browser. The result runs live as the definition changes, under the
 * preview cap; Save writes a new version. The four views come in turn: the grid first.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Code2, Columns3, ListOrdered } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { insightsApi, keys, useCatalog, useReport } from '../api'
import { ReportResult, ViewBar } from '../components/ReportViews'
import { ChangeWithPrompt } from '../editor/ChangeWithPrompt'
import { CustomFieldsDialog } from '../editor/CustomFieldsDialog'
import { LinkedMeasuresDialog } from '../editor/LinkedMeasuresDialog'
import { SqlDialog } from '../components/SqlDialog'
import { TooltipReportDialog } from '../editor/TooltipReportDialog'
import { DetailReportDialog } from '../editor/DetailReportDialog'
import { FormatDialog } from '../editor/FormatDialog'
import { runWords } from '../components/resultWords'
import { dimensions, EMPTY, fieldOf, isComplete, setBlend, setView, viewOf, withCustom } from '../editor/definition'
import { FieldWells } from '../editor/FieldWells'
import { Steps } from '../editor/Steps'
import type { ReportDefinition, RunResult } from '../types'

type Layout = 'wells' | 'steps'
const LAYOUT_KEY = 'insights.editor'
const LAYOUTS: SegmentOption<Layout>[] = [{ value: 'wells', label: 'Field Wells', icon: Columns3 }, { value: 'steps', label: 'Steps', icon: ListOrdered }]

function readLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'steps' ? 'steps' : 'wells'
  } catch {
    return 'wells'
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function ReportEditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const report = useReport(id)
  const catalog = useCatalog()
  const [formatting, setFormatting] = useState(false)
  const [detail, setDetail] = useState(false)
  const [customs, setCustoms] = useState(false)
  const [linking, setLinking] = useState(false)
  const [showSql, setShowSql] = useState(false)
  const [tooltipping, setTooltipping] = useState(false)
  const [layout, setLayoutState] = useState<Layout>(readLayout)
  const setLayout = (next: Layout) => { setLayoutState(next); try { window.localStorage.setItem(LAYOUT_KEY, next) } catch { /* no memory of the choice */ } }
  const [name, setName] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReportDefinition | null>(null)
  const definition = draft ?? report.data?.definition ?? EMPTY
  const base = useMemo(() => catalog.data?.datasets.find((d) => d.key === report.data?.dataset) ?? null, [catalog.data, report.data])
  const dataset = useMemo(() => (base ? withCustom(base, definition) : null), [base, definition])
  const title = name ?? report.data?.name ?? ''
  const dirty = draft !== null || (name !== null && name !== report.data?.name)
  const complete = dataset ? isComplete(dataset, definition) : false
  const settled = useDebounced(definition, 500)

  const preview = useQuery({
    queryKey: ['insights', 'preview', report.data?.dataset, settled],
    queryFn: () => insightsApi.preview({ dataset: report.data?.dataset as string, definition: settled }),
    enabled: Boolean(dataset) && isComplete(dataset as never, settled) && settled.columns.length > 0,
    retry: false,
    placeholderData: (previous) => previous,
  })
  const count = useQuery({
    queryKey: ['insights', 'count', report.data?.dataset],
    queryFn: () => insightsApi.preview({ dataset: report.data?.dataset as string, definition: { columns: [{ field: dataset?.fields.find((f) => f.role === 'measure')?.key as string, aggregate: 'count' }], filters: { combinator: 'and', rules: [] } } }),
    enabled: Boolean(dataset?.fields.some((f) => f.role === 'measure' && f.aggregates.includes('count'))) && definition.columns.length === 0,
    retry: false,
  })

  const save = useMutation({
    mutationFn: () => insightsApi.update(id as string, { row_version: report.data?.row_version as number, name: title.trim() || report.data?.name, definition: draft ?? undefined }),
    onSuccess: (saved) => {
      client.setQueryData(keys.report(id as string), { ...saved, can_edit: true })
      client.invalidateQueries({ queryKey: ['insights', 'reports'] })
      client.invalidateQueries({ queryKey: keys.run(id as string, {}) })
      setDraft(null)
      setName(null)
      toast.success('Saved', `${saved.name} is version ${saved.version}.`)
    },
    onError: (error) => toast.failure(error, 'The report was not saved'),
  })

  if (report.isPending || catalog.isPending) return <Spinner label="Loading the editor" />
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />
  if (!dataset) return <ErrorState title="This report's dataset is not available" detail="The dataset was removed from the catalogue, or this workspace's engine has no source for it." />
  if (!report.data.can_edit) return <ErrorState title="You cannot change this report" detail="Only its owner, or a report administrator, can. You can still open and run it." />

  const refused = preview.error instanceof ApiError ? preview.error : null
  const axis = dimensions(definition)[0]
  const result = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-800">
        <ViewBar view={viewOf(definition)} onChange={(view) => setDraft(setView(definition, view))} columns={preview.data?.columns} onFormat={() => setFormatting(true)}
          dimensions={dimensions(definition).map((column) => ({ key: column.field, label: fieldOf(dataset, column.field)?.label ?? column.field }))} />
        <span className="flex items-center gap-3">
          {preview.data ? runWords(preview.data) : preview.isFetching ? 'Running…' : complete ? '' : 'Finish the filters to run'}
          {complete && definition.columns.length > 0 && <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-800 hover:underline" onClick={() => setShowSql(true)}><Code2 size={14} strokeWidth={1.5} aria-hidden />Show the SQL</button>}
        </span>
      </div>
      <ChangeWithPrompt dataset={report.data.dataset} definition={definition} onChange={setDraft} />
      {refused ? (
        <ErrorState title={refused.problem?.title ?? 'The preview did not run'} detail={refused.problem?.detail} shownFields={Object.keys(refused.problem?.errors ?? {})} onRetry={() => preview.refetch()} />
      ) : preview.data ? (
        <ReportResult result={preview.data as RunResult} view={viewOf(definition)} label="Preview rows" minHeight={280} analysis={{ dataset: report.data.dataset, definition: settled }} />
      ) : (
        <div className="flex min-h-[200px] items-center justify-center rounded-md border border-line"><Spinner label="Running the preview" /></div>
      )}
      {tooltipping && axis && <TooltipReportDialog dataset={report.data.dataset} field={axis.field} fieldLabel={fieldOf(dataset, axis.field)?.label ?? axis.field} reportId={id} current={viewOf(definition).tooltip}
        onClose={() => setTooltipping(false)} onApply={(tooltip) => { const { tooltip: _old, ...rest } = viewOf(definition); setDraft(setView(definition, tooltip ? { ...rest, tooltip } : rest)); setTooltipping(false) }} />}
      {showSql && <SqlDialog dataset={report.data.dataset} definition={definition} name={title} onClose={() => setShowSql(false)} />}
      {linking && base && <LinkedMeasuresDialog dataset={base} definition={definition} onClose={() => setLinking(false)} onApply={(blend) => { setDraft(setBlend(definition, blend)); setLinking(false) }} />}
      {customs && base && <CustomFieldsDialog dataset={base} definition={definition} onChange={setDraft} onClose={() => setCustoms(false)} />}
      {detail && <DetailReportDialog dataset={dataset} fields={definition.drillthrough ?? []} onClose={() => setDetail(false)}
        onApply={(fields) => { const { drillthrough: _old, ...rest } = definition; setDraft(fields.length ? { ...rest, drillthrough: fields } : rest); setDetail(false) }} />}
      {formatting && <FormatDialog dataset={dataset} definition={definition} formats={viewOf(definition).formats ?? []} onClose={() => setFormatting(false)}
        onApply={(formats) => { const { formats: _old, ...rest } = viewOf(definition); setDraft(setView(definition, formats.length ? { ...rest, formats } : rest)); setFormatting(false) }} />}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle pb-3">
        <Link to={`/insights/reports/${id}`} className="inline-flex items-center gap-1 text-sm text-brand-800 hover:underline"><ArrowLeft size={14} strokeWidth={1.5} aria-hidden />Report</Link>
        <input aria-label="Report name" value={title} onChange={(event) => setName(event.target.value)} maxLength={200}
          className="min-w-0 flex-1 rounded-control-md border border-transparent bg-transparent px-2 font-display text-page-title font-semibold text-ink-900 hover:border-line focus:border-focus focus:outline-none" />
        <span className="text-xs text-ink-800">{dirty ? 'Not saved yet' : `Saved ${formatDateTime(report.data.updated_at)} · version ${report.data.version}`}</span>
        <SegmentedControl label="Editor" options={LAYOUTS} value={layout} onChange={setLayout} />
        <button type="button" className={buttonSecondary} onClick={() => setCustoms(true)}>Custom Fields{definition.derived?.length ? ` · ${definition.derived.length}` : ''}</button>
        {(base?.links?.length ?? 0) > 0 && <button type="button" className={buttonSecondary} onClick={() => setLinking(true)}>Linked Measures{definition.blend?.columns.length ? ` · ${definition.blend.columns.length}` : ''}</button>}
        {viewOf(definition).type === 'chart' && axis && <button type="button" className={buttonSecondary} onClick={() => setTooltipping(true)}>Tooltip Report{viewOf(definition).tooltip ? ' · 1' : ''}</button>}
        <button type="button" className={buttonSecondary} onClick={() => setDetail(true)}>Detail Report{definition.drillthrough?.length ? ` · ${definition.drillthrough.length}` : ''}</button>
        <button type="button" className={buttonSecondary} onClick={() => navigate(`/insights/reports/${id}`)}>Cancel</button>
        <button type="button" className={buttonPrimary} onClick={() => save.mutate()} disabled={!dirty || !complete || save.isPending || definition.columns.length === 0}>Save</button>
      </div>
      {layout === 'wells'
        ? <FieldWells dataset={dataset} definition={definition} onChange={setDraft} result={result} />
        : <Steps dataset={dataset} definition={definition} onChange={setDraft} result={result} rowCount={count.data ? Number(count.data.rows[0]?.[0] ?? 0) : undefined} />}
    </div>
  )
}
