import { BRAND } from './brand'
import type { CepBlock } from './types'

export const columns1: CepBlock = {
  id: 'columns-1',
  label: 'One column',
  category: 'structure',
  icon: 'RectangleHorizontal',
  mjml: `<mj-section background-color="${BRAND.surface}" padding="12px 24px">
    <mj-column>
      <mj-text font-size="15px" line-height="24px" color="${BRAND.body}">Text</mj-text>
    </mj-column>
  </mj-section>`,
}
