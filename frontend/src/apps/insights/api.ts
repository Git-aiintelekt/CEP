/** Insights' endpoints (backend apps/insights/api.py), typed. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { AlertBody, InsightsComment, ReportAlert, CommentAnchor, CustomField, FiscalYear, FormulaCheck, ParameterChoices, SharedFormula, SharedFormulaBody, ParameterValues, UploadColumn, UploadedFile } from './types'
import type { AnalysisSource, ChangeResult, DecomposeResult, EmbedLink, Explanation, InfluencersResult, SqlStatements, UsageReport } from './types'
import type { AskResult, AskScope, AssistantState, Catalog, CatalogDataset, Dashboard, DashboardLayout, DashboardSummary, DashboardTile, DrillStep, Folder, Period, Principal, Report, ReportDefinition, ReportSummary, ReportVersion, ReportView, RowRule, SavedView, RowRules, RunLog, RunResult, Schedule, ScheduleBody, Share, ShareKind, SharesState, SlicerSelection, SlicerValues, TileResult, ViewState } from './types'

export const insightsApi = {
  catalog: (signal?: AbortSignal) => api.get<Catalog>('/insights/catalog/', undefined, signal),
  dataset: (key: string, signal?: AbortSignal) => api.get<CatalogDataset>(`/insights/catalog/${key}/`, undefined, signal),
  reports: (query: { component?: string; dataset?: string; q?: string; folder?: string; detail_for?: string }, signal?: AbortSignal) =>
    api.get<{ reports: ReportSummary[] }>('/insights/reports/', Object.fromEntries(Object.entries(query).filter(([, v]) => v)), signal),
  report: (id: string, signal?: AbortSignal) => api.get<Report & { can_edit: boolean }>(`/insights/reports/${id}/`, undefined, signal),
  create: (body: { name: string; dataset: string; definition: ReportDefinition; description?: string; visibility?: 'PRIVATE' | 'WORKSPACE' }) =>
    api.post<Report>('/insights/reports/', body),
  update: (id: string, body: { row_version: number; name?: string; description?: string | null; visibility?: 'PRIVATE' | 'WORKSPACE'; definition?: ReportDefinition; note?: string; folder_id?: string | null }) =>
    api.put<Report>(`/insights/reports/${id}/`, body),
  remove: (id: string) => api.delete(`/insights/reports/${id}/`),
  versions: (id: string, signal?: AbortSignal) => api.get<{ versions: ReportVersion[] }>(`/insights/reports/${id}/versions/`, undefined, signal),
  restore: (id: string, version: number) => api.post<Report>(`/insights/reports/${id}/versions/${version}/restore/`, {}),
  /** params: the answers to the report's parameters */
  preview: (body: { dataset: string; definition: ReportDefinition; limit?: number; offset?: number; view?: ReportView; params?: ParameterValues }) => api.post<RunResult>('/insights/reports/preview/', body),
  /** drill: the values clicked at the levels above the one to run */
  run: (id: string, body: { limit?: number; offset?: number; view?: ReportView; drill?: { path: DrillStep[] }; through?: { field: string; value: unknown }[]; params?: ParameterValues } = {}) => api.post<RunResult>(`/insights/reports/${id}/run/`, body),
  exportUrl: (id: string) => `/insights/reports/${id}/export.csv`,
  exportCsv: (id: string, params?: ParameterValues) => api.download(`/insights/reports/${id}/export.csv`, answersQuery(params)),
  exportXlsx: (id: string, params?: ParameterValues) => api.download(`/insights/reports/${id}/export.xlsx`, answersQuery(params)),
  exportPdf: (id: string, params?: ParameterValues) => api.download(`/insights/reports/${id}/export.pdf`, answersQuery(params)),
  exportPptx: (id: string, params?: ParameterValues) => api.download(`/insights/reports/${id}/export.pptx`, answersQuery(params)),
  /** the print-ready PDF: every row, the paper and the way round, a section per value of the first field */
  exportPrint: (id: string, options: { size: 'a4' | 'letter'; orientation: 'portrait' | 'landscape'; group: boolean }, params?: ParameterValues) =>
    api.download(`/insights/reports/${id}/export.pdf`, { layout: 'print', size: options.size, orientation: options.orientation, ...(options.group ? { group: '1' } : {}), ...answersQuery(params) }),
  /** the statements the engine runs for a definition, the values written in (nothing runs) */
  sql: (body: { dataset: string; definition: ReportDefinition }) => api.post<SqlStatements>('/insights/reports/sql/', body),
  explain: (id: string, body: { model?: string; drill?: { path: DrillStep[]; keep_rest?: boolean }; params?: ParameterValues }) => api.post<Explanation>(`/insights/reports/${id}/explain/`, body),
  /** Key Influencers and the Decomposition Tree, on a saved report or a draft */
  influencers: (source: AnalysisSource, measure?: string) =>
    api.post<InfluencersResult>('reportId' in source ? `/insights/reports/${source.reportId}/analyze/` : '/insights/reports/analyze/', { ...analysisBody(source), kind: 'influencers', ...(measure ? { measure } : {}) }),
  decompose: (source: AnalysisSource, body: { measure?: string; path: { field: string; value: unknown }[]; by?: string }) =>
    api.post<DecomposeResult>('reportId' in source ? `/insights/reports/${source.reportId}/analyze/` : '/insights/reports/analyze/', { ...analysisBody(source), kind: 'decompose', ...body }),
}

