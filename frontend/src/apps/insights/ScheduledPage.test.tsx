/** Insights → Scheduled (docs/mockups/insights-admin-pages.html, phase A2): the two tabs, the filters, New Schedule and New Alert in two steps, Edit opening on step 2. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsAlertsNow, installMockApi, me, signIn } from '@/test/mockApi'

const admin = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  const calls = installMockApi({ me: admin as never })
  insightsAlertsNow.splice(0, insightsAlertsNow.length)
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

async function newSchedule(user: ReturnType<typeof userEvent.setup>, pick: RegExp) {
  await user.click(await screen.findByRole('button', { name: 'New Schedule' }))
  const dialog = await screen.findByRole('dialog', { name: 'New Schedule' })
  expect(within(dialog).getByText('Step 1 of 2 · What to Send')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(await within(dialog).findByRole('button', { name: pick }))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  expect(within(dialog).getByText('Step 2 of 2 · When and to Whom')).toBeTruthy()
  return dialog
}

test('New Schedule: pick a dashboard, then when and to whom; PDF is chosen for a dashboard and the sentence sums it up', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/scheduled')
  const dialog = await newSchedule(user, /^Marketing Weekly/)
  expect((within(dialog).getByRole('radio', { name: /^PDF/ }) as HTMLInputElement).checked).toBe(true)
  expect((within(dialog).getByRole('radio', { name: /^Excel/ }) as HTMLInputElement).disabled).toBe(true)
  await user.type(within(dialog).getByRole('textbox', { name: 'To' }), 'sam@northwind.example aby@northwind.example{Enter}')
  expect(within(dialog).getByRole('status').textContent).toBe('Every Monday at 08:00, Marketing Weekly goes to 2 people as a PDF.')
  await user.click(within(dialog).getByRole('button', { name: 'Create Schedule' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Schedule' })).toBeNull())
  const posted = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/insights/schedules/')).at(-1)?.body
  expect(posted).toMatchObject({ kind: 'dashboard', item_id: 'dash-1', format: 'pdf', recipients: ['sam@northwind.example', 'aby@northwind.example'] })
  const table = await screen.findByRole('table', { name: 'Schedules' })
  expect(within(table).getByRole('link', { name: 'Marketing Weekly' })).toBeTruthy()
})

test('Back keeps the pick; Edit Schedule opens on step 2 filled in and saves the change', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/scheduled')
  let dialog = await newSchedule(user, /^Sends by campaign/)
  await user.click(within(dialog).getByRole('button', { name: 'Back' }))
  expect(within(dialog).getByRole('button', { name: /^Sends by campaign/ }).getAttribute('aria-pressed')).toBe('true')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await user.type(within(dialog).getByRole('textbox', { name: 'To' }), 'sam@northwind.example{Enter}')
  await user.click(within(dialog).getByRole('button', { name: 'Create Schedule' }))
  const table = await screen.findByRole('table', { name: 'Schedules' })
  await vi.waitFor(() => expect(within(table).getByRole('link', { name: 'Sends by campaign' })).toBeTruthy())

  await user.click(within(table).getByRole('button', { name: 'Actions for the schedule of Sends by campaign' }))
  await user.click(screen.getByRole('menuitem', { name: 'Edit Schedule' }))
  dialog = await screen.findByRole('dialog', { name: 'Edit Schedule' })
  expect(within(dialog).getByText('Step 2 of 2 · When and to Whom')).toBeTruthy()
  expect(within(dialog).getByText('sam@northwind.example')).toBeTruthy()
  await user.click(within(dialog).getByRole('radio', { name: 'Day' }))
  await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT' && /\/insights\/schedules\/sch-\d+\/$/.test(c.url) && (c.body as { every: string }).every === 'day')).toBe(true))
})

test('the filters narrow the schedules and live in the address; Alerts is a tab of its own', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/scheduled')
  const dialog = await newSchedule(user, /^Marketing Weekly/)
  await user.type(within(dialog).getByRole('textbox', { name: 'To' }), 'sam@northwind.example{Enter}')
  await user.click(within(dialog).getByRole('button', { name: 'Create Schedule' }))
  await screen.findByRole('table', { name: 'Schedules' })

  await user.click(screen.getByRole('button', { name: /^Kind/ }))
  await user.click(screen.getByRole('option', { name: 'Reports' }))
  expect(window.location.search).toContain('kind=report')
  expect(await screen.findByText('No Schedules Match These Filters')).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: 'Clear Filters' })[0])
  expect(screen.getByRole('table', { name: 'Schedules' })).toBeTruthy()

  await user.click(screen.getByRole('tab', { name: /Alerts/ }))
  expect(window.location.search).toBe('?tab=alerts')
  expect(await screen.findByText('No Alerts Yet')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'New Alert' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'New Schedule' })).toBeNull()
})

test('New Alert: pick a report, then its value, condition and threshold; Edit Alert opens on step 2 and saves', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/scheduled?tab=alerts')
  await user.click(await screen.findByRole('button', { name: 'New Alert' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Alert' })
  expect(within(dialog).queryByRole('button', { name: /^Marketing Weekly/ })).toBeNull()      // reports only
  await user.click(await within(dialog).findByRole('button', { name: /^Sends by campaign/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  const when = await within(dialog).findByRole('combobox', { name: 'When' })
  expect((when as HTMLSelectElement).value).toBe('sent')
  await user.type(within(dialog).getByRole('spinbutton', { name: /Threshold/ }), '1000')
  await user.click(within(dialog).getByRole('button', { name: 'Set Alert' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Alert' })).toBeNull())
  expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/insights/alerts/')).at(-1)?.body).toMatchObject({ report_id: 'rep-1', measure: 'sent', op: '<', threshold: 1000 })

  const table = await screen.findByRole('table', { name: 'Alerts' })
  await user.click(within(table).getByRole('button', { name: 'Actions for the alert on Sends by campaign' }))
  expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit Alert', 'Check Now', 'Open the Report', 'Pause', 'Delete…'])
  await user.click(screen.getByRole('menuitem', { name: 'Edit Alert' }))
  dialog = await screen.findByRole('dialog', { name: 'Edit Alert' })
  const threshold = await within(dialog).findByRole('spinbutton', { name: /Threshold/ })
  expect((threshold as HTMLInputElement).value).toBe('1000')
  await user.clear(threshold)
  await user.type(threshold, '2000')
  await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/insights/alerts/alert-1/') && (c.body as { threshold: number }).threshold === 2000)).toBe(true))
})
