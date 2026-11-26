/** /dev/settings (dev builds only): the Settings menu panel beside a stand-in page, every feature on, nothing from the API; Set-Up, Attribution, Sending Engines and Governance are the real pages on sample data. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, Route, Routes, useSearchParams } from 'react-router-dom'

import { SettingsMenuPanel } from '@/apps/cep/pages/settings/SettingsMenu'
import { WorkspaceSetupPage } from '@/apps/cep/pages/settings/WorkspaceSetupPage'
import { AttributionPage } from '@/apps/cep/pages/settings/AttributionPage'
import { DeliveryPage } from '@/apps/cep/pages/settings/DeliveryPage'
import { GovernancePage } from '@/apps/cep/pages/settings/GovernancePage'
import { CustomerAttributesPage } from '@/apps/cep/pages/settings/CustomerAttributesPage'
import { TagCheckCard } from '@/apps/cep/features/attributes/TagCheckCard'
import { TagValuesReview, TagValuesStep } from '@/apps/cep/features/contact-lists/TagValuesStep'
import { ATTRIBUTE_SOURCES, CUSTOMER_ATTRIBUTES, TAG_CHECK } from '@/apps/cep/features/attributes/sampleAttributes'
import { DOMAINS } from '@/apps/cep/pages/settings/sendingDomains'
import { UtmTrackingPage } from '@/apps/cep/pages/settings/UtmTrackingPage'
import { ReportDatabasesPage } from '@/apps/cep/pages/settings/ReportDatabasesPage'
import { MapDatasetPage } from '@/apps/cep/pages/settings/MapDatasetPage'
import { DATABASES_KEY } from '@/apps/cep/pages/settings/reportDatabases'
import type { ReportDatabase, SourceColumns, SourceList } from '@/apps/insights/types'
import { UTM_KEY } from '@/apps/cep/pages/settings/utm'
import { LinkTrackingRow } from '@/apps/cep/features/campaigns/wizard/LinkTrackingRow'
import type { ListImport, TagValueChoice, AttributedOrder, AttributionSettings, DeliveryProvider, DeliverySender, EngineHealth, EngineHealthCheck, GovernanceBlackout, GovernanceOverview, ProviderType, SendingDomains, UtmSettings } from '@/lib/types'
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

const SAMPLE_UTM: UtmSettings = {
  email: true, sms: true, domains: ['northwindapparel.com', 'shop.northwindapparel.com'], keep_existing: true, ready: true, short_base: 'https://cepdev.aiintelekt.com/api/v1/l/NWA',
  params: { utm_source: { kind: 'text', value: 'c360' }, utm_campaign: { kind: 'field', value: 'campaign_name' }, utm_id: { kind: 'field', value: 'campaign_code' },
    utm_content: { kind: 'field', value: 'link_label_variant' }, utm_term: { kind: 'none', value: '' }, utm_source_platform: { kind: 'text', value: 'c360' },
    utm_marketing_tactic: { kind: 'field', value: 'campaign_category' } },
  fields: [{ key: 'campaign_name', label: 'Campaign Name' }, { key: 'campaign_code', label: 'Campaign Code' }, { key: 'campaign_category', label: 'Campaign Type' },
    { key: 'channel', label: 'Channel' }, { key: 'link_label', label: 'Link Label' }, { key: 'link_label_variant', label: 'Link Label and A/B Variant' }],
  by_channel: { utm_medium: { EMAIL: 'email', SMS: 'sms' }, utm_creative_format: { EMAIL: 'email', SMS: 'text' } },
  parameters: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'utm_term', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic'],
}
/** Settings → UTM Tracking with both channels on, and the Content step's Link Tracking row; saving has no API here */
function SampleUtm() {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } } })
    seeded.setQueryData(UTM_KEY, SAMPLE_UTM)
    return seeded
  })
  return (
    <QueryClientProvider client={client}>
      <div className="space-y-8">
        <UtmTrackingPage />
        <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-ink-800">On the Campaign’s Content Step</p>
          <div className="overflow-hidden rounded-lg border border-line bg-surface"><LinkTrackingRow /></div></div>
      </div>
    </QueryClientProvider>
  )
}

