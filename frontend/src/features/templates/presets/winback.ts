import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('It has been a while')}
        ${heading('We miss you, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">A lot has changed since your last visit: new arrivals, easier returns and faster delivery. Come back and see.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-column background-color="${EMAIL.canvas}" border-radius="8px" padding="28px 24px">
        ${eyebrow('Welcome-back offer', { color: EMAIL.muted, padding: '0 0 8px' })}
        <mj-text font-size="26px" line-height="32px" font-weight="700" letter-spacing="-0.3px" color="${EMAIL.ink}" padding="0 0 8px">{{discount_pct}}% off your next order</mj-text>
        <mj-text font-size="15px" line-height="24px" padding="0">Use code <strong style="color:${EMAIL.ink};letter-spacing:1px">{{offer_code}}</strong> at checkout any time this month.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="left">See what is new</mj-button>
        <mj-text font-size="13px" line-height="20px" color="${EMAIL.muted}" padding="24px 0 0">Not interested any more? No hard feelings: use the unsubscribe link below and we will stop.</mj-text>
      </mj-column>
    </mj-section>`

export const winback: PresetDefinition = {
  key: 'winback',
  name: 'Win-back offer',
  channel: 'EMAIL',
  category: 'Retention',
  description: 'Re-engages customers who have not bought for a while.',
  content: { kind: 'design', subject_line: 'We miss you, {{first_name}}', preheader: '{{discount_pct}}% off to welcome you back.', mjml: emailDocument(BODY) },
}
