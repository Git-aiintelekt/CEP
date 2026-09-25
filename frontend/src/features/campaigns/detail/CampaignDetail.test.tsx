/** The campaign page's header, banners, tabs and Overview cards, through the real app against the in-memory API. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, makeDesign, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
const run = (overrides: Record<string, unknown>) => ({ id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
  started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:02:00Z', row_version: 1, ...overrides })

const scheduled = () => makeCampaign({ status: 'PRODUCTION_PUBLISHED', send_type: 'SCHEDULED', scheduled_at: soon, send_timezone: 'America/Chicago',
  runs: [run({ status: 'SCHEDULED', scheduled_at: soon, started_at: null, completed_at: null })] as never })
const completed = () => makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z', runs: [run({})] as never })
const journey = () => makeCampaign({ status: 'PRODUCTION_PUBLISHED', is_journey_generated: true, triggered_by: 'JOURNEY' })

async function openCampaign(campaign: ReturnType<typeof makeCampaign>, tab = '') {
  installMockApi({ campaign })
  await renderAppAt(`/campaigns/${campaign.id}${tab}`)
  return screen.findByRole('heading', { level: 1, name: campaign.name })
}

async function moreItems(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More Actions' }))
  return within(screen.getByRole('region', { name: 'More Actions' })).getAllByRole('button').map((item) => item.textContent)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('header: status, channel, full type, how it is triggered, and an ID that copies', async () => {
  const user = userEvent.setup()
  const title = await openCampaign(makeCampaign({ status: 'DRAFT' }))
  const chips = screen.getByTestId('campaign-chips')
  expect(within(chips).getByText('Draft')).toBeTruthy()
  expect(within(chips).getByText('Email')).toBeTruthy()
  expect(within(chips).getByText('Regular Marketing')).toBeTruthy()
  expect(within(chips).getByText('Manual')).toBeTruthy()
  await user.click(within(chips).getByRole('button', { name: /ID CMP-2026-0001/ }))
  expect(await navigator.clipboard.readText()).toBe('CMP-2026-0001')
  expect(await within(chips).findByText('Campaign ID copied')).toBeTruthy()
  expect(within(title.closest('section')!).getByRole('link', { name: 'Campaigns' }).getAttribute('href')).toBe('/campaigns')

  cleanup()
  await openCampaign(journey())
  expect(within(screen.getByTestId('campaign-chips')).getByText('Journey')).toBeTruthy()
})

test('main button by status: Continue setup with its hint, Production publish, Resume, View journey; none once published', async () => {
  await openCampaign(makeCampaign({ status: 'DRAFT' }))
  expect(screen.getByRole('link', { name: 'Continue Setup' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=test')
  expect(screen.getByText('Next: send a test')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clone' })).toBeTruthy()

  cleanup()
  await openCampaign(makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6 }))
  expect(screen.getByRole('link', { name: 'Production Publish' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=publish&section=review')

  cleanup()
  await openCampaign(makeCampaign({ status: 'PAUSED', runs: [run({ status: 'PAUSED', completed_at: null })] as never }))
  expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()

  cleanup()
  await openCampaign(journey())
  const view = screen.getAllByRole('link', { name: 'View Journey (opens in a new tab)' })[0]
  expect(view.getAttribute('href')).toBe('/journeys')
  expect(view.getAttribute('target')).toBe('_blank')
  expect(screen.queryByRole('button', { name: 'Clone' })).toBeNull()                                  // never for journey campaigns

  cleanup()
  await openCampaign(makeCampaign({ status: 'PRODUCTION_PUBLISHED' }))
  for (const name of ['Continue Setup', 'Production Publish', 'View Journey (opens in a new tab)']) expect(screen.queryByRole('link', { name })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
})

test('⋮ holds every other action by status, and the ones that stop or hide something still ask first', async () => {
  const user = userEvent.setup()
  await openCampaign(makeCampaign({ status: 'DRAFT' }))
  expect(await moreItems(user)).toEqual(['Edit Campaign', 'Production Publish', 'Archive', 'Copy Campaign ID'])
  await user.click(screen.getByRole('button', { name: 'Archive' }))
  expect(await screen.findByRole('dialog', { name: 'Archive this campaign?' })).toBeTruthy()

  cleanup()
  await openCampaign(makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6 }))
  expect(await moreItems(user)).toEqual(['Edit Campaign', 'Send a Test', 'Archive', 'Copy Campaign ID'])
  await user.click(screen.getByRole('button', { name: 'Send a Test' }))                             // the Content tab's card, not the setup
  expect(screen.getByRole('tab', { name: 'Content', selected: true })).toBeTruthy()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('send-a-test'))
  expect(window.location.search).toBe('?tab=content')

  cleanup()
  await openCampaign(makeCampaign({ status: 'PRODUCTION_PUBLISHED' }))
  expect(await moreItems(user)).toEqual(['Pause', 'Archive', 'Copy Campaign ID'])
  await user.click(screen.getByRole('button', { name: 'Pause' }))
  expect(await screen.findByRole('dialog', { name: 'Pause this campaign?' })).toBeTruthy()

  cleanup()
  await openCampaign(scheduled())
  expect(await moreItems(user)).toEqual(['Cancel Schedule', 'Archive', 'Copy Campaign ID'])

  cleanup()
  await openCampaign(makeCampaign({ status: 'ARCHIVED' }))
  expect(await moreItems(user)).toEqual(['Unarchive', 'Copy Campaign ID'])
})

test('banners: a scheduled send with its time and Cancel schedule; a journey campaign, read-only', async () => {
  const user = userEvent.setup()
  await openCampaign(scheduled())
  expect(screen.getByText(/^Scheduled for .+, \d{1,2}:\d{2}.* C[SD]T$/)).toBeTruthy()
  expect(screen.getByText('Cancelling returns this campaign to a draft.')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Cancel Schedule' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Cancel the scheduled send?' })).getByRole('button', { name: 'Cancel the Send' }))
  expect(await screen.findByText(/The campaign is a draft again/)).toBeTruthy()

  cleanup()
  await openCampaign(journey())
  expect(screen.getByText('This campaign is generated by a journey')).toBeTruthy()
  expect(screen.getByText(/managed in the journey and read-only here/)).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'View Journey (opens in a new tab)' }).map((link) => link.getAttribute('target'))).toEqual(['_blank', '_blank'])   // the main button and the banner's link
})

test('five tabs: Performance once a production send exists, Audience except for e-receipts; hidden or unknown tabs open Overview', async () => {
  const names = () => within(screen.getByRole('tablist', { name: 'Campaign sections' })).getAllByRole('tab').map((tab) => tab.textContent)
  await openCampaign(completed(), '?tab=nothing')
  expect(names()).toEqual(['Overview', 'Performance', 'Audience', 'Content', 'Activity Log'])
  expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeTruthy()
  await vi.waitFor(() => expect(window.location.search).toBe(''))

  cleanup()
  await openCampaign(makeCampaign({ status: 'DRAFT' }), '?tab=performance')
  expect(names()).toEqual(['Overview', 'Audience', 'Content', 'Activity Log'])                        // nothing sent yet
  expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeTruthy()
  await vi.waitFor(() => expect(window.location.search).toBe(''))

  cleanup()
  await openCampaign(makeCampaign({ status: 'PRODUCTION_PUBLISHED', send_type: 'SCHEDULED', scheduled_at: soon, runs: [run({ status: 'SCHEDULED', scheduled_at: soon, started_at: null, completed_at: null })] as never }))
  expect(names()).toEqual(['Overview', 'Audience', 'Content', 'Activity Log'])                        // scheduled, not sent yet

  cleanup()
  await openCampaign(makeCampaign({ status: 'DRAFT', campaign_type: 'E_RECEIPT', contact_lists: [] }), '?tab=settings')   // an old bookmark
  expect(names()).toEqual(['Overview', 'Content', 'Activity Log'])
  await vi.waitFor(() => expect(window.location.search).toBe(''))
})

test('Setup holds what the Settings tab and the About panel showed, times in the campaign zone; Targets is its own card', async () => {
  await openCampaign(makeCampaign({ status: 'DRAFT', rate_limit_per_hour: 500, send_type: 'DRIP', send_timezone: 'America/Chicago', drip_config: { steps: [{ day: 1 }, { day: 3, label: 'Reminder' }] },
    targets: { target_revenue: '25000.00', target_opens: null, target_clicks: 40, target_conversions: null, target_redemptions: null, planned_cost: null, planned_offer_cost: null, notes: 'Holiday push' } }))
  const setup = screen.getByRole('region', { name: 'Setup' })
  expect([...setup.querySelectorAll('[data-fact]')].map((fact) => fact.getAttribute('data-fact'))).toEqual([
    'Message Purpose', 'Owner', 'Template', 'Sender', 'Tags',
    'When', 'Send Type', 'Next Send', 'Time Zone', 'Corporate Frequency Limits', 'Messages per Hour', "Recipient's Local Time", 'Series Steps',
    'Created', 'Last Edited', 'Published', 'Completed'])
  expect(within(setup).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Day 1', 'Day 3 · Reminder'])
  expect(within(setup).getByText(/delivery engine integration is switched on/)).toBeTruthy()
  expect((setup.querySelector('[data-fact="Created"] dd') as HTMLElement).textContent).toMatch(/, \d{1,2}:\d{2}.* C[SD]T$/)
  expect(within(setup).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['Edit Setup', '/campaigns/c1?edit=details'], ['Edit', '/campaigns/c1/edit?step=publish&section=schedule']])
  const targets = screen.getByRole('region', { name: 'Targets' })
  expect(within(targets).getByRole('link', { name: 'Edit Targets' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=targets')
  expect(within(targets).getByText('Holiday push')).toBeTruthy()
  expect([...targets.querySelectorAll('[data-fact]')].map((fact) => fact.getAttribute('data-fact'))).toEqual(['Revenue', 'Conversions', 'Opens', 'Clicks', 'Offer Redemptions', 'Planned Campaign Cost', 'Planned Offer Cost'])

  cleanup()
  await openCampaign(completed())
  expect(screen.getByText('Settings are fixed once a campaign is published. Clone the campaign to start again from them.')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Targets' })).toBeNull()                                 // after a send the Performance tab's Economics card has them
  expect(screen.queryByRole('link', { name: 'Edit Targets' })).toBeNull()

  cleanup()
  await openCampaign(makeCampaign({ status: 'DRAFT' }))
  expect(within(screen.getByRole('region', { name: 'Targets' })).getByText('No targets were set.')).toBeTruthy()

  cleanup()
  await openCampaign(makeCampaign({ status: 'ARCHIVED', archived_at: '2026-09-20T10:00:00Z' }))
  expect(screen.getByRole('region', { name: 'Setup' }).querySelector('[data-fact="Archived"]')).toBeTruthy()
})

test('Overview: metrics once sent, no facts the header already shows; Targets and Runs move to Performance once sent', async () => {
  await openCampaign(completed())
  const metrics = screen.getByRole('region', { name: 'Metrics' })
  expect(await within(metrics).findByText(/open rate$/)).toBeTruthy()
  expect([...metrics.querySelectorAll('[data-metric]')].map((item) => item.getAttribute('data-metric'))).toEqual(['Audience', 'Sent', 'Delivery Rate', 'Opens', 'Clicks', 'Conversions'])
  expect(within(metrics).getByRole('link', { name: 'See All' }).getAttribute('href')).toBe('/campaigns/c1?tab=performance')
  const setup = screen.getByRole('region', { name: 'Setup' })
  expect(setup.querySelector('[data-fact="Code"], [data-fact="Type"], [data-fact="Channel"], [data-fact="Triggered By"]')).toBeNull()   // the header chips say those
  expect(screen.queryByRole('region', { name: 'Runs' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Targets' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Latest activity' })).toBeNull()                        // the Activity log tab has it

  cleanup()
  await openCampaign(makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, runs: [run({ test_mode: true, sequence_label: 'Test' })] as never }))
  expect(screen.queryByRole('region', { name: 'Metrics' })).toBeNull()                                 // nothing sent yet
  const runs = screen.getByRole('region', { name: 'Runs' })                                             // before a send the runs, test ones too, stay here
  expect(within(runs).getByText('1 run · 0 production, 1 test')).toBeTruthy()
  expect(within(runs).getByText('Test')).toBeTruthy()
  expect(within(runs).queryByRole('button', { name: /Results of run/ })).toBeNull()
  expect(screen.getByRole('region', { name: 'Targets' })).toBeTruthy()
})

test('Overview audience: the eligible number, its share, the bar and the legend', async () => {
  await openCampaign(makeCampaign({ status: 'DRAFT' }))
  const card = screen.getByRole('region', { name: 'Audience' })
  expect(await within(card).findByTestId('audience-eligible')).toBeTruthy()
  expect(within(card).getByTestId('audience-eligible').textContent).toBe('88')
  expect(within(card).getByText('eligible recipients · 73.3% of your lists')).toBeTruthy()
  const width = (bar: string) => parseFloat((card.querySelector(`[data-bar="${bar}"]`) as HTMLElement).style.width)
  expect(width('eligible')).toBeCloseTo(73.33, 1)
  expect(width('excluded')).toBeCloseTo(26.67, 1)
  for (const text of ['Eligible 88', 'Excluded 32', 'Total in Lists 120', '1 contact list · Fall Master Audience']) expect(within(card).getByText(text)).toBeTruthy()

  cleanup()
  await openCampaign(completed())
  const sent = screen.getByRole('region', { name: 'Audience' })                                        // the number the Metrics card shows as Audience
  expect(await within(sent).findByText('recipients at last send · 90% of your lists')).toBeTruthy()
  expect(within(sent).getByTestId('audience-eligible').textContent).toBe('90')
  for (const text of ['Eligible 90', 'Excluded 10', 'Total in Lists 100']) expect(within(sent).getByText(text)).toBeTruthy()

  cleanup()
  await openCampaign(makeCampaign({ status: 'DRAFT', campaign_type: 'E_RECEIPT', contact_lists: [] }))
  expect(screen.queryByRole('region', { name: 'Audience' })).toBeNull()
  expect(screen.getByRole('region', { name: 'Sending Receipts' })).toBeTruthy()
})

test('Overview content: the subject with sample values and the checks line in each state', async () => {
  await openCampaign(makeCampaign({ status: 'DRAFT' }))
  const card = screen.getByRole('region', { name: 'Content' })
  expect(within(card).getByText('Based on Fall Email')).toBeTruthy()
  expect((await within(card).findByTestId('checks-line')).textContent).toBe('No errors')

  cleanup()
  await openCampaign(makeCampaign({ status: 'DRAFT', setup_step: 6, sender_profile: null, sender_profile_name: null }))
  expect((await screen.findByTestId('checks-line')).textContent).toBe('Verified sender chosen')

  cleanup()
  await openCampaign(completed())
  expect(screen.getByTestId('checks-line').textContent).toBe('Sent as shown')

  cleanup()
  await openCampaign(journey())
  expect(screen.getByTestId('checks-line').textContent).toBe('Managed by the journey')
})

test('the Performance tab and the Metrics card follow one rule, so "See All" never points at a hidden tab', async () => {
  const performanceShown = () => Boolean(screen.queryByRole('tab', { name: 'Performance' }))
  const metricsShown = () => Boolean(screen.queryByRole('region', { name: 'Metrics' }))

  await openCampaign(makeCampaign({ ...journey(), runs: [] }))                                        // results allowed, no run of its own yet: the journey case
  expect(performanceShown()).toBe(true)
  expect(metricsShown()).toBe(true)
  expect(within(screen.getByRole('region', { name: 'Metrics' })).getByRole('link', { name: 'See All' }).getAttribute('href')).toBe('/campaigns/c1?tab=performance')

  cleanup()
  await openCampaign(makeCampaign({ status: 'DRAFT', runs: [run({})] as never, actions: ['edit', 'clone'] }))   // a production run started, results not offered
  expect([performanceShown(), metricsShown()]).toEqual([true, true])

  cleanup()
  await openCampaign(makeCampaign({ status: 'DRAFT' }))
  expect([performanceShown(), metricsShown()]).toEqual([false, false])
})

test('money in the Targets card reads "$25,000.00"', async () => {
  await openCampaign(makeCampaign({ status: 'DRAFT', targets: { target_revenue: '25000.00', target_opens: null, target_clicks: null, target_conversions: null, target_redemptions: null, planned_cost: '1800.5', planned_offer_cost: null, notes: null } }))
  const targets = screen.getByRole('region', { name: 'Targets' })
  expect(within(targets).getByText('$25,000.00')).toBeTruthy()
  expect(within(targets).getByText('$1,800.50')).toBeTruthy()
})

test('card titles use the 18px card heading; groups inside a card use the 15px subheading', async () => {
  await openCampaign(makeCampaign({ status: 'DRAFT' }))
  const title = screen.getByRole('heading', { level: 2, name: 'Setup' })
  expect(title.className).toContain('text-card-heading')
  expect(title.className).toContain('font-display')
  for (const name of ['Scheduling & Delivery', 'Record']) {
    const group = screen.getByRole('heading', { level: 3, name })
    expect(group.className).toContain('text-card-title')
    expect(group.className).toContain('text-ink-900')
  }
})

test('Overview Content card: template, subject, preheader and sender beside a thumbnail capped at 360px; no channel line', async () => {
  const campaign = makeCampaign({ status: 'DRAFT' })
  installMockApi({ campaign, design: makeDesign({ template: 'tpl-email', html_content: '<p>Hello</p>', mjml_source: null, subject_line: 'Fall is here, {{first_name}}', preheader: 'New arrivals inside' }) })
  await renderAppAt('/campaigns/c1')
  const card = await screen.findByRole('region', { name: 'Content' })
  const labels = () => [...card.querySelectorAll('[data-detail]')].map((item) => item.getAttribute('data-detail'))
  expect(labels()).toEqual(['Template', 'Subject Line', 'Preheader', 'Sender'])
  expect(await within(card).findByText('New arrivals inside')).toBeTruthy()
  expect(await within(card).findByText('rewards@northwind.example')).toBeTruthy()
  expect(within(card).queryByText('Email')).toBeNull()                                                 // the header chip says the channel
  expect(card.querySelector('[data-content-thumbnail]')!.className).toContain('max-h-[360px]')
})

test('an e-receipt has no audience, so its Metrics card has no Audience tile', async () => {
  await openCampaign(makeCampaign({ campaign_type: 'E_RECEIPT', status: 'ACTIVE', contact_lists: [], contact_list_details: [] }))
  const metrics = screen.getByRole('region', { name: 'Metrics' })
  await within(metrics).findByText(/open rate$/)
  expect(metrics.querySelector('[data-metric="Audience"]')).toBeNull()
})

test('an SMS thumbnail waits for the tag catalogue, so it never shows a raw {{first_name}}', async () => {
  installMockApi({ texts: true, campaign: makeCampaign({ channel: 'SMS', status: 'DRAFT' }) })
  await renderAppAt('/campaigns/c1')
  const card = await screen.findByRole('region', { name: 'Content' })
  const thumbnail = card.querySelector('[data-content-thumbnail]')!
  await vi.waitFor(() => expect(thumbnail.textContent).toContain('Jordan'))
  expect(thumbnail.textContent).not.toContain('{{')
})

test('after a send with its lists since removed, the Audience card says none are attached now', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z', runs: [run({})] as never, contact_lists: [], contact_list_details: [] }), audience: { lists: [] } })
  await renderAppAt('/campaigns/c1')
  const card = await screen.findByRole('region', { name: 'Audience' })
  expect(await within(card).findByText('No lists attached now.')).toBeTruthy()
  expect(within(card).queryByText('No contact list is attached yet.')).toBeNull()
})
