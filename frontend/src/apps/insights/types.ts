/** The Insights API's shapes (backend apps/insights): the catalogue, a report definition, a saved report, a run's result. */

export type FieldType = 'string' | 'number' | 'date' | 'datetime' | 'boolean'
/** calc: a calculated measure's one aggregate; its formula over the other measures does the totalling */
export type Aggregate = 'sum' | 'count' | 'count_distinct' | 'avg' | 'min' | 'max' | 'calc'
export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'funnel' | 'stacked' | 'stacked100' | 'combo' | 'scatter' | 'bubble' | 'treemap' | 'waterfall' | 'gauge' | 'kpi' | 'map'

/** conditional formatting of a totalled column (a measure, or <field>__<kind> for one of its comparisons) */
export type FormatStyle = 'scale' | 'bars' | 'rules'
export type FormatTone = 'good' | 'warning' | 'bad'
export interface FormatRule { op: '>' | '>=' | '<' | '<=' | '='; value: number; tone: FormatTone }
export interface ColumnFormat { column: string; style: FormatStyle; rules?: FormatRule[] }
export type Bucket = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'fiscal_quarter' | 'fiscal_year'

/** the workspace's fiscal year (Settings → Fiscal Year): the month it starts in, and whether FY2027 is the year it ends or starts in */
export interface FiscalYear { start: number; named_by: 'end' | 'start'; months?: string[] }
export type ViewType = 'grid' | 'chart' | 'hierarchy' | 'pivot' | 'influencers' | 'decomposition'

/** how the report is shown: the view, the chart's kind, and for a chart or a pivot which dimension goes across */
export interface ReportView {
  type: ViewType
  chart?: ChartKind
  across?: string
  /** conditional formatting in the grid, the pivot and the hierarchy */
  formats?: ColumnFormat[]
  /** a chart's forecast line and anomaly flags, worked out in the browser from the rows */
  signals?: ChartSignal[]
  /** a gauge's or a KPI card's target */
  target?: number
  /** small multiples: the chart repeated per value of this dimension */
  multiples?: string
  /** a map's shapes: US states, the world's countries, or worked out from the values */
  geo?: 'auto' | 'us' | 'world'
  /** a pivot with every value side by side */
  matrix?: boolean
  /** a pivot with a trend line per row */
  sparklines?: boolean
  /** the value Key Influencers or the Decomposition Tree analyses */
  measure?: string
  /** a report shown on hover over a chart's value, filtered to it */
  tooltip?: string
}
export type ChartSignal = 'forecast' | 'anomalies'

/** a calculated measure's formula: two sides, each a measure with one of its aggregates or a number, optionally scaled (100 for a percentage) */
export type FormulaOp = 'ratio' | 'difference' | 'sum' | 'product'
export type FormulaSide = { field: string; aggregate: Aggregate } | { value: number }
export interface MeasureFormula { op: FormulaOp; left: FormulaSide; right: FormulaSide; scale?: number }

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
  /** a calculated measure: the formula the engine totals; aggregates is ['calc'] */
  formula?: MeasureFormula
  /** one of the report's own custom fields, not the dataset's */
  custom?: boolean
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
  /** a dataset from a query, or from a table (and its joins), or an uploaded file */
  kind?: 'table' | 'query' | 'upload'
  /** set on an uploaded file's dataset (Insights → Uploaded Files) */
  upload?: { id: string; file_name: string; row_count: number; updated_at: string }
  /** the platform's datasets this one is linked to: a report on it adds their measures (apps/insights/links.py) */
  links?: DatasetLink[]
}

export interface DatasetLink {
  to: string
  to_label: string
  label: string
  /** [this dataset's field, the other's]: what both share */
  pairs: [string, string][]
  /** the dates that mean the same period */
  time_pair: [string, string] | null
  measures: Pick<CatalogField, 'key' | 'label' | 'type' | 'aggregates' | 'format'>[]
}

