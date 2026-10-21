/** /dev/settings (dev builds only): the Settings menu panel beside a stand-in page, every feature on, nothing from the API; Set-Up, Attribution and Sending Engines are the real pages on sample data. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, Route, Routes, useSearchParams } from 'react-router-dom'

import { SettingsMenuPanel } from '@/apps/cep/pages/settings/SettingsMenu'
import { WorkspaceSetupPage } from '@/apps/cep/pages/settings/WorkspaceSetupPage'
import { AttributionPage } from '@/apps/cep/pages/settings/AttributionPage'
import { DeliveryPage } from '@/apps/cep/pages/settings/DeliveryPage'
import { DOMAINS } from '@/apps/cep/pages/settings/sendingDomains'
import type { AttributedOrder, AttributionSettings, DeliveryProvider, DeliverySender, EngineHealth, EngineHealthCheck, ProviderType, SendingDomains } from '@/lib/types'
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

const SAMPLE_DOMAINS: SendingDomains = {
  checked_at: '2026-10-21T06:00:00Z', ready: true, domains: [
    { domain: 'mail.northwindapparel.com', dkim_selector: null, checked_at: '2026-10-21T06:00:00Z',
      senders: [{ id: 's1', display_name: 'Northwind News', from_address: 'news@mail.northwindapparel.com' }, { id: 's2', display_name: 'Northwind Offers', from_address: 'offers@mail.northwindapparel.com' }],
      result: { lookup: 'OK', changes: 2, spf: { status: 'MISSING', found: [], publish: 'v=spf1 include:spf.emsb.lynxs.ai ~all' },
                dmarc: { status: 'MISSING', found: [], name: '_dmarc.mail.northwindapparel.com', publish: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@mail.northwindapparel.com' },
                dkim: { status: 'NOT_CHECKED', found: [], name: null } } },
    { domain: 'e.aiintelekt.com', dkim_selector: 'postal-Xa71Qd', checked_at: '2026-10-21T06:00:00Z', senders: [{ id: 's3', display_name: 'C360 Updates', from_address: 'hello@e.aiintelekt.com' }],
      result: { lookup: 'OK', changes: 1, spf: { status: 'PASS', found: ['v=spf1 include:spf.emsb.lynxs.ai ~all'] },
                dmarc: { status: 'MONITOR', found: ['v=DMARC1; p=none; rua=mailto:dmarc@aiintelekt.com'], name: '_dmarc.e.aiintelekt.com', publish: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@aiintelekt.com' },
                dkim: { status: 'PASS', found: ['v=DKIM1; k=rsa; p=MIIBIjANBgkq…'], name: 'postal-Xa71Qd._domainkey.e.aiintelekt.com' } } },
    { domain: 'northwindapparel.com', dkim_selector: null, checked_at: '2026-10-21T06:00:00Z', senders: [{ id: 's4', display_name: 'Receipts', from_address: 'receipts@northwindapparel.com' }],
      result: { lookup: 'OK', changes: 0, spf: { status: 'PASS', found: ['v=spf1 include:spf.emsb.lynxs.ai -all'] },
                dmarc: { status: 'PASS', found: ['v=DMARC1; p=reject'], name: '_dmarc.northwindapparel.com' }, dkim: { status: 'NOT_CHECKED', found: [] } } },
  ],
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const healthCheck = (key: EngineHealthCheck['key'], label: string, state: EngineHealthCheck['state'], value: string, summary: string, line = ''): EngineHealthCheck =>
  ({ key, label, state, value, summary, line, standing: false })
const engine = (id: string, fields: Partial<DeliveryProvider>): DeliveryProvider => ({ id, provider_type: 'POSTAL', channel: 'EMAIL', name: id, config: { endpoint: 'https://postal.nwa.example' },
  has_secret: true, secret_ref: null, rate_limit_per_minute: null, is_default: false, is_active: true, webhook_url: `https://cep.example/api/v1/webhooks/delivery/NWA/${id}/tok/`, sender_count: 1,
  last_checked_at: minutesAgo(500), last_check_ok: true, last_check_error: null, last_callback_at: minutesAgo(3), callbacks_24h: 260, row_version: 1, ...fields })
const health = (status: EngineHealth['status'], summary: string, checks: EngineHealthCheck[], standing = false): EngineHealth =>
  ({ status, summary, standing, checks, checked_at: minutesAgo(4), status_since: minutesAgo(130) })
const DAILY = healthCheck('daily_check', 'Daily Check', 'ok', 'Passed', '06:00: the key and address were accepted. Nothing was sent.', 'Runs once a day: key and address, nothing sent')
const SILENT = 'No callback for 2 h 10 min while 1,240 messages went out. Check that the engine still has its C360 callback address (Copy Webhook URL) and that it is switched on.'
const NO_RECEIPTS = 'Digivize has not sent delivery receipts yet, so texts show Sent, not Delivered (318 in the last day). This clears by itself with the first receipt.'

/** Sending Engines in the busy case: Postal's webhook went quiet, a healthy receipts engine, and Digivize, which has never sent a receipt */
const SAMPLE_ENGINES: DeliveryProvider[] = [
  engine('Postal Marketing', { is_default: true, last_callback_at: minutesAgo(130), callbacks_24h: 3410, health: health('FAILING', SILENT, [
    healthCheck('callbacks', 'Callbacks', 'failing', '2 h 10 min ago', SILENT, 'Failing after 60 min without a callback while messages go out'),
    healthCheck('refused', 'Refused Calls, 1 h', 'ok', '0.1%', '1 of 1,240 calls.', 'Attention above 1%; Failing at once if the key is refused'),
    healthCheck('speed', 'API Speed, 1 h', 'ok', '420 ms', '95% of calls were answered faster than this.', 'Attention above 5 s'),
    healthCheck('bounces', 'Bounces · Complaints, 24 h', 'ok', '0.4% · 0.01%', 'Of 9,860 sent in the last day.', 'Attention above 2% hard bounces or 0.1% complaints'), DAILY]) }),
  engine('Postal Receipts', { has_transactional_secret: true, health: health('HEALTHY', '', [
    healthCheck('callbacks', 'Callbacks', 'ok', '3 min ago', '260 in the last day.'), healthCheck('refused', 'Refused Calls, 1 h', 'ok', '0%', '0 of 88 calls.'),
    healthCheck('speed', 'API Speed, 1 h', 'ok', '310 ms', '95% of calls were answered faster than this.'), healthCheck('bounces', 'Bounces · Complaints, 24 h', 'ok', '0.2% · 0%', 'Of 412 sent in the last day.'), DAILY]) }),
  engine('Digivize', { provider_type: 'DIGIVIZE', channel: 'SMS', is_default: true, config: { endpoint: 'https://api.digivize.example' }, last_callback_at: null, callbacks_24h: 0, health: health('ATTENTION', NO_RECEIPTS, [
    healthCheck('callbacks', 'Callbacks', 'off', 'Never', 'See Receipts.'), healthCheck('refused', 'Refused Calls, 1 h', 'ok', '0%', '0 of 42 calls.'),
    healthCheck('speed', 'API Speed, 1 h', 'ok', '1.2 s', '95% of calls were answered faster than this.'), healthCheck('bounces', 'Failed Texts, 24 h', 'quiet', '—', 'No delivery receipts to judge.'),
    { ...healthCheck('receipts', 'Receipts', 'attention', 'None yet', NO_RECEIPTS), standing: true }, DAILY], true) }),
]
const SAMPLE_SENDERS: DeliverySender[] = [
  { id: 's1', delivery_provider: 'Postal Marketing', display_name: 'Northwind Apparel', channel: 'EMAIL', from_address: 'news@mail.nwa.example', reply_to_address: null, sender_id: null,
    verification_status: 'VERIFIED', is_default: true, provider_type: 'POSTAL', provider_name: 'Postal Marketing' },
  { id: 's2', delivery_provider: 'Digivize', display_name: 'Northwind texts', channel: 'SMS', from_address: null, reply_to_address: null, sender_id: '55123',
    verification_status: 'VERIFIED', is_default: true, provider_type: 'DIGIVIZE', provider_name: 'Digivize' },
]
const SAMPLE_CATALOGUE = [
  { provider_type: 'POSTAL', label: 'Postal', description: '', supports_webhooks: true, manageable: true, channel: 'EMAIL', fields: [] },
  { provider_type: 'DIGIVIZE', label: 'Digivize', description: '', supports_webhooks: true, manageable: true, channel: 'SMS', fields: [] },
] as unknown as ProviderType[]
const QUIET_ENGINE = engine('Postal', { is_default: true, last_callback_at: minutesAgo(2900), callbacks_24h: 0,
  health: health('QUIET', 'Nothing sent in the last day.', [healthCheck('callbacks', 'Callbacks', 'quiet', '2 days ago', 'Nothing sent in the last day.'), DAILY]) })

