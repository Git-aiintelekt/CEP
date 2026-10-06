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

  const providers = await screen.findByRole('table', { name: 'Sending Engines' })
  expect(within(providers).getByText('Postal (self-hosted)')).toBeTruthy()
  expect(within(providers).getByRole('button', { name: 'Copy Webhook URL' })).toBeTruthy()
  expect(within(await screen.findByRole('table', { name: 'Senders' })).getByText('Not Verified Yet')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Add Engine' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Sending Engine' })
  const type = within(dialog).getByLabelText(/^Engine/) as HTMLSelectElement
  expect([...type.options].map((option) => option.value)).toEqual(['POSTAL', 'SENDGRID', 'SANDBOX_SMS'])          // SMTP comes from the Email server page
  expect([...type.options].map((option) => option.textContent)).toEqual(['Email · Postal', 'Email · SendGrid', 'Texts · Sandbox (sends nothing)'])
  expect(within(dialog).getByLabelText(/Postal address/)).toBeTruthy()
  await user.selectOptions(type, 'SENDGRID')
  expect(within(dialog).queryByLabelText(/Postal address/)).toBeNull()

  await user.type(within(dialog).getByLabelText(/^Name/), 'SendGrid (marketing)')
  await user.click(within(dialog).getByRole('button', { name: 'Add Engine' }))
  expect(await within(dialog).findByText('API key is required.')).toBeTruthy()

  await user.type(within(dialog).getByLabelText(/^API key/), 'SG.secret-value')
  await user.click(within(dialog).getByRole('button', { name: 'Add Engine' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const post = calls.filter((call) => call.url.endsWith('/delivery-providers/') && call.method === 'POST').at(-1)
  expect(post?.body).toMatchObject({ provider_type: 'SENDGRID', name: 'SendGrid (marketing)', secret: 'SG.secret-value', is_active: true })
})

test('checking a provider and verifying a sender report what happened', async () => {
  const calls = installMockApi({ providerCheckFails: true })
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  await user.click(within(await screen.findByRole('table', { name: 'Sending Engines' })).getByRole('button', { name: 'Check' }))
  expect((await screen.findByRole('status')).textContent).toContain('Postal refused the API key')

  await user.click(within(screen.getByRole('table', { name: 'Senders' })).getByRole('button', { name: 'Verify' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('was accepted and sent to aby.john@aiintelekt.com'))
  expect(calls.filter((call) => call.url.endsWith('/verify/')).at(-1)?.body).toEqual({ to: 'aby.john@aiintelekt.com' })
})

test('rotating the callback address asks first, posts once, and says the old address is dead', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await renderAppAt('/settings/delivery')

  const engines = await screen.findByRole('table', { name: 'Sending Engines' })
  await user.click(within(engines).getAllByRole('button', { name: 'Rotate Address' })[0])
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('The current address stops working at once'))
  expect((await screen.findByRole('status')).textContent).toContain('the callback address was rotated')
  expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/delivery-providers/prov-postal/rotate-webhook/')).length).toBe(1)
})

test('a campaign page offers a test send and shows what happened to its run, including who was left out and why', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', runs: [] }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?tab=content')

  const to = (await screen.findByLabelText('Other Addresses')) as HTMLInputElement
  expect(to.value).toBe('aby.john@aiintelekt.com')
  await user.clear(to)
  await user.type(to, 'me@example.com, bad@example.com')
  await user.click(screen.getByRole('button', { name: 'Send Test' }))
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
  expect(within(panel).getByText('No Email Consent')).toBeTruthy()
  expect(within(panel).getByText('Over Frequency Limit')).toBeTruthy()                         // the same words as the Audience tab
  expect(screen.queryByRole('link', { name: 'Test Publish' })).toBeNull()                          // a finished campaign is not tested any more
})

