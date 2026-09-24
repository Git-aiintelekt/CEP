import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, problem, signIn, tags } from '@/test/mockApi'

// GrapesJS needs a real browser layout engine; the designer itself is checked in the browser playground (/dev/designer).
vi.mock('@/pages/TemplateDesignerPage', () => ({ default: () => <p>designer opened</p> }))
vi.mock('@/pages/ReceiptEditorPage', () => ({ default: () => <p>receipt editor opened</p> }))

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('an email template is created as a draft and the designer opens on it', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/new')

  await user.type(await screen.findByLabelText(/^Name/), 'Holiday Email')
  await user.type(screen.getByLabelText('Description'), 'Early access')
  await user.click(screen.getByRole('button', { name: 'Create and open the designer' }))

  expect(await screen.findByText('designer opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-new/design')
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/templates/'))?.body).toEqual({ name: 'Holiday Email', channel: 'EMAIL', description: 'Early access' })
})

test('an SMS template is created and the message editor opens on it', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/new')

  await user.type(await screen.findByLabelText(/^Name/), 'Holiday SMS')
  await user.selectOptions(screen.getByLabelText(/^Channel/), 'SMS')
  await user.click(screen.getByRole('button', { name: 'Create and write the message' }))

  await screen.findByLabelText('Message')
  expect(window.location.pathname).toBe('/templates/tpl-new/message')
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/templates/'))?.body).toMatchObject({ name: 'Holiday SMS', channel: 'SMS' })
})

test('an e-receipt template opens the receipt editor, not the email designer', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/new')

  await user.type(await screen.findByLabelText(/^Name/), 'Store receipt')
  await user.selectOptions(screen.getByLabelText(/^Channel/), 'E_RECEIPT')
  expect(screen.getByText('Transactional receipt email. Opens the receipt editor.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Create and open the receipt editor' }))

  expect(await screen.findByText('receipt editor opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-new/receipt')
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/templates/'))?.body).toMatchObject({ name: 'Store receipt', channel: 'E_RECEIPT' })
})

test('a starter is offered for the channel, previewed with sample values, pre-fills the name and is sent with the create call', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/new')

  const card = await screen.findByRole('radio', { name: /Sale announcement/ })
  expect(screen.queryByRole('radio', { name: /SMS offer/ })).toBeNull() // other channel
  expect((screen.getByTitle('Sale announcement preview') as HTMLIFrameElement).srcdoc).toContain('Hi Jordan')
  expect((screen.getByTitle('Sale announcement preview') as HTMLIFrameElement).getAttribute('sandbox')).toBe('')
  expect(screen.getByRole('radio', { name: /Blank/ }).getAttribute('aria-checked')).toBe('true')

  await user.click(card)
  expect(card.getAttribute('aria-checked')).toBe('true')
  expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Sale announcement')

  await user.click(screen.getByRole('button', { name: 'Create and open the designer' }))
  expect(await screen.findByText('designer opened')).toBeTruthy()
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/templates/'))?.body).toMatchObject({ name: 'Sale announcement', channel: 'EMAIL', starter: 'promotion' })
})

test('a starter thumbnail falls back to the default when a tag’s sample is empty, as the preview does', async () => {
  const was = tags[0]
  tags[0] = { ...was, sample_value: '', default_value: 'there' }
  try {
    installMockApi()
    await renderAppAt('/templates/new')
    await screen.findByRole('radio', { name: /Sale announcement/ })
    const thumbnail = screen.getByTitle('Sale announcement preview') as HTMLIFrameElement
    expect(thumbnail.srcdoc).toContain('Hi there')
    expect(thumbnail.srcdoc).not.toContain('{{first_name}}')
    // a thumbnail is the email itself: none of the preview's marks
    expect(thumbnail.srcdoc).not.toMatch(/cep-pv-|no value/)
  } finally {
    tags[0] = was
  }
})

test('starters are grouped by category with counts, and a category narrows the gallery', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/new')
  await screen.findByRole('radio', { name: /Sale announcement/ })

  const rows = screen.getAllByRole('button', { name: /, \d+ starters?$/ })
  expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['All, 2 starters', 'Promotion, 1 starter', 'Newsletter, 1 starter'])
  expect(rows[0].getAttribute('aria-pressed')).toBe('true')

  await user.click(screen.getByRole('button', { name: 'Newsletter, 1 starter' }))
  expect(screen.queryByRole('radio', { name: /Sale announcement/ })).toBeNull()
  expect(screen.getByRole('radio', { name: /Monthly newsletter/ })).toBeTruthy()
  expect(screen.getByRole('radio', { name: /Blank/ })).toBeTruthy() // Blank is always on offer

  // another channel has categories of its own, and the filter starts over
  await user.selectOptions(screen.getByLabelText(/^Channel/), 'SMS')
  expect((await screen.findByRole('button', { name: 'All, 1 starter' })).getAttribute('aria-pressed')).toBe('true')
})

test('the preview button opens the whole starter in a dialog, from which it can be chosen', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/new')
  await screen.findByRole('radio', { name: /Sale announcement/ })

  await user.click(screen.getByRole('button', { name: 'Preview Sale announcement' }))
  const dialog = screen.getByRole('dialog', { name: 'Sale announcement' })
  expect(dialog.textContent).toContain('Promotion · A time-limited offer.')
  const frame = screen.getByTitle('Sale announcement full preview') as HTMLIFrameElement
  expect(frame.srcdoc).toContain('Hi Jordan')
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(screen.getByRole('radio', { name: /Sale announcement/ }).getAttribute('aria-checked')).toBe('false')

  await user.click(screen.getByRole('button', { name: 'Use this starter' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('radio', { name: /Sale announcement/ }).getAttribute('aria-checked')).toBe('true')
  expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Sale announcement')
})

test('changing the channel swaps the starters and clears the choice', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/new')

  await user.click(await screen.findByRole('radio', { name: /Sale announcement/ }))
  await user.selectOptions(screen.getByLabelText(/^Channel/), 'SMS')
  expect(await screen.findByRole('radio', { name: /SMS offer/ })).toBeTruthy()
  expect(screen.getByText('Hi Jordan, code FALL017. Reply STOP to opt out.')).toBeTruthy()
  expect(screen.getByRole('radio', { name: /Blank/ }).getAttribute('aria-checked')).toBe('true')

  await user.click(screen.getByRole('button', { name: 'Create and write the message' }))
  await screen.findByLabelText('Message')
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/templates/'))?.body).not.toHaveProperty('starter')
})

test('a duplicate name reported by the API is shown on the name field', async () => {
  installMockApi({ onSaveTemplate: () => problem(400, { title: 'Invalid input', errors: { name: ['Another template already has this name.'] } }) })
  const user = userEvent.setup()
  await renderAppAt('/templates/new')

  await user.type(await screen.findByLabelText(/^Name/), 'Fall Email')
  await user.click(screen.getByRole('button', { name: 'Create and open the designer' }))

  expect(await screen.findByText('Another template already has this name.')).toBeTruthy()
  expect(screen.getByLabelText(/^Name/).getAttribute('aria-invalid')).toBe('true')
})
