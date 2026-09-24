import { RECEIPT_BLOCKS } from '@/features/designer/blocks/receiptBlocks'
import { RECEIPT_SLOT_MJML } from '@/features/designer/blocks/receiptSlot'

const block = (id: string) => RECEIPT_BLOCKS.find((item) => item.id === id)?.mjml ?? ''
const indented = (mjml: string) => mjml.replace(/\n/g, '\n    ')

/**
 * An E-Receipt's outer design, built from the receipt's own blocks, with the receipt slot after the greeting.
 * The greeting is the Marketing block's headline and body; everything else is the blocks as they come.
 */
export function receiptOuterMjml({ headline, body }: { headline: string; body: string }): string {
  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#334155" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f6f7fb">
    ${indented(block('receipt-brand-header'))}
    ${indented(block('receipt-marketing').replace('Your next favorite is waiting', headline).replace(/Members earn points[^<]*/, body))}
    ${indented(RECEIPT_SLOT_MJML)}
    ${indented(block('receipt-button'))}
    ${indented(block('receipt-footer'))}
  </mj-body>
</mjml>`
}

/** What a new E-Receipt opens with. */
export const RECEIPT_STARTER_MJML = receiptOuterMjml({ headline: 'Thanks, {{first_name}}!', body: 'Here is your receipt for order {{order_number}}.' })
