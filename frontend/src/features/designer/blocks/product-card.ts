import { ASSET_IMAGE_TOKEN, BRAND, BUTTON_RADIUS } from './brand'
import type { CepBlock } from './types'

export const productCard: CepBlock = {
  id: 'product-card',
  label: 'Product card',
  category: 'commerce',
  icon: 'ShoppingBag',
  mjml: `<mj-section background-color="${BRAND.surface}" padding="16px 24px">
    <mj-column>
      <mj-image src="${ASSET_IMAGE_TOKEN}" alt="" padding="0 0 12px"></mj-image>
      <mj-text font-size="18px" line-height="26px" font-weight="700" color="${BRAND.heading}" padding="0 0 4px">Product name</mj-text>
      <mj-text font-size="15px" line-height="24px" color="${BRAND.body}" padding="0 0 12px">0.00</mj-text>
      <mj-button href="" background-color="${BRAND.action}" border-radius="${BUTTON_RADIUS}" font-weight="700" align="left">Buy now</mj-button>
    </mj-column>
  </mj-section>`,
}
