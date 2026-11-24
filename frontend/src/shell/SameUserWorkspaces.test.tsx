import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { Me } from '@/lib/types'
import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const staging = { ...me, tenant: { ...me.tenant, code: 'CITYST-STG' }, workspace: { name: 'Citi Trends Staging', plan: null, environment: 'STAGING' as const },
  principal: { ...me.principal, roles: ['Marketing Admin', 'List Manager'], mfa_enabled: true } } as Partial<Me>

test('a Staging workspace: the band on every page, the Staging tag by the Workspace ID, and the account menu says where, with which roles', async () => {
  installMockApi({ me: staging })
  const user = userEvent.setup()
  await renderAppAt('/')
  expect((await screen.findByRole('note')).textContent).toBe('Staging workspace · CITYST-STG · sends here are for testing')
  expect(document.querySelector('[data-workspace-id]')?.textContent).toContain('CITYST-STG')
  expect(document.querySelector('[data-staging]')?.textContent).toBe('Staging')

  await user.click(screen.getByRole('button', { name: /^Account:/ }))
  const facts = document.querySelector('[data-account-facts]') as HTMLElement
  expect(within(facts).getByText('Workspace ID').nextElementSibling?.textContent).toBe('CITYST-STGStaging')
  expect(within(facts).getByText('Roles').nextElementSibling?.textContent).toBe('Marketing Admin, List Manager')
  expect(within(facts).getByText('Two-Factor').nextElementSibling?.textContent).toBe('On')
  // this workspace is remembered on this computer
  expect(JSON.parse(window.localStorage.getItem('cep.recentWorkspaces') ?? '[]')[0]).toMatchObject({ code: 'CITYST-STG', environment: 'STAGING' })
})

test('a Production workspace has no band; the account menu offers the other workspace logged in to on this computer', async () => {
  window.localStorage.setItem('cep.recentWorkspaces', JSON.stringify([{ code: 'CITYST-STG', name: 'Citi Trends Staging', environment: 'STAGING', origin: 'https://citist-stg.cep.example.com', at: 1 }]))
  installMockApi({ me: { ...me, workspace: { name: 'Northwind Apparel', plan: null, environment: 'PRODUCTION' } } as Partial<Me> })
  const user = userEvent.setup()
  await renderAppAt('/')
  await screen.findByRole('button', { name: /^Account:/ })
  expect(screen.queryByRole('note')).toBeNull()
  expect(document.querySelector('[data-staging]')).toBeNull()
  await user.click(screen.getByRole('button', { name: /^Account:/ }))
  const facts = document.querySelector('[data-account-facts]') as HTMLElement
  expect(within(facts).getByText('Workspace ID').nextElementSibling?.textContent).toBe('NWAProduction')
  const other = screen.getByRole('button', { name: /Log In to CITYST-STG/ })
  expect(other.textContent).toContain('Staging · Citi Trends Staging')
  const assign = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, origin: 'https://nwa.cep.example.com', assign } as Location)
  await user.click(other)
  expect(assign).toHaveBeenCalledWith('https://citist-stg.cep.example.com/login')
})

test('log in: the Workspace ID is asked, the recent workspaces fill it, and the button names it', async () => {
  window.localStorage.setItem('cep.recentWorkspaces', JSON.stringify([
    { code: 'CITYST', name: 'Citi Trends', environment: 'PRODUCTION', origin: window.location.origin, at: 2 },
    { code: 'CITYST-STG', name: 'Citi Trends Staging', environment: 'STAGING', origin: window.location.origin, at: 1 },
  ]))
  installMockApi()
  window.history.pushState({}, '', '/login?workspace=cityst')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  const user = userEvent.setup()
  const field = (await screen.findByLabelText('Workspace ID')) as HTMLInputElement
  expect(field.value).toBe('CITYST')                                            // from Log In to Another Workspace
  expect(screen.getByRole('button', { name: 'Log In to CITYST' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'CITYST-STG · Staging' }))
  expect(field.value).toBe('CITYST-STG')
  expect(screen.getByRole('button', { name: 'Log In to CITYST-STG' })).toBeTruthy()
})

test('Settings → Users says which workspace the accounts are in, and shows two-factor', async () => {
  installMockApi()
  await renderAppAt('/settings/users')
  expect(await screen.findByText(/Accounts in the workspace/)).toBeTruthy()
  expect(screen.getByText(/Accounts in the workspace/).textContent).toContain('NWA')
  expect(await screen.findByRole('columnheader', { name: 'Two-Factor' })).toBeTruthy()
})
