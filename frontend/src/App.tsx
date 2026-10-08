import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '@/auth/AuthContext'
import { EditorScopeContext } from '@/components/editorScope'
import { RequireAuth } from '@/auth/RequireAuth'
import { SessionIdleGuard } from '@/auth/SessionIdleGuard'
import { AppShell } from '@/components/AppShell'
import { EditorLoading } from '@/features/designer/EditorStates'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingOverlayHost } from '@/components/LoadingOverlayHost'
import { FullPageSpinner } from '@/components/States'
import { ToastProvider } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { AccountSecurityPage } from '@/pages/AccountSecurityPage'
import { CampaignListPage } from '@/features/campaigns/CampaignListPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { CampaignDetailPage } from '@/features/campaigns/detail/CampaignDetailPage'
import { CampaignWizardPage } from '@/features/campaigns/wizard/CampaignWizardPage'
import { ContactListDetailPage } from '@/features/contact-lists/ContactListDetailPage'
import { ContactListsPage } from '@/features/contact-lists/ContactListsPage'
import { CustomerPage } from '@/features/customers/CustomerPage'
import { CustomersPage } from '@/features/customers/CustomersPage'
import { UploadsPage } from '@/features/contact-lists/UploadsPage'
import { LandingAfterSignIn } from '@/features/home/LandingAfterSignIn'
import { JourneyDetailsPage } from '@/features/journeys/JourneyDetailsPage'
import { JourneysPage } from '@/features/journeys/JourneysPage'
import { TemplatesPage } from '@/pages/TemplatesPage'
import { LoginPage } from '@/pages/LoginPage'
import { MessageEditorPage } from '@/pages/MessageEditorPage'
import { SetPasswordPage } from '@/pages/SetPasswordPage'
import { ApiKeysPage } from '@/pages/settings/ApiKeysPage'
import { ApprovalsPage } from '@/pages/settings/ApprovalsPage'
import { DeliveryPage } from '@/pages/settings/DeliveryPage'
import { IntegrationsPage } from '@/pages/settings/IntegrationsPage'
import { MailServerPage } from '@/pages/settings/MailServerPage'
import { NotificationsPage } from '@/pages/settings/NotificationsPage'
import { PlanUsagePage } from '@/pages/settings/PlanUsagePage'
import { RolesPage } from '@/pages/settings/RolesPage'
import { SecurityPage } from '@/pages/settings/SecurityPage'
import { SettingsLayout } from '@/pages/settings/SettingsLayout'
import { SuppressionsPage } from '@/pages/settings/SuppressionsPage'
import { TagsPage } from '@/pages/settings/TagsPage'
import { PosReceiptsPage } from '@/pages/settings/PosReceiptsPage'
import { AttributionPage } from '@/pages/settings/AttributionPage'
import { EventsPage } from '@/pages/settings/EventsPage'
import { ConsentPolicyPage } from '@/pages/settings/ConsentPolicyPage'
import { WorkspaceSetupPage } from '@/pages/settings/WorkspaceSetupPage'
import { PreferenceCenterPage } from '@/pages/settings/PreferenceCenterPage'
import { UsersPage } from '@/pages/settings/UsersPage'
import { TemplateFormPage } from '@/pages/TemplateFormPage'
import { TokenLandingPage } from '@/pages/TokenLandingPage'

// GrapesJS + the MJML compiler are ~1 MB: loaded only when someone opens the designer.
const TemplateDesignerPage = lazy(() => import('@/pages/TemplateDesignerPage'))
// @xyflow/react is loaded only when someone opens the journey canvas.
const JourneyBuildPage = lazy(() => import('@/pages/JourneyBuildPage'))
const JourneyTestPublishPage = lazy(() => import('@/pages/JourneyTestPublishPage'))
const ReceiptEditorPage = lazy(() => import('@/pages/ReceiptEditorPage'))
const DesignerPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/DesignerPlayground')) : null
const MessagePlayground = import.meta.env.DEV ? lazy(() => import('@/pages/MessagePlayground')) : null
const ReceiptPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/ReceiptPlayground')) : null
const DevFields = import.meta.env.DEV ? lazy(() => import('@/pages/DevFields')) : null
const ToastPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/ToastPlayground')) : null
const HomePlayground = import.meta.env.DEV ? lazy(() => import('@/pages/HomePlayground')) : null
const SettingsPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/SettingsPlayground')) : null
const CalendarPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/CalendarPlayground')) : null
const JourneySetupPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/JourneySetupPlayground')) : null
const CustomerPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/CustomerPlayground')) : null
const ConditionPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/ConditionPlayground')) : null
const TimelinePlayground = import.meta.env.DEV ? lazy(() => import('@/pages/TimelinePlayground')) : null

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Client errors (401 / 403 / 404 / validation) will not fix themselves; only retry transport and 5xx failures.
      retry: (failures, error) => !(error instanceof ApiError && error.status > 0 && error.status < 500) && failures < 2,
    },
  },
})

