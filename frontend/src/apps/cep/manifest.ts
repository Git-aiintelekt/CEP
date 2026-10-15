/**
 * Engagement, the `cep` component: its identity for the shell (name, tagline, icon, tile), its Home and its menu. The
 * shell draws the launcher tile and the left navigation from this; the pages themselves are in ./routes, loaded the
 * first time the component is opened.
 */
import { BarChart3, ChartColumn, FileText, GitBranch, LayoutDashboard, Megaphone, Users } from 'lucide-react'

import type { NavItem } from '@/components/navItems'
import type { ComponentManifest } from '@/shell/componentTypes'

/** the component's menu: everyone's everyday pages; Reports last, after the things it reports on (2026-10-09) */
export const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/journeys', label: 'Journeys', icon: GitBranch, feature: 'journeys' },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/contact-lists', label: 'Contact lists', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'report.view' },
  { to: '/insights/reports?component=cep', label: 'Insights', icon: ChartColumn, permission: 'report.view', requires: 'insights' },
]

export const ENGAGEMENT: ComponentManifest = {
  key: 'cep',
  name: 'Engagement',
  tagline: 'Customer Engagement',
  icon: Megaphone,
  tile: 'bg-brand-100 text-brand-800',
  home: '/',
  menu: MAIN_NAV,
}
