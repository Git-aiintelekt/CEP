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

test('sending engine settings list engines and senders; the form of a new provider follows the adapter catalogue and the key is write-only', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  const providers = await screen.findByRole('table', { name: 'Sending engines' })
  expect(within(providers).getByText('Postal (self-hosted)')).toBeTruthy()
  expect(within(providers).getByRole('button', { name: 'Copy webhook URL' })).toBeTruthy()
  expect(within(await screen.findByRole('table', { name: 'Senders' })).getByText('Not verified yet')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Add engine' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a sending engine' })
  const type = within(dialog).getByLabelText(/^Engine/) as HTMLSelectElement
  expect([...type.options].map((option) => option.value)).toEqual(['POSTAL', 'SENDGRID', 'SANDBOX_SMS'])          // SMTP comes from the Email server page
  expect([...type.options].map((option) => option.textContent)).toEqual(['Email · Postal', 'Email · SendGrid', 'Texts · Sandbox (sends nothing)'])
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

  await user.click(within(await screen.findByRole('table', { name: 'Sending engines' })).getByRole('button', { name: 'Check' }))
  expect((await screen.findByRole('status')).textContent).toContain('Postal refused the API key')

  await user.click(within(screen.getByRole('table', { name: 'Senders' })).getByRole('button', { name: 'Verify' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('was accepted and sent to aby.john@aiintelekt.com'))
  expect(calls.filter((call) => call.url.endsWith('/verify/')).at(-1)?.body).toEqual({ to: 'aby.john@aiintelekt.com' })
})

