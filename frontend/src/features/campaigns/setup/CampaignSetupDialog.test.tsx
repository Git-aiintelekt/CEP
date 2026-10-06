/** The Create Campaign pop-up over the list, and the same pop-up as "Edit details" for an existing campaign. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, problem, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const dialog = (name = 'Create Campaign') => screen.getByRole('dialog', { name })
const radio = (group: string, name: RegExp) => within(within(dialog()).getByRole('radiogroup', { name: group })).getByRole('radio', { name })

async function openCreate(options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ campaigns: [], ...options })
  await renderAppAt('/campaigns')
  const user = userEvent.setup()
  const opener = await screen.findByRole('button', { name: 'Create Campaign' })
  await user.click(opener)
  await screen.findByRole('dialog', { name: 'Create Campaign' })
  return { calls, user, opener }
}

async function fillValid(user: ReturnType<typeof userEvent.setup>, name = 'Holiday Preview') {
  await user.type(within(dialog()).getByLabelText(/^Campaign Name/), name)
  await user.click(radio('Campaign Type', /Regular Marketing/))
  await user.click(radio('Channel', /^Email/))
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('opens from the header button with focus in the name; Cancel closes it without asking and focus goes back', async () => {
  const { user, opener } = await openCreate()
  const box = dialog()
  expect(within(box).getByRole('heading', { name: 'Create Campaign' }).className).toContain('text-lg')               // the shared set-up frame's title
  expect(box.hasAttribute('data-setup-dialog')).toBe(true)
  expect(within(box).queryByText(/^Name it and pick/)).toBeNull()                                   // no subtitle under the title
  expect(within(box).getByRole('radiogroup', { name: /^Channel/ }).getAttribute('aria-describedby')).toBeTruthy()
  expect(within(box).getByText('The type and channel are fixed once you choose the content.')).toBeTruthy() // the note now sits under Channel
  expect(document.activeElement).toBe(within(box).getByLabelText(/^Campaign Name/))
  expect((within(box).getByLabelText(/^Campaign Name/) as HTMLInputElement).placeholder).toBe('e.g. Fall Promo Email')
  await user.type(within(box).getByLabelText(/^Campaign Name/), 'Draft idea')
  await user.click(within(box).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()                                                   // no "discard?" question: nothing was saved
  expect(document.activeElement).toBe(opener)

  await user.click(opener)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('/campaigns/new is the list with the pop-up open; closing it goes to /campaigns', async () => {
  installMockApi({ campaigns: [] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/new')
  expect(await screen.findByRole('dialog', { name: 'Create Campaign' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeTruthy()
  await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
  expect(window.location.pathname).toBe('/campaigns')
})

test('four type cards and four channel cards; MMS reads "Text with an image"; arrow keys move and choose', async () => {
  const { user } = await openCreate()
  const types = within(dialog()).getByRole('radiogroup', { name: 'Campaign Type' })
  expect(within(types).getAllByRole('radio').map((item) => item.textContent)).toEqual([
    'Most CommonRegular MarketingOne-time or scheduled send', 'DripMulti-run scheduled pattern', 'E-ReceiptTransactional receipt communication', 'OtherService or legal notices'])
  const channels = within(dialog()).getByRole('radiogroup', { name: 'Channel' })
  expect(within(channels).getByRole('radio', { name: /^MMS/ }).textContent).toBe('MMSText with an image')
  expect(within(channels).getByRole('radio', { name: /Multiple Channels/ })).toBeTruthy()

  await user.click(radio('Campaign Type', /Regular Marketing/))
  expect(radio('Campaign Type', /Regular Marketing/).className).toContain('bg-brand-100')
  await user.keyboard('{ArrowRight}')
  expect(radio('Campaign Type', /^Drip/).getAttribute('aria-checked')).toBe('true')
  expect(document.activeElement).toBe(radio('Campaign Type', /^Drip/))
})

test('message purpose waits for a type, fills in from it, and keeps a purpose the user chose', async () => {
  const { user } = await openCreate()
  const purpose = () => within(dialog()).getByLabelText(/^Message Purpose/) as HTMLSelectElement
  expect(purpose().disabled).toBe(true)
  expect(purpose().selectedOptions[0].textContent).toBe('Pick a Type First')
  await user.click(radio('Campaign Type', /Regular Marketing/))
  expect(purpose().value).toBe('MARKETING')
  await user.click(radio('Campaign Type', /^Other/))
  expect(purpose().value).toBe('SERVICE')
  await user.selectOptions(purpose(), 'LEGAL')
  await user.click(radio('Campaign Type', /^Drip/))
  expect(purpose().value).toBe('LEGAL')                                                              // the user's choice stays
})

test('E-Receipt offers Email or SMS as its channel (email by default), fills in Transactional, and creates an email campaign that opens at Content', async () => {
  const { user, calls } = await openCreate()
  await user.type(within(dialog()).getByLabelText(/^Campaign Name/), 'Store receipts')
  await user.click(radio('Campaign Type', /E-Receipt/))
  const channels = within(within(dialog()).getByRole('radiogroup', { name: 'Channel' })).getAllByRole('radio')
  expect(channels.length).toBe(2)                                                                          // a receipt is an email or a text
  expect(channels.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  expect((within(dialog()).getByLabelText(/^Message Purpose/) as HTMLSelectElement).value).toBe('TRANSACTIONAL')
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Content' })).toBeTruthy()
  expect(window.location.pathname + window.location.search).toBe('/campaigns/c-new/edit?step=content')
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))?.body).toMatchObject({ campaign_type: 'E_RECEIPT', channel: 'EMAIL', solicitation_type: 'TRANSACTIONAL', contact_lists: [], setup_step: 1 })
})

test('Create Campaign: the draft is created as the old first step did, then Audience opens', async () => {
  const { user, calls } = await openCreate()
  await fillValid(user)
  await user.click(within(dialog()).getByRole('button', { name: /More Options/ }))
  await user.type(within(dialog()).getByLabelText(/^Tags/), 'Holiday{Enter}vip,')
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  expect(await screen.findByRole('heading', { level: 2, name: 'Send To' })).toBeTruthy()                   // the Audience step
  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))
  expect(post?.body).toMatchObject({ name: 'Holiday Preview', campaign_type: 'REGULAR_MARKETING', channel: 'EMAIL', solicitation_type: 'MARKETING', owner_user: 'u1', tags: ['Holiday', 'vip'], send_type: 'IMMEDIATE', setup_step: 1 })
  expect(post?.body).not.toHaveProperty('row_version')
  expect(window.location.pathname + window.location.search).toBe('/campaigns/c-new/edit?step=audience')

  cleanup()
  const drip = await openCreate()
  await drip.user.type(within(dialog()).getByLabelText(/^Campaign Name/), 'Welcome series')
  await drip.user.click(radio('Campaign Type', /^Drip/))
  await drip.user.click(radio('Channel', /^SMS/))
  await drip.user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  await screen.findByRole('heading', { level: 2, name: 'Send To' })
  expect(drip.calls.find((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))?.body).toMatchObject({ campaign_type: 'DRIP', channel: 'SMS', send_type: 'DRIP' })
})

test('no error on opening or leaving a field: only the hint, until Create Campaign is pressed; then the message follows the typing', async () => {
  const { user } = await openCreate()
  expect(within(dialog()).getByText('Internal name, visible to your team only')).toBeTruthy()
  await user.tab()
  await user.click(within(dialog()).getByLabelText(/^Campaign Name/))
  await user.type(within(dialog()).getByLabelText(/^Campaign Name/), 'Fa')
  await user.tab()
  expect(within(dialog()).queryByText('Use at least 3 characters.')).toBeNull()

  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  expect(await within(dialog()).findByText('Use at least 3 characters.')).toBeTruthy()
  await user.type(within(dialog()).getByLabelText(/^Campaign Name/), 'll')
  expect(within(dialog()).queryByText('Use at least 3 characters.')).toBeNull()
  expect(within(dialog()).getByText('Internal name, visible to your team only')).toBeTruthy()
})

test('validation: every problem shows on its field, focus goes to the first, and More details opens by itself', async () => {
  const { user, calls } = await openCreate()
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  expect(await within(dialog()).findByText('Use at least 3 characters.')).toBeTruthy()
  expect(within(dialog()).getByText('Choose a campaign type.')).toBeTruthy()
  expect(within(dialog()).getByText('Choose a channel.')).toBeTruthy()
  expect(document.activeElement).toBe(within(dialog()).getByLabelText(/^Campaign Name/))
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))).toBe(false)

  await fillValid(user)
  expect(within(dialog()).queryByLabelText(/^Code/)).toBeNull()                                      // More details starts closed
  expect(within(dialog()).getByRole('button', { name: /More Options/ }).getAttribute('aria-expanded')).toBe('false')
  await user.click(within(dialog()).getByRole('button', { name: /More Options/ }))
  await user.type(within(dialog()).getByLabelText(/^Code/), 'x')
  await user.click(within(dialog()).getByRole('button', { name: /More Options/ }))                   // closed again, with a bad code inside
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  expect(await within(dialog()).findByText(/3 to 40 characters/)).toBeTruthy()
  expect(within(dialog()).getByRole('button', { name: /More Options/ }).getAttribute('aria-expanded')).toBe('true')
  await vi.waitFor(() => expect(document.activeElement).toBe(within(dialog()).getByLabelText(/^Code/)))
})

test('the owner: you to begin with; Change opens a searchable list that works with the keyboard', async () => {
  const { user, calls } = await openCreate()
  expect(within(dialog()).getByTestId('owner-name').textContent).toBe('Aby John')
  expect(within(dialog()).getByText('Owner · Auto-Assigned to You')).toBeTruthy()
  await user.click(within(dialog()).getByRole('button', { name: 'Change' }))
  const search = await within(dialog()).findByRole('combobox', { name: 'Search workspace members' })
  expect(document.activeElement).toBe(search)
  const people = within(dialog()).getByRole('listbox', { name: 'Workspace members' })
  expect(within(people).getAllByRole('option').map((item) => item.textContent)).toEqual(['AJAby Johnaby.john@aiintelekt.com', 'DODevon Okafordevon@example.com', '–No OwnerNobody answers for it yet'])
  expect(within(people).getByRole('option', { name: /Aby John/ }).getAttribute('aria-selected')).toBe('true')
  await user.type(search, 'dev')
  expect(within(people).getAllByRole('option')).toHaveLength(1)
  await user.keyboard('{Enter}')
  expect(within(dialog()).getByTestId('owner-name').textContent).toBe('Devon Okafor')
  expect(within(dialog()).getByText('Owner')).toBeTruthy()
  expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Change' }))

  await user.click(within(dialog()).getByRole('button', { name: 'Change' }))
  await user.keyboard('{Escape}')                                                                   // closes the list, not the pop-up
  expect(within(dialog()).queryByRole('listbox')).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Create Campaign' })).toBeTruthy()

  await fillValid(user)
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  await screen.findByRole('heading', { level: 2, name: 'Send To' })
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))?.body).toMatchObject({ owner_user: 'u2' })
})

test('tags: the workspace’s tags are suggested as you type; 20 at most', async () => {
  const { user } = await openCreate({ campaignTags: ['Fall', 'Fall clearance', 'VIP'] })
  await user.click(within(dialog()).getByRole('button', { name: /More Options/ }))
  const input = within(dialog()).getByLabelText(/^Tags/)
  await user.type(input, 'fa')
  const suggestions = within(dialog()).getByRole('listbox', { name: 'Tags in this workspace' })
  expect(within(suggestions).getAllByRole('option').map((item) => item.textContent)).toEqual(['Fall', 'Fall clearance'])
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(within(dialog()).getByRole('button', { name: 'Remove the tag Fall clearance' })).toBeTruthy()
  expect(within(dialog()).getByText('1 of 20')).toBeTruthy()
  for (let n = 2; n <= 20; n += 1) await user.type(input, `t${n}{Enter}`)
  expect(within(dialog()).getByText('20 of 20')).toBeTruthy()
  await user.type(input, 'one more{Enter}')
  expect(within(dialog()).getByText('Up to 20 tags.')).toBeTruthy()
  expect(within(dialog()).queryByRole('button', { name: 'Remove the tag one more' })).toBeNull()
})

test('a code in use: the server’s message on the field, naming the campaign when the server does', async () => {
  const { user } = await openCreate({ onSave: () => problem(400, { title: 'Invalid input', errors: { code: ['Another campaign already uses this code.'] } }) })
  await fillValid(user)
  await user.click(within(dialog()).getByRole('button', { name: /More Options/ }))
  await user.type(within(dialog()).getByLabelText(/^Code/), 'cmp-2026-0012')
  await user.click(within(dialog()).getByRole('button', { name: /More Options/ }))
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  expect(await within(dialog()).findByText('CMP-2026-0012 is already used by another campaign')).toBeTruthy()
  expect(within(dialog()).getByRole('button', { name: /More Options/ }).getAttribute('aria-expanded')).toBe('true')

  cleanup()
  const named = await openCreate({ onSave: () => problem(400, { title: 'Invalid input', errors: { code: ['Already used by Weekend Flash Sale.'] } }) })
  await fillValid(named.user)
  await named.user.click(within(dialog()).getByRole('button', { name: /More Options/ }))
  await named.user.type(within(dialog()).getByLabelText(/^Code/), 'CMP-2026-0012')
  await named.user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  expect(await within(dialog()).findByText('CMP-2026-0012 is already used by Weekend Flash Sale')).toBeTruthy()
})

test('creating: a spinner on the button, every field disabled, no second request, and no closing', async () => {
  let answer: (response: Response) => void = () => {}
  const { user, calls } = await openCreate({ onSave: () => new Promise<Response>((resolve) => { answer = resolve }) as never })
  await fillValid(user)
  const create = within(dialog()).getByRole('button', { name: /Create Campaign/ })
  await user.click(create)
  expect(within(create).getByRole('status', { name: 'Creating' })).toBeTruthy()
  expect(create.textContent).toContain('Create Campaign')
  expect(within(dialog()).getByLabelText(/^Campaign Name/).matches(':disabled')).toBe(true)
  await user.click(create)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog', { name: 'Create Campaign' })).toBeTruthy()
  expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))).toHaveLength(1)
  answer(problem(400, { errors: { name: ['Another campaign already has this name.'] } }))
  expect(await within(dialog()).findByText('Another campaign already has this name.')).toBeTruthy()
})

test('a server failure: the banner with the time, the entries kept, and Try again sends once more', async () => {
  let fail = true
  const { user, calls } = await openCreate({ onSave: () => (fail ? problem(500, { title: 'Server error' }) : null) })
  await fillValid(user)
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  const banner = await within(dialog()).findByRole('alert')
  expect(within(banner).getByText('The campaign was not created')).toBeTruthy()
  expect(banner.textContent).toMatch(/CEP had a problem at \d{1,2}:\d{2} [AP]M\. Your entries are still here; try again\./)
  expect(banner.textContent).not.toMatch(/Server error|on our side/)
  expect((within(dialog()).getByLabelText(/^Campaign Name/) as HTMLInputElement).value).toBe('Holiday Preview')
  fail = false
  await user.click(within(banner).getByRole('button', { name: 'Try Again' }))
  expect(await screen.findByRole('heading', { level: 2, name: 'Send To' })).toBeTruthy()                   // the Audience step
  expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))).toHaveLength(2)
}, 15_000)

test('Edit details: filled in, type and channel fixed, More details open when it holds something; Save keeps the setup where it is', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 3, tags: ['Fall'], code: 'CMP-2026-0001' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await user.click(await screen.findByRole('button', { name: 'Edit Details' }))
  const box = await screen.findByRole('dialog', { name: 'Edit Details' })
  expect(within(box).queryByText(/Name it and pick a type/)).toBeNull()
  expect((within(box).getByLabelText(/^Campaign Name/) as HTMLInputElement).value).toBe('Fall Launch')
  expect(within(box).queryByRole('radiogroup')).toBeNull()
  expect(box.querySelector('[data-locked="Campaign Type"]')?.textContent).toContain('Regular Marketing')
  expect(box.querySelector('[data-locked="Channel"]')?.textContent).toContain('Email')
  expect(within(box).getAllByText('Fixed Once Content Is Chosen')).toHaveLength(2)
  expect(within(box).getByRole('button', { name: /More Options/ }).getAttribute('aria-expanded')).toBe('true')
  expect(within(box).getByRole('button', { name: 'Remove the tag Fall' })).toBeTruthy()
  await user.clear(within(box).getByLabelText(/^Campaign Name/))
  await user.type(within(box).getByLabelText(/^Campaign Name/), 'Fall Launch 2026')
  await user.click(within(box).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.getByTestId('flow-campaign-name').textContent).toBe('Fall Launch 2026'))
  const patch = calls.filter((call) => call.method === 'PATCH').at(-1)
  expect(patch?.body).toMatchObject({ name: 'Fall Launch 2026', tags: ['Fall'], row_version: 1 })
  expect(patch?.body).not.toHaveProperty('setup_step')
  expect(patch?.body).not.toHaveProperty('campaign_type')
})

test('Edit details: someone else saved first (409): the message and a way to reload', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), onSave: () => problem(409, { title: 'Conflict', detail: 'Someone else changed this campaign. Reload to see their version.' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1?edit=details')
  const box = await screen.findByRole('dialog', { name: 'Edit Details' })
  await user.type(within(box).getByLabelText(/^Campaign Name/), ' 2')
  await user.click(within(box).getByRole('button', { name: 'Save' }))
  expect(await within(box).findByText('Someone else changed this campaign. Reload to see their version.')).toBeTruthy()
  expect(within(box).getByRole('button', { name: 'Reload the Latest Version' })).toBeTruthy()
})

test('Edit Details before any content: type and channel still change; to E-Receipt drops the lists and moves the setup off Audience', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, template: null, template_name: null, sender_profile: null, sender_profile_name: null }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=audience&details=1')
  const box = await screen.findByRole('dialog', { name: 'Edit Details' })
  expect(within(box).queryByText('Fixed Once Content Is Chosen')).toBeNull()
  expect(within(box).getByRole('radiogroup', { name: 'Campaign Type' })).toBeTruthy()
  await user.click(within(within(box).getByRole('radiogroup', { name: 'Campaign Type' })).getByRole('radio', { name: /E-Receipt/ }))
  expect(within(within(box).getByRole('radiogroup', { name: 'Channel' })).getAllByRole('radio').length).toBe(2)          // email or text
  expect((within(box).getByLabelText(/^Message Purpose/) as HTMLSelectElement).value).toBe('TRANSACTIONAL')   // re-filled: the user hadn't changed it
  await user.click(within(box).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ campaign_type: 'E_RECEIPT', channel: 'EMAIL', solicitation_type: 'TRANSACTIONAL', contact_lists: [], excluded_lists: [], send_type: 'IMMEDIATE' })
  await vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Content'))   // e-receipts have no Audience step
  expect(within(screen.getByRole('navigation', { name: 'Setup Steps' })).queryByRole('button', { name: /Audience/ })).toBeNull()
})

test('Edit Details: from E-Receipt back to Drip needs a channel, and becomes a series', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, campaign_type: 'E_RECEIPT', solicitation_type: 'TRANSACTIONAL', template: null, template_name: null, sender_profile: null, sender_profile_name: null, contact_lists: [], contact_list_details: [] }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=content&details=1')
  const box = await screen.findByRole('dialog', { name: 'Edit Details' })
  await user.click(within(within(box).getByRole('radiogroup', { name: 'Campaign Type' })).getByRole('radio', { name: /^Drip/ }))
  expect((within(box).getByLabelText(/^Message Purpose/) as HTMLSelectElement).value).toBe('MARKETING')
  await user.click(within(box).getByRole('button', { name: 'Save' }))
  expect(await within(box).findByText('Choose a channel.')).toBeTruthy()
  await user.click(within(within(box).getByRole('radiogroup', { name: 'Channel' })).getByRole('radio', { name: /^SMS/ }))
  await user.click(within(box).getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ campaign_type: 'DRIP', channel: 'SMS', send_type: 'DRIP', drip_config: { time: '09:00', steps: [{ day: 0 }] } })
  expect(within(screen.getByRole('navigation', { name: 'Setup Steps' })).getByRole('button', { name: /Audience/ })).toBeTruthy()
})

test('an e-receipt’s schedule section offers "Change the Campaign Type" only while the type can change', async () => {
  const receipt = { status: 'DRAFT', setup_step: 5, campaign_type: 'E_RECEIPT', solicitation_type: 'TRANSACTIONAL', contact_lists: [], contact_list_details: [] }
  installMockApi({ campaign: makeCampaign({ ...receipt, template: null, template_name: null, sender_profile: null, sender_profile_name: null }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=publish')
  await user.click(await screen.findByRole('button', { name: 'Change the Campaign Type' }))
  expect(await screen.findByRole('dialog', { name: 'Edit Details' })).toBeTruthy()

  cleanup()
  installMockApi({ campaign: makeCampaign(receipt) })                                                  // a template is chosen: fixed
  await renderAppAt('/campaigns/c1/edit?step=publish')
  expect(await screen.findByText('This is an E-Receipt campaign, so there is no schedule to set')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Change the Campaign Type' })).toBeNull()
})

test('the create flow speaks in title case for labels, and in sentences for help text', async () => {
  const { user } = await openCreate()
  for (const label of [/^Campaign Name/, /^Message Purpose/]) expect(within(dialog()).getByLabelText(label)).toBeTruthy()
  for (const group of ['Campaign Type', 'Channel']) expect(within(dialog()).getByRole('radiogroup', { name: group })).toBeTruthy()
  expect(within(dialog()).getByRole('button', { name: /More Options · Code and tags/ })).toBeTruthy()
  expect(within(dialog()).getByText('Internal name, visible to your team only')).toBeTruthy()
  expect(within(dialog()).getByText('Owner · Auto-Assigned to You')).toBeTruthy()
  await fillValid(user)
  await user.click(within(dialog()).getByRole('button', { name: 'Create Campaign' }))
  await screen.findByRole('heading', { level: 2, name: 'Send To' })
  const rail = within(screen.getByRole('navigation', { name: 'Setup Steps' })).getAllByRole('button').map((button) => button.querySelector('[data-step-label]')?.textContent)
  expect(rail).toEqual(['Audience', 'Content', 'Test', 'Targets', 'Review & Publish'])
  expect(screen.getByRole('button', { name: 'Continue to Content' })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Save and Close' })[0]).toBeTruthy()
})
