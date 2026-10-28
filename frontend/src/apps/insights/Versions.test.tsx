/** The report viewer's Versions drawer: the list, Open showing an earlier version read-only, Back to Current, and Restore making a new version. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  installMockApi({ me: withInsights as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Versions lists every saved version; Open shows one read-only with a way back; Restore makes it the current version again', async () => {
  const user = userEvent.setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await screen.findByRole('region', { name: 'Report rows' })
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  await user.click(screen.getByRole('menuitem', { name: 'Versions' }))
  const drawer = await screen.findByRole('dialog', { name: 'Versions' })
  const items = await within(drawer).findAllByRole('listitem')
  expect(items.map((item) => item.textContent)).toEqual([expect.stringContaining('Version 2Current'), expect.stringContaining('Version 1')])
  expect(items[1].textContent).toContain('Created')
  await user.click(within(items[1]).getByRole('button', { name: 'Open' }))
  await screen.findByRole('status')
  expect(screen.getByRole('status').textContent).toContain('Showing version 1 of 2')
  await screen.findByRole('region', { name: 'Version 1 rows' })
  await user.click(screen.getByRole('button', { name: 'Back to Current' }))
  await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  await screen.findByRole('region', { name: 'Report rows' })
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  await user.click(screen.getByRole('menuitem', { name: 'Versions' }))
  const again = await screen.findByRole('dialog', { name: 'Versions' })
  await user.click(within(again).getByRole('button', { name: 'Restore' }))
  await screen.findByText(/version 3/)
  expect(window.confirm).toHaveBeenCalledWith('Restore version 1? It becomes the current version, as version 3.')
})
