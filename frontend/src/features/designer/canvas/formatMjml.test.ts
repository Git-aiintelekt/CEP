// mjml-browser is the compiler behind the editor's preview and checks: the formatter is safe only if it compiles
// every design to exactly the HTML the unformatted code compiles to.
import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { HIDE_MOBILE_RULE } from '../blocks/register'
import { CEP_BLOCKS, needsImage, withImage } from '../blocks/registry'
import { STARTER_MJML } from '../starter'
import { formatMjml } from './formatMjml'

/** How the editor hands the MJML over: one line, no whitespace between elements. */
const oneLine = (mjml: string) => mjml.replace(/>\s+</g, (gap) => (/\S/.test(gap.slice(1, -1)) ? gap : '><'))

/** The HTML, and what the compiler objected to — without its line numbers, which formatting is meant to move. */
const compile = (mjml: string) => {
  const { html, errors } = mjml2html(mjml, { validationLevel: 'soft' })
  return { html, errors: errors.map((error) => `${error.tagName}: ${error.message}`) }
}

const SAMPLES: Record<string, string> = {
  starter: STARTER_MJML,
  'starter as the editor writes it': oneLine(STARTER_MJML),
  'hide on phones, with its head rule': `<mjml><mj-head><mj-style>${HIDE_MOBILE_RULE}</mj-style></mj-head><mj-body><mj-section css-class="cep-hide-mobile"><mj-column><mj-text>Desktop only</mj-text></mj-column></mj-section></mj-body></mjml>`,
  'a footer with its unsubscribe link': '<mjml><mj-body><mj-section css-class="cep-footer" padding="16px 24px"><mj-column><mj-text font-size="12px" align="center">You are receiving this.<br/><a href="{{unsubscribe_url}}" style="color:#64748b">Unsubscribe</a></mj-text></mj-column></mj-section></mj-body></mjml>',
  'an image, a divider and a spacer': '<mjml><mj-body><mj-section><mj-column><mj-image src="https://cdn.example.com/hero.png" alt="Hero for {{first_name}}" width="560px"></mj-image><mj-divider border-color="#e2e8f0"></mj-divider><mj-spacer height="24px"></mj-spacer></mj-column></mj-section></mj-body></mjml>',
  'raw blocks with conditional comments': '<mjml><mj-body><mj-raw><!--[if mso]><table><tr><td><![endif]--><p class="x">raw   spaced   html</p><!--[if mso]></td></tr></table><![endif]--></mj-raw><mj-section><mj-column><mj-raw><div>inner raw</div></mj-raw></mj-column></mj-section></mj-body></mjml>',
  'text whose own line breaks and spaces matter': '<mjml><mj-body><mj-section><mj-column><mj-text>Line one\n    indented   by   hand\n<pre>  keep  this  </pre> {{ first_name }}</mj-text><mj-button href="{{shop_url}}?c={{offer_code}}">  Shop  now  </mj-button></mj-column></mj-section></mj-body></mjml>',
  'a comment between blocks, and the head': '<mjml><mj-head><mj-title>T</mj-title><mj-preview>Pre {{first_name}}</mj-preview><mj-attributes><mj-all font-family="Helvetica"></mj-all><mj-class name="big" font-size="20px"></mj-class></mj-attributes></mj-head><mj-body><!-- the hero --><mj-section><mj-column><mj-text mj-class="big">Hi</mj-text></mj-column></mj-section></mj-body></mjml>',
  'two columns and social icons': '<mjml><mj-body><mj-section><mj-column><mj-text>A</mj-text></mj-column><mj-column><mj-social><mj-social-element name="facebook" href="https://f.example">Facebook</mj-social-element></mj-social></mj-column></mj-section></mj-body></mjml>',
}

/** Every palette block too, placed where it may go, as the editor would write it. */
for (const block of CEP_BLOCKS) {
  const mjml = needsImage(block) ? withImage(block, 'https://cdn.example.com/a.png') : block.mjml
  const body = mjml.startsWith('<mj-section') ? mjml : `<mj-section><mj-column>${mjml}</mj-column></mj-section>`
  SAMPLES[`the ${block.label} block`] = oneLine(`<mjml><mj-body>${body}</mj-body></mjml>`)
}

test.each(Object.entries(SAMPLES))('%s compiles to the same HTML once formatted', (_name, mjml) => {
  const formatted = formatMjml(mjml)
  expect(compile(formatted)).toEqual(compile(mjml))
})

test.each(Object.entries(SAMPLES))('%s: formatting only ever adds or moves whitespace between elements', (_name, mjml) => {
  const formatted = formatMjml(mjml)
  const squash = (text: string) => oneLine(text)
  expect(squash(formatted)).toBe(squash(mjml))
})

test('the editor’s one line becomes one element per line, indented by depth', () => {
  expect(formatMjml('<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-text><mj-image src="a.png"></mj-image></mj-column></mj-section></mj-body></mjml>')).toBe(
    ['<mjml>', '  <mj-body>', '    <mj-section>', '      <mj-column>', '        <mj-text>Hi</mj-text>', '        <mj-image src="a.png"></mj-image>', '      </mj-column>', '    </mj-section>', '  </mj-body>', '</mjml>'].join('\n'),
  )
})

test('the words and markup inside a text, a button, a raw block and a style are left exactly as they are', () => {
  const inner = {
    text: '<p>One</p>\n   <p>Two  {{first_name}}</p>',
    button: '  Go  ',
    raw: '<!--[if mso]><table><![endif]--><div>\n  x\n</div>',
    style: '.a { color: red }\n  @media (max-width:480px) { .b { display:none } }',
  }
  const mjml = `<mjml><mj-head><mj-style>${inner.style}</mj-style></mj-head><mj-body><mj-raw>${inner.raw}</mj-raw><mj-section><mj-column><mj-text>${inner.text}</mj-text><mj-button href="x">${inner.button}</mj-button></mj-column></mj-section></mj-body></mjml>`
  const formatted = formatMjml(mjml)
  for (const content of Object.values(inner)) expect(formatted).toContain(content)
})

test('attribute values are copied as written, even when they look like markup', () => {
  const mjml = '<mjml><mj-body><mj-section css-class="a  b" padding="0 0  0"><mj-column><mj-image alt="x > y &amp; {{first_name}}" src="a.png"></mj-image></mj-column></mj-section></mj-body></mjml>'
  const formatted = formatMjml(mjml)
  // it really was formatted, not handed back untouched
  expect(formatted.split('\n')).toHaveLength(9)
  expect(formatted).toContain('<mj-section css-class="a  b" padding="0 0  0">')
  expect(formatted).toContain('        <mj-image alt="x > y &amp; {{first_name}}" src="a.png"></mj-image>')
  expect(compile(formatted)).toEqual(compile(mjml))
})

test('code it does not understand comes back exactly as it came in', () => {
  const stray = '<mjml><mj-body>loose words<mj-section></mj-section></mj-body></mjml>'
  const unclosed = '<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-column></mj-section></mj-body></mjml>'
  const crossed = '<mjml><mj-body><mj-section><mj-column></mj-section></mj-column></mj-body></mjml>'
  for (const mjml of [stray, unclosed, crossed, 'not mjml at all', '']) expect(formatMjml(mjml)).toBe(mjml)
})

test('formatting is stable: formatting twice changes nothing more', () => {
  for (const mjml of Object.values(SAMPLES)) expect(formatMjml(formatMjml(mjml))).toBe(formatMjml(mjml))
})
