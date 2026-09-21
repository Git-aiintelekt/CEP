/** The campaign module through the real app shell against the in-memory API: the list, the seven-step setup, and the campaign page. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, me, problem, signIn } from '@/test/mockApi'

/** The API client reads its session when the module loads, so each test signs in first and imports the app fresh. */
async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
const run = (overrides: Record<string, unknown>) => ({ id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
  started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:02:00Z', row_version: 1, ...overrides })

const workspace = () => [
  makeCampaign({ id: 'c1', name: 'Fall Launch', tags: ['Fall'] }),
  makeCampaign({ id: 'c2', name: 'Labor Day SMS Blast', code: 'CMP-2026-0002', channel: 'SMS', status: 'ACTIVE', runs: [run({ id: 'r2', campaign: 'c2', status: 'SENDING', completed_at: null })] }),
  makeCampaign({ id: 'c3', name: 'Winter Preview', code: 'CMP-2026-0003', status: 'PRODUCTION_PUBLISHED', send_type: 'SCHEDULED', scheduled_at: soon, send_timezone: 'America/Chicago',
                 runs: [run({ id: 'r3', campaign: 'c3', status: 'SCHEDULED', scheduled_at: soon, started_at: null, completed_at: null })] }),
  makeCampaign({ id: 'c4', name: 'Welcome Series Email 1', code: 'CMP-2026-0004', campaign_type: 'DRIP', status: 'PRODUCTION_PUBLISHED', is_journey_generated: true, triggered_by: 'JOURNEY' }),
  makeCampaign({ id: 'c5', name: 'Old Spring Sale', code: 'CMP-2026-0005', status: 'ARCHIVED' }),
]

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('list: what is coming up, locked status wording, the action that fits each status, archived campaigns kept out, filters and sorting sent to the API', async () => {
  const calls = installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')

  const upcoming = await screen.findByRole('region', { name: 'Upcoming campaigns' })
  expect(await within(upcoming).findByText('Winter Preview')).toBeTruthy()                          // the block is there at once; its cards arrive with the data
  expect(within(upcoming).queryByText('Fall Launch')).toBeNull()

  const table = await screen.findByRole('table', { name: 'Campaigns' })
  const row = (name: string) => within(table).getByRole('link', { name }).closest('tr') as HTMLElement
  expect(within(row('Fall Launch')).getByText('Draft')).toBeTruthy()
  expect(within(row('Fall Launch')).getByRole('link', { name: 'Edit' })).toBeTruthy()                 // a draft whose setup is finished; an unfinished one says Continue setup
  expect(within(row('Winter Preview')).getByText('Scheduled')).toBeTruthy()                          // stored as production published, shown as scheduled
  expect(within(row('Labor Day SMS Blast')).getByRole('link', { name: 'View results' })).toBeTruthy()
  expect(within(row('Welcome Series Email 1')).getByText('Journey-generated · not editable')).toBeTruthy()
  expect(within(row('Welcome Series Email 1')).getByText('Production Published')).toBeTruthy()
  expect(within(table).queryByText('Old Spring Sale')).toBeNull()
  expect(screen.getByText('1 to 4 of 4')).toBeTruthy()

  await user.selectOptions(screen.getByLabelText('Status'), 'ARCHIVED')
  expect(await within(await screen.findByRole('table', { name: 'Campaigns' })).findByText('Old Spring Sale')).toBeTruthy()
  await user.selectOptions(screen.getByLabelText('Status'), '')
  await user.selectOptions(screen.getByLabelText('Channel'), 'SMS')
  await vi.waitFor(() => expect(screen.getByText('1 to 1 of 1')).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  await user.click(await screen.findByRole('button', { name: 'Campaign name' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('ordering=name') && !call.url.includes('ordering=-name'))).toBe(true))
  expect(screen.getByRole('columnheader', { name: 'Campaign name' }).getAttribute('aria-sort')).toBe('ascending')
  expect(calls.some((call) => call.url.includes('channel=SMS') && call.url.includes('page_size=50'))).toBe(true)
})

test('calendar view: a tab of the same page, the month as a grid with a bar per campaign, the same filters, and the upcoming block above both views', async () => {
  const now = new Date().toISOString()
  const calls = installMockApi({ campaigns: [...workspace(),
    makeCampaign({ id: 'c6', name: 'Sent today', code: 'CMP-2026-0006', status: 'COMPLETED', runs: [run({ id: 'r6', campaign: 'c6', started_at: now, completed_at: now })] as never }),
    makeCampaign({ id: 'c7', name: 'Texts today', code: 'CMP-2026-0007', channel: 'SMS', status: 'PAUSED', runs: [run({ id: 'r7', campaign: 'c7', status: 'PAUSED', started_at: now, completed_at: null })] as never })] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')

  const views = await screen.findByRole('tablist', { name: 'Campaign views' })
  expect(within(views).getByRole('tab', { name: 'List view', selected: true })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Create Campaign' }).className).toContain('bg-brand-600')
  const upcoming = await screen.findByRole('region', { name: 'Upcoming campaigns' })
  expect(await within(upcoming).findByText('Winter Preview')).toBeTruthy()
  expect(within(upcoming).getByText(/recipients/)).toBeTruthy()

  await user.click(within(views).getByRole('tab', { name: 'Calendar view' }))
  expect(window.location.search).toBe('?view=calendar')
  const calendar = await screen.findByRole('region', { name: 'Campaign calendar' })
  expect(screen.getByRole('region', { name: 'Upcoming campaigns' })).toBeTruthy()                       // stays above the calendar too
  expect(screen.queryByRole('table', { name: 'Campaigns' })).toBeNull()
  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date())
  expect(within(calendar).getByRole('heading', { name: title })).toBeTruthy()
  expect(within(calendar).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  const sent = await within(calendar).findByRole('link', { name: /^Sent today: Completed/ })
  expect(sent.getAttribute('href')).toBe('/campaigns/c6')
  expect(sent.className).toContain('bg-success-bg')
  expect(within(calendar).getByRole('link', { name: /^Texts today: Paused/ }).className).toContain('bg-warning-bg')   // status is a colour and a word, never blue
  expect(within(calendar).queryByRole('link', { name: /^Fall Launch/ })).toBeNull()                       // a draft without a date is not on the calendar

  await user.selectOptions(screen.getByLabelText('Channel'), 'SMS')                                       // the filters above drive the calendar as they drive the list
  await vi.waitFor(() => expect(within(calendar).queryByRole('link', { name: /^Sent today/ })).toBeNull())
  expect(within(calendar).getByRole('link', { name: /^Texts today/ })).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/campaigns/calendar/') && call.url.includes('channel=SMS') && call.url.includes('date_from='))).toBe(true)
  expect(screen.queryByLabelText(/Created from/)).toBeNull()                                              // in the calendar the month is the date range

  await user.click(within(calendar).getByRole('button', { name: 'Next month' }))
  const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
  expect(await within(calendar).findByRole('heading', { name: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(next) })).toBeTruthy()
  await user.click(within(calendar).getByRole('button', { name: 'Today' }))
  expect(await within(calendar).findByRole('heading', { name: title })).toBeTruthy()

  cleanup()
  installMockApi({ campaigns: [makeCampaign({})] })
  await renderAppAt('/campaigns?view=calendar')                                                           // the view is part of the address
  expect(await screen.findByRole('region', { name: 'Campaign calendar' })).toBeTruthy()
  expect(await within(screen.getByRole('region', { name: 'Upcoming campaigns' })).findByText(/Nothing is scheduled/)).toBeTruthy()
})

test('list: pausing asks first and then shows Paused with Resume; bulk clone and bulk archive report what happened', async () => {
  const calls = installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })

  await user.click(within(table).getByRole('button', { name: 'Actions for Labor Day SMS Blast' }))
  expect(screen.queryByRole('menuitem', { name: 'Resume' })).toBeNull()
  await user.click(screen.getByRole('menuitem', { name: 'Pause' }))
  const dialog = await screen.findByRole('dialog', { name: 'Pause this campaign?' })
  expect(calls.some((call) => call.url.endsWith('/pause/'))).toBe(false)                              // nothing until confirmed
  await user.click(within(dialog).getByRole('button', { name: 'Pause' }))
  expect((await screen.findByRole('status')).textContent).toContain('“Labor Day SMS Blast” is paused')
  await vi.waitFor(() => expect(within(within(screen.getByRole('table', { name: 'Campaigns' })).getByRole('link', { name: 'Labor Day SMS Blast' }).closest('tr') as HTMLElement).getByText('Paused')).toBeTruthy())
  await user.click(screen.getByRole('button', { name: 'Actions for Labor Day SMS Blast' }))
  expect(screen.getByRole('menuitem', { name: 'Resume' })).toBeTruthy()
  await user.keyboard('{Escape}')

  await user.click(screen.getByRole('checkbox', { name: 'Select Fall Launch' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Winter Preview' }))
  const bar = screen.getByRole('region', { name: 'Bulk actions' })
  expect(within(bar).getByText('2 selected')).toBeTruthy()
  await user.click(within(bar).getByRole('button', { name: 'Clone' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 campaigns cloned.'))
  expect(calls.find((call) => call.url.endsWith('/campaigns/bulk/'))?.body).toEqual({ action: 'clone', ids: ['c1', 'c3'] })
  expect(await screen.findByRole('link', { name: 'Copy of Fall Launch' })).toBeTruthy()

  await user.click(screen.getByRole('checkbox', { name: 'Select Copy of Fall Launch' }))
  await user.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Archive' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Archive 1 campaign?' })).getByRole('button', { name: 'Archive' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 campaign archived.'))
  await vi.waitFor(() => expect(screen.queryByRole('link', { name: 'Copy of Fall Launch' })).toBeNull())
})

test('setup, steps 1 to 4: the draft is created on the first Continue and saved on each one after; lists to send to and to exclude; a schedule in the campaign time zone', async () => {
  const calls = installMockApi({ campaigns: [] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/new')

  // 1. Basic Info: a short name stops here, nothing is sent
  await user.type(await screen.findByLabelText(/^Campaign name/), 'ab')
  await user.click(screen.getByRole('button', { name: 'Create draft and continue' }))
  expect(await screen.findByText('Use at least 3 characters.')).toBeTruthy()
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))).toBe(false)
  expect((screen.getByRole('button', { name: /Audience/ }) as HTMLButtonElement).disabled).toBe(true)  // steps ahead open through Continue
  await user.type(screen.getByLabelText(/^Campaign name/), ' Holiday Preview')
  expect(screen.getByRole('radio', { name: /Regular Marketing/ }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('radio', { name: /^Email/ }).getAttribute('aria-checked')).toBe('true')
  await user.type(screen.getByLabelText('Tags'), 'Holiday{Enter}vip,')
  expect(screen.getByRole('button', { name: 'Remove the tag Holiday' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Create draft and continue' }))

  // 2. Audience
  expect(await screen.findByRole('heading', { name: 'Audience' })).toBeTruthy()
  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/campaigns/'))
  expect(post?.body).toMatchObject({ name: 'ab Holiday Preview', campaign_type: 'REGULAR_MARKETING', channel: 'EMAIL', solicitation_type: 'MARKETING', owner_user: 'u1', tags: ['Holiday', 'vip'], send_type: 'IMMEDIATE', setup_step: 1 })
  expect(post?.body).not.toHaveProperty('row_version')
  expect(window.location.pathname).toBe('/campaigns/c-new/edit')
  expect((screen.getByRole('button', { name: /Template/ }) as HTMLButtonElement).disabled).toBe(true)     // one step at a time
  await user.click(await screen.findByRole('checkbox', { name: 'Select every list shown' }))       // more than one list at once
  expect((screen.getByRole('checkbox', { name: 'Send to Fall Master Audience' }) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByText(/2 lists selected, 120 contacts before duplicates and governance/)).toBeTruthy()
  await user.click(screen.getByRole('checkbox', { name: 'Send to Georgia only' }))                    // and one off again
  await user.click(screen.getByText(/Keep people out of this campaign/))
  await user.click(await screen.findByRole('checkbox', { name: 'Exclude Georgia only' }))
  expect((screen.getByRole('checkbox', { name: 'Send to Georgia only' }) as HTMLInputElement).disabled).toBe(true)   // a list is sent to, or excluded, never both
  const estimate = await screen.findByLabelText('Audience estimate')
  await vi.waitFor(() => expect(within(estimate).getByText('Estimated recipients').nextElementSibling?.textContent).toBe('78'))
  expect(calls.some((call) => call.url.includes('/campaigns/audience-estimate/') && call.url.includes('include=cl-master') && call.url.includes('exclude=cl-ga'))).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))

  // 3. Template: only what fits the channel; the preview is of the template picked here, saved or not
  expect(await screen.findByRole('heading', { name: 'Template' })).toBeTruthy()
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ contact_lists: ['cl-master'], excluded_lists: ['cl-ga'], row_version: 2, setup_step: 2 })
  const cards = await screen.findByRole('radiogroup', { name: 'Template' })
  expect(within(cards).queryByRole('radio', { name: /Fall SMS/ })).toBeNull()
  expect(within(cards).queryByRole('radio', { name: /Retired Email/ })).toBeNull()
  await user.click(within(cards).getByRole('radio', { name: /Fall Email/ }))
  expect(await screen.findByTitle('Email preview')).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/campaigns/c-new/preview/') && call.url.includes('template=tpl-email'))).toBe(true)
  await user.selectOptions(screen.getByLabelText('Send from'), 'snd-email')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))

  // 4. Scheduling: 09:00 in Chicago is 15:00 UTC in November
  expect(await screen.findByRole('heading', { name: 'Scheduling & Delivery' })).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: /Schedule for later/ }))
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))
  expect(await screen.findByText('Choose the date and time of the send.')).toBeTruthy()
  await user.selectOptions(screen.getByLabelText('Time zone'), 'America/Chicago')
  await user.type(screen.getByLabelText(/^Send at\*/), '2099-11-02T09:00')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))
  expect(await screen.findByRole('heading', { name: 'Targets & Economics' })).toBeTruthy()
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ template: 'tpl-email', sender_profile: 'snd-email', send_type: 'SCHEDULED', send_timezone: 'America/Chicago',
    scheduled_at: '2099-11-02T15:00:00.000Z', respect_governance: true, setup_step: 4 })
})

