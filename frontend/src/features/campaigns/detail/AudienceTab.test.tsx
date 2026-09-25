/** The Audience tab: the shared summary and its tiles, the lists, the breakdown, system exclusions and the sample. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, signIn } from '@/test/mockApi'
import type { CampaignAudience } from '@/lib/types'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const run = (overrides: Record<string, unknown>) => ({ id: 'r1', campaign: 'c1', tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
  started_at: '2026-09-18T10:00:00Z', completed_at: '2026-09-18T10:02:00Z', created_at: '2026-09-18T10:00:00Z', updated_at: '2026-09-18T10:02:00Z', row_version: 1, ...overrides })
const completed = () => makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z', runs: [run({})] as never })

const line = (code: string, count: number, sendable = false) => ({ code, label: code === 'MARKETABLE' ? 'Can receive marketing email' : code, sendable, count })
/** 120 in the lists, 60 reachable; every kind of reason once */
const draftAudience: Partial<CampaignAudience> = {
  lists: [
    { id: 'cl-staff', name: 'Staff', member_count: 12, updated_at: '2026-09-10T10:00:00Z', list_environment: 'PRODUCTION', source_type: 'UPLOAD', role: 'EXCLUDE' },
    { id: 'cl-master', name: 'Fall Master Audience', member_count: 90, updated_at: '2026-09-02T10:00:00Z', list_environment: 'PRODUCTION', source_type: 'UPLOAD', role: 'INCLUDE' },
    { id: 'cl-ga', name: 'Georgia only', member_count: 30, updated_at: '2026-09-05T10:00:00Z', list_environment: 'TEST', source_type: 'BI', role: 'INCLUDE' },
  ],
  gross: 120, duplicates_removed: 20, excluded_by_list: 10, after_exclusions: 90, excluded_by_governance: 30, estimated_recipients: 60,
  statuses: [line('MARKETABLE', 60, true), line('NO_CONSENT', 15), line('FREQUENCY_CAP', 4), line('HARD_BOUNCE', 3), line('SOFT_BOUNCE', 2), line('UNSUBSCRIBED', 6), line('BLOCKED', 0)],
}
const draft = (overrides = {}) => makeCampaign({ status: 'DRAFT', contact_list_details: [
  { id: 'cl-master', name: 'Fall Master Audience', list_kind: 'STATIC', is_master: true, list_environment: 'PRODUCTION', status: 'ACTIVE', member_count: 90, role: 'INCLUDE', attached_at: '2026-09-12T10:00:00Z' },
], ...overrides })

async function openAudience(campaign: ReturnType<typeof makeCampaign>, options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ campaign, ...options })
  await renderAppAt(`/campaigns/${campaign.id}?tab=audience`)
  await screen.findByTestId('audience-eligible')
  return calls
}

const tile = (label: string) => document.querySelector(`[data-tile="${label}"]`) as HTMLElement
const breakdownButton = () => screen.getByRole('button', { name: /excluded of .* in your lists/ })

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the summary is the one Overview shows, before a send and after', async () => {
  const user = userEvent.setup()
  for (const campaign of [draft(), completed()]) {
    await openAudience(campaign)
    const onTab = screen.getByRole('region', { name: 'Audience' }).textContent
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    const overview = screen.getByRole('region', { name: 'Audience' })
    await within(overview).findByTestId('audience-eligible')
    expect(onTab).toContain(within(overview).getByRole('img').parentElement!.textContent!)
    cleanup()
  }
})