/** Settings → Report Databases on sample data: a live production MySQL 5.7 database of 1,284 tables (CG-Prod), a warehouse and a
 * reporting copy, and Map a Dataset on CG-Prod with two pins and sales_lines' columns; saving has no API here */
const PLAYGROUND_DB = (over: Partial<ReportDatabase>): ReportDatabase => ({ id: 'db-1', name: 'CG-Prod', engine: 'mysql57', engine_name: 'MySQL 5.7', host: 'db.cg-retail.internal', port: 3306,
  database_name: 'shop', schema_name: 'shop', username: 'c360_reports', ssl_mode: 'REQUIRED', status: 'ACTIVE', last_tested_at: '2026-10-23T09:14:00Z', last_test_ok: true, last_test_error: null,
  read_only: true, server_version: '5.7.44', server_timezone: 'UTC', created_at: '2026-10-20T09:00:00Z', updated_at: '2026-10-23T09:14:00Z', row_version: 3, usable: true, datasets: [],
  limit_profile: 'LIVE', query_timeout_s: null, max_concurrent: null, limits: { timeout_s: 60, concurrent: 1 }, pinned_tables: ['sales_lines', 'v_daily_sales'], ...over })
const PREFIXES = ['sales_', 'inv_', 'pos_', 'cust_', 'rpt_', 'fin_']
const WORDS = ['lines', 'header', 'payments', 'returns', 'tax_lines', 'vouchers', 'stock', 'moves', 'counts', 'members', 'points', 'daily', 'weekly', 'ledger', 'budget', 'audit']
const PLAYGROUND_SOURCES: SourceList = {
  read_at: '2026-10-23T10:41:00Z', database: 'shop', pinned: ['sales_lines', 'v_daily_sales'],
  sources: [
    ...Array.from({ length: 96 }, (_, n) => ({ name: n === 0 ? 'v_daily_sales' : `v_${WORDS[n % WORDS.length]}_${n}`, kind: 'view' as const })),
    { name: 'sales_lines', kind: 'table' as const },
    ...Array.from({ length: 1187 }, (_, n) => ({ name: `${PREFIXES[n % PREFIXES.length]}${WORDS[n % WORDS.length]}_${n}`, kind: 'table' as const })),
  ].map((x) => ({ ...x, rows: null, columns: null, mappable: true, mapped_as: null })),
}
const PLAYGROUND_COLUMNS: SourceColumns = {
  source: 'sales_lines', rows: 412_000_000, mapped_as: null,
  columns: [
    { column: 'line_id', column_type: 'bigint', key: true, mappable: true, type: 'number', role: 'dimension', aggregates: [], format: 'integer' },
    { column: 'sale_day', column_type: 'date', key: false, mappable: true, type: 'date', role: 'dimension', aggregates: [], format: 'date' },
    { column: 'store_id', column_type: 'int', key: false, mappable: true, type: 'number', role: 'dimension', aggregates: [], format: 'integer' },
    { column: 'sku', column_type: 'varchar(32)', key: false, mappable: true, type: 'string', role: 'dimension', aggregates: [], format: null },
    { column: 'quantity', column_type: 'decimal(10,3)', key: false, mappable: true, type: 'number', role: 'measure', aggregates: ['sum', 'avg'], format: 'decimal' },
    { column: 'net_amount', column_type: 'decimal(12,2)', key: false, mappable: true, type: 'number', role: 'measure', aggregates: ['sum', 'avg'], format: 'money' },
  ],
  sample: { columns: ['line_id', 'sale_day', 'store_id', 'sku', 'quantity', 'net_amount'], rows: [[90412, '2026-10-22', 12, 'TS-0042', 2, 59.9]] },
}

