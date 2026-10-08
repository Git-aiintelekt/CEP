/** Node type metadata for the Add-a-step picker, the step cards and the step panel: label, icon, category (with the
 * category colours approved for the Journey canvas only), and what the picker and the card say about each type. */
import { Clock, Gift, GitBranch, ListMinus, ListPlus, LogIn, LogOut, Mail, MessageSquare, Sparkles, Split, Tags, Target, UserPen, Webhook } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { ConditionRule, JourneyNodeType } from '@/lib/types'

import { summarizeRule } from './conditions/conditionModel'
import type { EditorNode } from './graphModel'
import { summarizeExtra } from './ExtraStepFields'
import { summarizeGoal } from './GoalFields'
import { summarizeWait } from './WaitFields'
import { summarizeWebhook } from './WebhookFields'

export { WAIT_UNITS } from './WaitFields'

export type AddableType = Exclude<JourneyNodeType, 'START'>

export type CategoryKey = 'ENTRY' | 'LOGIC' | 'COMMUNICATION' | 'ACTION' | 'CONTROL'

/** Approved design-system exception, Journey canvas only: each step category has its own colour. */
export const CATEGORY: Record<CategoryKey, { label: string; tile: string; text: string; dot: string }> = {
  ENTRY: { label: 'Entry', tile: 'bg-brand-100 text-brand-700', text: 'text-brand-600', dot: 'bg-brand-600' },
  LOGIC: { label: 'Logic', tile: 'bg-plum-100 text-plum-700', text: 'text-plum-700', dot: 'bg-plum-500' },
  COMMUNICATION: { label: 'Communication', tile: 'bg-success-bg text-success-text', text: 'text-success-text', dot: 'bg-success' },
  ACTION: { label: 'Existing Business Action', tile: 'bg-warning-bg text-warning-text', text: 'text-warning-text', dot: 'bg-warning' },
  CONTROL: { label: 'Control', tile: 'bg-fill-subtle text-ink-800', text: 'text-ink-800', dot: 'bg-ink-300' },
}

export const CATEGORY_ORDER: CategoryKey[] = ['ENTRY', 'LOGIC', 'COMMUNICATION', 'ACTION', 'CONTROL']

export const ENTRY_ICON = LogIn

interface NodeMeta {
  label: string
  icon: LucideIcon
  category: CategoryKey
  /** the part after the dash in the category line: "Communication — Email" */
  kind: string
  /** what the Add-a-step picker calls it, and the line under that */
  pickerTitle: string
  pickerDescription: string
}

// SPLIT (multi-path: random / by tier / by customer type) is a real backend node type (apps/journeys/engine/steps.py),
// but deliberately not offered here: the canvas only exposes binary Condition, matching the prototype's own MVP choice
// to keep branching to one shape. Revisit only as a deliberate scope decision, not a bug to "complete".
export const NODE_META: Record<AddableType, NodeMeta> = {
  WAIT: { label: 'Wait', icon: Clock, category: 'LOGIC', kind: 'Wait', pickerTitle: 'Wait', pickerDescription: 'Pause for a duration, until a time of day, or until a date on the record' },
  CONDITION: { label: 'Condition', icon: GitBranch, category: 'LOGIC', kind: 'Condition', pickerTitle: 'Condition / Split', pickerDescription: 'Branch the flow based on a rule' },
  SPLIT: { label: 'Split', icon: Split, category: 'LOGIC', kind: 'Split', pickerTitle: 'Split', pickerDescription: 'Several paths: by an attribute’s value, or at random' },
  EMAIL: { label: 'Send Email', icon: Mail, category: 'COMMUNICATION', kind: 'Email', pickerTitle: 'Email', pickerDescription: 'Send via Mailer Master → Postal' },
  SMS: { label: 'Send SMS', icon: MessageSquare, category: 'COMMUNICATION', kind: 'SMS/MMS', pickerTitle: 'SMS / MMS', pickerDescription: 'Send via SMS Master → Digivize' },
  MMS: { label: 'Send MMS', icon: MessageSquare, category: 'COMMUNICATION', kind: 'SMS/MMS', pickerTitle: 'SMS / MMS', pickerDescription: 'Send via SMS Master → Digivize' },
  COUPON_ISSUE: { label: 'Issue Coupon', icon: Gift, category: 'ACTION', kind: 'Coupon', pickerTitle: 'Issue Coupon', pickerDescription: 'Invokes the existing Coupon service' },
  LOYALTY_CHANGE: { label: 'Update Loyalty Tier', icon: Sparkles, category: 'ACTION', kind: 'Loyalty', pickerTitle: 'Update Loyalty Tier', pickerDescription: 'Invokes the existing Loyalty service' },
  SEGMENT_UPDATE: { label: 'Update Segment', icon: Tags, category: 'ACTION', kind: 'Segment', pickerTitle: 'Update Segment', pickerDescription: 'Invokes the existing Segmentation service' },
  PROFILE_UPDATE: { label: 'Update Profile', icon: UserPen, category: 'ACTION', kind: 'Profile', pickerTitle: 'Update Profile', pickerDescription: 'Sets any attribute on the customer’s record' },
  LIST_ADD: { label: 'Add to List', icon: ListPlus, category: 'ACTION', kind: 'List', pickerTitle: 'Add to List', pickerDescription: 'Adds the customer to a contact list' },
  LIST_REMOVE: { label: 'Remove from List', icon: ListMinus, category: 'ACTION', kind: 'List', pickerTitle: 'Remove from List', pickerDescription: 'Takes the customer off a contact list' },
  WEBHOOK: { label: 'Webhook', icon: Webhook, category: 'ACTION', kind: 'Webhook', pickerTitle: 'Webhook', pickerDescription: 'A signed POST with the customer and journey context' },
  GOAL: { label: 'Goal', icon: Target, category: 'CONTROL', kind: 'Goal', pickerTitle: 'Goal', pickerDescription: 'The outcome this journey is for: an event within a window' },
  EXIT: { label: 'Exit Journey', icon: LogOut, category: 'CONTROL', kind: 'Exit', pickerTitle: 'Exit Journey', pickerDescription: 'Ends this path for the customer' },
}