test('health tiles count from today\'s statuses before a send, and from the frozen list after one', async () => {
  await openAudience(draft(), { audience: draftAudience })
  expect(within(tile('Bounced')).getByText('5')).toBeTruthy()
  expect(within(tile('Bounced')).getByText('4.2% of the people in your lists')).toBeTruthy()
  expect(within(tile('Unsubscribed or Suppressed')).getByText('6')).toBeTruthy()
  expect(within(tile('Over Frequency Limit')).getByText('4')).toBeTruthy()
  expect(within(tile('Over Frequency Limit')).getByText('3.3% of the people in your lists')).toBeTruthy()

  cleanup()
  await openAudience(draft({ respect_governance: false }), { audience: draftAudience })
  expect(within(tile('Over Frequency Limit')).getByText('Frequency limits are off for this campaign')).toBeTruthy()

  cleanup()
  await openAudience(completed())                                                                     // frozen: 9 unsubscribed, 3 hard bounces, of 100
  expect(within(tile('Bounced')).getByText('3')).toBeTruthy()
  expect(within(tile('Bounced')).getByText('3% of the people in your lists')).toBeTruthy()
  expect(within(tile('Unsubscribed or Suppressed')).getByText('9')).toBeTruthy()
  expect(within(tile('Over Frequency Limit')).getByText('0')).toBeTruthy()
})

test('contact lists: sent-to lists first, the role and attached date, the source as a plain tag, the Test badge', async () => {
  await openAudience(draft(), { audience: draftAudience })
  const table = screen.getByRole('table', { name: 'Contact Lists' })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['Fall Master Audience', 'Georgia only', 'Staff'])
  expect(within(rows[0]).getByText(/^Send To · attached .*12.*2026$/)).toBeTruthy()
  expect(within(rows[1]).getByText('Send To')).toBeTruthy()
  expect(within(rows[2]).getByText('Excluded')).toBeTruthy()
  expect(within(rows[1]).getByText('BI / Extraction')).toBeTruthy()
  expect(within(rows[1]).getByText('Test')).toBeTruthy()
  expect(within(rows[0]).queryByText('Test')).toBeNull()
  expect(within(rows[0]).getByText('Upload')).toBeTruthy()
  expect(within(rows[0]).getByRole('link').getAttribute('href')).toBe('/contact-lists/cl-master')
})

test('Export CSV downloads the audience, and says so when it fails', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  const calls = await openAudience(draft())
  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/campaigns/c1/audience/export/'))).toBe(true))
  expect(screen.queryByRole('alert')).toBeNull()

  cleanup()
  await openAudience(draft(), { audienceExportFails: true })
  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  expect((await screen.findByRole('alert')).textContent).toContain('The export was not produced.')
})

