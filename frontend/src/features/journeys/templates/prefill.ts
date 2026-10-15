/** What the Setup pop-up starts with: a C360 starter's settings, or only a name and description (a drip turned into a journey). */
import type { JourneyEntryRule, JourneyStarter } from '@/lib/types'

import { triggerFromRule } from '../entryTriggers'

export interface SetupPrefill {
  /** what POST /journeys/ is told the journey is made from: a C360 starter's key or a saved template's id; absent when nothing
   * but a name and description is carried over */
  source?: { starter: string } | { template: string }
  sourceName?: string
  name: string
  description?: string
  entryType: string
  triggerValue: string
  triggerLabel: string | null
  /** the starter's own entry rule: kept as it is when the trigger isn't changed, so nothing in it is lost */
  rule: JourneyEntryRule | undefined
  populationMode: string
  reentryPolicy: string
  reentryAfterDays: string
}

/** Create a Journey Instead, from the Create Campaign pop-up: the name and description typed there, nothing else */
export function prefillNamed(name: string, description: string): SetupPrefill {
  return { name, description, entryType: '', triggerValue: '', triggerLabel: null, rule: undefined, populationMode: '', reentryPolicy: 'NEVER', reentryAfterDays: '' }
}

export function prefillFor(source: JourneyStarter): SetupPrefill {
  const rule = source.graph.entry_rules[0]
  const trigger = triggerFromRule(rule)
  return {
    source: source.template_id ? { template: source.template_id } : { starter: source.key },
    sourceName: source.name,
    name: `${source.name} (copy)`,
    entryType: trigger.entryType,
    triggerValue: trigger.value,
    triggerLabel: trigger.label,
    rule,
    populationMode: source.population_mode,
    reentryPolicy: source.reentry_policy,
    reentryAfterDays: source.reentry_after_days ? String(source.reentry_after_days) : '',
  }
}
