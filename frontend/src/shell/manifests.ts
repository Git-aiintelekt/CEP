/**
 * The suite's components as the shell knows them: each one's identity (name, tagline, icon, tile colour), its home and
 * its menu. GET /me/ says which of them a workspace can open; the manifest says how to draw it. A component that is not
 * built yet has no manifest and only appears in the launcher's "coming" line.
 */
import { ChartColumn, Contact, Megaphone, Package, ShoppingCart, Tags, TrendingUp, type LucideIcon } from 'lucide-react'

import { MAIN_NAV, type NavItem } from '@/components/navItems'
import type { Me, SuiteComponent } from '@/lib/types'

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

export const ENGAGEMENT: ComponentManifest = {
  key: 'cep',
  name: 'Engagement',
  tagline: 'Customer Engagement',
  icon: Megaphone,
  tile: 'bg-brand-100 text-brand-800',
  home: '/',
  menu: MAIN_NAV,
}

export const MANIFESTS: Record<string, ComponentManifest> = { cep: ENGAGEMENT }

/** what exists but is not released: the launcher says it is coming */
export const COMING: { key: string; name: string; icon: LucideIcon }[] = [
  { key: 'insights', name: 'Insights', icon: ChartColumn },
  { key: 'crm', name: 'CRM', icon: Contact },
  { key: 'sales', name: 'Sales', icon: TrendingUp },
  { key: 'pur', name: 'Purchasing', icon: ShoppingCart },
  { key: 'inv', name: 'Inventory', icon: Package },
  { key: 'pim', name: 'PIM', icon: Tags },
]

export interface EntitledComponent extends ComponentManifest {
  access: SuiteComponent['access']
  until: string | null
}

/** The components this person's workspace can open, in suite order. An older API that says nothing means Engagement alone. */
export function entitled(me: Me | null): EntitledComponent[] {
  const list = me?.components ?? [{ key: 'cep', name: 'Engagement', tagline: 'Customer Engagement', access: 'PLAN', until: null } satisfies SuiteComponent]
  return list.flatMap((item) => {
    const manifest = MANIFESTS[item.key]
    return manifest ? [{ ...manifest, access: item.access, until: item.until }] : []
  })
}

/** the component whose menu owns a path; Engagement owns everything it has no better owner for */
export function componentAt(pathname: string, components: EntitledComponent[]): EntitledComponent | null {
  const owner = components.find((component) => component.menu.some((item) => item.to !== '/' && (pathname === item.to || pathname.startsWith(`${item.to}/`))))
  return owner ?? components.find((component) => component.key === 'cep') ?? components[0] ?? null
}

/** the names of the components still to come, as one sentence for the launcher */
export function comingSentence(): string {
  const names = COMING.map((item) => item.name)
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are coming.`
}
