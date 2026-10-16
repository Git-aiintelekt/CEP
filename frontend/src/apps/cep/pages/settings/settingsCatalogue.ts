/** The Settings menu: its groups and pages, who sees which, and the three things the panel remembers per viewer. */
import { Bell, Braces, CheckCircle2, CircleDollarSign, ClipboardCheck, Database, Key, Layers, ListChecks, Lock, Mail, Plug, Receipt, Send, ShieldCheck, SlidersHorizontal, Sparkles, Target, UserX, Users, Zap, type LucideIcon } from 'lucide-react'

import type { Feature } from '@/lib/types'

export interface SettingsPage {
  to: string
  label: string
  icon: LucideIcon
  feature?: Feature
}

export interface SettingsGroup {
  key: string
  label: string
  icon: LucideIcon
  pages: SettingsPage[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { key: 'workspace', label: 'Workspace', icon: Users, pages: [
    { to: '/settings/setup', label: 'Set-Up', icon: ListChecks },
    { to: '/settings/users', label: 'Users', icon: Users },
    { to: '/settings/roles', label: 'Roles', icon: Layers },
    { to: '/settings/tags', label: 'Tags', icon: Braces },
    { to: '/settings/security', label: 'Security', icon: Lock },
    { to: '/settings/approvals', label: 'Approvals', icon: CheckCircle2 },
    { to: '/settings/ai-assistant', label: 'AI Assistant', icon: Sparkles },
    { to: '/settings/report-databases', label: 'Report Databases', icon: Database },
    { to: '/settings/plan', label: 'Plan & Usage', icon: CircleDollarSign },
  ] },
  { key: 'sending', label: 'Sending', icon: Send, pages: [
    { to: '/settings/delivery', label: 'Sending Engines', icon: Send },
    { to: '/settings/email', label: 'Email Server', icon: Mail },
    { to: '/settings/notifications', label: 'Notifications', icon: Bell },
  ] },
  { key: 'audience', label: 'Audience', icon: ShieldCheck, pages: [
    { to: '/settings/suppressions', label: 'Suppressions', icon: UserX },
    { to: '/settings/preference-center', label: 'Preference Centre', icon: SlidersHorizontal },
    { to: '/settings/consent', label: 'Consent Policy', icon: ClipboardCheck },
  ] },
  { key: 'integrations', label: 'Integrations', icon: Plug, pages: [
    { to: '/settings/integrations', label: 'Integrations', icon: Plug },
    { to: '/settings/api-keys', label: 'API Keys', icon: Key, feature: 'api_access' },
    { to: '/settings/pos', label: 'POS Receipts', icon: Receipt, feature: 'ereceipt' },
    { to: '/settings/attribution', label: 'Attribution', icon: Target },
    { to: '/settings/events', label: 'Events', icon: Zap, feature: 'journeys' },
  ] },
]

/** the groups with the pages this workspace has; a group with nothing left is dropped */
export function visibleGroups(has: (feature: Feature) => boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({ ...group, pages: group.pages.filter((page) => !page.feature || has(page.feature)) })).filter((group) => group.pages.length > 0)
}

export const pageAt = (path: string): SettingsPage | undefined => SETTINGS_GROUPS.flatMap((group) => group.pages).find((page) => page.to === path || path.startsWith(page.to + '/'))
export const groupOf = (path: string): SettingsGroup | undefined => SETTINGS_GROUPS.find((group) => group.pages.some((page) => page.to === path))

/** the pages whose label (or group) contains the words typed, in menu order */
export function findPages(groups: SettingsGroup[], needle: string): SettingsPage[] {
  const words = needle.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return groups.flatMap((group) => group.pages.filter((page) => words.every((word) => `${page.label} ${group.label}`.toLowerCase().includes(word))))
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
