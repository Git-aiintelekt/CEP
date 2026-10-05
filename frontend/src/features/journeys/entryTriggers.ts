/** Specific-trigger catalogues for the Journey Setup modal's Step 1 dropdown — one per entry-type pill.
 *
 * Event reuses 6c's trigger-family vocabulary (triggerFamily.ts / apps.journeys.listing.EVENT_FAMILY) for its four
 * groups, so a journey created here lands in the same "Triggered by" bucket on the List page. Most of these
 * event_type values were already in JourneyEvent's documented vocabulary (apps/journeys/models.py); three weren't
 * (SEGMENT_INCEPTION, EMAIL_ENGAGEMENT, NO_RESPONSE) and apps/journeys/listing.py's EVENT_FAMILY was extended to
 * place them — see that file's comment. EMAIL_ENGAGEMENT is a deliberate merge of EMAIL_OPEN/EMAIL_CLICK into the
 * prototype's single "Email open/click" option, rather than inventing a second UI step to pick between them.
 *
 * Customer List's groups are built live from GET /contact-lists/ (JourneySetupModal), not from a static catalogue
 * here, since they're real tenant data.
 *
 * Date/Time and Segment-or-customer-change have no existing backend vocabulary to reuse (apps/journeys/engine's
 * enroll.py candidate query only understands CUSTOMER_LIST/EVENT/SEGMENT_CHANGE{segment_id,change}; DATE_TIME and
 * a bare attribute-change aren't designed yet and enroll nobody, same as the engine's own documented stub) — the
 * values below are this modal's own, chosen to read naturally and to keep SEGMENT_CHANGE's two "Segment" options
 * mapped onto the real {segment_id, change: JOINED|LEFT} shape the engine does understand (Setup's Segment picker
 * supplies segment_id).
 */
import type { JourneyEntryRule } from '@/lib/types'

export interface TriggerOption {
  value: string
  label: string
}

export interface TriggerGroup {
  key: string
  label: string
  options: TriggerOption[]
}

export const EVENT_TRIGGER_GROUPS: TriggerGroup[] = [
  {
    key: 'CUSTOMER_LIFECYCLE', label: 'Customer / Lifecycle',
    options: [
      { value: 'WELCOME', label: 'Welcome' },
      { value: 'BIRTHDAY', label: 'Birthday' },
      { value: 'ANNIVERSARY', label: 'Anniversary' },
      { value: 'FIRST_PURCHASE', label: 'First Purchase' },
      { value: 'CUSTOMER_CREATED', label: 'Customer Creation' },
    ],
  },
  {
    key: 'COMMERCE_OFFER', label: 'Commerce / Offer',
    options: [
      { value: 'PURCHASE', label: 'Purchase' },
      { value: 'CART_ABANDON', label: 'Abandoned Cart' },
      { value: 'COUPON_ISSUED', label: 'Coupon Issue' },
      { value: 'COUPON_REDEEMED', label: 'Coupon Redemption' },
    ],
  },
  {
    key: 'SEGMENT_LOYALTY', label: 'Segment / Loyalty',
    options: [
      { value: 'SEGMENT_INCEPTION', label: 'Segment Inception' },
      { value: 'LOYALTY_TIER_CHANGE', label: 'Loyalty Tier Change' },
    ],
  },
  {
    key: 'ENGAGEMENT', label: 'Engagement',
    options: [
      { value: 'EMAIL_ENGAGEMENT', label: 'Email Open/Click' },
      { value: 'SMS_RESPONSE', label: 'SMS Response' },
      { value: 'NO_RESPONSE', label: 'No Response' },
    ],
  },
]

export const DATE_TIME_TRIGGER_GROUPS: TriggerGroup[] = [
  {
    key: 'RECURRING', label: 'Recurring',
    options: [
      { value: 'DAILY', label: 'Daily' },
      { value: 'WEEKLY', label: 'Weekly' },
      { value: 'MONTHLY', label: 'Monthly' },
    ],
  },
  {
    key: 'FIXED', label: 'Fixed',
    options: [
      { value: 'SPECIFIC_DATE', label: 'On a Specific Date' },
      { value: 'DATE_ATTRIBUTE', label: 'On a Date Attribute' },
    ],
  },
]

export const SEGMENT_CHANGE_TRIGGER_GROUPS: TriggerGroup[] = [
  {
    key: 'SEGMENT', label: 'Segment',
    options: [
      { value: 'ENTERS_SEGMENT', label: 'Enters Segment' },
      { value: 'EXITS_SEGMENT', label: 'Exits Segment' },
    ],
  },
  {
    key: 'ATTRIBUTE_CHANGE', label: 'Attribute Change',
    options: [
      { value: 'LOYALTY_TIER', label: 'Loyalty Tier' },
      { value: 'PREFERENCE_UPDATE', label: 'Preference Update' },
      { value: 'ADDRESS_CHANGE', label: 'Address Change' },
    ],
  },
]

