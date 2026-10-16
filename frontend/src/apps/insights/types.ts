/** The Insights API's shapes (backend apps/insights): the catalogue, a report definition, a saved report, a run's result. */

export type FieldType = 'string' | 'number' | 'date' | 'datetime' | 'boolean'
export type Aggregate = 'sum' | 'count' | 'count_distinct' | 'avg' | 'min' | 'max'
export type Bucket = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type ViewType = 'grid' | 'chart' | 'hierarchy' | 'pivot'

/** how the report is shown: the view, the chart's kind, and for a chart or a pivot which dimension goes across */
export interface ReportView {
  type: ViewType
  chart?: 'bar' | 'line' | 'area'
  across?: string
}

export interface CatalogField {
  key: string
  label: string
  type: FieldType
  role: 'dimension' | 'measure'
  aggregates: Aggregate[]
  operators: string[]
  buckets: Bucket[]
  format: 'integer' | 'decimal' | 'money' | 'percent' | 'date' | 'datetime' | null
  sensitivity: 'NORMAL' | 'PII' | 'CONFIDENTIAL'
}

export interface CatalogDataset {
  key: string
  label: string
  description: string | null
  component: { key: string; name: string }
  primary_key: string
  time_field: string | null
  freshness: string
  fields: CatalogField[]
  /** PII fields hidden from this person (they need the report administration right to build on them) */
  locked?: { key: string; label: string }[]
  /** set on a dataset the workspace mapped from one of its own databases (Settings → Report Databases) */
  database?: { id: string; name: string; engine: DatabaseEngine; engine_name: string }
}

export interface EngineInfo {
  engine: 'postgresql' | 'clickhouse'
  /** the engine the reports run on now: ClickHouse only once it is active */
  dialect?: 'postgresql' | 'clickhouse'
  status: 'ACTIVE' | 'MIGRATING' | 'READ_ONLY'
  freshness_sla: string
  limits: { statement_timeout_ms: number; preview_rows: number; run_rows: number; export_rows: number; concurrent: number }
}

export interface Catalog {
  datasets: CatalogDataset[]
  engine: EngineInfo
}

export interface ReportColumn {
  field: string
  aggregate?: Aggregate
  bucket?: Bucket
  label?: string
}

export interface FilterRule {
  field: string
  operator: string
  value?: unknown
}

export interface FilterGroup {
  combinator: 'and' | 'or'
  rules: (FilterRule | FilterGroup)[]
}

export interface ReportDefinition {
  columns: ReportColumn[]
  filters?: FilterGroup
  orderBy?: { field: string; direction: 'asc' | 'desc' }[]
  limit?: number
  view?: ReportView
}

export interface ReportSummary {
  id: string
  name: string
  description: string | null
  dataset: string
  dataset_label: string
  component: { key: string; name: string }
  view_type: ViewType
  visibility: 'PRIVATE' | 'WORKSPACE'
  version: number
  owner_user_id: string | null
  owner_name: string | null
  last_run_at: string | null
  updated_at: string
  can_edit: boolean
  folder_id: string | null
  folder_name: string | null
  /** this person's star */
  favourite: boolean
  /** the dataset is one the workspace mapped from its own database */
  own_dataset?: boolean
}

export interface Folder {
  id: string
  name: string
  owner_user_id: string | null
  reports: number
  row_version: number
  updated_at: string
}

export interface Report extends Omit<ReportSummary, 'dataset_label' | 'component' | 'folder_name' | 'favourite'> {
  definition: ReportDefinition
  row_version: number
  folder_id: string | null
  created_at: string
}

export interface ReportVersion {
  version: number
  view_type: ViewType
  note: string | null
  changed_at: string
  changed_by_name: string | null
  definition: ReportDefinition
}

export type ScheduleEvery = 'day' | 'weekday' | 'week' | 'month'
export type ScheduleFormat = 'xlsx' | 'csv' | 'pdf'

export interface Schedule {
  id: string
  kind: 'report' | 'dashboard'
  item_id: string
  item_name: string | null
  view_type: ViewType | null
  item_gone: boolean
  owner_user_id: string | null
  owner_name: string | null
  every: ScheduleEvery
  on_day: number | null
  /** "08:00", in the workspace's zone */
  at_time: string
  format: ScheduleFormat
  recipients: string[]
  subject: string | null
  note: string | null
  status: 'ACTIVE' | 'PAUSED'
  failures: number
  last_sent_at: string | null
  last_outcome: string | null
  last_detail: string | null
  next_run_at: string | null
  /** "Every Monday at 08:00" */
  words: string
  row_version: number
  created_at: string
  updated_at: string
}

export interface ScheduleBody {
  kind: 'report' | 'dashboard' | 'dashboard'
  item_id: string
  every: ScheduleEvery
  on_day: number | null
  at_time: string
  format: ScheduleFormat
  recipients: string[]
  subject: string | null
  note: string | null
}

export type RunOutcome = 'OK' | 'TIMEOUT' | 'REFUSED' | 'FAILED'

export interface RunLogEntry {
  id: number
  started_at: string
  kind: 'preview' | 'run' | 'export' | 'delivery'
  outcome: RunOutcome
  detail: string | null
  duration_ms: number | null
  row_count: number | null
  dataset: string
  dataset_label: string | null
  report_id: string | null
  report_name: string | null
  report_version: number | null
  user_id: string | null
  user_name: string | null
}

export interface RunLog {
  days: number
  runs: RunLogEntry[]
  summary: { runs: number; timed_out: number; refused: number; failed: number; median_ms: number | null }
  people: { id: string; name: string }[]
}

export interface ResultColumn {
  key: string
  label: string
  type: FieldType
  format: CatalogField['format']
  aggregate?: Aggregate
  bucket?: Bucket
  /** personal data this reader may not see: every value is the mask */
  masked?: boolean
}

// ---------------------------------------------------------------------------------------------------- dashboards

export type PeriodPreset = '7d' | '30d' | 'month' | 'quarter' | 'custom'
export interface Period { preset: PeriodPreset; from?: string; to?: string }
export interface PeriodBounds { from: string; to: string; previous_from: string; previous_to: string }
export type RowWidth = '1' | '2' | '3' | '4' | '2-1'
export type TileShow = ViewType | 'figure'

export interface DashboardTile {
  id: string
  report_id: string
  show: TileShow
  title?: string
  /** a figure: the report's totalled column it shows */
  measure?: string
}
export interface DashboardRow { width: RowWidth; tiles: DashboardTile[] }
export interface DashboardLayout { rows: DashboardRow[] }

export interface DashboardSummary {
  id: string
  name: string
  description: string | null
  visibility: 'PRIVATE' | 'WORKSPACE'
  tiles: number
  version: number
  owner_user_id: string | null
  owner_name: string | null
  updated_at: string
  can_edit: boolean
  favourite: boolean
}

export interface Dashboard extends Omit<DashboardSummary, 'tiles' | 'favourite'> {
  period: Period
  compare: boolean
  layout: DashboardLayout
  row_version: number
  created_at: string
  bounds: PeriodBounds
}

export type TileResult =
  | { kind: 'figure'; value: number | string | null; previous: number | string | null; compared: boolean; column: ResultColumn; own_dates: boolean; bounds: PeriodBounds; report: { id: string; name: string; version: number }; cached: boolean }
  | { kind: 'view'; view: ReportView; result: RunResult; own_dates: boolean; bounds: PeriodBounds; report: { id: string; name: string; version: number } }
  | { kind: 'missing'; detail: string }
  | { kind: 'refused'; detail: string; outcome: string }

/** one of the engine's totals: the dimension values kept (the ones totalled away are absent) and the measures in the report's order */
export interface TotalEntry {
  keys: Record<string, unknown>
  values: (number | string | null)[]
}

export interface RunResult {
  columns: ResultColumn[]
  rows: unknown[][]
  /** the engine's totals for a hierarchy (every prefix of the dimensions, and the whole) or a pivot (its rows, its columns, the whole) */
  totals?: TotalEntry[]
  row_count: number
  duration_ms: number
  truncated: boolean
  offset: number
  limit: number
  freshness: string
  cached: boolean
  /** the workspace's own database the rows came from, when the dataset is one of its own */
  source?: string
}

