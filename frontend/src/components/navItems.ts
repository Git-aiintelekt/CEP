/** A navigation item as the shell and the template editors' bar draw it; a component's menu is a list of these (apps/<key>/manifest.ts). */
import { Settings, type LucideIcon } from 'lucide-react'

import type { Feature } from '@/lib/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  feature?: Feature
  /** shown only to someone whose role carries this permission */
  permission?: string
  /** shown only when the workspace has this suite component (and, for insights, the mode offers it in menus) */
  requires?: string
  /** shown only when AI can draft reports for this person (a provider with a key on, AI on for the workspace): AI Reports */
  ai?: boolean
}

/** The second group, below the divider: for workspace admins only */
export const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings }
