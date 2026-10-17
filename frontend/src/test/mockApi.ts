/** In-memory stand-in for the C360 API used by the component tests. */
import type { Dashboard as InsightsDashboard } from '@/apps/insights/types'
import { vi } from 'vitest'

import { derived, handleCampaigns, listCampaigns, makeStep, moduleDefaults } from './mockCampaigns'
import { starterFromTemplate } from '@/apps/cep/features/journeys/templates/templateApi'

import { handleWorkspaceTools, workspaceToolsState, type WorkspaceToolsState } from './mockWorkspaceTools'
import { defaultSectionsFor } from '@/apps/cep/features/receipt/receiptPresets'
import { RECEIPT_STARTER_MJML } from '@/apps/cep/features/receipt/receiptStarter'

import { SAMPLE_SETUP_READY } from '@/apps/cep/features/setup/sampleSetup'
import type { AttributedOrder, DripStep, AttributionSettings, EventsSettings, JourneyEventRow, WorkspaceSetup, CampaignRunVariant, ApiKey, Audience, AuthOptions, Campaign, CampaignActivity, CampaignAudience, CampaignMetrics, ContactList, DeliverabilityService, DeliverabilityTest, FieldRule, FieldRules, InspectClient, Design, GovernanceLine, Integration, IntegrationLogDetail, ListImport, ListMember, UploadSummary, DeliveryProvider, DeliverySender, Invoice, MailServerSettings, Me, MediaAsset, Message, PersonalizationTag, ProviderType, ReceiptLayout, Role, RunResults, Journey, JourneyActivityEntry, JourneyAudience, JourneyGeneratedCampaignRow, JourneyGraph, JourneyMetrics, JourneyReadiness, JourneyAttentionRow, JourneyStarter, JourneySuppression, JourneyTemplate, CustomerRecord, CustomerSearchRow, JourneyTestResult, JourneyTrendWeek, JourneyVersion, JourneyVersionDetail,
              RunRecipient, RunSkippedPerson, SecuritySettings, SenderProfile, SettingsUser, SmsReply, SupportAccess, Template, TemplateStarter, Usage, Workspace } from '@/lib/types'

export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

export { makeStep }

