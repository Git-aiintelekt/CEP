/** The campaign module through the real app shell against the in-memory API: the list and the campaign page (the setup has SetupFlow.test.tsx). */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, me, signIn } from '@/test/mockApi'

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

/** the ⋮ menu of one campaign, open, and what it offers */
const rowMenu = () => screen.getByRole('region', { name: /^Actions for / })
const menuItems = () => within(rowMenu()).getAllByRole('button').map((item) => item.textContent)
const filterBar = () => screen.getByRole('search', { name: 'Filter campaigns' })
/** the campaign page's ⋮ menu, opened */
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'More Actions' }))
  return screen.getByRole('region', { name: 'More Actions' })
}
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return rowMenu()
}

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

  const upcoming = await screen.findByRole('region', { name: 'Upcoming Campaigns' })
  expect(await within(upcoming).findByText('Winter Preview')).toBeTruthy()                          // the block is there at once; its cards arrive with the data
  expect(within(upcoming).queryByText('Fall Launch')).toBeNull()

  const table = await screen.findByRole('table', { name: 'Campaigns' })
  const row = (name: string) => within(table).getByRole('button', { name }).closest('tr') as HTMLElement
  expect(within(row('Fall Launch')).getByText('Draft')).toBeTruthy()
  expect(within(row('Winter Preview')).getByText('Scheduled')).toBeTruthy()                          // stored as production published, shown as scheduled
  expect(within(row('Fall Launch')).queryByRole('link', { name: 'Edit' })).toBeNull()                // the row's jobs live in its ⋮ menu
  await openMenu(user, 'Fall Launch')
  expect(menuItems()).toEqual(['Edit', 'Clone', 'Archive'])                                           // a draft whose setup is finished; no Open, no Retry
  await openMenu(user, 'Labor Day SMS Blast')                                                          // one menu open at a time
  expect(screen.getAllByRole('region', { name: /^Actions for / })).toHaveLength(1)
  expect(menuItems()).toContain('View Results')
  await openMenu(user, 'Welcome Series Email 1')
  expect(menuItems()[0]).toBe('View Journey')
  expect(menuItems()).not.toContain('Edit')
  await user.click(within(rowMenu()).getByRole('button', { name: 'View Journey' }))
  expect(window.location.pathname).toBe('/journeys')
  window.history.back()
  expect(within(row('Welcome Series Email 1')).queryByText('Journey-generated · not editable')).toBeNull()      // no line under the name; Triggered by says Journey
  expect(within(row('Fall Launch')).queryByText('CMP-2026-0001')).toBeNull()
  const header = (name: string) => within(table).getAllByRole('columnheader').find((cell) => cell.textContent === name) as HTMLElement
  expect(header('Audience').className).toContain('text-left')
  expect(header('Campaign Name').className).toContain('text-sm')                                   // 14px headers on this table
  expect(within(row('Welcome Series Email 1')).getByText('Production Published')).toBeTruthy()
  expect(within(table).queryByText('Old Spring Sale')).toBeNull()
  expect((await screen.findByText('Showing 1–4 of 4 campaigns')).getAttribute('aria-live')).toBe('polite')
  expect((within(filterBar()).getByRole('button', { name: 'Clear Filters' }) as HTMLButtonElement).disabled).toBe(true)   // nothing to clear yet

  await user.click(within(filterBar()).getByRole('button', { name: 'Status' }))
  await user.click(within(screen.getByRole('region', { name: 'Status' })).getByRole('button', { name: 'Archived' }))
  expect(await within(await screen.findByRole('table', { name: 'Campaigns' })).findByText('Old Spring Sale')).toBeTruthy()
  await user.click(within(screen.getByRole('region', { name: 'Status' })).getByRole('button', { name: 'Archived' }))   // the menu stays open while ticking
  await user.keyboard('{Escape}')
  await user.click(within(filterBar()).getByRole('button', { name: 'Channel' }))
  await user.click(within(screen.getByRole('region', { name: 'Channel' })).getByRole('button', { name: 'SMS' }))
  await vi.waitFor(() => expect(screen.getByText('Showing 1–1 of 1 campaign')).toBeTruthy())
  expect(within(filterBar()).getByRole('button', { name: 'SMS' }).className).toContain('text-brand-800')             // the button shows the value it holds
  expect((within(filterBar()).getByRole('button', { name: 'Clear Filters' }) as HTMLButtonElement).disabled).toBe(false)
  await user.click(within(filterBar()).getByRole('button', { name: 'Clear Filters' }))
  await user.click(await screen.findByRole('button', { name: 'Campaign Name' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('ordering=name') && !call.url.includes('ordering=-name'))).toBe(true))
  expect(screen.getByRole('columnheader', { name: 'Campaign Name' }).getAttribute('aria-sort')).toBe('ascending')
  expect(calls.some((call) => call.url.includes('channel=SMS') && call.url.includes('page_size=25'))).toBe(true)   // 25 rows a page to start with
})