/** Settings → Report Databases (backend apps/insights/databases.py, external.py) */
export type DatabaseEngine = 'mysql57' | 'mysql80' | 'postgresql'
export interface ReportDatabaseTest {
  ok: boolean
  version?: string
  timezone?: string
  tables?: number
  views?: number
  read_only?: boolean
  offending?: string[]
  ms: number
  error: string | null
}
export interface ReportDatasetField {
  /** the field's key, set by the server from the label */
  key?: string
  column: string
  label: string
  type: FieldType
  role: 'dimension' | 'measure'
  aggregates: Aggregate[]
  format: CatalogField['format']
  sensitivity: 'NORMAL' | 'PII' | 'CONFIDENTIAL'
}
export interface ReportDataset {
  id: string
  connection_id: string
  key: string
  label: string
  description: string | null
  /** the table or view */
  source: string
  primary_key: string | null
  time_field: string | null
  fields: ReportDatasetField[]
  field_count: number
  pii_count: number
  /** reports built on it */
  reports: number
  status: 'ACTIVE' | 'HIDDEN'
  updated_at: string
  row_version: number
}
export interface ReportDatabase {
  id: string
  name: string
  engine: DatabaseEngine
  engine_name: string
  host: string
  port: number
  database_name: string
  /** PostgreSQL: the schema the sources live in */
  schema_name: string
  username: string
  ssl_mode: 'REQUIRED' | 'PREFERRED' | 'OFF'
  status: 'ACTIVE' | 'DISABLED'
  last_tested_at: string | null
  last_test_ok: boolean | null
  last_test_error: string | null
  /** the grants check: null until tested */
  read_only: boolean | null
  server_version: string | null
  server_timezone: string | null
  created_at: string
  updated_at: string
  row_version: number
  /** active, with a password, and not known to be able to write */
  usable: boolean
  datasets?: ReportDataset[]
  /** the test run at save time */
  test?: ReportDatabaseTest | null
}
export interface ReportDatabases {
  databases: ReportDatabase[]
  grant_examples: { mysql: string; postgresql: string }
  /** the tables exist (patch 0056) */
  ready: boolean
}
export interface SourceInfo {
  name: string
  kind: 'table' | 'view'
  rows: number | null
  columns: number
  mappable: boolean
  mapped_as: string | null
}
export interface SourceColumns {
  source: string
  columns: { column: string; column_type: string; key: boolean; mappable: boolean; type: FieldType; role: 'dimension' | 'measure'; aggregates: Aggregate[]; format: CatalogField['format'] }[]
  sample: { columns: string[]; rows: unknown[][] }
  mapped_as: ReportDataset | null
}

/** AI · Ask for a Report (backend apps/insights/assistant.py) */
export interface AssistantModel {
  /** provider:model, what the ask sends */
  id: string
  provider: 'anthropic' | 'openai'
  provider_name: string
  /** the one-letter mark beside the name */
  mark: string
  model: string
  label: string
  note: string
  /** the platform's key, or the workspace's own */
  source?: 'platform' | 'own'
}
export interface AssistantUsage { used: number; limit: number | null; month: string; plan: string | null; words?: string }
export interface AssistantRecent {
  id: string
  prompt: string
  model: string
  provider: string
  outcome: 'DRAFT' | 'QUESTION' | 'NO_FIELD' | 'FAILED'
  created_at: string
  report_id: string | null
  report_name: string | null
}
export interface AssistantState {
  enabled: boolean
  reason: 'no_right' | 'no_provider' | 'workspace_off' | 'no_provider_allowed' | null
  models: AssistantModel[]
  default_model: string | null
  usage: AssistantUsage | null
  /** the providers running on the workspace's own key */
  own?: string[]
  examples?: string[]
  recent: AssistantRecent[]
}
export interface AskPrompt { label: string; prompt: string }
export interface AskResult {
  id: string
  kind: 'draft' | 'question' | 'no_field' | 'failed'
  prompt: string
  model: Pick<AssistantModel, 'id' | 'provider' | 'provider_name' | 'mark' | 'model' | 'label'>
  duration_ms: number
  counted: boolean
  message: string | null
  name?: string
  dataset?: string
  dataset_label?: string
  view?: ReportView
  definition?: ReportDefinition
  preview?: { rows: number; more: boolean } | null
  question?: string
  answers?: AskPrompt[]
  suggestions?: AskPrompt[]
  usage: AssistantUsage
}
/** Settings → AI Assistant: one provider, the platform's key and the workspace's own */
export interface WorkspaceAssistantProvider {
  key: 'anthropic' | 'openai'
  name: string
  mark: string
  /** where the key comes from: "console.anthropic.com → API Keys" */
  keys: string
  /** the platform offers this provider */
  platform: boolean
  platform_models: string[]
  own: { configured: boolean; model_reports: string | null; model_fast: string | null; last_checked_at: string | null; last_check_ok: boolean | null; last_check_error: string | null } | null
  default_models: string[]
}
export interface WorkspaceAssistant {
  enabled: boolean
  providers: Record<'anthropic' | 'openai', boolean>
  explain: boolean
  available: WorkspaceAssistantProvider[]
  explain_allowed: boolean
  usage: AssistantUsage
  retention_days: number
}