test('setup, steps 5 to 7: targets, a test publish to colleagues, the checklist, and a production publish that asks once more', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=5')

  await user.type(await screen.findByLabelText('Revenue (USD)'), '25000')
  await user.type(screen.getByLabelText('Planned campaign cost (USD)'), '5000')
  expect(screen.getByText('5.0 : 1')).toBeTruthy()
  await user.type(screen.getByLabelText('Clicks'), '4x')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))
  expect(await screen.findByText('Enter a whole number, zero or more.')).toBeTruthy()
  await user.clear(screen.getByLabelText('Clicks'))
  await user.type(screen.getByLabelText('Clicks'), '40')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))

  expect(await screen.findByRole('heading', { name: 'Test & Preview' })).toBeTruthy()
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ targets: { target_revenue: '25000', planned_cost: '5000', target_clicks: 40, target_opens: null } })
  const test = await screen.findByRole('group', { name: 'Send a test' })
  await user.clear(within(test).getByLabelText('Other addresses'))
  await user.click(await within(test).findByRole('checkbox', { name: /Devon Okafor/ }))
  await user.click(within(test).getByRole('button', { name: 'Send test' }))
  expect(await within(test).findByText('Sent to devon@example.com')).toBeTruthy()
  expect(calls.find((call) => call.url.endsWith('/test-publish/'))?.body).toEqual({ to: [], user_ids: ['u2'] })
  expect(await screen.findByText('Test Published')).toBeTruthy()                                        // the draft moved on
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))

  expect(await screen.findByRole('heading', { name: 'Review & Publish' })).toBeTruthy()
  const checklist = await screen.findByRole('list', { name: 'Pre-publish checklist' })
  expect(within(checklist).getByText('Test message sent and reviewed').nextElementSibling?.textContent).toBe(': done')
  await user.click(screen.getByRole('button', { name: 'Publish to production' }))
  const dialog = await screen.findByRole('dialog', { name: 'Publish to production?' })
  expect(within(dialog).getByText(/goes to about/).textContent).toContain('88')
  expect(calls.some((call) => call.url.endsWith('/publish/'))).toBe(false)
  await user.click(within(dialog).getByRole('button', { name: 'Publish' }))
  expect(await screen.findByRole('tab', { name: 'Overview' })).toBeTruthy()                             // landed on the campaign page
  expect(screen.getByText('Production Published')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
})