test('an e-receipt campaign explains how the point of sale sends receipts, with this campaign filled in', async () => {
  installMockApi({ campaign: makeCampaign({ campaign_type: 'E_RECEIPT', status: 'ACTIVE', code: 'RCPT-STORE', contact_lists: [], contact_list_details: [] }) })
  await renderAppAt('/campaigns/c1')

  const panel = await screen.findByRole('region', { name: 'Sending Receipts' })
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

  await user.click(screen.getByRole('button', { name: 'Add Sender' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Sender' })
  expect(within(dialog).getByLabelText(/^From Address/)).toBeTruthy()
  await user.selectOptions(within(dialog).getByLabelText(/^Sends Through/), 'prov-texts')
  expect(within(dialog).queryByLabelText(/^From Address/)).toBeNull()
  await user.type(within(dialog).getByLabelText(/^Name/), 'Promo texts')
  await user.type(within(dialog).getByLabelText(/^Sender Number/), '+14045550155')
  await user.click(within(dialog).getByRole('button', { name: 'Add Sender' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((call) => call.url.endsWith('/delivery-senders/') && call.method === 'POST').at(-1)?.body).toEqual({ delivery_provider: 'prov-texts', display_name: 'Promo texts', sender_id: '+14045550155', is_default: false })
})

test('a text campaign tests with mobile numbers, reports replies and opt-outs instead of opens, and lists what people texted back', async () => {
  const run = { id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null, started_at: '2026-09-18T10:00:00Z',
                completed_at: '2026-09-18T10:01:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:01:00Z', row_version: 1 }
  installMockApi({ texts: true, campaign: makeCampaign({ channel: 'SMS', status: 'DRAFT', runs: [] }) })
  await renderAppAt('/campaigns/c1?tab=content')
  const to = (await screen.findByLabelText('Mobile Numbers')) as HTMLInputElement
  expect(to.value).toBe('')
  expect(to.placeholder).toContain('+14045550100')

  cleanup()
  installMockApi({ texts: true, campaign: makeCampaign({ channel: 'SMS', status: 'COMPLETED', runs: [run] }) })
  await renderAppAt('/campaigns/c1?tab=performance')
  const panel = await screen.findByRole('region', { name: 'Results of run 1' })
  expect(within(panel).getByText('Replied')).toBeTruthy()
  expect(within(panel).getByText('Opted Out')).toBeTruthy()
  expect(within(panel).queryByText('Opened')).toBeNull()
  expect(within(panel).getByText(/37 message parts/)).toBeTruthy()
  expect(within(panel).getByText('Number Blocked (STOP Reply, Registry or Undeliverable)')).toBeTruthy()
  const replies = await screen.findByRole('region', { name: 'Replies' })
  expect(within(replies).getByText('Do you have it in blue?')).toBeTruthy()
  expect(within(replies).getByText('Brianna Garcia').closest('li')?.textContent).toContain('Opted Out')
})

test('a Postal engine takes a second key for receipts; a stored one is kept when the field is left empty and can be removed', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  await screen.findByRole('table', { name: 'Sending Engines' })
  await user.click(screen.getByRole('button', { name: 'Add Engine' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Sending Engine' })
  await user.type(within(dialog).getByLabelText(/^Name/), 'Postal (two servers)')
  await user.type(within(dialog).getByLabelText(/Postal address/), 'https://postal.example.com')
  await user.type(within(dialog).getByLabelText(/^Server API key/), 'bulk-key')
  await user.type(within(dialog).getByLabelText(/^Transactional server API key/), 'txn-key')
  await user.click(within(dialog).getByRole('button', { name: 'Add Engine' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const post = calls.filter((call) => call.url.endsWith('/delivery-providers/') && call.method === 'POST').at(-1)
  expect(post?.body).toMatchObject({ provider_type: 'POSTAL', secret: 'bulk-key', transactional_secret: 'txn-key' })
  expect(post?.body).not.toHaveProperty('drop_transactional_secret')
})

test('editing an engine with a stored transactional key: empty keeps it, Remove drops it', async () => {
  const calls = installMockApi({ providerHasTransactionalKey: true })
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  const table = await screen.findByRole('table', { name: 'Sending Engines' })
  expect(within(table).getByText(/separate key for receipts/)).toBeTruthy()
  await user.click(within(table).getByRole('button', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: /Edit Postal/ })
  expect(within(dialog).getByText('A transactional key is stored. Leave this empty to keep it.')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const kept = calls.filter((call) => call.method === 'PATCH').at(-1)
  expect(kept?.body).not.toHaveProperty('transactional_secret')
  expect(kept?.body).not.toHaveProperty('drop_transactional_secret')

  await user.click(within(await screen.findByRole('table', { name: 'Sending Engines' })).getByRole('button', { name: 'Edit' }))
  const again = await screen.findByRole('dialog', { name: /Edit Postal/ })
  await user.click(within(again).getByRole('button', { name: 'Remove' }))
  expect(within(again).queryByText('A transactional key is stored. Leave this empty to keep it.')).toBeNull()
  await user.click(within(again).getByRole('button', { name: 'Save Changes' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const dropped = calls.filter((call) => call.method === 'PATCH').at(-1)
  expect(dropped?.body).toMatchObject({ drop_transactional_secret: true })
})

test("a campaign's New Sender link opens Add a Sender at once, on an engine of the campaign's channel; closing it tidies the address", async () => {
  installMockApi({ texts: true })
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery?add=sender&channel=SMS')
  const dialog = await screen.findByRole('dialog', { name: 'Add a Sender' })
  expect((within(dialog).getByLabelText(/^Sends Through/) as HTMLSelectElement).value).toBe('prov-texts')
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(window.location.search).toBe('')
})

test('Deliverability Testing: no account shows the set-up call, the form wants the key, a stored account offers Check Connection and the client picker', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')

  const section = (await screen.findByRole('heading', { name: 'Deliverability Testing' })).closest('section') as HTMLElement
  expect(await within(section).findByText('No inbox-preview account yet')).toBeTruthy()
  await user.click(within(section).getByRole('button', { name: 'Set Up Mailgun Inspect' }))
  const dialog = await screen.findByRole('dialog', { name: 'Set Up Mailgun Inspect' })
  expect(within(dialog).getByText('Save the API key first; the client list comes from the account.')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText('Enter the Mailgun Inspect API key.')).toBeTruthy()

  await user.selectOptions(within(dialog).getByLabelText(/^Region/), 'EU')
  await user.type(within(dialog).getByLabelText(/^Username/), 'northline-inspect')
  await user.type(within(dialog).getByLabelText(/^API Key/), 'inspect-key-1')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('Mailgun Inspect account saved')).toBeTruthy()                                 // the toast: the dialog closed on a save
  const put = calls.filter((call) => call.url.endsWith('/deliverability/service/') && call.method === 'PUT').at(-1)
  expect(put?.body).toMatchObject({ region: 'EU', username: 'northline-inspect', api_key: 'inspect-key-1', default_clients: [], image_blocking: false, is_active: true })

  expect(await within(section).findByText(/EU region · northline-inspect · API key stored/)).toBeTruthy()
  expect(within(section).getByText('Not Checked Yet')).toBeTruthy()
  await user.click(within(section).getByRole('button', { name: 'Check Connection' }))
  expect(await screen.findByText('Mailgun Inspect: the account works.')).toBeTruthy()

  await user.click(within(section).getByRole('button', { name: 'Edit' }))
  const edit = await screen.findByRole('dialog', { name: 'Mailgun Inspect Account' })
  expect(within(edit).getByText('Stored. Leave empty to keep it.')).toBeTruthy()
  expect(await within(edit).findByRole('region', { name: 'Phones and Tablets' }).catch(() => null)).toBeNull()        // the picker is plain groups, not landmarks
  await user.click(await within(edit).findByLabelText(/Gmail app/))
  await user.click(within(edit).getByLabelText(/Render with images blocked/))
  await user.click(within(edit).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const again = calls.filter((call) => call.url.endsWith('/deliverability/service/') && call.method === 'PUT').at(-1)
  expect(again?.body).toMatchObject({ default_clients: ['gmail_android'], image_blocking: true })
  expect(again?.body).not.toHaveProperty('api_key')
  expect(await within(section).findByText(/1 default clients · images blocked/)).toBeTruthy()
  expect(within(section).getByText(/Your own account: CEP does not limit your tests/)).toBeTruthy()
})

test('Deliverability Testing through CEP’s account: the tests this month, Edit Clients saves only the clients, own account takes over and Stop Using goes back', async () => {
  const calls = installMockApi({ platformInspect: true, deliverabilityLimit: 50 })
  const user = userEvent.setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await renderAppAt('/settings/delivery')

  const section = (await screen.findByRole('heading', { name: 'Deliverability Testing' })).closest('section') as HTMLElement
  expect(await within(section).findByText('Provided by CEP')).toBeTruthy()
  expect(await within(section).findByText('0 of 50 tests this month')).toBeTruthy()
  expect(within(section).getByText('50 a month on the Growth plan.')).toBeTruthy()
  expect(within(section).queryByText('No inbox-preview account yet')).toBeNull()

  await user.click(within(section).getByRole('button', { name: 'Edit Clients' }))
  const clients = await screen.findByRole('dialog', { name: 'Default Clients' })
  expect(within(clients).queryByLabelText(/^API Key/)).toBeNull()
  await user.click(await within(clients).findByLabelText(/Gmail app/))
  await user.click(within(clients).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const put = calls.filter((call) => call.url.endsWith('/deliverability/service/') && call.method === 'PUT').at(-1)
  expect(put?.body).toEqual({ image_blocking: false, default_clients: ['gmail_android'] })
  expect(await within(section).findByText(/Default clients: 1/)).toBeTruthy()

  await user.click(within(section).getByRole('button', { name: 'Use Your Own Mailgun Account' }))
  const own = await screen.findByRole('dialog', { name: 'Use Your Own Mailgun Account' })
  await user.type(within(own).getByLabelText(/^Username/), 'northline-inspect')
  await user.type(within(own).getByLabelText(/^API Key/), 'inspect-key-1')
  await user.click(within(own).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await within(section).findByText(/Your own account: CEP does not limit your tests/)).toBeTruthy()

  await user.click(within(section).getByRole('button', { name: 'Stop Using My Own Account' }))
  expect(await within(section).findByText('Provided by CEP')).toBeTruthy()
})
