import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('integrations show a status card per system with the day’s figures, and pausing one asks first', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/integrations')

  const cards = await screen.findByRole('list', { name: 'Integrations' })
  const pos = within(cards).getByRole('listitem', { name: 'POS receipts' })
  expect(within(pos).getByText('Healthy')).toBeTruthy()
  expect(within(pos).getByText('POS · 600 per minute')).toBeTruthy()
  expect(within(pos).getByText('1,240')).toBeTruthy()
  const postal = within(cards).getByRole('listitem', { name: 'Postal (self-hosted)' })
  expect(within(postal).getByText('Circuit Open')).toBeTruthy()
  expect(within(postal).getByText('6.4%')).toBeTruthy()
  expect(within(postal).getByText(/Circuit open for 42 s more after 5 failures in a row/)).toBeTruthy()

  await user.click(within(pos).getByRole('button', { name: 'Pause' }))
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('answered 503'))
  await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/integrations/int-pos/pause/') && call.method === 'POST')).toBe(true))
})

test('the call log lists both directions, filters by what a card asks for, and opens a call with its masked request and the answer', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/integrations')

  const table = await screen.findByRole('table', { name: 'Call Log' })
  expect(within(table).getByText('Received · receipt:R-1001')).toBeTruthy()
  expect(within(table).getByText('Sent · receipt:R-1001')).toBeTruthy()
  expect(within(table).getByText('Retried')).toBeTruthy()

  await user.click(within(table).getByText('Received · receipt:R-1001'))
  const dialog = await screen.findByRole('dialog', { name: /POST Received/ })
  expect(within(dialog).getByText('pos-corr-0001')).toBeTruthy()
  expect(within(dialog).getByText('What Was Received')).toBeTruthy()
  expect(within(dialog).getByText(/"card_number": "\*\*\*"/)).toBeTruthy()
  expect(within(dialog).getByText(/"execution_id": 7/)).toBeTruthy()
  await user.keyboard('{Escape}')

  const cards = await screen.findByRole('list', { name: 'Integrations' })
  await user.click(within(within(cards).getByRole('listitem', { name: 'Postal (self-hosted)' })).getByRole('button', { name: 'View Log' }))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Call Log' })).queryByText('Received · receipt:R-1001')).toBeNull())
  expect((screen.getByLabelText('Integration') as HTMLSelectElement).value).toBe('int-postal')
  const filtered = calls.filter((call) => call.url.includes('/integrations/log/?')).at(-1)
  expect(filtered?.url).toContain('integration=int-postal')

  await user.type(screen.getByLabelText('Correlation ID or Reference'), 'nothing-here{Enter}')
  expect(await screen.findByText('No Calls Match')).toBeTruthy()
})
