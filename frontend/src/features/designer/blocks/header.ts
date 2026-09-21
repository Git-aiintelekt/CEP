import { BRAND } from './brand'
import type { CepBlock } from './types'

/** Text only: a brand name the designer types over. An image belongs in the Image block, from the library. */
export const header: CepBlock = {
  id: 'header',
  label: 'Header',
  category: 'brand',
  icon: 'PanelTop',
  mjml: `<mj-section background-color="${BRAND.surface}" padding="24px 24px 16px">
    <mj-column>
      <mj-text font-size="20px" font-weight="700" color="${BRAND.heading}" letter-spacing="0.5px" padding="0">YOUR BRAND</mj-text>
    </mj-column>
  </mj-section>`,
}