const audit = { tenant: 't1', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', row_version: 1 }

export const me = {
  principal: { kind: 'user', id: 'u1', email: 'aby.john@aiintelekt.com', display_name: 'Aby John', is_platform_admin: false, roles: ['Marketing Admin'],
               permissions: ['campaign.view', 'campaign.edit', 'campaign.publish', 'template.edit', 'provider.edit', 'user.admin', 'list.view', 'list.edit', 'list.import', 'report.view', 'consent.edit',
                             'journey.view', 'journey.edit', 'journey.activate', 'journey.export', 'journey.suppress'] },
  tenant: { id: 't1', code: 'NWA', timezone: 'America/New_York', db_alias: 'default', db_status: 'ACTIVE' },
  workspace: { name: 'Northwind Apparel', plan: { code: 'GROWTH', name: 'Growth' } },
  components: [{ key: 'cep', name: 'Engagement', tagline: 'Customer Engagement', access: 'PLAN', until: null }],
  session: { idle_timeout_minutes: 120, idle_warning_seconds: 60 },
}

/** Insights (apps/insights): the catalogue, a saved report and a run's result the tests see */
export const insightsCatalog = {
  engine: { engine: 'postgresql', status: 'ACTIVE', freshness_sla: 'LIVE', limits: { statement_timeout_ms: 15000, preview_rows: 200, run_rows: 5000, export_rows: 100000, concurrent: 4 } },
  datasets: [
    { key: 'messages', label: 'Messages', description: 'Every email and text a campaign sent', component: { key: 'cep', name: 'Engagement' }, primary_key: 'message_id', time_field: 'submitted_at', freshness: 'LIVE',
      fields: [
        { key: 'campaign_name', label: 'Campaign', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'contains'], buckets: [], format: null, sensitivity: 'NORMAL' },
        { key: 'channel', label: 'Channel', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' },
        { key: 'submitted_at', label: 'Sent', type: 'datetime', role: 'dimension', aggregates: [], operators: ['between', 'last_days'], buckets: ['day', 'week', 'month'], format: 'datetime', sensitivity: 'NORMAL' },
        { key: 'sent', label: 'Sent Count', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
        { key: 'delivered', label: 'Delivered Count', type: 'number', role: 'measure', aggregates: ['sum'], operators: ['>', '>='], buckets: [], format: 'integer', sensitivity: 'NORMAL' },
        { key: 'delivered_rate', label: 'Delivered Rate', type: 'number', role: 'measure', aggregates: ['calc'], operators: [], buckets: [], format: 'percent', sensitivity: 'NORMAL',
          formula: { op: 'ratio', left: { field: 'delivered', aggregate: 'sum' }, right: { field: 'sent', aggregate: 'sum' }, scale: 100 } },
      ] },
    { key: 'attributed_orders', label: 'Attributed Orders', description: 'Orders the shop reported', component: { key: 'cep', name: 'Engagement' }, primary_key: 'order_id', time_field: 'ordered_at', freshness: 'LIVE',
      fields: [
        { key: 'campaign_name', label: 'Credited To', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!='], buckets: [], format: null, sensitivity: 'NORMAL' },
        { key: 'amount', label: 'Amount', type: 'number', role: 'measure', aggregates: ['sum', 'avg'], operators: ['>'], buckets: [], format: 'money', sensitivity: 'NORMAL' },
      ] },
  ],
}
export const insightsSummary = { id: 'rep-1', name: 'Sends by campaign', description: null, dataset: 'messages', dataset_label: 'Messages', component: { key: 'cep', name: 'Engagement' }, view_type: 'grid' as const,
  visibility: 'WORKSPACE' as const, version: 2, owner_user_id: 'u1', owner_name: 'Aby John', last_run_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T08:00:00Z', can_edit: true,
  folder_id: null as string | null, folder_name: null as string | null, favourite: false }
export const insightsFolders: { id: string; name: string; owner_user_id: string; reports: number; row_version: number; updated_at: string }[] = []
/** the report schedules (apps/insights/schedules) */
export const insightsSchedulesNow: InsightsSchedule[] = []
type InsightsSchedule = import('@/apps/insights/types').Schedule
function scheduleWords(every: string, onDay: number | null, at: string): string {
  if (every === 'week') return `Every ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][(onDay ?? 1) - 1]} at ${at}`
  if (every === 'month') return `Monthly on the ${onDay}th at ${at}`
  return `Every ${every === 'weekday' ? 'weekday' : 'day'} at ${at}`
}
/** this person's stars, as "kind:id" */
export const insightsFavourites = new Set<string>()
/** AI · Ask for a Report (apps/insights/assistant): what the box offers, and the replies a prompt gets */
const assistantModels = [
  { id: 'anthropic:claude-sonnet-5-5', provider: 'anthropic', provider_name: 'Claude (Anthropic)', mark: 'A', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Best for reports' },
  { id: 'anthropic:claude-haiku-5-5', provider: 'anthropic', provider_name: 'Claude (Anthropic)', mark: 'A', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest' },
  { id: 'openai:gpt-5', provider: 'openai', provider_name: 'OpenAI', mark: 'O', model: 'gpt-5', label: 'GPT-5', note: 'Best for reports' },
  { id: 'openai:gpt-5-mini', provider: 'openai', provider_name: 'OpenAI', mark: 'O', model: 'gpt-5-mini', label: 'GPT-5 mini', note: 'Fastest' },
]
export const insightsAssistantNow = { enabled: true, reason: null as string | null, models: assistantModels, default_model: 'anthropic:claude-sonnet-5-5',
  usage: { used: 38, limit: 200, month: '2026-10-01', plan: 'Growth', words: '38 of 200 prompts used in October' },
  examples: ['Which campaigns made the most revenue last month?', 'Delivered rate by sending engine, by week'], recent: [] as unknown[] }
type OwnKey = { configured: boolean; model_reports: string | null; model_fast: string | null; last_checked_at: string | null; last_check_ok: boolean | null; last_check_error: string | null } | null
const assistantProviders = () => [
  { key: 'anthropic', name: 'Claude (Anthropic)', mark: 'A', keys: 'console.anthropic.com → API Keys', platform: true, platform_models: ['Claude Sonnet 5.5', 'Claude Haiku 5.5'], own: null as OwnKey, default_models: ['claude-sonnet-5-5', 'claude-haiku-5-5'] },
  { key: 'openai', name: 'OpenAI', mark: 'O', keys: 'platform.openai.com → API Keys', platform: true, platform_models: ['GPT-5', 'GPT-5 mini'], own: null as OwnKey, default_models: ['gpt-5', 'gpt-5-mini'] },
]
export const workspaceAssistantNow = { enabled: true, providers: { anthropic: true, openai: true }, explain: true, available: assistantProviders(),
  explain_allowed: true, usage: { used: 38, limit: 200, month: '2026-10-01', plan: 'Growth' }, retention_days: 90 }
function assistantReply(prompt: string, modelId: string) {
  const model = assistantModels.find((m) => m.id === modelId) ?? assistantModels[0]
  const base = { prompt, model: { id: model.id, provider: model.provider, provider_name: model.provider_name, mark: model.mark, model: model.model, label: model.label }, duration_ms: 3200, message: null }
  if (/last month\?/.test(prompt)) {
    return { ...base, id: 'ask-q', kind: 'question', counted: false, question: 'Which period is last month?',
      answers: [{ label: 'September 2026, the calendar month', prompt: 'Revenue by campaign for September 2026' }, { label: 'The last 30 days', prompt: 'Revenue by campaign for the last 30 days' }], usage: insightsAssistantNow.usage }
  }
  if (/website visits/i.test(prompt)) {
    return { ...base, id: 'ask-n', kind: 'no_field', counted: false, message: 'No dataset has website visits. The closest fields are Delivered Count (Messages) and Amount (Attributed Orders).',
      suggestions: [{ label: 'Clicks by Campaign', prompt: 'Delivered count by campaign for September' }], usage: insightsAssistantNow.usage }
  }
  insightsAssistantNow.usage = { ...insightsAssistantNow.usage, used: insightsAssistantNow.usage.used + 1, words: `${insightsAssistantNow.usage.used + 1} of 200 prompts used in October` }
  return { ...base, id: 'ask-1', kind: 'draft', counted: true, name: 'Sent and Delivered by Campaign', dataset: 'messages', dataset_label: 'Messages', view: { type: 'grid' },
    definition: { columns: [{ field: 'campaign_name' }, { field: 'sent', aggregate: 'sum' }, { field: 'delivered', aggregate: 'sum' }],
      filters: { combinator: 'and', rules: [{ field: 'submitted_at', operator: 'between', value: ['2026-09-01', '2026-09-30'] }] }, orderBy: [{ field: 'sent', direction: 'desc' }], limit: 500 },
    preview: { rows: 12, more: false }, usage: insightsAssistantNow.usage }
}
/** Settings → Report Databases (apps/insights/databases): the workspace's own databases and the datasets mapped from them */
type MockDatabase = import('@/apps/insights/types').ReportDatabase
type MockDataset = import('@/apps/insights/types').ReportDataset
export const reportDatabasesNow: MockDatabase[] = []
export const reportDatasetsNow: MockDataset[] = []
const GRANTS = { mysql: "CREATE USER 'cep_reader'@'%' IDENTIFIED BY '…';\nGRANT SELECT ON your_db.* TO 'cep_reader'@'%';", postgresql: "CREATE ROLE cep_reader LOGIN PASSWORD '…';\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO cep_reader;" }
const GOOD_TEST = { ok: true, version: '8.0.36', timezone: 'UTC', tables: 14, views: 6, read_only: true, offending: [] as string[], ms: 48, error: null }
const WRITER_TEST = { ok: true, version: '8.0.31', timezone: 'UTC', tables: 31, views: 0, read_only: false, offending: ['INSERT, UPDATE on `loyalty`.*'], ms: 92, error: null }
function mockDatabase(body: Record<string, unknown>, id: string): MockDatabase {
  const engine = (body.engine as MockDatabase['engine']) ?? 'mysql80'
  const test = String(body.host).includes('loyalty') ? WRITER_TEST : GOOD_TEST
  return { id, name: String(body.name), engine, engine_name: engine === 'postgresql' ? 'PostgreSQL' : engine === 'mysql57' ? 'MySQL 5.7' : 'MySQL 8.0', host: String(body.host), port: Number(body.port ?? (engine === 'postgresql' ? 5432 : 3306)),
    database_name: String(body.database), schema_name: String(body.schema ?? 'public'), username: String(body.username), ssl_mode: (body.ssl as MockDatabase['ssl_mode']) ?? 'REQUIRED', status: 'ACTIVE',
    last_tested_at: '2026-10-16T09:12:00Z', last_test_ok: test.read_only, last_test_error: test.read_only ? null : 'The account can write: ' + test.offending.join('; '), read_only: test.read_only, server_version: test.version,
    server_timezone: test.timezone, created_at: '2026-10-16T09:12:00Z', updated_at: '2026-10-16T09:12:00Z', row_version: 1, usable: test.read_only, datasets: [], test }
}
const SOURCES = [{ name: 'v_daily_sales', kind: 'view' as const, rows: null, columns: 5, mappable: true, mapped_as: null }, { name: 'sales_lines', kind: 'table' as const, rows: 4200000, columns: 18, mappable: true, mapped_as: null },
  { name: 'stores', kind: 'table' as const, rows: 1204, columns: 3, mappable: true, mapped_as: null }]
const COLUMNS = [
  { column: 'sale_day', column_type: 'date', key: false, mappable: true, type: 'date' as const, role: 'dimension' as const, aggregates: [], format: 'date' as const },
  { column: 'store_name', column_type: 'varchar(80)', key: false, mappable: true, type: 'string' as const, role: 'dimension' as const, aggregates: [], format: null },
  { column: 'net_sales', column_type: 'decimal(12,2)', key: false, mappable: true, type: 'number' as const, role: 'measure' as const, aggregates: ['sum' as const, 'avg' as const], format: 'money' as const },
  { column: 'cashier_email', column_type: 'varchar(120)', key: false, mappable: true, type: 'string' as const, role: 'dimension' as const, aggregates: [], format: null },
  { column: 'store_id', column_type: 'int', key: false, mappable: true, type: 'number' as const, role: 'dimension' as const, aggregates: [], format: 'integer' as const },
]
const STORE_COLUMNS = [
  { column: 'id', column_type: 'int', key: true, mappable: true, type: 'number' as const, role: 'dimension' as const, aggregates: [], format: 'integer' as const },
  { column: 'name', column_type: 'varchar(80)', key: false, mappable: true, type: 'string' as const, role: 'dimension' as const, aggregates: [], format: null },
  { column: 'city', column_type: 'varchar(80)', key: false, mappable: true, type: 'string' as const, role: 'dimension' as const, aggregates: [], format: null },
]
export const insightsReport = { ...insightsSummary, row_version: 3, folder_id: null, created_at: '2026-10-14T08:00:00Z',
  definition: { columns: [{ field: 'campaign_name' }, { field: 'channel' }, { field: 'sent', aggregate: 'sum' as const }, { field: 'delivered', aggregate: 'sum' as const }], filters: { combinator: 'and' as const, rules: [] }, orderBy: [{ field: 'sent', direction: 'desc' as const }], limit: 500 } }
export const insightsReportsNow: (typeof insightsSummary)[] = [insightsSummary]
export const insightsResult = {
  columns: [{ key: 'campaign_name', label: 'Campaign', type: 'string', format: null }, { key: 'channel', label: 'Channel', type: 'string', format: null },
            { key: 'sent', label: 'Sent Count', type: 'number', format: 'integer', aggregate: 'sum' }, { key: 'delivered', label: 'Delivered Count', type: 'number', format: 'integer', aggregate: 'sum' }],
  rows: [['Fall Launch', 'EMAIL', 142300, 139104], ['Weekend Flash Sale', 'SMS', 25100, 24871], ['Weekly Newsletter', 'EMAIL', 201500, 198002]],
  row_count: 3, duration_ms: 42, truncated: false, offset: 0, limit: 500, freshness: 'LIVE', cached: false,
}
/** a dashboard (apps/insights/dashboards): rows of tiles over the saved report */
export const insightsDashboard: InsightsDashboard = {
  id: 'dash-1', name: 'Marketing Weekly', description: 'Sends, revenue and the top campaigns, by week', visibility: 'WORKSPACE' as const, period: { preset: '30d' as const }, compare: true,
  layout: { rows: [{ width: '2-1' as const, tiles: [{ id: 't1', report_id: 'rep-1', show: 'chart' as const, title: 'Sends by Campaign' }, { id: 't2', report_id: 'rep-1', show: 'figure' as const, measure: 'sent' }] }],
            slicers: [{ field: 'channel', label: 'Channel' }] },
  version: 2, row_version: 2, owner_user_id: 'u1', owner_name: 'Aby John', created_at: '2026-10-14T08:00:00Z', updated_at: '2026-10-15T09:12:00Z', can_edit: true,
  bounds: { from: '2026-09-16', to: '2026-10-15', previous_from: '2026-08-17', previous_to: '2026-09-15' },
}
export const insightsDashboardsNow: InsightsDashboard[] = [insightsDashboard]
const BOUNDS_7D = { from: '2026-10-09', to: '2026-10-15', previous_from: '2026-10-02', previous_to: '2026-10-08' }

/** the engine's totals for a view, summed from the rows (the mock's engine): hierarchy prefixes, or the pivot's rows, columns and the whole */
function mockTotals(result: typeof insightsResult, view?: { type?: string; across?: string }) {
  const dims = result.columns.map((c, i) => ({ c, i })).filter(({ c }) => !('aggregate' in c))
  const meas = result.columns.map((c, i) => ({ c, i })).filter(({ c }) => 'aggregate' in c)
  let sets: string[][] | null = null
  if (view?.type === 'hierarchy' && dims.length >= 2) sets = dims.map((_, n) => dims.slice(0, n).map(({ c }) => c.key))
  if (view?.type === 'pivot' && view.across && dims.some(({ c }) => c.key === view.across) && dims.length >= 2) sets = [[], dims.filter(({ c }) => c.key !== view.across).map(({ c }) => c.key), [view.across]]
  if (!sets) return {}
  const totals: { keys: Record<string, unknown>; values: number[] }[] = []
  for (const set of sets) {
    const groups = new Map<string, { keys: Record<string, unknown>; values: number[] }>()
    for (const row of result.rows) {
      const keys = Object.fromEntries(set.map((key) => [key, row[dims.find(({ c }) => c.key === key)!.i]]))
      const id = JSON.stringify(keys)
      const group = groups.get(id) ?? { keys, values: meas.map(() => 0) }
      meas.forEach(({ i }, m) => { group.values[m] += Number(row[i] ?? 0) })
      groups.set(id, group)
    }
    totals.push(...groups.values())
  }
  return { totals }
}

/** the same saved report run by a reader without the right to personal data: the Customer column comes back masked */
export const insightsMaskedResult = {
  ...insightsResult,
  columns: [{ key: 'party_id', label: 'Customer', type: 'string', format: null, masked: true }, ...insightsResult.columns.slice(1)],
  rows: insightsResult.rows.map((row) => ['•••••', ...row.slice(1)]),
}

export const templates: Template[] = [
  { ...audit, id: 'tpl-email', name: 'Fall Email', description: null, channel: 'EMAIL', status: 'ACTIVE', cloned_from: null, last_used_in: { id: 'c1', name: 'Fall Launch', status: 'ACTIVE', at: '2026-09-10T10:00:00Z' }, campaign_count: 2 },
  { ...audit, id: 'tpl-sms', name: 'Fall SMS', description: null, channel: 'SMS', status: 'ACTIVE', cloned_from: null },
  { ...audit, id: 'tpl-old', name: 'Retired Email', description: null, channel: 'EMAIL', status: 'ARCHIVED', cloned_from: null },
  { ...audit, id: 'tpl-receipt', name: 'Northline order receipt', description: null, channel: 'E_RECEIPT', status: 'ACTIVE', cloned_from: null },
]

/** the people one drip message left out (GET /campaign-runs/{id}/skipped/) */
export const skippedPeople: RunSkippedPerson[] = [
  { party_id: 'P-11', first_name: 'Jordan', last_name: 'Lee', address: 'jordan.lee@example.com', reason: 'FREQUENCY_CAP' },
  { party_id: 'P-12', first_name: 'Priya', last_name: 'Shah', address: 'priya.shah@example.com', reason: 'FREQUENCY_CAP' },
  { party_id: 'P-13', first_name: 'Sam', last_name: 'Ortiz', address: 'sam.ortiz@example.com', reason: 'UNSUBSCRIBED' },
]

export const senders: SenderProfile[] = [
  { id: 'snd-email', display_name: 'Northwind Rewards', channel: 'EMAIL', from_address: 'rewards@northwind.example', reply_to_address: null, sender_id: null, verification_status: 'VERIFIED', is_default: true },
  { id: 'snd-sms', display_name: 'Northwind SMS', channel: 'SMS', from_address: null, reply_to_address: null, sender_id: '55512', verification_status: 'PENDING', is_default: true },
  { id: 'snd-smtp', display_name: 'Northwind', channel: 'EMAIL', from_address: 'hello@nwa.example', reply_to_address: null, sender_id: null, verification_status: 'VERIFIED', is_default: false, provider_type: 'SMTP', provider_name: 'Workspace mail server' },
]

const list = (id: string, name: string, member_count: number, is_master = false, extra: Partial<ContactList> = {}): ContactList => ({
  ...audit, id, name, description: null, source_type: 'UPLOAD', source_label: 'Upload', vetted: false, list_kind: 'STATIC', is_master, refresh_mode: 'MANUAL',
  last_refreshed_at: null, list_environment: 'PRODUCTION', channel: 'EMAIL', status: 'ACTIVE', member_count, parent_contact_list: null, attached_campaigns: 0, live_campaigns: 0, ...extra,
})
export const contactLists: ContactList[] = [
  list('cl-master', 'Fall Master Audience', 90, true, { description: 'Active loyalty members', attached_campaigns: 2, live_campaigns: 1 }),
  list('cl-ga', 'Georgia only', 30, false, { source_type: 'BI', source_label: 'BI / Extraction', vetted: true, list_kind: 'SEGMENT', list_environment: 'TEST' }),
]
export const audiences: Audience[] = [
  { id: 'aud-gold', code: 'LOYALTY_GOLD_PLUS', name: 'Loyalty Gold & Platinum', description: null, source_system: 'C360', synced_at: '2026-09-20T05:00:00Z', member_count: 43, list_count: 1 },
  { id: 'aud-lapsed', code: 'LAPSED_90', name: 'No purchase in 90 days', description: 'Win-back base', source_system: 'C360', synced_at: '2026-09-20T05:00:00Z', member_count: 70, list_count: 0 },
]
export const makeJourney = (overrides: Partial<Journey> = {}): Journey => ({
  ...audit, id: 'j1', code: 'JRN-2026-00001', name: 'New Loyalty Member Welcome', description: null, status: 'DRAFT',
  population_mode: 'FIXED', reentry_policy: 'NEVER', reentry_after_days: null, current_version: null, scheduled_activate_at: null, latest_version: 1,
  goal_description: null, exit_criteria_description: null,
  owner_user: 'u1', owner_user_name: 'Aby John', channels: ['EMAIL'], trigger_family: 'SEGMENT_LOYALTY', trigger_family_label: 'Segment / Loyalty', needs_attention: false,
  step_count: 3, step_types: ['WAIT', 'EMAIL', 'EXIT'], entry_rule: { entry_type: 'SEGMENT_CHANGE', rule_definition: { change: 'JOINED' } },
  ...overrides,
})
export const journeyRows: Journey[] = [
  makeJourney({ id: 'j1', name: 'New Loyalty Member Welcome', status: 'ACTIVE', trigger_family: 'SEGMENT_LOYALTY', trigger_family_label: 'Segment / Loyalty', channels: ['EMAIL'] }),
  makeJourney({ id: 'j2', code: 'JRN-2026-00002', name: 'Abandoned Cart Recovery', status: 'ACTIVE', trigger_family: 'COMMERCE_OFFER', trigger_family_label: 'Commerce / Offer', channels: ['EMAIL', 'SMS'], needs_attention: true,
    step_count: 6, step_types: ['WAIT', 'CONDITION', 'EMAIL', 'SMS', 'COUPON_ISSUE', 'EXIT'], entry_rule: { entry_type: 'EVENT', rule_definition: { event_type: 'CART_ABANDON' } },
    source_starter_key: 'abandoned-cart-recovery', source_name: 'Abandoned Cart Recovery' }),
  makeJourney({ id: 'j3', code: 'JRN-2026-00003', name: 'Welcome Series', status: 'DRAFT', trigger_family: 'CUSTOMER_LIFECYCLE', trigger_family_label: 'Customer / Lifecycle', channels: ['EMAIL'],
    step_count: 2, step_types: ['EMAIL', 'EXIT'], entry_rule: { entry_type: 'EVENT', rule_definition: { event_type: 'WELCOME' } } }),
  makeJourney({ id: 'j4', code: 'JRN-2026-00004', name: 'Win-Back Lapsed Customers', status: 'PAUSED', trigger_family: 'ENGAGEMENT', trigger_family_label: 'Engagement', channels: ['SMS'],
    step_count: 1, step_types: ['SMS'], entry_rule: { entry_type: 'EVENT', rule_definition: { event_type: 'NO_RESPONSE' } } }),
  makeJourney({ id: 'j5', code: 'JRN-2026-00005', name: 'VIP Milestone', status: 'ARCHIVED', trigger_family: 'SEGMENT_LOYALTY', trigger_family_label: 'Segment / Loyalty', channels: [],
    step_count: 0, step_types: [] }),
]
export const makeJourneyReadiness = (overrides: Partial<JourneyReadiness> = {}): JourneyReadiness => ({
  ready: true,
  items: [
    { key: 'entry_rules', label: 'Entry rules configured', description: 'Loyalty enrollment event, Event Triggered population, no re-entry.', ok: true },
    { key: 'steps_configured', label: 'All canvas steps configured', description: '2 of 2 steps have complete settings.', ok: true },
    { key: 'templates_ready', label: 'Templates ready', description: 'Email and SMS templates are published in Template Studio.', ok: true },
    { key: 'governance', label: 'Governance rules satisfied', description: 'Frequency caps and quiet hours pass for this population.', ok: true },
  ],
  ...overrides,
})
export const makeJourneyTestResult = (overrides: Partial<JourneyTestResult> = {}): JourneyTestResult => {
  const base = { population_size: 50, sent_to: 50, delivered: 49, opened: 20, clicked: 8, bounced: 1, governance_flags: [], ...overrides }
  return { ...base, by_channel: overrides.by_channel ?? { SMS: { sent: base.sent_to, delivered: base.delivered } } }
}
export const makeJourneyMetrics = (overrides: Partial<JourneyMetrics> = {}): JourneyMetrics => ({
  enrolled: 55, in_journey: 40, goal_converted: 12, goal_converted_pct: 21.8, exited_early: 3, exited_early_pct: 5.5, ...overrides,
})
export const makeJourneyAudience = (overrides: Partial<JourneyAudience> = {}): JourneyAudience => ({
  source_lists: [{ id: 'l1', name: 'Loyalty Joiners' }], eligible_pool: 120, enrollment_rate_per_day: 3.2, ...overrides,
})
export const journeyTrendWeeks: JourneyTrendWeek[] = [
  { week_start: '2026-08-31', enrolled: 0, goal_converted: 0, exited_early: 0 },
  { week_start: '2026-09-07', enrolled: 4, goal_converted: 1, exited_early: 0 },
  { week_start: '2026-09-14', enrolled: 8, goal_converted: 2, exited_early: 1 },
  { week_start: '2026-09-21', enrolled: 10, goal_converted: 3, exited_early: 1 },
  { week_start: '2026-09-28', enrolled: 15, goal_converted: 4, exited_early: 1 },
  { week_start: '2026-10-05', enrolled: 18, goal_converted: 2, exited_early: 0 },
]
export const journeyGeneratedCampaignRows: JourneyGeneratedCampaignRow[] = [
  { id: 'gc1', campaign_id: 'c1', campaign_name: '[Journey] New Loyalty Member Welcome — email_welcome', node_key: 'email_welcome', node_type: 'EMAIL',
    generation_date: '2026-09-15', last_run_at: '2026-09-15T12:00:00Z', recipients: 6, status: 'COMPLETED' },
]
export const journeyActivityEntries: JourneyActivityEntry[] = [
  { event_type: 'PUBLISHED', message: 'Version 1 activated.', actor_name: 'Devon Okafor', occurred_at: '2026-08-27T09:00:00Z', version_number: 1 },
  { event_type: 'CREATED', message: 'Version 1 created.', actor_name: 'Devon Okafor', occurred_at: '2026-08-20T13:48:30Z', version_number: 1 },
]
const BLANK_GRAPH: JourneyGraph = { entry_rules: [], nodes: [{ key: 'start', type: 'START', config: {}, position: { x: 0, y: 0 } }], connections: [] }
export const makeJourneyVersion = (overrides: Partial<JourneyVersion> = {}): JourneyVersion => ({
  id: 'jv1', journey: 'j1', version_number: 1, status: 'DRAFT', status_label: 'Draft', published_at: null, created_by: 'u1',
  created_at: '2026-10-01T10:00:00Z', updated_by: null, updated_at: '2026-10-01T10:00:00Z', row_version: 1, ...overrides,
})
/** a straight chain of steps after Start, in graph.py's wire format */
function chainGraph(entry: JourneyGraph['entry_rules'][number], steps: { key: string; type: JourneyGraph['nodes'][number]['type']; config?: Record<string, unknown> }[]): JourneyGraph {
  const nodes = [{ key: 'start', type: 'START' as const, config: {}, position: { x: 0, y: 0 } },
    ...steps.map((step, index) => ({ key: step.key, type: step.type, config: step.config ?? {}, position: { x: 0, y: 150 * (index + 1) } }))]
  const connections = nodes.slice(1).map((node, index) => ({ from: nodes[index].key, to: node.key, branch_key: null, label: null }))
  return { entry_rules: [entry], nodes, connections }
}
/** Abandoned Cart Recovery as apps/journeys/starters.py builds it: a Condition whose YES and NO each end in an Exit */
export const abandonedCartGraph: JourneyGraph = {
  entry_rules: [{ entry_type: 'EVENT', rule_definition: { event_type: 'CART_ABANDON' } }],
  nodes: [
    { key: 'start', type: 'START', config: {}, position: { x: 0, y: 0 } },
    { key: 'wait-1', type: 'WAIT', config: { duration: 1, unit: 'HOURS' }, position: { x: 0, y: 150 } },
    { key: 'email-1', type: 'EMAIL', config: { label: 'Cart reminder' }, position: { x: 0, y: 300 } },
    { key: 'wait-2', type: 'WAIT', config: { duration: 1, unit: 'DAYS' }, position: { x: 0, y: 450 } },
    { key: 'condition-1', type: 'CONDITION', config: { check: 'PURCHASED' }, position: { x: 0, y: 600 } },
    { key: 'exit-1', type: 'EXIT', config: {}, position: { x: -280, y: 750 } },
    { key: 'coupon-issue-1', type: 'COUPON_ISSUE', config: {}, position: { x: 280, y: 750 } },
    { key: 'sms-1', type: 'SMS', config: { label: 'SMS with code' }, position: { x: 280, y: 900 } },
    { key: 'exit-2', type: 'EXIT', config: {}, position: { x: 280, y: 1050 } },
  ],
  connections: [
    { from: 'start', to: 'wait-1', branch_key: null, label: null }, { from: 'wait-1', to: 'email-1', branch_key: null, label: null },
    { from: 'email-1', to: 'wait-2', branch_key: null, label: null }, { from: 'wait-2', to: 'condition-1', branch_key: null, label: null },
    { from: 'condition-1', to: 'exit-1', branch_key: 'YES', label: null }, { from: 'condition-1', to: 'coupon-issue-1', branch_key: 'NO', label: null },
    { from: 'coupon-issue-1', to: 'sms-1', branch_key: null, label: null }, { from: 'sms-1', to: 'exit-2', branch_key: null, label: null },
  ],
}
export const makeJourneyStarter = (overrides: Partial<JourneyStarter> = {}): JourneyStarter => ({
  key: 'abandoned-cart-recovery', name: 'Abandoned Cart Recovery', category: 'COMMERCE',
  description: 'Remind shoppers about their cart, then follow up with a coupon if they haven\'t bought.', goal: 'Order placed within 3 days',
  population_mode: 'EVENT_TRIGGERED', reentry_policy: 'AFTER_X_DAYS', reentry_after_days: 7, graph: abandonedCartGraph, step_count: 8, channels: ['EMAIL', 'SMS'],
  ...overrides,
})
const welcomeGraph = chainGraph({ entry_type: 'EVENT', rule_definition: { event_type: 'CUSTOMER_CREATED' } },
  [{ key: 'email-1', type: 'EMAIL', config: { label: 'Welcome' } }, { key: 'wait-1', type: 'WAIT', config: { duration: 2, unit: 'DAYS' } }, { key: 'exit-1', type: 'EXIT' }])
/** a journey version saved as a template: Abandoned Cart Recovery's graph under the workspace's own name */
export function makeSavedTemplate(overrides: Partial<JourneyTemplate> = {}): JourneyTemplate {
  return { id: 'jt-1', name: 'Our Cart Reminder', description: 'The cart reminder as the shop runs it.', category: 'COMMERCE', population_mode: 'EVENT_TRIGGERED', reentry_policy: 'AFTER_X_DAYS',
           reentry_after_days: 7, goal_description: 'Order placed within 3 days', graph: abandonedCartGraph, created_by: 'u1', created_by_name: 'Aby John', created_at: '2026-10-01T09:00:00Z',
           updated_at: '2026-10-01T09:00:00Z', row_version: 1, used_count: 2, step_count: 6, channels: ['EMAIL', 'SMS'], ...overrides }
}

export const customerRows: CustomerSearchRow[] = [
  { party_id: 'p-aaliyah', name: 'Aaliyah Brooks', email: 'aaliyah@example.com', phone: '+14155550123', source_system: 'C360', synced_at: '2026-10-01T09:00:00Z' },
  { party_id: 'p-marcus', name: 'Marcus Hale', email: 'marcus@example.com', phone: null, source_system: 'UPLOAD', synced_at: '2026-09-20T09:00:00Z' },
]

export function makeCustomerRecord(row: CustomerSearchRow, overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  const [first, ...rest] = row.name.split(' ')
  return {
    customer: { party_id: row.party_id, first_name: first, last_name: rest.join(' ') || null, name: row.name, emails: row.email ? [{ address: row.email, is_primary: true, is_valid: true }] : [],
                phones: row.phone ? [{ number: row.phone, type: 'MOBILE', is_primary: true }] : [], primary_address: { city: 'Austin', state: 'TX', country: 'US' },
                custom_attributes: { loyalty_tier: 'Gold', timezone: 'America/Chicago' }, source_system: row.source_system, synced_at: row.synced_at },
    consent: [{ channel: 'EMAIL', consent_status: 'OPTED_IN', marketable: true, marketable_reason: null, opted_in_at: '2026-08-01T09:00:00Z', opted_out_at: null, opt_out_method: null, suppressed: false, suppression_reason: null, updated_at: '2026-08-01T09:00:00Z' },
              { channel: 'SMS', consent_status: 'UNKNOWN', marketable: false, marketable_reason: 'NO_CONSENT', opted_in_at: null, opted_out_at: null, opt_out_method: null, suppressed: false, suppression_reason: null, updated_at: '2026-08-01T09:00:00Z' }],
    lists: [{ id: 'cl-1', name: 'VIP Customers', source_type: 'UPLOAD', membership_source: 'UPLOAD', added_at: '2026-08-02T09:00:00Z' }],
    events: [{ id: 1, event_type: 'CART_ABANDON', label: 'Abandoned Cart', source: 'COMMERCE', event_id: 'cart-77812', payload: { cart_value: 84.5 }, occurred_at: '2026-10-06T09:30:00Z', received_at: '2026-10-06T09:30:05Z' }],
    orders: [{ order_ref: 'W-100234', kind: 'ORDER', amount: 129.5, currency: 'USD', ordered_at: '2026-10-04T14:30:00Z', channel: 'ONLINE', status: 'ATTRIBUTED', campaign_id: 'c1', campaign_name: 'Fall Launch' }],
    messages: [{ channel: 'EMAIL', campaign_id: 'c1', campaign_name: 'Fall Launch', journey_generated: false, status: 'OPENED', status_reason: null, submitted_at: '2026-10-03T10:00:00Z', delivered_at: '2026-10-03T10:00:30Z', opened_at: '2026-10-03T11:00:00Z', clicked_at: null, at: '2026-10-03T10:00:00Z' }],
    journeys: [{ enrollment_id: 'e-1', journey_id: 'j1', journey_name: 'New Loyalty Member Welcome', journey_status: 'ACTIVE', version_number: 1, enrolled_at: '2026-10-12T14:14:00Z', status: 'ACTIVE', converted_at: null,
                 attributed_revenue: null, exited_at: null, exit_reason: null, where: { node_key: 'wait-1', node_type: 'WAIT', label: 'Wait 3 days', next_scheduled_at: '2026-10-15T14:14:00Z' } }],
    journey_suppressions: [],
    ...overrides,
  }
}

export const journeyStarters: JourneyStarter[] = [
  makeJourneyStarter({ key: 'welcome-series', name: 'Welcome Series', category: 'LIFECYCLE', description: 'Greet new customers.', goal: 'First purchase within 30 days',
    reentry_policy: 'NEVER', reentry_after_days: null, graph: welcomeGraph, step_count: 3, channels: ['EMAIL'] }),
  makeJourneyStarter(),
  makeJourneyStarter({ key: 'post-purchase-thank-you', name: 'Post-Purchase Thank You & Review', description: 'Thank customers after they buy.', goal: 'Review submitted',
    reentry_after_days: 30, graph: chainGraph({ entry_type: 'EVENT', rule_definition: { event_type: 'PURCHASE' } }, [{ key: 'email-1', type: 'EMAIL', config: { label: 'Thank you' } }, { key: 'exit-1', type: 'EXIT' }]), step_count: 2, channels: ['EMAIL'] }),
  makeJourneyStarter({ key: 'first-to-second-purchase', name: 'First to Second Purchase', category: 'LIFECYCLE', description: 'Turn first-time buyers into repeat customers.', goal: 'Second purchase within 30 days',
    reentry_policy: 'NEVER', reentry_after_days: null, graph: chainGraph({ entry_type: 'EVENT', rule_definition: { event_type: 'FIRST_PURCHASE' } }, [{ key: 'coupon-1', type: 'COUPON_ISSUE' }, { key: 'exit-1', type: 'EXIT' }]), step_count: 2, channels: [] }),
  makeJourneyStarter({ key: 'loyalty-tier-upgrade', name: 'Loyalty Tier Upgrade', category: 'LOYALTY', description: 'Welcome customers to their new tier.', goal: 'Tier perk used within 14 days',
    reentry_policy: 'EVERY_QUALIFYING_EVENT', reentry_after_days: null, graph: chainGraph({ entry_type: 'EVENT', rule_definition: { event_type: 'LOYALTY_TIER_CHANGE' } }, [{ key: 'sms-1', type: 'SMS', config: { label: 'Your perks' } }, { key: 'exit-1', type: 'EXIT' }]), step_count: 2, channels: ['SMS'] }),
  makeJourneyStarter({ key: 're-engagement-sunset', name: 'Re-Engagement / Sunset', category: 'ENGAGEMENT', description: 'Ask unresponsive customers if they still want to hear from you.', goal: 'Opens or clicks again',
    reentry_after_days: 90, graph: chainGraph({ entry_type: 'EVENT', rule_definition: { event_type: 'NO_RESPONSE' } }, [{ key: 'email-1', type: 'EMAIL', config: { label: 'Still want to hear from us?' } }, { key: 'exit-1', type: 'EXIT' }]), step_count: 2, channels: ['EMAIL'] }),
]
export const listMembers: ListMember[] = [
  { id: 11, party_id: 'P-1', email: 'd.alvarez@northwind.example', first_name: 'Dolores', last_name: 'Alvarez', mobile: null, added_at: '2026-08-27T10:00:00Z', source: 'UPLOAD', known: true, email_status: 'MARKETABLE', email_status_label: 'Can receive marketing email', sendable: true },
  { id: 12, party_id: 'P-2', email: 'm.okonkwo@fabrikam.example', first_name: 'Miriam', last_name: 'Okonkwo', mobile: '+14045550002', added_at: '2026-08-27T10:00:00Z', source: 'UPLOAD', known: true, email_status: 'MARKETABLE', email_status_label: 'Can receive marketing email', sendable: true },
  { id: 13, party_id: 'P-3', email: 's.ramachandran@tailspin.example', first_name: 'Sana', last_name: 'Ramachandran', mobile: null, added_at: '2026-08-24T10:00:00Z', source: 'MANUAL', known: true, email_status: 'UNSUBSCRIBED', email_status_label: 'Unsubscribed', sendable: false },
]
/** the import's properties with the required flags of a list of this channel */
export const propertiesFor = (channel = 'EMAIL') => [
  { key: 'email', label: 'Email', required: channel !== 'SMS', help: 'Who the person is.' }, { key: 'first_name', label: 'First name', required: false, help: '' },
  { key: 'last_name', label: 'Last name', required: false, help: '' }, { key: 'mobile', label: 'Mobile number', required: channel !== 'EMAIL', help: 'Kept for text campaigns.' },
  { key: 'consent_date', label: 'Email consent date', required: false, help: 'Recorded as an email opt-in.' },
  { key: 'sms_consent_date', label: 'Text consent date', required: false, help: 'Recorded as a text opt-in.' },
]
const PROPERTIES = propertiesFor('EMAIL')
const REVIEW = { ready: 4, held_back: 2, new: 3, existing: 1, warnings: 1, errors: 2, duplicates: 1, rejected: 1 }
const GOVERNANCE: GovernanceLine[] = [
  { code: 'MARKETABLE', label: 'Can receive marketing email', sendable: true, count: 2 }, { code: 'UNSUBSCRIBED', label: 'Unsubscribed', sendable: false, count: 1 },
  { code: 'HARD_BOUNCE', label: 'Bounced: the address does not exist', sendable: false, count: 1 }, { code: 'SOFT_BOUNCE', label: 'Bounced repeatedly', sendable: false, count: 0 },
  { code: 'COMPLAINT', label: 'Marked a message as spam', sendable: false, count: 0 }, { code: 'BLOCKED', label: 'Blocked address', sendable: false, count: 0 },
  { code: 'INVALID_ADDRESS', label: 'Invalid address', sendable: false, count: 0 }, { code: 'SUPPRESSED', label: 'Suppressed', sendable: false, count: 0 },
  { code: 'NO_CONSENT', label: 'No consent on record', sendable: false, count: 0 },
]
/** 6 rows = 2 held back + 4 ready; 4 = 2 marketable + 1 unsubscribed + 1 hard bounce; after the import 4 = 3 added + 1 already in the list */
export const uploadSummary: UploadSummary = {
  rows: 6, held_back: { total: 2, reasons: [{ code: 'NO_EMAIL', label: 'No email address', count: 0 }, { code: 'INVALID_EMAIL', label: 'Not a valid email address', count: 1 },
                                            { code: 'DUPLICATE_IN_FILE', label: 'Same address earlier in the file', count: 1 }] },
  ready: { total: 4, new: 3, existing: 1 }, governance: { sendable: 2, not_sendable: 2, statuses: GOVERNANCE }, mobile: null, result: null, balanced: true,
}
/** as POST .../imports/ answers: stored and queued, nothing read yet. The mock "worker" moves it on at the next poll. */
/** the consent declaration an upload starts with: nothing declared, the workspace's policy holds people back */
export const consentDeclaration = (channel = 'EMAIL'): NonNullable<ListImport['consent']> => ({
  required: true, basis: null, basis_label: null, collected_at: null, attested_by_name: null, attested_at: null,
  attestation: 'I confirm these people agreed to receive marketing from Northwind Apparel',
  bases: [
    { key: 'WEB_FORM', label: 'Signed up on our website or app', allowed: true }, { key: 'IN_STORE', label: 'Enrolled in store or in the loyalty programme', allowed: true },
    { key: 'CUSTOMER_REQUEST', label: 'Asked us directly', allowed: true }, { key: 'IMPLIED', label: 'Existing customers under implied consent', allowed: channel === 'EMAIL' },
  ],
  policy: { without_consent: 'HOLD_BACK', texts_need_date: false, approval_before_send: false },
})

export const attributionSettings: AttributionSettings = {
  enabled: false, enabled_at: null, click_days: 7, open_days: 1, text_days: 1, store_sales: false, email_cost_per_1000: null, text_cost_per_1000: null,
  choices: { click_days: [1, 3, 7, 14, 30], open_days: [0, 1, 2, 3, 7], text_days: [0, 1, 2, 3, 7] }, currency: 'USD', endpoint: 'https://cep.example.com/api/v1/orders/',
  scope: 'orders:ingest', keys_with_scope: 0, store_sales_available: true,
  summary: { days: 30, orders: 4, revenue: 315.5, attributed_revenue: 245.5, attributed_orders: 3, attributed_share: 75, pending: 0, unattributed: 1, last_received_at: '2026-10-04T08:55:00Z',
             by_touch: { CODE: { orders: 1, revenue: 50 }, CLICK: { orders: 2, revenue: 195.5 }, OPEN: { orders: 0, revenue: 0 }, TEXT: { orders: 0, revenue: 0 } },
             top_campaigns: [{ id: 'cmp-1', name: 'Fall Launch', revenue: 195.5, orders: 2 }], store_orders: 0 },
}

export const attributedOrders: AttributedOrder[] = [
  { id: 3, source: 'API', order_id: 'W-100236', kind: 'ORDER', amount: 70, currency: 'USD', ordered_at: '2026-10-04T08:40:00Z', channel: 'ONLINE', store_number: null, party_id: null, email: 'nobody@example.com', phone: null,
    status: 'UNATTRIBUTED', campaign_id: null, campaign_name: null, touch_type: null, touch_at: null, note: 'No person: no customer id, and no email address or phone number C360 sent to.', received_at: '2026-10-04T08:41:00Z' },
  { id: 2, source: 'API', order_id: 'W-100235', kind: 'ORDER', amount: 129.5, currency: 'USD', ordered_at: '2026-10-04T08:30:00Z', channel: 'ONLINE', store_number: null, party_id: 'C-88213', email: 'jane@example.com', phone: null,
    status: 'ATTRIBUTED', campaign_id: 'cmp-1', campaign_name: 'Fall Launch', touch_type: 'CLICK', touch_at: '2026-10-03T19:12:00Z', note: null, received_at: '2026-10-04T08:31:00Z' },
]

export const eventsSettings: EventsSettings = {
  endpoint: 'https://cep.example.com/api/v1/events/', scope: 'events:ingest', keys_with_scope: 1, journeys_enabled: true,
  types: [
    { event_type: 'PURCHASE', label: 'Purchase', from_tracking: false }, { event_type: 'CART_ABANDON', label: 'Abandoned Cart', from_tracking: false },
    { event_type: 'EMAIL_ENGAGEMENT', label: 'Email Open/Click', from_tracking: true },
  ],
  summary: { days: 7, total: 3, last_received_at: '2026-10-05T08:40:00Z', unknown_customers: 1,
             by_type: [{ event_type: 'CART_ABANDON', label: 'Abandoned Cart', count: 2, last_received_at: '2026-10-05T08:40:00Z' },
                       { event_type: 'PURCHASE', label: 'Purchase', count: 1, last_received_at: '2026-10-05T07:10:00Z' }] },
  coupons: { endpoint: 'https://cep.example.com/api/v1/coupon-issuances/', scope: 'coupons:issue', keys_with_scope: 0, requested: 2, issued: 5, failed: 1 },
}

export const journeyEvents: JourneyEventRow[] = [
  { id: 3, event_type: 'CART_ABANDON', label: 'Abandoned Cart', source: 'API', party_id: 'C-88213', event_id: 'cart-77812', payload: { cart_value: 84.5 },
    occurred_at: '2026-10-05T08:30:00Z', received_at: '2026-10-05T08:40:00Z', customer_name: 'Jane Doe' },
  { id: 2, event_type: 'PURCHASE', label: 'Purchase', source: 'COMMERCE', party_id: 'C-90001', event_id: 'order:API:W-100240', payload: {},
    occurred_at: '2026-10-05T07:00:00Z', received_at: '2026-10-05T07:10:00Z', customer_name: null },
]

export const consentPolicy = {
  without_consent: 'HOLD_BACK', texts_need_date: false, approval_before_send: false, lifetime_months: 24,
  attestation: 'I confirm these people agreed to receive marketing from {workspace}', attestation_preview: 'I confirm these people agreed to receive marketing from Northwind Apparel',
  workspace_name: 'Northwind Apparel', lifetimes: [6, 12, 24, 36],
  bases: [{ key: 'WEB_FORM', label: 'Signed up on our website or app' }, { key: 'IN_STORE', label: 'Enrolled in store or in the loyalty programme' }, { key: 'CUSTOMER_REQUEST', label: 'Asked us directly' }, { key: 'IMPLIED', label: 'Existing customers under implied consent' }],
}

export const stagedImport: ListImport = {
  id: 'imp-1', contact_list: 'cl-new', list_name: 'Trade show leads', list_status: 'DRAFT', file_name: 'leads.csv', file_size: 2048, status: 'UPLOADED', phase: 'Waiting to be read',
  working: true, progress: { done: 0, total: 2048, percent: 0, unit: 'bytes' }, mapping_confirmed: false, error: null, created_at: '2026-09-21T10:00:00Z', completed_at: null,
  created_by_name: 'Aby John', row_count: 0, applied_count: 0, review: null, properties: PROPERTIES, consent: consentDeclaration(),
  columns: [{ name: 'Email Address', samples: ['a@x.example'], guess: 'email' }, { name: 'First Name', samples: ['Ana'], guess: 'first_name' }, { name: 'Notes', samples: ['vip'], guess: null }],
  mapping: { email: 'Email Address', first_name: 'First Name' },
}

const tag = (tag_key: string, label: string, tag_kind: string, sample_value: string): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind, data_type: 'STRING', applies_to_channels: ['EMAIL', 'SMS', 'MMS'], description: null, sample_value,
  default_value: null, static_value: null, is_active: true, resolution_source: tag_kind === 'CUSTOM' ? 'CAMPAIGN_LIST_MEMBER' : 'CUSTOMER_MASTER',
  source_path: tag_kind === 'CUSTOM' ? `custom_value_pairs.${tag_key}` : tag_key, platform_tag_id: tag_kind === 'STANDARD' ? `platform-${tag_key}` : null, row_version: 1,
})
export const tags: PersonalizationTag[] = [tag('first_name', 'First name', 'STANDARD', 'Jordan'), tag('offer_code', 'Offer code', 'CUSTOM', 'FALL017')]
/** GET /deliverability/clients/: a cut of Mailgun Inspect's client list */
export const inspectClients: InspectClient[] = [
  { id: 'outlook365', client: 'Outlook 365', os: 'Windows', category: 'Application', browser: '', default: true, image_blocking: true },
  { id: 'applemail', client: 'Apple Mail', os: 'macOS 14', category: 'Application', browser: '', default: true, image_blocking: false },
  { id: 'iphone15', client: 'iPhone 15 (iOS 17)', os: 'iOS 17', category: 'Mobile', browser: '', default: true, image_blocking: false },
  { id: 'gmail_android', client: 'Gmail app', os: 'Android 14', category: 'Mobile', browser: '', default: false, image_blocking: true },
  { id: 'gmail_chr_win', client: 'Gmail', os: 'Windows', category: 'Web', browser: 'Chrome', default: true, image_blocking: true },
]

const preview = (client: InspectClient, status: DeliverabilityTest['status'] = 'COMPLETE') => ({
  id: client.id, name: client.client, client: client.client, os: client.os, category: client.category, browser: client.browser, status, detail: status === 'FAILED' ? 'The client did not load the message.' : '',
  screenshot: status === 'COMPLETE' ? `https://shots.example/${client.id}.png` : '', screenshot_no_images: '', thumbnail: status === 'COMPLETE' ? `https://shots.example/${client.id}_t.png` : '', full_thumbnail: '',
})

/** one finished inbox-preview test of the Fall Email, v2 */
export const finishedDeliverabilityTest: DeliverabilityTest = {
  id: 'dt-1', template: 'tpl-email', template_version: 2, kind: 'PREVIEW', provider: 'MAILGUN_INSPECT', status: 'COMPLETE', subject: 'Aaliyah, 20% off this weekend only',
  clients: inspectClients.map((c) => c.id), summary: { clients: 5, complete: 4, failed: 1, processing: 0 }, error: null, requested_by: 'Aby John',
  requested_at: '2026-09-30T14:12:00Z', completed_at: '2026-09-30T14:15:00Z', previews: inspectClients.map((c, i) => preview(c, i === 3 ? 'FAILED' : 'COMPLETE')), spam: null, placement: null,
}

/** GET /field-rules/: the lengths the forms count against, as the tables set them */
const text = (max: number | null, required = false): FieldRule => ({ type: 'string', required, max, min: null, blank: !required })
export const fieldRules: FieldRules = {
  generated_at: '2026-10-02T00:00:00Z',
  resources: {
    campaign: { name: text(200, true), code: text(40), description: text(null), subject_line: text(300), preheader: text(300),
                targets: { type: 'object', required: false, fields: { notes: text(1000) } },
                drip_config: { type: 'json', required: false } },
    template: { name: text(200, true), description: text(null) },
    personalization_tag: { tag_key: text(100, true), label: text(150, true), static_value: text(null) },
    contact_list: { name: text(200, true), description: text(null) },
    new_contact_list: { name: text(200, true), description: text(null) },
    journey: { name: text(200, true), description: text(2000), goal_description: text(500), exit_criteria_description: text(500),
               reentry_after_days: { type: 'integer', required: false, min_value: 1, max_value: 3650 } },
    journey_step: { label: text(120), duration: { type: 'integer', required: false, min_value: 0, max_value: 999 },
                    days: { type: 'integer', required: false, min_value: 0, max_value: 365 }, event_type: text(60), message_step: text(100) },
  },
}

/** GET /personalization-tags/data-points/: a cut of the catalogue the Tags page's form reads */
export const tagDataPoints = {
  sources: [
    { key: 'CUSTOMER_MASTER', label: 'Customer', points: [{ path: 'first_name', label: 'First name', data_type: 'STRING', prefix: false }, { path: 'custom_attributes.', label: 'A customer attribute', data_type: 'STRING', prefix: true }] },
    { key: 'TRANSACTION', label: 'Transaction (e-receipts from the point of sale)', points: [{ path: 'id', label: 'Transaction ID', data_type: 'STRING', prefix: false }, { path: 'grand_total', label: 'Total', data_type: 'NUMBER', prefix: false }] },
    { key: 'STORE', label: 'Store (e-receipts)', points: [{ path: 'name', label: 'Store Name', data_type: 'STRING', prefix: false }] },
  ],
  static: { key: 'STATIC', label: 'Static value' },
}
/** every tag the marketing presets use, with the sample values the SMS lengths are counted with */
export const presetTags: PersonalizationTag[] = [...tags, tag('discount_pct', 'Discount %', 'CUSTOM', '20'), tag('shop_url', 'Shop URL', 'SYSTEM', 'https://shop.example.com'),
  tag('unsubscribe_url', 'Unsubscribe URL', 'SYSTEM', 'https://example.com/unsubscribe'), tag('loyalty_points', 'Loyalty points', 'STANDARD', '1,250'),
  tag('loyalty_tier', 'Loyalty tier', 'STANDARD', 'Gold')]

export const mediaLibrary: MediaAsset[] = [
  { id: 'img-1', file_name: 'lookbook.jpg', mime_type: 'image/jpeg', byte_size: 180_000, width_px: 600, height_px: 400, url: 'http://cdn.test/lookbook.jpg', created_at: '2026-09-01T10:00:00Z' },
  { id: 'img-webp', file_name: 'modern.webp', mime_type: 'image/webp', byte_size: 90_000, width_px: 600, height_px: 400, url: 'http://cdn.test/modern.webp', created_at: '2026-09-01T10:00:00Z' },
]

export const roles: Role[] = [
  { id: 'role-admin', name: 'Marketing Admin', description: 'Everything', permissions: ['campaign.edit', 'user.admin'], user_count: 1, row_version: 1 },
  { id: 'role-analyst', name: 'Analyst', description: 'Read only', permissions: ['campaign.view'], user_count: 0, row_version: 1 },
]
export const permissionCatalogue = [
  { code: 'campaign.view', description: 'Campaign view' }, { code: 'campaign.edit', description: 'Campaign edit' },
  { code: 'template.edit', description: 'Template edit' }, { code: 'user.admin', description: 'User admin' },
]
const settingsUser = (overrides: Partial<SettingsUser>): SettingsUser => ({
  id: 'u1', email: 'aby.john@aiintelekt.com', display_name: 'Aby John', is_active: true, auth_provider: 'LOCAL', mfa_enabled: false,
  last_login: '2026-09-17T10:00:00Z', created_at: '2026-09-01T10:00:00Z', roles: ['role-admin'], role_names: ['Marketing Admin'], has_password: true, is_self: true, ...overrides,
})
export const settingsUsers: SettingsUser[] = [
  settingsUser({}),
  settingsUser({ id: 'u2', email: 'devon@example.com', display_name: 'Devon Okafor', roles: ['role-analyst'], role_names: ['Analyst'], has_password: false, is_self: false, last_login: null }),
]
export const integrations: Integration[] = [
  { id: 'int-pos', kind: 'POS_RECEIPTS', name: 'POS receipts', direction: 'IN', system: 'POS', status: 'ACTIVE', environment: null, delivery_provider_id: null, throttle_per_minute: null, throttle_burst: null,
    effective_limit_per_minute: 600, log_level: 'FULL', log_retention_days: 90, last_call_at: '2026-09-25T09:58:00Z', last_outcome: 'OK', last_error: null, breaker_failures: 5, breaker_cooldown_seconds: 60,
    breaker_open_seconds: 0, calls_24h: 1240, ok_24h: 1231, rejected_24h: 6, retried_24h: 0, errors_24h: 0, throttled_24h: 3, error_rate_24h: 0, p95_ms: 212, max_ms: 890, bytes_in_24h: 2_400_000, bytes_out_24h: 180_000, health: 'healthy' },
  { id: 'int-postal', kind: 'PROVIDER', name: 'Postal (self-hosted)', direction: 'OUT', system: 'POSTAL', status: 'ACTIVE', environment: null, delivery_provider_id: 'prov-postal', throttle_per_minute: 600, throttle_burst: null,
    log_level: 'FULL', log_retention_days: 90, last_call_at: '2026-09-25T09:57:30Z', last_outcome: 'RETRY', last_error: 'Postal answered 503', breaker_failures: 5, breaker_cooldown_seconds: 60,
    breaker_open_seconds: 42, calls_24h: 8_120, ok_24h: 7_600, rejected_24h: 0, retried_24h: 520, errors_24h: 0, throttled_24h: 0, error_rate_24h: 6.4, p95_ms: 640, max_ms: 5_000, bytes_in_24h: 900_000, bytes_out_24h: 41_000_000, health: 'circuit_open' },
]
export const integrationLog: IntegrationLogDetail[] = [
  { id: 50, integration_id: 'int-postal', direction: 'IN', kind: 'PROVIDER', system: 'POSTAL', correlation_id: 'hook-0007', related_ref: 'mailer_execution:7', method: 'POST', url: '/api/v1/webhooks/delivery/NWA/prov-postal/***/', response_status: 200, outcome: 'ERROR',
    error_class: null, error_message: '1 events could not be applied', attempt: 1, duration_ms: 96, request_bytes: 610, response_bytes: 90, api_client_id: null, started_at: '2026-09-25T09:59:00Z',
    request_headers: { 'Content-Type': 'application/json' }, request_body: '{"event": "MessageLoaded", "uuid": "evt-7", "payload": {"message": {"id": 7, "message_id": "m7@postal.example"}}}',
    response_headers: {}, response_body: '{"received": 1, "applied": 0, "failed": 1}', worker: 'web-1' },
  { id: 52, integration_id: 'int-pos', direction: 'IN', kind: 'POS_RECEIPTS', system: 'POS', correlation_id: 'pos-corr-0001', related_ref: 'receipt:R-1001', method: 'POST', url: '/api/v1/receipts/send/', response_status: 201, outcome: 'OK',
    error_class: null, error_message: null, attempt: 1, duration_ms: 184, request_bytes: 212, response_bytes: 83, api_client_id: 'key-1', started_at: '2026-09-25T09:58:00Z',
    request_headers: { 'Content-Type': 'application/json', Authorization: '***' }, request_body: '{"campaign": "RCPT", "to": "buyer@x.test", "receipt": {"number": "R-1001", "card_number": "***"}}',
    response_headers: { 'X-RateLimit-Limit': '600' }, response_body: '{"status": "SUBMITTED", "execution_id": 7}', worker: 'web-1' },
  { id: 51, integration_id: 'int-postal', direction: 'OUT', kind: 'PROVIDER', system: 'POSTAL', correlation_id: 'pos-corr-0001', related_ref: 'receipt:R-1001', method: 'POST', url: 'https://postal.example/api/v1/send/message', response_status: 503, outcome: 'RETRY',
    error_class: null, error_message: 'Postal answered 503', attempt: 1, duration_ms: 1_204, request_bytes: 4_100, response_bytes: 40, api_client_id: null, started_at: '2026-09-25T09:57:30Z',
    request_headers: { 'X-Server-API-Key': '***' }, request_body: '{"to": ["buyer@x.test"], "subject": "Your receipt"}', response_headers: {}, response_body: '{"status": "error"}', worker: 'worker-1' },
]

export const apiKeys: ApiKey[] = [
  { id: 'key-1', name: 'POS integration', client_type: 'INTEGRATION', key_prefix: 'cep_in_AbC123', scopes: ['events:ingest'], allowed_ip_cidrs: ['203.0.113.0/24'], rate_limit_per_minute: 600,
    expires_at: null, revoked_at: null, last_used_at: null, created_at: '2026-09-01T10:00:00Z', status: 'ACTIVE' },
]
export const workspace: Workspace = { name: 'Northwind Apparel', code: 'NWA', timezone: 'America/New_York', status: 'ACTIVE', subdomain: 'northwind', region: 'us-east-1',
                                      plan: 'Growth', max_users: 50, active_users: 2, roles: 2, active_api_keys: 1 }

export const usage: Usage = {
  month: '2026-09-01', can_send: true, plan: { code: 'GROWTH', name: 'Growth', monthly_price: 499, currency: 'USD', status: 'ACTIVE' },
  breakdown: { Email: 8_200_000, SMS: 300_000, MMS: 0 },
  meters: [
    { label: 'Messages this month', used: 8_500_000, limit: 10_000_000, percent: 85, state: 'warning', unit: '', overage: true, overage_price_per_1k: 0.9 },
    { label: 'Contacts', used: 120_000, limit: 2_000_000, percent: 6, state: 'ok', unit: '', overage: true, overage_price_per_1k: 4 },
    { label: 'Active users', used: 2, limit: 50, percent: 4, state: 'ok', unit: '', overage: false, overage_price_per_1k: null },
    { label: 'Storage', used: 1.5, limit: null, percent: null, state: 'ok', unit: 'GB', overage: false, overage_price_per_1k: null },
    { label: 'Deliverability tests', used: 98, limit: 120, percent: 82, state: 'ok', unit: '', overage: false, overage_price_per_1k: null,
      note: '50 a month on the Growth plan + 70 added for September. Added tests end on Sep 30.' },
  ],
}
export const invoices: Invoice[] = [
  { id: 'inv-1', invoice_number: 'INV-NWA-202608', period_month: '2026-08-01', plan_code: 'GROWTH', currency: 'USD', base_amount: '499.00', overage_amount: '2.70', total_amount: '501.70',
    line_items: [], status: 'ISSUED', issued_at: '2026-09-01T06:00:00Z', due_at: '2026-09-15T06:00:00Z', paid_at: null },
]
export const security: SecuritySettings = { require_mfa: false, sso_available: true, redirect_uri: 'http://localhost:8000/api/v1/auth/sso/callback/', identity_provider: null }
export const supportAccess: SupportAccess[] = [
  { id: 'sup-1', staff: 'Pat Support', as_user: 'Devon Okafor', as_email: 'devon@example.com', reason: 'Ticket 4821: cannot find a campaign', mode: 'READ',
    started_at: '2026-09-10T10:00:00Z', expires_at: '2026-09-10T10:30:00Z', ended_at: '2026-09-10T10:12:00Z', writes: 0 },
]

export const providerCatalogue: ProviderType[] = [
  { provider_type: 'POSTAL', label: 'Postal', description: 'Self-hosted Postal server.', supports_webhooks: true, manageable: true, channel: 'EMAIL', fields: [
    { key: 'endpoint', label: 'Postal address', required: true, secret: false, help: 'Base address of your Postal installation.', placeholder: 'https://postal.example.com', kind: 'url' },
    { key: 'api_key', label: 'Server API key', required: true, secret: true, help: 'Credentials -> type API.', placeholder: '', kind: 'text', credential: 'secret' },
    { key: 'transactional_api_key', label: 'Transactional server API key', required: false, secret: true, help: 'Optional. A second Postal mail server for receipts.', placeholder: '', kind: 'text', credential: 'transactional_secret' }] },
  { provider_type: 'SENDGRID', label: 'SendGrid', description: 'Twilio SendGrid.', supports_webhooks: true, manageable: true, channel: 'EMAIL', fields: [
    { key: 'api_key', label: 'API key', required: true, secret: true, help: 'Needs the Mail Send permission.', placeholder: '', kind: 'text', credential: 'secret' },
    { key: 'api_base', label: 'API address', required: false, secret: false, help: 'Leave empty for the global region.', placeholder: 'https://api.sendgrid.com', kind: 'url' }] },
  { provider_type: 'SMTP', label: 'SMTP (your mail server)', description: 'Follows Settings -> Email server.', supports_webhooks: false, manageable: false, channel: 'EMAIL', fields: [] },
  { provider_type: 'SANDBOX_SMS', label: 'Sandbox (sends nothing)', description: 'Accepts SMS and MMS without sending them.', supports_webhooks: true, manageable: true, channel: 'SMS', supports_mms: true, fields: [
    { key: 'reject_numbers', label: 'Numbers to refuse', required: false, secret: false, help: 'Comma-separated.', placeholder: '', kind: 'text' }] },
]
export const deliveryProviders: DeliveryProvider[] = [
  { id: 'prov-postal', provider_type: 'POSTAL', channel: 'EMAIL', name: 'Postal (self-hosted)', config: { endpoint: 'https://postal.cep.example.com' }, has_secret: true, has_transactional_secret: false, secret_ref: null,
    rate_limit_per_minute: null, is_default: true, is_active: true, webhook_url: 'http://localhost:8000/api/v1/webhooks/delivery/NWA/prov-postal/tok/', sender_count: 1,
    last_checked_at: null, last_check_ok: null, last_check_error: null, row_version: 1 },
]
export const textEngine: DeliveryProvider = { id: 'prov-texts', provider_type: 'SANDBOX_SMS', channel: 'SMS', name: 'Sandbox texts', config: {}, has_secret: false, secret_ref: null,
  rate_limit_per_minute: null, is_default: true, is_active: true, webhook_url: 'http://localhost:8000/api/v1/webhooks/delivery/NWA/prov-texts/tok/', sender_count: 1,
  last_checked_at: null, last_check_ok: null, last_check_error: null, row_version: 1 }
export const textSender: DeliverySender = { id: 'snd-texts', delivery_provider: 'prov-texts', display_name: 'Northwind texts', channel: 'SMS', from_address: null, reply_to_address: null, sender_id: '55123',
  verification_status: 'PENDING', is_default: true, provider_type: 'SANDBOX_SMS', provider_name: 'Sandbox texts' }
export const textResults: RunResults = {
  id: 'r1', status: 'COMPLETED', family: 'SMS', started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:01:00Z',
  audience: { members: 40, eligible: 31, suppressed: { NO_CONSENT: 5, BLOCKED_NUMBER: 3, INVALID_NUMBER: 1 } },
  messages: { queued: 0, sent: 30, failed: 1, delivered: 28, opened: 0, clicked: 0, bounced: 0, complained: 0, replied: 4, opted_out: 2, parts: 37 }, by_status: {},
}
export const smsReplies: SmsReply[] = [
  { id: 2, from_number: '+14045550002', to_number: '55123', body: 'Do you have it in blue?', keyword: null, action: 'NONE', party_id: 'P-2', name: 'Luis Brown', campaign: 'c1', received_at: '2026-09-18T10:20:00Z' },
  { id: 1, from_number: '+14045550001', to_number: '55123', body: 'STOP', keyword: 'STOP', action: 'OPT_OUT', party_id: 'P-1', name: 'Brianna Garcia', campaign: 'c1', received_at: '2026-09-18T10:05:00Z' },
]

export const deliverySenders: DeliverySender[] = [
  { id: 'snd-email', delivery_provider: 'prov-postal', display_name: 'Northwind Rewards', channel: 'EMAIL', from_address: 'rewards@northwind.example', reply_to_address: null, sender_id: null,
    verification_status: 'PENDING', is_default: true, provider_type: 'POSTAL', provider_name: 'Postal (self-hosted)' },
]
const recipient = (overrides: Partial<RunRecipient>): RunRecipient => ({
  id: 1, party_id: 'P-100001', address: 'brianna.garcia@example.com', status: 'OPENED', status_reason: null, provider_message_id: 'postal-7205256a6e7d', attempts: 1, variant_key: null, bounce_type: null,
  created_at: '2026-09-18T10:00:00Z', submitted_at: '2026-09-18T10:00:20Z', delivered_at: '2026-09-18T10:01:30Z', opened_at: '2026-09-18T12:00:00Z', clicked_at: null, bounced_at: null, complained_at: null,
  failed_at: null, send_after: null, first_name: 'Brianna', last_name: 'Garcia', ...overrides,
})
export const runRecipients: RunRecipient[] = [
  recipient({}),
  recipient({ id: 2, party_id: 'P-100002', address: 'devon.okafor@example.com', status: 'BOUNCED', status_reason: '550 5.1.1 The email account does not exist', bounce_type: 'HARD', provider_message_id: 'postal-91aa0c2b3f10',
              delivered_at: null, opened_at: null, bounced_at: '2026-09-18T10:01:40Z', first_name: 'Devon', last_name: 'Okafor' }),
  recipient({ id: 3, party_id: 'P-100003', address: 'maria.chen@example.com', status: 'FAILED', status_reason: 'ValidationError: the to address is not valid', provider_message_id: null, delivered_at: null, opened_at: null,
              first_name: 'Maria', last_name: 'Chen' }),
  recipient({ id: 4, party_id: 'P-100004', address: 'sam.lee@example.com', status: 'SUBMITTED', delivered_at: null, opened_at: null, provider_message_id: 'postal-0ffe1a77bd02', first_name: 'Sam', last_name: 'Lee' }),
]

export const runResults: RunResults = {
  id: 'r1', status: 'COMPLETED', started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z',
  audience: { members: 90, eligible: 72, suppressed: { NO_CONSENT: 11, UNSUBSCRIBED: 4, BLOCKED_ADDRESS: 2, FREQUENCY_CAP: 1 } },
  messages: { queued: 0, sent: 71, failed: 1, delivered: 68, opened: 30, clicked: 9, bounced: 2, complained: 0 }, by_status: {},
}

export const starters: TemplateStarter[] = [
  { key: 'promotion', name: 'Sale announcement', channel: 'EMAIL', category: 'Promotion', description: 'A time-limited offer.', subject_line: '{{first_name}}, a sale',
    preheader: '', html_content: '<html><body><p>Hi {{first_name}}</p></body></html>', sms_body: null },
  { key: 'newsletter', name: 'Monthly newsletter', channel: 'EMAIL', category: 'Newsletter', description: 'News and updates.', subject_line: 'This month',
    preheader: '', html_content: '<html><body><p>News for {{first_name}}</p></body></html>', sms_body: null },
  { key: 'sms_promotion', name: 'SMS offer', channel: 'SMS', category: 'Promotion', description: 'One-part text.', subject_line: '', preheader: '', html_content: null,
    sms_body: 'Hi {{first_name}}, code {{offer_code}}. Reply STOP to opt out.' },
  // uses a tag the workspace does not have, so the landing page does not offer it as a preset
  { key: 'points_update', name: 'Points balance update', channel: 'EMAIL', category: 'Loyalty', description: 'Monthly points summary.', subject_line: 'Your points',
    preheader: '', html_content: '<html><body><p>You have {{ points_balance }} points</p></body></html>', sms_body: null },
]

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    template: 'tpl-sms', channel: 'SMS', version_number: 1, latest_version: 1, sms_body: 'Northwind: Hi {{first_name}}. Reply STOP to opt out.', subject_line: '',
    media_asset: null, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor',
    findings: { encoding: 'GSM-7', units: 45, segments: 1, per_segment: 160, non_gsm_characters: [], estimated: true, tags_used: ['first_name'], unknown_tags: [],
                wrong_channel_tags: [], missing_opt_out: false, long_message: false, has_link: false, missing_media: false, media_bytes: null, media_heavy: false },
    ...overrides,
  }
}

export function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    template: 'tpl-receipt', version_number: 1, latest_version: 1, editor_state: null, mjml_source: RECEIPT_STARTER_MJML, html_content: null,
    text_content: null, subject_line: 'Your Northline receipt', preheader: '', saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor',
    ...overrides,
  }
}