/** The template editors keep 4px corners and their own type sizes (.editor-radii, .editor-type); `contents` adds no box. */
function EditorScope({ children }: { children: ReactNode }) {
  return <EditorScopeContext.Provider value><div className="editor-radii editor-type contents">{children}</div></EditorScopeContext.Provider>
}

function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-brand-800">404</p>
      <h1 className="mt-1 font-display text-page-title font-semibold text-ink-900">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-800 hover:underline">
        Back to Home
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
          <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/sso/complete" element={<TokenLandingPage kind="sso" />} />
            <Route path="/support-session" element={<TokenLandingPage kind="support" />} />
            {DesignerPlayground && (
              <Route path="/dev/designer" element={<EditorScope><Suspense fallback={<FullPageSpinner label="Loading the designer" />}><DesignerPlayground /></Suspense></EditorScope>} />
            )}
            {MessagePlayground && (
              <Route path="/dev/message" element={<EditorScope><Suspense fallback={<FullPageSpinner label="Loading the editor" />}><MessagePlayground /></Suspense></EditorScope>} />
            )}
            {ReceiptPlayground && (
              <Route path="/dev/receipt" element={<EditorScope><Suspense fallback={<FullPageSpinner label="Loading the editor" />}><ReceiptPlayground /></Suspense></EditorScope>} />
            )}
            {DevFields && (
              <Route path="/dev/fields" element={<Suspense fallback={<FullPageSpinner label="Loading the fields" />}><DevFields /></Suspense>} />
            )}
            {ToastPlayground && (
              <Route path="/dev/toasts" element={<Suspense fallback={<FullPageSpinner label="Loading the toasts" />}><ToastPlayground /></Suspense>} />
            )}
            {HomePlayground && (
              // inside the app shell, like the real Home; outside RequireAuth, so it works with no backend
              <Route element={<AppShell />}>
                <Route path="/dev/home" element={<Suspense fallback={<FullPageSpinner label="Loading Home" />}><HomePlayground /></Suspense>} />
                <Route path="/dev/settings/*" element={<Suspense fallback={<FullPageSpinner label="Loading Settings" />}>{SettingsPlayground && <SettingsPlayground />}</Suspense>} />
                {CalendarPlayground && <Route path="/dev/calendar" element={<Suspense fallback={<FullPageSpinner label="Loading the calendar" />}><CalendarPlayground /></Suspense>} />}
                {CustomerPlayground && <Route path="/dev/customer" element={<Suspense fallback={<FullPageSpinner label="Loading the playground" />}><CustomerPlayground /></Suspense>} />}
                {JourneySetupPlayground && <Route path="/dev/journey-setup" element={<Suspense fallback={<FullPageSpinner label="Loading the Set-Up" />}><JourneySetupPlayground /></Suspense>} />}
                {ConditionPlayground && <Route path="/dev/journey-condition" element={<Suspense fallback={<FullPageSpinner label="Loading the Condition" />}><ConditionPlayground /></Suspense>} />}
                {TimelinePlayground && <Route path="/dev/journey-timeline" element={<Suspense fallback={<FullPageSpinner label="Loading the timeline" />}><TimelinePlayground /></Suspense>} />}
              </Route>
            )}
            <Route element={<RequireAuth />}>
              {/* full-screen: outside the app shell */}
              <Route path="templates/:id/message" element={<EditorScope><MessageEditorPage /></EditorScope>} />
              <Route path="templates/:id/design" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the designer" />}><TemplateDesignerPage /></Suspense></EditorScope>} />
              <Route path="templates/:id/receipt" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the editor" />}><ReceiptEditorPage /></Suspense></EditorScope>} />
              <Route path="journeys/:id/build" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the builder" />}><JourneyBuildPage /></Suspense></EditorScope>} />
              <Route path="journeys/:id/test-publish" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading Test Publish" />}><JourneyTestPublishPage /></Suspense></EditorScope>} />
              <Route element={<AppShell />}>
                <Route index element={<LandingAfterSignIn />} />
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
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
          <LoadingOverlayHost />
          <SessionIdleGuard />
          </ToastProvider>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
