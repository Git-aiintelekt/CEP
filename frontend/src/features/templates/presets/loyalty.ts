import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

/**
 * One of the two figures side by side. The gap between them is a white border: the designer's canvas does not draw a
 * column's inner-background-color, but it does draw its background and border.
 */
function stat(label: string, value: string, side: 'left' | 'right'): string {
  return `<mj-column width="50%" background-color="${EMAIL.canvas}" border-radius="8px" ${side === 'left' ? 'border-right' : 'border-left'}="6px solid ${EMAIL.surface}">
          ${eyebrow(label, { color: EMAIL.muted, padding: '24px 20px 6px' })}
          <mj-text font-size="30px" line-height="36px" font-weight="700" letter-spacing="-0.5px" color="${EMAIL.ink}" padding="0 20px 24px">${value}</mj-text>
        </mj-column>`
}

const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('Your member statement')}
        ${heading('{{first_name}}, you have points to spend.')}
        <mj-text font-size="17px" line-height="28px">Here is where you stand today.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-group>
        ${stat('Points balance', '{{loyalty_points}}', 'left')}
        ${stat('Member tier', '{{loyalty_tier}}', 'right')}
      </mj-group>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-text>Your points work on anything, in store and online. Your <strong>{{loyalty_tier}}</strong> benefits are active too, so every purchase keeps adding up.</mj-text>
        <mj-button href="{{shop_url}}" align="left" padding="24px 0 8px">Use my points</mj-button>
      </mj-column>
    </mj-section>`

export const loyalty: PresetDefinition = {
  key: 'loyalty',
  name: 'Loyalty statement',
  channel: 'EMAIL',
  category: 'Loyalty',
  description: 'Points balance and tier, with a nudge to redeem.',
  content: { kind: 'design', subject_line: '{{first_name}}, you have {{loyalty_points}} points to use', preheader: 'Your {{loyalty_tier}} benefits are active.', mjml: emailDocument(BODY) },
}
