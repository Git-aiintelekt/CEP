/** Insights' pages, loaded the first time the component is opened (App.tsx lazy-imports this module under /insights/*). */
import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/AppShell'
import { NotFoundPage } from '@/components/NotFoundPage'
import { Spinner } from '@/components/States'
import { DashboardListPage } from './pages/DashboardListPage'
import { DashboardPage } from './pages/DashboardPage'
import { NewReportPage } from './pages/NewReportPage'
import { ReportListPage } from './pages/ReportListPage'

// the editors and the query window load when first opened: reading reports and dashboards stays light
const ReportEditorPage = lazy(() => import('./pages/ReportEditorPage').then((m) => ({ default: m.ReportEditorPage })))
const DashboardEditorPage = lazy(() => import('./pages/DashboardEditorPage').then((m) => ({ default: m.DashboardEditorPage })))
const QueryBuilderPage = lazy(() => import('./pages/QueryBuilderPage').then((m) => ({ default: m.QueryBuilderPage })))
const UsagePage = lazy(() => import('./pages/UsagePage').then((m) => ({ default: m.UsagePage })))
const UploadsPage = lazy(() => import('./pages/UploadsPage').then((m) => ({ default: m.UploadsPage })))
const SharedFormulasPage = lazy(() => import('./pages/SharedFormulasPage').then((m) => ({ default: m.SharedFormulasPage })))
const AiReportsPage = lazy(() => import('./pages/AiReportsPage').then((m) => ({ default: m.AiReportsPage })))
const later = (page: ReactNode) => <Suspense fallback={<Spinner label="Loading" />}>{page}</Suspense>
import { ReportViewerPage } from './pages/ReportViewerPage'
import { RunLogPage } from './pages/RunLogPage'
import { ScheduledPage } from './pages/ScheduledPage'

export default function InsightsRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="reports" replace />} />
        <Route path="ai-reports" element={later(<AiReportsPage />)} />
        <Route path="reports" element={<ReportListPage />} />
        <Route path="reports/new" element={<NewReportPage />} />
        <Route path="reports/new/query/:dbId" element={later(<QueryBuilderPage />)} />
        <Route path="reports/:id" element={<ReportViewerPage />} />
        <Route path="reports/:id/edit" element={later(<ReportEditorPage />)} />
        <Route path="dashboards" element={<DashboardListPage />} />
        <Route path="dashboards/:id" element={<DashboardPage />} />
        <Route path="dashboards/:id/edit" element={later(<DashboardEditorPage />)} />
        <Route path="runs" element={<RunLogPage />} />
        <Route path="usage" element={later(<UsagePage />)} />
        <Route path="uploads" element={later(<UploadsPage />)} />
        <Route path="formulas" element={later(<SharedFormulasPage />)} />
        <Route path="scheduled" element={<ScheduledPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