/** measures added from a linked dataset, totalled on its own by the report's groups */
export interface Blend {
  dataset: string
  columns: { field: string; aggregate: Aggregate; label?: string }[]
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

/** a measure's time comparisons (apps/insights/compare.py): each one more result column after the measure */
export type CompareKind = 'previous_period' | 'previous_year' | 'change_previous_period' | 'change_previous_year' | 'running_total' | 'percent_of_total'
  | 'year_to_date' | 'quarter_to_date' | 'moving_average' | 'rank' | 'percent_of_target' | 'difference_to_target'

export interface ReportColumn {
  field: string
  aggregate?: Aggregate
  bucket?: Bucket
  label?: string
  compare?: CompareKind[]
  /** the number % of Target and Difference to Target compare with */
  target?: number
}

/** drill-down (apps/insights/drill.py): the value clicked at a level, and where a run is among the report's levels */
export interface DrillStep { field: string; bucket?: Bucket; value: string | number | boolean | null }
export interface DrillLevel { field: string; bucket?: Bucket; label: string }
export interface DrillInfo { levels: DrillLevel[]; path: DrillStep[]; depth: number }

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
  /** a detail report: the fields other reports on its dataset can open it through */
  drillthrough?: string[]
  /** the report's own dimensions worked out from each row (apps/insights/derived.py) */
  derived?: CustomField[]
  /** keep the first dimension's top values, the rest left out or folded into Others */
  top?: { n: number; others: boolean }
  /** measures from a linked dataset */
  blend?: Blend
  /** questions the report asks before it runs, each answered into one filter rule (apps/insights/parameters.py) */
  parameters?: ReportParameter[]
}

export type ParameterOperator = '=' | 'in' | '>=' | '<=' | 'between' | 'last_days'
export interface ReportParameter {
  key: string
  label: string
  field: string
  operator: ParameterOperator
  required: boolean
  default?: unknown
}
/** the answers, by parameter key */
export type ParameterValues = Record<string, unknown>
export interface ParameterChoices { field: string; label?: string; values: (string | number | boolean)[]; choosable: boolean; more?: boolean }

/** Insights → Uploaded Files (apps/insights/uploads.py) */
export type UploadColumnType = 'string' | 'number' | 'date' | 'datetime' | 'boolean'
export interface UploadColumn {
  key: string
  label: string
  /** where its values are in a row: c1, c2 ... */
  column: string
  /** the file's header */
  source: string
  type: UploadColumnType
  /** the type read from the values; a column can be that or text */
  inferred: UploadColumnType
  types: UploadColumnType[]
  role: 'dimension' | 'measure'
}
export interface UploadedFile {
  id: string
  key: string
  name: string
  description: string | null
  file_name: string
  file_kind: 'csv' | 'xlsx'
  columns: UploadColumn[]
  row_count: number
  status: 'DRAFT' | 'READY'
  created_at: string
  updated_at: string
  replaced_at: string | null
  row_version: number
  /** reports built on it */
  reports?: number
  /** the first rows, by column (c1 ...) */
  sample?: Record<string, unknown>[]
}

export interface CustomField {
  key?: string
  label: string
  kind: 'group' | 'band' | 'rule'
  field?: string
  groups?: { label: string; values: (string | number)[] }[]
  edges?: number[]
  labels?: string[]
  rules?: { field: string; op: '=' | '!=' | '>' | '>=' | '<' | '<='; value: string | number | boolean; label: string }[]
  other?: string
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
  /** shared with people or roles */
  shared?: boolean
  /** the owner, or a report administrator: may change who it is shared with */
  can_share?: boolean
}

/** sharing (apps/insights/access.py) */
export type ShareKind = 'report' | 'dashboard'
export interface Principal { kind: 'user' | 'role'; id: string; name: string; detail: string }
export interface Share extends Principal { permission: 'view' | 'edit' }
export interface SharesState { visibility: 'PRIVATE' | 'WORKSPACE'; shares: Share[]; can_share: boolean }