test('calendar view: a tab of the same page, the month as a grid with a bar per campaign, the same filters, and the upcoming block above both views', async () => {
  const now = new Date().toISOString()
  const calls = installMockApi({ campaigns: [...workspace(),
    makeCampaign({ id: 'c6', name: 'Sent today', code: 'CMP-2026-0006', status: 'COMPLETED', runs: [run({ id: 'r6', campaign: 'c6', started_at: now, completed_at: now })] as never }),
    makeCampaign({ id: 'c7', name: 'Texts today', code: 'CMP-2026-0007', channel: 'SMS', status: 'PAUSED', runs: [run({ id: 'r7', campaign: 'c7', status: 'PAUSED', started_at: now, completed_at: null })] as never })] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')

  const views = await screen.findByRole('tablist', { name: 'Campaign views' })
  expect(within(views).getByRole('tab', { name: 'List View', selected: true })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create Campaign' }).className).toContain('bg-brand-600')
  const upcoming = await screen.findByRole('region', { name: 'Upcoming Campaigns' })
  expect(await within(upcoming).findByText('Winter Preview')).toBeTruthy()
  expect(within(upcoming).getByText(/in the lists/)).toBeTruthy()

  await user.click(within(views).getByRole('tab', { name: 'Calendar View' }))
  expect(window.location.search).toBe('?view=calendar')
  const calendar = await screen.findByRole('region', { name: 'Campaign calendar' })
  expect(screen.getByRole('region', { name: 'Upcoming Campaigns' })).toBeTruthy()                       // stays above the calendar too
  expect(screen.queryByRole('table', { name: 'Campaigns' })).toBeNull()
  const title = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date())
  expect(within(calendar).getByRole('heading', { name: title })).toBeTruthy()
  expect(within(calendar).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  const sent = await within(calendar).findByRole('link', { name: /^Sent today: Completed/ })
  expect(sent.getAttribute('href')).toBe('/campaigns/c6')
  expect(sent.className).toContain('bg-tag-completed-bg')
  expect(within(calendar).getByRole('link', { name: /^Texts today: Paused/ }).className).toContain('bg-tag-paused-bg')   // each bar in its status tag colour
  expect([...calendar.querySelectorAll('[data-legend]')].map((swatch) => swatch.parentElement?.textContent)).toContain('Failed or Cancelled')
  expect(within(calendar).queryByRole('link', { name: /^Fall Launch/ })).toBeNull()                       // a draft without a date is not on the calendar

  await user.click(within(filterBar()).getByRole('button', { name: 'Channel' }))                                       // the filters above drive the calendar as they drive the list
  await user.click(within(screen.getByRole('region', { name: 'Channel' })).getByRole('button', { name: 'SMS' }))
  await vi.waitFor(() => expect(within(calendar).queryByRole('link', { name: /^Sent today/ })).toBeNull())
  expect(within(calendar).getByRole('link', { name: /^Texts today/ })).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/campaigns/calendar/') && call.url.includes('channel=SMS') && call.url.includes('date_from='))).toBe(true)
  expect(within(filterBar()).queryByRole('button', { name: 'Date Created' })).toBeNull()                               // in the calendar the month is the date range

  await user.click(within(calendar).getByRole('button', { name: 'Next Month' }))
  const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
  expect(await within(calendar).findByRole('heading', { name: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(next) })).toBeTruthy()
  await user.click(within(calendar).getByRole('button', { name: 'Today' }))
  expect(await within(calendar).findByRole('heading', { name: title })).toBeTruthy()

  cleanup()
  installMockApi({ campaigns: [makeCampaign({})] })
  await renderAppAt('/campaigns?view=calendar')                                                           // the view is part of the address
  expect(await screen.findByRole('region', { name: 'Campaign calendar' })).toBeTruthy()
  expect(await within(screen.getByRole('region', { name: 'Upcoming Campaigns' })).findByText(/Nothing is scheduled/)).toBeTruthy()
})

test('list: pausing asks first and then shows Paused with Resume; bulk clone and bulk archive report what happened', async () => {
  const calls = installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })

  await user.click(within(table).getByRole('button', { name: 'Actions for Labor Day SMS Blast' }))
  expect(menuItems()).not.toContain('Resume')
  await user.click(within(rowMenu()).getByRole('button', { name: 'Pause' }))
  const dialog = await screen.findByRole('dialog', { name: 'Pause this campaign?' })
  expect(calls.some((call) => call.url.endsWith('/pause/'))).toBe(false)                              // nothing until confirmed
  await user.click(within(dialog).getByRole('button', { name: 'Pause' }))
  expect((await screen.findByRole('status')).textContent).toContain('“Labor Day SMS Blast” is paused')
  await vi.waitFor(() => expect(within(within(screen.getByRole('table', { name: 'Campaigns' })).getByRole('button', { name: 'Labor Day SMS Blast' }).closest('tr') as HTMLElement).getByText('Paused')).toBeTruthy())
  const trigger = screen.getByRole('button', { name: 'Actions for Labor Day SMS Blast' })
  await user.click(trigger)
  expect(menuItems()).toContain('Resume')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('region', { name: /^Actions for / })).toBeNull()
  expect(document.activeElement).toBe(trigger)                                                         // focus goes back to the ⋮ button

  await user.click(screen.getByRole('checkbox', { name: 'Select Fall Launch' }))
  await user.click(screen.getByRole('checkbox', { name: 'Select Winter Preview' }))
  const bar = screen.getByRole('region', { name: 'Bulk actions' })
  expect(within(bar).getByText('2 selected')).toBeTruthy()
  await user.click(within(bar).getByRole('button', { name: 'Clone' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('2 campaigns cloned.'))
  expect(calls.find((call) => call.url.endsWith('/campaigns/bulk/'))?.body).toEqual({ action: 'clone', ids: ['c1', 'c3'] })
  expect(await screen.findByRole('button', { name: 'Copy of Fall Launch' })).toBeTruthy()

  await user.click(screen.getByRole('checkbox', { name: 'Select Copy of Fall Launch' }))
  await user.click(within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', { name: 'Archive' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Archive 1 campaign?' })).getByRole('button', { name: 'Archive' }))
  await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 campaign archived.'))
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Copy of Fall Launch' })).toBeNull())
})

