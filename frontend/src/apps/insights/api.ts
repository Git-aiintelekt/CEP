/** Insights' endpoints (backend apps/insights/api.py), typed. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Catalog, CatalogDataset, Dashboard, DashboardLayout, DashboardSummary, DashboardTile, Period, Report, ReportDefinition, ReportSummary, RunResult, TileResult } from './types'

export const insightsApi = {
  catalog: (signal?: AbortSignal) => api.get<Catalog>('/insights/catalog/', undefined, signal),
  dataset: (key: string, signal?: AbortSignal) => api.get<CatalogDataset>(`/insights/catalog/${key}/`, undefined, signal),
  reports: (query: { component?: string; dataset?: string; q?: string }, signal?: AbortSignal) =>
    api.get<{ reports: ReportSummary[] }>('/insights/reports/', Object.fromEntries(Object.entries(query).filter(([, v]) => v)), signal),
  report: (id: string, signal?: AbortSignal) => api.get<Report & { can_edit: boolean }>(`/insights/reports/${id}/`, undefined, signal),
  create: (body: { name: string; dataset: string; definition: ReportDefinition; description?: string; visibility?: 'PRIVATE' | 'WORKSPACE' }) =>
    api.post<Report>('/insights/reports/', body),
  update: (id: string, body: { row_version: number; name?: string; description?: string | null; visibility?: 'PRIVATE' | 'WORKSPACE'; definition?: ReportDefinition; note?: string }) =>
    api.put<Report>(`/insights/reports/${id}/`, body),
  remove: (id: string) => api.delete(`/insights/reports/${id}/`),
  preview: (body: { dataset: string; definition: ReportDefinition; limit?: number; offset?: number }) => api.post<RunResult>('/insights/reports/preview/', body),
  run: (id: string, body: { limit?: number; offset?: number } = {}) => api.post<RunResult>(`/insights/reports/${id}/run/`, body),
  exportUrl: (id: string) => `/insights/reports/${id}/export.csv`,
  exportCsv: (id: string) => api.download(`/insights/reports/${id}/export.csv`),
}

export const dashboardsApi = {
  list: (signal?: AbortSignal) => api.get<{ dashboards: DashboardSummary[] }>('/insights/dashboards/', undefined, signal),
  get: (id: string, signal?: AbortSignal) => api.get<Dashboard>(`/insights/dashboards/${id}/`, undefined, signal),
  create: (body: { name?: string; description?: string; visibility?: 'PRIVATE' | 'WORKSPACE' }) => api.post<Dashboard>('/insights/dashboards/', body),
  update: (id: string, body: { row_version: number; name?: string; description?: string | null; visibility?: 'PRIVATE' | 'WORKSPACE'; period?: Period; compare?: boolean; layout?: DashboardLayout; note?: string }) =>
    api.put<Dashboard>(`/insights/dashboards/${id}/`, body),
  remove: (id: string) => api.delete(`/insights/dashboards/${id}/`),
  /** a saved tile */
  runTile: (id: string, tile: string, body: { period?: Period; compare?: boolean }) => api.post<TileResult>(`/insights/dashboards/${id}/tiles/${tile}/run/`, body),
  /** a tile as it is being edited, saved or not */
  previewTile: (id: string, body: { tile: DashboardTile; period?: Period; compare?: boolean }) => api.post<TileResult>(`/insights/dashboards/${id}/tiles/preview/run/`, body),
}

export const keys = {
  catalog: ['insights', 'catalog'] as const,
  dashboards: ['insights', 'dashboards'] as const,
  dashboard: (id: string) => ['insights', 'dashboard', id] as const,
  tiles: (id: string) => ['insights', 'tiles', id] as const,
  reports: (query: { component?: string; dataset?: string; q?: string }) => ['insights', 'reports', query] as const,
  report: (id: string) => ['insights', 'report', id] as const,
  run: (id: string, page: { limit?: number; offset?: number }) => ['insights', 'run', id, page] as const,
}

export function useCatalog() {
  return useQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => insightsApi.catalog(signal), staleTime: 60_000 })
}

export function useReports(query: { component?: string; dataset?: string; q?: string }) {
  return useQuery({ queryKey: keys.reports(query), queryFn: ({ signal }) => insightsApi.reports(query, signal) })
}

export function useReport(id: string | undefined) {
  return useQuery({ queryKey: keys.report(id ?? ''), queryFn: ({ signal }) => insightsApi.report(id as string, signal), enabled: Boolean(id) })
}

export function useRun(id: string | undefined, page: { limit?: number; offset?: number }) {
  return useQuery({ queryKey: keys.run(id ?? '', page), queryFn: () => insightsApi.run(id as string, page), enabled: Boolean(id), retry: false })
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