/** a row access rule: a person or a role sees only these values of one field of a dataset */
export interface RowRule {
  id: string
  dataset: string
  dataset_label: string
  field: string
  field_label: string
  /** the dataset no longer offers the field: the person's runs on it are refused */
  broken: boolean
  principal: Principal
  values: (string | number | boolean)[]
  note: string | null
  updated_at: string
  row_version: number
}
export interface RowRules { rules: RowRule[]; datasets: { key: string; label: string; fields: { key: string; label: string; type: string }[] }[] }

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
export type ScheduleFormat = 'xlsx' | 'csv' | 'pdf' | 'pptx'

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
  /** a fiscal quarter's or year's column: how the workspace names it */
  fiscal?: FiscalYear
  /** a time comparison of the measure before it: never combined into a subtotal */
  compare?: CompareKind
  /** a measure from this linked dataset */
  linked?: string
}

// ---------------------------------------------------------------------------------------------------- dashboards

export type PeriodPreset = '7d' | '30d' | 'month' | 'quarter' | 'fquarter' | 'fyear' | 'custom'
export interface Period { preset: PeriodPreset; from?: string; to?: string }
export interface PeriodBounds { from: string; to: string; previous_from: string; previous_to: string }
export type RowWidth = '1' | '2' | '3' | '4' | '2-1'
export type TileShow = ViewType | 'figure' | 'summary' | 'text' | 'button'

export interface DashboardTile {
  id: string
  /** empty for a text tile or a button */
  report_id: string
  show: TileShow
  title?: string
  /** a figure: the report's totalled column it shows */
  measure?: string
  /** a text tile's words: paragraphs, lines starting "- " as bullets, **bold** */
  text?: string
  /** a button's label and what it does */
  label?: string
  action?: { kind: 'view' | 'page' | 'report'; id: string }
  /** left out on a phone */
  hide_on_phone?: boolean
}
/** a tile on a free canvas: its column (0-11), its row, its width in columns and its height in rows */
export interface DashboardCell extends DashboardTile { x: number; y: number; w: number; h: number }
export type DashboardTheme = 'default' | 'navy' | 'earth' | 'berry' | 'greyscale'
export interface DashboardRow { width: RowWidth; tiles: DashboardTile[] }
/** a dimension of the tiles' datasets the whole dashboard is filtered by */
export interface DashboardSlicer { field: string; label: string; kind?: 'values' | 'range'; type?: FieldType }
/** a page of a dashboard with tabs */
export interface DashboardPageT { id: string; title: string; rows: DashboardRow[]; canvas?: boolean; cells?: DashboardCell[] }
/** a page, or a dashboard without pages: rows of tiles, or a free canvas */
export interface DashboardContainer { rows: DashboardRow[]; canvas?: boolean; cells?: DashboardCell[] }
export interface DashboardLayout extends DashboardContainer { slicers?: DashboardSlicer[]; pages?: DashboardPageT[]; theme?: DashboardTheme }
/** a range slicer's ends, either may be empty */
export interface SlicerRange { from?: string | number; to?: string | number }
/** what is picked on each slicer: field key to values; an empty list is no filter */
export type SlicerSelection = Record<string, unknown[] | SlicerRange>
/** what a saved view keeps of a dashboard */
export interface ViewState { period?: Period; compare?: boolean; page?: string; selection?: SlicerSelection; extra?: DashboardSlicer[]; drills?: Record<string, DrillStep[]> }
export interface SavedView { id: string; name: string; state: ViewState; shared: boolean; owner_name: string | null; mine: boolean; updated_at: string }
export interface SlicerValues { field: string; label: string; values: unknown[]; datasets: number }
/** a dimension the editor offers as a slicer, and the datasets it is in */
export interface SlicerCandidate { field: string; label: string; datasets: string[]; kind: 'values' | 'range'; type: FieldType }

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
  shared?: boolean
}

export interface Dashboard extends Omit<DashboardSummary, 'tiles' | 'favourite'> {
  can_share?: boolean
  period: Period
  compare: boolean
  layout: DashboardLayout
  row_version: number
  created_at: string
  bounds: PeriodBounds
}

