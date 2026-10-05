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
 * Date/Time keeps {schedule} and adds the schedule's own fields and who enters (dateTimeDefinition; apps/journeys/schedule.py).
 * SEGMENT_CHANGE's two "Segment" options map onto {segment_id, change: JOINED|LEFT} (Setup's Segment picker supplies
 * segment_id); its three Attribute Change options are stored as {change_trigger} and enrol on that attribute's change
 * event (apps/journeys/events.py ATTRIBUTE_EVENTS: LOYALTY_TIER_CHANGE, PREFERENCE_UPDATE, ADDRESS_CHANGE).
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
  if ((rule.entry_type === 'SEGMENT_CHANGE' || rule.entry_type === 'DATE_TIME') && definition.segment_id) {
    return ('reference_name' in rule ? rule.reference_name : definition.segment_name) || 'Unknown segment'
  }
  if (rule.entry_type === 'DATE_TIME' && definition.contact_list_id) {
    return ('reference_name' in rule ? rule.reference_name : definition.contact_list_name) || 'Unknown list'
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

// ---------------------------------------------------------------- Date / Time (apps/journeys/schedule.py reads the same shape)

export interface AudienceRef {
  kind: 'LIST' | 'SEGMENT'
  id: string
  name: string | null
}

/** Setup's Date / Time fields; time is "HH:MM" in the workspace's time zone, offsetDays < 0 means before the date. */
export interface DateTimeChoice {
  time: string
  weekdays: string[]
  dayOfMonth: string
  date: string
  attribute: string
  offsetDays: number
  yearly: boolean
  audience: AudienceRef | null
}

export const WEEKDAYS: { value: string; short: string; long: string }[] = [
  { value: 'MON', short: 'Mon', long: 'Monday' }, { value: 'TUE', short: 'Tue', long: 'Tuesday' }, { value: 'WED', short: 'Wed', long: 'Wednesday' },
  { value: 'THU', short: 'Thu', long: 'Thursday' }, { value: 'FRI', short: 'Fri', long: 'Friday' }, { value: 'SAT', short: 'Sat', long: 'Saturday' },
  { value: 'SUN', short: 'Sun', long: 'Sunday' },
]

export function emptyDateTime(): DateTimeChoice {
  return { time: '09:00', weekdays: [], dayOfMonth: '1', date: '', attribute: '', offsetDays: 0, yearly: true, audience: null }
}

export function dateTimeFromRule(rule: JourneyEntryRule | undefined): DateTimeChoice {
  const empty = emptyDateTime()
  if (!rule || rule.entry_type !== 'DATE_TIME') return empty
  const d = rule.rule_definition as Record<string, unknown>
  const named = referenceLabel(rule)
  const audience: AudienceRef | null = d.contact_list_id ? { kind: 'LIST', id: String(d.contact_list_id), name: named }
    : d.segment_id ? { kind: 'SEGMENT', id: String(d.segment_id), name: named } : null
  return {
    time: typeof d.time === 'string' ? d.time : empty.time,
    weekdays: Array.isArray(d.weekdays) ? d.weekdays.map(String) : [],
    dayOfMonth: d.day_of_month !== undefined && d.day_of_month !== null ? String(d.day_of_month) : empty.dayOfMonth,
    date: typeof d.date === 'string' ? d.date : '',
    attribute: typeof d.attribute === 'string' ? d.attribute : '',
    offsetDays: Number(d.offset_days ?? 0) || 0,
    yearly: d.yearly !== false,
    audience,
  }
}

export function dateTimeDefinition(schedule: string, choice: DateTimeChoice): Record<string, unknown> {
  const definition: Record<string, unknown> = { schedule, time: choice.time }
  if (schedule === 'WEEKLY') definition.weekdays = WEEKDAYS.map((day) => day.value).filter((day) => choice.weekdays.includes(day))
  if (schedule === 'MONTHLY') definition.day_of_month = choice.dayOfMonth === 'LAST' ? 'LAST' : Number(choice.dayOfMonth)
  if (schedule === 'SPECIFIC_DATE') definition.date = choice.date
  if (schedule === 'DATE_ATTRIBUTE') Object.assign(definition, { attribute: choice.attribute, offset_days: choice.offsetDays, yearly: choice.yearly })
  if (choice.audience?.kind === 'LIST') Object.assign(definition, { contact_list_id: choice.audience.id, contact_list_name: choice.audience.name ?? undefined })
  if (choice.audience?.kind === 'SEGMENT') Object.assign(definition, { segment_id: choice.audience.id, segment_name: choice.audience.name ?? undefined })
  return definition
}

/** What the rule still needs (schedule.problem), or null. */
export function dateTimeProblem(schedule: string, choice: DateTimeChoice): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(choice.time)) return 'Choose a time.'
  if (schedule === 'WEEKLY' && choice.weekdays.length === 0) return 'Choose at least one weekday.'
  if (schedule === 'SPECIFIC_DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(choice.date)) return 'Choose the date.'
  if (schedule === 'DATE_ATTRIBUTE') return choice.attribute ? null : 'Choose which date on the customer’s record.'
  return choice.audience ? null : 'Choose who enters: a customer list or a segment.'
}

export function clockText(time: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return 'a time not chosen yet'
  const hours = Number(match[1])
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? 'AM' : 'PM'}`
}

export function attributeLabel(key: string): string {
  return key.replace(/_/g, ' ').trim().split(/\s+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

/** "Every Monday at 9:00 AM" and "the members of VIP Customers": schedule.describe's two halves. */
export function describeSchedule(definition: Record<string, unknown>, audienceName: string | null): { when: string; who: string } {
  const schedule = String(definition.schedule ?? '').toUpperCase()
  const clock = clockText(String(definition.time ?? ''))
  let when: string
  if (schedule === 'DAILY') {
    when = `Every day at ${clock}`
  } else if (schedule === 'WEEKLY') {
    const chosen = Array.isArray(definition.weekdays) ? definition.weekdays.map(String) : []
    const names = WEEKDAYS.filter((day) => chosen.includes(day.value)).map((day) => day.long)
    const days = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'a day not chosen yet'
    when = `Every ${days} at ${clock}`
  } else if (schedule === 'MONTHLY') {
    when = definition.day_of_month === 'LAST' ? `On the last day of every month at ${clock}` : `On day ${String(definition.day_of_month ?? '?')} of every month at ${clock}`
  } else if (schedule === 'SPECIFIC_DATE') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(definition.date ?? ''))
    const text = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'a date not chosen yet'
    when = `On ${text} at ${clock}`
  } else if (schedule === 'DATE_ATTRIBUTE') {
    const offset = Number(definition.offset_days ?? 0) || 0
    const relation = offset === 0 ? 'on' : `${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} ${offset < 0 ? 'before' : 'after'}`
    const text = `${relation} each customer’s ${attributeLabel(String(definition.attribute ?? '')) || 'date'}, at ${clock}`
    when = definition.yearly === false ? text.charAt(0).toUpperCase() + text.slice(1) : `Every year, ${text}`
  } else {
    return { when: 'On a schedule', who: 'customers' }
  }
  const who = definition.contact_list_id ? `the members of ${audienceName ?? 'a customer list'}`
    : definition.segment_id ? `customers in ${audienceName ?? 'a segment'}`
    : 'every customer with that date'
  return { when, who }
}
