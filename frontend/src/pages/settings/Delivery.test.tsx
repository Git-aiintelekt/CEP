import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
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

test('email engine settings list engines and senders; the form of a new provider follows the adapter catalogue and the key is write-only', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  const providers = await screen.findByRole('table', { name: 'Email engines' })
  expect(within(providers).getByText('Postal (self-hosted)')).toBeTruthy()
  expect(within(providers).getByRole('button', { name: 'Copy webhook URL' })).toBeTruthy()
  expect(within(await screen.findByRole('table', { name: 'Senders' })).getByText('Not verified yet')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Add engine' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add an email engine' })
  const type = within(dialog).getByLabelText(/^Engine/) as HTMLSelectElement
  expect([...type.options].map((option) => option.value)).toEqual(['POSTAL', 'SENDGRID'])          // SMTP comes from the Email server page
  expect(within(dialog).getByLabelText(/Postal address/)).toBeTruthy()
  await user.selectOptions(type, 'SENDGRID')
  expect(within(dialog).queryByLabelText(/Postal address/)).toBeNull()

  await user.type(within(dialog).getByLabelText(/^Name/), 'SendGrid (marketing)')
  await user.click(within(dialog).getByRole('button', { name: 'Add engine' }))
  expect(await within(dialog).findByText('API key is required.')).toBeTruthy()

  await user.type(within(dialog).getByLabelText(/^API key/), 'SG.secret-value')
  await user.click(within(dialog).getByRole('button', { name: 'Add engine' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const post = calls.filter((call) => call.url.endsWith('/delivery-providers/') && call.method === 'POST').at(-1)
  expect(post?.body).toMatchObject({ provider_type: 'SENDGRID', name: 'SendGrid (marketing)', secret: 'SG.secret-value', is_active: true })
})

test('checking a provider and verifying a sender report what happened', async () => {
  const calls = installMockApi({ providerCheckFails: true })
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  await user.click(within(await screen.findByRole('table', { name: 'Email engines' })).getByRole('button', { name: 'Check' }))
  expect((await screen.findByRole('status')).textContent).toContain('Postal refused the API key')

  await user.click(within(screen.getByRole('table', { name: 'Senders' })).getByRole('button', { name: 'Verify' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('was accepted and sent to aby.john@aiintelekt.com'))
  expect(calls.filter((call) => call.url.endsWith('/verify/')).at(-1)?.body).toEqual({ to: 'aby.john@aiintelekt.com' })
})

test('a campaign page offers a test send and shows what happened to its run, including who was left out and why', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', runs: [] }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')

  const to = (await screen.findByLabelText(/^To/)) as HTMLInputElement
  expect(to.value).toBe('aby.john@aiintelekt.com')
  await user.clear(to)
  await user.type(to, 'me@example.com, bad@example.com')
  await user.click(screen.getByRole('button', { name: 'Send test' }))
  const results = await screen.findByRole('list', { name: 'Test results' })
  expect(within(results).getByText('Sent to me@example.com')).toBeTruthy()
  expect(within(results).getByText('Not sent to bad@example.com: 550 mailbox unavailable')).toBeTruthy()
  expect(calls.filter((call) => call.url.endsWith('/send-test/')).at(-1)?.body).toEqual({ to: ['me@example.com', 'bad@example.com'] })

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'COMPLETED', runs: [{ id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false,
                                                                         scheduled_at: null, started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:02:00Z', row_version: 1 }] }) })
  await renderAppAt('/campaigns/c1')
  const panel = await screen.findByRole('region', { name: 'Results of run 1' })
  expect(within(panel).getByText('72')).toBeTruthy()
  expect(within(panel).getByText('No email consent')).toBeTruthy()
  expect(within(panel).getByText('Frequency cap reached')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Send test' })).toBeNull()                           // a finished campaign is not tested any more
})

test('an e-receipt campaign explains how the point of sale sends receipts, with this campaign filled in', async () => {
  installMockApi({ campaign: makeCampaign({ campaign_type: 'E_RECEIPT', status: 'ACTIVE', code: 'RCPT-STORE', contact_lists: [], contact_list_details: [] }) })
  await renderAppAt('/campaigns/c1')

  const panel = await screen.findByRole('region', { name: 'Sending receipts' })
  expect(within(panel).getByText(/POST \/api\/v1\/receipts\/send\//)).toBeTruthy()
  expect(within(panel).getByText(/"campaign": "RCPT-STORE"/)).toBeTruthy()
  expect(within(panel).getByText(/receipts:send/)).toBeTruthy()
})