/** what an analysis sends: a draft's dataset and definition, and the answers to the report's parameters */
function analysisBody(source: AnalysisSource): Record<string, unknown> {
  if ('reportId' in source) return source.params ? { params: source.params } : {}
  return source
}

/** a file's answers, as JSON in its address */
function answersQuery(params?: ParameterValues): Record<string, string> | undefined {
  return params && Object.keys(params).length ? { params: JSON.stringify(params) } : undefined
}

/** the formula language's check as you type (apps/insights/formula.py) */
export const formulasApi = {
  check: (body: { dataset: string; derived: CustomField[]; field: Partial<CustomField> }) => api.post<FormulaCheck>('/insights/formulas/check/', body),
}

/** Insights → Shared Formulas: measures and formulas saved on a dataset (apps/insights/dataset_formulas.py) */
export const sharedFormulasApi = {
  list: (dataset: string, signal?: AbortSignal) =>
    api.get<{ dataset: string; ready: boolean; can_certify: boolean; formulas: SharedFormula[] }>(`/insights/datasets/${dataset}/formulas/`, undefined, signal),
  create: (dataset: string, body: SharedFormulaBody) => api.post<SharedFormula>(`/insights/datasets/${dataset}/formulas/`, body),
  update: (dataset: string, id: string, body: Partial<SharedFormulaBody>) => api.put<SharedFormula>(`/insights/datasets/${dataset}/formulas/${id}/`, body),
  remove: (dataset: string, id: string) => api.delete(`/insights/datasets/${dataset}/formulas/${id}/`),
  certify: (dataset: string, id: string, certified: boolean) => api.post<SharedFormula>(`/insights/datasets/${dataset}/formulas/${id}/certify/`, { certified }),
  /** the check as a shared formula is typed: id leaves out that formula and the ones after it */
  check: (dataset: string, body: { id?: string; field: Partial<CustomField> }) => api.post<FormulaCheck>(`/insights/datasets/${dataset}/formulas/check/`, body),
}

/** the values a parameter offers (apps/insights/parameters.py) */
export const parametersApi = {
  values: (body: { dataset: string; field: string }) => api.post<ParameterChoices>('/insights/parameters/values/', body),
}

/** Insights → Uploaded Files (apps/insights/uploads.py) */
export const uploadsApi = {
  list: (signal?: AbortSignal) => api.get<{ uploads: UploadedFile[]; ready: boolean; limits?: { bytes: number; rows: number; columns: number } }>('/insights/uploads/', undefined, signal),
  get: (id: string, signal?: AbortSignal) => api.get<UploadedFile>(`/insights/uploads/${id}/`, undefined, signal),
  upload: (file: File, name?: string) => { const body = new FormData(); body.append('file', file); if (name) body.append('name', name); return api.post<UploadedFile>('/insights/uploads/', body) },
  update: (id: string, body: { row_version?: number; name?: string; description?: string | null; ready?: boolean; confirm?: boolean; columns?: Pick<UploadColumn, 'key' | 'label' | 'type' | 'role'>[] }) =>
    api.put<UploadedFile>(`/insights/uploads/${id}/`, body),
  replace: (id: string, file: File) => { const body = new FormData(); body.append('file', file); return api.post<UploadedFile>(`/insights/uploads/${id}/replace/`, body) },
  remove: (id: string) => api.delete(`/insights/uploads/${id}/`),
}

