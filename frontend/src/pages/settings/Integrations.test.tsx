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
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('are refused until it is resumed'))
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

test('each card charts the last 24 hours from the metrics endpoint: bars to one scale, failed and throttled on top, or a plain note when there were no calls', async () => {
  const calls = installMockApi()
  await renderAppAt('/settings/integrations')

  const cards = await screen.findByRole('list', { name: 'Integrations' })
  const postal = within(cards).getByRole('listitem', { name: 'Postal (self-hosted)' })
  const chart = await within(postal).findByRole('img', { name: /Postal \(self-hosted\): calls per 15 minutes over the last 24 hours, up to 120 at the busiest/ })
  const bars = [...chart.querySelectorAll('rect')]
  expect(bars.filter((bar) => bar.classList.contains('fill-chart-soft'))).toHaveLength(2)                 // two buckets had calls
  expect(bars.filter((bar) => bar.classList.contains('fill-danger-plain'))).toHaveLength(2)
  expect(bars.filter((bar) => bar.classList.contains('fill-warning'))).toHaveLength(1)                    // only one bucket was throttled
  const tallest = bars.find((bar) => bar.classList.contains('fill-chart-soft'))!
  expect(tallest.getAttribute('height')).toBe('44')                                                       // the busiest bucket fills the height
  expect(within(postal).getByText(/Busiest 120 calls at .* · p95 640 ms/)).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/integrations/int-postal/metrics/?hours=24'))).toBe(true)

  const pos = within(cards).getByRole('listitem', { name: 'POS receipts' })
  expect(await within(pos).findByText('No calls in the last 24 hours.')).toBeTruthy()
})

test('the call log is paged: rows per page is chosen and remembered, Previous and Next walk the pages, a new filter starts on page 1', async () => {
  const calls = installMockApi({ integrationLogCount: 60 })
  const user = userEvent.setup()
  await renderAppAt('/settings/integrations')
  const table = await screen.findByRole('table', { name: 'Call Log' })
  expect(within(table).getAllByRole('row')).toHaveLength(26)                                       // 25 rows and the header
  expect(screen.getByText('60 calls · page 1 of 3')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true)

  await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per Page' }), '10')
  await vi.waitFor(() => expect(screen.getByText('60 calls · page 1 of 6')).toBeTruthy())
  expect(within(screen.getByRole('table', { name: 'Call Log' })).getAllByRole('row')).toHaveLength(11)
  expect(window.localStorage.getItem('cep.integrations.logRows')).toBe('10')
  const last = calls.filter((call) => call.url.includes('/integrations/log/?')).at(-1)!
  expect(last.url).toContain('page=1')
  expect(last.url).toContain('page_size=10')

  await user.click(screen.getByRole('button', { name: 'Next' }))
  await vi.waitFor(() => expect(screen.getByText('60 calls · page 2 of 6')).toBeTruthy())
  expect(calls.filter((call) => call.url.includes('/integrations/log/?')).at(-1)!.url).toContain('page=2')
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  await vi.waitFor(() => expect(screen.getByText('60 calls · page 1 of 6')).toBeTruthy())

  await user.click(screen.getByRole('button', { name: 'Next' }))
  await vi.waitFor(() => expect(screen.getByText('60 calls · page 2 of 6')).toBeTruthy())
  await user.click(screen.getByRole('checkbox', { name: 'Failures Only' }))                        // a new question: back to page 1
  await vi.waitFor(() => expect(calls.filter((call) => call.url.includes('/integrations/log/?')).at(-1)!.url).toContain('failed=1'))
  expect(calls.filter((call) => call.url.includes('/integrations/log/?')).at(-1)!.url).toContain('page=1')
})
