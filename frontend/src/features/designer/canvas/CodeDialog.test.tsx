import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { CodeDialog, type CodeDialogProps } from './CodeDialog'
import type { CheckResult } from './codeChecks'
import {
  APPLY_LABEL, CLOSE_LABEL, CODE_NOTE, CODE_TITLE, COPIED_TOAST, COPY_FAILED_TOAST, COPY_LABEL, DISCARD_CONFIRM, DISCARD_LABEL,
  DISCARD_TITLE, DOWNLOAD_HTML_LABEL, DOWNLOAD_MJML_LABEL, EDITOR_LABEL, EDIT_LABEL, GATE_CANCEL, GATE_CONFIRM, GATE_NOTE, GATE_TITLE,
  FORMATTED_HINT, HTML_TAB, KEEP_EDITING, MJML_TAB, REPLACE_WARNING, SHOW_DETAILS, forgetCodeGate, rememberCodeGate,
} from './codeCopy'

const MJML = '<mjml>\n  <mj-body>\n    <mj-section>\n      <mj-column>\n        <mj-text>Hi</mj-text>\n      </mj-column>\n    </mj-section>\n  </mj-body>\n</mjml>'
const HTML = '<!doctype html><html><body>Hi</body></html>'

beforeEach(() => forgetCodeGate())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDialog(over: Partial<CodeDialogProps> = {}) {
  const props: CodeDialogProps = {
    mjml: MJML,
    html: HTML,
    canEdit: true,
    onCheck: vi.fn((): CheckResult => ({ ok: true })),
    onApply: vi.fn(async () => ({ changes: [] })),
    onDownloadHtml: vi.fn(),
    onDownloadMjml: vi.fn(),
    onToast: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<CodeDialog {...props} />)
  return props
}

const button = (name: string) => screen.getByRole('button', { name })
const dialogNamed = (name: string) => screen.getByRole('dialog', { name })
const textarea = () => screen.getByRole('textbox', { name: EDITOR_LABEL }) as HTMLTextAreaElement

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  rememberCodeGate()
  await user.click(button(EDIT_LABEL))
  return textarea()
}

// ---- reading ---------------------------------------------------------------

test('Email code opens on the MJML, with the HTML a tab away, and says the sent HTML is built on save', async () => {
  const user = userEvent.setup()
  renderDialog()
  expect(dialogNamed(CODE_TITLE)).toBeTruthy()
  expect(screen.getByText(CODE_NOTE)).toBeTruthy()
  expect(screen.getByRole('tab', { name: MJML_TAB }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByLabelText(MJML_TAB, { selector: 'pre' }).textContent).toBe(MJML)

  await user.click(screen.getByRole('tab', { name: HTML_TAB }))
  const html = screen.getByLabelText(HTML_TAB, { selector: 'pre' })
  expect(html.textContent).toBe(HTML)
  expect(html.className).toContain('font-mono')
  expect(screen.queryByRole('textbox')).toBeNull()
})

test('each tab copies its own code and says so', async () => {
  const user = userEvent.setup()
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  const props = renderDialog()

  await user.click(button(COPY_LABEL))
  expect(writeText).toHaveBeenLastCalledWith(MJML)
  await user.click(screen.getByRole('tab', { name: HTML_TAB }))
  await user.click(button(COPY_LABEL))
  expect(writeText).toHaveBeenLastCalledWith(HTML)
  expect(props.onToast).toHaveBeenCalledTimes(2)
  expect(props.onToast).toHaveBeenCalledWith('success', COPIED_TOAST)
})

test('a copy the browser refuses is said, not swallowed', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('Permission denied') }) } })
  const props = renderDialog()
  await user.click(button(COPY_LABEL))
  expect(props.onToast).toHaveBeenCalledWith('error', COPY_FAILED_TOAST, 'Permission denied')
})

