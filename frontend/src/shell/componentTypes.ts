/** What a suite component tells the shell about itself. A component ships this and its pages, never its own shell. */
import type { LucideIcon } from 'lucide-react'

import type { NavItem } from '@/components/navItems'

export interface ComponentManifest {
  key: string
  name: string
  tagline: string
  icon: LucideIcon
  /** the tile behind the icon: identity only, never an action colour */
  tile: string
  /** the component's Home */
  home: string
  menu: NavItem[]
}
