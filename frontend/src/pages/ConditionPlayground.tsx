/** /dev/journey-condition (dev builds only): the Condition step's panel on sample data, nothing from the API.
 * ?case=busy (default) — the mixed condition with a nested group | sparse — one empty row | wait-time — a Wait until a
 * time of day | wait-date — a Wait until a date on the record | goal — a Goal step | split — a Split by an attribute | profile — Update Profile | webhook — a Webhook step. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CONDITION_FIELDS_KEY } from '@/features/journeys/conditions/ConditionBuilder'
import { normalizeRule } from '@/features/journeys/conditions/conditionModel'
import { NodeConfigPanel } from '@/features/journeys/NodeConfigPanel'
import type { ConditionCount, ConditionFieldCatalogue, ConditionRule, JourneyDateAttribute } from '@/lib/types'

export const SAMPLE_CATALOGUE: ConditionFieldCatalogue = {
  customer: [
    { key: 'customer:first_name', label: 'First Name', type: 'text' }, { key: 'customer:last_name', label: 'Last Name', type: 'text' },
    { key: 'customer:email', label: 'Email Address', type: 'text' }, { key: 'customer:country', label: 'Country', type: 'text' },
    { key: 'customer:city', label: 'City', type: 'text' }, { key: 'customer:synced_at', label: 'Record Updated', type: 'date' },
    { key: 'customer:last_purchase_at', label: 'Last Purchase Date', type: 'date' }, { key: 'customer:purchase_count', label: 'Number of Purchases', type: 'number' },
  ],
  attributes: [
    { key: 'attr:loyalty_tier', label: 'Loyalty Tier', type: 'text', customers: 18240, values: ['Silver', 'Gold', 'Platinum'] },
    { key: 'attr:customer_status', label: 'Customer Status', type: 'text', customers: 20100, values: ['New', 'Active', 'Lapsed'] },
    { key: 'attr:home_store', label: 'Home Store', type: 'text', customers: 16400, values: ['Lakeside Mall', 'Downtown', 'Airport', 'Online'] },
    { key: 'attr:email_consent', label: 'Email Consent', type: 'text', customers: 20100, values: ['Opted In', 'Opted Out'] },
    { key: 'attr:renewal_date', label: 'Renewal Date', type: 'date', customers: 9120, values: null },
    { key: 'attr:lifetime_value', label: 'Lifetime Value', type: 'number', customers: 20100, values: null },
    { key: 'attr:timezone', label: 'Timezone', type: 'text', customers: 11980, values: null },
  ],
  events: [
    { key: 'event:PURCHASE', label: 'Purchase', seen: 12400, properties: ['amount', 'store', 'category'] },
    { key: 'event:CART_ABANDON', label: 'Abandoned Cart', seen: 3100, properties: ['cart_value'] },
    { key: 'event:STORE_VISIT', label: 'Store Visit', seen: 840, properties: ['store'] },
    { key: 'event:COUPON_REDEEMED', label: 'Coupon Redemption', seen: 410, properties: ['coupon_code'] },
  ],
  lists: [{ key: 'list:cl-dnc', label: 'Do Not Contact' }, { key: 'list:cl-vip', label: 'VIP Customers' }],
  segments: [{ key: 'segment:seg-gold', label: 'Gold and Platinum' }, { key: 'segment:seg-lapsed', label: 'Lapsed Shoppers' }],
}

const BUSY: ConditionRule = {
  all: true,
  conditions: [
    { field: 'attr:loyalty_tier', op: 'in', value: ['Gold', 'Platinum'] },
    { field: 'customer:last_purchase_at', op: 'older_than_days', value: 90 },
    { field: 'message:email-welcome', op: 'delivered_not_opened' },
    { all: false, conditions: [{ field: 'list:cl-dnc', op: 'not_in' }, { field: 'event:STORE_VISIT', op: 'happened', days: 14, props: [{ key: 'store', op: 'is', value: 'Lakeside Mall' }] }] },
  ],
}
const STEPS = [{ key: 'email-welcome', label: 'Welcome', type: 'EMAIL' as const }, { key: 'cond-first', label: 'Bought before?', type: 'CONDITION' as const }]

export default function ConditionPlayground() {
  const [params] = useSearchParams()
  const sample = params.get('case') ?? 'busy'
  const config = sample === 'sparse' ? { rule: { all: true, conditions: [{ field: '', op: '' }] } }
    : sample === 'wait-time' ? { mode: 'TIME_OF_DAY', time: '09:00', zone: 'CUSTOMER', weekdays: [] }
    : sample === 'wait-date' ? { mode: 'DATE_ATTRIBUTE', attribute: 'renewal_date', offset_days: -3, time: '10:00', zone: 'CUSTOMER', if_passed: 'EXIT' }
    : sample === 'goal' ? { label: 'First purchase', event_type: 'PURCHASE', window_days: 14, when_reached: 'CONTINUE', props: [{ key: 'amount', op: 'gte', value: 25 }] }
    : sample === 'split' ? { by: 'ATTRIBUTE', attribute: 'home_store', paths: [{ key: 'P1', label: 'Lakeside Mall', values: ['Lakeside Mall'] }, { key: 'P2', label: 'Downtown or Airport', values: ['Downtown', 'Airport'] }] }
    : sample === 'profile' ? { attribute: 'customer_status', value: 'Welcomed' }
    : sample === 'webhook' ? { label: 'Tell the CRM', url: 'https://hooks.example.com/cep', secret_enc: 'stored', include_attributes: true }
    : { label: 'Worth a second email?', rule: BUSY }
  const type = sample.startsWith('wait') ? 'WAIT' as const : sample === 'goal' ? 'GOAL' as const : sample === 'split' ? 'SPLIT' as const : sample === 'profile' ? 'PROFILE_UPDATE' as const : sample === 'webhook' ? 'WEBHOOK' as const : 'CONDITION' as const
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(CONDITION_FIELDS_KEY, SAMPLE_CATALOGUE)
    seeded.setQueryData(['journeys', 'date-attributes'], [{ key: 'renewal_date', label: 'Renewal Date', customers: 9120 }, { key: 'birth_date', label: 'Birth Date', customers: 18240 }] satisfies JourneyDateAttribute[])
    const body = JSON.stringify({ rule: normalizeRule(BUSY, SAMPLE_CATALOGUE), filters: null })
    seeded.setQueryData(['journeys', 'condition-count', 'j-sample', body], { matching: 1284, total: 3412, sampled: false } satisfies ConditionCount)
    return seeded
  })
  return (
    <QueryClientProvider client={client}>
      <div className="flex h-screen justify-end bg-surface-subtle">
        <NodeConfigPanel key={sample} node={{ key: 'cond-second', type, config }} steps={STEPS} journeyId="j-sample"
          onClose={() => undefined} onSave={() => undefined} onDelete={() => undefined} />
      </div>
    </QueryClientProvider>
  )
}
