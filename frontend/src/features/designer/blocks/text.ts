import { BRAND } from './brand'
import type { CepBlock } from './types'

export const text: CepBlock = {
  id: 'text',
  label: 'Text',
  category: 'content',
  icon: 'Type',
  mjml: `<mj-text font-size="15px" line-height="24px" color="${BRAND.body}">Write your message here.</mj-text>`,
}
