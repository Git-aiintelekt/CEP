import { BRAND } from './brand'
import type { CepBlock } from './types'

export const columns3: CepBlock = {
  id: 'columns-3',
  label: 'Three Columns',
  category: 'structure',
  icon: 'Columns3',
  mjml: `<mj-section background-color="${BRAND.surface}" padding="12px 24px">
    <mj-column>
      <mj-text font-size="15px" line-height="24px" color="${BRAND.body}">One</mj-text>
    </mj-column>
    <mj-column>
      <mj-text font-size="15px" line-height="24px" color="${BRAND.body}">Two</mj-text>
    </mj-column>
    <mj-column>
      <mj-text font-size="15px" line-height="24px" color="${BRAND.body}">Three</mj-text>
    </mj-column>
  </mj-section>`,
}
