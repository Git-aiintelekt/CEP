/**
 * The report editor, a workspace of its own (docs/mockups/report-editor-workspace.html): the shell steps aside and the
 * editor bar carries the way back, the name and its saved state, Change With AI, ⋯, Close (Discard Changes once something
 * changed) and Save. Leaving with unsaved changes asks first. Under the bar, three panes: the Data pane, the grey canvas
 * with the result, and the builder (Show, Split By, Only Include, Order). The status line is pinned under the canvas: the
 * preview follows the definition (under the preview cap) unless Update Automatically is off, when Run Preview runs it.
 * Save writes a new version.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Code2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'
import { insightsApi, keys, useCatalog, useReport } from '../api'
import { ReportResult, ViewBar } from '../components/ReportViews'
import { ResultCard } from '../components/ResultCard'
import { useLeaveGuard } from '@/apps/cep/features/designer/useLeaveGuard'
import { ActionsMenu } from '../components/ActionsMenu'
import { ChangeWithAi } from '../editor/ChangeWithAi'
import { DataPane } from '../editor/DataPane'
import { EditorSettings } from '../editor/EditorSettings'
import { PreviewStatus, useAutoPreview } from '../editor/PreviewStatus'
import { useComponents } from '../reportComponents'
import { CustomFieldsDialog } from '../editor/CustomFieldsDialog'
import { LinkedMeasuresDialog } from '../editor/LinkedMeasuresDialog'
import { SqlDialog } from '../components/SqlDialog'
import { TooltipReportDialog } from '../editor/TooltipReportDialog'
import { DetailReportDialog } from '../editor/DetailReportDialog'
import { FormatDialog } from '../editor/FormatDialog'
import { ParametersDialog } from '../editor/ParametersDialog'
import { ParameterBar } from '../components/ParameterBar'
import { runWords } from '../components/resultWords'
import { dimensions, EMPTY, fieldOf, isComplete, setBlend, setView, viewOf, withCustom } from '../editor/definition'
import { Builder } from '../editor/Builder'
import type { ParameterValues, ReportDefinition, RunResult } from '../types'

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
  const [fold, setFold] = useState<{ open: boolean; count: number } | undefined>(undefined)
  const foldAll = (open: boolean) => setFold((was) => ({ open, count: (was?.count ?? 0) + 1 }))
  const [detail, setDetail] = useState(false)
  const [customs, setCustoms] = useState(false)
  const [linking, setLinking] = useState(false)
  const [showSql, setShowSql] = useState(false)
  const [tooltipping, setTooltipping] = useState(false)
  const [asking, setAsking] = useState(false)
  const [answers, setAnswers] = useState<ParameterValues>({})
  const [side, setSide] = useState<'build' | 'settings'>('build')
  // the Data pane folds in a narrow window, unless the person opened or folded it themselves
  const wide = useMinWidth(BREAKPOINT.xl)
  const [dataFolded, setDataFolded] = useState<boolean | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [component, setComponent] = useState<string | null | undefined>(undefined)          // undefined: unchanged
  const [draft, setDraft] = useState<ReportDefinition | null>(null)
  const definition = draft ?? report.data?.definition ?? EMPTY
  const base = useMemo(() => catalog.data?.datasets.find((d) => d.key === report.data?.dataset) ?? null, [catalog.data, report.data])
  const dataset = useMemo(() => (base ? withCustom(base, definition) : null), [base, definition])
  const title = name ?? report.data?.name ?? ''
  const dirty = draft !== null || (name !== null && name !== report.data?.name) || (component !== undefined && component !== (report.data?.component_key ?? null))
  const complete = dataset ? isComplete(dataset, definition) : false
  const settled = useDebounced(definition, 500)
  const [auto, setAutoState] = useAutoPreview()
  // with Update Automatically off, the preview shows the definition last run, not the one being edited
  const [pinned, setPinned] = useState<ReportDefinition | null>(null)
  const queried = auto ? settled : pinned ?? report.data?.definition ?? EMPTY
  const setAuto = (on: boolean) => { setPinned(on ? null : settled); setAutoState(on) }
  const reportPath = `/insights/reports/${id}`
  const { requestLeave, dialog: leaveDialog } = useLeaveGuard(dirty, () => navigate(reportPath), `Your changes to ${title || 'this report'} will be lost.`)
  const { nameOf } = useComponents()
  const filedUnder = nameOf(component === undefined ? report.data?.component_key ?? report.data?.component_auto ?? null : component ?? report.data?.component_auto ?? null)

  const preview = useQuery({
    queryKey: ['insights', 'preview', report.data?.dataset, queried, answers],
    queryFn: () => insightsApi.preview({ dataset: report.data?.dataset as string, definition: queried, ...(queried.parameters?.length ? { params: answers } : {}) }),
    enabled: Boolean(dataset) && isComplete(dataset as never, queried) && queried.columns.length > 0,
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
    mutationFn: () => insightsApi.update(id as string, { row_version: report.data?.row_version as number, name: title.trim() || report.data?.name, definition: draft ?? undefined,
      ...(component !== undefined ? { component } : {}) }),
    onSuccess: (saved) => {
      client.setQueryData(keys.report(id as string), { ...saved, can_edit: true })
      client.invalidateQueries({ queryKey: ['insights', 'reports'] })
      client.invalidateQueries({ queryKey: keys.run(id as string, {}) })
      setDraft(null)
      setName(null)
      setComponent(undefined)
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
  const empty = definition.columns.length === 0
  const stale = !auto && queried !== definition
  const words = empty ? 'Nothing to preview yet'
    : !complete ? 'Finish the filters to run'
    : refused ? 'The preview did not run'
    : preview.isFetching ? 'Running…'
    : stale ? 'Not updated since your last change'
    : preview.data ? `Preview · ${runWords(preview.data)}` : ''
  const canvas = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {(queried.parameters?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-800">Viewer Filters</span>
          <ParameterBar key={JSON.stringify(queried.parameters)} dataset={report.data.dataset} fields={dataset.fields} parameters={queried.parameters ?? []} values={answers} onRun={setAnswers} running={preview.isFetching} />
        </div>
      )}
      {empty ? (
        <section aria-label="Nothing to preview yet" className="flex flex-col items-start gap-1 rounded-lg border border-line bg-surface p-5">
          <p className="cep-num font-display text-kpi font-semibold text-ink-900">{count.data ? Number(count.data.rows[0]?.[0] ?? 0).toLocaleString() : '…'}</p>
          <p className="text-sm text-ink-800">{dataset.label}, all time. Add a number under Show, or a field under Split By, such as channel or month, to start.</p>
        </section>
      ) : refused ? (
        <ErrorState title={refused.problem?.title ?? 'The preview did not run'} detail={refused.problem?.detail} shownFields={Object.keys(refused.problem?.errors ?? {})} onRetry={() => preview.refetch()} />
      ) : preview.data ? (
        <ResultCard result={preview.data as RunResult} view={viewOf(definition)} bar={(
          <ViewBar view={viewOf(definition)} onChange={(view) => setDraft(setView(definition, view))} columns={preview.data.columns} onFormat={() => setFormatting(true)} onFold={foldAll}
            dimensions={dimensions(definition).map((column) => ({ key: column.field, label: fieldOf(dataset, column.field)?.label ?? column.field }))} />
        )}>
          <ReportResult result={preview.data as RunResult} view={viewOf(definition)} label="Preview rows" minHeight={280} inCard fold={fold} analysis={{ dataset: report.data.dataset, definition: queried, ...(queried.parameters?.length ? { params: answers } : {}) }} />
        </ResultCard>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-line bg-surface"><Spinner label="Running the preview" /></div>
      )}
    </div>
  )
  const dialogs = (
    <>
      {tooltipping && axis && <TooltipReportDialog dataset={report.data.dataset} field={axis.field} fieldLabel={fieldOf(dataset, axis.field)?.label ?? axis.field} reportId={id} current={viewOf(definition).tooltip}
        onClose={() => setTooltipping(false)} onApply={(tooltip) => { const { tooltip: _old, ...rest } = viewOf(definition); setDraft(setView(definition, tooltip ? { ...rest, tooltip } : rest)); setTooltipping(false) }} />}
      {showSql && <SqlDialog dataset={report.data.dataset} definition={definition} name={title} onClose={() => setShowSql(false)} />}
      {linking && base && <LinkedMeasuresDialog dataset={base} definition={definition} onClose={() => setLinking(false)} onApply={(blend) => { setDraft(setBlend(definition, blend)); setLinking(false) }} />}
      {customs && base && <CustomFieldsDialog dataset={base} definition={definition} onChange={setDraft} onClose={() => setCustoms(false)} />}
      {detail && <DetailReportDialog dataset={dataset} fields={definition.drillthrough ?? []} onClose={() => setDetail(false)}
        onApply={(fields) => { const { drillthrough: _old, ...rest } = definition; setDraft(fields.length ? { ...rest, drillthrough: fields } : rest); setDetail(false) }} />}
      {asking && <ParametersDialog dataset={dataset} parameters={definition.parameters ?? []} onClose={() => setAsking(false)}
        onApply={(parameters) => { const { parameters: _old, ...rest } = definition; setDraft(parameters.length ? { ...rest, parameters } : rest); setAnswers({}); setAsking(false) }} />}
      {formatting && <FormatDialog dataset={dataset} definition={definition} formats={viewOf(definition).formats ?? []} onClose={() => setFormatting(false)}
        onApply={(formats) => { const { formats: _old, ...rest } = viewOf(definition); setDraft(setView(definition, formats.length ? { ...rest, formats } : rest)); setFormatting(false) }} />}
    </>
  )
  const showable = complete && !empty

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header aria-label="Editor" className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface pr-4 pl-3">
        <IconButton label="Back to Report" icon={ChevronLeft} size="md" onClick={() => requestLeave(() => navigate(reportPath))} />
        <span aria-hidden className="h-6 w-px shrink-0 bg-line-subtle" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-xs text-ink-800">Reports{filedUnder ? ` · ${filedUnder}` : ''}</p>
          <div className="flex min-w-0 items-center gap-3">
            <input aria-label="Report name" value={title} onChange={(event) => setName(event.target.value)} maxLength={200}
              className="-ml-1.5 field-sizing-content min-w-[8ch] max-w-full truncate rounded-sm border border-transparent bg-transparent px-1.5 font-display text-section-title font-semibold text-ink-900 hover:border-line focus:border-focus focus:outline-none" />
            <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 text-helper whitespace-nowrap ${dirty ? 'font-medium text-warning-text' : 'text-ink-800'}`}>
              <span aria-hidden className={`h-2 w-2 rounded-full ${dirty ? 'bg-warning' : 'bg-ink-300'}`} />
              {dirty ? 'Unsaved Changes' : `Saved ${formatDateTime(report.data.updated_at)} · Version ${report.data.version}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChangeWithAi dataset={report.data.dataset} definition={definition} onChange={setDraft} />
          <ActionsMenu>
            {(act) => (
              <>
                <MenuRow role="menuitem" divider={false} leading={<Code2 size={16} strokeWidth={1.5} aria-hidden />} title="Show the SQL" disabled={!showable}
                  onClick={() => { if (showable) act(() => setShowSql(true)) }} />
              </>
            )}
          </ActionsMenu>
          <span aria-hidden className="h-6 w-px bg-line-subtle" />
          {dirty
            ? <button type="button" className={buttonSecondary} onClick={() => navigate(reportPath)}>Discard Changes</button>
            : <button type="button" className={buttonSecondary} onClick={() => requestLeave(() => navigate(reportPath))}>Close</button>}
          <button type="button" className={buttonPrimary} onClick={() => save.mutate()} disabled={!dirty || !complete || save.isPending || definition.columns.length === 0}>Save</button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {base && <DataPane dataset={dataset} base={base} definition={definition} onChange={setDraft} onCustom={() => setCustoms(true)} onLink={(base.links?.length ?? 0) > 0 ? () => setLinking(true) : undefined}
          folded={dataFolded ?? !wide} onFold={setDataFolded} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto bg-canvas px-6 py-5">
            {canvas}
          </div>
          <PreviewStatus words={words} live={Boolean(preview.data) && !preview.isFetching && !stale && !refused && !empty && complete} auto={auto} onAuto={setAuto}
            onRun={!auto && showable && stale ? () => setPinned(definition) : undefined} onSql={showable ? () => setShowSql(true) : undefined} />
        </div>
        <aside aria-label="Build" className="flex min-h-0 w-86 shrink-0 flex-col border-l border-line bg-surface">
          <div role="tablist" aria-label="Build or settings" className="flex h-11 shrink-0 gap-5 border-b border-line-subtle px-4">
            {(['build', 'settings'] as const).map((tab) => (
              <button key={tab} type="button" role="tab" id={`editor-tab-${tab}`} aria-selected={side === tab} aria-controls={`editor-panel-${tab}`} onClick={() => setSide(tab)}
                className={`-mb-px border-b-2 text-button ${side === tab ? 'border-brand-600 font-semibold text-ink-900' : 'border-transparent font-medium text-ink-800 hover:text-ink-900'}`}>
                {tab === 'build' ? 'Build' : 'Settings'}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`editor-panel-${side}`} aria-labelledby={`editor-tab-${side}`} className="min-h-0 flex-1 overflow-y-auto">
            {side === 'build'
              ? <Builder dataset={dataset} definition={definition} onChange={setDraft} />
              : <EditorSettings viewerFilters={definition.parameters?.length ?? 0} detailFields={definition.drillthrough?.length ?? 0}
                  tooltip={viewOf(definition).type === 'chart' && axis ? Boolean(viewOf(definition).tooltip) : undefined}
                  component={component === undefined ? report.data.component_key ?? null : component} autoComponent={report.data.component_auto ?? null}
                  onViewerFilters={() => setAsking(true)} onDetail={() => setDetail(true)} onTooltip={() => setTooltipping(true)} onComponent={setComponent} />}
          </div>
        </aside>
      </div>
      {dialogs}
      {leaveDialog}
    </div>
  )
}