export const dashboardsApi = {
  list: (signal?: AbortSignal) => api.get<{ dashboards: DashboardSummary[] }>('/insights/dashboards/', undefined, signal),
  get: (id: string, signal?: AbortSignal) => api.get<Dashboard>(`/insights/dashboards/${id}/`, undefined, signal),
  create: (body: { name?: string; description?: string; visibility?: 'PRIVATE' | 'WORKSPACE' }) => api.post<Dashboard>('/insights/dashboards/', body),
  update: (id: string, body: { row_version: number; name?: string; description?: string | null; visibility?: 'PRIVATE' | 'WORKSPACE'; period?: Period; compare?: boolean; layout?: DashboardLayout; note?: string }) =>
    api.put<Dashboard>(`/insights/dashboards/${id}/`, body),
  remove: (id: string) => api.delete(`/insights/dashboards/${id}/`),
  /** a saved tile, narrowed by the slicers' values where its dataset has the field */
  runTile: (id: string, tile: string, body: { period?: Period; compare?: boolean; slicers?: SlicerSelection; drill?: { path: DrillStep[] } }) => api.post<TileResult>(`/insights/dashboards/${id}/tiles/${tile}/run/`, body),
  /** a tile as it is being edited, saved or not */
  previewTile: (id: string, body: { tile: DashboardTile; period?: Period; compare?: boolean; slicers?: SlicerSelection; drill?: { path: DrillStep[] } }) => api.post<TileResult>(`/insights/dashboards/${id}/tiles/preview/run/`, body),
  views: (id: string) => api.get<{ views: SavedView[] }>(`/insights/dashboards/${id}/views/`),
  saveView: (id: string, body: { name: string; shared: boolean; state: ViewState }) => api.post<SavedView>(`/insights/dashboards/${id}/views/`, body),
  deleteView: (id: string, view: string) => api.delete(`/insights/dashboards/${id}/views/${view}/`),
  /** the values a slicer offers over the period */
  slicerValues: (id: string, body: { field: string; period?: Period }) => api.post<SlicerValues>(`/insights/dashboards/${id}/slicers/values/`, body),
  exportPdf: (id: string) => api.download(`/insights/dashboards/${id}/export.pdf`),
  exportPptx: (id: string) => api.download(`/insights/dashboards/${id}/export.pptx`),
}

/** threshold alerts and comments (apps/insights/alerts.py, comments.py) */
export const alertsApi = {
  list: (report?: string) => api.get<{ alerts: ReportAlert[]; ready: boolean; mail_configured: boolean }>('/insights/alerts/', report ? { report } : undefined),
  get: (id: string) => api.get<ReportAlert>(`/insights/alerts/${id}/`),
  create: (body: AlertBody) => api.post<ReportAlert>('/insights/alerts/', body),
  update: (id: string, body: AlertBody) => api.put<ReportAlert>(`/insights/alerts/${id}/`, body),
  remove: (id: string) => api.delete(`/insights/alerts/${id}/`),
  check: (id: string) => api.post<{ outcome: string; value: number | null; value_words: string; met: boolean | null; notified: boolean; state: string; detail: string | null; alert: ReportAlert }>(`/insights/alerts/${id}/check/`, {}),
  state: (id: string, action: 'pause' | 'resume') => api.post<ReportAlert>(`/insights/alerts/${id}/${action}/`, {}),
}

export const commentsApi = {
  list: (kind: 'report' | 'dashboard', item: string) => api.get<{ comments: InsightsComment[]; ready: boolean }>('/insights/comments/', { kind, item }),
  create: (body: { kind: 'report' | 'dashboard'; item_id: string; body: string; anchor?: CommentAnchor | null }) => api.post<InsightsComment>('/insights/comments/', body),
  update: (id: string, body: { body?: string; resolved?: boolean }) => api.put<InsightsComment>(`/insights/comments/${id}/`, body),
  remove: (id: string) => api.delete(`/insights/comments/${id}/`),
}

/** sharing with people and roles, and row access rules (apps/insights/access.py) */
export const sharingApi = {
  shares: (kind: ShareKind, id: string) => api.get<SharesState>(`/insights/${kind === 'report' ? 'reports' : 'dashboards'}/${id}/shares/`),
  saveShares: (kind: ShareKind, id: string, body: { visibility: 'PRIVATE' | 'WORKSPACE'; shares: { kind: Principal['kind']; id: string; permission: Share['permission'] }[] }) =>
    api.put<SharesState>(`/insights/${kind === 'report' ? 'reports' : 'dashboards'}/${id}/shares/`, body),
  principals: (q: string) => api.get<{ people: Principal[]; roles: Principal[] }>('/insights/principals/', { q }),
  rowRules: () => api.get<RowRules>('/insights/row-rules/'),
  createRowRule: (body: object) => api.post<RowRule>('/insights/row-rules/', body),
  updateRowRule: (id: string, body: object) => api.put<RowRule>(`/insights/row-rules/${id}/`, body),
  deleteRowRule: (id: string) => api.delete(`/insights/row-rules/${id}/`),
}

