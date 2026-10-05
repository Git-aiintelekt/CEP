/** What the Journey Templates panel, cards and previews say about a CEP starter (and the Your Journeys cards about a
 * journey): its category, the sentence for what starts it, its steps in order, which of them still need content,
 * and its population and re-entry in words. */
import { Activity, Award, ShoppingBag, Users, type LucideIcon } from 'lucide-react'

import { titleize } from '@/lib/format'
import type { Journey, JourneyEntryRule, JourneyGraph, JourneyTemplateCategory } from '@/lib/types'

import { describeSchedule, referenceLabel } from '../entryTriggers'
import { flatten, fromWireGraph, isNodeConfigured, type EditorNode } from '../graphModel'
import { NODE_META, stepLabel, type AddableType } from '../nodeDefs'
import { FAMILY_META } from '../triggerFamily'

export const CATEGORIES: JourneyTemplateCategory[] = ['LIFECYCLE', 'COMMERCE', 'LOYALTY', 'ENGAGEMENT']

/** The category chips reuse the List page's trigger-family colours (the --cat-* tokens), one family per category. */
export const CATEGORY_META: Record<JourneyTemplateCategory, { label: string; icon: LucideIcon; chip: string }> = {
  LIFECYCLE: { label: 'Lifecycle', icon: Users, chip: FAMILY_META.CUSTOMER_LIFECYCLE.tile },
  COMMERCE: { label: 'Commerce', icon: ShoppingBag, chip: FAMILY_META.COMMERCE_OFFER.tile },
  LOYALTY: { label: 'Loyalty', icon: Award, chip: FAMILY_META.SEGMENT_LOYALTY.tile },
  ENGAGEMENT: { label: 'Engagement', icon: Activity, chip: FAMILY_META.ENGAGEMENT.tile },
}

const EVENT_SENTENCE: Record<string, string> = {
  CUSTOMER_CREATED: 'When a new customer profile is created',
  WELCOME: 'When a customer joins and is welcomed',
  CART_ABANDON: 'When a shopper leaves items in their cart',
  PURCHASE: 'When a customer completes a purchase',
  CATEGORY_PURCHASE: 'When a customer buys from a category',
  FIRST_PURCHASE: 'When a customer makes their first purchase',
  BIRTHDAY: 'On the customer’s birthday',
  ANNIVERSARY: 'On the customer’s membership anniversary',
  LOYALTY_TIER_CHANGE: 'When a customer’s loyalty tier changes',
  COUPON_ISSUED: 'When a coupon is issued to a customer',
  COUPON_REDEEMED: 'When a customer redeems a coupon',
  SEGMENT_INCEPTION: 'When a customer first lands in a segment',
  EMAIL_ENGAGEMENT: 'When a customer opens or clicks an email',
  SMS_RESPONSE: 'When a customer replies to an SMS',
  NO_RESPONSE: 'When a customer stops opening or clicking',
}

const ATTRIBUTE_SENTENCE: Record<string, string> = {
  LOYALTY_TIER: 'When a customer’s loyalty tier changes',
  PREFERENCE_UPDATE: 'When a customer updates their preferences',
  ADDRESS_CHANGE: 'When a customer’s address changes',
}

/** The sentence for what starts a journey: "When a shopper leaves items in their cart". */
export function triggerSentence(rule: JourneyEntryRule | undefined): string {
  if (!rule) return 'No trigger chosen yet'
  const definition = rule.rule_definition as { event_type?: string; change?: string; schedule?: string; change_trigger?: string }
  switch (rule.entry_type) {
    case 'EVENT': {
      const event = String(definition.event_type ?? '').toUpperCase()
      return EVENT_SENTENCE[event] ?? `When ${titleize(event).toLowerCase()} happens`
    }
    case 'SEGMENT_CHANGE':
      if (definition.change === 'JOINED') return `When a customer enters ${referenceLabel(rule) ?? 'a segment'}`
      if (definition.change === 'LEFT') return `When a customer leaves ${referenceLabel(rule) ?? 'a segment'}`
      if (definition.change_trigger) return ATTRIBUTE_SENTENCE[definition.change_trigger.toUpperCase()] ?? `When a customer’s ${titleize(definition.change_trigger).toLowerCase()} changes`
      return 'When a customer changes'
    case 'CUSTOMER_LIST':
      return `When a customer is in ${referenceLabel(rule) ?? 'a contact list'}`
    case 'DATE_TIME': {
      if (!definition.schedule) return 'On a schedule'
      const { when, who } = describeSchedule(rule.rule_definition as Record<string, unknown>, referenceLabel(rule))
      return `${when}, ${who}`
    }
    default:
      return titleize(rule.entry_type)
  }
}

/** A starter's entry that still needs a choice in Setup, e.g. "Choose your Lapsed segment". */
export function entrySetupNote(rule: JourneyEntryRule | undefined): string | null {
  const note = (rule?.rule_definition as { setup_note?: unknown } | undefined)?.setup_note
  return typeof note === 'string' && note.trim() !== '' ? note : null
}

/** The steps after the entry trigger in canvas order: the trunk, each Condition's YES branch, then its NO branch. */
export function stepsOf(graph: JourneyGraph): EditorNode[] {
  return flatten(fromWireGraph(graph))
}

/** A step's name for lists: its own label, or what kind of step it is. */
export function stepName(node: EditorNode): string {
  return stepLabel(node.config) ?? NODE_META[node.type as AddableType]?.label ?? titleize(node.type)
}

export function unconfiguredSteps(graph: JourneyGraph): EditorNode[] {
  return stepsOf(graph).filter((node) => !isNodeConfigured(node))
}

export function itemCategoryLabel(category: JourneyTemplateCategory): string {
  return CATEGORY_META[category]?.label ?? titleize(category)
}

type Setup = Pick<Journey, 'population_mode' | 'reentry_policy' | 'reentry_after_days'>

export function populationText(setup: Setup): string {
  return titleize(setup.population_mode)
}

export function reentryText(setup: Setup): string {
  switch (setup.reentry_policy) {
    case 'NEVER':
      return 'Never'
    case 'AFTER_X_DAYS':
      return setup.reentry_after_days ? `After ${setup.reentry_after_days} days` : 'After a cooldown'
    case 'EVERY_QUALIFYING_EVENT':
      return 'Every qualifying event'
    default:
      return titleize(setup.reentry_policy)
  }
}

export function stepsText(count: number): string {
  return `${count} ${count === 1 ? 'Step' : 'Steps'}`
}
