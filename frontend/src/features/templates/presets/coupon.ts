import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

/** A personal gift, not a sale: no countdown, no "everyone", no ends-tonight. Flash sale and Last call do urgency. */
const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('A gift for you')}
        ${heading('This one is just for you, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">Here is {{discount_pct}}% off, from us to you. It is not a sale and it is not for everyone: it is a thank-you for being one of ours.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-column background-color="${EMAIL.canvas}" border-radius="8px" padding="28px 24px">
        ${eyebrow('Your personal code', { color: EMAIL.muted, align: 'center', padding: '0 0 8px' })}
        <mj-text align="center" font-size="30px" line-height="36px" font-weight="700" letter-spacing="5px" color="${EMAIL.ink}" padding="0 0 8px">{{offer_code}}</mj-text>
        <mj-text align="center" font-size="15px" line-height="24px" padding="0">{{discount_pct}}% off your next order, in store or online.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="left">Use my coupon</mj-button>
      </mj-column>
    </mj-section>`

export const coupon: PresetDefinition = {
  key: 'coupon',
  name: 'Personal coupon',
  channel: 'EMAIL',
  category: 'Coupon',
  description: 'A personal discount code, framed as a gift rather than a sale.',
  content: { kind: 'design', subject_line: '{{first_name}}, a little something for you', preheader: '{{discount_pct}}% off, just for you.', mjml: emailDocument(BODY) },
}
