import { RECEIPT_BLOCKS } from '@/features/designer/blocks/receiptBlocks'
import { RECEIPT_SLOT_MJML } from '@/features/designer/blocks/receiptSlot'

const block = (id: string) => RECEIPT_BLOCKS.find((item) => item.id === id)?.mjml ?? ''
const indented = (mjml: string) => mjml.replace(/\n/g, '\n    ')

/** What a new E-Receipt opens with, built from the receipt's own blocks: the receipt slot sits after the greeting. */
export const RECEIPT_STARTER_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#334155" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f6f7fb">
    ${indented(block('receipt-brand-header'))}
    ${indented(block('receipt-marketing').replace('Your next favorite is waiting', 'Thanks, {{first_name}}!').replace(/Members earn points[^<]*/, 'Here is your receipt for order {{order_number}}.'))}
    ${indented(RECEIPT_SLOT_MJML)}
    ${indented(block('receipt-button'))}
    ${indented(block('receipt-footer'))}
  </mj-body>
</mjml>`
