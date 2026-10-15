import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

/** One story, told start to finish: why the brand exists and what it stands for, with one link at the end. */
const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 8px">
      <mj-column>
        ${eyebrow('Our story')}
        ${heading('Why we started Your Brand')}
        <mj-text font-size="17px" line-height="28px">Hi {{first_name}}, we get asked this a lot, so here is the short version.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="8px 40px">
      <mj-column>
        <mj-text>We started with one simple idea: good things should be made to last, and they should not cost more than they need to. Tell your reader where that idea came from: the moment, the place, the people.</mj-text>
        <mj-text>Then tell them what you stand for today. How you choose what you make, who you make it with, and what you will never compromise on. Keep it honest and specific; one real detail beats three big claims.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="16px 40px">
      <mj-column background-color="${EMAIL.canvas}" border-radius="8px" padding="24px">
        ${eyebrow('What we stand for', { color: EMAIL.muted, padding: '0 0 8px' })}
        <mj-text font-size="22px" line-height="32px" font-weight="700" letter-spacing="-0.3px" color="${EMAIL.ink}" padding="0">Made to last, and made to be worn every day.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${EMAIL.surface}" padding="16px 40px 48px">
      <mj-column>
        <mj-text>End with where the story goes next, and invite your reader along for it.</mj-text>
        <mj-button href="{{shop_url}}" align="left" padding="24px 0 8px">Read the full story</mj-button>
      </mj-column>
    </mj-section>`

export const newsletter: PresetDefinition = {
  key: 'newsletter',
  name: 'Share your brand story',
  channel: 'EMAIL',
  category: 'Newsletter',
  description: 'One story about why your brand exists and what it stands for, with one link at the end.',
  content: { kind: 'design', subject_line: 'The story behind Your Brand', preheader: 'Why we exist, and what we stand for.', mjml: emailDocument(BODY) },
}
