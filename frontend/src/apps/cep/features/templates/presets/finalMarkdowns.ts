import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('Final markdowns')}
        ${heading('Last chance, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">Our end-of-season prices have dropped for the last time. When these pieces sell out, they will not be back.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-column background-color="${EMAIL.ink}" border-radius="8px" padding="32px 24px">
        ${eyebrow('Clearance', { color: EMAIL.onInkMuted, align: 'center', padding: '0 0 8px' })}
        <mj-text align="center" font-size="44px" line-height="50px" font-weight="700" letter-spacing="-1px" color="#ffffff" padding="0 0 8px">Up to {{discount_pct}}% off</mj-text>
        <mj-text align="center" font-size="15px" line-height="24px" color="${EMAIL.onInk}" padding="0">While stock lasts. Sizes are going fast.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="24px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="left">Shop the sale</mj-button>
        <mj-text font-size="13px" line-height="20px" color="${EMAIL.muted}" padding="16px 0 0">Final sale items cannot be returned or exchanged.</mj-text>
      </mj-column>
    </mj-section>`

export const finalMarkdowns: PresetDefinition = {
  key: 'final_markdowns',
  name: 'Final markdowns',
  channel: 'EMAIL',
  category: 'Promotion',
  description: 'Clearance at up to a set discount, framed as the last chance before it sells out.',
  content: { kind: 'design', subject_line: 'Final markdowns: up to {{discount_pct}}% off', preheader: 'Last chance before it is gone for good.', mjml: emailDocument(BODY) },
}