test('the MJML tab downloads .mjml and the HTML tab .html', async () => {
  const user = userEvent.setup()
  const props = renderDialog()
  await user.click(button(DOWNLOAD_MJML_LABEL))
  expect(props.onDownloadMjml).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: DOWNLOAD_HTML_LABEL })).toBeNull()

  await user.click(screen.getByRole('tab', { name: HTML_TAB }))
  await user.click(button(DOWNLOAD_HTML_LABEL))
  expect(props.onDownloadHtml).toHaveBeenCalledTimes(1)
})

// ---- who may edit ----------------------------------------------------------

test('a view-only reader, or an archived template, reads the MJML and cannot edit it', () => {
  renderDialog({ canEdit: false })
  expect(screen.getByLabelText(MJML_TAB, { selector: 'pre' }).textContent).toBe(MJML)
  expect(screen.queryByRole('button', { name: EDIT_LABEL })).toBeNull()
  expect(screen.queryByRole('button', { name: APPLY_LABEL })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
})

// ---- the warning, once per session -----------------------------------------

test('the first Edit MJML of a session asks first; Cancel leaves the code read-only', async () => {
  const user = userEvent.setup()
  renderDialog()
  await user.click(button(EDIT_LABEL))
  const gate = dialogNamed(GATE_TITLE)
  expect(within(gate).getByText(GATE_NOTE)).toBeTruthy()

  await user.click(within(gate).getByRole('button', { name: GATE_CANCEL }))
  expect(screen.queryByRole('dialog', { name: GATE_TITLE })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
})

test('once agreed, the warning is not shown again for the rest of the session', async () => {
  const user = userEvent.setup()
  renderDialog()
  await user.click(button(EDIT_LABEL))
  await user.click(within(dialogNamed(GATE_TITLE)).getByRole('button', { name: GATE_CONFIRM }))
  expect(textarea()).toBeTruthy()
  expect(window.sessionStorage.getItem('cep.designer.codeGateSeen')).toBe('1')

  cleanup()
  renderDialog()
  await user.click(button(EDIT_LABEL))
  expect(screen.queryByRole('dialog', { name: GATE_TITLE })).toBeNull()
  expect(textarea()).toBeTruthy()
})

test('Escape in the warning closes the warning only, not the code underneath', async () => {
  const user = userEvent.setup()
  const props = renderDialog()
  await user.click(button(EDIT_LABEL))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: GATE_TITLE })).toBeNull()
  expect(dialogNamed(CODE_TITLE)).toBeTruthy()
  expect(props.onClose).not.toHaveBeenCalled()
})

// ---- editing ---------------------------------------------------------------

test('the editor is plain code: no spellcheck, no wrapping, the system monospace, and a line per number', async () => {
  const user = userEvent.setup()
  renderDialog()
  const area = await openEditor(user)
  expect(area.value).toBe(MJML)
  expect(area.getAttribute('spellcheck')).toBe('false')
  expect(area.getAttribute('wrap')).toBe('off')
  expect(area.className).toContain('font-mono')
  expect(screen.getByText(REPLACE_WARNING)).toBeTruthy()
  const numbers = area.parentElement?.querySelector('[aria-hidden]')
  expect(numbers?.children).toHaveLength(MJML.split('\n').length)
})

test('Apply changes stays grey until the code differs from the design', async () => {
  const user = userEvent.setup()
  const props = renderDialog()
  const area = await openEditor(user)
  const apply = button(APPLY_LABEL)
  expect(apply.getAttribute('aria-disabled')).toBe('true')
  await user.click(apply)
  expect(props.onCheck).not.toHaveBeenCalled()

  await user.type(area, ' ')
  expect(button(APPLY_LABEL).getAttribute('aria-disabled')).toBeNull()
})

test('the checks run on Apply only, never while typing', async () => {
  const user = userEvent.setup()
  const props = renderDialog()
  const area = await openEditor(user)
  await user.type(area, 'abc')
  expect(props.onCheck).not.toHaveBeenCalled()
  await user.click(button(APPLY_LABEL))
  expect(props.onCheck).toHaveBeenCalledTimes(1)
})