test('campaign page: six tabs; results against targets with a chart and its numbers; the frozen Campaign List; the log, filtered', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z', runs: [run({})] as never,
    targets: { target_revenue: '25000.00', target_opens: null, target_clicks: 40, target_conversions: null, target_redemptions: null, planned_cost: null, planned_offer_cost: null, notes: null } }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')

  const tabs = await screen.findByRole('tablist', { name: 'Campaign sections' })
  expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Performance', 'Recipients', 'Audience', 'Content', 'Activity Log'])
  expect(await screen.findByText('Delivery Rate')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clone' })).toBeTruthy()
  expect(within(await openMore(user)).getAllByRole('button').map((item) => item.textContent)).toEqual(['Archive', 'Copy Campaign ID'])   // nothing to pause or publish
  await user.keyboard('{Escape}')

  await user.click(within(tabs).getByRole('tab', { name: 'Performance' }))
  expect(await screen.findByRole('group', { name: /Messages sent, delivered, opened, clicked per hour/ })).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: 'Clicks against target' }).getAttribute('aria-valuenow')).toBe('30')
  expect(screen.getByText('52.6% of delivered')).toBeTruthy()
  expect(screen.getByText('northwind.example')).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: 'By Day' }))                                      // the shared segmented control: one choice of two
  expect(window.location.search).toBe('?tab=performance')

  await user.keyboard('{ArrowRight}')                                                                  // tabs follow the arrow keys once one has focus
  await user.click(within(tabs).getByRole('tab', { name: 'Audience' }))
  await user.click(await screen.findByRole('button', { name: /excluded of .* in your lists/ }))          // the breakdown holds the frozen Campaign List
  expect(screen.getByText('At the Last Send')).toBeTruthy()
  expect(screen.getByText('Left Out: Unsubscribed')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Export CSV/ })).toBeTruthy()

  await user.click(within(tabs).getByRole('tab', { name: 'Activity Log' }))
  const log = await screen.findByRole('region', { name: 'Activity Log' })
  expect(await within(log).findAllByRole('listitem')).toHaveLength(2)
  await user.click(within(log).getByRole('radio', { name: 'Warnings' }))
  expect(within(log).getAllByRole('listitem')).toHaveLength(1)
})