/** Settings → Delivery as an administrator sees it: engines with their health, senders and sending domains on sample data, no API (?sparse=1: one quiet engine) */
function SampleEngines() {
  const [params] = useSearchParams()
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } } })
    const sparse = params.get('sparse') === '1'
    seeded.setQueryData(['delivery', 'providers'], sparse ? [QUIET_ENGINE] : SAMPLE_ENGINES)
    seeded.setQueryData(['delivery', 'providers', 'catalogue'], SAMPLE_CATALOGUE)
    seeded.setQueryData(['delivery', 'senders'], sparse ? SAMPLE_SENDERS.slice(0, 1) : SAMPLE_SENDERS)
    seeded.setQueryData(DOMAINS, sparse ? { ...SAMPLE_DOMAINS, domains: SAMPLE_DOMAINS.domains.slice(2) } : SAMPLE_DOMAINS)
    seeded.setQueryData(['deliverability', 'service'], { configured: false, provider: 'MAILGUN', region: 'US', username: '', has_api_key: false, default_clients: [], image_blocking: false,
      is_active: false, last_checked_at: null, last_check_ok: null, last_check_error: null, uses: 'PLATFORM', platform_available: true })
    seeded.setQueryData(['deliverability', 'allowance'], { enabled: true, used: 4, limit: 50, left: 46, month: '2026-10', plan: 'GROWTH', configured: true })
    return seeded
  })
  return <QueryClientProvider client={client}><DeliveryPage canEdit /></QueryClientProvider>
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
              <Route path="delivery" element={<SampleEngines />} />
              {SETTINGS_GROUPS.flatMap((group) => group.pages).filter((page) => !['/settings/setup', '/settings/attribution', '/settings/delivery'].includes(page.to)).map((page) => <Route key={page.to} path={page.to.replace('/settings/', '')} element={<StandIn path={page.to} />} />)}
              <Route index element={<StandIn path="/settings/users" />} />
            </Route>
          </Routes>
        </section>
      </div>
    </div>
  )
}
