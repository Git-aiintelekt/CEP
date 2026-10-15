/** Insights' pages, loaded the first time the component is opened (App.tsx lazy-imports this module under /insights/*). */
import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/AppShell'
import { NotFoundPage } from '@/components/NotFoundPage'
import { NewReportPage } from './pages/NewReportPage'
import { ReportEditorPage } from './pages/ReportEditorPage'
import { ReportListPage } from './pages/ReportListPage'
import { ReportViewerPage } from './pages/ReportViewerPage'

export default function InsightsRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="reports" replace />} />
        <Route path="reports" element={<ReportListPage />} />
        <Route path="reports/new" element={<NewReportPage />} />
        <Route path="reports/:id" element={<ReportViewerPage />} />
        <Route path="reports/:id/edit" element={<ReportEditorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