test('a failed check shows one plain line, keeps every character typed, and applies nothing', async () => {
  const user = userEvent.setup()
  const problem: CheckResult = { ok: false, message: 'Line 8: mj-text can’t sit directly in the body.', line: 8, more: 'and 1 more problem', details: ['Line 8 (mj-text) — mj-text cannot be used inside mj-body'] }
  const props = renderDialog({ onCheck: vi.fn(() => problem) })
  const area = await openEditor(user)
  await user.clear(area)
  await user.type(area, '<mjml><mj-body><mj-text>Loose</mj-text></mj-body></mjml>')
  const typed = area.value
  await user.click(button(APPLY_LABEL))

  const alert = screen.getByRole('alert')
  expect(alert.textContent).toContain('Line 8: mj-text can’t sit directly in the body.')
  expect(alert.textContent).toContain('and 1 more problem')
  expect(alert.textContent).not.toContain('cannot be used inside')
  expect(textarea().value).toBe(typed)
  expect(props.onApply).not.toHaveBeenCalled()

  await user.click(within(alert).getByRole('button', { name: SHOW_DETAILS }))
  expect(screen.getByRole('alert').textContent).toContain('mj-text cannot be used inside mj-body')
})

test('the line number in the message takes the caret to that line', async () => {
  const user = userEvent.setup()
  renderDialog({ onCheck: vi.fn((): CheckResult => ({ ok: false, message: 'Line 5: mj-text can’t sit directly in the body.', line: 5, details: [] })) })
  const area = await openEditor(user)
  await user.type(area, ' ')
  await user.click(button(APPLY_LABEL))
  await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Line 5' }))
  const lineFive = MJML.split('\n').slice(0, 4).join('\n').length + 1
  expect(document.activeElement).toBe(area)
  expect(area.selectionStart).toBe(lineFive)
})

test('a clean check applies the code, returns to reading it, and says what the editor adjusted', async () => {
  const user = userEvent.setup()
  const onApply = vi.fn(async () => ({ changes: ['removed a second footer: an email has only one'] }))
  renderDialog({ onApply })
  const area = await openEditor(user)
  await user.type(area, '{End} ')
  await user.click(button(APPLY_LABEL))

  expect(onApply).toHaveBeenCalledWith(`${MJML} `)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('The editor adjusted the code: removed a second footer: an email has only one.')
})

test('an apply the editor took unchanged shows no adjusted note', async () => {
  const user = userEvent.setup()
  renderDialog()
  await user.type(await openEditor(user), ' ')
  await user.click(button(APPLY_LABEL))
  expect(screen.queryByText(/The editor adjusted/)).toBeNull()
})

// ---- leaving with changes --------------------------------------------------

test.each([
  ['Discard', async (user: ReturnType<typeof userEvent.setup>) => user.click(button(DISCARD_LABEL))],
  ['closing the dialog', async (user: ReturnType<typeof userEvent.setup>) => user.click(within(dialogNamed(CODE_TITLE)).getAllByRole('button', { name: CLOSE_LABEL })[0])],
  ['switching tab', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('tab', { name: HTML_TAB }))],
])('%s with unapplied changes asks first, and Keep editing keeps them', async (_name, leave) => {
  const user = userEvent.setup()
  const props = renderDialog()
  const area = await openEditor(user)
  await user.type(area, 'changed')
  await leave(user)

  const ask = dialogNamed(DISCARD_TITLE)
  await user.click(within(ask).getByRole('button', { name: KEEP_EDITING }))
  expect(textarea().value).toContain('changed')
  expect(props.onClose).not.toHaveBeenCalled()
})