export function makeReceiptLayout(overrides: Partial<ReceiptLayout> = {}): ReceiptLayout {
  return {
    template: 'tpl-receipt', version_number: 1, latest_version: 1, layout_preset: 'STANDARD',
    sections: defaultSectionsFor('STANDARD'),
    custom_html: null, custom_css: null, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor',
    ...overrides,
  }
}

export function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  const made = { ...campaignBase(), ...overrides }
  return { ...made, ...derived(made), ...(overrides.actions ? { actions: overrides.actions } : {}) }
}

function campaignBase(): Omit<Campaign, 'display_status' | 'display_status_label' | 'actions' | 'next_run_at' | 'setup_complete'> {
  return {
    ...audit, ...moduleDefaults, id: 'c1', code: 'CMP-2026-0001', name: 'Fall Launch', description: 'Seasonal launch', campaign_type: 'REGULAR_MARKETING',
    channel: 'EMAIL', status: 'DRAFT', status_label: 'Draft', solicitation_type: 'MARKETING', is_journey_generated: false, scheduled_at: null,
    template: 'tpl-email', sender_profile: 'snd-email', origin_journey: null, owner_user: 'u1', template_name: 'Fall Email',
    sender_profile_name: 'Northwind Rewards', contact_lists: ['cl-master'],
    contact_list_details: [{ id: 'cl-master', name: 'Fall Master Audience', list_kind: 'STATIC', is_master: true, list_environment: 'PRODUCTION', status: 'ACTIVE', member_count: 90 }],
    runs: [], subject_line: null, preheader: null, topic: null, topic_name: null,
  }
}

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface MockOptions {
  /** the journey the Build page opens (GET /journeys/{id}/); default: a FIXED-population DRAFT journey, "j1" */
  journey?: Partial<Journey>
  /** that journey's versions (GET /journeys/{id}/versions/); default: one DRAFT, version 1 */
  journeyVersions?: JourneyVersion[]
  /** version 1's graph (GET /journeys/{id}/versions/1/); default: Start only */
  journeyGraph?: JourneyGraph
  /** PUT .../graph/ answers 409 ("someone else saved this") no matter the row_version sent */
  journeySaveConflicts?: boolean
  /** GET .../readiness/ ; default: all 4 checks pass */
  journeyReadiness?: JourneyReadiness
  /** POST .../test-publish/ ; default: 50 sent, 49 delivered, no governance flags */
  journeyTestResult?: JourneyTestResult
  /** the List page's rows (GET /journeys/); default: journeyRows, 5 journeys across every status/family/channel */
  journeysList?: Journey[]
  /** GET /journeys/{id}/performance/ summary, read by the List page's preview popover; default: 40 active, 12 completed, 3 exited */
  journeyPerformance?: { active_enrollment_count: number; completed_count: number; exited_count: number } | null
  /** GET /journeys/{id}/performance/ 's "metrics" key, read by Journey Details' 4 cards; default: makeJourneyMetrics() */
  journeyMetrics?: JourneyMetrics
  /** GET /journeys/{id}/audience/ ; default: makeJourneyAudience() */
  journeyAudience?: JourneyAudience
  /** GET /journeys/{id}/enrollment-trend/ ; default: journeyTrendWeeks, 6 weeks */
  journeyTrend?: JourneyTrendWeek[]
  /** GET /journeys/{id}/campaigns/ ; default: journeyGeneratedCampaignRows, one row */
  journeyGeneratedCampaigns?: JourneyGeneratedCampaignRow[]
  /** GET /journeys/{id}/attention/ ; default: nothing needs attention */
  journeyAttention?: JourneyAttentionRow[]
  /** GET /journeys/{id}/activity/ ; default: journeyActivityEntries */
  journeyActivity?: JourneyActivityEntry[]
  /** GET /journey-starters/ ; default: journeyStarters, 6 starters across the 4 categories */
  journeyStarters?: JourneyStarter[]
  /** GET /journey-templates/ : the workspace's saved templates; default: none */
  savedTemplates?: JourneyTemplate[]
  /** Settings -> Delivery -> Deliverability Testing: the account as stored; default: none */
  deliverabilityService?: Partial<DeliverabilityService>
  /** the template's past tests, newest first */
  deliverabilityTests?: DeliverabilityTest[]
  /** the plan's monthly allowance; null = unlimited */
  deliverabilityLimit?: number | null
  /** the platform's Mailgun Inspect account is set up (back-office), so a workspace without its own uses it; default: false */
  platformInspect?: boolean
  campaign?: Campaign
  /** the workspace's campaigns (GET /campaigns/); default: the one campaign above */
  campaigns?: Campaign[]
  /** the tags GET /campaigns/form-options/ offers; default Fall and VIP */
  campaignTags?: string[]
  /** merged over the default GET /campaigns/{id}/audience/ answer */
  audience?: Partial<CampaignAudience>
  /** GET /campaigns/{id}/audience/export/ fails with a 503 */
  audienceExportFails?: boolean
  /** merged over the campaign results (GET /campaigns/{id}/metrics/) */
  metrics?: Partial<CampaignMetrics>
  /** GET /campaigns/{id}/activity/ answers these instead of the default two entries */
  activity?: CampaignActivity[]
  /** the workspace's contact lists (default: Fall Master Audience and Georgia only) */
  lists?: ContactList[]
  /** merged over GET /campaigns/audience-estimate/ */
  estimate?: Partial<CampaignAudience>
  /** GET /campaigns/{id}/activity/ fails with a 503 */
  activityFails?: boolean
  /** a drip's messages by campaign id (GET /campaigns/{id}/steps/); default: the API's Day-0 message without a template */
  dripSteps?: Record<string, DripStep[]>
  /** what GET /campaign-runs/{id}/recipients/ lists; default: runRecipients */
  recipientRows?: RunRecipient[]
  /** what GET /campaign-runs/{id}/skipped/ lists; default: skippedPeople */
  skippedPeople?: RunSkippedPerson[]
  /** GET /campaigns/{id}/resume-plan/ */
  resumePlan?: { missed: unknown[]; moved: unknown[]; unchanged: unknown[] }
  /** drip messages (by step id) whose test send fails */
  dripTestFails?: string[]
  /** review warnings added to drip messages (by step id), besides the TOO_CLOSE the mock works out */
  dripWarnings?: Record<string, { code: 'TOO_CLOSE' | 'FREQUENCY' | 'QUIET_HOURS'; message: string }[]>
  /** answer for POST /campaigns/ and PATCH /campaigns/{id}/ ; default echoes a saved campaign */
  onSave?: (call: Call) => Response | null
  /** answer for POST /templates/ ; default echoes a created draft */
  onSaveTemplate?: (call: Call) => Response | null
  /** listed first in GET /templates/ (a drip's message templates, say) */
  moreTemplates?: Template[]
  /** what GET /templates/{id}/ and /message/ answer */
  template?: Template
  message?: Message
  /** answer for POST /templates/{id}/message/ ; default echoes version n+1 */
  onSaveMessage?: (call: Call) => Response | null
  /** the workspace's tag catalogue (GET /personalization-tags/); default: first_name and offer_code */
  tags?: PersonalizationTag[]
  /** what GET /templates/{id}/design/ answers */
  design?: Design
  /** answer for POST /templates/{id}/design/ ; default echoes version n+1 */
  onSaveDesign?: (call: Call) => Response | null
  /** what GET /templates/{id}/receipt/ answers */
  receiptLayout?: ReceiptLayout
  /** answer for POST /templates/{id}/receipt/ ; default echoes version n+1 */
  onSaveReceiptLayout?: (call: Call) => Response | null
  /** answer for writes under /users/, /roles/, /api-clients/ and /auth/set-password/ ; default echoes success */
  onSettingsWrite?: (call: Call) => Response | null
  /** merged over the default GET /me/ answer: features, support_session, mfa_setup_required ... */
  me?: Partial<Me>
  /** GET /workspace/setup/ ; default: every step done, the workspace ready */
  setup?: Partial<WorkspaceSetup>
  /** the call log padded to this many rows (clones of the sample rows), for paging */
  integrationLogCount?: number
  /** answer for POST /auth/forgot-password/ ; default: 404, as the unbuilt endpoint really answers */
  onForgotPassword?: (call: Call) => Response | null
  /** GET /auth/options/ ; default: no single sign-on */
  authOptions?: Partial<AuthOptions>
  /** GET /auth/mfa/ starts from this */
  mfaEnabled?: boolean
  /** answer for PUT /workspace/security/ ; default merges the body into the stored settings */
  onSecurityWrite?: (call: Call) => Response | null
  /** GET /workspace/mail-server/ starts from this */
  mailServer?: Partial<MailServerSettings>
  /** POST /delivery-providers/{id}/check/ answers a failure */
  providerCheckFails?: boolean
  /** the Postal engine holds a second key for receipts */
  providerHasTransactionalKey?: boolean
  /** the workspace also has a text engine and sender; run results and replies are those of a text campaign */
  texts?: boolean
  /** answer for POST /contact-lists/{id}/imports/ ; default: a six-row file, stored and queued */
  onListUpload?: (call: Call) => Response | null
  /** how long the background worker takes to import (default: done at the next poll) */
  listImportMs?: number
  /** the background worker refuses the file when it reads it */
  listUploadFails?: boolean
  /** uploads the workspace already has (GET /contact-lists/imports/) */
  listUploads?: ListImport[]
  /** a production run's subject line test, for the campaign page's runs */
  runVariants?: CampaignRunVariant[]
  /** reports schedule, suppressions, notifications and approvals as the backend would hold them */
  workspaceTools?: Partial<WorkspaceToolsState>
}

