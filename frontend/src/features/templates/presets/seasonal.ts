import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

/** Fall, with no year or dates in it, so it can run again next season. */
const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('The fall edit')}
        ${heading('Fall is here, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">Warm layers, richer colours and everything you need for cooler days and longer nights, all in one place.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-column background-color="${EMAIL.canvas}" border-radius="8px" padding="28px 24px">
        ${eyebrow('This week only', { color: EMAIL.muted, padding: '0 0 8px' })}
        <mj-text font-size="26px" line-height="32px" font-weight="700" letter-spacing="-0.3px" color="${EMAIL.ink}" padding="0 0 8px">{{discount_pct}}% off the fall edit</mj-text>
        <mj-text font-size="15px" line-height="24px" padding="0">Use code <strong style="color:${EMAIL.ink};letter-spacing:1px">{{offer_code}}</strong> online or in store.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="left">Shop the fall edit</mj-button>
      </mj-column>
    </mj-section>`

export const seasonal: PresetDefinition = {
  key: 'seasonal',
  name: 'Seasonal campaign',
  channel: 'EMAIL',
  category: 'Promotion',
  description: 'A fall campaign with a seasonal offer. Swap the season to reuse it all year.',
  content: { kind: 'design', subject_line: 'The fall edit is here, {{first_name}}', preheader: '{{discount_pct}}% off this week only.', mjml: emailDocument(BODY) },
}
