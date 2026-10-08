/** /dev/journey-timeline (dev builds only): the journey page's Customers card with a customer's timeline open, and the
 * builder's Preview Route panel, on sample data; nothing from the API. ?case=customers (default) | preview */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CustomersCard } from '@/features/journeys/CustomersCard'
import { PreviewRoutePanel } from '@/features/journeys/PreviewRoutePanel'
import type { JourneyCustomersPage, JourneyPreviewCustomer, JourneyPreviewRoute, JourneyTimeline } from '@/lib/types'

const ROWS: JourneyCustomersPage = {
  count: 3, page: 1, page_size: 25,
  results: [
    { id: 'enr-1', party_id: 'p-aaliyah', name: 'Aaliyah Brooks', email: 'aaliyah.brooks@example.com', enrolled_at: '2026-10-12T14:14:00Z', version_number: 3, status: 'ACTIVE', converted_at: null, attributed_revenue: null,
      exited_at: null, exit_reason: null, where: { node_key: 'wait-2', node_type: 'WAIT', label: 'Wait 3 days', entered_node_at: '2026-10-13T14:15:00Z', next_scheduled_at: '2026-10-16T14:15:00Z' } },
    { id: 'enr-2', party_id: 'p-marcus', name: 'Marcus Hale', email: 'marcus.hale@example.com', enrolled_at: '2026-10-11T09:00:00Z', version_number: 3, status: 'COMPLETED', converted_at: '2026-10-18T18:40:00Z', attributed_revenue: 86.4,
      exited_at: '2026-10-18T18:40:00Z', exit_reason: 'Goal reached', where: null },
    { id: 'enr-3', party_id: 'p-priya', name: 'Priya Natarajan', email: 'priya.n@example.com', enrolled_at: '2026-10-10T16:30:00Z', version_number: 2, status: 'EXITED', converted_at: null, attributed_revenue: null,
      exited_at: '2026-10-12T16:30:00Z', exit_reason: 'No date on the record', where: null },
  ],
}
const TIMELINE: JourneyTimeline = {
  id: 'enr-2', party_id: 'p-marcus', name: 'Marcus Hale', email: 'marcus.hale@example.com', attributes: {}, enrolled_at: '2026-10-12T14:14:00Z', entry: 'EVENT', version_number: 3,
  status: 'COMPLETED', converted_at: '2026-10-18T18:40:00Z', attributed_revenue: 86.4, exited_at: '2026-10-18T18:40:00Z', exit_reason: 'Goal reached', now: null,
  steps: [
    { at: '2026-10-12T14:14:00Z', node_key: 'start', node_type: 'START', label: 'Entered: Signed up', status: 'SUCCESS', result: { entry: 'EVENT' }, delivery: null },
    { at: '2026-10-13T14:14:00Z', node_key: 'wait-1', node_type: 'WAIT', label: 'Wait 1 day', status: 'SUCCESS', result: { waited_seconds: 86400 }, delivery: null },
    { at: '2026-10-13T14:15:00Z', node_key: 'email-1', node_type: 'EMAIL', label: 'Email: Welcome', status: 'SUCCESS', result: {},
      delivery: { channel: 'EMAIL', status: 'OPENED', status_reason: null, submitted_at: '2026-10-13T14:15:00Z', delivered_at: '2026-10-13T14:15:30Z', opened_at: '2026-10-13T22:02:00Z', clicked_at: null, bounced_at: null, responded_at: null, failed_at: null } },
    { at: '2026-10-16T14:15:00Z', node_key: 'wait-2', node_type: 'WAIT', label: 'Wait 3 days', status: 'SUCCESS', result: { waited_seconds: 259200 }, delivery: null },
    { at: '2026-10-16T14:15:00Z', node_key: 'cond-1', node_type: 'CONDITION', label: 'Worth a second email?', status: 'SUCCESS', result: { met: false, conditions: 4 }, delivery: null },
    { at: '2026-10-16T14:15:00Z', node_key: 'sms-1', node_type: 'SMS', label: 'SMS: Welcome gift', status: 'SKIPPED', result: { reason: 'QUIET_HOURS' }, delivery: null },
    { at: '2026-10-18T18:40:00Z', node_key: 'goal-1', node_type: 'GOAL', label: 'Goal: First purchase', status: 'SUCCESS', result: { reached: true, revenue: 86.4, while: 'in journey' }, delivery: null },
  ],
}
const ROUTE: JourneyPreviewRoute = {
  customer: { party_id: 'p-devon', name: 'Devon Okafor', email: 'devon@example.com', summary: 'Gold · Lakeside Mall', attributes: {} },
  entry: { outcome: 'Enters when a Welcome event arrives for them. The entry filters pass.', enters: true },
  steps: [
    { node_key: 'wait-1', node_type: 'WAIT', label: 'Wait 1 day', outcome: 'Continues Tue 13 Oct, 11:02', at: '2026-10-13T15:02:00Z', depends: false, assumed: null, branch: null },
    { node_key: 'email-1', node_type: 'EMAIL', label: 'Email: Welcome', outcome: 'Would send to devon@example.com: can receive marketing email. Frequency caps and quiet hours apply at send time.', at: '2026-10-13T15:02:00Z', depends: false, assumed: null, branch: null },
    { node_key: 'wait-2', node_type: 'WAIT', label: 'Wait 3 days', outcome: 'Continues Fri 16 Oct, 11:02', at: '2026-10-16T15:02:00Z', depends: false, assumed: null, branch: null },
    { node_key: 'cond-1', node_type: 'CONDITION', label: 'Worth a second email?', outcome: 'Depends on what has not happened yet in this journey: assuming No', at: '2026-10-16T15:02:00Z', depends: true, assumed: 'NO', branch: 'NO' },
    { node_key: 'goal-1', node_type: 'GOAL', label: 'Goal: Purchase within 14 days of entering', outcome: 'Not reached yet; the Not Yet path continues', at: '2026-10-16T15:02:00Z', depends: true, assumed: 'NO', branch: 'NO' },
    { node_key: 'wait-3', node_type: 'WAIT', label: 'Wait 4 days', outcome: 'Continues Tue 20 Oct, 11:02', at: '2026-10-20T15:02:00Z', depends: false, assumed: null, branch: null },
    { node_key: 'exit-1', node_type: 'EXIT', label: 'Exit journey', outcome: 'Would exit Tue 20 Oct as not converted', at: '2026-10-20T15:02:00Z', depends: false, assumed: null, branch: null },
  ],
}
const DEVON: JourneyPreviewCustomer = { party_id: 'p-devon', name: 'Devon Okafor', email: 'devon@example.com', summary: 'Gold · Lakeside Mall' }

export default function TimelinePlayground() {
  const [params] = useSearchParams()
  const sample = params.get('case') ?? 'customers'
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(['journeys', 'j-sample', 'customers', { q: '', status: '', page: 1 }], ROWS)
    seeded.setQueryData(['journeys', 'j-sample', 'customers', 'enr-2'], TIMELINE)
    seeded.setQueryData(['journeys', 'preview-customers', 'dev'], [DEVON])
    seeded.setQueryData(['journeys', 'j-sample', 'preview', 3, 'p-devon', {}], ROUTE)
    return seeded
  })
  return (
    <QueryClientProvider client={client}>
      {sample === 'preview' ? (
        <div className="flex h-screen justify-end bg-surface-subtle">
          <PreviewRoutePanel journeyId="j-sample" versionNumber={3} dirty={false} onClose={() => undefined} />
        </div>
      ) : (
        <div className="mx-auto max-w-4xl p-6">
          <CustomersCard journeyId="j-sample" published />
        </div>
      )}
    </QueryClientProvider>
  )
}