function SampleReportDatabases({ map = false }: { map?: boolean }) {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } } })
    const cg = PLAYGROUND_DB({})
    seeded.setQueryData(DATABASES_KEY, { ready: true, limits_ready: true, workspace_limits: { timeout_s: 15, concurrent: 4 }, grant_examples: { mysql: "GRANT SELECT ON shop_reporting.* TO 'c360_reports'@'192.168.10.18';", postgresql: 'GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO c360_reports;' },
      databases: [cg,
        PLAYGROUND_DB({ id: 'db-2', name: 'Finance Warehouse', engine: 'postgresql', engine_name: 'PostgreSQL', host: 'dwh.internal', port: 5432, database_name: 'finance', schema_name: 'reporting', username: 'c360_read', server_version: '16.4', limit_profile: 'LARGE', limits: { timeout_s: 60, concurrent: 2 } }),
        PLAYGROUND_DB({ id: 'db-3', name: 'Loyalty Copy', engine: 'mysql80', engine_name: 'MySQL 8.0', host: 'loyalty-ro.internal', database_name: 'loyalty', schema_name: 'loyalty', server_version: '8.0.36', limit_profile: 'STANDARD', limits: { timeout_s: 15, concurrent: 4 } })] })
    seeded.setQueryData(['workspace', 'report-database', 'db-1'], cg)
    seeded.setQueryData(['workspace', 'report-database', 'db-1', 'sources'], PLAYGROUND_SOURCES)
    seeded.setQueryData(['workspace', 'report-database', 'db-1', 'source', 'sales_lines'], PLAYGROUND_COLUMNS)
    return seeded
  })
  return <QueryClientProvider client={client}>{map ? <Routes><Route path=":id/map" element={<MapDatasetPage />} /></Routes> : <ReportDatabasesPage />}</QueryClientProvider>
}

const SAMPLE_UPLOAD = {
  id: 'imp-1', contact_list: 'cl-new', list_name: 'Black Friday file', file_name: 'black-friday.csv', status: 'STAGED', working: false, row_count: 9810,
  columns: [{ name: 'Email', samples: ['maria.lopez@example.com'], guess: 'email' }, { name: 'First Name', samples: ['Maria'], guess: 'first_name' },
            { name: 'Store', samples: ['Atlanta Midtown'], guess: null }, { name: 'Coupon', samples: ['BF25-7Q2K'], guess: null }, { name: 'Party ID', samples: ['10045821'], guess: 'party_id' }],
  mapping: { email: 'Email', first_name: 'First Name', party_id: 'Party ID' },
  tag_values: { template_id: 'tpl-bf', template_name: 'Black Friday Reminder', tags: { first_name: { from: 'CUSTOMER' }, store_name: { from: 'FILE', column: 'Store' },
    offer_code: { from: 'FILE', column: 'Coupon' }, points_balance: { from: 'ATTRIBUTE', attribute: 'points_balance' }, tier_expiry: { from: 'DEFAULT' } },
    result: { ready: 9810, tags: { first_name: { with_value: 9810, sample: 'Maria' }, store_name: { with_value: 9802, sample: 'Atlanta Midtown' }, offer_code: { with_value: 9810, sample: 'BF25-7Q2K' },
      points_balance: { with_value: 9655, sample: '1240' }, tier_expiry: { with_value: 0, sample: null } } } },
} as unknown as ListImport

/** the upload's Tag Values step for a campaign's template, and the counts its review shows */
function SampleTagValues() {
  const [template, setTemplate] = useState('tpl-bf')
  const [choices, setChoices] = useState<Record<string, TagValueChoice>>({})
  return (
    <div className="mt-8 grid max-w-[880px] gap-6">
      <div className="rounded-lg border border-line bg-surface p-6">
        <TagValuesStep upload={SAMPLE_UPLOAD} mapping={SAMPLE_UPLOAD.mapping} channel="SMS" campaignTemplate="tpl-bf" template={template} onTemplate={setTemplate} choices={choices} onChoices={setChoices} />
      </div>
      <TagValuesReview job={SAMPLE_UPLOAD} />
    </div>
  )
}

