/** The navigation beside the template editors: the app's rail, always collapsed to 64px, with the same items, states and tooltips. */
import { useAuth } from '@/auth/AuthContext'

import { MAIN_NAV } from '@/apps/cep/manifest'
import { RailGroup, RailMark } from './Rail'

export const NAV_BAR_WIDTH = 64

interface NavBarProps {
  /** lets a page hold the navigation back, e.g. to confirm leaving unsaved work */
  onNavigate?: (to: string, event: React.MouseEvent) => void
}

export function NavBar({ onNavigate }: NavBarProps) {
  const { can, has } = useAuth()
  const items = MAIN_NAV.filter((item) => !item.requires && (!item.feature || has(item.feature)) && (!item.permission || can(item.permission)))

  return (
    <nav aria-label="Main" className="flex w-16 shrink-0 flex-col items-center bg-sidebar py-5">
      <div className="mb-8"><RailMark onNavigate={onNavigate} /></div>
      <RailGroup label="Pages" items={items} onNavigate={onNavigate} />
    </nav>
  )
}
