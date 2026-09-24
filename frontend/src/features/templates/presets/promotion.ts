import { EMAIL, emailDocument, eyebrow } from './emailStyle'
import type { PresetDefinition } from './types'

const BODY = `    <mj-section background-color="${EMAIL.ink}" padding="56px 40px">
      <mj-column>
        ${eyebrow('Members only &#183; This weekend', { color: EMAIL.onInkMuted, align: 'center' })}
        <mj-text align="center" font-size="60px" line-height="64px" font-weight="700" letter-spacing="-1.5px" color="#ffffff" padding="0 0 12px">{{discount_pct}}% off</mj-text>
        <mj-text align="center" font-size="18px" line-height="28px" color="${EMAIL.onInk}" padding="0">Everything, in store and online, through Sunday night.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="40px 40px 8px">
      <mj-column>
        <mj-text>Hi {{first_name}}, your personal code takes {{discount_pct}}% off your whole order. Enter it at checkout, or show this email in store.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-column border="1px dashed ${EMAIL.ink}" border-radius="8px" padding="20px 0">
        ${eyebrow('Your code', { color: EMAIL.muted, align: 'center', padding: '0 0 6px' })}
        <mj-text align="center" font-size="30px" line-height="36px" font-weight="700" letter-spacing="5px" color="${EMAIL.ink}" padding="0">{{offer_code}}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="center">Shop the sale</mj-button>
        <mj-text align="center" font-size="13px" line-height="20px" color="${EMAIL.muted}" padding="16px 0 0">One use per member. Ends Sunday at midnight. Cannot be combined with other offers.</mj-text>
      </mj-column>
    </mj-section>`

export const promotion: PresetDefinition = {
  key: 'promotion',
  name: 'Announce a sale',
  channel: 'EMAIL',
  category: 'Promotion',
  description: 'A time-limited offer with a personal discount code.',
  content: { kind: 'design', subject_line: '{{first_name}}, {{discount_pct}}% off this weekend only', preheader: 'Your personal code is inside.', mjml: emailDocument(BODY) },
}
