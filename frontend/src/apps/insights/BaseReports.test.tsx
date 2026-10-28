/** Add Base Reports (docs/mockups/add-base-reports.html), from Create Report's Use Base Reports: 1 the pack with what is in it, 2 the Postal databases with campaign
 * mail ticked and More Options, or the connection made here when there is none, 3 the check as the step opens, then Add, then
 * what was made. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function openAddBaseReports(before: () => void = () => undefined) {
  const calls = installMockApi({ me: withInsights as never })
  before()
  signIn('/insights/reports')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'New Report' }))                           // Base Reports start in Create Report
  const create = await screen.findByRole('dialog', { name: 'Create Report' })
  expect(screen.queryByRole('button', { name: 'Add Base Reports' })).toBeNull()                         // no longer on the list's header
  await user.click(within(create).getByRole('radio', { name: 'Use Base Reports' }))
  await user.click(within(create).getByRole('button', { name: 'Choose a Pack' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Base Reports' })
  return { calls, user, dialog }
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Add Base Reports: the pack shows what is in it; campaign mail is ticked; the check runs as step 3 opens; Add lists what was made', async () => {
  const { calls, user, dialog } = await openAddBaseReports()
  expect(within(dialog).getByText('Step 1 of 3 · Choose a Pack')).toBeTruthy()
  expect(await within(dialog).findByRole('heading', { name: 'Email Campaign Reports' })).toBeTruthy()
  expect(within(within(dialog).getByRole('list', { name: 'Dashboards' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Management Dashboard', 'Campaign Performance'])
  expect(within(dialog).queryByRole('button', { name: "See What's in It" })).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  expect(within(dialog).getByText('Step 2 of 3 · Connect Your Email Data')).toBeTruthy()
  expect(within(dialog).getByText('Citi-Postal mySQL8')).toBeTruthy()
  const fourteen = await within(dialog).findByRole('checkbox', { name: /mailpostal-server-14 · 26,458 messages · 919 campaign emails/ }) as HTMLInputElement
  expect(fourteen.checked).toBe(true)
  expect(within(dialog).queryByRole('checkbox', { name: /txpostalprod-server-7/ })).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Show 1 More Without Campaign Mail' }))
  expect((within(dialog).getByRole('checkbox', { name: /txpostalprod-server-7 .* no campaign email found/ }) as HTMLInputElement).checked).toBe(false)
  const more = within(dialog).getByText('More Options')
  expect(more.closest('summary')?.textContent).toContain('names from citi_analysis_db.marketing_campaign')
  await user.click(more)
  expect((within(dialog).getByLabelText('Campaign Names') as HTMLSelectElement).selectedOptions[0].text).toBe('citi_analysis_db.marketing_campaign (MARKETING_CAMPAIGN_ID → CAMPAIGN_NAME)')
  await user.clear(within(dialog).getByLabelText('Leave Out'))
  await user.type(within(dialog).getByLabelText('Leave Out'), 'test, client list')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  expect(within(dialog).getByText('Step 3 of 3 · Check and Add')).toBeTruthy()
  expect(await within(dialog).findByText('4 campaigns sent in the last 90 days.')).toBeTruthy()            // no Check button: it ran as the step opened
  expect(calls.filter((call) => call.url.endsWith('/insights/base-reports/email-campaigns/check/'))).toHaveLength(1)
  await user.click(within(dialog).getByRole('button', { name: /^Add \d+ Reports? and \d+ Dashboards?$/ }))

  const done = await screen.findByRole('dialog', { name: 'Add Base Reports' })
  expect(await within(done).findByRole('heading', { name: 'Email Campaign Reports Added' })).toBeTruthy()
  expect(within(done).getByRole('button', { name: 'Open Campaign Performance' })).toBeTruthy()
  expect(within(done).getByRole('button', { name: 'See the Reports' })).toBeTruthy()
  const added = calls.find((call) => call.url.endsWith('/insights/base-reports/email-campaigns/add/'))?.body as { connection_id: string; options: Record<string, unknown> }
  expect(added.connection_id).toBe('db-postal')
  expect(added.options).toEqual({ databases: ['mailpostal-server-14', 'txpostalprod-server-10'], names: { table: 'citi_analysis_db.marketing_campaign', id: 'MARKETING_CAMPAIGN_ID', name: 'CAMPAIGN_NAME' },
    leave_out: ['test', 'client list'], unsubscribe: 'unsubscribe' })
})

test('with no Postal database connected, step 2 connects one inside the pop-up, then finds its databases', async () => {
  let first = true
  const { calls, user, dialog } = await openAddBaseReports(() => {
    const mocked = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await mocked(input, init)
      if (first && String(input).endsWith('/insights/base-reports/') && (init?.method ?? 'GET') === 'GET') {
        first = false
        return new Response(JSON.stringify({ ...(await response.json()), connections: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return response
    })
  })
  await within(dialog).findByRole('heading', { name: 'Email Campaign Reports' })
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  expect(within(dialog).getByText(/These reports read your/)).toBeTruthy()
  const save = within(dialog).getByRole('button', { name: 'Save and Continue' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  await user.type(within(dialog).getByLabelText(/^Name/), 'NWA Postal')
  await user.type(within(dialog).getByLabelText(/^Host/), 'ops-db.northwind.local')
  await user.type(within(dialog).getByLabelText(/^Database/), 'postal')
  await user.type(within(dialog).getByLabelText(/^User/), 'reports_ro')
  await user.type(within(dialog).getByLabelText(/^Password/), 'secret')
  await user.click(within(dialog).getByRole('button', { name: 'Test Connection' }))
  await within(dialog).findByText(/Read-only: the account holds SELECT/)
  await user.click(save)
  expect(await within(dialog).findByRole('checkbox', { name: /mailpostal-server-14/ }, { timeout: 5000 })).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/workspace/report-databases/'))).toBe(true)
})
