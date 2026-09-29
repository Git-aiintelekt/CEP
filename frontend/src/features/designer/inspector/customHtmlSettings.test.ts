/** A Custom HTML block's layout lives in a wrapper table inside its own markup; the HTML field edits what is inside. */
import type { Component } from 'grapesjs'
import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import {
  CUSTOM_ALIGN_KEY, CUSTOM_BACKGROUND_KEY, CUSTOM_HTML_CLASS, CUSTOM_MARGIN_KEY, CUSTOM_PADDING_KEY, CUSTOM_WIDTH_KEY, customHtmlOf, readCustomHtml,
  readCustomHtmlMarkup, wrap, writeCustomHtml, writeCustomHtmlMarkup,
} from './customHtmlSettings'
import { HTML_KEY, readSetting, writeSetting } from './settings'

/** An mj-raw as the panel sees it: its markup, rewritten whole by components(). */
function raw(html: string) {
  let markup = html
  const component = {
    get: (key: string) => (key === 'type' || key === 'tagName' ? 'mj-raw' : undefined),
    getAttributes: () => ({}),
    getInnerHTML: () => markup,
    components: (next?: string) => {
      if (typeof next === 'string') markup = next
      return []
    },
    markup: () => markup,
  }
  return component as unknown as Component & { markup: () => string }
}

const TYPED = '<p style="margin:0">Hello <b>there</b></p>'

test('a block with no settings is exactly what was typed, and reads as no layout at all', () => {
  const block = raw(TYPED)
  expect(customHtmlOf(block)).toEqual({ layout: { width: null, align: null, margin: null, padding: null, background: null }, inner: TYPED })
  expect(readCustomHtmlMarkup(block)).toBe(TYPED)
  expect(wrap({ width: null, align: null, margin: null, padding: null, background: null }, TYPED)).toBe(TYPED)
  writeCustomHtmlMarkup(block, '<p>Changed</p>')
  expect(block.markup()).toBe('<p>Changed</p>')                                                     // still no wrapper
})

test('the first setting wraps the markup; every setting reads back from the wrapper and the inner HTML is untouched', () => {
  const block = raw(TYPED)
  expect(writeCustomHtml(block, CUSTOM_WIDTH_KEY, '480px')).toBe(true)
  expect(block.markup()).toContain(`class="${CUSTOM_HTML_CLASS}"`)
  expect(block.markup()).toContain('width="480px" style="width:480px;max-width:100%;"')
  expect(readCustomHtml(block, CUSTOM_WIDTH_KEY)).toBe('480px')
  expect(readCustomHtml(block, CUSTOM_ALIGN_KEY)).toBeNull()                                       // centred is the default: nothing set
  expect(block.markup()).toContain('<td align="center">')
  expect(readCustomHtmlMarkup(block)).toBe(TYPED)

  expect(writeCustomHtml(block, CUSTOM_ALIGN_KEY, 'left')).toBe(true)
  expect(writeCustomHtml(block, CUSTOM_MARGIN_KEY, '8px 0px')).toBe(true)
  expect(writeCustomHtml(block, CUSTOM_PADDING_KEY, '16px 24px 16px 24px')).toBe(true)
  expect(writeCustomHtml(block, CUSTOM_BACKGROUND_KEY, '#F5F5F5')).toBe(true)
  expect([CUSTOM_WIDTH_KEY, CUSTOM_ALIGN_KEY, CUSTOM_MARGIN_KEY, CUSTOM_PADDING_KEY, CUSTOM_BACKGROUND_KEY].map((key) => readCustomHtml(block, key)))
    .toEqual(['480px', 'left', '8px 0px', '16px 24px 16px 24px', '#f5f5f5'])
  expect(readCustomHtmlMarkup(block)).toBe(TYPED)

  // new markup goes inside the same wrapper
  writeCustomHtmlMarkup(block, '<p>Changed</p>')
  expect(readCustomHtmlMarkup(block)).toBe('<p>Changed</p>')
  expect(readCustomHtml(block, CUSTOM_BACKGROUND_KEY)).toBe('#f5f5f5')

  // clearing every setting takes the wrapper away again
  for (const key of [CUSTOM_WIDTH_KEY, CUSTOM_ALIGN_KEY, CUSTOM_MARGIN_KEY, CUSTOM_PADDING_KEY, CUSTOM_BACKGROUND_KEY]) writeCustomHtml(block, key, null)
  expect(block.markup()).toBe('<p>Changed</p>')
})

test('what MJML would refuse is refused here: em, a bare number, a colour that is not hex, an alignment that is not one of three', () => {
  const block = raw(TYPED)
  expect(writeCustomHtml(block, CUSTOM_WIDTH_KEY, '30em')).toBe(false)
  expect(writeCustomHtml(block, CUSTOM_PADDING_KEY, '10')).toBe(false)
  expect(writeCustomHtml(block, CUSTOM_BACKGROUND_KEY, 'red')).toBe(false)
  expect(writeCustomHtml(block, CUSTOM_ALIGN_KEY, 'justify')).toBe(false)
  expect(block.markup()).toBe(TYPED)
})

test('through the panel: the HTML field shows the inner markup, the layout keys route to the wrapper, and only for an mj-raw', () => {
  const block = raw(TYPED)
  expect(writeSetting(block, CUSTOM_PADDING_KEY, '12px')).toBe(true)
  expect(readSetting(block, HTML_KEY)).toBe(TYPED)
  expect(readSetting(block, CUSTOM_PADDING_KEY)).toBe('12px')
  expect(writeSetting(block, HTML_KEY, '<p>Again</p>')).toBe(true)
  expect(readSetting(block, HTML_KEY)).toBe('<p>Again</p>')
  expect(readSetting(block, CUSTOM_PADDING_KEY)).toBe('12px')

  const text = { ...raw('<p>x</p>'), get: (key: string) => (key === 'type' ? 'mj-text' : undefined) } as unknown as Component
  expect(readSetting(text, CUSTOM_PADDING_KEY)).toBeNull()
  expect(writeSetting(text, CUSTOM_PADDING_KEY, '12px')).toBe(false)
})

test('MJML passes the wrapped block through inside a column, as it does at body level', () => {
  const wrapped = wrap({ width: '50%', align: 'right', margin: '8px', padding: '16px', background: '#f5f5f5' }, TYPED)
  for (const place of [`<mj-section><mj-column><mj-raw>${wrapped}</mj-raw></mj-column></mj-section>`, `<mj-raw>${wrapped}</mj-raw>`]) {
    const { html, errors } = mjml2html(`<mjml><mj-body>${place}</mj-body></mjml>`)
    expect(errors).toEqual([])
    expect(html).toContain('width="50%"')
    expect(html).toContain('background-color:#f5f5f5')
    expect(html).toContain(TYPED)
  }
})
