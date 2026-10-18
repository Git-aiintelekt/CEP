/**
 * /dev/insights: the two editors on sample data, with no backend: ?layout=wells | steps, ?state=busy | sparse, &masked=1 for a
 * reader without the right to personal data, &view=chart | hierarchy | pivot (&across=channel | submitted_at) for the other views,
 * &compare=1 for Sent Count compared with the month before and with last year, &format=1 for conditional formatting (rules on
 * Sent Count, data bars on Opened), &chart=stacked | stacked100 | combo for the chart kinds.
 * For design review and screenshots; the real editor is ReportEditorPage.
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { SegmentedControl, type SegmentOption } from '@/components/SegmentedControl'
import { ReportResult, ViewBar } from '../components/ReportViews'
import { runWords } from '../components/resultWords'
import { EMPTY, setCompare, setView, viewOf } from '../editor/definition'
import { FieldWells } from '../editor/FieldWells'
import { Steps } from '../editor/Steps'
import type { CatalogDataset, ChartKind, ReportDefinition, RunResult, ViewType } from '../types'

const DATASET: CatalogDataset = {
  key: 'messages', label: 'Messages', description: 'Every email and text a campaign sent: who, when, and what became of it', component: { key: 'cep', name: 'Engagement' },
  primary_key: 'message_id', time_field: 'submitted_at', freshness: 'LIVE',
  fields: [
    { key: 'channel', label: 'Channel', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'contains', 'starts_with', 'in', 'is_null', 'is_not_null'], buckets: [], format: null, sensitivity: 'NORMAL' },
    { key: 'campaign_name', label: 'Campaign', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'contains', 'starts_with', 'in', 'is_null', 'is_not_null'], buckets: [], format: null, sensitivity: 'NORMAL' },
    { key: 'campaign_type', label: 'Campaign Type', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
    { key: 'status', label: 'Status', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
    { key: 'submitted_at', label: 'Sent', type: 'datetime', role: 'dimension', aggregates: [], operators: ['=', '!=', '>', '>=', '<', '<=', 'between', 'last_days', 'is_null', 'is_not_null'], buckets: ['day', 'week', 'month', 'quarter', 'year'], format: 'datetime', sensitivity: 'NORMAL' },
    { key: 'party_id', label: 'Customer', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'contains'], buckets: [], format: null, sensitivity: 'PII' },
    { key: 'messages', label: 'Messages', type: 'number', role: 'measure', aggregates: ['count'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
    { key: 'sent', label: 'Sent Count', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
    { key: 'delivered', label: 'Delivered Count', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
    { key: 'opened', label: 'Opened', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
    { key: 'clicked', label: 'Clicked', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
  ],
}

const BUSY: ReportDefinition = {
  columns: [{ field: 'channel' }, { field: 'submitted_at', bucket: 'month' }, { field: 'sent', aggregate: 'sum' }, { field: 'opened', aggregate: 'sum' }],
  filters: { combinator: 'and', rules: [{ field: 'submitted_at', operator: 'last_days', value: 60 }, { field: 'channel', operator: 'in', value: ['EMAIL', 'SMS'] }] },
  orderBy: [{ field: 'sent', direction: 'desc' }],
  limit: 500,
}

const RESULT: RunResult = {
  columns: [{ key: 'channel', label: 'Channel', type: 'string', format: null }, { key: 'submitted_at', label: 'Sent', type: 'date', format: 'datetime', bucket: 'month' },
            { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }, { key: 'opened', label: 'Opened', type: 'number', format: 'integer', aggregate: 'sum' }],
  rows: [['EMAIL', '2026-09-01', 356920, 134210], ['EMAIL', '2026-08-01', 247250, 91880], ['SMS', '2026-09-01', 29580, 0], ['SMS', '2026-08-01', 27810, 0]],
  row_count: 4, duration_ms: 812, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false,
}

/** the same rows with Sent Count against the month before and against last year, as the engine returns them */
const COMPARED: RunResult = {
  ...RESULT,
  columns: [...RESULT.columns.slice(0, 3), { key: 'sent__previous_period', label: 'Sent Count, Previous Month', type: 'number', format: 'integer', aggregate: 'sum', compare: 'previous_period' },
            { key: 'sent__change_previous_year', label: 'Sent Count, Change vs Last Year', type: 'number', format: 'percent', aggregate: 'sum', compare: 'change_previous_year' }, RESULT.columns[3]],
  rows: [['EMAIL', '2026-09-01', 356920, 247250, 18.4, 134210], ['EMAIL', '2026-08-01', 247250, 230110, -4.2, 91880], ['SMS', '2026-09-01', 29580, 27810, 61.0, 0], ['SMS', '2026-08-01', 27810, 19940, 12.7, 0]],
}

type Layout = 'wells' | 'steps'
const LAYOUTS: SegmentOption<Layout>[] = [{ value: 'wells', label: 'Field Wells' }, { value: 'steps', label: 'Steps' }]

export default function InsightsPlayground() {
  const [params, setParams] = useSearchParams()
  const layout = (params.get('layout') === 'steps' ? 'steps' : 'wells') as Layout
  const [definition, setDefinition] = useState<ReportDefinition>(() => {
    const base = params.get('state') === 'sparse' ? EMPTY : params.get('compare') === '1' ? setCompare(BUSY, 'sent', ['previous_period', 'change_previous_year']) : BUSY
    const type = (params.get('view') ?? 'grid') as ViewType
    const formats = params.get('format') === '1' ? { formats: [{ column: 'sent', style: 'rules' as const, rules: [{ op: '<' as const, value: 30000, tone: 'bad' as const }, { op: '<' as const, value: 300000, tone: 'warning' as const }, { op: '>=' as const, value: 300000, tone: 'good' as const }] },
      { column: 'opened', style: 'bars' as const }] } : {}
    if (type === 'grid') return params.get('format') === '1' ? setView(base, { type, ...formats }) : base
    return setView(base, { type, chart: (params.get('chart') as ChartKind | null) ?? 'bar', across: params.get('across') ?? undefined, ...formats })
  })
  const compared = params.get('compare') === '1'
  const base: RunResult = compared ? COMPARED : RESULT
  const shown: RunResult = params.get('masked')
    ? { ...base, columns: [{ key: 'party_id', label: 'Customer', type: 'string', format: null, masked: true }, ...base.columns.slice(1)], rows: base.rows.map((row) => ['•••••', ...row.slice(1)]) }
    : base
  const result = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-800">
        <ViewBar view={viewOf(definition)} onChange={(view) => setDefinition(setView(definition, view))} columns={shown.columns} dimensions={[]} />
        <span>{runWords(shown)}</span>
      </div>
      <ReportResult result={shown} view={viewOf(definition)} label="Preview rows" minHeight={280} />
    </div>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle pb-3">
        <span className="text-sm text-brand-800">← Report</span>
        <input aria-label="Report name" defaultValue="Monthly Sends by Channel" className="min-w-0 flex-1 rounded-control-md border border-transparent bg-transparent px-2 font-display text-page-title font-semibold text-ink-900 hover:border-line" />
        <span className="text-xs text-ink-800">Not saved yet</span>
        <SegmentedControl label="Editor" options={LAYOUTS} value={layout} onChange={(next) => setParams({ layout: next, ...(params.get('state') ? { state: params.get('state') as string } : {}) })} />
      </div>
      {layout === 'wells'
        ? <FieldWells dataset={DATASET} definition={definition} onChange={setDefinition} result={result} />
        : <Steps dataset={DATASET} definition={definition} onChange={setDefinition} result={result} rowCount={670680} />}
    </div>
  )
}
