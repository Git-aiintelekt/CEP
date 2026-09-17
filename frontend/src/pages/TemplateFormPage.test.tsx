import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, problem, signIn } from '@/test/mockApi'

// GrapesJS needs a real browser layout engine; the designer itself is checked in the browser playground (/dev/designer).
vi.mock('@/pages/TemplateDesignerPage', () => ({ default: () => <p>designer opened</p> }))

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
