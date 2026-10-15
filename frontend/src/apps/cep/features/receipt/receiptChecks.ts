/** What Preview & Test checks before a receipt goes out. Each rule reads the real input; none is a fixed answer. */
import { hasReceiptFooter } from '@/apps/cep/features/designer/blocks/receiptBlocks'
import { FOOTER_CLASS } from '@/apps/cep/features/designer/blocks/register'
import type { PersonalizationTag, ReceiptSection } from '@/lib/types'

import type { SampleTransaction } from './sampleReceiptData'

export interface ReceiptCheck {
  id: string
  title: string
  detail: string
  status: 'pass' | 'fail'
}

export interface ReceiptCheckInput {
  transaction: SampleTransaction
  sections: ReceiptSection[]
  /** whether the outer design carries a footer, which is where the postal address lives */
  hasFooterBlock: boolean
  tags: PersonalizationTag[]
}

export interface ReceiptCheckSummary {
  total: number
  failing: number
}

const pass = (id: string, title: string, detail: string): ReceiptCheck => ({ id, title, detail, status: 'pass' })
const fail = (id: string, title: string, detail: string): ReceiptCheck => ({ id, title, detail, status: 'fail' })

export function requiredFieldsCheck(transaction: SampleTransaction): ReceiptCheck {
  const title = 'Required receipt fields resolve'
  const missing = [
    !transaction.order_number?.trim() && 'order number',
    !(transaction.line_items?.length > 0) && 'line items',
    !Number.isFinite(transaction.total) && 'total',
  ].filter((item): item is string => typeof item === 'string')
  return missing.length === 0 ?
      pass('required-fields', title, 'Order number, line items and total all resolve.')
    : fail('required-fields', title, `Missing from this transaction: ${missing.join(', ')}.`)
}

/** Read off the data, not the UI: a locked Totals is normally on, but a stored layout is checked as it is. */
export function complianceSectionsCheck(sections: ReceiptSection[]): ReceiptCheck {
  const title = 'Compliance sections present'
  const off = sections.filter((section) => (section.key === 'totals' || section.key === 'payment') && !section.visible)
  const absent = ['totals', 'payment'].filter((key) => !sections.some((section) => section.key === key))
  return off.length === 0 && absent.length === 0 ?
      pass('compliance-sections', title, 'Totals and Payment are both on the receipt.')
    : fail('compliance-sections', title, 'Tax authorities in some regions require both on a receipt.')
}

/**
 * Whether the outer design has a footer, read off its MJML: the workspace holds the design as a string, not as the
 * canvas's component tree. Either footer counts; both carry the postal address.
 */
export function designHasFooter(mjml: string): boolean {
  return hasReceiptFooter(mjml) || new RegExp(`css-class="[^"]*\\b${FOOTER_CLASS}\\b`).test(mjml)
}

export function senderAddressCheck(hasFooterBlock: boolean): ReceiptCheck {
  const title = 'Sender address present'
  return hasFooterBlock ?
      pass('sender-address', title, 'The footer carries the postal address.')
    : fail('sender-address', title, 'Transactional mail must carry a postal address — add a Footer block.')
}

export function personalizationFallbackCheck(tags: PersonalizationTag[]): ReceiptCheck {
  const title = 'Personalization has a fallback'
  const firstName = tags.find((tag) => tag.tag_key === 'first_name')
  const fallback = firstName?.default_value?.trim()
  if (!firstName) return fail('personalization-fallback', title, 'There is no FIRST NAME tag in this workspace to fall back from.')
  return fallback ?
      pass('personalization-fallback', title, `FIRST NAME falls back to "${fallback}"`)
    : fail('personalization-fallback', title, 'FIRST NAME has no fallback, so a customer without one sees a gap.')
}

/** Structural: a receipt is transactional mail, which suppression lists and unsubscribe links never apply to. */
export function noUnsubscribeCheck(): ReceiptCheck {
  return pass('no-unsubscribe', 'No unsubscribe needed', 'Transactional class; suppression lists do not apply.')
}

export function computeReceiptChecks({ transaction, sections, hasFooterBlock, tags }: ReceiptCheckInput): ReceiptCheck[] {
  return [
    requiredFieldsCheck(transaction),
    complianceSectionsCheck(sections),
    senderAddressCheck(hasFooterBlock),
    personalizationFallbackCheck(tags),
    noUnsubscribeCheck(),
  ]
}

export function summarizeChecks(checks: ReceiptCheck[]): ReceiptCheckSummary {
  return { total: checks.length, failing: checks.filter((check) => check.status === 'fail').length }
}
