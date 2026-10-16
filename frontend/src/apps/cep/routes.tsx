/**
 * Engagement's pages as React Router routes, loaded the first time the component is opened (App.tsx lazy-imports this
 * module). The full-screen editors sit outside the app shell; everything else inside it. /cep/... is the component's
 * own namespace and stands for today's addresses.
 */
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from '@/components/AppShell'
import { EditorScope } from '@/components/EditorShell'
import { NotFoundPage } from '@/components/NotFoundPage'
import { EditorLoading } from './features/designer/EditorStates'
import { CampaignListPage } from './features/campaigns/CampaignListPage'
import { CampaignDetailPage } from './features/campaigns/detail/CampaignDetailPage'
import { CampaignWizardPage } from './features/campaigns/wizard/CampaignWizardPage'
import { ContactListDetailPage } from './features/contact-lists/ContactListDetailPage'
import { ContactListsPage } from './features/contact-lists/ContactListsPage'
import { UploadsPage } from './features/contact-lists/UploadsPage'
import { CustomerPage } from './features/customers/CustomerPage'
import { CustomersPage } from './features/customers/CustomersPage'
import { LandingAfterSignIn } from './features/home/LandingAfterSignIn'
import { JourneyDetailsPage } from './features/journeys/JourneyDetailsPage'
import { JourneysPage } from './features/journeys/JourneysPage'
import { ReportsPage } from './features/reports/ReportsPage'
import { AccountSecurityPage } from './pages/AccountSecurityPage'
import { MessageEditorPage } from './pages/MessageEditorPage'
import { TemplateFormPage } from './pages/TemplateFormPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { ApiKeysPage } from './pages/settings/ApiKeysPage'
import { ApprovalsPage } from './pages/settings/ApprovalsPage'
import { AttributionPage } from './pages/settings/AttributionPage'
import { ConsentPolicyPage } from './pages/settings/ConsentPolicyPage'
import { DeliveryPage } from './pages/settings/DeliveryPage'
import { EventsPage } from './pages/settings/EventsPage'
import { IntegrationsPage } from './pages/settings/IntegrationsPage'
import { MailServerPage } from './pages/settings/MailServerPage'
import { NotificationsPage } from './pages/settings/NotificationsPage'
import { PlanUsagePage } from './pages/settings/PlanUsagePage'
import { PosReceiptsPage } from './pages/settings/PosReceiptsPage'
import { AiAssistantPage } from './pages/settings/AiAssistantPage'
import { MapDatasetPage } from './pages/settings/MapDatasetPage'
import { PreferenceCenterPage } from './pages/settings/PreferenceCenterPage'
import { ReportDatabasesPage } from './pages/settings/ReportDatabasesPage'
import { RolesPage } from './pages/settings/RolesPage'
import { SecurityPage } from './pages/settings/SecurityPage'
import { SettingsLayout } from './pages/settings/SettingsLayout'
import { SuppressionsPage } from './pages/settings/SuppressionsPage'
import { TagsPage } from './pages/settings/TagsPage'
import { UsersPage } from './pages/settings/UsersPage'
import { WorkspaceSetupPage } from './pages/settings/WorkspaceSetupPage'

// GrapesJS + the MJML compiler are ~1 MB: loaded only when someone opens the designer.
const TemplateDesignerPage = lazy(() => import('./pages/TemplateDesignerPage'))
// @xyflow/react is loaded only when someone opens the journey canvas.
const JourneyBuildPage = lazy(() => import('./pages/JourneyBuildPage'))
const JourneyTestPublishPage = lazy(() => import('./pages/JourneyTestPublishPage'))
const ReceiptEditorPage = lazy(() => import('./pages/ReceiptEditorPage'))

/** /cep/... stands for today's addresses: a link with the prefix lands on the same page, query string and all */
function ComponentAlias() {
  const location = useLocation()
  const rest = location.pathname.replace(/^\/cep(?=\/|$)/, '') || '/'
  return <Navigate to={`${rest}${location.search}${location.hash}`} replace />
}

export default function CepRoutes() {
  return (
    <Routes>
      {/* full-screen: outside the app shell */}
      <Route path="templates/:id/message" element={<EditorScope><MessageEditorPage /></EditorScope>} />
      <Route path="templates/:id/design" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the designer" />}><TemplateDesignerPage /></Suspense></EditorScope>} />
      <Route path="templates/:id/receipt" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the editor" />}><ReceiptEditorPage /></Suspense></EditorScope>} />
      <Route path="journeys/:id/build" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the builder" />}><JourneyBuildPage /></Suspense></EditorScope>} />
      <Route path="journeys/:id/test-publish" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading Test Publish" />}><JourneyTestPublishPage /></Suspense></EditorScope>} />
      <Route element={<AppShell />}>
        <Route index element={<LandingAfterSignIn />} />
        <Route path="cep/*" element={<ComponentAlias />} />
        <Route path="campaigns" element={<CampaignListPage />} />
        <Route path="campaigns/new" element={<CampaignListPage creating />} />
        <Route path="campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="campaigns/:id/edit" element={<CampaignWizardPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="contact-lists" element={<ContactListsPage />} />
        <Route path="contact-lists/uploads" element={<UploadsPage />} />
        <Route path="contact-lists/:id" element={<ContactListDetailPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:partyId" element={<CustomerPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/new" element={<TemplateFormPage />} />
        <Route path="journeys" element={<JourneysPage />} />
        <Route path="journeys/:id" element={<JourneyDetailsPage />} />
        <Route path="account/security" element={<AccountSecurityPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="setup" element={<WorkspaceSetupPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="plan" element={<PlanUsagePage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="email" element={<MailServerPage />} />
          <Route path="delivery" element={<DeliveryPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="suppressions" element={<SuppressionsPage />} />
          <Route path="preference-center" element={<PreferenceCenterPage />} />
          <Route path="consent" element={<ConsentPolicyPage />} />
          <Route path="pos" element={<PosReceiptsPage />} />
          <Route path="attribution" element={<AttributionPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="ai-assistant" element={<AiAssistantPage />} />
          <Route path="report-databases" element={<ReportDatabasesPage />} />
          <Route path="report-databases/:id/map" element={<MapDatasetPage />} />
          <Route path="report-databases/:id/map/:datasetId" element={<MapDatasetPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
