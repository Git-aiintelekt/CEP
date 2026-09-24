import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

/** The hairline is a divider, not a column border: the designer's canvas draws dividers but not column borders. */
function arrival(title: string, text: string): string {
  return `    <mj-section background-color="${EMAIL.surface}" padding="0 40px">
      <mj-column>
        <mj-divider padding="0" />
        <mj-text font-size="17px" line-height="24px" font-weight="700" color="${EMAIL.ink}" padding="16px 0 2px">${title}</mj-text>
        <mj-text font-size="15px" line-height="24px" padding="0 0 16px">${text}</mj-text>
      </mj-column>
    </mj-section>`
}

const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 24px">
      <mj-column>
        ${eyebrow('Just landed')}
        ${heading('New arrivals are in, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">Fresh in this week and on the shelves now. Be the first to see what is new.</mj-text>
      </mj-column>
    </mj-section>
${arrival('New season colours', 'The shades everyone will be wearing, in our best-selling shapes.')}
${arrival('Everyday essentials, refreshed', 'The pieces you reach for most, updated for this season.')}
${arrival('Made in small batches', 'Limited runs we only made a few of. When they are gone, they are gone.')}
    <mj-section background-color="${EMAIL.surface}" padding="16px 40px 48px">
      <mj-column>
        <mj-button href="{{shop_url}}" align="left">Browse new arrivals</mj-button>
      </mj-column>
    </mj-section>`

export const newArrivals: PresetDefinition = {
  key: 'new_arrivals',
  name: 'Introduce new arrivals',
  channel: 'EMAIL',
  category: 'Promotion',
  description: 'A just-landed announcement for new products, with no discount code.',
  content: { kind: 'design', subject_line: 'Just landed, {{first_name}}', preheader: 'New arrivals, on the shelves now.', mjml: emailDocument(BODY) },
}
