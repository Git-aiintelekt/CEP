import { BRAND, BUTTON_RADIUS } from './brand'
import type { CepBlock } from './types'

export const coupon: CepBlock = {
  id: 'coupon',
  label: 'Coupon',
  category: 'commerce',
  icon: 'Ticket',
  mjml: `<mj-section background-color="${BRAND.surface}" border="1px dashed ${BRAND.action}" border-radius="${BUTTON_RADIUS}" padding="20px 24px">
    <mj-column>
      <mj-text font-size="13px" line-height="20px" color="${BRAND.muted}" align="center" padding="0 0 4px">Use this code at checkout</mj-text>
      <mj-text font-size="22px" line-height="30px" font-weight="700" color="${BRAND.heading}" align="center" letter-spacing="2px" padding="0">SAVE00</mj-text>
    </mj-column>
  </mj-section>`,
}
