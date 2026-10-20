/** The designer's design cleaning: what could run code in the canvas is left out, everything else is kept as it was. */
import { expect, test } from 'vitest'

import { cleanDesign, cleanHtml, cleanParsed } from './safeDesign'

const project = (...components: unknown[]) => ({ pages: [{ frames: [{ component: { type: 'wrapper', components } }] }], styles: [{ selectors: ['#a'], style: { color: 'red' } }], assets: [{ type: 'image', src: 'https://cdn.example/a.png' }] })

test('a saved project keeps its design and loses scripts, event handlers, embedded pages and javascript: links', () => {
  const cleaned = cleanDesign(project(
    { type: 'mj-section', attributes: { 'background-color': '#fff', 'css-class': 'hero' }, components: [
      { type: 'mj-text', script: "fetch('//evil')", 'script-export': 'x()', content: '<p onclick="steal()">Hello <b>there</b></p><img src=x onerror=alert(1)>' },
      { tagName: 'a', attributes: { href: ' \tJavaScript:alert(1)', title: 'Shop', onMouseOver: 'x()' }, components: [{ type: 'textnode', content: 'Prices < $10' }] },
      { tagName: 'iframe', attributes: { src: 'https://example.com' } },
      { tagName: 'div', attributes: { srcdoc: '<script>x</script>', id: 'keep' } },
    ] },
  ))
  const section = cleaned.pages[0].frames[0].component.components[0] as { attributes: object; components: Record<string, unknown>[] }
  expect(section.attributes).toEqual({ 'background-color': '#fff', 'css-class': 'hero' })
  expect(section.components).toHaveLength(3)                                      // the iframe is gone
  const [text, link, div] = section.components
  expect(text).not.toHaveProperty('script')
  expect(text).not.toHaveProperty('script-export')
  expect(text.content).toBe('<p>Hello <b>there</b></p><img src="x">')
  expect(link.attributes).toEqual({ title: 'Shop' })
  expect((link.components as { content: string }[])[0].content).toBe('Prices < $10')   // a text node's content is text, left alone
  expect(div.attributes).toEqual({ id: 'keep' })
  expect(cleaned.styles).toEqual([{ selectors: ['#a'], style: { color: 'red' } }])
  expect(cleaned.assets).toEqual([{ type: 'image', src: 'https://cdn.example/a.png' }])
})

test('the parser output keeps its shape; an unsafe element alone becomes empty text; plain text is not touched', () => {
  expect(cleanParsed({ tagName: 'script', content: 'alert(1)' })).toEqual({ type: 'textnode', content: '' })
  expect(cleanParsed({ tagName: 'p', attributes: { onload: 'x()' } })).toEqual({ tagName: 'p', attributes: {} })
  expect(cleanParsed([{ tagName: 'object' }, { tagName: 'span' }])).toEqual([{ tagName: 'span' }])
  expect(cleanHtml('Fish & chips, 2 for 1')).toBe('Fish & chips, 2 for 1')
  expect(cleanHtml('<iframe srcdoc="<script>x</script>"></iframe><p>ok</p>')).toBe('<p>ok</p>')
})
