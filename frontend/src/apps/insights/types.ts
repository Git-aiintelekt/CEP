/** The Insights API's shapes (backend apps/insights): the catalogue, a report definition, a saved report, a run's result. */

export type FieldType = 'string' | 'number' | 'date' | 'datetime' | 'boolean'
export type Aggregate = 'sum' | 'count' | 'count_distinct' | 'avg' | 'min' | 'max'
export type Bucket = 'day' | 'week' | 'month' | 'quarter' | 'year'

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
}

export interface EngineInfo {
  engine: 'postgresql' | 'clickhouse'
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
}

export interface ReportSummary {
  id: string
  name: string
  description: string | null
  dataset: string
  dataset_label: string
  component: { key: string; name: string }
  view_type: 'grid' | 'chart' | 'pivot' | 'hierarchy'
  visibility: 'PRIVATE' | 'WORKSPACE'
  version: number
  owner_user_id: string | null
  owner_name: string | null
  last_run_at: string | null
  updated_at: string
  can_edit: boolean
}

export interface Report extends Omit<ReportSummary, 'dataset_label' | 'component'> {
  definition: ReportDefinition
  row_version: number
  folder_id: string | null
  created_at: string
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

export interface RunResult {
  columns: ResultColumn[]
  rows: unknown[][]
  row_count: number
  duration_ms: number
  truncated: boolean
  offset: number
  limit: number
  freshness: string
  cached: boolean
}