export const libraryApi = {
  favourite: (kind: 'report' | 'dashboard', id: string) => api.put(`/insights/favourites/${kind}/${id}/`, {}),
  unfavourite: (kind: 'report' | 'dashboard', id: string) => api.delete(`/insights/favourites/${kind}/${id}/`),
  folders: (signal?: AbortSignal) => api.get<{ folders: Folder[] }>('/insights/folders/', undefined, signal),
  createFolder: (name: string) => api.post<Folder>('/insights/folders/', { name }),
  renameFolder: (id: string, name: string) => api.put<Folder>(`/insights/folders/${id}/`, { name }),
  deleteFolder: (id: string) => api.delete(`/insights/folders/${id}/`),
  runs: (query: { days?: '7' | '30'; outcome?: string; user?: string; q?: string }, signal?: AbortSignal) =>
    api.get<RunLog>('/insights/runs/', Object.fromEntries(Object.entries(query).filter(([, v]) => v)), signal),
}

export const schedulesApi = {
  list: (query: { item?: string }, signal?: AbortSignal) => api.get<{ schedules: Schedule[]; mail_configured: boolean }>('/insights/schedules/', Object.fromEntries(Object.entries(query).filter(([, v]) => v)), signal),
  create: (body: ScheduleBody) => api.post<Schedule>('/insights/schedules/', body),
  update: (id: string, body: ScheduleBody & { row_version: number }) => api.put<Schedule>(`/insights/schedules/${id}/`, body),
  remove: (id: string) => api.delete(`/insights/schedules/${id}/`),
  state: (id: string, action: 'pause' | 'resume') => api.post<Schedule>(`/insights/schedules/${id}/${action}/`, {}),
  test: (id: string) => api.post<{ outcome: string; detail: string | null; recipients: number; rows: number | null }>(`/insights/schedules/${id}/test/`, {}),
}

export const assistantApi = {
  state: (signal?: AbortSignal) => api.get<AssistantState>('/insights/assistant/', undefined, signal),
  /** with images or documents, sent as multipart (the files under `images` and `documents`); they go to the model and are not kept */
  ask: (body: { prompt: string; model: string; answer_to?: string; scope?: AskScope; unmapped?: boolean }, images: File[] = [], documents: File[] = []) => {
    if (!images.length && !documents.length) return api.post<AskResult>('/insights/assistant/ask/', body)
    const form = new FormData()
    for (const [key, value] of Object.entries(body)) if (value !== undefined) form.append(key, String(value))
    for (const image of images) form.append('images', image)
    for (const document of documents) form.append('documents', document)
    return api.post<AskResult>('/insights/assistant/ask/', form)
  },
  /** the draft becomes a private report, opened in the editor */
  open: (id: string) => api.post<Report>(`/insights/assistant/${id}/open/`, {}),
  change: (body: { dataset: string; definition: ReportDefinition; prompt: string; model?: string }) => api.post<ChangeResult>('/insights/assistant/change/', body),
}

/** opening figures and embed links (apps/insights/usage.py, embeds.py) */
export const usageApi = {
  opened: (kind: 'report' | 'dashboard', id: string) => api.post('/insights/usage/', { kind, id }),
  report: (days: number, signal?: AbortSignal) => api.get<UsageReport>('/insights/usage/', { days: String(days) }, signal),
  embeds: (kind: 'report' | 'dashboard', item: string) => api.get<{ embeds: EmbedLink[]; ready: boolean }>('/insights/embeds/', { kind, item }),
  createEmbed: (body: { kind: 'report' | 'dashboard'; item_id: string; label?: string; days?: number | null }) => api.post<EmbedLink>('/insights/embeds/', body),
  revokeEmbed: (id: string) => api.delete(`/insights/embeds/${id}/`),
}