test('a campaign page offers a test send and shows what happened to its run, including who was left out and why', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', runs: [] }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=content')

  const to = (await screen.findByLabelText('Other addresses')) as HTMLInputElement
  expect(to.value).toBe('aby.john@aiintelekt.com')
  await user.clear(to)
  await user.type(to, 'me@example.com, bad@example.com')
  await user.click(screen.getByRole('button', { name: 'Send test' }))
  const results = await screen.findByRole('list', { name: 'Test results' })
  expect(within(results).getByText('Sent to me@example.com')).toBeTruthy()
  expect(within(results).getByText('Not sent to bad@example.com: 550 mailbox unavailable')).toBeTruthy()
  expect(calls.filter((call) => call.url.endsWith('/test-publish/')).at(-1)?.body).toEqual({ to: ['me@example.com', 'bad@example.com'], user_ids: [] })

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'COMPLETED', runs: [{ id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false,
                                                                         scheduled_at: null, started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:02:00Z', row_version: 1 }] }) })
  await renderAppAt('/campaigns/c1?tab=performance')
  const panel = await screen.findByRole('region', { name: 'Results of run 1' })
  expect(within(panel).getByText('72')).toBeTruthy()
  expect(within(panel).getByText('No email consent')).toBeTruthy()
  expect(within(panel).getByText('Frequency cap reached')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Test Publish' })).toBeNull()                          // a finished campaign is not tested any more
})

test('an e-receipt campaign explains how the point of sale sends receipts, with this campaign filled in', async () => {
  installMockApi({ campaign: makeCampaign({ campaign_type: 'E_RECEIPT', status: 'ACTIVE', code: 'RCPT-STORE', contact_lists: [], contact_list_details: [] }) })
  await renderAppAt('/campaigns/c1')

  const panel = await screen.findByRole('region', { name: 'Sending receipts' })
  expect(within(panel).getByText(/POST \/api\/v1\/receipts\/send\//)).toBeTruthy()
  expect(within(panel).getByText(/"campaign": "RCPT-STORE"/)).toBeTruthy()
  expect(within(panel).getByText(/receipts:send/)).toBeTruthy()
})

test('a text sender is a number, not an address, and is verified by a text to a mobile number', async () => {
  const calls = installMockApi({ texts: true })
  const user = userEvent.setup()
  vi.spyOn(window, 'prompt').mockReturnValue('+14045550100')
  await renderAppAt('/settings/delivery')

  const senders = await screen.findByRole('table', { name: 'Senders' })
  const row = within(senders).getByText('Northwind texts').closest('tr') as HTMLElement
  expect(within(row).getByText('55123')).toBeTruthy()
  await user.click(within(row).getByRole('button', { name: 'Verify' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('A verification message from 55123 was accepted and sent to +14045550100'))
  expect(calls.filter((call) => call.url.endsWith('/verify/')).at(-1)?.body).toEqual({ to: '+14045550100' })

  await user.click(screen.getByRole('button', { name: 'Add sender' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a sender' })
  expect(within(dialog).getByLabelText(/^From address/)).toBeTruthy()
  await user.selectOptions(within(dialog).getByLabelText(/^Sends through/), 'prov-texts')
  expect(within(dialog).queryByLabelText(/^From address/)).toBeNull()
  await user.type(within(dialog).getByLabelText(/^Name/), 'Promo texts')
  await user.type(within(dialog).getByLabelText(/^Sender number/), '+14045550155')
  await user.click(within(dialog).getByRole('button', { name: 'Add sender' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((call) => call.url.endsWith('/delivery-senders/') && call.method === 'POST').at(-1)?.body).toEqual({ delivery_provider: 'prov-texts', display_name: 'Promo texts', sender_id: '+14045550155', is_default: false })
})

test('a text campaign tests with mobile numbers, reports replies and opt-outs instead of opens, and lists what people texted back', async () => {
  const run = { id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null, started_at: '2026-09-18T10:00:00Z',
                completed_at: '2026-09-18T10:01:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:01:00Z', row_version: 1 }
  installMockApi({ texts: true, campaign: makeCampaign({ channel: 'SMS', status: 'DRAFT', runs: [] }) })
  await renderAppAt('/campaigns/c1?tab=content')
  const to = (await screen.findByLabelText('Mobile numbers')) as HTMLInputElement
  expect(to.value).toBe('')
  expect(to.placeholder).toContain('+14045550100')

  cleanup()
  installMockApi({ texts: true, campaign: makeCampaign({ channel: 'SMS', status: 'COMPLETED', runs: [run] }) })
  await renderAppAt('/campaigns/c1?tab=performance')
  const panel = await screen.findByRole('region', { name: 'Results of run 1' })
  expect(within(panel).getByText('Replied')).toBeTruthy()
  expect(within(panel).getByText('Opted out')).toBeTruthy()
  expect(within(panel).queryByText('Opened')).toBeNull()
  expect(within(panel).getByText(/37 message parts/)).toBeTruthy()
  expect(within(panel).getByText('Number blocked (STOP reply, registry or undeliverable)')).toBeTruthy()
  const replies = await screen.findByRole('region', { name: 'Replies' })
  expect(within(replies).getByText('Do you have it in blue?')).toBeTruthy()
  expect(within(replies).getByText('Brianna Garcia').closest('li')?.textContent).toContain('Opted out')
})

test('a Postal engine takes a second key for receipts; a stored one is kept when the field is left empty and can be removed', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  await screen.findByRole('table', { name: 'Sending engines' })
  await user.click(screen.getByRole('button', { name: 'Add engine' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a sending engine' })
  await user.type(within(dialog).getByLabelText(/^Name/), 'Postal (two servers)')
  await user.type(within(dialog).getByLabelText(/Postal address/), 'https://postal.example.com')
  await user.type(within(dialog).getByLabelText(/^Server API key/), 'bulk-key')
  await user.type(within(dialog).getByLabelText(/^Transactional server API key/), 'txn-key')
  await user.click(within(dialog).getByRole('button', { name: 'Add engine' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const post = calls.filter((call) => call.url.endsWith('/delivery-providers/') && call.method === 'POST').at(-1)
  expect(post?.body).toMatchObject({ provider_type: 'POSTAL', secret: 'bulk-key', transactional_secret: 'txn-key' })
  expect(post?.body).not.toHaveProperty('drop_transactional_secret')
})

test('editing an engine with a stored transactional key: empty keeps it, Remove drops it', async () => {
  const calls = installMockApi({ providerHasTransactionalKey: true })
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  const table = await screen.findByRole('table', { name: 'Sending engines' })
  expect(within(table).getByText(/separate key for receipts/)).toBeTruthy()
  await user.click(within(table).getByRole('button', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: /Edit Postal/ })
  expect(within(dialog).getByText('A transactional key is stored. Leave this empty to keep it.')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const kept = calls.filter((call) => call.method === 'PATCH').at(-1)
  expect(kept?.body).not.toHaveProperty('transactional_secret')
  expect(kept?.body).not.toHaveProperty('drop_transactional_secret')

  await user.click(within(await screen.findByRole('table', { name: 'Sending engines' })).getByRole('button', { name: 'Edit' }))
  const again = await screen.findByRole('dialog', { name: /Edit Postal/ })
  await user.click(within(again).getByRole('button', { name: 'Remove' }))
  expect(within(again).queryByText('A transactional key is stored. Leave this empty to keep it.')).toBeNull()
  await user.click(within(again).getByRole('button', { name: 'Save changes' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const dropped = calls.filter((call) => call.method === 'PATCH').at(-1)
  expect(dropped?.body).toMatchObject({ drop_transactional_secret: true })
})
