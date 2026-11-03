/**
 * The Settings menu: General, then a group per suite component the workspace has (docs/mockups/settings-by-component.html,
 * option A), who sees which page, and the three things the panel remembers per viewer.
 */
import { Bell, Braces, CalendarRange, ChartColumn, CheckCircle2, CircleDollarSign, ClipboardCheck, Database, Key, Layers, Link2, ListChecks, Lock, Mail, Megaphone, Plug, Receipt, Send, SlidersHorizontal, Sparkles, Target, UserX, Users, Zap, type LucideIcon } from 'lucide-react'

import type { Feature, Me } from '@/lib/types'

export interface SettingsPage {
  to: string
  label: string
  icon: LucideIcon
  feature?: Feature
  /** a heading inside the group the page sits under (Sending, Audience, Connections) */
  section?: string
}

export interface SettingsGroup {
  key: string
  label: string
  icon: LucideIcon
  /** the suite component the group belongs to; none = General, which every workspace has */
  component?: string
  pages: SettingsPage[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { key: 'general', label: 'General', icon: SlidersHorizontal, pages: [
    { to: '/settings/setup', label: 'Set-Up', icon: ListChecks },
    { to: '/settings/users', label: 'Users', icon: Users },
    { to: '/settings/roles', label: 'Roles', icon: Layers },
    { to: '/settings/security', label: 'Security', icon: Lock },
    { to: '/settings/ai-assistant', label: 'AI Assistant', icon: Sparkles },
    { to: '/settings/api-keys', label: 'API Keys', icon: Key, feature: 'api_access' },
    { to: '/settings/plan', label: 'Plan & Usage', icon: CircleDollarSign },
  ] },
  { key: 'engagement', label: 'Engagement', icon: Megaphone, component: 'cep', pages: [
    { to: '/settings/delivery', label: 'Sending Engines', icon: Send, section: 'Sending' },
    { to: '/settings/email', label: 'Email Server', icon: Mail, section: 'Sending' },
    { to: '/settings/utm-tracking', label: 'UTM Tracking', icon: Link2, section: 'Sending' },
    { to: '/settings/approvals', label: 'Approvals', icon: CheckCircle2, section: 'Sending' },
    { to: '/settings/tags', label: 'Tags', icon: Braces, section: 'Sending' },
    { to: '/settings/notifications', label: 'Notifications', icon: Bell, section: 'Sending' },
    { to: '/settings/suppressions', label: 'Suppressions', icon: UserX, section: 'Audience' },
    { to: '/settings/preference-center', label: 'Preference Centre', icon: SlidersHorizontal, section: 'Audience' },
    { to: '/settings/consent', label: 'Consent Policy', icon: ClipboardCheck, section: 'Audience' },
    { to: '/settings/integrations', label: 'Integrations', icon: Plug, section: 'Connections' },
    { to: '/settings/pos', label: 'POS Receipts', icon: Receipt, feature: 'ereceipt', section: 'Connections' },
    { to: '/settings/attribution', label: 'Attribution', icon: Target, section: 'Connections' },
    { to: '/settings/events', label: 'Events', icon: Zap, feature: 'journeys', section: 'Connections' },
  ] },
  { key: 'insights', label: 'Insights', icon: ChartColumn, component: 'insights', pages: [
    { to: '/settings/report-databases', label: 'Report Databases', icon: Database },
    { to: '/settings/report-access', label: 'Report Access', icon: Lock },
    { to: '/settings/fiscal-year', label: 'Fiscal Year', icon: CalendarRange },
  ] },
]

/** the suite components a workspace has, from GET /me/; an older API that says nothing means Engagement alone */
export const componentsOf = (me: Me | null | undefined): string[] =>
  me?.components ? me.components.filter((component) => component.access !== 'NONE').map((component) => component.key) : ['cep']

/** the groups with the pages this workspace has: General, and a component's group only when the workspace has the component */
export function visibleGroups(has: (feature: Feature) => boolean, components?: string[]): SettingsGroup[] {
  return SETTINGS_GROUPS
    .filter((group) => !group.component || !components || components.includes(group.component))
    .map((group) => ({ ...group, pages: group.pages.filter((page) => !page.feature || has(page.feature)) }))
    .filter((group) => group.pages.length > 0)
}

export const pageAt = (path: string): SettingsPage | undefined => SETTINGS_GROUPS.flatMap((group) => group.pages).find((page) => page.to === path || path.startsWith(page.to + '/'))
export const groupOf = (path: string): SettingsGroup | undefined => SETTINGS_GROUPS.find((group) => group.pages.some((page) => page.to === path || path.startsWith(page.to + '/')))

/** the pages whose label (or group, or heading) contains the words typed, in menu order */
export function findPages(groups: SettingsGroup[], needle: string): SettingsPage[] {
  const words = needle.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return groups.flatMap((group) => group.pages.filter((page) => words.every((word) => `${page.label} ${page.section ?? ''} ${group.label}`.toLowerCase().includes(word))))
}

// ---- what the panel remembers for this browser: the last pages visited, the groups folded, the panel folded
const RECENT_KEY = 'cep.settings.recent'
const FOLDED_KEY = 'cep.settings.folded'
const PANEL_KEY = 'cep.settings.panel'
export const RECENT_SHOWN = 3

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // a private window or blocked storage: the panel just forgets
  }
}

export const readRecent = (): string[] => read<string[]>(RECENT_KEY, []).filter((path) => pageAt(path))
export function rememberVisit(path: string): string[] {
  if (!pageAt(path)) return readRecent()
  const next = [path, ...readRecent().filter((item) => item !== path)].slice(0, RECENT_SHOWN + 1)      // one more than shown: the current page is left out of the list
  write(RECENT_KEY, next)
  return next
}
export const readFolded = (): string[] => read<string[]>(FOLDED_KEY, [])
export const writeFolded = (keys: string[]) => write(FOLDED_KEY, keys)
export const readPanelFolded = (): boolean => read<boolean>(PANEL_KEY, false)
export const writePanelFolded = (folded: boolean) => write(PANEL_KEY, folded)
