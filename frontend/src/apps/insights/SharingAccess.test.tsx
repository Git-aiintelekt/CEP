/** Sharing with people and roles, row access rules, drill-through to a detail report, and the new time measures in the editor. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsCatalog, insightsRunExtras, installMockApi, me, signIn } from '@/test/mockApi'
import { compareOptions, setTarget } from './editor/definition'
import type { CatalogDataset, ReportDefinition } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  const calls = installMockApi({ me: withInsights as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Share: find a role, let it edit, and Save sends the list as a whole', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  await screen.findByRole('heading', { name: 'Sends by campaign' })
  await user.click(screen.getByRole('button', { name: 'Share' }))
  const dialog = await screen.findByRole('dialog', { name: 'Share Report' })
  await within(dialog).findByText('Not shared with anyone yet.')
  await user.type(within(dialog).getByRole('searchbox', { name: 'Find a person or a role' }), 'Store')
  await user.click(await within(dialog).findByRole('button', { name: /Store Managers/ }))
  const shared = within(dialog).getByRole('list', { name: 'Shared with' })
  await user.selectOptions(within(shared).getByRole('combobox', { name: 'Store Managers can' }), 'edit')
  await user.click(within(dialog).getByRole('radio', { name: 'You and the people and roles below' }))
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Share Report' })).toBeNull())
  const put = calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/insights/reports/rep-1/shares/')).at(-1)
  expect(put?.body).toEqual({ visibility: 'PRIVATE', shares: [{ kind: 'role', id: 'r1', permission: 'edit' }] })
})

test('Report Access: the rules are listed, and Add a Rule limits a person to values of a field', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/settings/report-access')
  const table = await screen.findByRole('table', { name: 'Rules' }, { timeout: 5000 })
  expect(within(table).getByText('Store Managers')).toBeTruthy()
  expect(within(table).getByText('Channel: SMS')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add a Rule' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Rule' })
  await user.type(within(dialog).getByRole('searchbox', { name: 'Find a person or a role' }), 'Maya')
  await user.click(await within(dialog).findByRole('button', { name: /Maya Chen/ }))
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Field/ }), 'campaign_name')
  await user.type(within(dialog).getByRole('textbox', { name: /^Sees Only/ }), 'Fall Launch, Weekly Newsletter')
  await user.click(within(dialog).getByRole('button', { name: 'Add Rule' }))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Rules' })).getByText('Maya Chen')).toBeTruthy())
  const posted = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/insights/row-rules/')).at(-1)
  expect(posted?.body).toMatchObject({ dataset: 'messages', field: 'campaign_name', principal: { kind: 'user', id: 'u2' }, values: ['Fall Launch', 'Weekly Newsletter'] })
})

test('a person under a rule is told what their access shows', async () => {
  installMockApi({ me: withInsights as never })
  insightsRunExtras.access = [{ field: 'channel', label: 'Channel', values: ['SMS'] }]
  signIn('/insights/reports/rep-1')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  expect(await screen.findByText('Your access shows only Channel: SMS.')).toBeTruthy()
})

test('drill-through: a right-click on a Channel value offers the detail report, which opens filtered to it and says where from', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1')
  const grid = await screen.findByRole('region', { name: 'Report rows' })
  const cell = (await within(grid).findAllByText('SMS'))[0].closest('[role="gridcell"]') as HTMLElement
  fireEvent.contextMenu(cell, { clientX: 300, clientY: 200 })
  const menu = await screen.findByRole('menu', { name: 'Drill Through' })
  expect(within(menu).getByText('Drill Through · Channel: SMS')).toBeTruthy()
  await user.click(await within(menu).findByRole('menuitem', { name: 'Campaigns for a Channel' }))
  await screen.findByRole('heading', { name: 'Campaigns for a Channel' })
  expect(await screen.findByText('Opened from Sends by campaign: Channel is SMS.')).toBeTruthy()
  const run = calls.filter((call) => call.url.endsWith('/insights/reports/rep-detail/run/')).at(-1)
  expect((run?.body as { through?: unknown } | undefined)?.through).toEqual([{ field: 'channel', value: 'SMS' }])
  await user.click(screen.getByRole('button', { name: 'Show All Rows' }))
  await vi.waitFor(() => expect(screen.queryByText(/Opened from/)).toBeNull())
})

test('Detail Report in the editor saves the fields others can open the report through', async () => {
  const user = userEvent.setup()
  window.localStorage.setItem('insights.editor', 'wells')
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  await user.click(screen.getByRole('button', { name: 'Detail Report' }))
  const dialog = await screen.findByRole('dialog', { name: 'Detail Report' })
  await user.click(within(dialog).getByRole('checkbox', { name: 'Channel' }))
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(screen.getByRole('button', { name: 'Detail Report · 1' })).toBeTruthy()
  const save = screen.getByRole('button', { name: 'Save' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  await user.click(save)
  await vi.waitFor(() => {
    const put = calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/insights/reports/rep-1/')).at(-1)?.body as { definition?: ReportDefinition } | undefined
    expect(put?.definition?.drillthrough).toEqual(['channel'])
  })
})

test('the new time measures: their names follow the date, year to date adds up sums and counts only, a target is a number on the column', () => {
  const messages = insightsCatalog.datasets[0] as unknown as CatalogDataset
  const monthly: ReportDefinition = { columns: [{ field: 'submitted_at', bucket: 'month' }, { field: 'sent', aggregate: 'sum' }] }
  const labels = compareOptions(messages, monthly, monthly.columns[1]).map((o) => o.label)
  expect(labels).toEqual(expect.arrayContaining(['Year to Date', 'Quarter to Date', 'Moving Average (3 Months)', 'Rank', '% of Target', 'Difference to Target']))
  const averaged = compareOptions(messages, monthly, { field: 'sent', aggregate: 'avg' })
  expect(averaged.find((o) => o.kind === 'year_to_date')?.reason).toBe('adds up sums and counts only')
  expect(averaged.find((o) => o.kind === 'rank')?.reason).toBeUndefined()
  expect(setTarget(monthly, 'sent', 50000).columns[1]).toEqual({ field: 'sent', aggregate: 'sum', target: 50000 })
  expect(setTarget(setTarget(monthly, 'sent', 50000), 'sent', undefined).columns[1]).toEqual({ field: 'sent', aggregate: 'sum' })
})
