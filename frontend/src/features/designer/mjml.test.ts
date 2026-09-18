import type { ProjectData } from 'grapesjs'
import { expect, test } from 'vitest'

import { expandSelfClosing, repairProject } from './mjml'

test('self-closing MJML tags are expanded so the HTML parser cannot swallow what follows them', () => {
  const source = '<mj-column><mj-divider border-width="1px" border-color="#e5e8f0" /><mj-text>Subtotal</mj-text><mj-spacer/><mj-image src="https://cdn.example/a.png" alt="a/b" />'
    + '<mj-button href="https://shop.example/">Shop</mj-button></mj-column>'
  const out = expandSelfClosing(source)
  expect(out).toBe('<mj-column><mj-divider border-width="1px" border-color="#e5e8f0"></mj-divider><mj-text>Subtotal</mj-text><mj-spacer></mj-spacer>'
    + '<mj-image src="https://cdn.example/a.png" alt="a/b"></mj-image><mj-button href="https://shop.example/">Shop</mj-button></mj-column>')

  // what the browser does with each: the reason this exists
  const parse = (markup: string) => new DOMParser().parseFromString(markup, 'text/html').body
  expect(parse(source).querySelector('mj-divider')?.children.length).toBeGreaterThan(0)      // broken: text inside the divider
  expect(parse(out).querySelector('mj-divider')?.children.length).toBe(0)
  expect([...(parse(out).querySelector('mj-column')?.children ?? [])].map((node) => node.tagName.toLowerCase())).toEqual(['mj-divider', 'mj-text', 'mj-spacer', 'mj-image', 'mj-button'])
})

test('already well-formed markup and ordinary HTML are left alone', () => {
  const source = '<mj-text>Hi <br/> there <img src="x.png"/></mj-text><mj-divider></mj-divider>'
  expect(expandSelfClosing(source)).toBe(source)
})

test('a design saved with the wrong nesting is repaired: what a divider swallowed comes back out, in order', () => {
  const text = (content: string) => ({ type: 'mj-text', components: [{ type: 'textnode', content }] })
  const broken = { assets: [], styles: [], pages: [{ frames: [{ component: { type: 'wrapper', components: [{ type: 'mj-body', components: [{ type: 'mj-section', components: [{ type: 'mj-column', components: [
    text('Receipt'),
    { type: 'mj-divider', attributes: { 'border-width': '1px' }, components: [
      text('Subtotal'), text('Discounts'),
      { type: 'mj-divider', components: [text('Total')] },
    ] },
  ] }] }] }] } }] }] } as unknown as ProjectData

  const { project, moved } = repairProject(broken)
  const column = (project as unknown as { pages: { frames: { component: { components: { components: { components: { components: { type: string; components?: unknown }[] }[] }[] }[] } }[] }[] })
    .pages[0].frames[0].component.components[0].components[0].components[0].components
  expect(moved).toBeGreaterThan(0)                         // an indicator that the design changed (nested dividers are counted per level)
  expect(column.map((node) => node.type)).toEqual(['mj-text', 'mj-divider', 'mj-text', 'mj-text', 'mj-divider', 'mj-text'])
  expect(column.filter((node) => node.type === 'mj-divider').every((node) => node.components === undefined)).toBe(true)
  expect((column[1] as unknown as { attributes: Record<string, string> }).attributes['border-width']).toBe('1px')

  const again = repairProject(project)
  expect(again.moved).toBe(0)
  expect(again.project).toBe(project)                        // a healthy design is returned untouched
})