/** Customer Attributes as CITI has them (?empty=1: a new workspace), the Tag Check card a campaign shows (?card=1), the upload's Tag Values (?step=1) */
function SampleCustomerAttributes() {
  const [params] = useSearchParams()
  const empty = params.get('empty') === '1'
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchInterval: false } } })
    seeded.setQueryData(['customer-attributes'], { available: true, attributes: empty ? [] : CUSTOMER_ATTRIBUTES, sources: empty ? 0 : ATTRIBUTE_SOURCES.length, can_edit: true })
    seeded.setQueryData(['customer-attributes', 'sources'], { available: true, sources: empty ? [] : ATTRIBUTE_SOURCES })
    seeded.setQueryData(['customer-attributes', 'databases'], { databases: [{ id: 'db-1', name: 'CITI OFBiz', engine: 'mysql80', database_name: 'ofbiz' }] })
    seeded.setQueryData(['customer-attributes', 'tables', 'db-1'], { tables: [{ name: 'LOYALTY_ACCOUNT', kind: 'table' }, { name: 'PARTY', kind: 'table' }] })
    seeded.setQueryData(['customer-attributes', 'columns', 'db-1', 'LOYALTY_ACCOUNT'], { columns: [{ name: 'PARTY_ID', type: 'string', key: true }, { name: 'POINTS_BALANCE', type: 'number', key: false }, { name: 'TIER_END_DATE', type: 'date', key: false }] })
    seeded.setQueryData(['customer-attributes', 'sample', 'db-1', 'LOYALTY_ACCOUNT', 'POINTS_BALANCE'], { sample: ['1240', '0', '18450'] })
    seeded.setQueryData(['customer-attributes', 'tag-check', 'tpl-short', 'cl-1', ''], TAG_CHECK)
    seeded.setQueryData(['customer-attributes', 'tag-check', 'tpl-full', 'cl-1', ''], { ...TAG_CHECK, short: 0, fillable: [], tags: TAG_CHECK.tags.map((tag) => ({ ...tag, with_value: 12480, missing: 0, from: 'LIST' })) })
    seeded.setQueryData(['templates', 'options', 'tag-values'], { results: [{ id: 'tpl-bf', name: 'Black Friday Reminder', channel: 'SMS', status: 'ACTIVE' }, { id: 'tpl-wb', name: 'Win-Back 2025', channel: 'SMS', status: 'ACTIVE' }] })
    seeded.setQueryData(['contact-lists', 'tag-options', 'imp-1', 'tpl-bf', JSON.stringify(SAMPLE_UPLOAD.mapping)], {
      template: { id: 'tpl-bf', name: 'Black Friday Reminder', channel: 'SMS' },
      tags: [
        { key: 'first_name', label: 'First Name', default: 'there', reads: 'CUSTOMER_MASTER', path: 'first_name', suggested: { from: 'CUSTOMER' }, chosen: null },
        { key: 'store_name', label: 'Store Name', default: 'your nearest store', reads: null, path: null, suggested: { from: 'FILE', column: 'Store' }, chosen: null },
        { key: 'offer_code', label: 'Offer Code', default: 'BF25', reads: 'CAMPAIGN_LIST_MEMBER', path: 'custom_value_pairs.offer_code', suggested: { from: 'DEFAULT' }, chosen: { from: 'FILE', column: 'Coupon' } },
        { key: 'points_balance', label: 'Points Balance', default: 'your', reads: 'CUSTOMER_ATTRIBUTE', path: 'points_balance', suggested: { from: 'ATTRIBUTE', attribute: 'points_balance' }, chosen: null },
        { key: 'tier_expiry', label: 'Tier Expiry', default: 'soon', reads: null, path: null, suggested: { from: 'ATTRIBUTE', attribute: 'tier_end' }, chosen: null },
      ],
      columns: [{ name: 'Store', sample: 'Atlanta Midtown' }, { name: 'Coupon', sample: 'BF25-7Q2K' }],
      attributes: [{ key: 'points_balance', label: 'Points Balance', source: 'CITI iCRM', kind: 'DATABASE', reads_database: true },
                   { key: 'tier_end', label: 'Tier End Date', source: 'CITI iCRM', kind: 'DATABASE', reads_database: true },
                   { key: 'last_online_order', label: 'Last Online Order', source: 'Shopify', kind: 'API', reads_database: false }],
    })
    return seeded
  })
  return (
    <QueryClientProvider client={client}>
      <CustomerAttributesPage />
      {params.get('card') === '1' && (
        <div className="mt-8 grid max-w-[760px] gap-6 sm:grid-cols-2">
          <TagCheckCard template="tpl-short" include={['cl-1']} exclude={[]} />
          <TagCheckCard template="tpl-full" include={['cl-1']} exclude={[]} />
        </div>
      )}
      {params.get('step') === '1' && <SampleTagValues />}
    </QueryClientProvider>
  )
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]
const blackoutDate = (id: string, name: string, from: string, to: string, rule: string, fields: Partial<GovernanceBlackout> = {}): GovernanceBlackout =>
  ({ id, name, from, to, yearly: true, rule, next: from, today: false, past: false, is_active: true, platform: false, row_version: 1, ...fields })

