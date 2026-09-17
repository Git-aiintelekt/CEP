import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '@/auth/AuthContext'
import { RequireAuth } from '@/auth/RequireAuth'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { FullPageSpinner } from '@/components/States'
import { ApiError } from '@/lib/api'
import { CampaignDetailPage } from '@/pages/CampaignDetailPage'
import { CampaignFormPage } from '@/pages/CampaignFormPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { CampaignsPage, ContactListsPage, JourneysPage, TemplatesPage } from '@/pages/ListPages'
import { LoginPage } from '@/pages/LoginPage'
import { MessageEditorPage } from '@/pages/MessageEditorPage'
import { SetPasswordPage } from '@/pages/SetPasswordPage'
import { ApiKeysPage } from '@/pages/settings/ApiKeysPage'
import { RolesPage } from '@/pages/settings/RolesPage'
import { SettingsLayout } from '@/pages/settings/SettingsLayout'
import { UsersPage } from '@/pages/settings/UsersPage'
import { TemplateFormPage } from '@/pages/TemplateFormPage'

// GrapesJS + the MJML compiler are ~1 MB: loaded only when someone opens the designer.
const TemplateDesignerPage = lazy(() => import('@/pages/TemplateDesignerPage'))
const DesignerPlayground = import.meta.env.DEV ? lazy(() => import('@/pages/DesignerPlayground')) : null
const MessagePlayground = import.meta.env.DEV ? lazy(() => import('@/pages/MessagePlayground')) : null

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

function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-1 text-xl font-semibold text-ink-900">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
        Back to overview
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
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            {DesignerPlayground && (
              <Route path="/dev/designer" element={<Suspense fallback={<FullPageSpinner label="Loading the designer" />}><DesignerPlayground /></Suspense>} />
            )}
            {MessagePlayground && (
              <Route path="/dev/message" element={<Suspense fallback={<FullPageSpinner label="Loading the editor" />}><MessagePlayground /></Suspense>} />
            )}
            <Route element={<RequireAuth />}>
              {/* full-screen: outside the app shell */}
              <Route path="templates/:id/message" element={<MessageEditorPage />} />
              <Route path="templates/:id/design" element={<Suspense fallback={<FullPageSpinner label="Loading the designer" />}><TemplateDesignerPage /></Suspense>} />
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="campaigns/new" element={<CampaignFormPage />} />
                <Route path="campaigns/:id" element={<CampaignDetailPage />} />
                <Route path="campaigns/:id/edit" element={<CampaignFormPage />} />
                <Route path="contact-lists" element={<ContactListsPage />} />
                <Route path="templates" element={<TemplatesPage />} />
                <Route path="templates/new" element={<TemplateFormPage />} />
                <Route path="journeys" element={<JourneysPage />} />
                <Route path="settings" element={<SettingsLayout />}>
                  <Route index element={<Navigate to="users" replace />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="roles" element={<RolesPage />} />
                  <Route path="api-keys" element={<ApiKeysPage />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
