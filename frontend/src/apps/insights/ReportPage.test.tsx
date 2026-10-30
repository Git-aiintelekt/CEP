/** The report page's header (docs/mockups/report-page.html): a back arrow, the description, when it ran with Refresh, and
 * Report Details, a drawer with the report's facts whose links open the page's own dialogs. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsReport, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderReport(before: () => void = () => undefined) {
  installMockApi({ me: withInsights as never })
  before()
  signIn('/insights/reports/rep-1')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  await screen.findByRole('heading', { name: 'Sends by campaign' })
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  ;(insightsReport as { description: string | null }).description = null
})

test('the header: a Reports link back to the list, the description, and when it ran beside Refresh; no breadcrumb, Folder or Component', async () => {
  await renderReport(() => { (insightsReport as { description: string | null }).description = 'Sends and deliveries by campaign.' })
  expect(within(screen.getByRole('main')).getByRole('link', { name: 'Reports' }).getAttribute('href')).toBe('/insights/reports')
  expect(screen.getByText('Sends and deliveries by campaign.')).toBeTruthy()
  expect(await screen.findByText(/^Updated /)).toBeTruthy()
  expect(screen.getByText(/3 rows · 42 ms · live data · version 2/)).toBeTruthy()          // the details, for screen readers and on hover
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'All Reports' })).toBeNull()
  expect(screen.queryByRole('combobox', { name: 'Folder' })).toBeNull()
  expect(screen.queryByRole('combobox', { name: 'Component' })).toBeNull()
})

test('Report Details opens from its button and from More Actions, and says who owns it, its data and its version', async () => {
  const user = userEvent.setup()
  await renderReport()
  await user.click(screen.getByRole('button', { name: 'Report Details' }))
  const details = await screen.findByRole('dialog', { name: 'Report Details' })
  expect(within(details).getByText('Aby John')).toBeTruthy()
  expect(within(details).getByText(/Everyone in the workspace/)).toBeTruthy()
  expect(within(details).getByText('No description yet.')).toBeTruthy()
  expect(within(details).getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/insights/reports/rep-1/edit')
  expect(within(details).getByRole('combobox', { name: 'Folder' })).toBeTruthy()
  expect(within(details).getByRole('combobox', { name: 'Component' })).toBeTruthy()
  await user.click(within(details).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog', { name: 'Report Details' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Report Details' }))
  expect(await screen.findByRole('dialog', { name: 'Report Details' })).toBeTruthy()
})

test('a Report Details link closes the drawer and opens the page’s own dialog', async () => {
  const user = userEvent.setup()
  await renderReport()
  await user.click(screen.getByRole('button', { name: 'Report Details' }))
  const details = await screen.findByRole('dialog', { name: 'Report Details' })
  await user.click(within(details).getByRole('button', { name: 'See Versions' }))
  expect(screen.queryByRole('dialog', { name: 'Report Details' })).toBeNull()
  expect(await screen.findByRole('dialog', { name: /Versions/ })).toBeTruthy()
})

test('Help With Reports in More Actions opens the Insights help', async () => {
  const user = userEvent.setup()
  await renderReport()
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Help With Reports' }))
  await vi.waitFor(() => expect(document.querySelector('[data-help-panel="insights"]')).toBeTruthy())
})