/** Governance as a retail workspace has it: the platform's caps, window and New Year locked, its own caps, gaps, windows and dates */
const SAMPLE_GOVERNANCE: GovernanceOverview = {
  caps: [
    { id: 'c1', name: 'Platform Standard: Email, 1 per Day', channel: 'EMAIL', channel_label: 'Email', max_messages: 1, period_days: 1, rule: '1 email per day', is_active: true, platform: true, row_version: 1 },
    { id: 'c2', name: '3 emails per 7 days', channel: 'EMAIL', channel_label: 'Email', max_messages: 3, period_days: 7, rule: '3 emails per 7 days', is_active: true, platform: false, row_version: 1 },
    { id: 'c3', name: '4 texts per 30 days', channel: 'SMS', channel_label: 'Text', max_messages: 4, period_days: 30, rule: '4 texts per 30 days', is_active: true, platform: false, row_version: 1 },
  ],
  gaps: [
    { channel: 'EMAIL', channel_label: 'Email', recommended_hours: 16, own: { id: 'g1', name: 'Gap', hours: 36, rule: '36 hours between emails', is_active: true, platform: false, row_version: 1 }, platform: [], covered_by: null },
    { channel: 'SMS', channel_label: 'Text', recommended_hours: 24, own: null, platform: [], covered_by: null },
    { channel: 'WHATSAPP', channel_label: 'WhatsApp', recommended_hours: 24, own: null, platform: [], covered_by: null },
  ],
  windows: [
    { channel: 'EMAIL', channel_label: 'Email', recommended: { start: '07:00', end: '21:00', days: EVERY_DAY },
      own: { id: 'w1', name: 'Window', start: '07:00', end: '21:00', days: EVERY_DAY, rule: 'Emails 07:00–21:00, every day', is_active: true, platform: false, row_version: 1 }, platform: [], quiet_hours: null },
    { channel: 'SMS', channel_label: 'Text', recommended: { start: '09:00', end: '20:00', days: EVERY_DAY }, own: null,
      platform: [{ id: 'w2', name: 'Platform Standard: Text Send Window', start: '08:00', end: '21:00', days: EVERY_DAY, rule: 'Texts 08:00–21:00, every day', is_active: true, platform: true, row_version: 1 }], quiet_hours: null },
    { channel: 'WHATSAPP', channel_label: 'WhatsApp', recommended: { start: '09:00', end: '20:00', days: EVERY_DAY }, own: null, platform: [], quiet_hours: null },
  ],
  blackouts: [
    blackoutDate('b1', 'Thanksgiving', '2026-11-26', '2026-11-26', '26 Nov 2026', { yearly: false }),
    blackoutDate('b2', 'Holidays', '2026-12-24', '2026-12-26', '24 Dec – 26 Dec, every year'),
    blackoutDate('b3', 'New Year', '2027-01-01', '2027-01-01', '1 Jan, every year', { platform: true }),
    blackoutDate('b4', 'Store System Change', '2027-02-08', '2027-02-09', '8 Feb – 9 Feb 2027', { yearly: false, is_active: false }),
    blackoutDate('b5', 'Day of Mourning', '2026-09-30', '2026-09-30', '30 Sep 2026', { yearly: false, next: null, past: true }),
  ],
  unengaged: {
    own: { id: 'u1', name: 'Unengaged Contacts', days: 180, min_emails: 5, rule: 'No engagement in 180 days, after at least 5 marketing emails', is_active: true, platform: false, row_version: 1 },
    platform: [{ id: 'u2', name: 'Platform Standard: Unengaged Contacts', days: 270, min_emails: 5, rule: 'No engagement in 270 days, after at least 5 marketing emails', is_active: true, platform: true, row_version: 1 }],
    applies: { days: 180, min_emails: 5 }, limit: { days: 270, min_emails: 5 }, recommended: { days: 180, min_emails: 5 },
    today: { total: 48210, engaged: 39880, unengaged: 2940, too_new: 5390, starts_on: null }, recent: { days: 30, left_out: 8420, came_back: 186 },
  },
  activity: { days: 30, checked: 212480, sent: 208654, capped: 1522, sent_percent: 98.2 },
  text_quiet_hours: null,
  soft_bounces: 3,
}

