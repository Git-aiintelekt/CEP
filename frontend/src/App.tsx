import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '@/auth/AuthContext'
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
import { DashboardPage } from '@/pages/DashboardPage'
import { CampaignListPage } from '@/features/campaigns/CampaignListPage'
import { CampaignDetailPage } from '@/features/campaigns/detail/CampaignDetailPage'
import { CampaignWizardPage } from '@/features/campaigns/wizard/CampaignWizardPage'
import { ContactListDetailPage } from '@/features/contact-lists/ContactListDetailPage'
import { ContactListsPage } from '@/features/contact-lists/ContactListsPage'
import { UploadsPage } from '@/features/contact-lists/UploadsPage'
import { JourneysPage } from '@/pages/ListPages'
import { TemplatesPage } from '@/pages/TemplatesPage'
import { LoginPage } from '@/pages/LoginPage'
import { MessageEditorPage } from '@/pages/MessageEditorPage'
import { SetPasswordPage } from '@/pages/SetPasswordPage'
import { ApiKeysPage } from '@/pages/settings/ApiKeysPage'
import { DeliveryPage } from '@/pages/settings/DeliveryPage'
import { MailServerPage } from '@/pages/settings/MailServerPage'
import { PlanUsagePage } from '@/pages/settings/PlanUsagePage'
import { RolesPage } from '@/pages/settings/RolesPage'
import { SecurityPage } from '@/pages/settings/SecurityPage'
import { SettingsLayout } from '@/pages/settings/SettingsLayout'
import { UsersPage } from '@/pages/settings/UsersPage'
import { TemplateFormPage } from '@/pages/TemplateFormPage'
import { TokenLandingPage } from '@/pages/TokenLandingPage'

// GrapesJS + the MJML compiler are ~1 MB: loaded only when someone opens the designer.
const TemplateDesignerPage = lazy(() => import('@/pages/TemplateDesignerPage'))
const ReceiptEditorPage = lazy(() => import('@/pages/ReceiptEditorPage'))
const DesignerPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/DesignerPlayground')) : null
const MessagePlayground = import.meta.env.DEV ? lazy(() => import('@/pages/MessagePlayground')) : null
const ReceiptPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/ReceiptPlayground')) : null
const DevFields = import.meta.env.DEV ? lazy(() => import('@/pages/DevFields')) : null

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Client errors (401 / 403 / 404 / validation) will not fix themselves; only retry transport and 5xx failures.
      retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
  },
})

/** The template editors keep 4px corners on every button and control (see .editor-radii); `contents` adds no box. */
function EditorScope({ children }: { children: ReactNode }) {
  return <div className="editor-radii contents">{children}</div>
}

function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-brand-800">404</p>
      <h1 className="mt-1 font-display text-page-title font-semibold text-ink-900">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-800 hover:underline">
        Back to Overview
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
            <Route element={<RequireAuth />}>
              {/* full-screen: outside the app shell */}
              <Route path="templates/:id/message" element={<EditorScope><MessageEditorPage /></EditorScope>} />
              <Route path="templates/:id/design" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the designer" />}><TemplateDesignerPage /></Suspense></EditorScope>} />
              <Route path="templates/:id/receipt" element={<EditorScope><Suspense fallback={<EditorLoading label="Loading the editor" />}><ReceiptEditorPage /></Suspense></EditorScope>} />
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="campaigns" element={<CampaignListPage />} />
                <Route path="campaigns/new" element={<CampaignListPage creating />} />
                <Route path="campaigns/:id" element={<CampaignDetailPage />} />
                <Route path="campaigns/:id/edit" element={<CampaignWizardPage />} />
                <Route path="contact-lists" element={<ContactListsPage />} />
                <Route path="contact-lists/uploads" element={<UploadsPage />} />
                <Route path="contact-lists/:id" element={<ContactListDetailPage />} />
                <Route path="templates" element={<TemplatesPage />} />
                <Route path="templates/new" element={<TemplateFormPage />} />
                <Route path="journeys" element={<JourneysPage />} />
                <Route path="account/security" element={<AccountSecurityPage />} />
                <Route path="settings" element={<SettingsLayout />}>
                  <Route index element={<Navigate to="users" replace />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="roles" element={<RolesPage />} />
                  <Route path="api-keys" element={<ApiKeysPage />} />
                  <Route path="plan" element={<PlanUsagePage />} />
                  <Route path="security" element={<SecurityPage />} />
                  <Route path="email" element={<MailServerPage />} />
                  <Route path="delivery" element={<DeliveryPage />} />
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
