/**
 * /dev/ask: AI · Ask for a Report without a backend. The assistant's state and the catalogue are primed into the query cache,
 * and the ask and open calls are answered here: a prompt ending in "?" gets a question back, one naming "website visits"
 * gets no field, a prompt on CG-Prod's tables not mapped yet a draft on a new dataset, anything else a draft. ?state=busy shows
 * recent prompts under the box; ?state=spec opens on CG-Prod with its tables not mapped yet, and &demo=attached or &demo=draft
 * drops a spec, a PDF and a sketch on the box and writes the prompt (and presses Generate), &demo=menu opens Ask About, and
 * &demo=building presses Generate on a prompt that stays under way, its steps part done, for the guide's screenshots.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { keys } from '../api'
import { AskForReport } from '../components/AskForReport'
import type { AskResult, AskStep, AssistantState, Catalog, CatalogDataset, CatalogField } from '../types'

const field = (key: string, label: string, type: CatalogField['type'], role: CatalogField['role'], aggregates: CatalogField['aggregates'] = []): CatalogField =>
  ({ key, label, type, role, aggregates, operators: ['='], buckets: type === 'date' ? ['week', 'month'] : [], format: null, sensitivity: 'NORMAL' })
const CG = { id: 'db-cg', name: 'CG-Prod', engine: 'mysql57' as const, engine_name: 'MySQL 5.7' }
const mapped = (key: string, label: string): CatalogDataset => ({ key, label, description: null, component: { key: 'cep', name: 'Engagement' }, primary_key: '', time_field: null, freshness: 'LIVE',
  kind: 'table', database: CG, fields: [field('store', 'Store', 'string', 'dimension'), field('amount', 'Amount', 'number', 'measure', ['sum'])] })
const upload = (key: string, label: string): CatalogDataset => ({ key, label, description: null, component: { key: 'cep', name: 'Engagement' }, primary_key: '', time_field: null, freshness: 'LIVE',
  kind: 'upload', fields: [field('store', 'Store', 'string', 'dimension')] })

const CATALOG: Catalog = {
  components: [{ key: 'cep', name: 'Engagement' }, { key: 'insights', name: 'Insights' }, { key: 'crm', name: 'CRM' }, { key: 'sales', name: 'Sales' }, { key: 'pur', name: 'Purchasing' }, { key: 'inv', name: 'Inventory' }, { key: 'pim', name: 'PIM' }], can_choose_component: true,
  engine: { engine: 'postgresql', status: 'ACTIVE', freshness_sla: 'LIVE', limits: { statement_timeout_ms: 15000, preview_rows: 200, run_rows: 5000, export_rows: 100000, concurrent: 4 } },
  datasets: [{
    key: 'messages', label: 'Messages', description: 'Every email and text a campaign sent', component: { key: 'cep', name: 'Engagement' }, primary_key: 'message_id', time_field: 'submitted_at', freshness: 'LIVE',
    fields: [
      { key: 'channel', label: 'Channel', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
      { key: 'campaign_name', label: 'Campaign', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'contains'], buckets: [], format: null, sensitivity: 'NORMAL' },
      { key: 'submitted_at', label: 'Sent At', type: 'datetime', role: 'dimension', aggregates: [], operators: ['between', 'last_days'], buckets: ['day', 'week', 'month'], format: 'datetime', sensitivity: 'NORMAL' },
      { key: 'sent', label: 'Messages Sent', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>'], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
      { key: 'revenue', label: 'Revenue', type: 'number', role: 'measure', aggregates: ['sum', 'avg'], operators: ['>'], buckets: [], format: 'money', sensitivity: 'NORMAL' },
    ],
  }, { key: 'orders', label: 'Attributed Orders', description: null, component: { key: 'cep', name: 'Orders' }, primary_key: '', time_field: null, freshness: 'LIVE', fields: [field('amount', 'Amount', 'number', 'measure', ['sum'])] },
  mapped('x_daily_sales', 'Daily Sales'), mapped('x_stores', 'Stores'), mapped('x_returns', 'Returns'), upload('u_pos', 'POS Transactions'), upload('u_returns', 'POS Returns')],
}

const MODELS: AssistantState['models'] = [
  { id: 'anthropic:claude-sonnet-5-5', provider: 'anthropic', provider_name: 'Claude (Anthropic)', mark: 'A', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Best for reports' },
  { id: 'anthropic:claude-haiku-5-5', provider: 'anthropic', provider_name: 'Claude (Anthropic)', mark: 'A', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest' },
  { id: 'openai:gpt-5', provider: 'openai', provider_name: 'OpenAI', mark: 'O', model: 'gpt-5', label: 'GPT-5', note: 'Best for reports' },
  { id: 'openai:gpt-5-mini', provider: 'openai', provider_name: 'OpenAI', mark: 'O', model: 'gpt-5-mini', label: 'GPT-5 mini', note: 'Fastest' },
]

function state(busy: boolean): AssistantState {
  return {
    enabled: true, reason: null, models: MODELS, default_model: 'anthropic:claude-sonnet-5-5',
    usage: busy ? { used: 38, limit: 200, month: '2026-10-01', plan: 'Growth', words: '38 of 200 prompts used in October' } : { used: 0, limit: 200, month: '2026-10-01', plan: 'Growth', words: '200 prompts a month on the Growth plan' },
    examples: ['Which campaigns made the most revenue last month?', 'Delivered rate by sending engine, by week', 'New contacts by home store this year, with consent', 'E-receipts sent per store per day, last 14 days'],
    recent: busy ? [
      { id: 'p1', prompt: 'Weekly revenue by channel for September as bars', model: 'Claude Sonnet 5.5', provider: 'anthropic', outcome: 'DRAFT', created_at: '2026-10-05T13:14:00Z', report_id: 'r1', report_name: 'Weekly Revenue by Channel' },
      { id: 'p2', prompt: 'Contacts by home store with email and text consent', model: 'GPT-5', provider: 'openai', outcome: 'DRAFT', created_at: '2026-10-02T20:02:00Z', report_id: 'r2', report_name: 'Contacts by Store and Consent' },
      { id: 'p3', prompt: 'Bounce rate by sending engine, last 30 days', model: 'Claude Haiku 5.5', provider: 'anthropic', outcome: 'DRAFT', created_at: '2026-09-30T14:48:00Z', report_id: null, report_name: null },
    ] : [],
  }
}

function reply(prompt: string, modelId: string, unmapped: boolean, documents: File[], images: number): AskResult {
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0]
  const read = documents.length || images ? { documents: documents.map((file) => ({ name: file.name, kind: file.name.endsWith('.pdf') ? 'pdf' as const : file.name.endsWith('.docx') ? 'word' as const : 'text' as const })), images } : null
  const base = { prompt, model, duration_ms: 3200, message: null, usage: { used: 39, limit: 200, month: '2026-10-01', plan: 'Growth' }, read }
  if (unmapped) {
    const dataset: CatalogDataset = { key: 'new_dataset', label: 'Store Sales', description: null, component: { key: 'cep', name: 'Engagement' }, primary_key: 'line_id', time_field: 'sale_week', freshness: 'LIVE', kind: 'table',
      fields: [field('store', 'Store', 'string', 'dimension'), field('sale_week', 'Week', 'date', 'dimension'), field('store_type', 'Store Type', 'string', 'dimension'), field('net_sales', 'Net Sales', 'number', 'measure', ['sum'])] }
    return { ...base, id: 'u1', kind: 'draft', counted: true, duration_ms: 6200, name: 'Net Sales by Store and Week, Q3 vs Last Year', dataset: 'new_dataset', dataset_label: 'Store Sales', view: { type: 'grid' },
      definition: { columns: [{ field: 'store' }, { field: 'sale_week', bucket: 'week' }, { field: 'net_sales', aggregate: 'sum', compare: ['change_previous_year'] }],
        filters: { combinator: 'and', rules: [{ field: 'sale_week', operator: 'between', value: ['2026-07-01', '2026-09-30'] }, { field: 'store_type', operator: '!=', value: 'F' }] }, orderBy: [{ field: 'net_sales', direction: 'desc' }], limit: 500 },
      note: 'The spec’s “only stores open all quarter” needs an opening date the tables do not have; the draft leaves it out.', preview: { rows: 312, more: false },
      new_dataset: { connection_id: 'db-cg', database: 'CG-Prod', label: 'Store Sales', source: 'sales_lines', joins: ['stores'], fields: 7, dataset } }
  }
  if (prompt.trim().endsWith('?')) {
    return { ...base, id: 'q1', kind: 'question', counted: false, duration_ms: 1800, question: 'Which period is last month?',
      answers: [{ label: 'September 2026, the calendar month', prompt: 'Revenue by campaign for September 2026' }, { label: 'The last 30 days, 17 Sep to 16 Oct', prompt: 'Revenue by campaign for the last 30 days' }] }
  }
  if (/website visits/i.test(prompt)) {
    return { ...base, id: 'n1', kind: 'no_field', counted: false, duration_ms: 1100, message: 'No dataset has website visits. The closest fields are Messages Sent (Messages) and Revenue (Messages).',
      suggestions: [{ label: 'Messages Sent by Campaign for September', prompt: 'Messages sent by campaign for September' }, { label: 'Revenue by Campaign for September', prompt: 'Revenue by campaign for September' }] }
  }
  return { ...base, id: 'd1', kind: 'draft', counted: true, name: 'Sent and Revenue by Channel and Campaign', dataset: 'messages', dataset_label: 'Messages', view: { type: 'pivot', across: 'submitted_at' },
    definition: { columns: [{ field: 'channel' }, { field: 'campaign_name' }, { field: 'submitted_at', bucket: 'month' }, { field: 'sent', aggregate: 'sum' }, { field: 'revenue', aggregate: 'sum' }],
      filters: { combinator: 'and', rules: [{ field: 'submitted_at', operator: 'between', value: ['2026-08-01', '2026-09-30'] }] }, orderBy: [{ field: 'revenue', direction: 'desc' }], limit: 500 },
    preview: { rows: 9, more: false } }
}

const SPEC_PROMPT = 'Build the report described in the spec: net sales by store and week for Q3, compared with the same week last year, stores down the side as in the sketch.\n'
  + 'Use the regional targets in the PDF as a target line.\nOnly stores open all quarter; leave out franchise stores (store_type = \'F\').'

/** what a person does in the box, done for a screenshot: the files dropped, the prompt written, Generate pressed */
async function act(demo: string) {
  const box = document.querySelector('section[aria-label="Ask for a Report"]')
  const prompt = document.getElementById('ai-prompt') as HTMLTextAreaElement | null
  if (!box || !prompt) return
  if (demo === 'menu') {
    box.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
    return
  }
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 220
  const pen = canvas.getContext('2d')
  if (pen) {
    pen.fillStyle = '#ffffff'
    pen.fillRect(0, 0, 320, 220)
    pen.strokeStyle = '#3863db'
    pen.lineWidth = 3
    for (let row = 0; row < 5; row += 1) pen.strokeRect(20, 20 + row * 38, 280, 30)
  }
  const sketch = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  const files = [new File([new Uint8Array(28_400)], 'Store sales report spec v3.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    new File([new Uint8Array(1_200_000)], 'Regional KPIs 2026.pdf', { type: 'application/pdf' }), ...(sketch ? [new File([sketch], 'sketch.png', { type: 'image/png' })] : [])]
  const carried = new DataTransfer()
  files.forEach((file) => carried.items.add(file))
  box.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: carried }))
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(prompt, SPEC_PROMPT)
  prompt.dispatchEvent(new Event('input', { bubbles: true }))
  if (demo !== 'draft' && demo !== 'building') return
  await new Promise((resolve) => setTimeout(resolve, 1200))                                     // the sketch is read before it is sent
  Array.from(box.querySelectorAll('button')).find((button) => button.textContent === 'Generate Report')?.click()
}

