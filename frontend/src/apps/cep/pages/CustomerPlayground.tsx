/** /dev/customer (dev builds only): the app-gap screens on sample data, nothing from the API.
 * ?case=record (default) the customer page | search the Customers search | report the Journeys dataset | save-template the Save as Template pop-up */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CustomerPage } from '@/apps/cep/features/customers/CustomerPage'
import { CustomersPage } from '@/apps/cep/features/customers/CustomersPage'
import { JourneysReport } from '@/apps/cep/features/reports/JourneysReport'
import { SaveAsTemplateModal } from '@/apps/cep/features/journeys/templates/SaveAsTemplateModal'
import { PageHeader } from '@/components/ResourceList'
import type { CustomerRecord, CustomerSearchRow, Journey, JourneysReport as JourneysReportData } from '@/lib/types'

const ROWS: CustomerSearchRow[] = [
  { party_id: 'C-88213', name: 'Devon Okafor', email: 'devon@example.com', phone: '+1 415 555 0123', source_system: 'C360', synced_at: '2026-10-07T09:00:00Z' },
  { party_id: 'C-88290', name: 'Devika Rao', email: 'devika.rao@example.com', phone: null, source_system: 'UPLOAD', synced_at: '2026-09-20T09:00:00Z' },
]

const RECORD: CustomerRecord = {
  customer: { party_id: 'C-88213', first_name: 'Devon', last_name: 'Okafor', name: 'Devon Okafor', emails: [{ address: 'devon@example.com', is_primary: true, is_valid: true }],
              phones: [{ number: '+1 415 555 0123', type: 'MOBILE', is_primary: true }], primary_address: { line1: '18 Lakeside Way', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
              custom_attributes: { loyalty_tier: 'Gold', home_store: 'Lakeside Mall', timezone: 'America/Chicago', birth_date: '1988-04-12', lifetime_value: 2140.5 }, source_system: 'C360', synced_at: '2026-10-07T09:00:00Z' },
  consent: [{ channel: 'EMAIL', consent_status: 'OPTED_IN', marketable: true, marketable_reason: null, opted_in_at: '2026-03-02T14:00:00Z', opted_out_at: null, opt_out_method: null, suppressed: false, suppression_reason: null, updated_at: '2026-03-02T14:00:00Z' },
            { channel: 'SMS', consent_status: 'OPTED_OUT', marketable: false, marketable_reason: 'SMS_STOP', opted_in_at: '2026-03-02T14:00:00Z', opted_out_at: '2026-09-28T19:12:00Z', opt_out_method: 'SMS_STOP', suppressed: false, suppression_reason: null, updated_at: '2026-09-28T19:12:00Z' }],
  lists: [{ id: 'cl-1', name: 'VIP Customers', source_type: 'SEGMENT', membership_source: 'SEGMENT', added_at: '2026-08-02T09:00:00Z' }, { id: 'cl-2', name: 'Fall Launch Invitees', source_type: 'UPLOAD', membership_source: 'UPLOAD', added_at: '2026-09-10T09:00:00Z' }],
  events: [{ id: 3, event_type: 'PURCHASE', label: 'Purchase', source: 'ATTRIBUTION', event_id: 'W-100234', payload: { amount: 129.5, items: 2 }, occurred_at: '2026-10-04T14:30:00Z', received_at: '2026-10-04T14:30:04Z' },
           { id: 2, event_type: 'CART_ABANDON', label: 'Abandoned Cart', source: 'COMMERCE', event_id: 'cart-77812', payload: { cart_value: 84.5, items: 3 }, occurred_at: '2026-10-02T09:30:00Z', received_at: '2026-10-02T09:30:05Z' },
           { id: 1, event_type: 'CUSTOMER_CREATED', label: 'Customer Creation', source: 'C360', event_id: null, payload: {}, occurred_at: '2026-03-02T14:00:00Z', received_at: '2026-03-02T14:00:01Z' }],
  orders: [{ order_ref: 'W-100234', kind: 'ORDER', amount: 129.5, currency: 'USD', ordered_at: '2026-10-04T14:30:00Z', channel: 'ONLINE', status: 'ATTRIBUTED', campaign_id: 'c1', campaign_name: 'Fall Launch' },
           { order_ref: 'W-99120', kind: 'ORDER', amount: 46, currency: 'USD', ordered_at: '2026-08-14T11:05:00Z', channel: 'STORE', status: 'UNATTRIBUTED', campaign_id: null, campaign_name: null }],
  messages: [{ channel: 'EMAIL', campaign_id: 'c9', campaign_name: 'Welcome Series · Welcome 2026-10-03', journey_generated: true, status: 'CLICKED', status_reason: null, submitted_at: '2026-10-03T10:00:00Z', delivered_at: '2026-10-03T10:00:30Z', opened_at: '2026-10-03T11:02:00Z', clicked_at: '2026-10-03T11:03:00Z', at: '2026-10-03T10:00:00Z' },
             { channel: 'SMS', campaign_id: 'c7', campaign_name: 'Flash Sale Text', journey_generated: false, status: 'FAILED', status_reason: 'NO_CONSENT', submitted_at: null, delivered_at: null, opened_at: null, clicked_at: null, at: '2026-09-29T15:00:00Z' },
             { channel: 'EMAIL', campaign_id: 'c1', campaign_name: 'Fall Launch', journey_generated: false, status: 'OPENED', status_reason: null, submitted_at: '2026-09-15T10:00:00Z', delivered_at: '2026-09-15T10:00:20Z', opened_at: '2026-09-15T12:40:00Z', clicked_at: null, at: '2026-09-15T10:00:00Z' }],
  journeys: [{ enrollment_id: 'e-1', journey_id: 'j-sample', journey_name: 'Welcome Series — New Customers', journey_status: 'ACTIVE', version_number: 3, enrolled_at: '2026-10-02T14:14:00Z', status: 'ACTIVE', converted_at: null, attributed_revenue: null, exited_at: null, exit_reason: null,
               where: { node_key: 'wait-2', node_type: 'WAIT', label: 'Wait until 9:00 AM, their time', next_scheduled_at: '2026-10-09T14:00:00Z' } },
             { enrollment_id: 'e-0', journey_id: 'j-cart', journey_name: 'Abandoned Cart Recovery', journey_status: 'ACTIVE', version_number: 1, enrolled_at: '2026-10-02T09:30:00Z', status: 'COMPLETED', converted_at: '2026-10-04T14:30:00Z', attributed_revenue: 129.5, exited_at: '2026-10-04T14:30:00Z', exit_reason: 'Goal reached', where: null }],
  journey_suppressions: [{ journey_id: 'j-winback', journey_name: 'Win-Back Lapsed Customers', note: 'asked to be left out', created_at: '2026-09-01T09:00:00Z' }],
}

const counts = (entered: number, converted: number, revenue: number, sent: number, delivered: number, opened: number, clicked: number, held_back = 0, failed = 0) =>
  ({ entered, converted, revenue, sent, delivered, opened, clicked, bounced: Math.round(sent * 0.01), held_back, failed })
const rates = (row: { entered: number; converted: number; sent: number; delivered: number; opened: number; clicked: number }) => ({
  conversion: row.entered ? Math.round((row.converted / row.entered) * 1000) / 10 : null, delivery: row.sent ? Math.round((row.delivered / row.sent) * 1000) / 10 : null,
  open: row.delivered ? Math.round((row.opened / row.delivered) * 1000) / 10 : null, click: row.delivered ? Math.round((row.clicked / row.delivered) * 1000) / 10 : null,
})
const WELCOME = { id: 'j-sample', name: 'Welcome Series — New Customers', status: 'ACTIVE', population_mode: 'EVENT_TRIGGERED', ...counts(3412, 621, 41820.5, 9800, 9510, 4420, 1180, 214, 6) }
const CART = { id: 'j-cart', name: 'Abandoned Cart Recovery', status: 'ACTIVE', population_mode: 'EVENT_TRIGGERED', ...counts(1180, 236, 30212, 2900, 2840, 1530, 610, 48, 0) }
const WINBACK = { id: 'j-winback', name: 'Win-Back Lapsed Customers', status: 'PAUSED', population_mode: 'CONTINUOUSLY_QUALIFYING', ...counts(640, 31, 2480, 1900, 1810, 520, 90, 120, 2) }
const TOTALS = counts(5232, 888, 74512.5, 14600, 14160, 6470, 1880, 382, 8)
const DAYS = Array.from({ length: 30 }, (_, index) => {
  const day = `2026-09-${String(index + 1).padStart(2, '0')}`
  const weekend = [5, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())
  return { day, ...counts(weekend ? 90 + index * 2 : 160 + index * 3, weekend ? 12 : 28 + Math.round(index / 2), 0, 0, 0, 0, 0) }
})
const REPORT: JourneysReportData = {
  period: { from: '2026-09-01', to: '2026-09-30', timezone: 'America/New_York', days: 30 }, journey: null,
  journeys: [WELCOME, CART, WINBACK].map(({ id, name, status, population_mode }) => ({ id, name, status, population_mode })),
  totals: { ...TOTALS, journeys: 3 }, rates: rates(TOTALS), days: DAYS,
  by_journey: [WELCOME, CART, WINBACK].map((row) => ({ ...row, rates: rates(row) })), rows: [],
}

const JOURNEY = { id: 'j-sample', name: 'Welcome Series — New Customers', description: 'Three emails over the first two weeks, a coupon for the quiet ones.', status: 'ACTIVE', latest_version: 3 } as unknown as Journey

export default function CustomerPlayground() {
  const [params] = useSearchParams()
  const kind = params.get('case') ?? 'record'
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(['customers', 'C-88213'], RECORD)
    seeded.setQueryData(['customers', 'search', params.get('q') ?? 'dev', 1], { count: ROWS.length, page: 1, page_size: 25, results: ROWS })
    return seeded
  })
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen bg-surface px-8 py-6">
        {kind === 'search' && <CustomersPage />}
        {kind === 'record' && <CustomerPage partyId="C-88213" />}
        {kind === 'report' && (
          <section>
            <PageHeader title="Reports" description="1 Sep 2026 – 30 Sep 2026 · America/New_York" />
            <JourneysReport data={REPORT} />
          </section>
        )}
        {kind === 'save-template' && <SaveAsTemplateModal journey={JOURNEY} versionNumber={3} onClose={() => undefined} />}
      </div>
    </QueryClientProvider>
  )
}