test('campaign page: Edit campaign (⋮) opens the part of the setup that holds the tab in view, and the setup leads back to that tab', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1')
  await screen.findByRole('tablist', { name: 'Campaign sections' })
  const editFrom = async (tab: string) => {
    await user.click(within(screen.getByRole('tablist', { name: 'Campaign sections' })).getByRole('tab', { name: tab }))
    await user.click(within(await openMore(user)).getByRole('button', { name: 'Edit Campaign' }))
  }
  for (const tab of ['Overview', 'Activity Log']) {                                                  // the details, in the pop-up over the page
    await editFrom(tab)
    const dialog = await screen.findByRole('dialog', { name: 'Edit Details' })
    expect(window.location.pathname).toBe('/campaigns/c1')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Details' })).toBeNull())
  }
  await editFrom('Content')
  expect(window.location.pathname + window.location.search).toBe('/campaigns/c1/edit?step=content')
  window.history.back()
  await screen.findByRole('tablist', { name: 'Campaign sections' })

  await editFrom('Audience')
  expect(window.location.search).toBe('?step=audience')
  expect(await screen.findByRole('heading', { level: 2, name: 'Send To' })).toBeTruthy()                   // the Audience step
  for (const name of ['Audience', 'Content', 'Targets', 'Test', 'Review & Publish']) expect(screen.getByRole('button', { name: `${name}, completed` })).toBeTruthy()   // a finished setup
  expect(await screen.findByRole('link', { name: 'Fall Master Audience (opens in a new tab)' })).toBeTruthy()
  await user.click(screen.getByRole('link', { name: 'Back to the Campaign' }))
  expect(await screen.findByRole('tab', { name: 'Audience', selected: true })).toBeTruthy()          // and back where it started

  await editFrom('Audience')
  await user.click(await screen.findByRole('button', { name: /Review & Publish/ }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Review & Publish' })).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: 'Save and Close' })[0])
  expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeTruthy()           // scheduling lives on Overview
})

test('campaign page: actions by status: a scheduled send can be cancelled, a paused one resumed, an archived one restored, a clone opens in the setup', async () => {
  installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c3')
  const header = (await screen.findByRole('heading', { name: 'Winter Preview' })).parentElement as HTMLElement
  expect(within(header).getByText('Scheduled')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Cancel Schedule' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Cancel the scheduled send?' })).getByRole('button', { name: 'Cancel the Send' }))
  expect(await screen.findByText(/The campaign is a draft again/)).toBeTruthy()
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
  await user.click(within(await openMore(user)).getByRole('button', { name: 'Unarchive' }))
  expect(await screen.findByText(/is back as Draft/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Clone' }))
  const details = await screen.findByRole('dialog', { name: 'Edit Details' })                           // the copy opens with its details, to rename it
  expect(window.location.pathname + window.location.search).toBe('/campaigns/c1-copy/edit?step=audience&details=1')
  expect((within(details).getByLabelText(/^Campaign Name/) as HTMLInputElement).value).toBe('Copy of Fall Launch')
})

test('permissions: without campaign.edit there is nothing to create, select or change; without campaign.publish nothing to pause or publish', async () => {
  const viewer = { principal: { ...me.principal, permissions: ['campaign.view'] } }
  installMockApi({ campaigns: workspace(), me: viewer as never })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  expect(screen.queryByRole('button', { name: /Create Campaign/ })).toBeNull()
  expect(within(table).queryByRole('checkbox')).toBeNull()
  await user.click(within(table).getByRole('button', { name: 'Actions for Labor Day SMS Blast' }))
  expect(menuItems()).toEqual(['View Results'])
  expect(within(table).queryByRole('button', { name: 'Actions for Fall Launch' })).toBeNull()        // a draft offers a viewer nothing, so it has no ⋮ at all

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), me: { principal: { ...me.principal, permissions: ['campaign.view', 'campaign.edit'] } } as never })
  await renderAppAt('/campaigns/c1/edit?step=7')
  expect(await screen.findByText(/Publishing needs the campaign.publish permission/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Publish to Production' })).toBeNull()
})