export const TRIGGER_PLACEHOLDER: Record<string, string> = {
  EVENT: 'Select an Event Trigger',
  CUSTOMER_LIST: 'Select a Customer List',
  DATE_TIME: 'Select a Schedule',
  SEGMENT_CHANGE: 'Select a Change Trigger',
}

export interface Reference {
  id: string
  name: string | null
}

/** Enters Segment / Exits Segment also need which segment (apps/journeys/engine/enroll.py reads segment_id). */
export function needsSegment(entryType: string, value: string): boolean {
  return entryType === 'SEGMENT_CHANGE' && (value === 'ENTERS_SEGMENT' || value === 'EXITS_SEGMENT')
}

/** The rule_definition apps/journeys/graph.py stores for the chosen entry type + specific trigger value.
 * `listLabel` is the Customer List picker's chosen list name and `segment` the Segment picker's choice; both names
 * are kept for display only (screens read the live name the backend adds as reference_name). */
export function ruleDefinitionFor(entryType: string, value: string, listLabel?: string, segment?: Reference | null): Record<string, unknown> {
  switch (entryType) {
    case 'CUSTOMER_LIST':
      return { contact_list_id: value, contact_list_name: listLabel }
    case 'EVENT':
      return { event_type: value }
    case 'DATE_TIME':
      return { schedule: value }
    case 'SEGMENT_CHANGE': {
      const target = segment ? { segment_id: segment.id, segment_name: segment.name ?? undefined } : {}
      if (value === 'ENTERS_SEGMENT') return { change: 'JOINED', ...target }
      if (value === 'EXITS_SEGMENT') return { change: 'LEFT', ...target }
      return { change_trigger: value }
    }
    default:
      return {}
  }
}

export function entryRuleFor(entryType: string, value: string, listLabel?: string, segment?: Reference | null): JourneyEntryRule {
  return { entry_type: entryType, rule_definition: ruleDefinitionFor(entryType, value, listLabel, segment) }
}

/** The name of the contact list or segment a rule points at: the backend's live reference_name, else the name saved
 * with the rule; "Unknown list" / "Unknown segment" when it is gone. Never the raw id. Null when the rule names neither. */
export function referenceLabel(rule: JourneyEntryRule | undefined): string | null {
  if (!rule) return null
  const definition = rule.rule_definition as { contact_list_id?: string; contact_list_name?: string; segment_id?: string; segment_name?: string }
  if (rule.entry_type === 'CUSTOMER_LIST' && definition.contact_list_id) {
    return ('reference_name' in rule ? rule.reference_name : definition.contact_list_name) || 'Unknown list'
  }
  if (rule.entry_type === 'SEGMENT_CHANGE' && definition.segment_id) {
    return ('reference_name' in rule ? rule.reference_name : definition.segment_name) || 'Unknown segment'
  }
  return null
}

/** The reverse of ruleDefinitionFor: which entry pill, trigger value, label and segment an existing rule means, for
 * the Setup pop-up pre-filled from a template or from the journey itself. A value the catalogues don't list keeps
 * its own wording. */
export function triggerFromRule(rule: JourneyEntryRule | undefined): { entryType: string; value: string; label: string | null; segment: Reference | null } {
  if (!rule) return { entryType: '', value: '', label: null, segment: null }
  const definition = rule.rule_definition as { event_type?: string; contact_list_id?: string; schedule?: string; change?: string; change_trigger?: string; segment_id?: string }
  const find = (groups: TriggerGroup[], value: string) => groups.flatMap((group) => group.options).find((option) => option.value === value)?.label
  const humane = (value: string) => value.toLowerCase().split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  switch (rule.entry_type) {
    case 'EVENT': {
      const value = String(definition.event_type ?? '').toUpperCase()
      return { entryType: 'EVENT', value, label: value ? find(EVENT_TRIGGER_GROUPS, value) ?? humane(value) : null, segment: null }
    }
    case 'CUSTOMER_LIST':
      return { entryType: 'CUSTOMER_LIST', value: String(definition.contact_list_id ?? ''), label: referenceLabel(rule), segment: null }
    case 'DATE_TIME': {
      const value = String(definition.schedule ?? '')
      return { entryType: 'DATE_TIME', value, label: value ? find(DATE_TIME_TRIGGER_GROUPS, value) ?? humane(value) : null, segment: null }
    }
    case 'SEGMENT_CHANGE': {
      const value = definition.change === 'JOINED' ? 'ENTERS_SEGMENT' : definition.change === 'LEFT' ? 'EXITS_SEGMENT' : String(definition.change_trigger ?? '')
      const segment = definition.segment_id ? { id: definition.segment_id, name: referenceLabel(rule) } : null
      return { entryType: 'SEGMENT_CHANGE', value, label: value ? find(SEGMENT_CHANGE_TRIGGER_GROUPS, value) ?? humane(value) : null, segment }
    }
    default:
      return { entryType: '', value: '', label: null, segment: null }
  }
}
