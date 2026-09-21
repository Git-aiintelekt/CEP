import { BRAND, BUTTON_RADIUS } from './brand'
import type { CepBlock } from './types'

/** href is empty on purpose: the Links pill flags it until a destination is set. */
export const button: CepBlock = {
  id: 'button',
  label: 'Button',
  category: 'content',
  icon: 'MousePointerClick',
  mjml: `<mj-button href="" background-color="${BRAND.action}" border-radius="${BUTTON_RADIUS}" font-weight="700" align="left">Button</mj-button>`,
}
