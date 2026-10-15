/** Insights favourites and folders: the star puts a report first under Favourites; the folder chips filter; the viewer files a report, into a new folder too. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

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

test('the star puts a report under Favourites, first; off again, it goes back to its component', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports')
  const table = await screen.findByRole('table', { name: 'Reports' })
  expect(within(table).queryByText('Favourites')).toBeNull()
  await user.click(within(table).getByRole('button', { name: 'Add Sends by campaign to favourites' }))
  await within(table).findByText('Favourites')
  const groups = within(table).getAllByRole('rowgroup').at(-1) as HTMLElement
  expect(within(groups).getAllByRole('row')[0].textContent).toContain('Favourites')
  await user.click(within(table).getByRole('button', { name: 'Remove Sends by campaign from favourites' }))
  await vi.waitFor(() => expect(within(table).queryByText('Favourites')).toBeNull())
})

test('the viewer files the report in a folder, or in a new one; the list shows the folder and filters by it', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Folder' }), 'fold-1')
  await vi.waitFor(() => expect((screen.getByRole('combobox', { name: 'Folder' }) as HTMLSelectElement).value).toBe('fold-1'))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Folder' }), '__new__')
  const dialog = await screen.findByRole('dialog', { name: 'New Folder' })
  await user.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Weekly Review')
  await user.click(within(dialog).getByRole('button', { name: 'Make Folder' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await vi.waitFor(() => expect((screen.getByRole('combobox', { name: 'Folder' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Weekly Review'))
  await user.click(screen.getByRole('link', { name: 'All Reports' }))
  const table = await screen.findByRole('table', { name: 'Reports' })
  await within(table).findByText('Weekly Review')
  await user.click(screen.getByRole('button', { name: 'Finance' }))
  await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Sends by campaign' })).toBeNull())
  await user.click(screen.getByRole('button', { name: 'Weekly Review' }))
  expect(await screen.findByRole('link', { name: 'Sends by campaign' })).toBeTruthy()
})
