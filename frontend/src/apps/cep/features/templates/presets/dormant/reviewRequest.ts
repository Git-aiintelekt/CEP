import { EMAIL, emailDocument, eyebrow, heading } from '../emailStyle'
import type { PresetDefinition } from '../types'

/** One ask, one link: the review page. */
const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 16px">
      <mj-column>
        ${eyebrow('Thank you')}
        ${heading('Thanks for your order, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">We hope you love it. Now that you have had a chance to try it, would you tell us how it is going?</mj-text>
        <mj-text>Your review takes a minute. It helps other shoppers choose, and it helps us get better at what we make.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="16px 40px 48px">
      <mj-column>
        <mj-button href="{{review_url}}" align="left">Write a review</mj-button>
      </mj-column>
    </mj-section>`

export const reviewRequest: PresetDefinition = {
  key: 'review_request',
  name: 'Thank you + review request',
  channel: 'EMAIL',
  category: 'Post-purchase',
  description: 'Thanks a customer for a recent purchase and asks for a review.',
  content: { kind: 'design', subject_line: 'How is it going, {{first_name}}?', preheader: 'Thanks for your order. Tell us what you think.', mjml: emailDocument(BODY) },
}
