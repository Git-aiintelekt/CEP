import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

// the editors themselves are tested on their own; here only where each template leads
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

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

test('each template links to its own editor: email to the designer, e-receipt to the receipt editor, SMS to the message editor', async () => {
  installMockApi()
  await renderAppAt('/templates')
  await screen.findByText('Northline order receipt')

  expect(within(rowOf('Fall Email')).getByRole('link', { name: 'Open designer' }).getAttribute('href')).toBe('/templates/tpl-email/design')
  expect(within(rowOf('Northline order receipt')).getByRole('link', { name: 'Open editor' }).getAttribute('href')).toBe('/templates/tpl-receipt/receipt')
  expect(within(rowOf('Fall SMS')).getByRole('link', { name: 'Open editor' }).getAttribute('href')).toBe('/templates/tpl-sms/message')
})

test('clicking an e-receipt row opens the receipt editor', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates')
  await user.click(await screen.findByText('Northline order receipt'))

  expect(await screen.findByText('receipt editor opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-receipt/receipt')
})

test('the row menu duplicates a template as a draft copy and opens it in its editor, without opening the row itself', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates')
  await screen.findByText('Fall Email')

  await user.click(within(rowOf('Fall Email')).getByRole('button', { name: 'Actions for Fall Email' }))
  expect(window.location.pathname).toBe('/templates') // the menu button did not open the designer under it
  await user.click(screen.getByRole('menuitem', { name: /Duplicate/ }))

  expect(await screen.findByText('designer opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-email-copy/design')
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/templates/tpl-email/clone/'))).toBe(true)
})

test('deleting asks first, then removes the row', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates')
  await screen.findByText('Fall SMS')

  await user.click(within(rowOf('Fall SMS')).getByRole('button', { name: 'Actions for Fall SMS' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(screen.getByRole('dialog', { name: 'Delete this template?' })).toBeTruthy()
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

  await user.click(screen.getByRole('button', { name: 'Delete template' }))
  await waitFor(() => expect(screen.queryByText('Fall SMS')).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/templates/tpl-sms/'))).toBe(true)
})

test('a template a campaign uses cannot be deleted: the dialog says why and stays open', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates')
  await screen.findByText('Fall Email')

  await user.click(within(rowOf('Fall Email')).getByRole('button', { name: 'Actions for Fall Email' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Delete template' }))

  expect((await screen.findByRole('alert')).textContent).toContain('This template is used by a campaign. Archive it instead.')
  expect(screen.getByRole('dialog', { name: 'Delete this template?' })).toBeTruthy()
  expect(screen.getByText('Fall Email')).toBeTruthy()
})