test('setup: the checklist holds a campaign back, the API\'s field messages open the step they belong to, a published campaign is not editable', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', template: null, template_name: null }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=7')
  const checklist = await screen.findByRole('list', { name: 'Pre-publish checklist' })
  expect(within(checklist).getByText('Choose a template.')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Publish to production' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Edit Template' }))
  expect(await screen.findByRole('heading', { name: 'Template' })).toBeTruthy()

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), onSave: () => problem(400, { title: 'Invalid input', errors: { name: ['Another campaign already has this name.'] } }) })
  await renderAppAt('/campaigns/c1/edit?step=5')
  await user.type(await screen.findByLabelText('Conversions'), '12')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))
  expect(await screen.findByRole('heading', { name: 'Basic Info' })).toBeTruthy()
  expect(screen.getByText('Another campaign already has this name.')).toBeTruthy()

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'ACTIVE' }) })
  await renderAppAt('/campaigns/c1/edit')
  expect(await screen.findByText(/This campaign is active, so it can no longer be edited/)).toBeTruthy()
})

test('setup: a drip campaign sends as a series of steps; an e-receipt needs no list and no schedule', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', campaign_type: 'DRIP', send_type: 'DRIP', drip_config: { time: '10:00', steps: [{ day: 0, label: 'Welcome' }] } }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=4')
  expect(await screen.findByRole('radio', { name: /Drip series/ })).toBeTruthy()
  expect(screen.queryByRole('radio', { name: /Send immediately/ })).toBeNull()
  expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Welcome')
  await user.click(screen.getByRole('button', { name: 'Add a step' }))
  expect((screen.getByLabelText(/^Step 2: day/) as HTMLInputElement).value).toBe('3')
  await user.clear(screen.getByLabelText(/^Step 2: day/))
  await user.type(screen.getByLabelText(/^Step 2: day/), '0')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))
  expect(await screen.findByText('Another step is already on this day.')).toBeTruthy()
  await user.clear(screen.getByLabelText(/^Step 2: day/))
  await user.type(screen.getByLabelText(/^Step 2: day/), '7')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))
  await screen.findByRole('heading', { name: 'Targets & Economics' })
  expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ send_type: 'DRIP', drip_config: { time: '10:00', steps: [{ day: 0, label: 'Welcome' }, { day: 7 }] } })

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', campaign_type: 'E_RECEIPT', solicitation_type: 'TRANSACTIONAL', contact_lists: [], contact_list_details: [] }) })
  await renderAppAt('/campaigns/c1/edit?step=2')
  expect(await screen.findByText('This is an E-Receipt campaign, so there is no contact list to attach')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Upload a CSV file/ })).toBeNull()
  await user.click(screen.getByRole('button', { name: /Scheduling & Delivery/ }))
  expect(await screen.findByText('This is an E-Receipt campaign, so there is no schedule to set')).toBeTruthy()

  // the way out is on the page: change the type, and the lists are there to attach or to create
  await user.click(screen.getByRole('button', { name: /Audience/ }))
  await user.click(await screen.findByRole('button', { name: 'Change the campaign type' }))
  expect(await screen.findByRole('heading', { name: 'Basic Info' })).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: /Regular Marketing/ }))
  expect((screen.getByLabelText(/^Message purpose/) as HTMLSelectElement).value).toBe('MARKETING')
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))
  expect(await screen.findByRole('checkbox', { name: 'Send to Fall Master Audience' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Upload a CSV file/ })).toBeTruthy()
})