test('discarding drops the changes and goes where the person was heading', async () => {
  const user = userEvent.setup()
  const props = renderDialog()
  await user.type(await openEditor(user), 'changed')
  await user.click(within(dialogNamed(CODE_TITLE)).getAllByRole('button', { name: CLOSE_LABEL })[0])
  await user.click(within(dialogNamed(DISCARD_TITLE)).getByRole('button', { name: DISCARD_CONFIRM }))
  expect(props.onClose).toHaveBeenCalledTimes(1)
})

test('leaving edit mode with nothing changed does not ask', async () => {
  const user = userEvent.setup()
  renderDialog()
  await openEditor(user)
  await user.click(button(DISCARD_LABEL))
  expect(screen.queryByRole('dialog', { name: DISCARD_TITLE })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
})

// ---- formatted -------------------------------------------------------------

/** How the editor hands the MJML over: all on one line. */
const ONE_LINE = MJML.replace(/\n\s*/g, '')

test('the one line the editor writes is shown one element per line, and says so', () => {
  renderDialog({ mjml: ONE_LINE })
  expect(screen.getByLabelText(MJML_TAB, { selector: 'pre' }).textContent).toBe(MJML)
  expect(screen.getByText(FORMATTED_HINT)).toBeTruthy()
})

test('the HTML tab is shown as compiled, with no formatting hint', async () => {
  const user = userEvent.setup()
  renderDialog({ mjml: ONE_LINE })
  await user.click(screen.getByRole('tab', { name: HTML_TAB }))
  expect(screen.getByLabelText(HTML_TAB, { selector: 'pre' }).textContent).toBe(HTML)
  expect(screen.queryByText(FORMATTED_HINT)).toBeNull()
})

test('Copy and Download .mjml hand over the formatted code', async () => {
  const user = userEvent.setup()
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  const props = renderDialog({ mjml: ONE_LINE })
  await user.click(button(COPY_LABEL))
  expect(writeText).toHaveBeenCalledWith(MJML)
  await user.click(button(DOWNLOAD_MJML_LABEL))
  expect(props.onDownloadMjml).toHaveBeenCalledWith(MJML)
})

test('editing starts from the formatted code, and formatting alone is not a change to apply', async () => {
  const user = userEvent.setup()
  const props = renderDialog({ mjml: ONE_LINE })
  const area = await openEditor(user)
  expect(area.value).toBe(MJML)
  expect(button(APPLY_LABEL).getAttribute('aria-disabled')).toBe('true')
  await user.click(button(APPLY_LABEL))
  expect(props.onCheck).not.toHaveBeenCalled()
})

test('a line number in a problem points at that line of the formatted code', async () => {
  const user = userEvent.setup()
  // line 5 of the formatted code is the text; in the editor's own one line there is no line 5 at all
  renderDialog({ mjml: ONE_LINE, onCheck: vi.fn((): CheckResult => ({ ok: false, message: 'Line 5: mj-foo isn’t an MJML element.', line: 5, details: [] })) })
  const area = await openEditor(user)
  await user.type(area, ' ')
  await user.click(button(APPLY_LABEL))
  await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Line 5' }))
  const at = area.selectionStart
  expect(area.value.slice(at, area.value.indexOf('\n', at))).toBe('        <mj-text>Hi</mj-text>')
})

test('the Apply button says it is working before the checks run, so a large email never looks frozen', async () => {
  const user = userEvent.setup()
  let busyWhileChecking: string | null = null
  const onCheck = vi.fn((): CheckResult => {
    // busy, the button also carries the spinner's own label, so it is found by the words it keeps
    busyWhileChecking = screen.getByRole('button', { name: new RegExp(APPLY_LABEL) }).getAttribute('aria-busy')
    return { ok: false, message: 'Line 1: nope', line: 1, details: [] }
  })
  renderDialog({ onCheck })
  await user.type(await openEditor(user), ' ')
  await user.click(button(APPLY_LABEL))
  expect(busyWhileChecking).toBe('true')
  // and it is itself again once the answer is in
  expect(button(APPLY_LABEL).getAttribute('aria-busy')).toBeNull()
})
