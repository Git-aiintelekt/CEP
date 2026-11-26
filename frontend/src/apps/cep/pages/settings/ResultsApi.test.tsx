import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, signIn } from '@/test/mockApi'

import { SAMPLE_RESULTS_API_FIRST_VISIT } from './sampleResultsApi'

async function renderAppAt(path: string) {
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

test('Results API: what to hand over, the keys that can read, and the four lists with their last day', async () => {
  installMockApi()
  await renderAppAt('/settings/results-api')
  const connect = await screen.findByRole('region', { name: 'Connect a System' }, { timeout: 5000 })
  expect(screen.getByRole('heading', { name: 'Results API', level: 2 })).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'Where you are' }).textContent).toBe('SettingsEngagementResults API')
  expect(within(connect).getByText('https://cep.example.com/api/v1/results/')).toBeTruthy()
  expect(connect.textContent).toContain('Authorization: Bearer <the API key> and X-Tenant: NWA.')
  expect(connect.textContent).toContain('2 active keys have it: Data Warehouse, iCRM (expires in 9 days).')
  expect(within(connect).getByRole('link', { name: 'API Keys' }).getAttribute('href')).toBe('/settings/api-keys')
  expect(within(connect).getByRole('link', { name: 'Open API Description' }).getAttribute('href')).toBe('https://cep.example.com/api/v1/docs/')
  expect(within(connect).queryByRole('link', { name: 'Go to API Keys' })).toBeNull()

  const table = screen.getByRole('table', { name: 'The four lists' })
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['List', 'Address', 'Calls', 'Throttled', 'Last Read', 'Status', ''])
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
    'CampaignsTotals, held-back people and money', 'SendsThe same totals for each send', 'RecipientsOne row a recipient, by party ID', 'SuppressionsWho must not be contacted, by party ID'])
  const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent)
  expect(cells(rows[0]).slice(1, 6)).toEqual(['campaigns/', '48', '0', '12 min agoData Warehouse', 'Healthy'])
  expect(cells(rows[2]).slice(1, 6)).toEqual(['messages/', '3,912', '218', '1 min agoiCRM', 'Healthy'])          // held by the limit is not a failure: the count says it
  expect(within(rows[2]).getByText('218').className).toContain('text-warning-text')
  expect(cells(rows[3]).slice(4, 6)).toEqual(['3 h agoiCRM', 'Paused'])
  expect(within(rows[0]).getByRole('button', { name: 'Pause Campaigns' })).toBeTruthy()
  expect(within(rows[3]).getByRole('button', { name: 'Resume Suppressions' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'View Log in Integrations' }).getAttribute('href')).toBe('/settings/integrations')
})

test('Results API: pausing a list asks first and uses the Integrations switch; resuming does not ask', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
  await renderAppAt('/settings/results-api')
  await screen.findByRole('table', { name: 'The four lists' }, { timeout: 5000 })

  await user.click(screen.getByRole('button', { name: 'Pause Recipients' }))
  expect(confirm).toHaveBeenCalledWith('Pause Recipients? The system reading this list is answered “paused” until it is resumed. The other lists go on.')
  expect(calls.some((call) => call.url.includes('/pause/'))).toBe(false)                                    // declined: nothing sent

  await user.click(screen.getByRole('button', { name: 'Pause Recipients' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/integrations/int-res-m/pause/'))).toBe(true))
  expect(await screen.findByText('List paused')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Resume Suppressions' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/integrations/int-res-s/resume/'))).toBe(true))
  expect(confirm).toHaveBeenCalledTimes(2)
})

test('Results API: on the first visit it says no key has the scope, offers API Keys, and lists what there is to read', async () => {
  installMockApi({ resultsApi: SAMPLE_RESULTS_API_FIRST_VISIT })
  await renderAppAt('/settings/results-api')
  const connect = await screen.findByRole('region', { name: 'Connect a System' }, { timeout: 5000 })
  expect(connect.textContent).toContain('No key has it yet, so nothing can be read.')
  expect(within(connect).getByRole('link', { name: 'Go to API Keys' }).getAttribute('href')).toBe('/settings/api-keys')

  const table = screen.getByRole('table', { name: 'The four lists' })
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['List', 'Address', 'Limit a Minute', 'Status'])
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getAllByRole('cell').slice(1).map((cell) => cell.textContent))).toEqual([
    ['campaigns/', '60', 'No Calls Yet'], ['runs/', '60', 'No Calls Yet'], ['messages/', '120', 'No Calls Yet'], ['suppressions/', '60', 'No Calls Yet']])
  expect(screen.queryByRole('button', { name: /^(Pause|Resume) / })).toBeNull()
  expect(screen.queryByRole('link', { name: 'View Log in Integrations' })).toBeNull()
})

test('Results API: without the permission to manage integrations the lists show, the pause switch does not', async () => {
  const { me } = await import('@/test/mockApi')
  installMockApi({ me: { principal: { ...me.principal, permissions: me.principal.permissions.filter((code: string) => code !== 'provider.edit') } } as never })
  await renderAppAt('/settings/results-api')
  const table = await screen.findByRole('table', { name: 'The four lists' }, { timeout: 5000 })
  expect(within(table).getAllByRole('row')).toHaveLength(5)
  expect(screen.queryByRole('button', { name: /^(Pause|Resume) / })).toBeNull()
})
