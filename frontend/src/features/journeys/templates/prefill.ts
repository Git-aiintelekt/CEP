/** What the Setup pop-up starts with when someone uses a CEP starter. */
import type { JourneyEntryRule, JourneyStarter } from '@/lib/types'

import { triggerFromRule } from '../entryTriggers'

export interface SetupPrefill {
  /** what POST /journeys/ is told the journey is made from */
  source: { starter: string }
  sourceName: string
  name: string
  entryType: string
  triggerValue: string
  triggerLabel: string | null
  /** the starter's own entry rule: kept as it is when the trigger isn't changed, so nothing in it is lost */
  rule: JourneyEntryRule | undefined
  populationMode: string
  reentryPolicy: string
  reentryAfterDays: string
}

export function prefillFor(source: JourneyStarter): SetupPrefill {
  const rule = source.graph.entry_rules[0]
  const trigger = triggerFromRule(rule)
  return {
    source: { starter: source.key },
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