test('the breakdown opens from the keyboard: the funnel, the reasons without the system ones, and the note', async () => {
  const user = userEvent.setup()
  await openAudience(draft(), { audience: draftAudience })
  const toggle = breakdownButton()
  expect(toggle.textContent).toContain('60 excluded of 120 in your lists')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(toggle.textContent).toContain('Hide Breakdown')

  const funnel = document.querySelector('dl[aria-label="Today\'s estimate"]') as HTMLElement
  expect([...funnel.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['In the Attached Lists', 'In Several Lists (Counted Once)', 'Removed by Excluded Lists', 'Unique People', 'Left Out by Governance Today', 'Estimated Recipients'])
  const reasons = screen.getByRole('list', { name: 'Reasons people are left out' })
  expect(within(reasons).getAllByRole('listitem').map((item) => item.getAttribute('data-reason'))).toEqual(['EXCLUDED_LIST', 'DUPLICATES', 'NO_CONSENT', 'FREQUENCY_CAP'])
  expect(within(reasons).getByText(/Opted out of marketing email in the preference centre/)).toBeTruthy()
  expect(screen.getByText(/An estimate as of today/)).toBeTruthy()

  toggle.focus()
  await user.keyboard(' ')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
})

test('after a send the breakdown shows the last send beside today', async () => {
  const user = userEvent.setup()
  await openAudience(completed())
  await user.click(breakdownButton())
  const last = document.querySelector('dl[aria-label="At the Last Send"]') as HTMLElement
  expect([...last.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['People in the List', 'Left Out: Unsubscribed', 'Left Out: Hard Bounce', 'Sent To'])
  expect(document.querySelector('dl[aria-label="If It Were Sent Today"]')).toBeTruthy()
  expect(screen.getByText(/^Frozen .*18.*2026, .* E[SD]T\./)).toBeTruthy()
  expect(screen.getByText('Nobody is left out by this campaign’s lists or send rules.')).toBeTruthy()       // only system reasons, which have their own card
})

test('system exclusions: only the rows above 0, or a line saying nobody', async () => {
  await openAudience(draft(), { audience: draftAudience })
  const system = screen.getByRole('region', { name: 'System Exclusions' })
  expect(within(system).getByText('Always Applied')).toBeTruthy()
  expect(within(system).getAllByRole('listitem').map((item) => item.getAttribute('data-reason'))).toEqual(['HARD_BOUNCE', 'SOFT_BOUNCE', 'UNSUBSCRIBED'])
  expect(within(system).getByText('Undeliverable addresses')).toBeTruthy()

  cleanup()
  await openAudience(draft(), { audience: { ...draftAudience, statuses: [line('MARKETABLE', 60, true)] } })
  expect(within(screen.getByRole('region', { name: 'System Exclusions' })).getByText('Nobody is excluded by system rules.')).toBeTruthy()
})

test('the sample: same columns and people, the status as a tag', async () => {
  await openAudience(draft())
  const card = screen.getByRole('region', { name: 'Sample of the Audience' })
  expect(within(card).getByText('As of today: up to ten people, the ones who can be reached first.')).toBeTruthy()
  const table = within(card).getByRole('table', { name: 'Sample of the Audience' })
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Customer', 'Name', 'Email', 'Today'])
  expect(within(table).getByText('Dolores Alvarez')).toBeTruthy()
  expect(within(table).getByText('Can receive marketing email').className).toContain('bg-success-bg')
  expect(within(table).getByText('Unsubscribed').className).toContain('bg-warning-bg')

  cleanup()
  await openAudience(draft(), { audience: { sample: [] } })
  expect(within(screen.getByRole('region', { name: 'Sample of the Audience' })).getByText('Nobody to show yet.')).toBeTruthy()
})

test('the three tiles share a row from md up', async () => {
  await openAudience(draft())
  expect(tile('Bounced').parentElement!.className).toContain('md:grid-cols-3')
})

test('the audience note: at the bottom before a send; under "If It Were Sent Today" after one', async () => {
  const user = userEvent.setup()
  await openAudience(draft())
  await user.click(breakdownButton())
  const note = screen.getByText(/^An estimate as of today/)
  expect(note.closest('[id]')?.lastElementChild).toBe(note)                                           // the breakdown's last line

  cleanup()
  await openAudience(completed())
  await user.click(breakdownButton())
  const today = document.querySelector('dl[aria-label="If It Were Sent Today"]')!.parentElement!
  expect(within(today).getByText(/^An estimate as of today/)).toBeTruthy()
  expect(screen.getAllByText(/^An estimate as of today/)).toHaveLength(1)
})

test('on a phone the list name leads each card as a left-aligned title; the sample leads with the name', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: 375 >= Number(/(\d+)px/.exec(query)?.[1] ?? 0), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  await openAudience(draft(), { audience: draftAudience })
  const cards = within(screen.getByRole('list', { name: 'Contact Lists' })).getAllByRole('listitem')
  const lead = cards[0].querySelector('[data-primary]') as HTMLElement
  expect(within(lead).getByRole('link', { name: 'Fall Master Audience' })).toBeTruthy()
  expect(within(lead).getByText(/^Send To/)).toBeTruthy()
  expect(within(cards[0]).getAllByRole('term').map((term) => term.textContent)).toEqual(['Source', 'Updated', 'Contacts'])
  const sample = within(screen.getByRole('list', { name: 'Sample of the Audience' })).getAllByRole('listitem')
  expect((sample[0].querySelector('[data-primary]') as HTMLElement).textContent).toBe('Dolores Alvarez')
  expect(within(sample[0]).getAllByRole('term').map((term) => term.textContent)).toEqual(['Customer', 'Email', 'Today'])
})