export type TileResult =
  | { kind: 'figure'; value: number | string | null; previous: number | string | null; compared: boolean; column: ResultColumn; own_dates: boolean; bounds: PeriodBounds; report: { id: string; name: string; version: number }; cached: boolean; sliced?: string[] }
  | { kind: 'view'; view: ReportView; result: RunResult; own_dates: boolean; bounds: PeriodBounds; report: { id: string; name: string; version: number; dataset?: string }; sliced?: string[]; drill?: DrillInfo }
  | { kind: 'summary'; summary: string | null; points?: string[]; caution?: string; detail?: string; model?: { label: string }; cached?: boolean; bounds: PeriodBounds; report: { id: string; name: string; version: number }; sliced?: string[] }
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
  /** the uploaded file the rows came from */
  upload?: string
  /** what the report's parameters were answered with */
  parameters?: { key: string; label: string; value: unknown }[]
  /** a saved report with more than one level: where this run is, for drilling */
  drill?: DrillInfo
  /** this person's row access rules that narrowed the rows */
  access?: { field: string; label: string; values: unknown[] }[]
  /** opened from another report: the values it was opened through */
  through?: { field: string; label: string; value: unknown }[]
  /** measures from a linked dataset: its name, and the filters that applied to the report's own dataset only */
  linked?: { dataset: string; label?: string; own_rules?: string[] }
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
/** on a mapped dataset a side may name the measure by its column (and table) until the dataset is saved */
export type DatasetFormulaSide = FormulaSide | { column: string; table?: string; aggregate: Aggregate }
export interface DatasetFormula { op: FormulaOp; left: DatasetFormulaSide; right: DatasetFormulaSide; scale?: number | null }

