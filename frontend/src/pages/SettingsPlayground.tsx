/** /dev/settings (dev builds only): the Settings menu bar above a stand-in page, every feature on, nothing from the API; Set-Up is the real page on the sample workspace. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, Route, Routes } from 'react-router-dom'

import { SettingsMenuPanel } from '@/pages/settings/SettingsMenu'
import { WorkspaceSetupPage } from '@/pages/settings/WorkspaceSetupPage'
import { SETTINGS_GROUPS, pageAt } from '@/pages/settings/settingsCatalogue'

import { SAMPLE_SETUP } from '@/features/setup/sampleSetup'
import { SETUP_KEY } from '@/features/setup/setup'

function StandIn({ path }: { path: string }) {
  const page = pageAt(path)
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-section-title font-semibold text-ink-900">{page?.label ?? 'Settings'}</h2>
      <p className="mt-1 text-sm text-ink-800">The page itself is unchanged; this stand-in only shows where the menu puts it.</p>
    </div>
  )
}

/** the Set-Up page as it reads half way through: three steps done, the sender to verify next (Hide Until Later has no API here) */
function SampleSetup() {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    seeded.setQueryData(SETUP_KEY, SAMPLE_SETUP)
    return seeded
  })
  return <QueryClientProvider client={client}><WorkspaceSetupPage /></QueryClientProvider>
}

export default function SettingsPlayground() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div><h1 className="font-display text-page-title font-semibold text-ink-900">Settings</h1><p className="mt-1 text-sm text-ink-800">The menu on sample data: every feature on.</p></div>
      <SettingsMenuPanel has={() => true} base="/dev/settings" />
      <div className="flex min-w-0 items-start gap-5">
        <section aria-label="Settings page" className="min-w-0 flex-1">
          <Routes>
            <Route element={<Outlet />}>
              <Route path="setup" element={<SampleSetup />} />
              {SETTINGS_GROUPS.flatMap((group) => group.pages).filter((page) => page.to !== '/settings/setup').map((page) => <Route key={page.to} path={page.to.replace('/settings/', '')} element={<StandIn path={page.to} />} />)}
              <Route index element={<StandIn path="/settings/users" />} />
            </Route>
          </Routes>
        </section>
      </div>
    </div>
  )
}
