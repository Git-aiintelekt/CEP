/**
 * /dev/ask: AI · Ask for a Report without a backend. The assistant's state and the catalogue are primed into the query cache,
 * and the ask and open calls are answered here: a prompt ending in "?" gets a question back, one naming "website visits"
 * gets no field, anything else a draft. ?state=busy shows recent prompts under the box.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { keys } from '../api'
import { AskForReport } from '../components/AskForReport'
import type { AskResult, AssistantState, Catalog } from '../types'

const CATALOG: Catalog = {
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
  }],
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

function reply(prompt: string, modelId: string): AskResult {
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0]
  const base = { prompt, model, duration_ms: 3200, message: null, usage: { used: 39, limit: 200, month: '2026-10-01', plan: 'Growth' } }
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

export default function AskPlayground() {
  const [params] = useSearchParams()
  const client = useQueryClient()
  const busy = params.get('state') === 'busy'
  const [primed] = useState(() => {
    client.setQueryData(keys.assistant, state(busy))
    client.setQueryData(keys.catalog, CATALOG)
    return true
  })
  useEffect(() => {
    const real = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/insights/assistant/ask/')) {
        const form = init?.body instanceof FormData ? init.body : null                     // with images it comes as multipart
        const body = (form ? { prompt: String(form.get('prompt')), model: String(form.get('model')) } : JSON.parse(String(init?.body ?? '{}'))) as { prompt: string; model: string }
        await new Promise((resolve) => setTimeout(resolve, 600))
        return new Response(JSON.stringify(reply(body.prompt, body.model)), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/insights/assistant/')) return new Response(JSON.stringify(state(busy)), { status: 200, headers: { 'content-type': 'application/json' } })
      return real(input, init)
    }
    return () => { window.fetch = real }
  }, [busy])

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <h1 className="font-display text-page-title font-semibold text-ink-900">All Reports</h1>
      {primed && <AskForReport />}
    </main>
  )
}
