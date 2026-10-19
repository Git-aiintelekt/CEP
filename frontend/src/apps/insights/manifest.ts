/**
 * Insights, the reporting app (component key `insights`): its identity for the shell, its Home and its menu. Reports are
 * grouped by the component whose data they use; each component's own menu also carries an Insights item that opens the
 * list on its reports (the integrated mode).
 */
import { Activity, CalendarClock, ChartColumn, FileBarChart, FileUp, LayoutDashboard, LayoutGrid, ScrollText, Sigma } from 'lucide-react'

import type { NavItem } from '@/components/navItems'
import type { ComponentManifest } from '@/shell/componentTypes'

export const INSIGHTS_NAV: NavItem[] = [
  { to: '/insights', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/insights/reports', label: 'Reports', icon: FileBarChart, permission: 'report.view' },
  { to: '/insights/dashboards', label: 'Dashboards', icon: LayoutGrid, permission: 'report.view' },
  { to: '/insights/scheduled', label: 'Scheduled', icon: CalendarClock, permission: 'report.view' },
  { to: '/insights/uploads', label: 'Uploaded Files', icon: FileUp, permission: 'report.edit' },
  { to: '/insights/formulas', label: 'Shared Formulas', icon: Sigma, permission: 'report.edit' },
  { to: '/insights/runs', label: 'Run Log', icon: ScrollText, permission: 'report.admin' },
  { to: '/insights/usage', label: 'Usage', icon: Activity, permission: 'report.admin' },
]

export const INSIGHTS: ComponentManifest = {
  key: 'insights',
  name: 'Insights',
  tagline: 'Reports, dashboards, datasets',
  icon: ChartColumn,
  tile: 'bg-fill-subtle text-ink-900',
  home: '/insights',
  menu: INSIGHTS_NAV,
}
