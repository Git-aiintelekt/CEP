import { expect, test, vi } from 'vitest'

import { buildPreview, isEmptyDesign } from './previewState'

const MJML = '<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-text></mj-column></mj-section></mj-body></mjml>'

function editor(over: { mjml?: string; compile?: () => { html: string; errors: string[] }; commit?: () => Promise<void> } = {}) {
  const order: string[] = []
  return {
    order,
    commitEdit: vi.fn(async () => {
      order.push('commit')
      await over.commit?.()
    }),
    getMjml: vi.fn(() => over.mjml ?? MJML),
    compileHtml: vi.fn(() => {
      order.push('compile')
      return over.compile ? over.compile() : { html: '<html>ok</html>', errors: [] }
    }),
  }
}

test('a body with no blocks is empty; one with a block, or a head only, is judged by its body', () => {
  expect(isEmptyDesign('<mjml><mj-body></mj-body></mjml>')).toBe(true)
  expect(isEmptyDesign('<mjml><mj-head><mj-style>.x{}</mj-style></mj-head><mj-body background-color="#fff">  </mj-body></mjml>')).toBe(true)
  expect(isEmptyDesign(MJML)).toBe(false)
  expect(isEmptyDesign('')).toBe(true)
})

test('the text being typed is committed before the email is compiled, so unsaved edits show', async () => {
  const source = editor()
  const state = await buildPreview(source)
  expect(source.order).toEqual(['commit', 'compile'])
  expect(state).toMatchObject({ status: 'ready', html: '<html>ok</html>' })
})

test('an empty template is a message, never a blank white page', async () => {
  const source = editor({ mjml: '<mjml><mj-body></mj-body></mjml>' })
  expect(await buildPreview(source)).toEqual({ status: 'empty' })
  expect(source.compileHtml).not.toHaveBeenCalled()
})

test('compiler errors are a failure, and the half-rendered email is not kept', async () => {
  const state = await buildPreview(editor({ compile: () => ({ html: '<html>half</html>', errors: ['mj-text cannot be used inside mj-body'] }) }))
  expect(state).toEqual({ status: 'failed', details: ['mj-text cannot be used inside mj-body'] })
})

test('a compile that throws is caught and reported the same way', async () => {
  const state = await buildPreview(editor({ compile: () => { throw new Error('mjml exploded') } }))
  expect(state).toEqual({ status: 'failed', details: ['mjml exploded'] })
})

test('a commit that throws is caught too', async () => {
  const state = await buildPreview(editor({ commit: async () => { throw new Error('edit lost') } }))
  expect(state).toEqual({ status: 'failed', details: ['edit lost'] })
})

test('no editor yet is a failure, not a stale preview', async () => {
  expect(await buildPreview(null)).toMatchObject({ status: 'failed' })
})
