/**
 * /insights/reports/new: the Reports list with Create Report open over it (components/CreateReportDialog). ?component= files the
 * report with that component, as each component's Insights menu does; ?dataset= opens step 2 with that dataset picked (a file
 * just saved on Uploaded Files). Closing goes back to the list.
 */
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { CreateReportDialog } from '../components/CreateReportDialog'
import { ReportListPage } from './ReportListPage'

/** canConnect: the /dev/new-report playground's say, which has no session; bare: the pop-up alone, without the list behind it */
export function NewReportPage({ canConnect, bare = false }: { canConnect?: boolean; bare?: boolean } = {}) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [params] = useSearchParams()
  const wanted = params.get('component')
  const close = () => navigate(`/insights/reports${wanted ? `?component=${wanted}` : ''}`, { replace: true })
  return (
    <>
      {!bare && <ReportListPage />}
      <CreateReportDialog onClose={close} initialDataset={params.get('dataset')} wanted={wanted} canConnect={canConnect ?? can('report.edit')} />
    </>
  )
}
