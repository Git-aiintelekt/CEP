import { ChevronRight } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { ErrorState } from '@/components/States'

import { SettingsMenu } from './SettingsMenu'
import { componentsOf, groupOf, pageAt } from './settingsCatalogue'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { HELP_FOR_PAGE } from '@/apps/cep/help/chapters'

const TrailChevron = () => <ChevronRight size={14} strokeWidth={1.5} aria-hidden className="text-ink-300" />

/** "Settings › Engagement › Sending Engines": where in the menu the page sits, with the page's help icon when it has a chapter */
function Trail({ path }: { path: string }) {
  const page = pageAt(path)
  const group = groupOf(path)
  const chapter = path === '/settings/delivery' ? undefined : HELP_FOR_PAGE[path]                      // Sending Engines carries its own icon beside its heading
  if (!page || !group) return null
  return (
    <nav aria-label="Where you are" className="flex items-center gap-1.5 text-helper text-ink-800">
      <span>Settings</span><TrailChevron /><span>{group.label}</span><TrailChevron /><span aria-current="page" className="font-semibold text-ink-900">{page.label}</span>
      {chapter && <PageHelp chapter={chapter} />}
    </nav>
  )
}

/** Settings: the menu panel on the left (General and the workspace's components), the page on the right. */
export function SettingsLayout() {
  const { can, me } = useAuth()
  const { pathname } = useLocation()
  const allowed = can('user.admin')
  const group = groupOf(pathname)
  const missing = group?.component && !componentsOf(me).includes(group.component) ? group : null

  if (!allowed) {
    return <ErrorState title="Settings are for workspace administrators" detail="Ask someone with the user.admin permission to make this change, or to give you an administrator role." />
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h1 className="font-display text-page-title font-semibold text-ink-900">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-800">General covers the whole workspace: who can sign in, what they may do and the plan. Each component has its own settings below it.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-5 md:flex-row md:items-start">
        <SettingsMenu />
        <section aria-label="Settings page" className="flex min-w-0 flex-1 flex-col gap-4">
          {missing ? (
            <ErrorState title={`This workspace does not have ${missing.label}`} detail={`${missing.label}'s settings show here once the workspace has it. The platform team adds a component to the plan.`} />
          ) : (
            <>
              <Trail path={pathname} />
              <Outlet />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
