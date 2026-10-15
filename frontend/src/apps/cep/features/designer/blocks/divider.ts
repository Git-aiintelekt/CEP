import { BRAND, COLUMN_PADDING } from './brand'
import type { CepBlock } from './types'

export const divider: CepBlock = {
  id: 'divider',
  label: 'Divider',
  category: 'structure',
  icon: 'Minus',
  mjml: `<mj-divider border-width="1px" border-color="${BRAND.line}" padding="${COLUMN_PADDING}"></mj-divider>`,
}