export interface ReportDatasetField {
  /** the field's key, set by the server from the label */
  key?: string
  /** null on a calculated measure */
  column: string | null
  /** a calculated measure: its formula over the dataset's other measures */
  formula?: DatasetFormula
  /** the table's alias when the dataset joins tables: t0 the base, t1.. the joins */
  table?: string
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
  /** the tables joined to the base, in order */
  joins: DatasetJoin[]
  /** a dataset from a query reads the SELECT; a table dataset reads its source and joins */
  kind: 'table' | 'query'
  query_sql: string | null
  created_by?: string | null
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
/** a join in a mapped dataset: alias t1.., the table, Left or Inner, the alias it joins to (t0 the base), the key pairs [parent column, table column] */
export interface DatasetJoin {
  alias: string
  table: string
  type: 'left' | 'inner'
  to: string
  on: [string, string][]
}
/** a database a report author may query (Settings connected it) */
export interface QueryTarget {
  id: string
  name: string
  engine: DatabaseEngine
  engine_name: string
  database_name: string
  schema_name: string
}
/** the query window's Run */
export interface QueryRun {
  columns: { column: string; column_type: string; mappable: boolean; type: FieldType; role: 'dimension' | 'measure'; aggregates: Aggregate[]; format: CatalogField['format'] }[]
  rows: unknown[][]
  truncated: boolean
  ms: number
  sql: string
  fields: ReportDatasetField[]
}
export interface JoinCheck {
  base_rows: number
  joined_rows: number
  matched_rows: number
  multiplies: boolean
  factor: number | null
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
  /** Explain This Report: any reader, when the platform and the workspace allow it */
  explain?: { enabled: boolean; model: { id: string; label: string; provider_name: string } | null }
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

// ---------------------------------------------------------------------------------------------------- the smaller gaps

/** Show the SQL: the statements as the engine runs them, the values written in */
export interface SqlStatements {
  statements: { label: string; dialect: string; sql: string; access?: { field: string; label: string; values: unknown[] }[] }[]
  note: string
}

/** Explain This Report */
export interface Explanation {
  summary: string
  points: string[]
  caution: string
  counted: boolean
  model?: { id: string; provider_name: string; label: string; source: string }
  rows_sent?: number
  left_out?: string[]
}

/** Change with a Prompt: the changed definition, or the model's one question, or what no field holds */
export interface ChangeResult {
  kind: 'draft' | 'question' | 'no_field'
  definition?: ReportDefinition
  view?: ReportView
  question?: string
  answers?: AskPrompt[]
  message?: string
  suggestions?: AskPrompt[]
  counted: boolean
}

/** an embed link: the secret shows once, when it is made */
export interface EmbedLink {
  id: string
  label: string | null
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  uses: number
  created_by_name: string | null
  secret?: string
  path?: string
}

/** what an embed link opens, for anyone with it */
export type PublicEmbed =
  | { kind: 'report'; name: string; workspace: string; view: ReportView; result: RunResult }
  | { kind: 'dashboard'; name: string; description: string | null; workspace: string; period: Period; compare: boolean; layout: DashboardLayout; bounds: PeriodBounds }

/** the usage page: what is opened, by whom, and what nobody opens */
export interface UsageReport {
  days: number
  ready: boolean
  items: { kind: 'report' | 'dashboard'; item_id: string; name: string; opens: number; people: number; embedded: number; last_opened: string }[]
  unopened: { id: string; name: string; owner_name: string | null; updated_at: string }[]
  people: { user_id: string; name: string; opens: number; items: number; last_opened: string }[]
  daily: { day: string; opens: number }[]
}

// ---------------------------------------------------------------------------------------------------- the analysing visuals

/** one segment Key Influencers found: when this field has this value, the analysed value is this far from the whole */
export interface Influence {
  field: string
  field_label: string
  bucket?: Bucket
  value: unknown
  value_label: string
  measure: number
  effect: number
  rows: number | null
  share: number
  score: number
}
export interface InfluencersResult {
  kind: 'influencers'
  measure: { field: string; label: string; column: ResultColumn }
  overall: number
  rows: number | null
  higher: Influence[]
  lower: Influence[]
  explained_by: string[]
  /** a percentage: differences read in points */
  points: boolean
}
export interface DecomposeResult {
  kind: 'decompose'
  measure: { field: string; label: string; column: ResultColumn }
  total: number | null
  path: { field: string; value: unknown }[]
  explain_by: { field: string; label: string; bucket?: Bucket }[]
  by?: string
  by_label?: string
  bucket?: Bucket
  rows?: { value: unknown; label: string; measure: number | null }[]
  more?: boolean
  /** the AI split that picked the field */
  chosen?: 'auto_high' | 'auto_low'
}
/** where an analysing visual reads from: a saved report, or a draft in the editor */
export type AnalysisSource = { reportId: string; params?: ParameterValues } | { dataset: string; definition: ReportDefinition; params?: ParameterValues }

// ---------------------------------------------------------------------------------------------------- alerts and comments

export type AlertOp = '<' | '<=' | '>' | '>='
export interface ReportAlert {
  id: string
  report_id: string
  report_name: string | null
  name: string | null
  measure: string
  measure_label: string
  op: AlertOp
  threshold: number
  every: 'hour' | 'day'
  at_time: string | null
  recipients: string[]
  status: 'ACTIVE' | 'PAUSED'
  state: 'UNKNOWN' | 'OK' | 'TRIGGERED'
  last_value: number | null
  last_checked_at: string | null
  last_fired_at: string | null
  last_detail: string | null
  next_check_at: string | null
  owner_name: string | null
  row_version: number
  words: string
  can_change?: boolean
  checks?: { checked_at: string; trigger: string; value: number | null; met: boolean | null; notified: boolean; outcome: string; detail: string | null }[]
}
export interface AlertBody { report_id?: string; name?: string; measure: string; op: AlertOp; threshold: number; every: 'hour' | 'day'; at_time?: string; recipients: string[]; row_version?: number }

export interface CommentAnchor { tile_id?: string; field?: string; value?: unknown; label?: string }
export interface InsightsComment {
  id: string
  body: string
  anchor: CommentAnchor | null
  author_name: string
  mine: boolean
  can_delete: boolean
  created_at: string
  edited_at: string | null
  resolved_at: string | null
  resolved_by_name: string | null
}
