import { expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import {
  EMPTY_MESSAGE, FORBIDDEN, MAX_MJML_BYTES, NOT_MJML_MESSAGE, checkMjml, lineOf, plainLine, rawDetail, unknownFieldMessage, type Compile,
} from './codeChecks'

const tag = (tag_key: string): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null,
  sample_value: 'x', default_value: null, static_value: null, is_active: true,
})
const catalogue = [tag('first_name'), tag('unsubscribe_url')]

const VALID = `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hi {{first_name}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

const clean: Compile = () => ({ html: '<html></html>', errors: [] })
const check = (text: string, compile: Compile = clean) => checkMjml(text, { compile, catalogue })

test('valid MJML with known fields passes', () => {
  expect(check(VALID)).toEqual({ ok: true })
})

// ---- a. empty -------------------------------------------------------------

test('empty input is refused before anything compiles it, since the compiler would quietly use the current design', () => {
  const compile = vi.fn(clean)
  for (const text of ['', '   ', '\n\n']) expect(check(text, compile)).toMatchObject({ ok: false, message: EMPTY_MESSAGE })
  expect(compile).not.toHaveBeenCalled()
})

// ---- b. what the server refuses -------------------------------------------

test.each([
  ['a script', '<mj-raw><script>alert(1)</script></mj-raw>', 0],
  ['mj-include', '<mj-include path="./header.mjml" />', 1],
  ['an inline event handler', '<mj-text><a href="#" onclick="go()">x</a></mj-text>', 2],
  ['a javascript: link', '<mj-button href="javascript:alert(1)">Go</mj-button>', 3],
])('%s is refused with the server’s own rule, on the line it sits on', (_name, snippet, rule) => {
  const compile = vi.fn(clean)
  const text = VALID.replace('<mj-text>Hi {{first_name}}</mj-text>', snippet)
  const result = check(text, compile)
  expect(result).toMatchObject({ ok: false, message: FORBIDDEN[rule].message, line: 5 })
  expect(compile).not.toHaveBeenCalled()
})

test('the four patterns are the server’s, character for character', () => {
  expect(FORBIDDEN.map((rule) => rule.pattern.source)).toEqual(['<\\s*script\\b', '<\\s*mj-include\\b', '\\son[a-z]+\\s*=\\s*["\']', 'javascript\\s*:'])
  expect(FORBIDDEN.every((rule) => rule.pattern.flags.includes('i'))).toBe(true)
})

test('code over 512 KB is refused, counted in bytes as the server counts them', () => {
  const pad = (bytes: number) => VALID.replace('Hi', 'x'.repeat(bytes - new TextEncoder().encode(VALID).length + 2))
  expect(check(pad(MAX_MJML_BYTES))).toEqual({ ok: true })
  const over = check(pad(MAX_MJML_BYTES + 1))
  expect(over).toMatchObject({ ok: false })
  expect(over.ok ? '' : over.message).toMatch(/513 KB\. The server accepts up to 512 KB/)
  // é is two bytes: 300 000 of them is 600 KB although it is only 300 000 characters
  expect(check(VALID.replace('Hi', 'é'.repeat(300_000))).ok).toBe(false)
})

// ---- c. what MJML makes of it ---------------------------------------------

test('plain text, or code without <mjml>, makes the compiler throw: that is one plain line, never the raw error', () => {
  for (const reason of ['Parsing failed. Check your mjml.', 'Malformed MJML. Check that your structure is correct and enclosed in <mjml> tags.']) {
    const result = check('hello there', () => { throw new Error(reason) })
    expect(result).toEqual({ ok: false, message: NOT_MJML_MESSAGE, details: [reason] })
  }
})

test('an mj-text in the wrong parent is one plain line with its line number', () => {
  const result = check(VALID, () => ({
    errors: [{ line: 8, tagName: 'mj-text', message: 'mj-text cannot be used inside mj-body, only inside: mj-attributes, mj-column, mj-hero',
      formattedMessage: 'Line 8 of . (mj-text) — mj-text cannot be used inside mj-body, only inside: mj-attributes, mj-column, mj-hero' }],
  }))
  expect(result).toEqual({
    ok: false,
    message: 'Line 8: mj-text can’t sit directly in the body.',
    line: 8,
    more: undefined,
    details: ['Line 8 (mj-text) — mj-text cannot be used inside mj-body, only inside: mj-attributes, mj-column, mj-hero'],
  })
})

test('the first problem is the highest one up, and the rest are counted', () => {
  const result = check(VALID, () => ({
    errors: [
      { line: 8, tagName: 'mj-text', message: 'mj-text cannot be used inside mj-body, only inside: mj-column' },
      { line: 5, tagName: 'mj-foo', message: "Element mj-foo doesn't exist or is not registered" },
      { line: 6, tagName: 'mj-section', message: 'Attribute padding has invalid value: lots for type Unit, only accepts (px, %) units' },
    ],
  }))
  expect(result).toMatchObject({ ok: false, line: 5, message: 'Line 5: mj-foo isn’t an MJML element. Check the spelling, or remove it.', more: 'and 2 more problems' })
})

test('the compiler’s text loses the empty file name the plugin leaves in it', () => {
  expect(rawDetail({ formattedMessage: 'Line 8 of . (mj-text) — x' })).toBe('Line 8 (mj-text) — x')
  expect(plainLine({ line: 3, tagName: 'mj-section', message: 'Attribute padding has invalid value: lots for type Unit' }))
    .toBe('Line 3: mj-section has a padding value MJML can’t read: lots.')
})

// ---- d. fields ------------------------------------------------------------

test('an unknown field is refused by name, on its line', () => {
  const result = check(VALID.replace('{{first_name}}', '{{first_nme}}'))
  expect(result).toMatchObject({ ok: false, message: unknownFieldMessage(['first_nme']), line: 5 })
  expect(unknownFieldMessage(['first_nme'])).toBe('Unknown field: {{first_nme}}')
  expect(unknownFieldMessage(['a', 'b'])).toBe('Unknown fields: {{a}}, {{b}}')
})

// ---- order ----------------------------------------------------------------

test('the checks stop at the first problem, in order: server rules before compiling, compiling before fields', () => {
  const compile = vi.fn((): ReturnType<Compile> => ({ errors: [{ line: 2, message: 'broken' }] }))
  const both = VALID.replace('{{first_name}}', '{{nope}}').replace('<mj-body>', '<mj-body><mj-raw><script></script></mj-raw>')
  expect(check(both, compile)).toMatchObject({ message: FORBIDDEN[0].message })
  expect(compile).not.toHaveBeenCalled()
  expect(check(VALID.replace('{{first_name}}', '{{nope}}'), compile)).toMatchObject({ message: 'Line 2: broken' })
})

test('a line is counted from 1', () => {
  expect(lineOf('a\nb\nc', 0)).toBe(1)
  expect(lineOf('a\nb\nc', 4)).toBe(3)
})
