/**
 * Hide on Desktop compiled by MJML: the block is hidden by default (Outlook reads that) and revealed on a phone with the
 * display MJML gave its element. This test pins which element carries the class for every block type, so an MJML upgrade
 * that moves it breaks a test here rather than an email.
 */
import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { HIDE_DESKTOP_CLASS, HIDE_DESKTOP_RULE } from './register'

const C = HIDE_DESKTOP_CLASS

test('the rule hides everywhere first and reveals on a phone with each element’s own display', () => {
  const mjml = `<mjml><mj-head><mj-style>${HIDE_DESKTOP_RULE}</mj-style></mj-head><mj-body>
    <mj-section css-class="${C}"><mj-column css-class="${C}"><mj-text css-class="${C}">Hi</mj-text><mj-image css-class="${C}" src="https://x/y.png" /><mj-button css-class="${C}" href="#">Go</mj-button><mj-divider css-class="${C}" /><mj-spacer css-class="${C}" height="10px" /><mj-social css-class="${C}"><mj-social-element name="facebook" href="#" /></mj-social></mj-column></mj-section>
    <mj-section><mj-group css-class="${C}"><mj-column><mj-text>x</mj-text></mj-column></mj-group></mj-section>
  </mj-body></mjml>`
  const { html, errors } = mjml2html(mjml)
  expect(errors).toEqual([])
  expect(html).toContain(`.${C}{display:none!important;mso-hide:all!important;}`)
  expect(html).toContain('@media only screen and (max-width:480px)')

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const carriers = [...doc.querySelectorAll(`.${C}`)].map((el) => el.tagName.toLowerCase() + (el.className.includes('mj-column-per') ? '.mj-column-per' : ''))
  // a section's div, a column's and a group's inline-block div, six cells: each has a reveal in the rule
  expect(carriers).toEqual(['div', 'div.mj-column-per', 'td', 'td', 'td', 'td', 'td', 'td', 'div.mj-column-per'])
  for (const restore of [`div.${C}{display:block!important;}`, `div.${C}[class*="mj-column-per"]{display:inline-block!important;}`, `td.${C}{display:table-cell!important;}`, `table.${C}{display:table!important;}`]) {
    expect(HIDE_DESKTOP_RULE).toContain(restore)
  }
})
