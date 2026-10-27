/** Insights → Reports (docs/mockups/reports-list-b.html): the tabs by owner, the filter line kept in the address, sorting, the
 * Access and Schedule columns, the empty states, Ask AI only where AI Reports is offered, and each row's ⋯ menu. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsReportsNow, insightsSchedulesNow, insightsSummary, installMockApi, me, signIn } from '@/test/mockApi'
import type { Schedule } from './types'

const withInsights = (aiReports = true, permissions: string[] = ['report.edit']) => ({ ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), ...permissions] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }],
  insights: { mode: 'integrated', standalone_path: '/insights', ai_reports: aiReports } })

const priya = { owner_user_id: 'u2', owner_name: 'Priya Nair' }
const reports = () => [
  { ...insightsSummary, id: 'rep-2', name: 'Bounced Emails', visibility: 'PRIVATE' as const, last_run_at: '2026-10-20T08:00:00Z' },
  { ...insightsSummary, ...priya, id: 'rep-3', name: 'Delivered Rate', visibility: 'PRIVATE' as const, shared: true, dataset: 'orders', dataset_label: 'Attributed Orders', last_run_at: '2026-10-22T08:00:00Z' },
  { ...insightsSummary, ...priya, id: 'rep-4', name: 'Unsubscribes', last_run_at: null },
]

function schedule(itemId: string, extra: Partial<Schedule> = {}): Schedule {
  return { id: `sch-${itemId}`, kind: 'report', item_id: itemId, item_name: null, view_type: 'grid', item_gone: false, owner_user_id: 'u1', owner_name: 'Aby John',
    every: 'week', on_day: 1, at_time: '08:00', format: 'xlsx', recipients: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'], subject: null, note: null, status: 'ACTIVE',
    failures: 0, last_sent_at: null, last_outcome: null, last_detail: null, next_run_at: null, words: 'Every Monday at 08:00', row_version: 1,
    created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z', ...extra } as Schedule
}

async function renderAppAt(path: string, { ai = true, permissions = ['report.edit'], before = () => undefined }: { ai?: boolean; permissions?: string[]; before?: () => void } = {}) {
  const calls = installMockApi({ me: withInsights(ai, permissions) as never })
  before()
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

const withReports = () => insightsReportsNow.push(...(reports() as never[]))
const table = () => screen.findByRole('table', { name: 'Reports' })
const names = (t: HTMLElement) => within(t).getAllByRole('link').map((link) => link.textContent)
const rowOf = (t: HTMLElement, name: string) => within(t).getByRole('link', { name }).closest('tr') as HTMLElement
const chip = (name: string) => screen.getAllByRole('button', { name }).find((button) => button.hasAttribute('data-filter-chip')) as HTMLElement
const param = (key: string) => new URLSearchParams(window.location.search).get(key)

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the tabs split the reports by owner, each with its count, and the tab is kept in the address', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', { before: withReports })
  await table()
  expect(screen.getByRole('tab', { name: /All Reports/ }).textContent).toContain('4')
  expect(screen.getByRole('tab', { name: /My Reports/ }).textContent).toContain('2')
  expect(screen.getByRole('tab', { name: /Shared With Me/ }).textContent).toContain('2')
  await user.click(screen.getByRole('tab', { name: /My Reports/ }))
  expect(param('tab')).toBe('mine')
  expect(names(await table()).sort()).toEqual(['Bounced Emails', 'Sends by campaign'])
  await user.click(screen.getByRole('tab', { name: /Shared With Me/ }))
  expect(param('tab')).toBe('shared')
  expect(names(await table()).sort()).toEqual(['Delivered Rate', 'Unsubscribes'])
})

test('Dataset and Owner narrow the list and go in the address; the counts follow; Clear Filters resets them', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', { before: withReports })
  await table()
  await user.click(screen.getByRole('button', { name: 'Dataset' }))
  await user.click(await screen.findByRole('option', { name: 'Attributed Orders' }))
  expect(param('dataset')).toBe('orders')
  expect(names(await table())).toEqual(['Delivered Rate'])
  expect(screen.getByText('1 of 4 reports')).toBeTruthy()
  expect(screen.getByRole('tab', { name: /My Reports/ }).textContent).toContain('0')
  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))
  expect(param('dataset')).toBeNull()
  await user.click(chip('Owner'))
  await user.click(await screen.findByRole('option', { name: 'Priya Nair' }))
  expect(param('owner')).toBe('Priya Nair')
  expect(chip('Owner: Priya Nair')).toBeTruthy()
  expect(names(await table()).sort()).toEqual(['Delivered Rate', 'Unsubscribes'])
  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))
  expect(names(await table())).toHaveLength(4)
  expect(screen.queryByRole('button', { name: 'Clear Filters' })).toBeNull()
})

test('?component= still opens the list on one component', async () => {
  await renderAppAt('/insights/reports?component=sales', { before: () => insightsReportsNow.push({ ...insightsSummary, id: 'rep-sales', name: 'Takings by Store', component: { key: 'sales', name: 'Sales' } }) })
  expect(names(await table())).toEqual(['Takings by Store'])
  expect(screen.getByRole('button', { name: 'Component: Sales' })).toBeTruthy()
})

test('newest run first by default, never run last; Name sorts A to Z, then Z to A', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', { before: withReports })
  expect(names(await table())).toEqual(['Delivered Rate', 'Bounced Emails', 'Sends by campaign', 'Unsubscribes'])
  await user.click(screen.getByRole('button', { name: 'Name' }))
  expect(param('sort')).toBe('name')
  expect(names(await table())).toEqual(['Bounced Emails', 'Delivered Rate', 'Sends by campaign', 'Unsubscribes'])
  await user.click(screen.getByRole('button', { name: 'Name' }))
  expect(param('dir')).toBe('desc')
  expect(names(await table())).toEqual(['Unsubscribes', 'Sends by campaign', 'Delivered Rate', 'Bounced Emails'])
  await user.click(screen.getByRole('button', { name: 'Last Run' }))
  expect(param('sort')).toBeNull()
  expect(names(await table())[0]).toBe('Delivered Rate')
})

test('Access reads Everyone, Shared or Private; Schedule gives the rhythm and recipients, Paused, or a dash', async () => {
  await renderAppAt('/insights/reports', { before: () => {
    withReports()
    insightsSchedulesNow.push(schedule('rep-1'), schedule('rep-3', { status: 'PAUSED' }), schedule('rep-4', { every: 'day', on_day: null, recipients: ['a@x.com', 'b@x.com'] }))
  } })
  const t = await table()
  expect(within(rowOf(t, 'Sends by campaign')).getByText('Everyone')).toBeTruthy()
  expect(within(rowOf(t, 'Delivered Rate')).getByText('Shared')).toBeTruthy()
  expect(within(rowOf(t, 'Bounced Emails')).getByText('Private')).toBeTruthy()
  await within(rowOf(t, 'Sends by campaign')).findByText('Mondays · 4')
  expect(within(rowOf(t, 'Unsubscribes')).getByText('Daily · 2')).toBeTruthy()
  expect(within(rowOf(t, 'Delivered Rate')).getByText('Paused')).toBeTruthy()
  expect(within(rowOf(t, 'Bounced Emails')).getByText('—')).toBeTruthy()
  expect(within(rowOf(t, 'Unsubscribes')).getByText('Never run')).toBeTruthy()
})

test('when the schedules cannot be read, the table still shows, with a dash for every schedule', async () => {
  await renderAppAt('/insights/reports', { before: () => insightsSchedulesNow.push(schedule('rep-1')) })
  cleanup()
  const mocked = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('/insights/schedules/') ? Promise.resolve(new Response(JSON.stringify({ detail: 'No.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })) : mocked(input, init))
  signIn('/insights/reports')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const t = await table()
  expect(within(rowOf(t, 'Sends by campaign')).getByText('—')).toBeTruthy()
})

test('each empty view says what belongs there', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', { before: () => insightsReportsNow.splice(0, insightsReportsNow.length, { ...insightsSummary, ...priya }) })
  await table()
  await user.click(screen.getByRole('tab', { name: /My Reports/ }))
  expect(await screen.findByText('No Reports of Yours Yet')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'New Report' })).toHaveLength(2)                 // the header's and the empty state's
  cleanup()
  await renderAppAt('/insights/reports?tab=shared', { before: () => insightsReportsNow.splice(0, insightsReportsNow.length) })
  expect(await screen.findByText('Nothing Shared With You Yet')).toBeTruthy()
  cleanup()
  await renderAppAt('/insights/reports', { before: () => insightsReportsNow.splice(0, insightsReportsNow.length) })
  expect(await screen.findByText('No Reports Yet')).toBeTruthy()
  cleanup()
  await renderAppAt('/insights/reports?owner=Nobody')
  expect(await screen.findByText('No Reports Match These Filters')).toBeTruthy()
})

test('Ask AI opens AI Reports, and is not offered when AI cannot draft reports', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports')
  await table()
  await user.click(screen.getByRole('button', { name: 'Ask AI' }))
  expect(window.location.pathname).toBe('/insights/ai-reports')
  cleanup()
  await renderAppAt('/insights/reports', { ai: false })
  await table()
  expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull()
  expect(screen.getByRole('button', { name: 'New Report' })).toBeTruthy()
})

const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(within(await table()).getByRole('button', { name: `Actions for ${name}` }))
  return screen.findByRole('menu', { name: `Actions for ${name}` })
}
const items = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((item) => item.textContent)

test('the ⋯ menu offers what this person may do: all of it to the owner, Open alone to someone who only views', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', { before: () => insightsReportsNow.splice(0, insightsReportsNow.length, { ...insightsSummary, can_share: true } as never) })
  expect(items(await openMenu(user, 'Sends by campaign'))).toEqual(['Open', 'Edit', 'Duplicate', 'Move to Folder…', 'Share…', 'Schedule…', 'Delete…'])
  await user.keyboard('{Escape}')
  await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Actions for Sends by campaign')
  cleanup()
  await renderAppAt('/insights/reports', { permissions: [], before: () => insightsReportsNow.splice(0, insightsReportsNow.length, { ...insightsSummary, ...priya, can_edit: false }) })
  expect(items(await openMenu(user, 'Sends by campaign'))).toEqual(['Open'])
})

test('Duplicate makes a private copy named “Copy of …”, which joins the list', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports')
  await user.click(within(await openMenu(user, 'Sends by campaign')).getByRole('menuitem', { name: 'Duplicate' }))
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/insights/reports/'))).toBe(true))
  const posted = calls.find((c) => c.method === 'POST' && c.url.endsWith('/insights/reports/'))?.body as { name: string; visibility: string; dataset: string }
  expect(posted).toMatchObject({ name: 'Copy of Sends by campaign', visibility: 'PRIVATE', dataset: 'messages' })
  expect(await within(await table()).findByRole('link', { name: 'Copy of Sends by campaign' })).toBeTruthy()
})

test('Move to Folder files the report with the version it has now', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports')
  await user.click(within(await openMenu(user, 'Sends by campaign')).getByRole('menuitem', { name: 'Move to Folder…' }))
  const dialog = await screen.findByRole('dialog', { name: 'Move to Folder' })
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Folder' }), 'fold-1')
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move to Folder' })).toBeNull())
  const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/insights/reports/rep-1/'))?.body as { folder_id: string; row_version: number }
  expect(put).toMatchObject({ folder_id: 'fold-1' })
  expect(typeof put.row_version).toBe('number')
})

test('Share and Schedule open their dialogs; Delete asks first, and the report leaves the list', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports', { before: () => insightsReportsNow.splice(0, insightsReportsNow.length, { ...insightsSummary, can_share: true } as never) })
  await user.click(within(await openMenu(user, 'Sends by campaign')).getByRole('menuitem', { name: 'Share…' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Share Report' })).getAllByRole('button', { name: /Close|Cancel/ })[0])
  await user.click(within(await openMenu(user, 'Sends by campaign')).getByRole('menuitem', { name: 'Schedule…' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Schedule' })).getAllByRole('button', { name: /Close|Cancel/ })[0])
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  await user.click(within(await openMenu(user, 'Sends by campaign')).getByRole('menuitem', { name: 'Delete…' }))
  expect(within(await table()).getByRole('link', { name: 'Sends by campaign' })).toBeTruthy()
  await user.click(within(await openMenu(user, 'Sends by campaign')).getByRole('menuitem', { name: 'Delete…' }))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(await screen.findByText('No Reports Yet')).toBeTruthy()
})