const step = (key: string, label: string, state: AskStep['state'], detail: string | null = null): AskStep => ({ key, label, detail, state, started_at: null, ended_at: null })
/** a busy prompt part done: the spec and the sketch read, CG-Prod's tables read, Claude drafting */
const BUILDING: AskStep[] = [
  step('documents', 'Read your 2 documents and 1 image', 'done', 'Store sales report spec v3.docx · Regional KPIs 2026.pdf (14 pages) · 1 image'),
  step('tables', "Read the database's tables", 'done', 'CG-Prod: 1,284 names · the columns of sales_lines, stores'),
  step('draft', 'Claude is drafting the report', 'now', 'Claude Sonnet 5.5'),
  step('check', 'Check the draft against your data', 'wait'),
  step('preview', 'Preview the rows', 'wait'),
]
const BUILT: AskStep[] = BUILDING.map((s) => ({ ...s, state: 'done' as const, detail: s.key === 'preview' ? '312 rows' : s.detail }))

export default function AskPlayground() {
  const [params] = useSearchParams()
  const client = useQueryClient()
  const busy = params.get('state') === 'busy'
  const [primed] = useState(() => {
    if (params.get('state') === 'spec') {
      window.localStorage.setItem('insights.ai.scope', 'db:db-cg')
      window.localStorage.setItem('insights.ai.unmapped', 'true')
    }
    client.setQueryData(keys.assistant, state(busy))
    client.setQueryData(keys.catalog, CATALOG)
    client.setQueryData(['workspace', 'report-databases', 'targets'], { databases: [{ ...CG, database_name: 'shop', schema_name: 'shop' }, { id: 'db-fw', name: 'Finance Warehouse', engine: 'postgresql', engine_name: 'PostgreSQL 16', database_name: 'finance', schema_name: 'reporting' }] })
    return true
  })
  useEffect(() => {
    const real = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/insights/assistant/ask/')) {
        const form = init?.body instanceof FormData ? init.body : null                     // with images or documents it comes as multipart
        const body = (form ? { prompt: String(form.get('prompt')), model: String(form.get('model')), unmapped: form.get('unmapped') === 'true' } : JSON.parse(String(init?.body ?? '{}'))) as { prompt: string; model: string; unmapped?: boolean }
        await new Promise((resolve) => setTimeout(resolve, params.get('demo') === 'building' ? 20_000 : 600))
        return new Response(JSON.stringify({ steps: BUILT, ...reply(body.prompt, body.model, Boolean(body.unmapped), form ? form.getAll('documents') as File[] : [], form ? form.getAll('images').length : 0) }),
          { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/insights/assistant/progress/')) return new Response(JSON.stringify({ steps: BUILDING, finished: false }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.includes('/insights/assistant/')) return new Response(JSON.stringify(state(busy)), { status: 200, headers: { 'content-type': 'application/json' } })
      return real(input, init)
    }
    return () => { window.fetch = real }
  }, [busy, params])
  const demo = params.get('demo')
  useEffect(() => {
    if (demo !== 'attached' && demo !== 'draft' && demo !== 'menu' && demo !== 'building') return
    const timer = setTimeout(() => { void act(demo) }, 400)
    return () => clearTimeout(timer)
  }, [demo])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <h1 className="font-display text-page-title font-semibold text-ink-900">All Reports</h1>
      {primed && <AskForReport />}
    </main>
  )
}
