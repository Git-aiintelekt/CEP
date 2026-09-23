import { cleanup, render, screen, within } from '@testing-library/react'
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
