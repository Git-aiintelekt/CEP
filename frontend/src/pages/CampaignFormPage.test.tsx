import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, problem, signIn } from '@/test/mockApi'

/** The API client reads its session when the module loads, so each test signs in first and imports the app fresh. */
async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('create: only channel-compatible options are offered and the draft is posted with the chosen values', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/campaigns/new')

  await user.type(await screen.findByLabelText(/^Name/), 'Holiday Preview')
  const template = screen.getByLabelText('Template')
  await within(template).findByRole('option', { name: /Fall Email/ })
  expect(within(template).queryByRole('option', { name: /Fall SMS/ })).toBeNull() // wrong channel
  expect(within(template).queryByRole('option', { name: /Retired Email/ })).toBeNull() // archived

  await user.selectOptions(template, 'tpl-email')
  await user.selectOptions(screen.getByLabelText('Sender'), 'snd-email')
  await user.click(await screen.findByRole('checkbox', { name: /Fall Master Audience/ }))
  await user.click(screen.getByRole('checkbox', { name: /Georgia only/ }))
  expect(screen.getByText(/2 lists attached, 120 members/)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Create draft' }))
  await screen.findByRole('heading', { name: 'Holiday Preview' }) // landed on the detail page

  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))
  expect(post?.body).toMatchObject({
    name: 'Holiday Preview', campaign_type: 'REGULAR_MARKETING', channel: 'EMAIL', solicitation_type: 'MARKETING',
    template: 'tpl-email', sender_profile: 'snd-email', contact_lists: ['cl-master', 'cl-ga'], scheduled_at: null, description: null,
  })
  expect(post?.body).not.toHaveProperty('row_version')
  expect(post?.headers['X-Tenant']).toBe('NWA')
})

test('client validation stops a bad form before any request is made', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/campaigns/new')

  await user.type(await screen.findByLabelText(/^Name/), 'ab')
  await user.type(screen.getByLabelText('Code'), 'no spaces allowed')
  await user.click(screen.getByRole('button', { name: 'Create draft' }))

  expect(await screen.findByText('Use at least 3 characters.')).toBeTruthy()
  expect(screen.getByText(/capital letters, digits, hyphen or underscore/)).toBeTruthy()
  expect(screen.getByLabelText(/^Name/).getAttribute('aria-invalid')).toBe('true')
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))).toBe(false)
})

test('choosing e-receipt locks channel and purpose and hides the audience; switching channel clears an incompatible template', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/campaigns/new')

  const template = await screen.findByLabelText('Template')
  await within(template).findByRole('option', { name: /Fall Email/ })
  await user.selectOptions(template, 'tpl-email')
  await user.selectOptions(screen.getByLabelText(/^Channel/), 'SMS')
  expect((screen.getByLabelText('Template') as HTMLSelectElement).value).toBe('')
  expect(within(screen.getByLabelText('Template')).getByRole('option', { name: /Fall SMS/ })).toBeTruthy()

  await user.selectOptions(screen.getByLabelText(/^Campaign type/), 'E_RECEIPT')
  expect((screen.getByLabelText(/^Channel/) as HTMLSelectElement).value).toBe('EMAIL')
  expect((screen.getByLabelText(/^Channel/) as HTMLSelectElement).disabled).toBe(true)
  expect((screen.getByLabelText(/^Message purpose/) as HTMLSelectElement).value).toBe('TRANSACTIONAL')
  expect(screen.queryByText('Audience')).toBeNull()
})

test('server field errors are shown against their fields', async () => {
  installMockApi({ onSave: () => problem(400, { title: 'Invalid input', errors: { code: ['Another campaign already uses this code.'] } }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/new')

  await user.type(await screen.findByLabelText(/^Name/), 'Holiday Preview')
  await user.type(screen.getByLabelText('Code'), 'CMP-2026-0001')
  await user.click(screen.getByRole('button', { name: 'Create draft' }))

  expect(await screen.findByText('Another campaign already uses this code.')).toBeTruthy()
  expect(screen.getByLabelText('Code').getAttribute('aria-invalid')).toBe('true')
})

test('edit: loads the campaign, saves only when changed, and sends the row version for the optimistic lock', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ row_version: 7 }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit')

  const name = (await screen.findByLabelText(/^Name/)) as HTMLInputElement
  expect(name.value).toBe('Fall Launch')
  expect((screen.getByRole('checkbox', { name: /Fall Master Audience/ }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)

  await user.clear(name)
  await user.type(name, 'Fall Launch v2')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
  const patch = calls.find((call) => call.method === 'PATCH')
  expect(patch?.url.endsWith('/campaigns/c1/')).toBe(true)
  expect(patch?.body).toMatchObject({ name: 'Fall Launch v2', row_version: 7, contact_lists: ['cl-master'] })
})

test('a 409 from a concurrent edit offers to reload instead of overwriting', async () => {
  installMockApi({ onSave: () => problem(409, { title: 'Conflict', detail: 'Someone else changed this campaign after you opened it. Reload to see their changes.' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit')

  await user.type(await screen.findByLabelText('Description'), ' updated')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  expect(await screen.findByText(/Someone else changed this campaign/)).toBeTruthy()
  expect(screen.getByRole('button', { name: /Reload the latest version/ })).toBeTruthy()
})

test('a published campaign cannot be opened for editing', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'PRODUCTION_PUBLISHED', status_label: 'Production published' }) })
  await renderAppAt('/campaigns/c1/edit')

  expect(await screen.findByText(/production published campaign can no longer be edited/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
})
