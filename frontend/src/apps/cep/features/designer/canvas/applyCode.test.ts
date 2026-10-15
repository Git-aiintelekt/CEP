import { expect, test, vi } from 'vitest'

import { applyCode, compileWith, type CodeHost } from './applyCode'

const SECTION = '<mj-section><mj-column><mj-text>Hi</mj-text></mj-column></mj-section>'

/** An editor that records what it was asked to do. load and UndoManager.clear exist only to prove they are never called. */
function fakeEditor(serialise: (typed: string) => string = (typed) => typed) {
  let design = '<mjml><mj-body></mj-body></mjml>'
  const calls: string[] = []
  const editor = {
    calls,
    select: vi.fn((components: []) => calls.push(`select:${JSON.stringify(components)}`)),
    setComponents: vi.fn((mjml: string) => {
      calls.push('setComponents')
      design = serialise(mjml)
    }),
    getHtml: vi.fn(() => design),
    runCommand: vi.fn((id: string, options?: Record<string, unknown>) => ({ id, options })),
    load: vi.fn(),
    UndoManager: { clear: vi.fn(), stop: vi.fn() },
  }
  return editor as typeof editor & CodeHost
}

test('the code replaces the design through setComponents, with nothing selected first', async () => {
  const editor = fakeEditor()
  await applyCode(editor, `<mjml><mj-body>${SECTION}</mj-body></mjml>`)
  expect(editor.calls).toEqual(['select:[]', 'setComponents'])
})

test('never through load, and the undo history is left alone: the replace is an edit, one step to undo', async () => {
  const editor = fakeEditor()
  await applyCode(editor, `<mjml><mj-body>${SECTION}</mj-body></mjml>`)
  expect(editor.load).not.toHaveBeenCalled()
  expect(editor.UndoManager.clear).not.toHaveBeenCalled()
  expect(editor.UndoManager.stop).not.toHaveBeenCalled()
})

test('self-closing tags are opened out first, or the parser would put what follows inside them', async () => {
  const editor = fakeEditor()
  await applyCode(editor, '<mjml><mj-body><mj-section><mj-column><mj-divider /><mj-text>after</mj-text></mj-column></mj-section></mj-body></mjml>')
  // the divider is closed before the text, so the text stays its sibling
  expect(editor.setComponents.mock.calls[0][0]).toMatch(/<mj-divider\s*><\/mj-divider><mj-text>after<\/mj-text>/)
})

test('what the editor made of the code is read back after its own rules have run', async () => {
  // the one-footer rule removes a second footer on a timer, after setComponents returns
  const FOOTER = '<mj-section css-class="cep-footer"><mj-column><mj-text>Bye</mj-text></mj-column></mj-section>'
  let design = ''
  const editor = fakeEditor((typed) => typed)
  editor.setComponents.mockImplementation((mjml: string) => {
    design = mjml
    setTimeout(() => {
      design = design.replace(FOOTER + FOOTER, FOOTER)
    }, 0)
  })
  editor.getHtml.mockImplementation(() => design)
  const { applied, changes } = await applyCode(editor, `<mjml><mj-body>${SECTION}${FOOTER}${FOOTER}</mj-body></mjml>`)
  expect(applied).toBe(`<mjml><mj-body>${SECTION}${FOOTER}</mj-body></mjml>`)
  expect(changes).toEqual(['removed a second footer: an email has only one'])
})

test('code the editor keeps as it was reports no changes', async () => {
  const { changes } = await applyCode(fakeEditor(), `<mjml><mj-body>${SECTION}</mj-body></mjml>`)
  expect(changes).toEqual([])
})

test('the checks compile a string through the plugin’s command, handed the code, never the design', () => {
  const editor = fakeEditor()
  compileWith(editor)('<mjml></mjml>')
  expect(editor.runCommand).toHaveBeenCalledWith('mjml-code-to-html', { mjml: '<mjml></mjml>' })
  expect(editor.setComponents).not.toHaveBeenCalled()
})
