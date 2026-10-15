/** /dev/journey-build (dev builds only): the builder on a sample live journey, nothing from the API: the canvas with its
 * live counts, a Condition, a Goal with its paths, a Split, a Webhook. Saves go nowhere. ?case=live (default) | draft */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CONDITION_FIELDS_KEY } from '@/apps/cep/features/journeys/conditions/ConditionBuilder'
import { JourneyBuildWorkspace } from '@/apps/cep/features/journeys/JourneyBuildWorkspace'
import type { Journey, JourneyGraph, JourneyVersionCounts, JourneyVersionDetail } from '@/lib/types'
import { SAMPLE_CATALOGUE } from '@/apps/cep/pages/ConditionPlayground'

const GRAPH: JourneyGraph = {
  entry_rules: [{ entry_type: 'EVENT', rule_definition: { event_type: 'CUSTOMER_CREATED', filters: { all: true, conditions: [{ field: 'customer:country', op: 'is', value: 'United States' }] } } }],
  nodes: [
    { key: 'start', type: 'START', config: {}, position: { x: 0, y: 0 } },
    { key: 'wait-1', type: 'WAIT', config: { duration: 1, unit: 'DAYS' }, position: { x: 0, y: 150 } },
    { key: 'email-welcome', type: 'EMAIL', config: { label: 'Welcome', template_id: 'tpl-1', template_name: 'Welcome Series · 1 of 3' }, position: { x: 0, y: 300 } },
    { key: 'wait-2', type: 'WAIT', config: { mode: 'TIME_OF_DAY', time: '09:00', zone: 'CUSTOMER', weekdays: [] }, position: { x: 0, y: 450 } },
    { key: 'cond-1', type: 'CONDITION', config: { label: 'Worth a second email?', rule: { all: true, conditions: [{ field: 'attr:loyalty_tier', op: 'in', value: ['Gold', 'Platinum'] }, { field: 'message:email-welcome', op: 'delivered_not_opened' }] } }, position: { x: 0, y: 600 } },
    { key: 'email-second', type: 'EMAIL', config: { label: 'Did you miss this?', template_id: 'tpl-2', template_name: 'Welcome Series · 2 of 3' }, position: { x: -280, y: 750 } },
    { key: 'goal-1', type: 'GOAL', config: { label: 'First purchase', event_type: 'PURCHASE', window_days: 14, when_reached: 'EXIT' }, position: { x: 0, y: 900 } },
    { key: 'webhook-1', type: 'WEBHOOK', config: { label: 'Tell the CRM', url: 'https://hooks.example.com/cep', secret_enc: 'stored' }, position: { x: 0, y: 1050 } },
    { key: 'exit-1', type: 'EXIT', config: {}, position: { x: 0, y: 1200 } },
  ],
  connections: [
    { from: 'start', to: 'wait-1', branch_key: null, label: null }, { from: 'wait-1', to: 'email-welcome', branch_key: null, label: null },
    { from: 'email-welcome', to: 'wait-2', branch_key: null, label: null }, { from: 'wait-2', to: 'cond-1', branch_key: null, label: null },
    { from: 'cond-1', to: 'email-second', branch_key: 'YES', label: null }, { from: 'cond-1', to: 'goal-1', branch_key: 'NO', label: null },
    { from: 'email-second', to: 'goal-1', branch_key: null, label: null }, { from: 'goal-1', to: 'webhook-1', branch_key: null, label: null },
    { from: 'webhook-1', to: 'exit-1', branch_key: null, label: null },
  ],
}
const COUNTS: JourneyVersionCounts = {
  entered: 3412, in_journey: 212,
  steps: { 'wait-1': { passed: 3400, held_back: 0, failed: 0, yes: 0, no: 0, waiting: 12 }, 'email-welcome': { passed: 3180, held_back: 214, failed: 6, yes: 0, no: 0, waiting: 0 },
           'wait-2': { passed: 2980, held_back: 0, failed: 0, yes: 0, no: 0, waiting: 200 }, 'cond-1': { passed: 2980, held_back: 0, failed: 0, yes: 1284, no: 1696, waiting: 0 },
           'email-second': { passed: 1210, held_back: 74, failed: 0, yes: 0, no: 0, waiting: 0 }, 'goal-1': { passed: 2906, held_back: 0, failed: 0, yes: 621, no: 2285, waiting: 0 },
           'webhook-1': { passed: 2285, held_back: 0, failed: 3, yes: 0, no: 0, waiting: 0 }, 'exit-1': { passed: 2282, held_back: 0, failed: 0, yes: 0, no: 0, waiting: 0 } },
}
const JOURNEY = { id: 'j-sample', code: 'JRN-2026-00012', name: 'Welcome Series — New Customers', description: null, status: 'ACTIVE', population_mode: 'EVENT_TRIGGERED', reentry_policy: 'NEVER',
                  reentry_after_days: null, current_version: 'jv-3', latest_version: 3, step_types: ['WAIT', 'EMAIL', 'CONDITION', 'GOAL', 'WEBHOOK', 'EXIT'] } as unknown as Journey

export default function JourneyBuildPlayground() {
  const [params] = useSearchParams()
  const live = (params.get('case') ?? 'live') !== 'draft'
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(CONDITION_FIELDS_KEY, SAMPLE_CATALOGUE)
    seeded.setQueryData(['journeys', 'j-sample', 'counts', 3], COUNTS)
    return seeded
  })
  const version = { id: 'jv-3', journey: 'j-sample', version_number: 3, status: live ? 'ACTIVE' : 'DRAFT', status_label: live ? 'Active' : 'Draft', published_at: live ? '2026-10-01T09:00:00Z' : null,
                    created_by: 'u1', created_at: '2026-10-01T09:00:00Z', updated_by: null, updated_at: '2026-10-01T09:00:00Z', row_version: 1, graph: GRAPH } as JourneyVersionDetail
  return (
    <QueryClientProvider client={client}>
      <JourneyBuildWorkspace journey={{ ...JOURNEY, status: live ? 'ACTIVE' : 'DRAFT' }} version={version} saving={false}
        onSave={async () => version} onSaveSetup={async () => version} />
    </QueryClientProvider>
  )
}
