/** Add Base Reports (docs/mockups/base-reports.html, option 1): All Reports opens the platform's packs; adding one picks the connection,
 * the Postal databases holding campaign mail and where names live, checks each dataset, then lists what was made. */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Add Base Reports: pick the pack, the Postal databases with campaign mail are ticked, Check runs each dataset, Add Reports lists what was made', async () => {
  const calls = installMockApi({ me: withInsights as never })
  signIn('/insights/reports')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Add Base Reports' }))
  expect(await screen.findByRole('heading', { name: 'Email Campaign Reports' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: "See What's in It" }))
  expect(screen.getByText('Management Dashboard, Campaign Performance')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add to NWA' }))

  const fourteen = await screen.findByRole('checkbox', { name: /mailpostal-server-14 · 26,458 messages · 919 campaign emails/ }) as HTMLInputElement
  expect(fourteen.checked).toBe(true)
  expect(screen.queryByRole('checkbox', { name: /txpostalprod-server-7/ })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Show 1 More Without Campaign Mail' }))
  const seven = screen.getByRole('checkbox', { name: /txpostalprod-server-7 .* no campaign email found/ }) as HTMLInputElement
  expect(seven.checked).toBe(false)
  expect((screen.getByLabelText('Campaign Names') as HTMLSelectElement).selectedOptions[0].text).toBe('citi_analysis_db.marketing_campaign (MARKETING_CAMPAIGN_ID → CAMPAIGN_NAME)')
  await user.clear(screen.getByLabelText('Leave Out'))
  await user.type(screen.getByLabelText('Leave Out'), 'test, client list')
  await user.click(screen.getByRole('button', { name: 'Check' }))
  expect(await screen.findByText('4 campaigns sent in the last 90 days.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add Reports' }))

  expect(await screen.findByRole('heading', { name: 'Email Campaign Reports Added' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open Campaign Performance' })).toBeTruthy()
  const added = calls.find((call) => call.url.endsWith('/insights/base-reports/email-campaigns/add/'))?.body as { connection_id: string; options: Record<string, unknown> }
  expect(added.connection_id).toBe('db-postal')
  expect(added.options).toEqual({ databases: ['mailpostal-server-14', 'txpostalprod-server-10'], names: { table: 'citi_analysis_db.marketing_campaign', id: 'MARKETING_CAMPAIGN_ID', name: 'CAMPAIGN_NAME' },
    leave_out: ['test', 'client list'], unsubscribe: 'unsubscribe' })
})
