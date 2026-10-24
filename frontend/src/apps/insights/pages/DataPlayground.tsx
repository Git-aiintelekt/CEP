/**
 * /dev/data: uploaded files, parameters and fiscal calendars on sample data, with no backend. ?show=params (the questions above a
 * report, &state=sparse for one), review (an uploaded file's columns), fiscal (Settings → Fiscal Year from April), formula (a measure
 * formula in Custom Fields, &state=error for one that does not read), shared (Insights → Shared Formulas, &state=sparse for none),
 * shared-edit (a shared formula with CALCULATE and ALL, checked), campaigns (the report filters every report asks: Campaign, the latest by
 * default, Channel and Period, 7 days; and 45 rows paged 20 at a time; &state=sparse for 14 rows and no pager).
 * For design review and screenshots; the real pages are UploadsPage, ReportViewerPage and FiscalYearPage.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { FiscalYearPage } from '@/apps/cep/pages/settings/FiscalYearPage'
import { fiscalKey, keys } from '../api'
import { ParameterBar } from '../components/ParameterBar'
import { ReportResult } from '../components/ReportViews'
import { runWords } from '../components/resultWords'
import { UploadReviewDialog } from '../components/UploadReviewDialog'
import { CustomFieldsDialog } from '../editor/CustomFieldsDialog'
import { SharedFormulaDialog } from '../editor/SharedFormulaDialog'
import type { CatalogDataset, CatalogField, ParameterValues, ReportDefinition, ReportParameter, RunResult, SharedFormula, UploadedFile } from '../types'
import { SharedFormulasPage } from './SharedFormulasPage'

const FIELDS: CatalogField[] = [
  { key: 'channel', label: 'Channel', type: 'string', role: 'dimension', aggregates: [], operators: ['=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
  { key: 'store', label: 'Store', type: 'string', role: 'dimension', aggregates: [], operators: ['=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
  { key: 'submitted_at', label: 'Sent', type: 'date', role: 'dimension', aggregates: [], operators: ['between', 'last_days', '>=', '<='], buckets: ['month'], format: 'date', sensitivity: 'NORMAL' },
]
const ASKED: ReportParameter[] = [
  { key: 'channel', label: 'Channel', field: 'channel', operator: 'in', required: true },
  { key: 'store', label: 'Store', field: 'store', operator: '=', required: false },
  { key: 'sent', label: 'Sent', field: 'submitted_at', operator: 'between', required: false, default: ['2026-09-01', '2026-09-30'] },
]
const RESULT: RunResult = {
  columns: [{ key: 'campaign_name', label: 'Campaign', type: 'string', format: null }, { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }],
  rows: [['Fall Launch', 142300], ['Weekly Newsletter', 201500]], row_count: 2, duration_ms: 64, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false,
}
const CAMPAIGN_FIELDS: CatalogField[] = [
  { key: 'campaign_name', label: 'SMS Campaign', type: 'string', role: 'dimension', aggregates: [], operators: ['=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
  { key: 'channel', label: 'Channel', type: 'string', role: 'dimension', aggregates: [], operators: ['=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
  { key: 'sent_at', label: 'Sent At', type: 'datetime', role: 'dimension', aggregates: [], operators: ['between', 'last_days', '>=', '<='], buckets: ['day'], format: 'datetime', sensitivity: 'NORMAL' },
]
const CAMPAIGN_ASKED: ReportParameter[] = [
  { key: 'campaign', label: 'Campaign', field: 'campaign_name', operator: 'in', required: false, default: { latest: true } },
  { key: 'channel', label: 'Channel', field: 'channel', operator: 'in', required: false },
  { key: 'period', label: 'Period', field: 'sent_at', operator: 'period', required: true, default: '7d' },
]
const STORES = ['CT Ashley Park', 'CT Southlake Mall', 'CT Jonesboro', 'CT Stonecrest', 'CT Cumberland', 'CT Perimeter', 'CT Gwinnett Place']
const CARRIERS = ['T-Mobile', 'Verizon', 'AT&T']
const campaignRows = (n: number) => Array.from({ length: n }, (_, i) => [`2026-10-17 13:${String(59 - (i % 60)).padStart(2, '0')}:00`, STORES[i % STORES.length], `+1 404 •••• ${String(2210 + i * 37).slice(-4)}`,
  i % 9 === 4 ? 'failed' : 'delivered', CARRIERS[i % 3], i % 9 === 4 ? 'Unreachable handset' : null])
const campaignResult = (n: number): RunResult => ({
  columns: [{ key: 'sent_at', label: 'Sent At', type: 'datetime', format: 'datetime' }, { key: 'store_name', label: 'Store Name', type: 'string', format: null }, { key: 'phone', label: 'Phone', type: 'string', format: null },
    { key: 'status', label: 'Status', type: 'string', format: null }, { key: 'carrier', label: 'Carrier', type: 'string', format: null }, { key: 'failure_reason', label: 'Failure Reason', type: 'string', format: null }],
  rows: campaignRows(n), row_count: n, duration_ms: 1529, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: true, ran_at: '2026-10-24T10:42:00Z', kept_s: 900, source: 'Citi-TT-Analysis DB 8.0',
  parameters: [{ key: 'campaign', label: 'Campaign', value: ['Hottest Designer Deals Oct 17 Day 2'], latest: true }, { key: 'period', label: 'Period', value: '7d' }],
})
const UPLOAD: UploadedFile = {
  id: 'upl-1', key: 'upl_store_sales', name: 'Store Sales October', description: null, file_name: 'store-sales-oct.xlsx', file_kind: 'xlsx', row_count: 18240, status: 'DRAFT',
  created_at: '2026-10-19T09:00:00Z', updated_at: '2026-10-19T09:00:00Z', replaced_at: null, row_version: 1,
  columns: [
    { key: 'store', label: 'Store', column: 'c1', source: 'Store', type: 'string', inferred: 'string', types: ['string'], role: 'dimension' },
    { key: 'store_no', label: 'Store No', column: 'c2', source: 'Store No', type: 'number', inferred: 'number', types: ['number', 'string'], role: 'measure' },
    { key: 'sale_date', label: 'Sale Date', column: 'c3', source: 'Sale Date', type: 'date', inferred: 'date', types: ['date', 'string'], role: 'dimension' },
    { key: 'net_sales', label: 'Net Sales', column: 'c4', source: 'Net Sales', type: 'number', inferred: 'number', types: ['number', 'string'], role: 'measure' },
    { key: 'loyalty', label: 'Loyalty', column: 'c5', source: 'Loyalty', type: 'boolean', inferred: 'boolean', types: ['boolean', 'string'], role: 'dimension' },
    { key: 'sku', label: 'SKU', column: 'c6', source: 'SKU', type: 'string', inferred: 'string', types: ['string'], role: 'dimension' },
  ],
  sample: [
    { c1: 'Downtown', c2: 12, c3: '2026-10-01', c4: 1234.5, c5: true, c6: '007-114' }, { c1: 'Riverside', c2: 14, c3: '2026-10-01', c4: 982, c5: false, c6: '007-220' },
    { c1: 'Airport', c2: 21, c3: '2026-10-02', c4: 4410.25, c5: true, c6: '010-001' }, { c1: 'Mall', c2: 9, c3: '2026-10-02', c4: 310, c6: '002-919' }, { c1: 'Harbour', c2: 30, c3: '2026-10-03', c4: 77.9, c5: false, c6: '007-114' },
  ],
}

const MESSAGES: CatalogDataset = {
  key: 'messages', label: 'Messages', description: null, component: { key: 'cep', name: 'Engagement' }, primary_key: 'message_id', time_field: 'submitted_at', freshness: 'LIVE',
  fields: [...FIELDS, { key: 'sent', label: 'Sent Count', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
    { key: 'delivered', label: 'Delivered Count', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' }],
}
const SHARE = 'DIVIDE(SUM([Sent Count], [Channel] = "EMAIL"), SUM([Sent Count])) * 100'
const BROKEN = 'DIVIDE(SUM([Sent Count], [Channel] = "EMAIL"), SUM([Sent Count]) * 100'
const SHARE_OF_ALL = 'DIVIDE(SUM([Sent Count]), CALCULATE(SUM([Sent Count]), ALL([Channel]))) * 100'
const stamp = { created_by_name: 'Aby', created_at: '2026-10-12T09:00:00Z', sensitivity: 'NORMAL' as const, dataset_key: 'messages' }
const SHARED: SharedFormula[] = [
  { ...stamp, id: 'sf-1', key: 'f_delivery_rate', label: 'Delivery Rate', description: 'Delivered as a share of sent, the figure the board sees', kind: 'measure', type: 'number', role: null, format: 'percent',
    expression: 'DIVIDE(SUM([Delivered Count]), SUM([Sent Count])) * 100', certified: true, certified_at: '2026-10-14T16:20:00Z', certified_by_name: 'Aby', updated_at: '2026-10-14T16:20:00Z', row_version: 3, reports: 7 },
  { ...stamp, id: 'sf-2', key: 'f_channel_share', label: 'Channel Share', description: 'Each channel’s part of all sends', kind: 'measure', type: 'number', role: null, format: 'percent',
    expression: SHARE_OF_ALL, certified: true, certified_at: '2026-10-15T11:05:00Z', certified_by_name: 'Aby', updated_at: '2026-10-15T11:05:00Z', row_version: 2, reports: 2 },
  { ...stamp, id: 'sf-3', key: 'f_sends_ytd', label: 'Sends Year to Date', description: null, kind: 'measure', type: 'number', role: null, format: 'integer',
    expression: 'TOTALYTD(SUM([Sent Count]))', certified: false, certified_at: null, certified_by_name: null, updated_at: '2026-10-18T08:40:00Z', row_version: 1, reports: 0 },
  { ...stamp, id: 'sf-4', key: 'f_send_size', label: 'Send Size', description: 'Large from a thousand sends', kind: 'formula', type: 'string', role: 'dimension', format: null,
    expression: 'IF([Sent Count] >= 1000, "Large", "Small")', certified: false, certified_at: null, certified_by_name: null, updated_at: '2026-10-19T07:55:00Z', row_version: 1, reports: 1 },
]
const FORMULA_REPORT: ReportDefinition = { columns: [{ field: 'channel' }], derived: [{ key: 'c_size', label: 'Size', kind: 'formula', expression: 'IF([Sent Count] >= 1000, "Large", "Small")', type: 'string', role: 'dimension' }] }

export default function DataPlayground() {
  const [params] = useSearchParams()
  const client = useQueryClient()
  const [answers, setAnswers] = useState<ParameterValues>(params.get('state') === 'sparse' ? {} : { channel: ['EMAIL', 'SMS'], store: 'Downtown' })
  useState(() => {                                                   // the sample answers the pieces read, put in once before they mount
    client.setQueryData(['insights', 'parameter-values', 'messages', 'channel'], { field: 'channel', values: ['EMAIL', 'SMS', 'PUSH'], choosable: true })
    client.setQueryData(['insights', 'parameter-values', 'messages', 'store'], { field: 'store', values: ['Airport', 'Downtown', 'Harbour', 'Mall', 'Riverside'], choosable: true })
    client.setQueryData(['insights', 'parameter-values', 'citi', 'campaign_name'], { field: 'campaign_name', values: ['Hottest Designer Deals Oct 17 Day 2', 'Hottest Designer Deals Oct 16 Day 1', 'Saks Insider Oct 2026', 'Haribo Oct 2026'], choosable: true })
    client.setQueryData(['insights', 'parameter-values', 'citi', 'channel'], { field: 'channel', values: ['SMS', 'EMAIL'], choosable: true })
    client.setQueryData(fiscalKey, { start: 4, named_by: 'end' })
    const asked = (expression: string) => ['insights', 'formula-check', 'messages', null, FORMULA_REPORT.derived, undefined, { expression, kind: 'measure', role: '', format: 'percent', label: 'Email Share' }]
    client.setQueryData(asked(SHARE), { ok: true, spec: { key: 'c_email_share', label: 'Email Share', kind: 'measure', expression: SHARE, type: 'number', format: 'percent' }, role: 'measure', personal: false, uses: ['Sent Count', 'Channel'] })
    client.setQueryData(asked(BROKEN), { ok: false, message: 'SUM( is not closed: add ) after its last value.', at: 7, where: 'expression' })
    client.setQueryData(['insights', 'formula-check', 'messages', 'shared:new', [], undefined, { expression: SHARE_OF_ALL, kind: 'measure', role: '', format: 'percent', label: 'Channel Share' }],
      { ok: true, spec: { key: 'c_channel_share', label: 'Channel Share', kind: 'measure', expression: SHARE_OF_ALL, type: 'number', format: 'percent' }, role: 'measure', personal: false, uses: ['Sent Count', 'Channel'], analytic: true })
    const sparse = params.get('state') === 'sparse'
    for (const key of [keys.catalog, keys.sharedFormulas('messages')]) client.setQueryDefaults(key, { staleTime: Infinity, retry: false })
    client.setQueryData(keys.catalog, { datasets: [MESSAGES], engine: { name: 'PostgreSQL' } })
    client.setQueryData(keys.sharedFormulas('messages'), { dataset: 'messages', ready: true, can_certify: true, formulas: sparse ? [] : SHARED })
    return true
  })
  const show = params.get('show') ?? 'params'
  const asked = params.get('state') === 'sparse' ? ASKED.slice(0, 1) : ASKED

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-surface p-6">
      {show === 'params' && (
        <>
          <h1 className="font-display text-page-title font-semibold text-ink-900">Sends for a Channel</h1>
          <ParameterBar dataset="messages" fields={FIELDS} parameters={asked} values={answers} onRun={setAnswers} />
          {asked.some((p) => p.required && !answers[p.key])
            ? <p className="rounded-md border border-dashed border-line px-4 py-10 text-center text-sm text-ink-800">Choose Channel above, then run the report.</p>
            : <ReportResult result={RESULT} view={{ type: 'grid' }} label="Report rows" />}
        </>
      )}
      {show === 'campaigns' && (
        <>
          <h1 className="font-display text-page-title font-semibold text-ink-900">SMS Campaign Messages</h1>
          <p className="-mt-3 text-sm text-ink-800">{runWords(campaignResult(params.get('state') === 'sparse' ? 14 : 45))} · version 1 · <span className="font-medium text-link">Refresh</span></p>
          <ParameterBar dataset="citi" fields={CAMPAIGN_FIELDS} parameters={CAMPAIGN_ASKED} values={{}} onRun={() => undefined} used={campaignResult(1).parameters} />
          <ReportResult result={campaignResult(params.get('state') === 'sparse' ? 14 : 45)} view={{ type: 'grid' }} label="Report rows" />
        </>
      )}
      {show === 'review' && <UploadReviewDialog upload={UPLOAD} onClose={() => undefined} onSaved={() => undefined} />}
      {show === 'fiscal' && <div className="max-w-4xl"><FiscalYearPage /></div>}
      {show === 'formula' && <CustomFieldsDialog dataset={MESSAGES} definition={FORMULA_REPORT} onChange={() => undefined} onClose={() => undefined}
        start={{ label: 'Email Share', kind: 'measure', expression: params.get('state') === 'error' ? BROKEN : SHARE, format: 'percent' }} />}
      {show === 'shared' && <div className="max-w-6xl"><SharedFormulasPage /></div>}
      {show === 'shared-edit' && <SharedFormulaDialog dataset={MESSAGES} start={{ label: 'Channel Share', kind: 'measure', expression: SHARE_OF_ALL, format: 'percent', description: 'Each channel’s part of all sends' }} onClose={() => undefined} onSaved={() => undefined} />}
    </div>
  )
}
