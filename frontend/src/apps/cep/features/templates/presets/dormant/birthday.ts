import { EMAIL, emailDocument, eyebrow, heading } from '../emailStyle'
import type { PresetDefinition } from '../types'

const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('Happy birthday')}
        ${heading('Happy birthday, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">{{birthday}} is circled on our calendar, so here is a small gift to help you celebrate.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-column background-color="${EMAIL.canvas}" border-radius="8px" padding="28px 24px">
        ${eyebrow('Your birthday gift', { color: EMAIL.muted, align: 'center', padding: '0 0 8px' })}
        <mj-text align="center" font-size="44px" line-height="50px" font-weight="700" letter-spacing="-1px" color="${EMAIL.ink}" padding="0 0 8px">{{discount_pct}}% off</mj-text>
        <mj-text align="center" font-size="15px" line-height="24px" padding="0">Use code <strong style="color:${EMAIL.ink};letter-spacing:1px">{{offer_code}}</strong> on anything you like this month.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="left">Treat yourself</mj-button>
      </mj-column>
    </mj-section>`

export const birthday: PresetDefinition = {
  key: 'birthday',
  name: 'Birthday gift',
  channel: 'EMAIL',
  category: 'Loyalty',
  description: 'A birthday greeting with a gift of a discount.',
  content: { kind: 'design', subject_line: 'Happy birthday, {{first_name}}', preheader: 'A gift from us: {{discount_pct}}% off.', mjml: emailDocument(BODY) },
}
