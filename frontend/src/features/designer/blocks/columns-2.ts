import { BRAND } from './brand'
import type { CepBlock } from './types'

export const columns2: CepBlock = {
  id: 'columns-2',
  label: 'Two columns',
  category: 'structure',
  icon: 'Columns2',
  mjml: `<mj-section background-color="${BRAND.surface}" padding="12px 24px">
    <mj-column>
      <mj-text font-size="15px" line-height="24px" color="${BRAND.body}">Left</mj-text>
    </mj-column>
    <mj-column>
      <mj-text font-size="15px" line-height="24px" color="${BRAND.body}">Right</mj-text>
    </mj-column>
  </mj-section>`,
}
