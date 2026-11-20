/** Insights → Run Log and Usage (docs/mockups/insights-admin-pages.html, phase A6): the figures, Export CSV, Where, Kind, and Nobody Opened with its ⋯. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import { csvText } from './components/csvFile'

const admin = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  installMockApi({ me: admin as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('Run Log: Export CSV takes the runs the filters show, with their reasons', async () => {
  const user = userEvent.setup()
  const made = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:runs')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  await renderAppAt('/insights/runs')
  await screen.findByRole('table', { name: 'Runs' })
  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  expect(made).toHaveBeenCalledTimes(1)
  const text = await (made.mock.calls[0][0] as Blob).text()
  const lines = text.split('\r\n')
  expect(lines[0]).toBe('When,Report,Dataset,Version,Kind,Who,Outcome,Why,Rows,Time (ms)')
  expect(lines).toHaveLength(1 + 3)
  expect(text).toContain('15 s statement timeout')
})

test('the CSV quotes what needs it', () => {
  expect(csvText(['A', 'B'], [['x, y', 'say "hi"'], [null, 3]])).toBe('A,B\r\n"x, y","say ""hi"""\r\n,3')
})

test('Usage: a Where column, Kind narrows the openings, and the Period chip lives in the address', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/usage')
  const table = await screen.findByRole('table', { name: 'Openings' })
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Report or Dashboard', 'Where', 'Openings', 'People', 'Through Embeds', 'Last Opened'])
  expect(within(table).getByText('Dashboards · Aby John')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /^Kind/ }))
  await user.click(screen.getByRole('option', { name: 'Dashboards' }))
  expect(window.location.search).toBe('?kind=dashboard')
  expect(within(screen.getByRole('table', { name: 'Openings' })).getAllByRole('row')).toHaveLength(1 + 1)
})

test('Nobody Opened: the reports no one opened, each with Open, Move to Folder and Delete', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/usage?tab=unopened')
  const table = await screen.findByRole('table', { name: 'Reports nobody opened in 30 days' })
  expect(within(table).getByRole('link', { name: 'Spring Promo Clicks' })).toBeTruthy()
  await user.click(within(table).getByRole('button', { name: 'Actions for Spring Promo Clicks' }))
  expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open', 'Move to Folder…', 'Delete…'])
  await user.click(screen.getByRole('menuitem', { name: 'Move to Folder…' }))
  expect(await screen.findByRole('dialog', { name: 'Move to Folder' })).toBeTruthy()
})