test('an unfinished setup opens where it stopped, from the list and from the campaign address; the campaign page opens once every step before the publish is done', async () => {
  const half = () => makeCampaign({ id: 'c1', name: 'Fall Launch', status: 'DRAFT', setup_step: 2, template: null, template_name: null, sender_profile: null, sender_profile_name: null })
  const calls = installMockApi({ campaigns: [half()] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  expect(within(table).getByText('Setup not finished: step 3 of 7')).toBeTruthy()
  expect(within(table).getByRole('link', { name: 'Continue setup' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=3')
  await user.click(within(table).getByRole('link', { name: 'Fall Launch' }))                          // the name leads to the setup too
  expect(await screen.findByRole('heading', { name: 'Template' })).toBeTruthy()
  expect(screen.getByText(/Setup in progress: 2 of 6 steps done/)).toBeTruthy()
  expect((screen.getByRole('button', { name: /Audience/ }) as HTMLButtonElement).disabled).toBe(false)  // what was done can be revisited
  expect(screen.getByRole('button', { name: 'Basic Info, completed' })).toBeTruthy()                   // and says so
  expect(screen.getByRole('button', { name: 'Audience, completed' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Template, completed/ })).toBeNull()                     // the step in hand is not done yet
  expect((screen.getByRole('button', { name: /Scheduling & Delivery/ }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByRole('link', { name: 'Back to the campaign' })).toBeNull()

  cleanup()
  installMockApi({ campaigns: [half()] })
  await renderAppAt('/campaigns/c1?tab=performance')                                                  // a bookmark or a typed address
  expect(await screen.findByRole('heading', { name: 'Template' })).toBeTruthy()
  expect(window.location.pathname + window.location.search).toBe('/campaigns/c1/edit?step=3')
  expect(screen.queryByRole('tablist')).toBeNull()

  cleanup()
  installMockApi({ campaigns: [half()] })
  await renderAppAt('/campaigns/c1/edit?step=7')                                                       // no jumping ahead to the publish
  expect(await screen.findByRole('heading', { name: 'Template' })).toBeTruthy()
  await user.click(await screen.findByRole('radio', { name: /Fall Email/ }))
  await user.click(screen.getByRole('button', { name: 'Save and close' }))                             // keeps the place, does not move it on
  expect(await screen.findByRole('table', { name: 'Campaigns' })).toBeTruthy()
  expect(screen.getByText('Setup not finished: step 3 of 7')).toBeTruthy()
  expect(calls.length).toBeGreaterThan(0)

  cleanup()
  const last = installMockApi({ campaigns: [makeCampaign({ id: 'c1', name: 'Fall Launch', status: 'DRAFT', setup_step: 5 })] })
  await renderAppAt('/campaigns/c1')
  expect(await screen.findByRole('heading', { name: 'Test & Preview' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save and continue' }))                          // nothing was changed: the step is still recorded as done
  expect(await screen.findByRole('heading', { name: 'Review & Publish' })).toBeTruthy()
  expect(last.filter((call) => call.method === 'PATCH').at(-1)?.body).toMatchObject({ setup_step: 6 })
  await user.click(screen.getByRole('link', { name: 'Back to the campaign' }))                        // every step but the publish is done: the page is there
  expect(await screen.findByRole('tablist', { name: 'Campaign sections' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Production Publish' })).toBeTruthy()
})

test('an unfinished setup, for someone who may not edit: the campaign page, with a note that the setup is not finished', async () => {
  installMockApi({ campaigns: [makeCampaign({ id: 'c1', status: 'DRAFT', setup_step: 2 })], me: { principal: { ...me.principal, permissions: ['campaign.view'] } } as never })
  await renderAppAt('/campaigns/c1')
  expect(await screen.findByText(/The setup of this campaign is not finished: 2 of 6 steps are done/)).toBeTruthy()
  expect(screen.getByRole('tablist', { name: 'Campaign sections' })).toBeTruthy()
})

test('campaign page: six tabs; results against targets with a chart and its numbers; the frozen Campaign List; the log, filtered', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z', runs: [run({})] as never,
    targets: { target_revenue: '25000.00', target_opens: null, target_clicks: 40, target_conversions: null, target_redemptions: null, planned_cost: null, planned_offer_cost: null, notes: null } }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')

  const tabs = await screen.findByRole('tablist', { name: 'Campaign sections' })
  expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Performance', 'Audience', 'Content', 'Settings', 'Activity Log'])
  expect(await screen.findByText('Delivery rate')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clone' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Production Publish' })).toBeNull()

  await user.click(within(tabs).getByRole('tab', { name: 'Performance' }))
  expect(await screen.findByRole('img', { name: /Messages sent, delivered, opened, clicked per hour/ })).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: 'Clicks against target' }).getAttribute('aria-valuenow')).toBe('30')
  expect(screen.getByText('52.6% of delivered')).toBeTruthy()
  expect(screen.getByText('northwind.example')).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: 'By day' }))                                      // the shared segmented control: one choice of two
  expect(window.location.search).toBe('?tab=performance')

  await user.keyboard('{ArrowRight}')                                                                  // tabs follow the arrow keys once one has focus
  await user.click(within(tabs).getByRole('tab', { name: 'Audience' }))
  expect(await screen.findByText('Frozen Campaign List')).toBeTruthy()
  expect(screen.getByText('Left out: Unsubscribed')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Export CSV/ })).toBeTruthy()

  await user.click(within(tabs).getByRole('tab', { name: 'Activity Log' }))
  const log = await screen.findByRole('list', { name: 'Activity log' })
  expect(within(log).getAllByRole('listitem')).toHaveLength(2)
  await user.selectOptions(screen.getByLabelText('Show'), 'WARNING')
  expect(within(screen.getByRole('list', { name: 'Activity log' })).getAllByRole('listitem')).toHaveLength(1)
})

test('campaign page: Edit opens the setup step that belongs to the tab in view, and the setup leads back to that tab', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')
  const tabs = await screen.findByRole('tablist', { name: 'Campaign sections' })
  const header = () => screen.getAllByRole('link', { name: 'Edit' })[0]                                // the Settings tab has an Edit of its own on each panel
  const editStep = () => header().getAttribute('href')
  expect(editStep()).toBe('/campaigns/c1/edit?step=1')                                                // Overview: Basic Info
  for (const [tab, step] of [['Performance', 5], ['Content', 3], ['Settings', 4], ['Activity Log', 1], ['Audience', 2]] as const) {
    await user.click(within(tabs).getByRole('tab', { name: tab }))
    expect(editStep()).toBe(`/campaigns/c1/edit?step=${step}`)
  }

  await user.click(header())                                                                           // from the Audience tab
  expect(await screen.findByRole('heading', { name: 'Audience' })).toBeTruthy()
  for (const name of ['Basic Info', 'Audience', 'Template', 'Scheduling & Delivery', 'Targets & Economics', 'Test & Preview']) expect(screen.getByRole('button', { name: `${name}, completed` })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Review & Publish, completed/ })).toBeNull()              // the publish is never 'done' on a draft
  expect(await screen.findByRole('checkbox', { name: 'Send to Fall Master Audience' })).toBeTruthy()
  await user.click(screen.getByRole('link', { name: 'Back to the campaign' }))
  expect(await screen.findByRole('tab', { name: 'Audience', selected: true })).toBeTruthy()          // and back where it started

  await user.click(header())
  await user.click(await screen.findByRole('button', { name: /Scheduling & Delivery/ }))
  expect(await screen.findByRole('heading', { name: 'Scheduling & Delivery' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save and close' }))
  expect(await screen.findByRole('tab', { name: 'Settings', selected: true })).toBeTruthy()
})

test('campaign page: actions by status: a scheduled send can be cancelled, a paused one resumed, an archived one restored, a clone opens in the setup', async () => {
  installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c3')
  const header = (await screen.findByRole('heading', { name: 'Winter Preview' })).parentElement as HTMLElement
  expect(within(header).getByText('Scheduled')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Cancel schedule' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Cancel the scheduled send?' })).getByRole('button', { name: 'Cancel the send' }))
  expect((await screen.findByRole('status')).textContent).toContain('The campaign is a draft again')
  expect(await screen.findByRole('link', { name: 'Edit' })).toBeTruthy()

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'PAUSED', runs: [run({ status: 'PAUSED', completed_at: null })] as never }) })
  await renderAppAt('/campaigns/c1')
  expect(await screen.findByText(/This campaign is paused/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Resume' }))
  await vi.waitFor(() => expect(screen.queryByText(/This campaign is paused/)).toBeNull())

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'ARCHIVED' }) })
  await renderAppAt('/campaigns/c1')
  await user.click(await screen.findByRole('button', { name: 'Unarchive' }))
  expect((await screen.findByRole('status')).textContent).toContain('is back as Draft')
  await user.click(screen.getByRole('button', { name: 'Clone' }))
  expect(await screen.findByRole('heading', { name: 'Basic Info' })).toBeTruthy()
  expect(window.location.pathname).toBe('/campaigns/c1-copy/edit')
  expect((screen.getByLabelText(/^Campaign name/) as HTMLInputElement).value).toBe('Copy of Fall Launch')
})

test('permissions: without campaign.edit there is nothing to create, select or change; without campaign.publish nothing to pause or publish', async () => {
  const viewer = { principal: { ...me.principal, permissions: ['campaign.view'] } }
  installMockApi({ campaigns: workspace(), me: viewer as never })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  expect(screen.queryByRole('link', { name: /Create Campaign/ })).toBeNull()
  expect(within(table).queryByRole('checkbox')).toBeNull()
  expect(within(table).queryByRole('link', { name: 'Continue setup' })).toBeNull()
  await user.click(within(table).getByRole('button', { name: 'Actions for Labor Day SMS Blast' }))
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open', 'View results'])

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), me: { principal: { ...me.principal, permissions: ['campaign.view', 'campaign.edit'] } } as never })
  await renderAppAt('/campaigns/c1/edit?step=7')
  expect(await screen.findByText(/Publishing needs the campaign.publish permission/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Publish to production' })).toBeNull()
})
