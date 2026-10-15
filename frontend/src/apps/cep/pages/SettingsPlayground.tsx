/** /dev/settings (dev builds only): the Settings menu panel beside a stand-in page, every feature on, nothing from the API; Set-Up and Attribution are the real pages on sample data. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, Route, Routes, useSearchParams } from 'react-router-dom'

import { SettingsMenuPanel } from '@/apps/cep/pages/settings/SettingsMenu'
import { WorkspaceSetupPage } from '@/apps/cep/pages/settings/WorkspaceSetupPage'
import { AttributionPage } from '@/apps/cep/pages/settings/AttributionPage'
import type { AttributedOrder, AttributionSettings } from '@/lib/types'
import { SETTINGS_GROUPS, pageAt } from '@/apps/cep/pages/settings/settingsCatalogue'

import { SAMPLE_SETUP } from '@/apps/cep/features/setup/sampleSetup'
import { SETUP_KEY } from '@/apps/cep/features/setup/setup'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { HELP_FOR_PAGE } from '@/apps/cep/help/chapters'

function StandIn({ path }: { path: string }) {
  const page = pageAt(path)
  const chapter = HELP_FOR_PAGE[path]
  const [params] = useSearchParams()
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <span className="flex items-center gap-1.5"><h2 className="font-display text-section-title font-semibold text-ink-900">{page?.label ?? 'Settings'}</h2>{chapter && <PageHelp chapter={chapter} initiallyOpen={params.get('help') === '1'} />}</span>
      <p className="mt-1 text-sm text-ink-800">The page itself is unchanged; this stand-in only shows where the menu puts it.</p>
    </div>
  )
}

/** the Set-Up page as it reads half way through: three steps done, the sender to verify next (Hide Until Later has no API here) */
function SampleSetup() {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(SETUP_KEY, SAMPLE_SETUP)
    return seeded
  })
  return <QueryClientProvider client={client}><WorkspaceSetupPage /></QueryClientProvider>
}

const order = (id: number, fields: Partial<AttributedOrder>): AttributedOrder => ({ id, source: 'API', order_id: `W-1002${40 - id}`, kind: 'ORDER', amount: 0, currency: 'USD', ordered_at: '2026-10-04T08:00:00Z',
  channel: 'ONLINE', store_number: null, party_id: null, email: null, phone: null, status: 'ATTRIBUTED', campaign_id: 'c1', campaign_name: 'Fall Launch: New Arrivals', touch_type: 'CLICK',
  touch_at: '2026-10-03T19:12:00Z', note: null, received_at: '2026-10-04T08:01:00Z', ...fields })

const SAMPLE_ORDERS: AttributedOrder[] = [
  order(1, { amount: 129.5, email: 'jane.doe@example.com', ordered_at: '2026-10-04T09:42:00Z' }),
  order(2, { amount: 64, email: 'sam.k@example.com', ordered_at: '2026-10-04T09:15:00Z', campaign_id: 'c2', campaign_name: 'Members Weekend', touch_type: 'CODE', touch_at: '2026-10-04T09:15:00Z' }),
  order(3, { amount: 212.4, source: 'POS', channel: 'STORE', store_number: '014', party_id: 'C-88213', ordered_at: '2026-10-04T08:51:00Z', touch_type: 'OPEN', touch_at: '2026-10-04T07:30:00Z' }),
  order(4, { amount: 48.9, email: 'new.buyer@example.com', ordered_at: '2026-10-04T08:20:00Z', status: 'UNATTRIBUTED', campaign_id: null, campaign_name: null, touch_type: null, touch_at: null,
             note: 'No campaign: no click within 7 days, open within 1 day or text within 1 day before the order.' }),
  order(5, { amount: -32, kind: 'REFUND', email: 'jane.doe@example.com', ordered_at: '2026-10-04T07:58:00Z', touch_type: 'REFUND' }),
  order(6, { amount: 89, email: 'pat@example.com', ordered_at: '2026-10-04T07:40:00Z', status: 'UNATTRIBUTED', campaign_id: null, campaign_name: null, touch_type: null, touch_at: null,
             note: 'No person: no customer id, and no email address or phone number C360 sent to.' }),
]

const SAMPLE_ATTRIBUTION: AttributionSettings = {
  enabled: true, enabled_at: '2026-09-02T10:00:00Z', click_days: 7, open_days: 1, text_days: 1, store_sales: true, email_cost_per_1000: 0.85, text_cost_per_1000: 7.5,
  choices: { click_days: [1, 3, 7, 14, 30], open_days: [0, 1, 2, 3, 7], text_days: [0, 1, 2, 3, 7] }, currency: 'USD', endpoint: 'https://cepdev.aiintelekt.com/api/v1/orders/',
  scope: 'orders:ingest', keys_with_scope: 1, store_sales_available: true,
  summary: { days: 30, orders: 3184, revenue: 284310, attributed_revenue: 121760, attributed_orders: 1288, attributed_share: 40.5, pending: 3, unattributed: 1896, last_received_at: new Date(Date.now() - 4 * 60_000).toISOString(),
             by_touch: { CODE: { orders: 214, revenue: 22410 }, CLICK: { orders: 812, revenue: 81240 }, OPEN: { orders: 191, revenue: 13180 }, TEXT: { orders: 71, revenue: 4930 } },
             top_campaigns: [{ id: 'c1', name: 'Fall Launch: New Arrivals', revenue: 46820, orders: 402 }, { id: 'c2', name: 'Members Weekend', revenue: 22410, orders: 214 },
                             { id: 'c3', name: 'Back in Stock: Denim', revenue: 18230, orders: 166 }, { id: 'c4', name: 'Win-Back 90 Days', revenue: 9740, orders: 101 }, { id: 'c5', name: 'Weekly Picks #40', revenue: 7310, orders: 88 }],
             store_orders: 1420 },
}

/** Attribution as an administrator sees it a month in: sample figures, no API (changes are not kept) */
function SampleAttribution() {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } } })
    seeded.setQueryData(['workspace', 'attribution'], SAMPLE_ATTRIBUTION)
    seeded.setQueryData(['workspace', 'attribution', 'orders', { status: '', q: '' }], { results: SAMPLE_ORDERS })
    return seeded
  })
  return <QueryClientProvider client={client}><AttributionPage canEdit /></QueryClientProvider>
}

export default function SettingsPlayground() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div><h1 className="font-display text-page-title font-semibold text-ink-900">Settings</h1><p className="mt-1 text-sm text-ink-800">The menu on sample data: every feature on.</p></div>
      <div className="flex min-w-0 flex-col gap-5 md:flex-row md:items-start">
        <SettingsMenuPanel has={() => true} base="/dev/settings" />
        <section aria-label="Settings page" className="min-w-0 flex-1">
          <Routes>
            <Route element={<Outlet />}>
              <Route path="setup" element={<SampleSetup />} />
              <Route path="attribution" element={<SampleAttribution />} />
              {SETTINGS_GROUPS.flatMap((group) => group.pages).filter((page) => page.to !== '/settings/setup' && page.to !== '/settings/attribution').map((page) => <Route key={page.to} path={page.to.replace('/settings/', '')} element={<StandIn path={page.to} />} />)}
              <Route index element={<StandIn path="/settings/users" />} />
            </Route>
          </Routes>
        </section>
      </div>
    </div>
  )
}