test('setup: a picked template opens in its own editor, an e-receipt in the receipt editor', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', campaign_type: 'E_RECEIPT', solicitation_type: 'TRANSACTIONAL', contact_lists: [], contact_list_details: [], template: null }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=3')

  const cards = await screen.findByRole('radiogroup', { name: 'Template' })
  await user.click(within(cards).getByRole('radio', { name: /Northline order receipt/ }))
  const open = await screen.findByRole('link', { name: /Open in the Receipt Editor/ })
  expect(open.getAttribute('href')).toBe('/templates/tpl-receipt/receipt')
})

test('list filters: Status is a multi-select sent as one comma list; Date created presets and a custom range fill date_from / date_to; every change goes back to page 1', async () => {
  const calls = installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  const listCalls = () => calls.filter((call) => call.url.includes('/campaigns/?') && !call.url.includes('page_size=4'))

  const statusButton = within(filterBar()).getByRole('button', { name: 'Status' })
  await user.click(statusButton)
  const status = screen.getByRole('region', { name: 'Status' })
  await user.click(within(status).getByRole('button', { name: 'Scheduled' }))
  expect(statusButton.textContent).toBe('Scheduled')                                                     // one status: its name
  await user.click(within(status).getByRole('button', { name: 'Draft' }))
  expect(within(status).getByRole('button', { name: 'Draft' }).getAttribute('aria-pressed')).toBe('true')
  expect(statusButton.textContent).toBe('Status · 2')
  await vi.waitFor(() => expect(listCalls().some((call) => new URL(call.url, 'http://x').searchParams.get('status') === 'DRAFT,SCHEDULED')).toBe(true))
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  await vi.waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3))                       // Fall Launch and Winter Preview, under the header
  await user.keyboard('{Escape}')

  const zone = me.tenant.timezone
  const { rangeDates } = await import('./listFilters')
  await user.click(within(filterBar()).getByRole('button', { name: 'Date Created' }))
  await user.click(within(screen.getByRole('region', { name: 'Date Created' })).getByRole('button', { name: 'Last 30 Days' }))
  const last30 = rangeDates('last30', zone)
  await vi.waitFor(() => expect(listCalls().some((call) => call.url.includes(`date_from=${last30.date_from}`) && call.url.includes(`date_to=${last30.date_to}`))).toBe(true))
  expect(within(filterBar()).getByRole('button', { name: 'Last 30 Days' }).className).toContain('text-brand-800')

  await user.click(within(filterBar()).getByRole('button', { name: 'Last 30 Days' }))
  await user.click(within(screen.getByRole('region', { name: 'Date Created' })).getByRole('button', { name: 'This Quarter' }))
  const quarter = rangeDates('quarter', zone)
  await vi.waitFor(() => expect(listCalls().some((call) => call.url.includes(`date_from=${quarter.date_from}`))).toBe(true))

  await user.click(within(filterBar()).getByRole('button', { name: 'This Quarter' }))
  const created = screen.getByRole('region', { name: 'Date Created' })
  await user.click(within(created).getByRole('button', { name: 'Custom Range' }))
  await user.type(within(created).getByLabelText('From'), '2026-08-01')
  await user.type(within(created).getByLabelText('To'), '2026-08-31')
  await user.click(within(created).getByRole('button', { name: 'Apply' }))
  await vi.waitFor(() => expect(listCalls().some((call) => call.url.includes('date_from=2026-08-01') && call.url.includes('date_to=2026-08-31'))).toBe(true))
  expect(within(filterBar()).getByRole('button', { name: '2026-08-01 – 2026-08-31' })).toBeTruthy()
  expect(listCalls().every((call) => new URL(call.url, 'http://x').searchParams.get('page') === '1')).toBe(true)
  expect(listCalls().some((call) => call.url.includes('created='))).toBe(false)                           // the preset's name stays on this side

  await user.click(within(filterBar()).getByRole('button', { name: 'Clear Filters' }))
  expect(within(filterBar()).getByRole('button', { name: 'Status' })).toBeTruthy()
  expect(within(filterBar()).getByRole('button', { name: 'Date Created' })).toBeTruthy()
  expect((within(filterBar()).getByRole('button', { name: 'Clear Filters' }) as HTMLButtonElement).disabled).toBe(true)
})

