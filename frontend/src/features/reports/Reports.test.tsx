import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const lastCall = (calls: { url: string; method: string }[], part: string) => calls.filter((call) => call.url.includes(part)).at(-1)

test('Reports is in the navigation for someone with report.view, and shows the period: tiles, the chart, best and worst, the campaigns', async () => {
  installMockApi()
  await renderAppAt('/reports')

  expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByText('Reports')).toBeTruthy()
  expect(await screen.findByText('18,402')).toBeTruthy()                                                  // sent
  expect(screen.getByText('97.4%')).toBeTruthy()                                                          // delivered
  expect(screen.getByText('3 campaigns · 2 channels')).toBeTruthy()
  expect(screen.getByText('Sent and Opened by Day')).toBeTruthy()
  const best = screen.getByRole('heading', { name: 'Best and Worst' }).closest('section') as HTMLElement
  expect(within(best).getAllByText('Fall Launch')).toHaveLength(2)                                        // highest open and click rate
  expect(within(best).getByText('10:00–11:00')).toBeTruthy()
  const table = screen.getByRole('table', { name: 'Campaigns in the period' })
  expect(within(table).getByText('Spring Clearance')).toBeTruthy()
})

test('the period and channel go to the API; a custom range with the end before the start is refused', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/reports')
  await screen.findByText('18,402')

  await user.click(screen.getByRole('radio', { name: 'Last 7 Days' }))
  await vi.waitFor(() => expect(new URL(lastCall(calls, '/reports/summary/')!.url, 'http://x').searchParams.get('from')).not.toBe(null))
  await user.click(screen.getByRole('radio', { name: 'SMS' }))
  await vi.waitFor(() => expect(new URL(lastCall(calls, '/reports/summary/')!.url, 'http://x').searchParams.get('channel')).toBe('SMS'))
  const table = await screen.findByRole('table', { name: 'Campaigns in the period' })
  await vi.waitFor(() => expect(within(table).queryByText('Fall Launch')).toBeNull())

  await user.click(screen.getByRole('radio', { name: 'Custom' }))
  const from = screen.getByLabelText('From') as HTMLInputElement
  const to = screen.getByLabelText('To') as HTMLInputElement
  await user.clear(from)
  await user.type(from, '2026-09-20')
  await user.clear(to)
  await user.type(to, '2026-09-10')
  expect(await screen.findByText('Choose a start date on or before the end date.')).toBeTruthy()
})

test('two to six campaigns can be compared side by side', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/reports')
  await screen.findByText('18,402')

  const compare = screen.getByRole('button', { name: /Compare/ }) as HTMLButtonElement
  expect(compare.disabled).toBe(true)
  await user.click(screen.getByRole('checkbox', { name: 'Select Fall Launch' }))
  expect(compare.disabled).toBe(true)
  await user.click(screen.getByRole('checkbox', { name: 'Select Spring Clearance' }))
  await user.click(screen.getByRole('button', { name: 'Compare 2 Selected' }))

  const dialog = await screen.findByRole('dialog', { name: 'Compare Campaigns' })
  expect(lastCall(calls, '/reports/compare/')?.url).toContain('ids=c1%2Cc2')
  const table = await within(dialog).findByRole('table', { name: 'Campaign results side by side' })
  const openRow = within(table).getByRole('rowheader', { name: 'Open Rate' }).closest('tr') as HTMLElement
  expect(within(openRow).getByText('43.6%')).toBeTruthy()
  expect(within(openRow).getByText('40.3%')).toBeTruthy()
})

test('the Journeys dataset: tiles, the day curve, one row per journey, the journey filter and its own CSV', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/reports')
  await screen.findByText('18,402')

  await user.click(screen.getByRole('radio', { name: 'Journeys' }))
  expect(await screen.findByText('452')).toBeTruthy()                                                     // entered
  expect(screen.getByText('Entered and Converted by Day')).toBeTruthy()
  const table = screen.getByRole('table', { name: 'Journeys in the period' })
  expect(within(table).getByRole('link', { name: 'Welcome Series' }).getAttribute('href')).toBe('/journeys/j1')
  expect(within(table).getByText('Win-Back Lapsed Customers')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Schedule Report' })).toBeNull()

  await user.selectOptions(screen.getByLabelText('Journey'), 'j2')
  await vi.waitFor(() => expect(new URL(lastCall(calls, '/reports/journeys/')!.url, 'http://x').searchParams.get('journey')).toBe('j2'))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Journeys in the period' })).queryByText('Welcome Series')).toBeNull())

  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  await vi.waitFor(() => expect(lastCall(calls, '/reports/journeys.csv')).toBeTruthy())
  expect(lastCall(calls, '/reports/journeys.csv')?.url).toContain('journey=j2')
})

test('Export CSV downloads the period\'s campaigns', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/reports')
  await screen.findByText('18,402')
  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  await vi.waitFor(() => expect(lastCall(calls, '/reports/campaigns.csv')).toBeTruthy())
  expect(URL.createObjectURL).toHaveBeenCalled()
})

test('the weekly report is scheduled by an administrator; a bad address is shown on its field', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/reports')
  await screen.findByText('18,402')

  await user.click(screen.getByRole('button', { name: 'Schedule Report' }))
  const dialog = await screen.findByRole('dialog', { name: 'Schedule Report' })
  await user.click(await within(dialog).findByRole('switch', { name: 'Send the Weekly Report' }))
  await user.selectOptions(within(dialog).getByLabelText('Day'), 'Friday')
  await user.selectOptions(within(dialog).getByLabelText('Time'), '09:00')
  await user.type(within(dialog).getByLabelText('Recipients'), 'ops@example.com, nobody')
  await user.click(within(dialog).getByRole('button', { name: 'Save Schedule' }))
  expect(await within(dialog).findByText('nobody is not an email address.')).toBeTruthy()

  await user.clear(within(dialog).getByLabelText('Recipients'))
  await user.type(within(dialog).getByLabelText('Recipients'), 'ops@example.com')
  await user.click(within(dialog).getByRole('button', { name: 'Save Schedule' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const put = calls.filter((call) => call.method === 'PUT' && call.url.includes('/reports/schedule/')).at(-1)
  expect(put?.body).toEqual({ enabled: true, weekday: 4, hour: 9, recipients: ['ops@example.com'] })
})

test('without report.view there is no Reports in the navigation, and the page says why', async () => {
  installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: me.principal.permissions.filter((code) => code !== 'report.view') } } })
  await renderAppAt('/reports')
  expect(await screen.findByText('Reports need the report.view permission')).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByText('Reports')).toBeNull()
})
