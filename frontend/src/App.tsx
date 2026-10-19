import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '@/auth/AuthContext'
import { RequireAuth } from '@/auth/RequireAuth'
import { SessionIdleGuard } from '@/auth/SessionIdleGuard'
import { AppShell } from '@/components/AppShell'
import { EditorScope } from '@/components/EditorShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingOverlayHost } from '@/components/LoadingOverlayHost'
import { FullPageSpinner } from '@/components/States'
import { ToastProvider } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { LoginPage } from '@/apps/cep/pages/LoginPage'
import { SetPasswordPage } from '@/apps/cep/pages/SetPasswordPage'
import { TokenLandingPage } from '@/apps/cep/pages/TokenLandingPage'

const TermsPage = lazy(() => import('@/apps/cep/pages/TermsPage'))

/** Engagement's pages: one chunk of their own. Everyone's first component is Engagement, so its chunk is fetched as soon as the
 * app loads, beside the sign-in, and is in the cache by the time the person is in; a later component loads when it is opened. */
const cepRoutesChunk = import('@/apps/cep/routes')
const CepRoutes = lazy(() => cepRoutesChunk)
/** the tests await this before rendering, so a page's first assertion is not spent on loading the chunk */
// eslint-disable-next-line react-refresh/only-export-components
export const cepReady: Promise<unknown> = cepRoutesChunk
/** Insights' pages: a chunk of their own, loaded the first time the component is opened */
const InsightsRoutes = lazy(() => import('@/apps/insights/routes'))
const EmbedPage = lazy(() => import('@/apps/insights/pages/EmbedPage'))
const DesignerPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/DesignerPlayground')) : null
const MessagePlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/MessagePlayground')) : null
const ReceiptPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/ReceiptPlayground')) : null
const DevFields = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/DevFields')) : null
const ToastPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/ToastPlayground')) : null
const HomePlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/HomePlayground')) : null
const SettingsPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/SettingsPlayground')) : null
const CalendarPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/CalendarPlayground')) : null
const JourneySetupPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/JourneySetupPlayground')) : null
const CustomerPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/CustomerPlayground')) : null
const ConditionPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/ConditionPlayground')) : null
const TimelinePlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/TimelinePlayground')) : null
const JourneyBuildPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/cep/pages/JourneyBuildPlayground')) : null
const InsightsPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/insights/pages/InsightsPlayground')) : null
const DashboardPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/insights/pages/DashboardPlayground')) : null
const AskPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/insights/pages/AskPlayground')) : null
const DataPlayground = import.meta.env.DEV ? lazy(() => import('@/apps/insights/pages/DataPlayground')) : null

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
          <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/terms" element={<Suspense fallback={<FullPageSpinner label="Loading the terms" />}><TermsPage /></Suspense>} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/sso/complete" element={<TokenLandingPage kind="sso" />} />
            <Route path="/support-session" element={<TokenLandingPage kind="support" />} />
            <Route path="/embed/:code/:secret" element={<Suspense fallback={<FullPageSpinner label="Loading" />}><EmbedPage /></Suspense>} />
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
                {JourneyBuildPlayground && <Route path="/dev/journey-build" element={<Suspense fallback={<FullPageSpinner label="Loading the builder" />}><JourneyBuildPlayground /></Suspense>} />}
                {InsightsPlayground && <Route path="/dev/insights" element={<Suspense fallback={<FullPageSpinner label="Loading the editor" />}><InsightsPlayground /></Suspense>} />}
                {DashboardPlayground && <Route path="/dev/dashboard" element={<Suspense fallback={<FullPageSpinner label="Loading the dashboard" />}><DashboardPlayground /></Suspense>} />}
                {AskPlayground && <Route path="/dev/ask" element={<Suspense fallback={<FullPageSpinner label="Loading the box" />}><AskPlayground /></Suspense>} />}
                {DataPlayground && <Route path="/dev/data" element={<Suspense fallback={<FullPageSpinner label="Loading the samples" />}><DataPlayground /></Suspense>} />}
              </Route>
            )}
            <Route element={<RequireAuth />}>
              <Route path="/insights/*" element={<Suspense fallback={<FullPageSpinner label="Loading Insights" />}><InsightsRoutes /></Suspense>} />
              <Route path="/*" element={<Suspense fallback={<FullPageSpinner label="Loading" />}><CepRoutes /></Suspense>} />
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
