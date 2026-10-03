import { ChevronRight } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ErrorState } from '@/components/States'

import { SettingsMenu } from './SettingsMenu'
import { groupOf, pageAt } from './settingsCatalogue'

const TrailChevron = () => <ChevronRight size={14} strokeWidth={1.5} aria-hidden className="text-ink-300" />

/** "Settings › Sending › Sending Engines": where in the menu the page sits */
function Trail({ path }: { path: string }) {
  const page = pageAt(path)
  const group = groupOf(path)
  if (!page || !group) return null
  return (
    <nav aria-label="Where you are" className="flex items-center gap-1.5 text-helper text-ink-800">
      <span>Settings</span><TrailChevron /><span>{group.label}</span><TrailChevron /><span aria-current="page" className="font-semibold text-ink-900">{page.label}</span>
    </nav>
  )
}

/** Settings: the menu panel on the left (the pages in their groups), the page on the right. */
export function SettingsLayout() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const allowed = can('user.admin')

  if (!allowed) {
    return <ErrorState title="Settings are for workspace administrators" error={new Error('Ask someone with the user.admin permission to make this change, or to give you an administrator role.')} />
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h1 className="font-display text-page-title font-semibold text-ink-900">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-800">Who can sign in to this workspace, what they may do, and which systems may call the API.</p>
      </div>
      <div className="flex min-w-0 items-start gap-5">
        <SettingsMenu />
        <section aria-label="Settings page" className="flex min-w-0 flex-1 flex-col gap-4">
          <Trail path={pathname} />
          <Outlet />
        </section>
      </div>
    </div>
  )
}