test('list pages: 25 rows to start, 50 or 100 on request (back to page 1), previous and next, and "Showing x–y of n"', async () => {
  const many = Array.from({ length: 60 }, (_, index) => makeCampaign({ id: `m${index}`, name: `Campaign ${String(index + 1).padStart(2, '0')}`, code: `CMP-${index}` }))
  const calls = installMockApi({ campaigns: many })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })

  expect(screen.getByText('Showing 1–25 of 60 campaigns')).toBeTruthy()
  expect(screen.getByText('Page 1 of 3')).toBeTruthy()
  const sizes = screen.getByRole('group', { name: 'Rows per Page' })
  expect(within(sizes).getByRole('button', { name: '25' }).getAttribute('aria-pressed')).toBe('true')
  expect((screen.getByRole('button', { name: 'Previous Page' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Next Page' }))
  expect(await screen.findByText('Showing 26–50 of 60 campaigns')).toBeTruthy()
  expect(screen.getByText('Page 2 of 3')).toBeTruthy()

  await user.click(within(sizes).getByRole('button', { name: '50' }))
  expect(await screen.findByText('Showing 1–50 of 60 campaigns')).toBeTruthy()
  expect(calls.some((call) => call.url.includes('page_size=50') && call.url.includes('page=1&'))).toBe(true)
  expect(within(sizes).getByRole('button', { name: '50' }).className).toContain('bg-brand-100')
  await user.click(within(sizes).getByRole('button', { name: '100' }))
  expect(await screen.findByText('Showing 1–60 of 60 campaigns')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Next Page' }) as HTMLButtonElement).disabled).toBe(true)
})

test('list rows: a click anywhere on the row opens the preview, but not on the ⋮ button, the checkbox or the menu; the table reads Type, Triggered by and the owner', async () => {
  installMockApi({ campaigns: [...workspace(), makeCampaign({ id: 'c8', name: 'Failed Teaser', code: 'CMP-2026-0008', channel: 'MMS', status: 'FAILED', owner_name: 'Priya Raman', actions: ['results', 'clone', 'archive'] })] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  const row = (name: string) => within(table).getByRole('button', { name }).closest('tr') as HTMLElement

  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['', 'Campaign Name', 'Type', 'Channel', 'Status', 'Triggered By', 'Audience', 'Next Send', 'Created', 'Actions'])
  expect(within(row('Welcome Series Email 1')).getByText('Automated')).toBeTruthy()
  expect(row('Welcome Series Email 1').className).toContain('bg-surface-subtle')                          // journey rows rest on grey
  expect(within(row('Failed Teaser')).getByText('Priya Raman')).toBeTruthy()
  expect(within(row('Failed Teaser')).getByText('Manual')).toBeTruthy()
  await openMenu(user, 'Failed Teaser')
  expect(menuItems()).not.toContain('Retry')
  expect(menuItems()).not.toContain('Open')
  await user.keyboard('{Escape}')

  await user.click(within(row('Winter Preview')).getByRole('button', { name: 'Actions for Winter Preview' }))
  expect(window.location.pathname).toBe('/campaigns')
  await user.click(rowMenu())                                                                          // the menu panel itself, between its rows
  expect(window.location.pathname).toBe('/campaigns')
  await user.keyboard('{Escape}')
  await user.click(within(row('Winter Preview')).getByRole('checkbox'))
  expect(window.location.pathname).toBe('/campaigns')
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.click(within(row('Winter Preview')).getByText('Scheduled'))
  expect(await screen.findByRole('dialog', { name: 'Winter Preview' })).toBeTruthy()                     // the row opens the preview
  expect(window.location.search).toBe('?preview=c3')
})

test('empty states: no campaigns at all invites the first one; filters that match nothing offer to clear them', async () => {
  installMockApi({ campaigns: [] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  expect(await screen.findByRole('heading', { name: 'You haven’t created any campaigns yet' })).toBeTruthy()
  expect(screen.getByText('Build an email, SMS or MMS campaign, or let a journey generate one for you.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Create Your First Campaign' }))                   // the Create Campaign pop-up
  expect(await screen.findByRole('dialog', { name: 'Create Campaign' })).toBeTruthy()
  await user.keyboard('{Escape}')
  expect(screen.queryByText(/Showing/)).toBeNull()

  cleanup()
  installMockApi({ campaigns: workspace() })
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  await user.type(within(filterBar()).getByRole('searchbox', { name: 'Search campaigns' }), 'zzz')
  expect(await screen.findByRole('heading', { name: 'No matching campaigns' })).toBeTruthy()
  expect(screen.getByText('Try widening the date range or clearing filters.')).toBeTruthy()
  const clear = screen.getAllByRole('button', { name: 'Clear Filters' }).find((button) => !filterBar().contains(button)) as HTMLElement
  await user.click(clear)
  expect(await screen.findByRole('table', { name: 'Campaigns' })).toBeTruthy()
  expect((within(filterBar()).getByRole('searchbox', { name: 'Search campaigns' }) as HTMLInputElement).value).toBe('')

  cleanup()
  installMockApi({ campaigns: [], me: { principal: { ...me.principal, permissions: ['campaign.view'] } } as never })
  await renderAppAt('/campaigns')
  expect(await screen.findByRole('heading', { name: 'You haven’t created any campaigns yet' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Create Your First Campaign' })).toBeNull()
})

test('Triggered by holds the owner: Manual narrows to one owner, Journey or Any clears it; Tag is its own filter, only when the workspace has tags', async () => {
  const calls = installMockApi({ campaigns: [...workspace(), makeCampaign({ id: 'c9', name: 'Devon’s Promo', code: 'CMP-2026-0009', owner_user: 'u2', owner_name: 'Devon Okafor' })] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  const listCall = (test: (params: URLSearchParams) => boolean) => calls.some((call) => call.url.includes('/campaigns/?') && test(new URL(call.url, 'http://x').searchParams))

  expect(within(filterBar()).queryByRole('button', { name: /More filters/ })).toBeNull()
  const trigger = within(filterBar()).getByRole('button', { name: 'Triggered By' })
  await user.click(trigger)
  let menu = screen.getByRole('region', { name: 'Triggered By' })
  expect(within(menu).getAllByRole('button').map((row) => row.textContent)).toEqual(['Any', 'Journey', 'Manual (Any Owner)', 'Aby John', 'Devon Okafor'])
  expect(within(menu).getByRole('group', { name: 'Owner' })).toBeTruthy()
  await user.click(within(menu).getByRole('button', { name: 'Devon Okafor' }))
  await vi.waitFor(() => expect(listCall((params) => params.get('triggered_by') === 'manual' && params.get('owner') === 'u2')).toBe(true))
  expect(trigger.textContent).toBe('Manual · Devon Okafor')
  expect(trigger.getAttribute('title')).toBe('Manual · Devon Okafor')
  expect(trigger.className).toContain('text-brand-800')
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Campaigns' })).getAllByRole('row')).toHaveLength(2))

  await user.click(trigger)
  menu = screen.getByRole('region', { name: 'Triggered By' })
  expect(within(menu).getByRole('button', { name: 'Manual (Any Owner)' }).getAttribute('aria-pressed')).toBe('true')   // both ticked
  expect(within(menu).getByRole('button', { name: 'Devon Okafor' }).getAttribute('aria-pressed')).toBe('true')
  await user.click(within(menu).getByRole('button', { name: 'Journey' }))
  expect(trigger.textContent).toBe('Journey')
  await vi.waitFor(() => expect(listCall((params) => params.get('triggered_by') === 'journey' && !params.get('owner'))).toBe(true))

  await user.click(trigger)
  await user.click(within(screen.getByRole('region', { name: 'Triggered By' })).getByRole('button', { name: 'Devon Okafor' }))
  await user.click(trigger)
  await user.click(within(screen.getByRole('region', { name: 'Triggered By' })).getByRole('button', { name: 'Manual (Any Owner)' }))
  expect(trigger.textContent).toBe('Manual')                                                             // Manual on its own drops the owner

  await user.click(within(filterBar()).getByRole('button', { name: 'Tag' }))
  await user.click(within(screen.getByRole('region', { name: 'Tag' })).getByRole('button', { name: 'Fall' }))
  await vi.waitFor(() => expect(listCall((params) => params.get('tag') === 'Fall')).toBe(true))
  expect(within(filterBar()).getByRole('button', { name: 'Fall' }).className).toContain('text-brand-800')
  const buttons = within(filterBar()).getAllByRole('button').map((button) => button.textContent)
  expect(buttons.indexOf('Fall')).toBe(buttons.indexOf('Date Created') + 1)                              // after Date created
  await user.click(within(filterBar()).getByRole('button', { name: 'Clear Filters' }))
  expect(trigger.textContent).toBe('Triggered By')
  expect(within(filterBar()).getByRole('button', { name: 'Tag' })).toBeTruthy()

  cleanup()
  installMockApi({ campaigns: workspace(), campaignTags: [] })
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  expect(within(filterBar()).queryByRole('button', { name: 'Tag' })).toBeNull()
})

test('the list says "Regular" where the setup keeps "Regular Marketing"; upcoming cards read the time with a short zone name', async () => {
  installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  const cell = within(within(table).getByRole('button', { name: 'Fall Launch' }).closest('tr') as HTMLElement).getByText('Regular')
  expect(cell.className).toContain('whitespace-nowrap')
  expect(within(table).queryByText('Regular Marketing')).toBeNull()
  await user.click(within(filterBar()).getByRole('button', { name: 'Type' }))
  expect(within(screen.getByRole('region', { name: 'Type' })).getAllByRole('button').map((row) => row.textContent)).toEqual(['Regular', 'Drip', 'E-Receipt', 'Other'])
  await user.click(within(screen.getByRole('region', { name: 'Type' })).getByRole('button', { name: 'Regular' }))
  expect(within(filterBar()).getByRole('button', { name: 'Regular' })).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Upcoming Campaigns' })).getByText(/ C[DS]T · 90 in the lists$/)).toBeTruthy()   // Winter Preview is sent in Chicago time

  cleanup()
  installMockApi({ campaigns: [] })
  await renderAppAt('/campaigns/new')
  expect(await screen.findByRole('radio', { name: /Regular Marketing/ })).toBeTruthy()
})

test('Status, Type and Channel live in the address: a link opens the list filtered, a pick updates it, Back undoes it, junk is ignored', async () => {
  const calls = installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?status=TEST_PUBLISHED&channel=nope')
  await screen.findByRole('search', { name: 'Filter campaigns' })
  const lastList = () => new URL(calls.filter((call) => call.url.includes('/campaigns/?') && !call.url.includes('page_size=4')).at(-1)!.url, 'http://x').searchParams
  await vi.waitFor(() => expect(lastList().get('status')).toBe('TEST_PUBLISHED'))
  expect(lastList().get('channel')).toBeNull()                                                          // an unknown channel is dropped
  const statusButton = within(filterBar()).getByRole('button', { name: 'Test Published' })
  expect(statusButton.className).toContain('text-brand-800')

  await user.click(statusButton)
  await user.click(within(screen.getByRole('region', { name: 'Status' })).getByRole('button', { name: 'Draft' }))
  expect(new URLSearchParams(window.location.search).get('status')).toBe('DRAFT,TEST_PUBLISHED')        // several statuses
  await vi.waitFor(() => expect(lastList().get('status')).toBe('DRAFT,TEST_PUBLISHED'))
  await user.keyboard('{Escape}')

  window.history.back()
  await vi.waitFor(() => expect(new URLSearchParams(window.location.search).get('status')).toBe('TEST_PUBLISHED'))
  expect(await within(filterBar()).findByRole('button', { name: 'Test Published' })).toBeTruthy()          // the filter follows (the list comes from cache)
})

test('?saved= and ?approval=requested open their saved views, alongside the address filters', async () => {
  const calls = installMockApi({ campaigns: workspace() })
  await renderAppAt('/campaigns?approval=requested&channel=SMS')
  await screen.findByRole('search', { name: 'Filter campaigns' })
  const lastList = () => new URL(calls.filter((call) => call.url.includes('/campaigns/?') && !call.url.includes('page_size=4')).at(-1)!.url, 'http://x').searchParams
  await vi.waitFor(() => expect(lastList().get('approval')).toBe('requested'))
  expect(lastList().get('channel')).toBe('SMS')
  cleanup()
  await renderAppAt('/campaigns?saved=attention')
  await screen.findByRole('search', { name: 'Filter campaigns' })
  await vi.waitFor(() => expect(lastList().get('view')).toBe('attention'))
})
