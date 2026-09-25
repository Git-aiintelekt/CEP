/** The app's main navigation, shared by the app shell and the template editor's own bar. */
import { FileText, GitBranch, LayoutDashboard, Megaphone, Settings, Users, type LucideIcon } from 'lucide-react'

import type { Feature } from '@/lib/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  feature?: Feature
}

/** The first group of the rail: everyone's everyday pages, in the nav rail spec's order */
export const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/journeys', label: 'Journeys', icon: GitBranch, feature: 'journeys' },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/contact-lists', label: 'Contact lists', icon: Users },
]

/** The second group, below the divider: for workspace admins only */
export const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings }
