/** Create Report (docs/mockups/create-report-dialog-v2.html): step 1's name, component and ways to start (Ask AI only with AI
 * Reports), step 2's data with search, and Upload a File set up inside the pop-up through to the editor. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = (aiReports: boolean) => ({ ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }],
  insights: { mode: 'integrated', standalone_path: '/insights', ai_reports: aiReports } })

async function renderAppAt(path: string, aiReports = true) {
  const calls = installMockApi({ me: withInsights(aiReports) as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

const dialog = () => screen.findByRole('dialog', { name: 'Create Report' })
const tiles = (box: HTMLElement) => within(within(box).getByRole('radiogroup', { name: 'How Do You Want to Start?' })).getAllByRole('radio').map((tile) => tile.getAttribute('aria-labelledby') && document.getElementById(tile.getAttribute('aria-labelledby') as string)?.textContent)

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('New Report on the list opens Create Report over it; step 1 offers Ask AI only where AI Reports is', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports')
  await user.click(await screen.findByRole('button', { name: 'New Report' }))
  const box = await dialog()
  expect(window.location.pathname).toBe('/insights/reports/new')
  expect(within(box).getByText('Step 1 of 2 · Name and How to Start')).toBeTruthy()
  expect(tiles(box)).toEqual(['Start from Data', 'Ask AI', 'Use Base Reports', 'Write a Query'])
  expect(within(box).getByRole('radio', { name: 'Start from Data' }).getAttribute('aria-checked')).toBe('true')
  await user.click(within(box).getByRole('button', { name: 'Cancel' }))
  expect(window.location.pathname).toBe('/insights/reports')
  cleanup()
  const without = await renderAppAt('/insights/reports/new', false)
  void without
  expect(tiles(await dialog())).toEqual(['Start from Data', 'Use Base Reports', 'Write a Query'])
})

test('Ask AI takes the name to AI Reports; Use Base Reports opens the packs', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/new')
  let box = await dialog()
  await user.type(within(box).getByLabelText('Report Name'), 'Store Leaderboard')
  await user.click(within(box).getByRole('radio', { name: 'Ask AI' }))
  await user.click(within(box).getByRole('button', { name: 'Open AI Reports' }))
  expect(window.location.pathname).toBe('/insights/ai-reports')
  const ask = await screen.findByRole('region', { name: 'Ask for a Report' })
  expect((within(ask).getByRole('textbox', { name: 'Report Name' }) as HTMLInputElement).value).toBe('Store Leaderboard')
  cleanup()
  await renderAppAt('/insights/reports/new')
  box = await dialog()
  await user.click(within(box).getByRole('radio', { name: 'Use Base Reports' }))
  await user.click(within(box).getByRole('button', { name: 'Choose a Pack' }))
  expect(await screen.findByRole('dialog', { name: 'Add Base Reports' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'Create Report' })).toBeNull()
})

test('step 2: the data in plain words, a search across it, and Back to step 1 keeps the name', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/new')
  const box = await dialog()
  await user.type(within(box).getByLabelText('Report Name'), 'Sends by Week')
  await user.click(within(box).getByRole('button', { name: 'Next' }))
  const c360 = await within(box).findByRole('region', { name: 'C360 Data' })
  expect(within(box).getByText('Step 2 of 2 · Choose Your Data')).toBeTruthy()
  expect(within(c360).queryByText(/dimensions/)).toBeNull()
  await user.type(within(box).getByRole('searchbox', { name: 'Search your data' }), 'orders')
  expect(within(within(box).getByRole('region', { name: 'C360 Data' })).getAllByRole('radio').map((card) => card.getAttribute('aria-label'))).toEqual(['Attributed Orders'])
  await user.click(within(box).getByRole('button', { name: 'Back' }))
  expect((within(box).getByLabelText('Report Name') as HTMLInputElement).value).toBe('Sends by Week')
  await user.click(within(box).getByRole('button', { name: 'Next' }))
  await user.click(await within(box).findByRole('radio', { name: 'Messages' }))
  await user.click(within(box).getByRole('button', { name: 'Create Report' }))
  await screen.findByRole('textbox', { name: 'Report name' })
  expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/insights/reports/'))?.body).toMatchObject({ name: 'Sends by Week', dataset: 'messages' })
})

test('Upload a File inside the pop-up: drop it, review the columns, and Save and Create Report opens the editor on it', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/new')
  const box = await dialog()
  await user.click(within(box).getByRole('button', { name: 'Next' }))
  await user.click(within(await within(box).findByRole('region', { name: 'Your Files' })).getByRole('button', { name: /Upload a File/ }))
  expect(within(box).getByRole('navigation', { name: 'Where you are' }).textContent).toContain('Upload a File')
  expect(await within(box).findByText(/Up to 100,000 rows, 50 columns and 20 MB\./)).toBeTruthy()
  await user.upload(within(box).getByLabelText('Choose a file to upload'), new File(['Store,Sales,Opened\nDowntown,1234.5,2026-10-19\n'], 'store_sales.csv', { type: 'text/csv' }))
  expect(await within(box).findByText('store_sales.csv · 3 rows · 3 columns')).toBeTruthy()
  await user.selectOptions(within(box).getByLabelText('Sales use'), 'A Measure (Adds Up)')
  await user.click(within(box).getByRole('button', { name: 'Save and Create Report' }))
  await screen.findByRole('textbox', { name: 'Report name' }, { timeout: 5000 })
  expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/insights/uploads/upl-1/'))?.body).toMatchObject({ ready: true })
  const posted = calls.find((c) => c.method === 'POST' && c.url.endsWith('/insights/reports/'))?.body as { dataset: string }
  expect(posted.dataset).toMatch(/store_sales/)
})
