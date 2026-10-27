/** The component a report is listed under (docs/mockups/report-component.html, option A): chosen in New Report and Ask for a
 * Report, changed beside Folder on the report page and in the editor, any component of the suite; the list's chips follow it. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsReportsNow, insightsSummary, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string, before: () => void = () => undefined) {
  const calls = installMockApi({ me: withInsights as never })
  before()
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

test('New Report: Component starts on Automatic (the dataset’s), offers every component of the suite, and the report is created under the one chosen', async () => {
  const calls = await renderAppAt('/insights/reports/new')
  const user = userEvent.setup()
  const dialog = await screen.findByRole('dialog', { name: 'Create Report' })
  const select = await within(dialog).findByLabelText('Component') as HTMLSelectElement             // step 1, before the data is picked
  expect(select.value).toBe('')
  expect(Array.from(select.options).map((o) => o.text)).toEqual(['Automatic', 'Engagement', 'Insights', 'CRM', 'Sales', 'Purchasing', 'Inventory', 'PIM'])
  await user.selectOptions(select, 'sales')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await user.click(await within(dialog).findByRole('radio', { name: 'Attributed Orders' }))
  await user.click(within(dialog).getByRole('button', { name: 'Create Report' }))
  await screen.findByRole('textbox', { name: 'Report name' })
  expect((calls.find((call) => call.url.endsWith('/insights/reports/') && call.method === 'POST')?.body as Record<string, unknown> | undefined)?.component).toBe('sales')
})

test('New Report opened from a component with no data of its own shows every dataset and files the report there', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/new?component=sales')
  const dialog = await screen.findByRole('dialog', { name: 'Create Report' })
  expect((await within(dialog).findByLabelText('Component') as HTMLSelectElement).value).toBe('sales')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  expect(await within(dialog).findByRole('radio', { name: 'Attributed Orders' })).toBeTruthy()
})

test('the report page: Component beside Folder moves the report at once; the editor saves a change with Save', async () => {
  const calls = await renderAppAt('/insights/reports/rep-1')
  const user = userEvent.setup()
  const component = await screen.findByRole('combobox', { name: 'Component' })
  expect(screen.getByRole('combobox', { name: 'Folder' })).toBeTruthy()
  await user.selectOptions(component, 'inv')
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && (call.body as Record<string, unknown>)?.component === 'inv')).toBe(true))
  expect(insightsReportsNow.find((r) => r.id === 'rep-1')?.component.key).toBe('inv')
  cleanup()

  const edits = await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Component' }), 'crm')
  expect(screen.getByText('Not saved yet')).toBeTruthy()
  await user.click(save)
  await vi.waitFor(() => expect(edits.some((call) => call.method === 'PUT' && (call.body as Record<string, unknown>)?.component === 'crm')).toBe(true))
})

test('Ask for a Report: Add To files the draft, which says so', async () => {
  const calls = await renderAppAt('/insights/ai-reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  const addTo = await within(box).findByRole('combobox', { name: 'Add To' }) as HTMLSelectElement
  expect(addTo.options[0].text).toBe('Automatic')
  await user.selectOptions(addTo, 'sales')
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Sent and delivered by campaign')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'Draft Report' })
  expect((calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.body as Record<string, unknown> | undefined)?.component).toBe('sales')
  expect(within(card).getByText('Component').nextElementSibling?.textContent).toBe('Sales')
})

test('Component offers a component that holds only reports, and narrows the list to its reports', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', () => { insightsReportsNow.push({ ...insightsSummary, id: 'rep-sales', name: 'Takings by Store', component: { key: 'sales', name: 'Sales' } }) })
  const table = await screen.findByRole('table', { name: 'Reports' })
  await user.click(screen.getByRole('button', { name: 'Component' }))
  await user.click(await screen.findByRole('option', { name: 'Sales' }))
  await vi.waitFor(() => expect(within(table).queryByRole('link', { name: 'Sends by campaign' })).toBeNull())
  expect(within(table).getByRole('link', { name: 'Takings by Store' })).toBeTruthy()
})
