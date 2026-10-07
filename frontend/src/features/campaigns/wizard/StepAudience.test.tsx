/** The Audience step: Send To, Don't Send To, the Add Contact List pop-up, and the live audience summary. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const empty = (overrides = {}) => makeCampaign({ status: 'DRAFT', contact_lists: [], contact_list_details: [], ...overrides })
async function openStep(campaign = makeCampaign({ status: 'DRAFT' }), options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ campaign, ...options })
  await renderAppAt('/campaigns/c1/edit?step=audience')
  await screen.findByRole('heading', { level: 2, name: 'Send To' })
  return { calls, user: userEvent.setup() }
}
const card = (name: string) => screen.getByRole('region', { name })
const sendTo = () => within(card('Send To')).getByRole('table', { name: 'Lists this campaign is sent to' })
async function openPicker(user: ReturnType<typeof userEvent.setup>, button = 'Add Contact List', title = 'Add Contact List') {
  await user.click(within(card(button === 'Add Contact List' ? 'Send To' : 'Don’t Send To')).getAllByRole('button', { name: button })[0])
  return screen.findByRole('dialog', { name: title })
}
const estimateCalls = (calls: { url: string }[]) => calls.filter((call) => call.url.includes('/campaigns/audience-estimate/'))

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Send To holds the attached lists only: name (a new tab), how it was attached, source, contacts, updated, and remove', async () => {
  const { user } = await openStep(makeCampaign({ status: 'DRAFT', contact_list_details: [{ id: 'cl-master', name: 'Fall Master Audience', list_kind: 'STATIC', is_master: true, list_environment: 'PRODUCTION', status: 'ACTIVE', member_count: 90, attached_at: '2026-09-18T15:00:00Z' }] as never }))
  const table = await within(card('Send To')).findByRole('table', { name: 'Lists this campaign is sent to' })
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['List', 'Source', 'Contacts', ''])
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(1)                                                                          // not every list in the workspace
  const link = within(rows[0]).getByRole('link', { name: 'Fall Master Audience (opens in a new tab)' })
  expect([link.getAttribute('href'), link.getAttribute('target')]).toEqual(['/contact-lists/cl-master', '_blank'])
  expect(within(rows[0]).getByText(/^Attached .*18.*2026 · Updated .*2026$/)).toBeTruthy()
  expect(within(rows[0]).getByText('Upload')).toBeTruthy()
  expect(within(rows[0]).getByText('90')).toBeTruthy()
  expect(within(card('Send To')).getByText('1 list selected, 90 contacts before duplicates and governance')).toBeTruthy()

  await user.click(within(rows[0]).getByRole('button', { name: 'Remove Fall Master Audience' }))
  expect(within(card('Send To')).getByText('No contact lists yet')).toBeTruthy()
  expect(within(card('Send To')).getByText(/A draft can be saved without one; publishing needs at least one\./)).toBeTruthy()
})

test('the pop-up: filters combine, select all shown, attached lists ticked and disabled, and adding several at once', async () => {
  const { user } = await openStep(empty())
  const dialog = await openPicker(user)
  const names = () => within(within(dialog).getByRole('list', { name: 'Contact Lists' })).queryAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))
  expect(names()).toEqual(['Fall Master Audience', 'Georgia only'])
  const chip = (name: string) => within(within(dialog).getByRole('group', { name: 'Filter lists' })).getByRole('button', { name })
  await user.click(chip('Test'))
  expect(names()).toEqual(['Georgia only'])
  await user.click(chip('Upload'))                                                                       // Test and Upload: nothing is both
  expect(names()).toEqual([])
  expect(within(dialog).getByText('Nothing left to add')).toBeTruthy()
  await user.click(chip('BI / Extraction'))
  expect(names()).toEqual(['Georgia only'])
  expect(chip('Test').getAttribute('aria-pressed')).toBe('true')
  await user.click(chip('All'))
  expect(names()).toEqual(['Fall Master Audience', 'Georgia only'])

  await user.click(within(dialog).getByRole('checkbox', { name: 'Select every list shown' }))
  await user.click(within(dialog).getByRole('button', { name: 'Add 2 Lists' }))
  const rows = within(sendTo()).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['Fall Master Audience', 'Georgia only'])
  expect(within(rows[1]).getByText('Test')).toBeTruthy()
  expect(within(card('Send To')).getByText(/Marked as Test: Georgia only/)).toBeTruthy()

  const again = await openPicker(user)
  const master = within(again).getByRole('checkbox', { name: 'Fall Master Audience' }) as HTMLInputElement
  expect([master.checked, master.disabled]).toEqual([true, true])
  expect(within(again).getByRole('button', { name: 'Add Lists' }).hasAttribute('disabled')).toBe(true)          // nothing ticked yet
})

test('tabs by permission: making lists needs list.edit', async () => {
  const { user } = await openStep(empty())
  const dialog = await openPicker(user)
  expect(within(within(dialog).getByRole('radiogroup', { name: 'How to add a list' })).getAllByRole('radio').map((tab) => tab.textContent)).toEqual(['Existing Lists', 'Upload New', 'From an Audience or a Clone'])

  cleanup()
  const viewer = await openStep(empty(), { me: { principal: { ...me.principal, permissions: ['campaign.view', 'campaign.edit', 'list.view'] } } as never })
  const plain = await openPicker(viewer.user)
  expect(within(plain).queryByRole('radiogroup', { name: 'How to add a list' })).toBeNull()               // one way in, so no tabs
  expect(within(plain).getByRole('list', { name: 'Contact Lists' })).toBeTruthy()
})

test('Don’t Send To: leaving a list out takes it off the estimate, and the summary updates', async () => {
  const { user, calls } = await openStep()
  const summary = card('Audience')
  await vi.waitFor(() => expect(within(summary).getByTestId('audience-eligible').textContent).toBe('88'))
  expect(within(summary).getByText('In Your Lists').nextElementSibling?.textContent).toBe('120')
  expect(within(card('Don’t Send To')).getByText('Nobody is left out by a list.')).toBeTruthy()
  expect(within(card('Don’t Send To')).getByText('People in these lists are left out, even if they’re in a list above.')).toBeTruthy()

  const dialog = await openPicker(user, 'Add List to Leave Out', 'Leave Out a List')
  expect(within(dialog).queryByRole('radiogroup', { name: 'How to add a list' })).toBeNull()           // existing lists only
  expect((within(dialog).getByRole('checkbox', { name: 'Fall Master Audience' }) as HTMLInputElement).disabled).toBe(true)   // sent to already
  await user.click(within(dialog).getByRole('checkbox', { name: 'Georgia only' }))
  await user.click(within(dialog).getByRole('button', { name: 'Leave Out 1 List' }))
  expect(within(within(card('Don’t Send To')).getByRole('table')).getByRole('link', { name: 'Georgia only (opens in a new tab)' })).toBeTruthy()
  await vi.waitFor(() => expect(estimateCalls(calls).some((call) => call.url.includes('exclude=cl-ga'))).toBe(true))
  await vi.waitFor(() => expect(within(summary).getByTestId('audience-eligible').textContent).toBe('78'))
  expect(within(summary).getByText('Unique People').nextElementSibling?.textContent).toBe('90')
})

test('How the Number Is Worked Out: the funnel and the reasons, in the channel’s words', async () => {
  const { user } = await openStep(makeCampaign({ status: 'DRAFT', channel: 'SMS' }), {
    estimate: { channel: 'SMS', statuses: [{ code: 'MARKETABLE', label: 'Can receive', sendable: true, count: 88 }, { code: 'NO_CONSENT', label: 'No consent on record', sendable: false, count: 12 }] as never },
  })
  const summary = card('Audience')
  const toggle = await within(summary).findByRole('button', { name: 'How the Number Is Worked Out' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  await user.click(toggle)
  expect(within(summary).getByLabelText('Audience Estimate')).toBeTruthy()
  expect(within(within(summary).getByRole('list', { name: 'Why people are left out' })).getByText('No Text Consent')).toBeTruthy()
})

test('nobody can receive it: a warning, and Continue still goes on (the API allows a publish with no recipients)', async () => {
  const { user, calls } = await openStep(makeCampaign({ status: 'DRAFT' }), { estimate: { estimated_recipients: 0 } })
  expect(await screen.findByText('Nobody in these lists can receive this campaign today. Check the reasons in the audience summary.')).toBeTruthy()
  const next = screen.getByRole('button', { name: 'Continue to Content' }) as HTMLButtonElement
  expect(next.disabled).toBe(false)
  await user.click(next)
  await vi.waitFor(() => expect(window.location.search).toBe('?step=content'))
  expect(calls.length).toBeGreaterThan(0)
})

test('empty states: no list yet; a workspace with none, for someone who may not make lists', async () => {
  await openStep(empty())
  const box = card('Send To').querySelector('[data-empty="send-to"]') as HTMLElement
  expect(within(box).getByText('No contact lists yet')).toBeTruthy()
  expect(within(box).getByRole('button', { name: 'Add Contact List' })).toBeTruthy()
  expect(within(card('Audience')).getByText('Add a contact list to see how many people the campaign would reach.')).toBeTruthy()

  cleanup()
  const { user } = await openStep(empty(), { lists: [], me: { principal: { ...me.principal, permissions: ['campaign.view', 'campaign.edit', 'list.view'] } } as never })
  expect(await within(card('Send To')).findByRole('link', { name: 'See Contact Lists' })).toBeTruthy()
  const dialog = await openPicker(user)
  expect(within(dialog).getByText(/No active contact lists yet\./)).toBeTruthy()
})

test('phones: the summary comes first; from lg it is the sticky right column', async () => {
  await openStep()
  const summary = document.querySelector('[data-audience-summary]') as HTMLElement
  expect(summary.className).toContain('order-first')
  expect(summary.className).toContain('lg:order-last')
  expect(summary.className).toContain('lg:sticky')
  expect(summary.compareDocumentPosition(card('Send To')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('Don’t Send To keeps its button in the header, on the title’s row', async () => {
  await openStep()
  const [header] = [...card('Don’t Send To').children] as HTMLElement[]
  expect(within(header).getByRole('heading', { name: 'Don’t Send To' })).toBeTruthy()
  expect(within(header).getByRole('button', { name: 'Add List to Leave Out' }).parentElement!.className).toContain('shrink-0')
  expect(header.className).toContain('sm:flex-nowrap')
})

test('the pop-up’s button: "Add Lists" with nothing ticked, then "Add 1 List", then "Add 2 Lists"', async () => {
  const { user } = await openStep(empty())
  const dialog = await openPicker(user)
  expect((within(dialog).getByRole('button', { name: 'Add Lists' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(within(dialog).getByRole('checkbox', { name: 'Fall Master Audience' }))
  expect(within(dialog).getByRole('button', { name: 'Add 1 List' })).toBeTruthy()
  await user.click(within(dialog).getByRole('checkbox', { name: 'Georgia only' }))
  expect(within(dialog).getByRole('button', { name: 'Add 2 Lists' })).toBeTruthy()
})

const csv = () => new File(['Email Address,First Name\na@x.example,Ana\n'], 'leads.csv', { type: 'text/csv' })
async function uploadList(user: ReturnType<typeof userEvent.setup>, name: string) {
  const dialog = await openPicker(user)
  await user.click(within(dialog).getByRole('radio', { name: 'Upload New' }))
  await user.type(within(dialog).getByLabelText(/^List Name/), name)
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('heading', { name: 'Add Your File' })
  await user.upload(within(dialog).getByLabelText('CSV File'), csv())
  await within(dialog).findByText('leads.csv')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('heading', { name: 'Match Your Columns' })
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('heading', { name: 'Where Did These People Agree?' })
  await user.click(within(dialog).getByRole('radio', { name: /Signed up on our website or app/ }))
  await user.click(within(dialog).getByLabelText(/^I confirm these people agreed/))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  const importButton = await within(dialog).findByRole('button', { name: 'Create List' }) as HTMLButtonElement
  await vi.waitFor(() => expect(importButton.disabled).toBe(false))
  await user.click(importButton)
  await within(dialog).findByRole('heading', { name: 'List Created' })
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  await within(sendTo()).findByRole('link', { name: `${name} (opens in a new tab)` })
}

test('moving on with an upload still waiting asks first: confirm it and continue, or continue without it', async () => {
  const { user, calls } = await openStep(empty())
  await uploadList(user, 'Booth scans')
  await user.click(screen.getByRole('button', { name: 'Continue to Content' }))
  const ask = await screen.findByRole('dialog', { name: 'Uploaded List Not Attached' })
  expect(within(ask).getByText('“Booth scans” isn’t attached yet. Confirm it now, or continue without it?')).toBeTruthy()
  await user.click(within(ask).getByRole('button', { name: 'Confirm and Continue' }))
  await vi.waitFor(() => expect(window.location.search).toBe('?step=content'))
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ contact_lists: [expect.stringMatching(/^cl-/)] })

  cleanup()
  const second = await openStep(empty())
  await uploadList(second.user, 'Booth scans')
  await second.user.click(screen.getAllByRole('button', { name: 'Save and Close' })[0])
  await second.user.click(within(await screen.findByRole('dialog', { name: 'Uploaded List Not Attached' })).getByRole('button', { name: 'Continue Without It' }))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/campaigns/c1'))
  expect(second.calls.filter((call) => call.method === 'PATCH').every((call) => (call.body as { contact_lists?: string[] }).contact_lists?.length === 0 || !(call.body as object).hasOwnProperty('contact_lists'))).toBe(true)
}, 20_000)

// ---------------------------------------------------------------- drips
const drip = (overrides = {}) => makeCampaign({ status: 'DRAFT', campaign_type: 'DRIP', send_type: 'DRIP', ...overrides })
const DRIP_NOTE = 'Everyone eligible starts the drip together on the start date. People added to these lists later don’t join. Consent and frequency limits are checked again before each message.'

test('a drip: "How a Drip Audience Works" above Send To, in the empty state too; everything else as for any campaign', async () => {
  await openStep(drip({ contact_lists: [], contact_list_details: [] }))
  const note = document.querySelector<HTMLElement>('[data-drip-audience-note]')!
  expect(within(note).getByText('How a Drip Audience Works')).toBeTruthy()
  expect(within(note).getByText(DRIP_NOTE)).toBeTruthy()
  expect(note.compareDocumentPosition(card('Send To')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()      // above Send To
  expect(within(card('Send To')).getByText('Add the lists this drip goes to. A draft can be saved without one; publishing needs at least one.')).toBeTruthy()
  expect(within(card('Don’t Send To')).getByText('Nobody is left out by a list.')).toBeTruthy()
  expect(within(card('Don’t Send To')).getByRole('button', { name: 'Add List to Leave Out' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Continue to Drip Campaign Setup/ })).toBeTruthy()                  // a draft can move on without lists
  cleanup()

  await openStep(makeCampaign({ status: 'DRAFT', contact_lists: [], contact_list_details: [] }))
  expect(document.querySelector('[data-drip-audience-note]')).toBeNull()                           // not for other campaigns
  expect(within(card('Send To')).getByText('Add the lists this campaign goes to. A draft can be saved without one; publishing needs at least one.')).toBeTruthy()
})

test('a drip nobody can receive: a warning in the channel’s words, never a block', async () => {
  await openStep(drip({ channel: 'EMAIL' }), { estimate: { estimated_recipients: 0 } })
  expect(await screen.findByText('No one on these lists can receive marketing email right now. Check consent or the lists you’re leaving out.')).toBeTruthy()
  expect((screen.getByRole('button', { name: /Continue to Drip Campaign Setup/ }) as HTMLButtonElement).disabled).toBe(false)
  cleanup()
  await openStep(drip({ channel: 'SMS' }), { estimate: { estimated_recipients: 0 } })
  expect(await screen.findByText('No one on these lists can receive marketing texts right now. Check consent or the lists you’re leaving out.')).toBeTruthy()
})
