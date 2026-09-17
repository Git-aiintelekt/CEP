import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, me, problem, signIn } from '@/test/mockApi'

async function renderAppAt(path: string, authenticated = true) {
  if (authenticated) signIn(path)
  else window.history.pushState({}, '', path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('settings opens on users with workspace facts; the administrator cannot deactivate themselves', async () => {
  installMockApi()
  await renderAppAt('/settings')

  expect(await screen.findByText('Northwind Apparel (NWA)')).toBeTruthy()
  expect(screen.getByText('2 of 50')).toBeTruthy()
  const table = await screen.findByRole('table', { name: 'Users' })
  const own = within(table).getByText('aby.john@aiintelekt.com').closest('tr') as HTMLElement
  expect(within(own).queryByRole('button', { name: 'Deactivate' })).toBeNull()
  const other = within(table).getByText('devon@example.com').closest('tr') as HTMLElement
  expect(within(other).getByText('No password yet')).toBeTruthy()
  expect(within(other).getByRole('button', { name: 'Deactivate' })).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByText('Settings')).toBeTruthy()
})

test('add a user with a role: no password field exists, and the chosen roles are posted', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/users')

  await user.click(await screen.findByRole('button', { name: 'Add user' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a user' })
  expect(dialog.querySelector('input[type="password"]')).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Add user' }))
  expect(within(dialog).getByText('Enter an email address.')).toBeTruthy()

  await user.type(within(dialog).getByLabelText(/^Email/), 'new.person@example.com')
  await user.type(within(dialog).getByLabelText(/^Name/), 'New Person')
  await user.click(within(dialog).getByRole('checkbox', { name: /Analyst/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Add user' }))

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/users/'))?.body).toEqual({ email: 'new.person@example.com', display_name: 'New Person', roles: ['role-analyst'] })
})

test('a password link is created on demand and shown as a full URL to copy', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/users')

  const row = (await screen.findByText('devon@example.com')).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Password link' }))
  const field = (await screen.findByLabelText('One-time link')) as HTMLInputElement
  expect(field.value).toBe(`${window.location.origin}/set-password?tenant=NWA&uid=dTI&token=abc-123`)
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/users/u2/password-link/'))).toBe(true)
})

test('the API refusing to strip the last administrator is shown in the dialog', async () => {
  installMockApi({ onSettingsWrite: () => problem(400, { title: 'Invalid input', errors: { roles: ['This is the last active administrator. Give another user an administrator role first.'] } }) })
  const user = userEvent.setup()
  await renderAppAt('/settings/users')

  const own = within(await screen.findByRole('table', { name: 'Users' })).getByText('aby.john@aiintelekt.com').closest('tr') as HTMLElement
  await user.click(within(own).getByRole('button', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog')
  expect((within(dialog).getByLabelText(/^Email/) as HTMLInputElement).disabled).toBe(true)
  await user.click(within(dialog).getByRole('checkbox', { name: /Marketing Admin/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
  expect(await within(dialog).findByText(/last active administrator/)).toBeTruthy()
})

test('roles: permissions are grouped by area, posted as codes, and a role in use cannot be deleted', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/roles')

  const inUse = (await screen.findByText('Marketing Admin')).closest('tr') as HTMLElement
  expect((within(inUse).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)

  await user.click(screen.getByRole('button', { name: 'New role' }))
  const dialog = await screen.findByRole('dialog', { name: 'New role' })
  expect(within(dialog).getByText('Campaigns')).toBeTruthy()
  expect(within(dialog).getByText('Administration')).toBeTruthy()
  await user.type(within(dialog).getByLabelText(/^Name/), 'Template Designer')
  await user.click(within(dialog).getByRole('checkbox', { name: /template\.edit/ }))
  await user.click(within(dialog).getByRole('checkbox', { name: /campaign\.view/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create role' }))

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/roles/'))?.body).toEqual({ name: 'Template Designer', description: null, permissions: ['template.edit', 'campaign.view'] })
})

test('API keys: the full key is shown exactly once after creation, and a key can be revoked', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/api-keys')

  expect(await screen.findByText('cep_in_AbC123…')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'New API key' }))
  const dialog = await screen.findByRole('dialog', { name: 'New API key' })
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }))
  expect(within(dialog).getByText('Choose at least one scope.')).toBeTruthy()

  await user.type(within(dialog).getByLabelText(/^Name/), 'Warehouse sync')
  await user.click(within(dialog).getByRole('checkbox', { name: 'events:ingest' }))
  await user.type(within(dialog).getByLabelText('Allowed IP addresses'), '203.0.113.7, 10.0.0.0/8')
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }))

  const reveal = await screen.findByRole('dialog', { name: 'Copy the key now' })
  expect((within(reveal).getByLabelText('API key') as HTMLInputElement).value).toBe('cep_in_NeW456secretsecretsecret')
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/api-clients/'))?.body).toEqual(
    { name: 'Warehouse sync', scopes: ['events:ingest'], expires_at: null, allowed_ip_cidrs: ['203.0.113.7', '10.0.0.0/8'] })
  await user.click(within(reveal).getByRole('button', { name: 'I have stored it' }))
  expect(screen.queryByDisplayValue('cep_in_NeW456secretsecretsecret')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Revoke' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/api-clients/key-1/revoke/'))).toBe(true))
})

test('someone without user.admin sees no Settings entry and is refused on the URL', async () => {
  installMockApi()
  me.principal.permissions = ['campaign.edit']
  try {
    await renderAppAt('/settings/users')
    expect(await screen.findByText('Settings are for workspace administrators')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByText('Settings')).toBeNull()
  } finally {
    me.principal.permissions = ['campaign.edit', 'campaign.publish', 'template.edit', 'user.admin']
  }
})

test('set password (public): mismatch is caught locally, an expired link is explained, success points to sign in', async () => {
  let attempt = 0
  const calls = installMockApi({ onSettingsWrite: () => (++attempt === 1 ? problem(400, { title: 'Invalid input', errors: { token: ['This link is not valid any more. Ask your administrator for a new one.'] } }) : null) })
  const user = userEvent.setup()
  await renderAppAt('/set-password?tenant=NWA&uid=dTI&token=abc-123', false)

  await user.type(await screen.findByLabelText(/^New password/), 'a long enough passphrase')
  await user.type(screen.getByLabelText(/^Repeat the password/), 'a different passphrase')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect(screen.getByText('The two passwords are not the same.')).toBeTruthy()
  expect(calls.length).toBe(0)

  await user.clear(screen.getByLabelText(/^Repeat the password/))
  await user.type(screen.getByLabelText(/^Repeat the password/), 'a long enough passphrase')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect((await screen.findByRole('alert')).textContent).toContain('not valid any more')

  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect(await screen.findByText('Your password is set.')).toBeTruthy()
  const post = calls.at(-1)
  expect(post?.body).toEqual({ uid: 'dTI', token: 'abc-123', password: 'a long enough passphrase' })
  expect(post?.headers['X-Tenant']).toBe('NWA')
  expect(post?.headers.Authorization).toBeUndefined()
})