/** "Communication — Email": the card shows it uppercase (approved exception), the step panel in this case. */
export function categoryLine(type: AddableType): string {
  const meta = NODE_META[type]
  return `${CATEGORY[meta.category].label} — ${meta.kind}`
}

export interface NodeGroup {
  key: CategoryKey
  types: AddableType[]
}

/** The four groups of the Add-a-step picker. One "SMS / MMS" row creates an SMS step. */
export const NODE_GROUPS: NodeGroup[] = [
  { key: 'LOGIC', types: ['WAIT', 'CONDITION', 'SPLIT'] },
  { key: 'COMMUNICATION', types: ['EMAIL', 'SMS'] },
  { key: 'ACTION', types: ['COUPON_ISSUE', 'LOYALTY_CHANGE', 'PROFILE_UPDATE', 'SEGMENT_UPDATE', 'LIST_ADD', 'LIST_REMOVE', 'WEBHOOK'] },
  { key: 'CONTROL', types: ['GOAL', 'EXIT'] },
]

export const CHECK_OPTIONS = [
  { value: 'PURCHASED', label: 'Made a Purchase' },
  { value: 'OPENED', label: 'Opened an Email' },
  { value: 'CLICKED', label: 'Clicked a Link' },
  { value: 'REDEEMED', label: 'Redeemed a Coupon' },
  { value: 'EVENT', label: 'A Specific Event Happened' },
  { value: 'IN_SEGMENT', label: 'Is in a Segment' },
]


/** One line summarising a node's config: the card's title. */
export function summarize(type: JourneyNodeType, config: Record<string, unknown>): string {
  switch (type) {
    case 'WAIT':
      return summarizeWait(config)
    case 'CONDITION': {
      if (config.rule && typeof config.rule === 'object') return summarizeRule(config.rule as ConditionRule, undefined, [])
      if (!config.check) return 'No condition set'
      const label = CHECK_OPTIONS.find((item) => item.value === config.check)?.label ?? String(config.check)
      return config.days ? `${label}, within ${config.days} days` : label
    }
    case 'EMAIL':
    case 'SMS':
    case 'MMS':
      return config.template_name ? `Send: ${config.template_name}` : 'No template chosen'
    case 'COUPON_ISSUE':
      return config.coupon_name ? `Coupon: ${config.coupon_name}` : 'No coupon chosen'
    case 'LOYALTY_CHANGE':
      return config.tier_name ? `Tier: ${config.tier_name}` : 'No tier chosen'
    case 'SEGMENT_UPDATE':
      return config.segment_name ? `${config.action === 'REMOVE' ? 'Remove from' : 'Add to'} ${config.segment_name}` : 'No segment chosen'
    case 'GOAL':
      return summarizeGoal(config)
    case 'SPLIT':
    case 'PROFILE_UPDATE':
    case 'LIST_ADD':
    case 'LIST_REMOVE':
      return summarizeExtra(type, config)
    case 'WEBHOOK':
      return summarizeWebhook(config)
    case 'EXIT':
      return 'Exit Journey'
    default:
      return ''
  }
}

const DESCRIPTION: Partial<Record<JourneyNodeType, string>> = {
  WAIT: 'Pause for a duration, until a time of day, or until a date on the record.',
  CONDITION: 'Branch the flow based on a rule',
  EMAIL: 'Mailer Master · Postal',
  SMS: 'SMS Master · Digivize',
  MMS: 'SMS Master · Digivize',
  COUPON_ISSUE: 'Invokes the existing Coupon service',
  LOYALTY_CHANGE: 'Invokes the existing Loyalty service',
  SEGMENT_UPDATE: 'Invokes the existing Segmentation service',
  GOAL: 'Converted when the event arrives within the window',
  SPLIT: 'Each customer takes one path',
  PROFILE_UPDATE: 'Sets an attribute on the record',
  LIST_ADD: 'Adds the customer to a contact list',
  LIST_REMOVE: 'Takes the customer off a contact list',
  WEBHOOK: 'A signed POST to your endpoint',
  EXIT: 'Ends this path for the customer',
}

/** A step's own name, when it has one: starters name their steps ("Cart reminder"). */
export function stepLabel(config: Record<string, unknown>): string | null {
  return typeof config.label === 'string' && config.label.trim() !== '' ? config.label.trim() : null
}

/** The card's title and the grey line under it. A named step shows its name, with what it does under it. */
export function describeStep(node: EditorNode): { title: string; description: string } {
  const label = stepLabel(node.config)
  if (label) return { title: label, description: summarize(node.type, node.config) }
  return { title: summarize(node.type, node.config), description: DESCRIPTION[node.type] ?? '' }
}

/** An Email step with a template chosen shows a preview box under its text, which makes its card taller. */
export function hasEmailPreview(node: EditorNode): boolean {
  return node.type === 'EMAIL' && Boolean(node.config.template_id)
}
