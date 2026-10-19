/**
 * /dev/data: uploaded files, parameters and fiscal calendars on sample data, with no backend. ?show=params (the questions above a
 * report, &state=sparse for one), review (an uploaded file's columns), fiscal (Settings → Fiscal Year from April).
 * For design review and screenshots; the real pages are UploadsPage, ReportViewerPage and FiscalYearPage.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { FiscalYearPage } from '@/apps/cep/pages/settings/FiscalYearPage'
import { fiscalKey } from '../api'
import { ParameterBar } from '../components/ParameterBar'
import { ReportResult } from '../components/ReportViews'
import { UploadReviewDialog } from '../components/UploadReviewDialog'
import type { CatalogField, ParameterValues, ReportParameter, RunResult, UploadedFile } from '../types'

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

export default function DataPlayground() {
  const [params] = useSearchParams()
  const client = useQueryClient()
  const [answers, setAnswers] = useState<ParameterValues>(params.get('state') === 'sparse' ? {} : { channel: ['EMAIL', 'SMS'], store: 'Downtown' })
  useState(() => {                                                   // the sample answers the pieces read, put in once before they mount
    client.setQueryData(['insights', 'parameter-values', 'messages', 'channel'], { field: 'channel', values: ['EMAIL', 'SMS', 'PUSH'], choosable: true })
    client.setQueryData(['insights', 'parameter-values', 'messages', 'store'], { field: 'store', values: ['Airport', 'Downtown', 'Harbour', 'Mall', 'Riverside'], choosable: true })
    client.setQueryData(fiscalKey, { start: 4, named_by: 'end' })
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
      {show === 'review' && <UploadReviewDialog upload={UPLOAD} onClose={() => undefined} onSaved={() => undefined} />}
      {show === 'fiscal' && <div className="max-w-4xl"><FiscalYearPage /></div>}
    </div>
  )
}
