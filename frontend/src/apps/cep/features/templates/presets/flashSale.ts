import { EMAIL, emailDocument, eyebrow } from './emailStyle'
import type { PresetDefinition } from './types'

function clockCell(label: string): string {
  return `<mj-column>
          <mj-text align="center" font-size="12px" line-height="16px" font-weight="700" letter-spacing="1.5px" text-transform="uppercase" color="${EMAIL.ink}" padding="16px 0">${label}</mj-text>
        </mj-column>`
}

const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('Flash sale &#183; Today only', { align: 'center' })}
        <mj-text align="center" font-size="56px" line-height="60px" font-weight="700" letter-spacing="-1.5px" color="${EMAIL.ink}" padding="0 0 12px">{{discount_pct}}% off everything</mj-text>
        <mj-text align="center" font-size="17px" line-height="28px">A few hours, one big discount. When the clock hits midnight, it is over.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-group background-color="${EMAIL.canvas}">
        ${clockCell('Today only')}
        ${clockCell('Ends at midnight')}
        ${clockCell('Online and in store')}
      </mj-group>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="center">Shop the flash sale</mj-button>
        <mj-text align="center" font-size="13px" line-height="20px" color="${EMAIL.muted}" padding="16px 0 0">Use code {{offer_code}} at checkout. Ends at 11:59 pm today.</mj-text>
      </mj-column>
    </mj-section>`

export const flashSale: PresetDefinition = {
  key: 'flash_sale',
  name: 'Run a flash sale',
  channel: 'EMAIL',
  category: 'Promotion',
  description: 'A one-day sale with a countdown feel: one big discount that ends at midnight.',
  content: { kind: 'design', subject_line: 'Today only: {{discount_pct}}% off everything', preheader: 'Ends at midnight. No extensions.', mjml: emailDocument(BODY) },
}
