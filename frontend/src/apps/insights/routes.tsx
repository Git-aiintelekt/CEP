/** Insights' pages, loaded the first time the component is opened (App.tsx lazy-imports this module under /insights/*). */
import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/AppShell'
import { NotFoundPage } from '@/components/NotFoundPage'
import { DashboardEditorPage } from './pages/DashboardEditorPage'
import { DashboardListPage } from './pages/DashboardListPage'
import { DashboardPage } from './pages/DashboardPage'
import { NewReportPage } from './pages/NewReportPage'
import { QueryBuilderPage } from './pages/QueryBuilderPage'
import { ReportEditorPage } from './pages/ReportEditorPage'
import { ReportListPage } from './pages/ReportListPage'
import { ReportViewerPage } from './pages/ReportViewerPage'
import { RunLogPage } from './pages/RunLogPage'
import { ScheduledPage } from './pages/ScheduledPage'

export default function InsightsRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="reports" replace />} />
        <Route path="reports" element={<ReportListPage />} />
        <Route path="reports/new" element={<NewReportPage />} />
        <Route path="reports/new/query/:dbId" element={<QueryBuilderPage />} />
        <Route path="reports/:id" element={<ReportViewerPage />} />
        <Route path="reports/:id/edit" element={<ReportEditorPage />} />
        <Route path="dashboards" element={<DashboardListPage />} />
        <Route path="dashboards/:id" element={<DashboardPage />} />
        <Route path="dashboards/:id/edit" element={<DashboardEditorPage />} />
        <Route path="runs" element={<RunLogPage />} />
        <Route path="scheduled" element={<ScheduledPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
