/** The suite's components the build knows, by key. Adding a component is one folder under apps/ and one line here. */
import { Contact, Package, ShoppingCart, Tags, TrendingUp, type LucideIcon } from 'lucide-react'

import type { ComponentManifest } from '@/shell/componentTypes'
import { ENGAGEMENT } from './cep/manifest'
import { INSIGHTS } from './insights/manifest'

export const MANIFESTS: Record<string, ComponentManifest> = { cep: ENGAGEMENT, insights: INSIGHTS }

/** what exists but is not built yet: the launcher says it is coming when the server does not say */
export const COMING: { key: string; name: string; icon: LucideIcon }[] = [
  { key: 'crm', name: 'CRM', icon: Contact },
  { key: 'sales', name: 'Sales', icon: TrendingUp },
  { key: 'pur', name: 'Purchasing', icon: ShoppingCart },
  { key: 'inv', name: 'Inventory', icon: Package },
  { key: 'pim', name: 'PIM', icon: Tags },
]