/** the code the mock authenticator "shows" */
export const MFA_CODE = '123456'

/** Installs a fetch mock; returns the recorded calls. Call signIn() to start authenticated. */
export function installMockApi(options: MockOptions = {}) {
  const calls: Call[] = []
  insightsReportsNow.splice(0, insightsReportsNow.length, { ...insightsSummary })      // every test starts with the one saved report
  insightsDashboardsNow.splice(0, insightsDashboardsNow.length, structuredClone(insightsDashboard))
  insightsFolders.splice(0, insightsFolders.length, { id: 'fold-1', name: 'Finance', owner_user_id: 'u1', reports: 0, row_version: 1, updated_at: '2026-10-14T08:00:00Z' })
  insightsFavourites.clear()
  insightsAssistantNow.enabled = true
  insightsAssistantNow.reason = null
  insightsAssistantNow.usage = { used: 38, limit: 200, month: '2026-10-01', plan: 'Growth', words: '38 of 200 prompts used in October' }
  insightsAssistantNow.recent = []
  Object.assign(workspaceAssistantNow, { enabled: true, providers: { anthropic: true, openai: true }, explain: true, available: assistantProviders() })
  Object.assign(workspaceAssistantNow, { enabled: true, providers: { anthropic: true, openai: true }, explain: true })
  reportDatabasesNow.splice(0, reportDatabasesNow.length)
  reportDatasetsNow.splice(0, reportDatasetsNow.length)
  insightsCatalog.datasets.splice(2)                                                 // a query dataset added by a test is forgotten
  insightsSchedulesNow.splice(0, insightsSchedulesNow.length)
  const campaign = options.campaign ?? makeCampaign()
  let mfaEnabled = options.mfaEnabled ?? false
  const campaignState = { variants: options.runVariants, campaigns: options.campaigns ?? [campaign], tags: options.campaignTags, make: makeCampaign, audience: options.audience, audienceExportFails: options.audienceExportFails, metrics: options.metrics, activity: options.activity, activityFails: options.activityFails, estimate: options.estimate, steps: options.dripSteps, dripTestFails: options.dripTestFails, dripWarnings: options.dripWarnings, resumePlan: options.resumePlan }
  let listsNow: ContactList[] = [...(options.lists ?? contactLists)]
  let templatesNow: Template[] = [...(options.moreTemplates ?? []), ...templates]
  let membersNow: ListMember[] = [...listMembers]
  const consentPolicyNow = { ...consentPolicy }
  const attributionNow: AttributionSettings = JSON.parse(JSON.stringify(attributionSettings))
  let setupNow: WorkspaceSetup = { ...SAMPLE_SETUP_READY, ...options.setup }
  let jobsNow: ListImport[] = [...(options.listUploads ?? [])]
  const importDoneAt = new Map<string, number>()
  let journeyNow: Journey = makeJourney(options.journey)
  let journeySuppressionsNow: JourneySuppression[] = []
  let journeyAttentionNow: JourneyAttentionRow[] = options.journeyAttention ?? []
  let journeyVersionsNow: JourneyVersion[] = options.journeyVersions ?? [makeJourneyVersion()]
  const journeyGraphs = new Map<number, JourneyGraph>([[1, options.journeyGraph ?? BLANK_GRAPH]])
  // apps/journeys/graph.py name_references: a rule naming a list or segment carries its current name (null when gone)
  const namedGraph = (graph: JourneyGraph): JourneyGraph => ({
    ...graph,
    entry_rules: graph.entry_rules.map((rule) => {
      const definition = rule.rule_definition as { contact_list_id?: string; segment_id?: string }
      if (rule.entry_type === 'CUSTOMER_LIST' && definition.contact_list_id) return { ...rule, reference_name: listsNow.find((item) => item.id === definition.contact_list_id)?.name ?? null }
      if (rule.entry_type === 'SEGMENT_CHANGE' && definition.segment_id) return { ...rule, reference_name: audiences.find((item) => item.id === definition.segment_id)?.name ?? null }
      return rule
    }),
  })
  const journeyReadinessNow: JourneyReadiness = options.journeyReadiness ?? makeJourneyReadiness()
  const journeyTestResultNow: JourneyTestResult = options.journeyTestResult ?? makeJourneyTestResult()
  const journeysListNow: Journey[] = options.journeysList ?? journeyRows
  const journeyPerformanceNow = options.journeyPerformance === undefined
    ? { active_enrollment_count: 40, completed_count: 12, exited_count: 3 }
    : options.journeyPerformance
  const journeyMetricsNow: JourneyMetrics = options.journeyMetrics ?? makeJourneyMetrics()
  const journeyAudienceNow: JourneyAudience = options.journeyAudience ?? makeJourneyAudience()
  const journeyTrendNow: JourneyTrendWeek[] = options.journeyTrend ?? journeyTrendWeeks
  const journeyGeneratedCampaignsNow: JourneyGeneratedCampaignRow[] = options.journeyGeneratedCampaigns ?? journeyGeneratedCampaignRows
  const journeyActivityNow: JourneyActivityEntry[] = options.journeyActivity ?? journeyActivityEntries
  const journeyStartersNow: JourneyStarter[] = options.journeyStarters ?? journeyStarters
  let savedTemplatesNow: JourneyTemplate[] = (options.savedTemplates ?? []).map((row) => structuredClone(row))
  let securityNow: SecuritySettings = { ...security }
  let mailNow: MailServerSettings = { server: null, in_use: 'console', sender_profile: null, ...options.mailServer }
  const toolsState = workspaceToolsState(options.workspaceTools)
  const tagRows: PersonalizationTag[] = (options.tags ?? tags).map((item) => ({ ...item }))
  let deliverabilityServiceNow: DeliverabilityService = { configured: false, provider: 'MAILGUN_INSPECT', region: 'US', username: '', has_api_key: false, default_clients: [], image_blocking: false,
                                                           is_active: false, last_checked_at: null, last_check_ok: null, last_check_error: null, ...options.deliverabilityService }
  if (options.deliverabilityService?.has_api_key) deliverabilityServiceNow = { ...deliverabilityServiceNow, configured: true, is_active: true }
  const platformInspect = Boolean(options.platformInspect)
  const withUse = (service: DeliverabilityService): DeliverabilityService =>
    ({ ...service, platform_available: platformInspect, uses: service.configured ? 'OWN' : platformInspect ? 'PLATFORM' : null })
  deliverabilityServiceNow = withUse(deliverabilityServiceNow)
  const deliverabilityTests: DeliverabilityTest[] = [...(options.deliverabilityTests ?? [])]
  const deliverabilityAllowance = () => {
    const account = deliverabilityServiceNow.uses ?? null
    const planLimit = options.deliverabilityLimit === undefined ? 20 : options.deliverabilityLimit
    const limit = account === 'OWN' ? null : planLimit
    const note = account === 'OWN' ? 'Through your own Mailgun account: C360 does not limit them.' : planLimit === null ? 'Unlimited on the Growth plan.' : `${planLimit} a month on the Growth plan.`
    return { enabled: true, used: deliverabilityTests.length, limit, left: limit === null ? null : Math.max(0, limit - deliverabilityTests.length), month: '2026-10-01', plan: 'Growth',
             configured: account !== null, plan_limit: planLimit, added: 0, account, note }
  }

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = init.body && !(init.body instanceof FormData) ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const call = { url, method, headers, body }
    calls.push(call)
    const path = url.split('?')[0]

    if (/\/campaigns\/[^/]+\/suppressions\/export\.csv$/.test(path)) return new Response('contact,channel,reason\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (/\/campaigns\/[^/]+\/suppressions\/$/.test(path)) {                    // the campaign page's own view of the Suppressions rows
      const reason = new URL(url, 'http://test.local').searchParams.get('reason')
      const rows = toolsState.suppressions.filter((row) => !reason || row.group === reason)
      const groups = (['UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'BLOCKED'] as const).map((key) => ({ key, label: key === 'BLOCKED' ? 'Blocked by You' : key.charAt(0) + key.slice(1).toLowerCase(),
        count: toolsState.suppressions.filter((row) => row.group === key).length, email: 0, phone: 0, this_week: 0 }))
      return json({ count: rows.length, page: 1, page_size: 50, results: rows, summary: { total: toolsState.suppressions.length, this_week: 0, groups } })
    }
    // a journey's own suppressions, before the workspace tools answer every suppressions path
    const suppressionMatch = /\/journeys\/([^/]+)\/suppressions\/(?:([^/]+)\/)?$/.exec(path)
    if (suppressionMatch) {
      if (method === 'DELETE') {
        journeySuppressionsNow = journeySuppressionsNow.filter((row) => row.id !== suppressionMatch[2])
        return new Response(null, { status: 204 })
      }
      if (method === 'POST') {
        const given = String(body?.given ?? '')
        if (!given.includes('@') && !/^\+?\d{8,}$/.test(given) && !given.startsWith('p-')) {
          return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { given: ['No customer has that email address, mobile number or id.'] } }, 400)
        }
        journeySuppressionsNow = [{ id: `sup-${journeySuppressionsNow.length + 1}`, party_id: 'p-new', name: 'Dolores Alvarez', email: given.includes('@') ? given : null, given, note: String(body?.note ?? '') || null,
                                    created_at: '2026-10-09T10:00:00Z', created_by_name: 'Aby John' }, ...journeySuppressionsNow]
        return json({ added: true, party_id: 'p-new', exited: 1, suppressions: journeySuppressionsNow }, 201)
      }
      return json(journeySuppressionsNow)
    }
    const tools = handleWorkspaceTools({ path, url, method, body }, toolsState)
    if (tools) return tools
    if (path.endsWith('/legal/')) return json({ copyright_holder: 'Transaction Tree', year: 2026, terms: { title: 'Terms of Use', updated_at: '2026-10-09T10:00:00Z',
      body: '## 1. What C360 is\n\nCEP is a customer engagement platform.\n\n## 2. Your account\n\nYour account is personal.\n\n## 8. Contact\n\nAsk your workspace administrator.' } })
    if (path.endsWith('/auth/options/')) return json({ workspace: headers['X-Tenant'], sso_enabled: false, sso_enforced: false, sso_name: null, mfa_required: false, ...options.authOptions })
    if (path.endsWith('/auth/mfa/verify/')) {
      return body?.mfa_token === 'mfa-token-1' && body?.code === MFA_CODE ? json({ access: 'access-1', refresh: 'refresh-1' })
        : json({ type: 'about:blank', title: 'Authentication Failed', status: 401, detail: 'That code is not right. Codes change every 30 seconds; a recovery code works once.' }, 401)
    }
    if (path.endsWith('/auth/token/') && method === 'POST') {
      if (body?.password === 'needs-a-code') return json({ mfa_required: true, mfa_token: 'mfa-token-1' })
      return body?.password === 'correct-horse'
        ? json({ access: 'access-1', refresh: 'refresh-1' })
        : json({ type: 'about:blank', title: 'Authentication Failed', status: 401, detail: 'No active account' }, 401)
    }
    if (path.endsWith('/auth/set-password/')) return options.onSettingsWrite?.(call) ?? json(null, 204)
    // no view is registered for this yet: Django answers 404, which is what the reset form has to cope with
    if (path.endsWith('/auth/forgot-password/')) return options.onForgotPassword?.(call) ?? json({ title: 'Not Found', status: 404 }, 404)
    if (headers.Authorization !== 'Bearer access-1') return json({ title: 'Unauthorized', status: 401 }, 401)
    if (/\/(users|roles|api-clients)\//.test(path) && method !== 'GET') {
      const custom = options.onSettingsWrite?.(call)
      if (custom) return custom
      if (path.endsWith('/password-link/')) return json({ path: `/set-password?tenant=NWA&uid=dTI&token=${body?.send ? 'mailed-456' : 'abc-123'}`, expires_in_hours: 72, emailed: Boolean(body?.send), email_configured: true, email: 'devon@example.com' })
      if (path.endsWith('/revoke/')) return json({ ...apiKeys[0], status: 'REVOKED', revoked_at: '2026-09-18T10:00:00Z' })
      if (path.endsWith('/api-clients/')) return json({ ...apiKeys[0], ...(body as Partial<ApiKey>), id: 'key-new', key_prefix: 'cep_in_NeW456', key: 'cep_in_NeW456secretsecretsecret' }, 201)
      if (path.includes('/roles/')) return method === 'DELETE' ? json(null, 204) : json({ ...roles[1], ...(body as Partial<Role>), id: 'role-new' }, method === 'POST' ? 201 : 200)
      return json({ ...settingsUsers[1], ...(body as Partial<SettingsUser>) }, method === 'POST' ? 201 : 200)
    }
    if (path.endsWith('/auth/support-session/end/')) return json(null, 204)
    if (path.endsWith('/auth/mfa/') && method === 'POST') {
      if (body?.action === 'setup') return json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/CEP:aby.john%40aiintelekt.com?secret=JBSWY3DPEHPK3PXP&issuer=CEP' })
      if (body?.code !== MFA_CODE) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { code: ['That code is not right. Check the time on your phone and try the next code.'] } }, 400)
      mfaEnabled = body?.action === 'confirm'
      return json(mfaEnabled ? { enabled: true, recovery_codes: ['aaaa-bbbb-01', 'aaaa-bbbb-02', 'aaaa-bbbb-03'], access: 'access-1', refresh: 'refresh-1' } : { enabled: false })
    }
    if (path.endsWith('/auth/mfa/')) return json({ enabled: mfaEnabled, required: Boolean(options.me?.mfa_setup_required), recovery_codes_left: mfaEnabled ? 10 : 0, sso: false, confirmed_at: mfaEnabled ? '2026-09-18T10:00:00Z' : null })
    if (path.endsWith('/delivery-providers/catalogue/')) return json(providerCatalogue)
    if (/\/delivery-providers\/[^/]+\/check\/$/.test(path)) return json({ ok: !options.providerCheckFails, detail: options.providerCheckFails ? 'Postal refused the API key (InvalidServerAPIKey).' : null })
    if (path.endsWith('/delivery-providers/') && method === 'POST') {
      if (!body?.secret) return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { secret: ['API key is required.'] } }, 400)
      const { secret, ...rest } = body as Record<string, unknown>
      void secret
      return json({ ...deliveryProviders[0], ...rest, id: 'prov-new', has_secret: true, has_transactional_secret: Boolean(body.transactional_secret), is_default: false, webhook_url: 'http://localhost:8000/api/v1/webhooks/delivery/NWA/prov-new/tok/' }, 201)
    }
    if (/\/delivery-providers\/[^/]+\/rotate-webhook\/$/.test(path)) return json({ ...deliveryProviders[0], webhook_url: 'https://cep.example.com/api/v1/webhooks/delivery/NWA/prov-postal/rotated-token/' })
    if (path.includes('/delivery-providers/') && method === 'PATCH') return json({ ...deliveryProviders[0], has_transactional_secret: Boolean(options.providerHasTransactionalKey), ...(body as Partial<DeliveryProvider>) })
    if (path.endsWith('/delivery-providers/')) return json((options.texts ? [...deliveryProviders, textEngine] : deliveryProviders).map((item) => item.id === 'prov-postal' ? { ...item, has_transactional_secret: Boolean(options.providerHasTransactionalKey) } : item))
    if (path.endsWith('/sms-inbound/')) return json(options.texts ? smsReplies : [])
    if (/\/delivery-senders\/[^/]+\/verify\/$/.test(path)) return json({ ok: true, detail: null, to: body?.to, verification_status: 'VERIFIED' })
    if (path.endsWith('/delivery-senders/') && method === 'POST') return json({ ...deliverySenders[0], ...(body as Partial<DeliverySender>), id: 'snd-new', verification_status: 'PENDING', is_default: false }, 201)
    if (path.endsWith('/delivery-senders/')) return json(options.texts ? [...deliverySenders, textSender] : deliverySenders)
    if (path.endsWith('/results/')) return json(options.texts ? textResults : runResults)
    if (/\/campaign-runs\/[^/]+\/recipients\/export\.csv$/.test(path)) return new Response('address,status\n' + runRecipients.map((row) => `${row.address},${row.status}`).join('\n'), { status: 200, headers: { 'Content-Type': 'text/csv' } })
    if (/\/campaign-runs\/[^/]+\/recipients\/\d+\/check\/$/.test(path)) {
      return json({ provider: 'Postal (self-hosted)', provider_type: 'POSTAL', id: 3913, message_id: 'postal-7205256a6e7d', status: 'Sent', held: false, hold_expiry: null, last_delivery_attempt: '2026-09-18T10:01:30Z',
                    to: 'brianna@example.com', from: 'rewards@mail.northwindapparel.example', subject: 'Fall Rewards', sent_at: '2026-09-18T10:00:20Z',
                    deliveries: [{ at: '2026-09-18T10:01:30Z', status: 'Sent', details: 'Message for brianna@example.com accepted by mx.example.com', output: '250 2.0.0 OK', sent_with_ssl: true, time: 0.4 }] })
    }
    const recipientMatch = path.match(/\/campaign-runs\/[^/]+\/recipients\/(\d+)\/$/)
    if (recipientMatch) {
      const row = runRecipients.find((item) => item.id === Number(recipientMatch[1])) ?? runRecipients[0]
      return json({ recipient: row, callbacks: row.status === 'SUBMITTED' ? 0 : 2,
                    events: [{ at: row.created_at, kind: 'cep', what: 'Queued', detail: null }, { at: row.submitted_at, kind: 'cep', what: 'Handed to the engine', detail: null },
                             ...(row.delivered_at ? [{ at: row.delivered_at, kind: 'callback', what: 'MessageDelivered', detail: 'PROCESSED' }] : []),
                             ...(row.failed_at || row.status === 'FAILED' ? [{ at: row.submitted_at, kind: 'cep', what: 'Failed', detail: row.status_reason }] : [])],
                    log: [{ id: 501, at: row.submitted_at, direction: 'OUT', outcome: row.status === 'FAILED' ? 'REJECTED' : 'OK', response_status: 200, error: row.status_reason }],
                    standing: { blocked: row.status === 'BOUNCED', block_reason: row.status === 'BOUNCED' ? 'HARD_BOUNCE' : null, hard_bounces: row.status === 'BOUNCED' ? 1 : 0, soft_bounces: 0, complaints: 0, consent: 'OPTED_IN', opt_out_method: null } })
    }
    if (/\/campaign-runs\/[^/]+\/recipients\/$/.test(path)) {
      const params = new URL(url, 'http://test.local').searchParams
      const status = params.get('status'), q = (params.get('q') ?? '').toLowerCase()
      const listed = options.recipientRows ?? runRecipients
      const rows = listed.filter((row) => (!status || status.split(',').includes(row.status)) && (!q || row.address.includes(q) || `${row.first_name} ${row.last_name}`.toLowerCase().includes(q)))
      const byStatus = listed.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {})
      return json({ run: { id: 'r1', run_number: 1, status: 'COMPLETED', test_mode: false, family: 'EMAIL' }, count: rows.length, page: 1, page_size: 50, results: rows, by_status: byStatus,
                    statuses: ['QUEUED', 'SUBMITTED', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'NOT_SENT'] })
    }
    if (/\/campaign-runs\/[^/]+\/skipped\/$/.test(path)) {
      // GET /campaign-runs/{id}/skipped/: who one run left out, filtered by reason and q, paged
      const params = new URL(url, 'http://test.local').searchParams
      const reason = params.get('reason'), q = (params.get('q') ?? '').toLowerCase()
      const page = Number(params.get('page') ?? 1), size = Number(params.get('page_size') ?? 50)
      const all = options.skippedPeople ?? skippedPeople
      const rows = all.filter((row) => (!reason || row.reason === reason) && (!q || `${row.party_id} ${row.first_name} ${row.last_name} ${row.address}`.toLowerCase().includes(q)))
      const byReason = all.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.reason]: (acc[row.reason] ?? 0) + 1 }), {})
      return json({ run: { id: /campaign-runs\/([^/]+)\//.exec(path)?.[1], run_number: 1, status: 'COMPLETED', test_mode: false, family: 'EMAIL' }, count: rows.length, page, page_size: size,
                    results: rows.slice((page - 1) * size, page * size), by_reason: byReason })
    }
    if (path.endsWith('/workspace/mail-server/test/')) {
      const ok = mailNow.server?.host !== 'smtp.broken.example'
      const sender = mailNow.server?.campaign_sender ? { id: 'snd-smtp', display_name: mailNow.server.from_name ?? mailNow.server.from_email, from_address: mailNow.server.from_email, verification_status: ok ? 'VERIFIED' as const : 'PENDING' as const, is_default: false } : null
      mailNow = { ...mailNow, sender_profile: sender, server: mailNow.server && { ...mailNow.server, last_tested_at: '2026-09-18T10:00:00Z', last_test_ok: ok, last_test_error: ok ? null : 'ConnectionRefusedError: [Errno 111]' } }
      return json({ ok, error: ok ? null : 'ConnectionRefusedError: [Errno 111]', to: body?.to, sender_profile: sender })
    }
    if (path.endsWith('/journeys/condition-fields/')) {
      return json({
        customer: [{ key: 'customer:first_name', label: 'First Name', type: 'text' }, { key: 'customer:email', label: 'Email Address', type: 'text' },
                   { key: 'customer:country', label: 'Country', type: 'text' }, { key: 'customer:last_purchase_at', label: 'Last Purchase Date', type: 'date' },
                   { key: 'customer:purchase_count', label: 'Number of Purchases', type: 'number' }],
        attributes: [{ key: 'attr:loyalty_tier', label: 'Loyalty Tier', type: 'text', customers: 18240, values: ['Silver', 'Gold', 'Platinum'] },
                     { key: 'attr:customer_status', label: 'Customer Status', type: 'text', customers: 20100, values: ['New', 'Active', 'Lapsed'] },
                     { key: 'attr:renewal_date', label: 'Renewal Date', type: 'date', customers: 9120, values: null },
                     { key: 'attr:timezone', label: 'Timezone', type: 'text', customers: 11980, values: null }],
        events: [{ key: 'event:PURCHASE', label: 'Purchase', seen: 1240, properties: ['amount', 'store'] }, { key: 'event:CART_ABANDON', label: 'Abandoned Cart', seen: 310, properties: ['cart_value'] }],
        lists: [{ key: 'list:cl-1', label: 'Do Not Contact' }],
        segments: [{ key: 'segment:seg-1', label: 'VIP Customers' }],
      })
    }
    if (path.endsWith('/journeys/condition-count/') && method === 'POST') return json({ matching: 218, total: 20100, sampled: false })
    if (/\/journeys\/[^/]+\/condition-count\/$/.test(path) && method === 'POST') return json({ matching: 1284, total: 3412, sampled: false })
    if (path.endsWith('/journeys/date-attributes/')) {
      return json([{ key: 'birth_date', label: 'Birth Date', customers: 18240 }, { key: 'membership_date', label: 'Membership Date', customers: 9120 }])
    }
    if (path.endsWith('/workspace/events/recent/')) {
      const query = new URL(url, 'http://test.local').searchParams
      const type = query.get('type')
      const q = (query.get('q') ?? '').toLowerCase()
      return json({ results: journeyEvents.filter((row) => (!type || row.event_type === type) && (!q || JSON.stringify(row).toLowerCase().includes(q))) })
    }
    if (path.endsWith('/workspace/events/')) return json(eventsSettings)
    if (path.endsWith('/attribution/settings/')) {
      if (method === 'PUT') {
        if (body && 'click_days' in body && !attributionNow.choices.click_days.includes(Number(body.click_days))) return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { click_days: 'Choose one of the offered windows.' } }, 400)
        const next = { ...body } as Record<string, unknown>
        for (const key of ['email_cost_per_1000', 'text_cost_per_1000']) if (key in next) next[key] = next[key] === null || next[key] === '' ? null : Number(next[key])
        Object.assign(attributionNow, next)
        if (next.enabled && !attributionNow.enabled_at) attributionNow.enabled_at = '2026-10-04T09:00:00Z'
      }
      return json(attributionNow)
    }
    if (path.endsWith('/attribution/orders/')) {
      const status = new URL(url, 'http://test').searchParams.get('status')
      return json({ results: attributedOrders.filter((row) => !status || row.status === status) })
    }
    if (path.endsWith('/attribution/recalculate/')) return json({ reset: 4, attributed: 3, unattributed: 1, waiting: 0, campaigns: 6, remaining: 0, full: true })
    if (path.endsWith('/workspace/consent-policy/')) {
      if (method === 'PUT') Object.assign(consentPolicyNow, body ?? {}, { attestation_preview: String((body?.attestation as string) ?? consentPolicyNow.attestation).replace('{workspace}', 'Northwind Apparel') })
      return json(consentPolicyNow)
    }
    if (path.endsWith('/workspace/mail-server/')) {
      if (method === 'DELETE') { mailNow = { ...mailNow, server: null, sender_profile: null, in_use: 'console' }; return json(null, 204) }
      if (method === 'PUT') {
        if (body?.from_email === 'bad') return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { from_email: ['Enter a valid email address.'] } }, 400)
        const { password, ...rest } = body as Record<string, unknown>
        const server = { host: '', port: 587, security: 'STARTTLS', username: null, from_name: null, reply_to: null, is_active: true, campaign_sender: false, last_tested_at: null, last_test_ok: null, last_test_error: null,
                         ...(mailNow.server ?? {}), ...rest, has_password: Boolean(password) || Boolean(mailNow.server?.has_password) } as NonNullable<MailServerSettings['server']>
        const sender = server.campaign_sender ? { id: 'snd-smtp', display_name: server.from_name ?? server.from_email, from_address: server.from_email, verification_status: server.last_test_ok ? 'VERIFIED' as const : 'PENDING' as const, is_default: false } : null
        mailNow = { ...mailNow, in_use: 'tenant', server, sender_profile: sender }
      }
      return json(mailNow)
    }
    if (path.endsWith('/deliverability/service/check/')) {
      deliverabilityServiceNow = { ...deliverabilityServiceNow, last_checked_at: '2026-10-02T09:00:00Z', last_check_ok: true, last_check_error: null }
      return json({ ok: true, detail: null })
    }
    if (path.endsWith('/deliverability/service/')) {
      if (method === 'PUT') {
        const input = (body ?? {}) as Record<string, unknown>
        const credentials = Boolean(input.username || input.api_key || deliverabilityServiceNow.has_api_key)
        if (!credentials && platformInspect) {
          deliverabilityServiceNow = { ...deliverabilityServiceNow, default_clients: (input.default_clients as string[]) ?? [], image_blocking: Boolean(input.image_blocking) }
          return json(deliverabilityServiceNow)
        }
        if (!deliverabilityServiceNow.has_api_key && !input.api_key) return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { api_key: ['Enter the Mailgun Inspect API key.'] } }, 400)
        deliverabilityServiceNow = withUse({ ...deliverabilityServiceNow, region: (input.region as 'US' | 'EU') ?? 'US', username: String(input.username ?? ''), default_clients: (input.default_clients as string[]) ?? [],
                                     image_blocking: Boolean(input.image_blocking), is_active: input.is_active !== false, has_api_key: true, configured: true })
        return json(deliverabilityServiceNow)
      }
      if (method === 'DELETE') {
        deliverabilityServiceNow = withUse({ ...deliverabilityServiceNow, configured: false, has_api_key: false, is_active: false, username: '', default_clients: [] })
        return json(null, 204)
      }
      return json(deliverabilityServiceNow)
    }
    if (path.endsWith('/deliverability/clients/')) return json(deliverabilityServiceNow.uses ? { clients: inspectClients, detail: null } : { clients: [], detail: 'No inbox-preview account is set up.' })
    if (path.endsWith('/deliverability/allowance/')) return json(deliverabilityAllowance())
    if (path.includes('/templates/') && path.endsWith('/deliverability-tests/')) {
      if (method === 'POST') {
        const allowance = deliverabilityAllowance()
        if (!allowance.configured) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'No inbox-preview account is set up. Add the Mailgun Inspect account under Settings → Delivery → Deliverability Testing.' }, 409)
        if (allowance.left === 0) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: `This workspace has used its ${allowance.limit} deliverability tests for the month. Testing resumes next month, or ask for a plan upgrade.` }, 409)
        const made: DeliverabilityTest = { ...finishedDeliverabilityTest, id: `dt-${deliverabilityTests.length + 2}`, template: path.split('/templates/')[1].split('/')[0], template_version: 3, status: 'PENDING', completed_at: null,
                                           requested_at: '2026-10-02T09:30:00Z', summary: { clients: 5, complete: 0, failed: 0, processing: 5 }, previews: inspectClients.map((c) => preview(c, 'PROCESSING')) }
        deliverabilityTests.unshift(made)
        return json(made, 201)
      }
      return json({ tests: deliverabilityTests.map((t) => ({ ...t, previews: [] })), allowance: deliverabilityAllowance() })
    }
    if (path.includes('/deliverability-tests/')) {
      const id = path.split('/deliverability-tests/')[1].replace(/\/$/, '')
      const at = deliverabilityTests.findIndex((t) => t.id === id)
      if (at < 0) return json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'No such test.' }, 404)
      if (method === 'DELETE') { deliverabilityTests.splice(at, 1); return json(null, 204) }
      const found = deliverabilityTests[at]
      if (found.status === 'PENDING') {                                                     // the next read finishes it, as Inspect would in a minute
        deliverabilityTests[at] = { ...found, status: 'COMPLETE', completed_at: '2026-10-02T09:33:00Z', summary: { clients: 5, complete: 5, failed: 0, processing: 0 }, previews: inspectClients.map((c) => preview(c)) }
      }
      return json(deliverabilityTests[at])
    }
    if (path.endsWith('/workspace/usage/')) return json(usage)
    if (path.endsWith('/workspace/invoices/')) return json(invoices)
    if (path.endsWith('/workspace/support-access/')) return json(supportAccess)
    if (path.endsWith('/workspace/security/')) {
      if (method === 'PUT') {
        const custom = options.onSecurityWrite?.(call)
        if (custom) return custom
        const provider = body && 'identity_provider' in body ? (body.identity_provider as Record<string, unknown> | null) : undefined
        securityNow = { ...securityNow, ...(typeof body?.require_mfa === 'boolean' ? { require_mfa: body.require_mfa } : {}),
                        ...(provider === undefined ? {} : { identity_provider: provider === null ? null : ({ ...provider, client_secret: undefined, has_client_secret: Boolean(provider.client_secret) } as never) }) }
      }
      return json(securityNow)
    }
    if (path.endsWith('/workspace/setup/')) {
      if (method === 'PUT') setupNow = { ...setupNow, dismissed: Boolean((body as { dismissed?: boolean } | null)?.dismissed) }
      return json(setupNow)
    }
    if (path.endsWith('/workspace/')) return json(workspace)
    if (/\/integrations\/[^/]+\/(pause|resume)\/$/.test(path)) {
      const item = integrations.find((row) => path.includes(`/${row.id}/`)) ?? integrations[0]
      return json({ ...item, status: path.endsWith('/pause/') ? 'PAUSED' : 'ACTIVE', health: path.endsWith('/pause/') ? 'paused' : 'healthy', breaker_open_seconds: 0 })
    }
    if (/\/integrations\/[^/]+\/metrics\/$/.test(path)) {
      const minute = 60_000
      const at = (minutesAgo: number) => new Date(Math.floor((Date.now() - minutesAgo * minute) / (15 * minute)) * 15 * minute).toISOString()
      const busy = path.includes('/int-postal/')
      return json({ hours: 24, step_minutes: 15, buckets: busy
        ? [{ bucket: at(30), calls: 120, ok: 110, rejected: 0, failed: 10, throttled: 0, p95_ms: 640 }, { bucket: at(15), calls: 80, ok: 70, rejected: 0, failed: 4, throttled: 6, p95_ms: 410 }]
        : [] })
    }
    if (/\/integrations\/log\/\d+\/$/.test(path)) {
      const found = integrationLog.find((row) => path.endsWith(`/${row.id}/`))
      return found ? json(found) : json({ type: 'about:blank', title: 'Not found', status: 404 }, 404)
    }
    if (path.endsWith('/integrations/log/')) {
      const query = new URL(url, 'http://test.local').searchParams
      const rows = integrationLog.filter((row) => (!query.get('integration') || row.integration_id === query.get('integration')) && (!query.get('direction') || row.direction === query.get('direction'))
        && (query.get('failed') !== '1' || row.outcome !== 'OK') && (!query.get('q') || row.correlation_id === query.get('q') || row.related_ref === query.get('q')))
      const pageSize = [10, 25, 50, 100].includes(Number(query.get('page_size'))) ? Number(query.get('page_size')) : 25
      const pageNo = Math.max(1, Number(query.get('page') ?? 1))
      const all = options.integrationLogCount ? Array.from({ length: options.integrationLogCount }, (_, index) => ({ ...rows[index % rows.length], id: 1000 + index, correlation_id: `corr-${index}` })) : rows
      return json({ results: all.slice((pageNo - 1) * pageSize, pageNo * pageSize).map(({ request_headers: _rh, request_body: _rb, response_headers: _sh, response_body: _sb, worker: _w, ...row }) => row), count: all.length, page: pageNo, page_size: pageSize })
    }
    if (/\/integrations\/log\/\d+\/retry\/$/.test(path) && method === 'POST') return json({ queued: true, execution: 42, run: 'r1', campaign: 'c1', note: "It goes out on the dispatcher's next pass; the new attempt appears in the log." })
    if (/\/integrations\/log\/\d+\/replay\/$/.test(path) && method === 'POST') return json({ received: 1, applied: 1, ignored: 0, unmatched: 0, failed: 0, duplicate: 0, replayed: 2 })
    if (/\/integrations\/[^/]+\/alerts\/$/.test(path) && method === 'POST') return json({ id: path.split('/').at(-3), alerts_enabled: Boolean((body as { enabled?: boolean } | null)?.enabled) })
    if (path.endsWith('/integrations/')) return json(integrations)
    if (path.endsWith('/search/')) {
      const q = (new URL(url, 'http://test.local').searchParams.get('q') ?? '').toLowerCase()
      if (q.length < 2) return json({ q, campaigns: [], lists: [], templates: [] })
      return json({
        q,
        campaigns: campaignState.campaigns.filter((item) => item.name.toLowerCase().includes(q) && item.status !== 'ARCHIVED').slice(0, 6)
          .map((item) => ({ id: item.id, name: item.name, code: item.code, channel: item.channel, status: item.display_status, status_label: item.display_status_label, setup_complete: item.setup_complete })),
        lists: listsNow.filter((item) => item.name.toLowerCase().includes(q) && item.status !== 'DRAFT').slice(0, 6)
          .map((item) => ({ id: item.id, name: item.name, member_count: item.member_count, list_environment: item.list_environment, status: item.status })),
        templates: templatesNow.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 6).map((item) => ({ id: item.id, name: item.name, channel: item.channel, status: item.status })),
      })
    }
    if (path.endsWith('/users/')) return json(settingsUsers)
    if (path.endsWith('/roles/permissions/')) return json(permissionCatalogue)
    if (path.endsWith('/roles/')) return json(roles)
    if (path.endsWith('/api-clients/scopes/')) return json({ scopes: ['campaign:view', 'campaign:edit', 'events:ingest'] })
    if (path.endsWith('/api-clients/')) return json(apiKeys)
    if (path.endsWith('/workspace/ai-assistant/check/')) {
      const provider = workspaceAssistantNow.available.find((p) => p.key === ((body ?? {}) as { provider: string }).provider)
      if (provider?.own) provider.own = { ...provider.own, last_check_ok: true, last_checked_at: '2026-10-16T10:00:00Z', last_check_error: null }
      return json({ ok: true, detail: 'Connected. gpt-5, gpt-5-mini available.' })
    }
    if (path.endsWith('/workspace/ai-assistant/')) {
      if (method === 'PUT') {
        const put = (body ?? {}) as Record<string, unknown>
        Object.assign(workspaceAssistantNow, { ...(typeof put.enabled === 'boolean' ? { enabled: put.enabled } : {}), ...(typeof put.explain === 'boolean' ? { explain: put.explain } : {}),
          ...(put.providers ? { providers: { ...workspaceAssistantNow.providers, ...(put.providers as object) } } : {}) })
        for (const [key, value] of Object.entries((put.own ?? {}) as Record<string, { api_key?: string; model_reports?: string; model_fast?: string } | null>)) {
          const provider = workspaceAssistantNow.available.find((p) => p.key === key)
          if (!provider) continue
          if (value === null) provider.own = null
          else if (!provider.own && !value.api_key) return json({ type: 'about:blank', title: 'Check the highlighted fields', status: 400, errors: { api_key: "Give the provider's API key." } }, 400)
          else provider.own = { configured: true, model_reports: value.model_reports ?? provider.own?.model_reports ?? null, model_fast: value.model_fast ?? provider.own?.model_fast ?? null,
            last_checked_at: null, last_check_ok: null, last_check_error: null }
        }
      }
      return json(workspaceAssistantNow)
    }
    if (path.includes('/workspace/report-databases/')) {
      const withDatasets = (db: MockDatabase) => ({ ...db, datasets: reportDatasetsNow.filter((d) => d.connection_id === db.id) })
      if (path.endsWith('/workspace/report-databases/') && method === 'GET') return json({ databases: reportDatabasesNow.map(withDatasets), grant_examples: GRANTS, ready: true })
      if (path.endsWith('/workspace/report-databases/') && method === 'POST') {
        const posted = body as Record<string, unknown>
        if (!posted.password) return json({ type: 'about:blank', title: 'Check the highlighted fields', status: 400, errors: { password: "Give the account's password." } }, 400)
        const made = mockDatabase(posted, `db-${reportDatabasesNow.length + 1}`)
        reportDatabasesNow.push(made)
        return json(made, 201)
      }
      if (path.endsWith('/workspace/report-databases/test/')) return json({ test: String((body as { host?: string }).host ?? '').includes('loyalty') ? WRITER_TEST : GOOD_TEST })
      if (path.endsWith('/workspace/report-databases/targets/')) return json({ databases: reportDatabasesNow.filter((d) => d.usable).map((d) => ({ id: d.id, name: d.name, engine: d.engine, engine_name: d.engine_name, database_name: d.database_name, schema_name: d.schema_name })) })
      const dataset = /\/workspace\/report-databases\/datasets\/([\w-]+)\/$/.exec(path)
      if (dataset) {
        const at = reportDatasetsNow.findIndex((d) => d.id === dataset[1])
        if (at < 0) return json({ type: 'about:blank', title: 'No such dataset.', status: 404 }, 404)
        if (method === 'DELETE') { reportDatasetsNow.splice(at, 1); return new Response(null, { status: 204 }) }
        if (method === 'PUT') { const put = body as Partial<MockDataset>; reportDatasetsNow[at] = { ...reportDatasetsNow[at], ...put, field_count: (put.fields ?? reportDatasetsNow[at].fields).length, row_version: reportDatasetsNow[at].row_version + 1 } }
        return json(reportDatasetsNow[at])
      }
      const one = /\/workspace\/report-databases\/([\w-]+)\/(test\/|sources\/|sources\/([\w]+)\/|preview\/|join-check\/|datasets\/|query\/run\/|query\/write\/|query\/dataset\/)?$/.exec(path)
      if (one) {
        const db = reportDatabasesNow.find((d) => d.id === one[1])
        if (!db) return json({ type: 'about:blank', title: 'No such database.', status: 404 }, 404)
        const tail = one[2] ?? ''
        if (tail === 'test/') { db.last_tested_at = '2026-10-16T10:00:00Z'; return json({ test: db.test, database: withDatasets(db) }) }
        if (tail === 'sources/') return json({ sources: SOURCES.map((s) => ({ ...s, mapped_as: reportDatasetsNow.find((d) => d.connection_id === db.id && d.source === s.name)?.label ?? null })) })
        if (tail.startsWith('sources/')) {
          const cols = one[3] === 'stores' ? STORE_COLUMNS : COLUMNS
          return json({ source: one[3], columns: cols, sample: { columns: cols.map((c) => c.column), rows: [one[3] === 'stores' ? [12, 'Downtown', 'Portland'] : ['2026-10-15', 'Downtown', 9420, 'ann@example.com', 12]] }, mapped_as: null })
        }
        if (tail === 'join-check/') return json({ base_rows: 1284, joined_rows: 1284, matched_rows: 1280, multiplies: false, factor: 1 })
        if (tail === 'query/run/' || tail === 'query/dataset/') {
          const sql = String((body as { sql?: string }).sql ?? '').trim()
          if (/;\s*\S/.test(sql.replace(/;\s*$/, ''))) return json({ type: 'about:blank', title: 'Check the highlighted fields', status: 400, errors: { sql: 'One statement at a time: a second statement after a semicolon is not allowed.' } }, 400)
          if (/\bdelete\b/i.test(sql)) return json({ type: 'about:blank', title: 'Check the highlighted fields', status: 400, errors: { sql: 'The word DELETE is not allowed in a report query. The account could not write anyway, and the engine will not try.' } }, 400)
          const fields = [{ column: 'store_name', label: 'Store Name', type: 'string' as const, role: 'dimension' as const, aggregates: [] as const, format: null, sensitivity: 'NORMAL' as const, table: 't0' },
            { column: 'net_sales', label: 'Net Sales', type: 'number' as const, role: 'measure' as const, aggregates: ['sum' as const, 'avg' as const, 'min' as const, 'max' as const], format: 'money' as const, sensitivity: 'NORMAL' as const, table: 't0' }]
          if (tail === 'query/run/') return json({ columns: fields.map((f) => ({ column: f.column, column_type: f.type === 'number' ? 'decimal' : 'varchar', mappable: true, type: f.type, role: f.role, aggregates: f.aggregates, format: f.format })), rows: [['Downtown', 28660], ['Riverside', 19802]], truncated: false, ms: 212, sql, fields })
          const posted = body as { label: string }
          const made: MockDataset = { id: `ds-${reportDatasetsNow.length + 1}`, connection_id: db.id, key: `x_${posted.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, label: posted.label, description: null, source: 'query', joins: [], kind: 'query', query_sql: sql,
            primary_key: null, time_field: null, fields: fields.map((f) => ({ ...f, aggregates: [...f.aggregates], key: f.column })), field_count: 2, pii_count: 0, reports: 0, status: 'ACTIVE', updated_at: '2026-10-17T10:00:00Z', row_version: 1 }
          reportDatasetsNow.push(made)
          insightsCatalog.datasets.push({ key: made.key, label: made.label, description: null, component: { key: 'cep', name: 'Engagement' }, primary_key: 'store_name', time_field: null, freshness: 'LIVE',
            fields: made.fields.map((f) => ({ key: f.key as string, label: f.label, type: f.type, role: f.role, aggregates: [...f.aggregates], operators: ['=', '!='], buckets: [], format: f.format, sensitivity: 'NORMAL' })) } as never)
          return json(made, 201)
        }
        if (tail === 'query/write/') return json({ id: 'ask-sql', sql: "SELECT s.name AS store_name, SUM(l.net_amount) AS net_sales\nFROM sales_lines l JOIN stores s ON s.id = l.store_id\nGROUP BY s.name", note: 'Paid lines only was read as status = PAID.', message: null })
        if (tail === 'preview/') {
          const fields = ((body as { fields?: { label: string; column: string; table?: string; sensitivity: string }[] }).fields ?? []).filter((f) => f.sensitivity !== 'CONFIDENTIAL')
          const sample: Record<string, unknown> = { sale_day: '2026-10-15', store_name: 'Downtown', net_sales: 9420, cashier_email: 'ann@example.com', store_id: 12, 'id': 12, 'name': 'Downtown', 'city': 'Portland' }
          return json({ columns: fields.map((f) => ({ key: `${f.table ?? 't0'}.${f.column}`, label: f.label, masked: f.sensitivity === 'PII' })), rows: [fields.map((f) => (f.sensitivity === 'PII' ? '•••••' : sample[f.column]))] })
        }
        if (tail === 'datasets/' && method === 'POST') {
          const posted = body as { label: string; description?: string; source: string; joins?: MockDataset['joins']; primary_key?: string | null; time_field?: string | null; fields: MockDataset['fields'] }
          const made: MockDataset = { id: `ds-${reportDatasetsNow.length + 1}`, connection_id: db.id, key: `x_${posted.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, label: posted.label, description: posted.description || null, source: posted.source,
            joins: posted.joins ?? [], kind: 'table', query_sql: null, primary_key: posted.primary_key ?? null, time_field: posted.time_field ?? null, fields: posted.fields.map((f) => ({ ...f, key: f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') })), field_count: posted.fields.length,
            pii_count: posted.fields.filter((f) => f.sensitivity === 'PII').length, reports: 0, status: 'ACTIVE', updated_at: '2026-10-16T10:00:00Z', row_version: 1 }
          reportDatasetsNow.push(made)
          return json(made, 201)
        }
        if (method === 'DELETE') { reportDatabasesNow.splice(reportDatabasesNow.indexOf(db), 1); return new Response(null, { status: 204 }) }
        if (method === 'PUT') { const put = body as Record<string, unknown>; Object.assign(db, { name: put.name ?? db.name, host: put.host ?? db.host, row_version: db.row_version + 1 }) }
        return json(withDatasets(db))
      }
    }
    if (path.includes('/insights/')) {
      if (path.endsWith('/insights/catalog/')) return json(insightsCatalog)
      if (path.endsWith('/insights/assistant/')) return json(insightsAssistantNow)
      if (path.endsWith('/insights/assistant/ask/')) {
        const asked = (body ?? {}) as { prompt: string; model: string }
        return json(assistantReply(asked.prompt, asked.model))
      }
      const opened = /\/insights\/assistant\/([\w-]+)\/open\/$/.exec(path)
      if (opened && method === 'POST') {
        const made = { ...insightsSummary, id: 'rep-ai', name: 'Sent and Delivered by Campaign' }
        insightsReportsNow.push(made)
        return json({ ...insightsReport, ...made, row_version: 1, can_edit: true }, 201)
      }
      if (path.endsWith('/insights/schedules/') && method === 'POST') {
        const posted = body as { kind?: 'report' | 'dashboard'; item_id: string; every: string; on_day: number | null; at_time: string; format: 'xlsx' | 'csv' | 'pdf'; recipients: string[]; subject: string | null; note: string | null }
        const made: InsightsSchedule = { id: `sch-${insightsSchedulesNow.length + 1}`, kind: posted.kind ?? 'report', item_id: posted.item_id,
          item_name: (posted.kind === 'dashboard' ? insightsDashboardsNow.find((d) => d.id === posted.item_id)?.name : insightsReportsNow.find((r) => r.id === posted.item_id)?.name) ?? null, view_type: 'grid', item_gone: false,
          owner_user_id: 'u1', owner_name: 'Aby John', every: posted.every as InsightsSchedule['every'], on_day: posted.on_day, at_time: posted.at_time, format: posted.format, recipients: posted.recipients, subject: posted.subject, note: posted.note,
          status: 'ACTIVE', failures: 0, last_sent_at: null, last_outcome: null, last_detail: null, next_run_at: '2026-10-19T12:00:00Z', words: scheduleWords(posted.every, posted.on_day, posted.at_time), row_version: 1,
          created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z' }
        insightsSchedulesNow.push(made)
        return json(made, 201)
      }
      if (path.endsWith('/insights/schedules/')) {
        const item = new URL(url, 'http://test.local').searchParams.get('item')
        return json({ schedules: insightsSchedulesNow.filter((s) => !item || s.item_id === item), mail_configured: true })
      }
      const scheduleState = /\/insights\/schedules\/([\w-]+)\/(pause|resume|test)\/$/.exec(path)
      if (scheduleState && method === 'POST') {
        const found = insightsSchedulesNow.find((s) => s.id === scheduleState[1])
        if (!found) return json({ detail: 'No such schedule.' }, 404)
        if (scheduleState[2] === 'test') return json({ outcome: 'OK', detail: null, recipients: 1, rows: 3 })
        Object.assign(found, scheduleState[2] === 'pause' ? { status: 'PAUSED', next_run_at: null } : { status: 'ACTIVE', failures: 0, next_run_at: '2026-10-19T12:00:00Z' }, { row_version: found.row_version + 1 })
        return json(found)
      }
      const oneSchedule = /\/insights\/schedules\/([\w-]+)\/$/.exec(path)
      if (oneSchedule && method === 'DELETE') {
        const at = insightsSchedulesNow.findIndex((s) => s.id === oneSchedule[1])
        if (at >= 0) insightsSchedulesNow.splice(at, 1)
        return new Response(null, { status: 204 })
      }
      if (oneSchedule && method === 'PUT') {
        const found = insightsSchedulesNow.find((s) => s.id === oneSchedule[1])
        if (!found) return json({ detail: 'No such schedule.' }, 404)
        const put = body as Partial<InsightsSchedule>
        Object.assign(found, put, { words: scheduleWords(put.every ?? found.every, put.on_day ?? found.on_day, put.at_time ?? found.at_time), row_version: found.row_version + 1 })
        return json(found)
      }
      if (path.endsWith('/insights/runs/')) {
        const outcome = new URL(url, 'http://test.local').searchParams.get('outcome')
        const runs = [
          { id: 3, started_at: '2026-10-15T09:41:00Z', kind: 'run', outcome: 'OK', detail: null, duration_ms: 42, row_count: 3, dataset: 'messages', dataset_label: 'Messages', report_id: 'rep-1', report_name: 'Sends by campaign', report_version: 2, user_id: 'u1', user_name: 'Aby John' },
          { id: 2, started_at: '2026-10-15T09:40:00Z', kind: 'preview', outcome: 'OK', detail: null, duration_ms: 38, row_count: 3, dataset: 'messages', dataset_label: 'Messages', report_id: null, report_name: null, report_version: null, user_id: 'u1', user_name: 'Aby John' },
          { id: 1, started_at: '2026-10-15T08:02:00Z', kind: 'export', outcome: 'TIMEOUT', detail: '15 s statement timeout', duration_ms: 15004, row_count: null, dataset: 'messages', dataset_label: 'Messages', report_id: 'rep-1', report_name: 'Sends by campaign', report_version: 1, user_id: 'u2', user_name: 'Devon Okafor' },
        ].filter((r) => !outcome || r.outcome === outcome)
        return json({ days: 7, runs, summary: { runs: runs.length, timed_out: runs.filter((r) => r.outcome === 'TIMEOUT').length, refused: 0, failed: 0, median_ms: 42 }, people: [{ id: 'u1', name: 'Aby John' }, { id: 'u2', name: 'Devon Okafor' }] })
      }
      const star = /\/insights\/favourites\/(report|dashboard)\/([\w-]+)\/$/.exec(path)
      if (star) {
        if (method === 'PUT') insightsFavourites.add(`${star[1]}:${star[2]}`); else insightsFavourites.delete(`${star[1]}:${star[2]}`)
        return new Response(null, { status: 204 })
      }
      if (path.endsWith('/insights/folders/') && method === 'POST') {
        const posted = body as { name: string }
        if (insightsFolders.some((f) => f.name.toLowerCase() === posted.name.toLowerCase())) return json({ type: 'about:blank', title: 'Validation failed', status: 400, errors: { name: 'There is a folder of that name already.' } }, 400)
        const made = { id: `fold-${insightsFolders.length + 1}`, name: posted.name, owner_user_id: 'u1', reports: 0, row_version: 1, updated_at: '2026-10-15T10:00:00Z' }
        insightsFolders.push(made)
        return json(made, 201)
      }
      if (path.endsWith('/insights/folders/')) return json({ folders: insightsFolders.map((f) => ({ ...f, reports: insightsReportsNow.filter((r) => r.folder_id === f.id).length })) })
      if (path.endsWith('/insights/dashboards/') && method === 'POST') {
        const posted = body as { name?: string }
        const made = { ...structuredClone(insightsDashboard), id: `dash-${insightsDashboardsNow.length + 1}`, name: posted.name ?? 'Untitled Dashboard', description: null, visibility: 'PRIVATE' as const,
                       period: { preset: '30d' as const }, compare: false, layout: { rows: [] }, version: 1, row_version: 1 }
        insightsDashboardsNow.push(made)
        return json(made, 201)
      }
      if (path.endsWith('/insights/dashboards/')) {
        return json({ dashboards: insightsDashboardsNow.map((d) => ({ id: d.id, name: d.name, description: d.description, visibility: d.visibility, tiles: d.layout.rows.reduce((n, row) => n + row.tiles.length, 0),
                                                                     version: d.version, owner_user_id: d.owner_user_id, owner_name: d.owner_name, updated_at: d.updated_at, can_edit: d.can_edit,
                                                                     favourite: insightsFavourites.has(`dashboard:${d.id}`) })) })
      }
      const tileRun = /\/insights\/dashboards\/([\w-]+)\/tiles\/([\w-]+)\/run\/$/.exec(path)
      if (tileRun && method === 'POST') {
        const found = insightsDashboardsNow.find((d) => d.id === tileRun[1])
        const asked = body as { tile?: InsightsDashboard['layout']['rows'][number]['tiles'][number]; period?: { preset: string }; compare?: boolean; slicers?: Record<string, unknown[]> }
        const tile = tileRun[2] === 'preview' ? asked.tile : found?.layout.rows.flatMap((row) => row.tiles).find((t) => t.id === tileRun[2])
        if (!found || !tile) return json({ detail: 'No such tile.' }, 404)
        const bounds = asked.period?.preset === '7d' ? BOUNDS_7D : found.bounds
        const about = { id: 'rep-1', name: insightsSummary.name, version: 2 }
        // the slicers narrow the sample rows as the engine would: an IN rule per field the dataset has
        const sliced = Object.entries(asked.slicers ?? {}).filter(([field, values]) => values.length && insightsResult.columns.some((c) => c.key === field && !('aggregate' in c)))
        const rows = insightsResult.rows.filter((row) => sliced.every(([field, values]) => values.some((v) => String(v) === String(row[insightsResult.columns.findIndex((c) => c.key === field)]))))
        const result = { ...insightsResult, rows, row_count: rows.length }
        if (tile.show === 'figure') return json({ kind: 'figure', value: sliced.length ? rows.reduce((n, row) => n + Number(row[2]), 0) : 391520, previous: 361180, compared: asked.compare ?? found.compare, column: insightsResult.columns[2], own_dates: false, bounds, report: about, cached: false, sliced: sliced.map(([field]) => field) })
        return json({ kind: 'view', view: { type: tile.show }, result, own_dates: false, bounds, report: about, sliced: sliced.map(([field]) => field) })
      }
      const slicerValues = /\/insights\/dashboards\/([\w-]+)\/slicers\/values\/$/.exec(path)
      if (slicerValues && method === 'POST') {
        const field = (body as { field?: string }).field ?? ''
        const at = insightsResult.columns.findIndex((c) => c.key === field)
        if (at < 0) return json({ detail: 'No tile has that field.' }, 404)
        const values = [...new Set(insightsResult.rows.map((row) => row[at]))].sort()
        return json({ field, label: insightsResult.columns[at].label, values, datasets: 1 })
      }
      const oneDashboard = /\/insights\/dashboards\/([\w-]+)\/$/.exec(path)
      if (oneDashboard && method === 'PUT') {
        const found = insightsDashboardsNow.find((d) => d.id === oneDashboard[1])
        if (!found) return json({ detail: 'No such dashboard.' }, 404)
        const put = body as Partial<InsightsDashboard> & { row_version: number }
        if (put.row_version !== found.row_version) return json({ type: 'about:blank', title: 'The dashboard changed since you opened it', status: 409 }, 409)
        Object.assign(found, { name: put.name ?? found.name, visibility: put.visibility ?? found.visibility, layout: put.layout ?? found.layout, period: put.period ?? found.period, compare: put.compare ?? found.compare,
                               version: found.version + (put.layout || put.period ? 1 : 0), row_version: found.row_version + 1 })
        return json(found)
      }
      if (oneDashboard && method === 'DELETE') {
        const at = insightsDashboardsNow.findIndex((d) => d.id === oneDashboard[1])
        if (at >= 0) insightsDashboardsNow.splice(at, 1)
        return new Response(null, { status: 204 })
      }
      if (oneDashboard) {
        const found = insightsDashboardsNow.find((d) => d.id === oneDashboard[1])
        return found ? json(found) : json({ detail: 'No such dashboard.' }, 404)
      }
      if (/\/insights\/catalog\/[a-z_]+\/$/.test(path)) return json(insightsCatalog.datasets.find((d) => path.endsWith(`/${d.key}/`)) ?? { detail: 'No such dataset.' })
      if (path.endsWith('/insights/reports/preview/') && method === 'POST') {
        const draft = body as { definition: { columns: { field: string; aggregate?: string }[] } }
        if (draft.definition.columns.length === 1 && draft.definition.columns[0].aggregate === 'count') return json({ ...insightsResult, columns: [insightsResult.columns[3]], rows: [[670680]], row_count: 1 })
        return json(insightsResult)
      }
      if (path.endsWith('/insights/reports/') && method === 'POST') {
        const posted = body as { name: string; dataset: string; definition: typeof insightsReport.definition }
        const created = { ...insightsReport, id: `rep-${insightsReportsNow.length + 1}`, name: posted.name, dataset: posted.dataset, definition: posted.definition }
        insightsReportsNow.push({ ...insightsSummary, id: created.id, name: created.name, dataset: created.dataset })
        return json(created, 201)
      }
      if (path.endsWith('/insights/reports/')) {
        const query = new URL(url, 'http://test.local').searchParams
        const component = query.get('component')
        const folder = query.get('folder')
        return json({ reports: insightsReportsNow.filter((r) => !component || r.component.key === component).filter((r) => !folder || (folder === 'none' ? !r.folder_id : r.folder_id === folder))
          .map((r) => ({ ...r, folder_name: insightsFolders.find((f) => f.id === r.folder_id)?.name ?? null, favourite: insightsFavourites.has(`report:${r.id}`) })) })
      }
      if (/\/insights\/(reports|dashboards)\/[\w-]+\/export\.(csv|xlsx|pdf)$/.test(path)) {
        const type = path.endsWith('.csv') ? 'text/csv' : path.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        return new Response(path.endsWith('.csv') ? 'Campaign,Channel\n' : new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'Content-Type': type } })
      }
      if (/\/insights\/reports\/[\w-]+\/versions\/$/.test(path)) {
        return json({ versions: [
          { version: 2, view_type: 'grid', note: 'Shared with the workspace', changed_at: '2026-10-15T08:00:00Z', changed_by_name: 'Aby John', definition: insightsReport.definition },
          { version: 1, view_type: 'grid', note: 'Created', changed_at: '2026-10-14T08:00:00Z', changed_by_name: 'Aby John', definition: { ...insightsReport.definition, columns: insightsReport.definition.columns.slice(0, 3) } },
        ] })
      }
      const restoring = /\/insights\/reports\/([\w-]+)\/versions\/(\d+)\/restore\/$/.exec(path)
      if (restoring && method === 'POST') {
        if (restoring[2] !== '1') return json({ detail: 'No such version.' }, 404)
        return json({ ...insightsReport, id: restoring[1], version: 3, row_version: insightsReport.row_version + 1, definition: { ...insightsReport.definition, columns: insightsReport.definition.columns.slice(0, 3) } })
      }
      if (/\/insights\/reports\/[\w-]+\/run\/$/.test(path) && method === 'POST') {
        const permissions: string[] = options.me?.principal?.permissions ?? me.principal.permissions
        const base = permissions.includes('user.admin') || permissions.includes('report.admin') ? insightsResult : insightsMaskedResult
        return json({ ...base, ...mockTotals(base as typeof insightsResult, (body as { view?: { type?: string; across?: string } } | null)?.view ?? (insightsReport.definition as { view?: { type?: string; across?: string } }).view) })
      }
      if (/\/insights\/reports\/[\w-]+\/$/.test(path) && method === 'PUT') {
        const id = path.split('/').at(-2)
        const put = body as { name?: string; definition?: typeof insightsReport.definition; row_version: number; folder_id?: string | null }
        if (put.row_version < insightsReport.row_version) return json({ type: 'about:blank', title: 'The report changed since you opened it', status: 409 }, 409)   // a later version from an earlier PUT is fine
        const found = insightsReportsNow.find((r) => r.id === id)
        if (found && put.name) found.name = put.name
        if (found && 'folder_id' in put) found.folder_id = put.folder_id ?? null
        return json({ ...insightsReport, id, name: put.name ?? insightsReport.name, definition: put.definition ?? insightsReport.definition, version: insightsReport.version + (put.definition ? 1 : 0),
                      row_version: insightsReport.row_version + 1, folder_id: found?.folder_id ?? null })
      }
      if (/\/insights\/reports\/[\w-]+\/$/.test(path) && method === 'DELETE') {
        const id = path.split('/').at(-2)
        const at = insightsReportsNow.findIndex((r) => r.id === id)
        if (at >= 0) insightsReportsNow.splice(at, 1)
        return new Response(null, { status: 204 })
      }
      if (/\/insights\/reports\/[\w-]+\/$/.test(path)) {
        const id = path.split('/').at(-2)
        const found = insightsReportsNow.find((r) => r.id === id)
        return found ? json({ ...insightsReport, id: found.id, name: found.name, dataset: found.dataset, can_edit: true }) : json({ detail: 'No such report.' }, 404)
      }
    }
    if (path.endsWith('/me/')) return json({ ...me, ...options.me })
    const message = options.message ?? makeMessage()
    if (path.endsWith('/message/') && method === 'POST') {
      const custom = options.onSaveMessage?.(call)
      if (custom) return custom
      const media = mediaLibrary.find((item) => item.id === body?.media_asset) ?? null
      return json({ ...message, sms_body: String(body?.sms_body ?? '').trim(), subject_line: body?.subject_line ?? '', media_asset: media, version_number: message.latest_version + 1,
                    latest_version: message.latest_version + 1, saved_by: 'Aby John' }, 201)
    }
    if (path.endsWith('/message/')) return json(message)
    if (path.endsWith('/design/versions/')) return json([{ version_number: message.latest_version, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' }])
    const design = options.design ?? makeDesign()
    if (path.endsWith('/design/') && method === 'POST') {
      const custom = options.onSaveDesign?.(call)
      if (custom) return custom
      return json({ ...design, ...(body as Partial<Design>), version_number: design.latest_version + 1, latest_version: design.latest_version + 1, saved_by: 'Aby John' }, 201)
    }
    if (path.endsWith('/design/')) return json(design)
    const receiptLayout = options.receiptLayout ?? makeReceiptLayout()
    if (path.endsWith('/receipt/') && method === 'POST') {
      const custom = options.onSaveReceiptLayout?.(call)
      if (custom) return custom
      return json({ ...receiptLayout, ...(body as Partial<ReceiptLayout>), version_number: receiptLayout.latest_version + 1,
                    latest_version: receiptLayout.latest_version + 1, saved_by: 'Aby John' }, 201)
    }
    if (path.endsWith('/receipt/')) return json(receiptLayout)
    if (path.endsWith('/receipt/versions/')) return json([{ version_number: receiptLayout.latest_version, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' }])
    if (path.endsWith('/field-rules/')) return json(fieldRules)
    if (path.endsWith('/personalization-tags/data-points/')) return json(tagDataPoints)
    if (path.endsWith('/personalization-tags/') && method === 'POST') {
      const input = (body ?? {}) as Partial<PersonalizationTag>
      const made = { ...tag(String(input.tag_key), String(input.label), 'CUSTOM', String(input.sample_value ?? '')), ...input, id: 'tag-new', platform_tag_id: null }
      tagRows.push(made as PersonalizationTag)
      return json(made, 201)
    }
    if (path.endsWith('/personalization-tags/')) return json({ next: null, previous: null, results: tagRows })
    const tagMatch = path.match(/\/personalization-tags\/([^/]+)\/$/)
    if (tagMatch && (method === 'PATCH' || method === 'DELETE')) {
      const found = tagRows.find((item) => item.id === tagMatch[1])
      if (!found) return json({ title: 'Not found', status: 404 }, 404)
      if (found.platform_tag_id) return json({ title: 'This tag comes from the platform catalogue; the back-office changes it.', status: 403 }, 403)
      if (method === 'DELETE') { tagRows.splice(tagRows.indexOf(found), 1); return json(null, 204) }
      Object.assign(found, body)
      return json(found)
    }
    if (path.endsWith('/template-starters/')) return json(starters.filter((item) => url.includes(`channel=${item.channel}`)))
    if (path.endsWith('/media-assets/') && method === 'POST') return json({ ...mediaLibrary[0], id: 'img-up', file_name: 'uploaded.png', mime_type: 'image/png' }, 201)
    if (path.endsWith('/media-assets/')) return json({ next: null, previous: null, results: mediaLibrary })
    if (path.endsWith('/activate/')) return json({ ...(options.template ?? templates[1]), status: 'ACTIVE' })
    // templates are stateful: a copy or a deletion shows in the list afterwards
    if (/\/templates\/[^/]+\/clone\/$/.test(path) && method === 'POST') {
      const source = templatesNow.find((item) => path.includes(`/${item.id}/`)) ?? templates[0]
      const copy: Template = { ...source, id: `${source.id}-copy`, name: `${source.name} (copy)`, status: 'DRAFT', cloned_from: source.id, latest_version: source.latest_version ?? 1 }
      templatesNow = [copy, ...templatesNow]
      return json(copy, 201)
    }
    if (/\/templates\/[^/]+\/$/.test(path) && method === 'DELETE') {
      const id = /\/templates\/([^/]+)\/$/.exec(path)?.[1]
      // Fall Email is the campaign's template, which the server refuses to delete
      if (id === 'tpl-email') return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'This template is used by a campaign. Archive it instead.' }, 409)
      // a live drip's message (drip.guard_template)
      const drip = templatesNow.find((item) => item.id === id)?.used_in_drip
      if (drip?.locked) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: `This template can't be deleted. ${drip.campaign_name} uses it for message ${drip.position}, and the drip is still running.` }, 409)
      templatesNow = templatesNow.filter((item) => item.id !== id)
      return json(null, 204)
    }
    if (/\/templates\/[^/]+\/$/.test(path) && method === 'PATCH') {
      const id = /\/templates\/([^/]+)\/$/.exec(path)?.[1]
      const wanted = String((body as { name?: string })?.name ?? '').trim()
      // the server's own rule: a live name is unique, case aside
      if (templatesNow.some((item) => item.id !== id && item.name.toLowerCase() === wanted.toLowerCase())) return json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Another template already has this name.', errors: { name: ['Another template already has this name.'] } }, 400)
      templatesNow = templatesNow.map((item) => (item.id === id ? { ...item, ...(body as Partial<Template>) } : item))
      return json(templatesNow.find((item) => item.id === id) ?? templates[1])
    }
    if (/\/templates\/[^/]+\/$/.test(path) && method === 'GET') return json(options.template ?? templates[1])
    if (path.endsWith('/templates/') && method === 'POST') {
      return options.onSaveTemplate?.(call) ?? json({ ...templates[0], ...(body as Partial<Template>), id: 'tpl-new', status: 'DRAFT', latest_version: 0 }, 201)
    }
    if (path.endsWith('/templates/')) {
      const query = new URL(url, 'http://x').searchParams
      const needle = (query.get('search') ?? '').toLowerCase()
      const rows = templatesNow.filter((item) => (!query.get('channel') || item.channel === query.get('channel')) && (!query.get('status') || item.status === query.get('status'))
        && item.name.toLowerCase().includes(needle))
      return json({ next: null, previous: null, results: rows })
    }
    // ---- journey templates: C360's starters
    if (path.endsWith('/journey-starters/')) return json(journeyStartersNow)
    if (path.endsWith('/journey-templates/') && method === 'GET') return json(savedTemplatesNow)
    if (path.endsWith('/journey-templates/') && method === 'POST') {
      const name = String(body?.name ?? '').trim()
      if (savedTemplatesNow.some((row) => row.name.toLowerCase() === name.toLowerCase())) return json({ type: 'about:blank', title: 'Bad Request', status: 400, errors: { name: ['Another template already has this name.'] } }, 400)
      const created = makeSavedTemplate({ id: `jt-${savedTemplatesNow.length + 1}`, name, category: String(body?.category ?? 'LIFECYCLE') as JourneyTemplate['category'], description: (body?.description as string | null) ?? null })
      savedTemplatesNow.unshift(created)
      return json(created, 201)
    }
    const savedTemplateMatch = /\/journey-templates\/([^/]+)\/$/.exec(path)
    if (savedTemplateMatch && method === 'DELETE') {
      savedTemplatesNow = savedTemplatesNow.filter((row) => row.id !== savedTemplateMatch[1])
      return json(null, 204)
    }
    if (path.endsWith('/customers/') && method === 'GET' && !path.includes('/journeys/')) {
      const needle = (new URL(url, 'http://mock').searchParams.get('q') ?? '').toLowerCase()
      const found = customerRows.filter((row) => !needle || `${row.name} ${row.email ?? ''} ${row.phone ?? ''} ${row.party_id}`.toLowerCase().includes(needle))
      return json({ count: found.length, page: 1, page_size: 25, results: found })
    }
    const customerMatch = /\/customers\/([^/]+)\/$/.exec(path)
    if (customerMatch && method === 'GET' && !path.includes('/journeys/')) {
      const party = decodeURIComponent(customerMatch[1])
      const row = customerRows.find((item) => item.party_id === party)
      if (!row) return json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'This customer is not in the customer records.' }, 404)
      return json(makeCustomerRecord(row))
    }
    // ---- journeys: the Build canvas (journey, its versions, and each version's graph)
    if (path.endsWith('/coupons/')) return json([{ id: 'cpn-1', code: 'WELCOME10', name: 'Welcome 10% Off', description: null, is_active: true }])
    if (path.endsWith('/loyalty-tiers/')) return json([{ id: 'tier-gold', code: 'GOLD', name: 'Gold', rank: 2, description: null }])
    const journeyGraphMatch = /\/journeys\/([^/]+)\/versions\/(\d+)\/graph\/$/.exec(path)
    if (journeyGraphMatch && method === 'PUT') {
      const number = Number(journeyGraphMatch[2])
      const target = journeyVersionsNow.find((item) => item.version_number === number)
      if (!target) return json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'This journey has no such version.' }, 404)
      if (options.journeySaveConflicts || String(body?.row_version) !== String(target.row_version)) {
        return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Someone else saved this journey after you opened it. Reload to see their changes.' }, 409)
      }
      const sent = body?.graph as JourneyGraph
      // the backend keeps only entry_type + rule_definition of each rule (graph.clean)
      journeyGraphs.set(number, { ...sent, entry_rules: sent.entry_rules.map((rule) => ({ entry_type: rule.entry_type, rule_definition: rule.rule_definition })) })
      const saved = { ...target, row_version: target.row_version + 1, updated_at: '2026-10-05T10:00:00Z' }
      journeyVersionsNow = journeyVersionsNow.map((item) => (item.version_number === number ? saved : item))
      return json({ ...saved, graph: namedGraph(journeyGraphs.get(number)!) })
    }
    const journeyVersionDetailMatch = /\/journeys\/([^/]+)\/versions\/(\d+)\/$/.exec(path)
    if (journeyVersionDetailMatch && method === 'GET') {
      const number = Number(journeyVersionDetailMatch[2])
      const target = journeyVersionsNow.find((item) => item.version_number === number)
      if (!target) return json({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'This journey has no such version.' }, 404)
      return json({ ...target, graph: namedGraph(journeyGraphs.get(number) ?? BLANK_GRAPH) } satisfies JourneyVersionDetail)
    }
    if (/\/journeys\/[^/]+\/versions\/\d+\/readiness\/$/.test(path) && method === 'GET') return json(journeyReadinessNow)
    const journeyTestPublishMatch = /\/journeys\/([^/]+)\/versions\/(\d+)\/test-publish\/$/.exec(path)
    if (journeyTestPublishMatch && method === 'POST') {
      if (!journeyReadinessNow.ready) {
        return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { readiness: 'Every readiness check must pass before running a test.' } }, 400)
      }
      return json(journeyTestResultNow)
    }
    const journeyApproveMatch = /\/journeys\/([^/]+)\/versions\/(\d+)\/approve\/$/.exec(path)
    if (journeyApproveMatch && method === 'POST') {
      const scheduleAt = body?.schedule_at as string | null | undefined
      // publish.approve: a live (Active / Paused) journey keeps its status; its new version replaces the live one now, or waits
      const live = journeyNow.status === 'ACTIVE' || journeyNow.status === 'PAUSED'
      const target = journeyVersionsNow.find((item) => item.version_number === Number(journeyApproveMatch[2]))
      if (!scheduleAt && target) {
        journeyVersionsNow = journeyVersionsNow.map((item) => (item.id === target.id ? { ...item, status: 'ACTIVE' } : item.status === 'ACTIVE' ? { ...item, status: 'RETIRED' } : item))
      }
      journeyNow = { ...journeyNow, status: live ? journeyNow.status : scheduleAt ? 'APPROVED' : 'ACTIVE', scheduled_activate_at: scheduleAt ?? null,
                     current_version: target?.id ?? journeyNow.current_version }
      return json(journeyNow)
    }
    if (/\/journeys\/[^/]+\/performance\/$/.test(path) && method === 'GET') {
      return json({ window: { date_from: '2026-09-05', date_to: '2026-10-05' }, summary: journeyPerformanceNow, customers: 0, steps: [], metrics: journeyMetricsNow,
                    messages: { sent: 9870, delivered: 9640, delivered_pct: 97.7, opened: 3920, opened_pct: 39.7, clicked: 1110, clicked_pct: 11.2, bounced: 142, complained: 3, unsubscribed: 27,
                                held_back: 214, held_back_reasons: [{ reason: 'No consent', count: 118 }, { reason: 'Frequency cap', count: 71 }], failed: 9 } })
    }
    if (/\/journeys\/[^/]+\/audience\/$/.test(path) && method === 'GET') return json(journeyAudienceNow)
    if (/\/journeys\/[^/]+\/enrollment-trend\/$/.test(path) && method === 'GET') return json(journeyTrendNow)
    if (/\/journeys\/[^/]+\/campaigns\/$/.test(path) && method === 'GET') return json(journeyGeneratedCampaignsNow)
    if (/\/journeys\/[^/]+\/activity\/$/.test(path) && method === 'GET') return json(journeyActivityNow)
    if (path.endsWith('/journeys/preview-customers/')) {
      const q = (new URL(url, 'http://test.local').searchParams.get('q') ?? '').toLowerCase()
      return json([{ party_id: 'p-devon', name: 'Devon Okafor', email: 'devon@example.com', summary: 'Gold · Lakeside Mall' }].filter((item) => item.name.toLowerCase().includes(q) || item.email.includes(q)))
    }
    if (/\/journeys\/[^/]+\/attention\/$/.test(path) && method === 'GET') return json(journeyAttentionNow)
    if (/\/journeys\/[^/]+\/webhook-test\/$/.test(path) && method === 'POST') {
      const url = String(body?.url ?? '')
      return json(url.startsWith('https://') ? { ok: true, status: 200, error: null, duration_ms: 212, response: 'received' } : { ok: false, status: null, error: 'The address must be https (http is only allowed for localhost).', duration_ms: 0 })
    }
    if (/\/journeys\/[^/]+\/webhook-calls\/$/.test(path) && method === 'GET') {
      return json([{ id: 9, called_at: '2026-10-09T10:12:00Z', url: 'https://hooks.example.com/cep', status: 200, outcome: 'OK', error: null, attempt: 1, duration_ms: 212, node_key: 'webhook-1', enrollment_id: 'enr-1', test: false },
                   { id: 8, called_at: '2026-10-09T10:05:00Z', url: 'https://hooks.example.com/cep', status: 503, outcome: 'RETRY', error: null, attempt: 1, duration_ms: 1840, node_key: 'webhook-1', enrollment_id: 'enr-2', test: false },
                   { id: 7, called_at: '2026-10-09T09:58:00Z', url: 'https://hooks.example.com/cep', status: 200, outcome: 'OK', error: null, attempt: 1, duration_ms: 190, node_key: 'test', enrollment_id: null, test: true }])
    }
    const journeyActionMatch = /\/journeys\/([^/]+)\/customers\/([^/]+)\/(retry|skip)\/$/.exec(path)
    if (journeyActionMatch && method === 'POST') {
      journeyAttentionNow = journeyActionMatch[3] === 'skip' ? journeyAttentionNow.filter((row) => row.id !== journeyActionMatch[2])
        : journeyAttentionNow.map((row) => (row.id === journeyActionMatch[2] ? { ...row, gave_up_at: null, next_try_at: new Date().toISOString() } : row))
      return json({ [journeyActionMatch[3] === 'skip' ? 'skipped' : 'retried']: true })
    }
    const journeyCountsMatch = /\/journeys\/([^/]+)\/versions\/(\d+)\/counts\/$/.exec(path)
    if (journeyCountsMatch && method === 'GET') return json({ entered: 3412, in_journey: 212, steps: {} })
    const journeyPreviewMatch = /\/journeys\/([^/]+)\/versions\/(\d+)\/preview\/$/.exec(path)
    if (journeyPreviewMatch && method === 'POST') {
      const assumed = ((body?.assumptions as Record<string, string> | undefined)?.['cond-1'] ?? 'NO') as 'YES' | 'NO'
      return json({ customer: { party_id: body?.party_id, name: 'Devon Okafor', email: 'devon@example.com', summary: 'Gold · Lakeside Mall', attributes: {} },
                    entry: { outcome: 'Enters when a Welcome event arrives for them. The entry filters pass.', enters: true },
                    steps: [{ node_key: 'wait-1', node_type: 'WAIT', label: 'Wait 1 day', outcome: 'Continues Tue 13 Oct, 11:02', at: '2026-10-13T15:02:00Z', depends: false, assumed: null, branch: null },
                            { node_key: 'cond-1', node_type: 'CONDITION', label: 'Worth a second email?', outcome: `Depends on what has not happened yet in this journey: assuming ${assumed === 'YES' ? 'Yes' : 'No'}`, at: '2026-10-13T15:02:00Z', depends: true, assumed, branch: assumed },
                            { node_key: null, node_type: 'END', label: 'End of the path', outcome: 'Would exit Tue 13 Oct as not converted: nothing follows', at: '2026-10-13T15:02:00Z', depends: false, assumed: null, branch: null }] })
    }
    if (/\/journeys\/[^/]+\/customers\/reasons\/$/.test(path) && method === 'GET') {
      return json({ results: [{ reason: 'NO_CONSENT', label: 'No consent', customers: 2 }, { reason: 'FREQUENCY_CAP', label: 'Frequency cap', customers: 1 }] })
    }
    const journeyCustomerMatch = /\/journeys\/([^/]+)\/customers\/([^/]+)\/$/.exec(path)
    if (journeyCustomerMatch && method === 'GET') {
      return json({ id: journeyCustomerMatch[2], party_id: 'p-aaliyah', name: 'Aaliyah Brooks', email: 'aaliyah@example.com', attributes: {}, enrolled_at: '2026-10-12T14:14:00Z', entry: 'EVENT', version_number: 1,
                    status: 'ACTIVE', converted_at: null, attributed_revenue: null, exited_at: null, exit_reason: null,
                    now: { node_key: 'wait-2', node_type: 'WAIT', label: 'Wait 3 days', entered_node_at: '2026-10-13T14:15:00Z', next_scheduled_at: '2026-10-16T14:15:00Z', pending: null },
                    steps: [{ at: '2026-10-12T14:14:00Z', node_key: 'start', node_type: 'START', label: 'Start', status: 'SUCCESS', result: { entry: 'EVENT' }, delivery: null },
                            { at: '2026-10-13T14:14:00Z', node_key: 'wait-1', node_type: 'WAIT', label: 'Wait 1 day', status: 'SUCCESS', result: { waited_seconds: 86400 }, delivery: null },
                            { at: '2026-10-13T14:15:00Z', node_key: 'email-1', node_type: 'EMAIL', label: 'Email: Welcome', status: 'SUCCESS', result: {},
                              delivery: { channel: 'EMAIL', status: 'OPENED', status_reason: null, submitted_at: '2026-10-13T14:15:00Z', delivered_at: '2026-10-13T14:15:30Z', opened_at: '2026-10-13T22:02:00Z', clicked_at: null, bounced_at: null, responded_at: null, failed_at: null } }] })
    }
    if (/\/journeys\/[^/]+\/customers\/$/.test(path) && method === 'GET') {
      const q = (new URL(url, 'http://test.local').searchParams.get('q') ?? '').toLowerCase()
      const rows = [{ id: 'enr-1', party_id: 'p-aaliyah', name: 'Aaliyah Brooks', email: 'aaliyah@example.com', enrolled_at: '2026-10-12T14:14:00Z', version_number: 1, status: 'ACTIVE', converted_at: null, attributed_revenue: null,
                      exited_at: null, exit_reason: null, where: { node_key: 'wait-2', node_type: 'WAIT', label: 'Wait 3 days', entered_node_at: '2026-10-13T14:15:00Z', next_scheduled_at: '2026-10-16T14:15:00Z' } },
                    { id: 'enr-2', party_id: 'p-marcus', name: 'Marcus Hale', email: 'marcus@example.com', enrolled_at: '2026-10-11T09:00:00Z', version_number: 1, status: 'COMPLETED', converted_at: '2026-10-18T18:40:00Z', attributed_revenue: 86.4,
                      exited_at: '2026-10-18T18:40:00Z', exit_reason: 'Goal reached', where: null }].filter((row) => !q || row.name.toLowerCase().includes(q) || row.email.includes(q))
      return json({ count: rows.length, page: 1, page_size: 25, results: rows })
    }
    if (/\/journeys\/[^/]+\/pause\/$/.test(path) && method === 'POST') {
      journeyNow = { ...journeyNow, status: 'PAUSED' }
      return json(journeyNow)
    }
    if (/\/journeys\/[^/]+\/resume\/$/.test(path) && method === 'POST') {
      journeyNow = { ...journeyNow, status: 'ACTIVE' }
      return json(journeyNow)
    }
    if (/\/journeys\/[^/]+\/archive\/$/.test(path) && method === 'POST') {
      journeyVersionsNow = journeyVersionsNow.map((item) => (item.status === 'ACTIVE' || item.status === 'TEST_PUBLISHED' ? { ...item, status: 'RETIRED' } : item))
      journeyNow = { ...journeyNow, status: 'ARCHIVED', scheduled_activate_at: null }
      return json({ ...journeyNow, ended: 12 })
    }
    if (/\/journeys\/[^/]+\/cancel-schedule\/$/.test(path) && method === 'POST') {
      const running = journeyVersionsNow.find((item) => item.status === 'ACTIVE')
      journeyNow = journeyNow.status === 'APPROVED' ? { ...journeyNow, status: 'TEST', scheduled_activate_at: null }
                                                    : { ...journeyNow, scheduled_activate_at: null, current_version: running?.id ?? journeyNow.current_version }
      return json(journeyNow)
    }
    if (/\/journeys\/[^/]+\/duplicate\/$/.test(path) && method === 'POST') {
      return json({ ...journeyNow, id: 'j-copy', name: `${journeyNow.name} (Copy)`, status: 'DRAFT', code: 'JRN-2026-00099' }, 201)
    }
    if (path.endsWith('/journeys/') && method === 'POST') {
      // JourneySetupModal (phase 6e): POST /journeys/ creates the journey + a blank version 1; the entry rule
      // comes from a second call, PUT .../versions/1/graph/, handled generically below by version_number alone.
      const name = String(body?.name ?? '').trim()
      const clash = journeysListNow.some((row) => row.name.toLowerCase() === name.toLowerCase())
      if (!name || clash) {
        return json({ type: 'about:blank', title: 'Bad Request', status: 400,
          errors: { name: [clash ? 'Another journey already has this name.' : 'This field is required.'] } }, 400)
      }
      // a starter: version 1 is a copy of its graph, and the journey says where it came from
      const starter = body?.starter ? journeyStartersNow.find((item) => item.key === body.starter)
        : body?.template ? (() => { const saved = savedTemplatesNow.find((item) => item.id === body.template); return saved ? starterFromTemplate(saved) : undefined })() : undefined
      const created = makeJourney({
        id: 'j-new', code: 'JRN-2026-00010', name,
        population_mode: String(body?.population_mode ?? 'FIXED'),
        reentry_policy: String(body?.reentry_policy ?? 'NEVER'),
        reentry_after_days: (body?.reentry_after_days as number | null) ?? null,
        status: 'DRAFT', latest_version: 1, channels: [], trigger_family: null, trigger_family_label: null, needs_attention: false,
        source_starter_key: starter?.template_id ? null : starter?.key ?? null, source_template: starter?.template_id ?? null, source_name: starter?.name ?? null,
        step_count: starter?.step_count ?? 0, step_types: starter?.graph.nodes.filter((node) => node.type !== 'START').map((node) => node.type) ?? [],
        entry_rule: starter?.graph.entry_rules[0] ?? null,
      })
      journeyNow = created
      journeysListNow.unshift(created)
      journeyVersionsNow = [makeJourneyVersion({ journey: created.id })]
      journeyGraphs.set(1, structuredClone(starter?.graph ?? BLANK_GRAPH))
      return json(created, 201)
    }
    if (path.endsWith('/journeys/') && method === 'GET') {
      const query = new URL(url, 'http://x').searchParams
      const needle = (query.get('search') ?? '').toLowerCase()
      const rows = journeysListNow.filter((row) => (!query.get('status') || row.status === query.get('status'))
        && (!query.get('channel') || row.channels.includes(query.get('channel') as string))
        && (!query.get('trigger_family') || row.trigger_family === query.get('trigger_family'))
        && (query.get('needs_attention') !== 'true' || row.needs_attention)
        && row.name.toLowerCase().includes(needle))
      return json({ next: null, previous: null, results: rows, total: journeysListNow.length })
    }
    if (/\/journeys\/[^/]+\/versions\/$/.test(path) && method === 'POST') {
      // graph.new_version: the next version as a DRAFT copy of from_version (one draft at a time)
      if (journeyVersionsNow.some((item) => item.status === 'DRAFT')) {
        return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'This journey already has a draft version.' }, 409)
      }
      const from = Number(body?.from_version ?? Math.max(...journeyVersionsNow.map((item) => item.version_number)))
      const number = Math.max(...journeyVersionsNow.map((item) => item.version_number)) + 1
      const created = makeJourneyVersion({ id: `jv${number}`, journey: journeyNow.id, version_number: number })
      journeyVersionsNow = [created, ...journeyVersionsNow]
      journeyGraphs.set(number, structuredClone(journeyGraphs.get(from) ?? BLANK_GRAPH))
      return json({ ...created, graph: namedGraph(journeyGraphs.get(number)!) }, 201)
    }
    if (/\/journeys\/[^/]+\/versions\/$/.test(path)) return json(journeyVersionsNow)
    if (/\/journeys\/[^/]+\/$/.test(path) && method === 'PATCH') {
      journeyNow = { ...journeyNow, ...body }
      return json(journeyNow)
    }
    if (/\/journeys\/[^/]+\/$/.test(path)) return json(journeyNow)
    if (path.endsWith('/sender-profiles/')) return json(senders)
    // ---- contact lists: stateful, so what a test creates is there afterwards
    if (path.includes('/contact-lists/')) {
      if (/\/contact-lists\/[^/]+\/reach\/$/.test(path)) {
        const found = listsNow.find((item) => path.includes(`/${item.id}/`))
        const total = found?.member_count ?? 0
        return json({ email: { total, sendable: Math.round(total * 0.88) }, sms: { total, sendable: Math.round(total * 0.4), no_phone: Math.round(total * 0.3) }, checked_at: '2026-09-26T10:00:00Z' })
      }
      const one = /\/contact-lists\/([^/]+)\//.exec(path)?.[1]
      const find = (id: string | undefined) => listsNow.find((item) => item.id === id)
      const query = new URL(url, 'http://x').searchParams
      if (path.endsWith('/contact-lists/stats/')) return json({ total_lists: listsNow.filter((item) => item.status !== 'DRAFT').length, total_contacts: 100, attached_to_live_campaigns: 1 })
      if (path.endsWith('/audiences/')) return json(audiences)
      if (path.endsWith('/from-audience/')) {
        const made = list('cl-bi', String(body?.name), 43, true, { source_type: 'BI', source_label: 'BI / Extraction', vetted: true, list_kind: 'SEGMENT', list_environment: String(body?.list_environment ?? 'PRODUCTION') })
        listsNow = [made, ...listsNow]
        return json(made, 201)
      }
      if (path.endsWith('/clone/')) {
        const made = list('cl-clone', String(body?.name), find(one)?.member_count ?? 0, true, { source_type: 'CLONE', source_label: 'Cloned', vetted: true, parent_contact_list: one ?? null, parent_name: find(one)?.name })
        listsNow = [made, ...listsNow]
        return json(made, 201)
      }
      if (path.endsWith('/governance/')) return json({ total: 3, sendable: 2, not_sendable: 1, statuses: GOVERNANCE.map((line) => (line.code === 'HARD_BOUNCE' ? { ...line, count: 0 } : line)), checked_at: '2026-09-21T10:00:00Z' })
      if (path.endsWith('/report/')) return new Response('line,email,outcome\n2,a@x.example,Imported\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
      if (path.endsWith('/usage/')) {
        const item = find(one)
        return json({
          campaigns: item?.attached_campaigns ? [{ id: 'c1', name: 'Fall Promo Email', code: 'CMP-1', status: 'PRODUCTION_PUBLISHED', channel: 'EMAIL', scheduled_at: null, attached_at: '2026-09-01T00:00:00Z', live: true, frozen_lists: 1 }] : [],
          attached_campaigns: item?.attached_campaigns ?? 0, live_campaigns: item?.live_campaigns ?? 0, added_this_week: 2,
        })
      }
      if (path.endsWith('/members/remove/')) {
        const ids = (body?.ids as number[]) ?? []
        membersNow = membersNow.filter((row) => !ids.includes(row.id))
        return json({ removed: ids.length, member_count: membersNow.length })
      }
      if (path.endsWith('/members/') && method === 'POST') {
        const wanted = (body?.contacts as { email: string }[]) ?? []
        const valid = wanted.filter((row) => row.email.includes('@'))
        membersNow = [...valid.map((row, index) => ({ ...listMembers[0], id: 100 + index, email: row.email, first_name: null, last_name: null, source: 'MANUAL' })), ...membersNow]
        return json({ added: valid.length, already_in_list: 0, new_people: valid.length, invalid: wanted.filter((row) => !row.email.includes('@')).map((row) => row.email), member_count: membersNow.length })
      }
      if (path.endsWith('/members/')) {
        const needle = query.get('search')?.toLowerCase() ?? ''
        const rows = membersNow.filter((row) => `${row.email} ${row.first_name} ${row.last_name}`.toLowerCase().includes(needle))
        return json({ count: rows.length, page: 1, page_size: 50, results: rows })
      }
      // uploads are background jobs: a request only queues; the "worker" finishes the step by the time of the next poll
      const jobId = /\/imports\/([^/]+)\//.exec(path)?.[1]
      const job = jobsNow.find((item) => item.id === jobId)
      const put = (next: ListImport) => { jobsNow = jobsNow.map((item) => (item.id === next.id ? next : item)); return next }
      // the "worker": an import that was requested is finished once options.listImportMs have passed, whoever asks
      for (const item of jobsNow) {
        if (item.status === 'APPLYING' && (importDoneAt.get(item.id) ?? Infinity) <= Date.now()) {
          listsNow = listsNow.map((entry) => (entry.id === item.contact_list ? { ...entry, status: 'ACTIVE', member_count: 4 } : entry))
          put({ ...item, status: 'APPLIED', phase: 'Imported', working: false, applied_count: 3, new_people: 3, consents_recorded: 0, list_status: 'ACTIVE', completed_at: '2026-09-21T10:02:00Z',
                summary: { ...uploadSummary, result: { added: 3, already_in_list: 1, list_members_now: 4, new_people: 3, consents_recorded: 0 } } })
        }
      }
      if (path.endsWith('/contact-lists/imports/')) return json(jobsNow)
      if (path.endsWith('/imports/') && method === 'POST') {
        const custom = options.onListUpload?.(call)
        if (custom) return custom
        const channel = find(one)?.channel ?? 'EMAIL'
        const made: ListImport = { ...stagedImport, id: `imp-${jobsNow.length + 1}`, contact_list: String(one), list_name: find(one)?.name ?? '', list_channel: channel, properties: propertiesFor(channel) }
        jobsNow = [made, ...jobsNow]
        return json(made, 201)
      }
      if (job && path.endsWith('/consent/')) {
        const basis = String(body?.basis ?? '')
        if (basis === 'IMPLIED' && job.list_channel && job.list_channel !== 'EMAIL') {
          return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { basis: 'A texts list needs express consent.' } }, 400)
        }
        if (!body?.attested) return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { attested: 'Confirm that these people agreed to receive marketing.' } }, 400)
        const declared = { ...(job.consent ?? consentDeclaration(job.list_channel)), basis: basis as NonNullable<ListImport['consent']>['basis'], basis_label: basis,
                           collected_at: String(body?.collected_at ?? '') || null, attested_by_name: 'Aby John', attested_at: '2026-09-21T10:01:00Z' }
        return json(put({ ...job, consent: declared }))
      }
      if (job && path.endsWith('/review/')) {
        return json(put({ ...job, status: 'MATCHING', phase: 'Checking the rows', working: true, mapping_confirmed: true, mapping: body?.mapping as Record<string, string>, review: null,
                          progress: { done: 3, total: 6, percent: 50, unit: 'rows' } }), 202)
      }
      if (job && path.endsWith('/apply/')) {
        if (job.consent?.required && !job.consent.attested_at) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Say where these people agreed to marketing first.' }, 409)
        importDoneAt.set(job.id, Date.now() + (options.listImportMs ?? 0))
        return json(put({ ...job, status: 'APPLYING', phase: 'Adding contacts to the list', working: true, progress: { done: 2, total: 6, percent: 33, unit: 'rows' } }), 202)
      }
      if (job && path.endsWith('/cancel/')) return json(put({ ...job, status: 'CANCELLED', phase: 'Cancelled', working: false }))
      if (job && method === 'GET') {
        if (options.listUploadFails && job.status === 'UPLOADED') {
          return json(put({ ...job, status: 'FAILED', phase: 'Failed', working: false, error: 'The file has more than 250,000 rows. Split it and upload the parts as separate lists.' }))
        }
        if (job.status === 'UPLOADED') return json(put({ ...job, status: 'STAGED', phase: 'Read. Match the columns to continue', working: false, row_count: 6, progress: { done: 6, total: 6, percent: 100, unit: 'rows' } }))
        if (job.status === 'MATCHING') {
          return json(put({ ...job, status: 'REVIEW', phase: 'Checked. Review it to continue', working: false, review: REVIEW, summary: uploadSummary, progress: { done: 6, total: 6, percent: 100, unit: 'rows' },
                            issues: [{ line: 5, kind: 'error', message: 'Same email address as line 3', value: 'A@x.example' }, { line: 4, kind: 'warning', message: 'Mobile number not recognised: left out', value: 'b@x.example' }] }))
        }
        return json(jobsNow.find((item) => item.id === job.id))
      }
      if (one && /\/(approve|refuse)\/$/.test(path) && method === 'POST') {
        const approved = path.endsWith('/approve/')
        listsNow = listsNow.map((entry) => (entry.id === one ? { ...entry, approval_status: approved ? 'APPROVED' : 'REFUSED', approved_by_name: 'Aby John', approved_at: '2026-09-21T11:00:00Z',
                                                                 approval_note: String(body?.note ?? '') || null } : entry))
        return json(find(one))
      }
      if (one && path.endsWith('/compliance/')) {
        const entry = find(one)
        return json({
          list: { id: one, name: entry?.name ?? '', channel: entry?.channel ?? 'EMAIL', member_count: entry?.member_count ?? 0, source_type: entry?.source_type ?? 'UPLOAD', source_reference: 'leads.csv', created_at: '2026-09-20T09:00:00Z' },
          inherited: entry?.source_type !== 'UPLOAD',
          uploads: entry?.source_type === 'UPLOAD' ? [{ id: 'imp-0', file_name: 'leads.csv', completed_at: '2026-09-20T09:05:00Z', rows: 6, applied: 4, consents_recorded: 3, basis: 'WEB_FORM', basis_label: 'Signed up on our website or app',
                                                        collected_at: 'Fall sign-up form', attested_by_name: 'Maya Patel', attested_at: '2026-09-20T09:02:00Z', held_back: {} }] : [],
          approval: { status: entry?.approval_status ?? 'NOT_REQUIRED', by_name: entry?.approved_by_name ?? null, at: entry?.approved_at ?? null, note: entry?.approval_note ?? null },
          policy: { without_consent: 'HOLD_BACK', texts_need_date: false, approval_before_send: true, lifetime_months: 24, attestation: 'I confirm these people agreed to receive marketing from Northwind Apparel' },
          consent: [{ channel: 'EMAIL', opted_in_from_file: 3, confirmed_since: 0, no_consent: 1, unsubscribed: 0 }],
          generated_at: '2026-09-21T12:00:00Z',
        })
      }
      if (path.endsWith('/contact-lists/') && method === 'POST') {
        if (listsNow.some((item) => item.name.toLowerCase() === String(body?.name).toLowerCase())) {
          return json({ type: 'about:blank', title: 'Validation', status: 400, errors: { name: 'Another list already has this name.' } }, 400)
        }
        const made = list('cl-new', String(body?.name), 0, true, { status: 'DRAFT', description: (body?.description as string) || null, list_environment: String(body?.list_environment ?? 'PRODUCTION'), channel: String(body?.channel ?? 'EMAIL') })
        listsNow = [made, ...listsNow]
        return json(made, 201)
      }
      if (path.endsWith('/contact-lists/')) {
        const sources: Record<string, string[]> = { UPLOAD: ['UPLOAD'], BI: ['BI', 'EXTRACTION', 'SEGMENT'], CLONE: ['CLONE'] }
        const rows = listsNow.filter((item) => (query.get('status') ? item.status === query.get('status') : item.status !== 'DRAFT')
          && (!query.get('list_environment') || item.list_environment === query.get('list_environment'))
          && (!query.get('source') || sources[query.get('source') as string].includes(item.source_type))
          && item.name.toLowerCase().includes((query.get('search') ?? '').toLowerCase()))
        return json({ next: null, previous: null, results: rows })
      }
      if (one && method === 'PATCH') {
        listsNow = listsNow.map((item) => (item.id === one ? { ...item, ...(body as Partial<ContactList>) } : item))
        return json(find(one))
      }
      if (one && method === 'DELETE') {
        if (find(one)?.attached_campaigns) return json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'This list is attached to a campaign. Detach it there first, or archive the list.' }, 409)
        listsNow = listsNow.filter((item) => item.id !== one)
        return json(null, 204)
      }
      if (one) return find(one) ? json(find(one)) : json({ type: 'about:blank', title: 'Not found', status: 404 }, 404)
    }
    const handled = handleCampaigns({ path, url, method, body }, campaignState)
    if (handled) return handled
    const one = /\/campaigns\/([^/]+)\/$/.exec(path)?.[1]
    if ((method === 'POST' && path.endsWith('/campaigns/')) || (method === 'PATCH' && one)) {
      const custom = options.onSave?.(call)
      if (custom) return custom
      // as the API does: the body's ids come back with the names and details the pages show
      const before = campaignState.campaigns.find((item) => item.id === one)
      const input = { ...(body as Partial<Campaign>) }
      if (input.drip_config && !input.drip_config.steps) input.drip_config = { ...(before?.drip_config ?? { steps: [] }), ...input.drip_config }   // the series time alone
      if (input.ab_config?.enabled && !input.ab_config.subject_b?.trim()) {
        return json({ type: 'about:blank', title: 'Invalid input', status: 400, errors: { ab_config: ['Enter the second subject line, or switch the test off.'] } }, 400)
      }
      const details = [...((input.contact_lists ?? before?.contact_lists ?? []) as string[]).map((id) => ({ id, role: 'INCLUDE' as const })),
                       ...((input.excluded_lists ?? before?.excluded_lists ?? []) as string[]).map((id) => ({ id, role: 'EXCLUDE' as const }))]
        .map(({ id, role }) => { const found = listsNow.find((item) => item.id === id); return { id, name: found?.name ?? id, list_kind: found?.list_kind ?? 'STATIC', is_master: found?.is_master ?? false,
                                   list_environment: found?.list_environment ?? 'PRODUCTION', status: found?.status ?? 'ACTIVE', member_count: found?.member_count ?? 0, role } })
      const saved = makeCampaign({ ...before, ...input, id: before?.id ?? 'c-new', code: (body?.code as string) ?? before?.code ?? 'CMP-2026-0009', row_version: (before?.row_version ?? 1) + 1,
                                   status: before?.status ?? 'DRAFT', runs: before?.runs ?? [], contact_list_details: details,
                                   setup_step: Math.max(before?.setup_step ?? 0, (input.setup_step as number | undefined) ?? (before ? 0 : 6)), // only forward, as the API
                                   template_name: templates.find((item) => item.id === (input.template ?? before?.template))?.name ?? null,
                                   sender_profile_name: senders.find((item) => item.id === (input.sender_profile ?? before?.sender_profile))?.display_name ?? null })
      campaignState.campaigns = before ? campaignState.campaigns.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...campaignState.campaigns]
      return json(saved, method === 'POST' ? 201 : 200)
    }
    if (method === 'DELETE') return json(null, 204)
    if (one) {
      const found = campaignState.campaigns.find((item) => item.id === one)
      return found ? json(found) : json({ type: 'about:blank', title: 'Not found', status: 404, detail: 'No campaign matches the given query.' }, 404)
    }
    if (path.endsWith('/campaigns/')) return listCampaigns(url, campaignState.campaigns)
    return json({ next: null, previous: null, results: [] })
  })
  return calls
}

export function signIn(path = '/') {
  window.localStorage.setItem('cep.access', 'access-1')
  window.localStorage.setItem('cep.refresh', 'refresh-1')
  window.localStorage.setItem('cep.tenant', 'NWA')
  window.history.pushState({}, '', path)
}

export const problem = (status: number, body: Record<string, unknown>) => json({ type: 'about:blank', status, ...body }, status)

/** `await import('@/App').then(cepReady)`: the app module with Engagement's chunk already loaded, so a test's first findBy is not spent on it */
export async function cepReady<T extends { cepReady?: Promise<unknown> }>(app: T): Promise<T> {
  await app.cepReady
  return app
}