export const keys = {
  assistant: ['insights', 'assistant'] as const,
  schedules: ['insights', 'schedules'] as const,
  folders: ['insights', 'folders'] as const,
  runs: (query: { days?: '7' | '30'; outcome?: string; user?: string; q?: string }) => ['insights', 'runs', query] as const,
  catalog: ['insights', 'catalog'] as const,
  dashboards: ['insights', 'dashboards'] as const,
  dashboard: (id: string) => ['insights', 'dashboard', id] as const,
  tiles: (id: string) => ['insights', 'tiles', id] as const,
  reports: (query: { component?: string; dataset?: string; q?: string; folder?: string; detail_for?: string }) => ['insights', 'reports', query] as const,
  report: (id: string) => ['insights', 'report', id] as const,
  versions: (id: string) => ['insights', 'versions', id] as const,
  run: (id: string, page: { limit?: number; offset?: number; view?: ReportView; drill?: { path: DrillStep[] }; through?: { field: string; value: unknown }[]; params?: ParameterValues }) => ['insights', 'run', id, page] as const,
  uploads: ['insights', 'uploads'] as const,
  sharedFormulas: (dataset: string) => ['insights', 'shared-formulas', dataset] as const,
}

export const fiscalKey = ['workspace', 'fiscal-year'] as const

/** the workspace's fiscal year; January, named by the year it ends in, until someone sets it */
export function useFiscalYear() {
  return useQuery({ queryKey: fiscalKey, queryFn: ({ signal }) => api.get<FiscalYear>('/workspace/fiscal-year/', undefined, signal), staleTime: 300_000, retry: false })
}

export function useAssistant() {
  return useQuery({ queryKey: keys.assistant, queryFn: ({ signal }) => assistantApi.state(signal), staleTime: 30_000 })
}

export function useCatalog() {
  return useQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => insightsApi.catalog(signal), staleTime: 60_000 })
}

export function useSchedules(query: { item?: string }) {
  return useQuery({ queryKey: [...keys.schedules, query], queryFn: ({ signal }) => schedulesApi.list(query, signal) })
}

export function useRunLog(query: { days?: '7' | '30'; outcome?: string; user?: string; q?: string }) {
  return useQuery({ queryKey: keys.runs(query), queryFn: ({ signal }) => libraryApi.runs(query, signal), placeholderData: (previous) => previous })
}

export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: ({ signal }) => libraryApi.folders(signal), staleTime: 60_000 })
}

export function useReports(query: { component?: string; dataset?: string; q?: string; folder?: string; detail_for?: string }) {
  return useQuery({ queryKey: keys.reports(query), queryFn: ({ signal }) => insightsApi.reports(query, signal) })
}

export function useReport(id: string | undefined) {
  return useQuery({ queryKey: keys.report(id ?? ''), queryFn: ({ signal }) => insightsApi.report(id as string, signal), enabled: Boolean(id) })
}

export function useVersions(id: string | undefined) {
  return useQuery({ queryKey: keys.versions(id ?? ''), queryFn: ({ signal }) => insightsApi.versions(id as string, signal), enabled: Boolean(id) })
}

export function useRun(id: string | undefined, page: { limit?: number; offset?: number; view?: ReportView; drill?: { path: DrillStep[] }; through?: { field: string; value: unknown }[]; params?: ParameterValues }) {
  return useQuery({ queryKey: keys.run(id ?? '', page), queryFn: () => insightsApi.run(id as string, page), enabled: Boolean(id), retry: false, placeholderData: (previous) => previous })
}

export function useDashboards() {
  return useQuery({ queryKey: keys.dashboards, queryFn: ({ signal }) => dashboardsApi.list(signal) })
}

export function useDashboard(id: string | undefined) {
  return useQuery({ queryKey: keys.dashboard(id ?? ''), queryFn: ({ signal }) => dashboardsApi.get(id as string, signal), enabled: Boolean(id) })
}

export function useDeleteDashboard() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (id: string) => dashboardsApi.remove(id), onSuccess: () => client.invalidateQueries({ queryKey: keys.dashboards }) })
}

export function useDeleteReport() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (id: string) => insightsApi.remove(id), onSuccess: () => client.invalidateQueries({ queryKey: ['insights', 'reports'] }) })
}

export const commentsKey = (kind: 'report' | 'dashboard', id: string) => ['insights', 'comments', kind, id] as const

export function useComments(kind: 'report' | 'dashboard', id: string | undefined) {
  return useQuery({ queryKey: commentsKey(kind, id ?? ''), queryFn: () => commentsApi.list(kind, id as string), enabled: Boolean(id), staleTime: 30_000 })
}