function SampleGovernance() {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(['workspace', 'governance'], SAMPLE_GOVERNANCE)
    return seeded
  })
  return <QueryClientProvider client={client}><GovernancePage canEdit /></QueryClientProvider>
}

export default function SettingsPlayground() {
  const [params] = useSearchParams()
  const components = params.get('components')?.split(',')                                          // ?components=insights: a workspace sold Insights alone
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div><h1 className="font-display text-page-title font-semibold text-ink-900">Settings</h1><p className="mt-1 text-sm text-ink-800">The menu on sample data: every feature on{components ? `, components ${components.join(' and ')}` : ', every component'}.</p></div>
      <div className="flex min-w-0 flex-col gap-5 md:flex-row md:items-start">
        <SettingsMenuPanel has={() => true} components={components} base="/dev/settings" />
        <section aria-label="Settings page" className="min-w-0 flex-1">
          <Routes>
            <Route element={<Outlet />}>
              <Route path="setup" element={<SampleSetup />} />
              <Route path="attribution" element={<SampleAttribution />} />
              <Route path="delivery" element={<SampleEngines />} />
              <Route path="utm-tracking" element={<SampleUtm />} />
              <Route path="governance" element={<SampleGovernance />} />
              <Route path="customer-attributes" element={<SampleCustomerAttributes />} />
              <Route path="report-databases" element={<SampleReportDatabases />} />
              <Route path="report-databases/*" element={<SampleReportDatabases map />} />
              {SETTINGS_GROUPS.flatMap((group) => group.pages).filter((page) => !['/settings/setup', '/settings/attribution', '/settings/delivery', '/settings/utm-tracking', '/settings/report-databases', '/settings/governance', '/settings/customer-attributes'].includes(page.to)).map((page) => <Route key={page.to} path={page.to.replace('/settings/', '')} element={<StandIn path={page.to} />} />)}
              <Route index element={<StandIn path="/settings/users" />} />
            </Route>
          </Routes>
        </section>
      </div>
    </div>
  )
}
