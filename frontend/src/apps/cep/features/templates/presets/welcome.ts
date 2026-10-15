import { EMAIL, emailDocument, eyebrow, heading } from './emailStyle'
import type { PresetDefinition } from './types'

function benefit(number: string, title: string, text: string): string {
  return `    <mj-section background-color="${EMAIL.surface}" padding="0 40px">
      <mj-group>
        <mj-column width="14%">
          <mj-text font-size="15px" line-height="24px" font-weight="700" color="${EMAIL.accent}" padding="14px 0">${number}</mj-text>
        </mj-column>
        <mj-column width="86%">
          <mj-text font-size="17px" line-height="24px" font-weight="700" color="${EMAIL.ink}" padding="14px 0 2px">${title}</mj-text>
          <mj-text font-size="15px" line-height="24px" padding="0 0 14px">${text}</mj-text>
        </mj-column>
      </mj-group>
    </mj-section>`
}

const BODY = `    <mj-section background-color="${EMAIL.surface}" padding="48px 40px 8px">
      <mj-column>
        ${eyebrow('Membership confirmed')}
        ${heading('Welcome, {{first_name}}.')}
        <mj-text font-size="17px" line-height="28px">You are in. From today, every visit earns you more, in store and online.</mj-text>
        <mj-button href="{{shop_url}}" align="left" padding="24px 0 8px">Start shopping</mj-button>
        <mj-divider padding="32px 0 16px" />
        ${eyebrow('What membership gets you', { color: EMAIL.muted, padding: '0 0 4px' })}
      </mj-column>
    </mj-section>
${benefit('01', 'Member pricing', 'Lower prices on new arrivals, every season.')}
${benefit('02', 'Points on every purchase', 'In store and online, ready to spend on anything.')}
${benefit('03', 'Early access', 'Shop our sales a day before anyone else.')}
    <mj-section background-color="${EMAIL.surface}" padding="0 40px 32px">
      <mj-column>
        <mj-spacer height="8px" />
      </mj-column>
    </mj-section>`

export const welcome: PresetDefinition = {
  key: 'welcome',
  name: 'Welcome a new member',
  channel: 'EMAIL',
  category: 'Onboarding',
  description: 'Greets a new member and sets out the benefits of joining.',
  content: { kind: 'design', subject_line: 'Welcome to Your Brand, {{first_name}}', preheader: 'Here is what membership gets you.', mjml: emailDocument(BODY) },
}
