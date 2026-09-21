/** The app's 72px navigation bar, as the design draws it beside the template editor. */
import { Link, NavLink } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'

import { MAIN_NAV } from './navItems'

export const NAV_BAR_WIDTH = 72

interface NavBarProps {
  /** lets a page hold the navigation back, e.g. to confirm leaving unsaved work */
  onNavigate?: (to: string, event: React.MouseEvent) => void
}

export function NavBar({ onNavigate }: NavBarProps) {
  const { has } = useAuth()
  const items = MAIN_NAV.filter((item) => !item.feature || has(item.feature))

  return (
    <nav aria-label="Main" className="flex w-[72px] shrink-0 flex-col items-center gap-6 bg-sidebar py-4">
      <Link
        to="/"
        onClick={(event) => onNavigate?.('/', event)}
        aria-label="CEP overview"
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 font-display text-sm font-bold tracking-[-0.03em] text-white"
      >
        CEP
      </Link>

      <div className="flex w-full flex-col items-center gap-1.5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            aria-label={label}
            onClick={(event) => onNavigate?.(to, event)}
            className={({ isActive }) =>
              `flex h-11 w-11 items-center justify-center rounded-lg ${isActive ? 'bg-brand-600 text-white' : 'text-sidebar-icon hover:bg-sidebar-hover'}`
            }
          >
            <Icon size={22} strokeWidth={1.5} aria-hidden />
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
