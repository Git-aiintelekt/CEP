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

export const OVERVIEW: NavItem = { to: '/', label: 'Overview', icon: LayoutDashboard, end: true }

export const ENGAGE: NavItem[] = [
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/journeys', label: 'Journeys', icon: GitBranch, feature: 'journeys' },
  { to: '/templates', label: 'Templates', icon: FileText },
]

export const MANAGE: NavItem[] = [{ to: '/contact-lists', label: 'Contact lists', icon: Users }]

export const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings }

/** Every destination the editor's 72px bar offers, in the shell's own order. */
export const MAIN_NAV: NavItem[] = [OVERVIEW, ...ENGAGE, ...MANAGE]
