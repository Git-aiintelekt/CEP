import { BRAND } from './brand'
import type { CepBlock } from './types'

export const heading: CepBlock = {
  id: 'heading',
  label: 'Heading',
  category: 'content',
  icon: 'Heading',
  mjml: `<mj-text font-size="24px" line-height="32px" font-weight="700" color="${BRAND.heading}">Heading</mj-text>`,
}
