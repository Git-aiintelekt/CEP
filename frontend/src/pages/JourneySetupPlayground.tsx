/** /dev/journey-setup (dev builds only): the journey Set-Up pop-up on sample data, nothing from the API.
 * ?case=weekly (default) | attribute | monthly | date — a Date / Time entry already filled in; match — the Customer
 * Attribute Matches trigger with Only Customers Where filters. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CONDITION_FIELDS_KEY } from '@/features/journeys/conditions/ConditionBuilder'
import { JourneySetupModal } from '@/features/journeys/JourneySetupModal'
import { SAMPLE_CATALOGUE } from '@/pages/ConditionPlayground'
import type { Audience, ContactList, Journey, JourneyDateAttribute, JourneyEntryRule, Page } from '@/lib/types'

const RULES: Record<string, Record<string, unknown>> = {
  weekly: { schedule: 'WEEKLY', time: '09:00', weekdays: ['MON'], contact_list_id: 'cl-vip', contact_list_name: 'VIP Customers' },
  attribute: { schedule: 'DATE_ATTRIBUTE', time: '10:00', attribute: 'birth_date', offset_days: -7, yearly: true, segment_id: 'seg-gold', segment_name: 'Gold and Platinum' },
  monthly: { schedule: 'MONTHLY', time: '18:30', day_of_month: 'LAST', segment_id: 'seg-gold', segment_name: 'Gold and Platinum' },
  date: { schedule: 'SPECIFIC_DATE', time: '08:00', date: '2026-12-24', contact_list_id: 'cl-vip', contact_list_name: 'VIP Customers' },
  match: { change_trigger: 'ATTRIBUTE_MATCH', rule: { all: true, conditions: [{ field: 'attr:customer_status', op: 'is', value: 'New' }] },
           filters: { all: true, conditions: [{ field: 'customer:country', op: 'is', value: 'United States' }, { field: 'attr:email_consent', op: 'is', value: 'Opted In' }] } },
}

const JOURNEY = {
  id: 'j-sample', name: 'Birthday Week Reward — Gold and Platinum', status: 'DRAFT', population_mode: 'CONTINUOUSLY_QUALIFYING', reentry_policy: 'AFTER_X_DAYS',
  reentry_after_days: 300,
} as unknown as Journey

export default function JourneySetupPlayground() {
  const [params] = useSearchParams()
  const sample = params.get('case') ?? 'weekly'
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(['journeys', 'date-attributes'], [
      { key: 'birth_date', label: 'Birth Date', customers: 18240 }, { key: 'membership_date', label: 'Membership Date', customers: 9120 },
    ] satisfies JourneyDateAttribute[])
    seeded.setQueryData(['contact-lists', 'journey-setup-options'], { count: 1, next: null, previous: null, results: [{ id: 'cl-vip', name: 'VIP Customers', source_type: 'UPLOAD' }] } as unknown as Page<ContactList>)
    seeded.setQueryData(['audiences', 'options'], [{ id: 'seg-gold', name: 'Gold and Platinum' }] as unknown as Audience[])
    seeded.setQueryData(CONDITION_FIELDS_KEY, SAMPLE_CATALOGUE)
    return seeded
  })
  const rule: JourneyEntryRule = { entry_type: sample === 'match' ? 'SEGMENT_CHANGE' : 'DATE_TIME', rule_definition: RULES[sample] ?? RULES.weekly }
  return (
    <QueryClientProvider client={client}>
      <JourneySetupModal key={sample} onClose={() => undefined}
        edit={{ journey: { ...JOURNEY, name: sample === 'weekly' ? 'Monday VIP Picks' : sample === 'match' ? 'New Customer Welcome — United States' : JOURNEY.name }, rule, published: false, onSave: async () => {} }} />
    </QueryClientProvider>
  )
}
