/**
 * The UX pass of 2026-09-27, through the real app against the mock API: saved views and row actions on the campaigns list,
 * the global search and its shortcuts, a template's last use, a list's reach, the log row actions and the alert switch,
 * the Preview tab's inbox and appearance controls, and the spam check on a subject.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, signIn } from '@/test/mockApi'

import { checkSpam, spamHint } from './designer/spamWords'
import { clientById, preheaderRoom, unlockDarkMedia } from './designer/preview/clients'
import { decoratePreview } from './designer/preview/decoratePreview'
import { PREVIEW_PROFILES } from './designer/preview/previewProfiles'
import { lastUsedText } from './templates/lastUsed'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---- pure pieces ---------------------------------------------------------

test('the spam check names the words, shouting and stacked punctuation, and says nothing about a plain subject', () => {
  expect(spamHint('Your fall reward is here')).toBeNull()
  const risky = checkSpam('FREE GIFT!!! Act now')
  expect(risky.words).toEqual(expect.arrayContaining(['free', 'act now', 'free gift']))
  expect(risky.shouting).toBe(false)                                                                  // "Act now" is not all capitals
  expect(risky.punctuation).toBe(true)
  expect(risky.level).toBe(2)
  expect(spamHint('FREE GIFT!!! Act now')).toMatch(/^Spam risk: words filters weigh: “free”, “act now”, “free gift”…; stacked punctuation\./)   // '!!!' is the fourth
  expect(checkSpam('WINTER SALE STARTS').shouting).toBe(true)
  expect(spamHint('Winner')).toMatch(/^Spam check: a word filters weigh: “winner”\./)
})

test('each inbox client cuts the preheader where its list does, and a dark email is drawn the way the client draws it', () => {
  expect(preheaderRoom(clientById('outlook'), 'A subject of twenty chars')).toBe(60 - 25 - 3)
  expect(preheaderRoom(clientById('gmail'), 'x'.repeat(120))).toBe(0)
  expect(unlockDarkMedia('<style>@media (prefers-color-scheme: dark) { body { background: #000 } }</style>')).toContain('@media all {')
  const html = '<html><head><style>@media (prefers-color-scheme: dark) { body { color: #fff } }</style></head><body><p>Hi</p><img src="x.png"></body></html>'
  const inverted = decoratePreview(html, [], PREVIEW_PROFILES[0], { dark: 'invert', clientCss: clientById('outlook').quirksCss }).html
  expect(inverted).toContain('filter: invert(1) hue-rotate(180deg)')
  expect(inverted).toContain('border-radius: 0 !important')                                         // Outlook's squares
  expect(inverted).toContain('prefers-color-scheme: dark')                                            // not unlocked: inverted instead
  const media = decoratePreview(html, [], PREVIEW_PROFILES[0], { dark: 'media' }).html
  expect(media).toContain('color-scheme: dark')
  expect(media).toContain('@media all {')
  expect(media).not.toContain('invert(1)')
  const light = decoratePreview(html, [], PREVIEW_PROFILES[0], {}).html
  expect(light).not.toContain('invert(1)')
})

test('a template says which campaign last used it', () => {
  expect(lastUsedText({ last_used_in: null } as never)).toBe('Not used by a campaign yet')
  expect(lastUsedText({ last_used_in: { id: 'c1', name: 'Fall Launch', status: 'ACTIVE', at: '' }, campaign_count: 3 } as never)).toBe('Used in Fall Launch (Active) and 2 more')
  expect(lastUsedText({ last_used_in: { id: 'c1', name: 'Fall Launch', status: 'COMPLETED', at: '' }, campaign_count: 1 } as never)).toBe('Used in Fall Launch (Completed)')
})

// ---- the campaigns list ---------------------------------------------------

test('saved views ask the API for what they mean and are kept in the address; the Next Send column shows the time in the campaign’s zone', async () => {
  const calls = installMockApi({ campaigns: [
    makeCampaign({ id: 'c1', name: 'Fall Launch', status: 'PRODUCTION_PUBLISHED', owner_user: 'u1', runs: [{ id: 'r1', status: 'SCHEDULED', scheduled_at: '2099-11-02T15:00:00Z', test_mode: false, started_at: null }] as never, send_timezone: 'America/Chicago' }),
    makeCampaign({ id: 'c2', name: 'Devon Draft', status: 'DRAFT', owner_user: 'u2', owner_name: 'Devon Okafor', approval: { status: 'REQUESTED', requested_by: 'u2', requested_by_name: 'Devon Okafor', requested_at: '2026-09-26T09:14:00Z', note: null, decided_by_name: null, decided_at: null, decision_note: null } }),
  ] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  const views = screen.getByRole('group', { name: 'Saved views' })
  expect(within(views).getAllByRole('button').map((button) => button.textContent)).toEqual(['All', 'Mine', 'Sending Today', 'Needs Attention', 'Awaiting Approval', 'Drafts'])
  expect(within(views).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
  const fall = within(table).getByRole('button', { name: 'Fall Launch' }).closest('tr') as HTMLElement
  expect(within(fall).getByText(/(09:00|9:00 AM) CST/)).toBeTruthy()                                  // 15:00 UTC on 2 Nov 2099 is 09:00 in Chicago
  expect(within(within(table).getByRole('button', { name: 'Devon Draft' }).closest('tr') as HTMLElement).getByText('Awaiting Approval')).toBeTruthy()

  await user.click(within(views).getByRole('button', { name: 'Mine' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/campaigns/') && call.url.includes('view=mine'))).toBe(true))
  expect(window.location.search).toBe('?saved=mine')
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Campaigns' })).queryByRole('button', { name: 'Devon Draft' })).toBeNull())

  await user.click(within(views).getByRole('button', { name: 'Awaiting Approval' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('approval=requested'))).toBe(true))
  await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Campaigns' })).queryByRole('button', { name: 'Fall Launch' })).toBeNull())
  expect(within(screen.getByRole('table', { name: 'Campaigns' })).getByRole('button', { name: 'Devon Draft' })).toBeTruthy()
})

test('Pause sits on the row beside ⋮ and asks first; the bulk bar pauses and resumes what is selected', async () => {
  const calls = installMockApi({ campaigns: [makeCampaign({ id: 'c1', name: 'Fall Launch', status: 'ACTIVE' }), makeCampaign({ id: 'c2', name: 'Napping', status: 'PAUSED' })] })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  const table = await screen.findByRole('table', { name: 'Campaigns' })
  await user.click(within(table).getByRole('button', { name: 'Pause Fall Launch' }))
  const dialog = await screen.findByRole('dialog', { name: 'Pause this campaign?' })
  await user.click(within(dialog).getByRole('button', { name: 'Pause' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/campaigns/c1/pause/'))).toBe(true))
  expect(within(await screen.findByRole('table', { name: 'Campaigns' })).getByRole('button', { name: 'Resume Fall Launch' })).toBeTruthy()

  await user.click(screen.getByRole('checkbox', { name: 'Select Napping' }))
  const bar = screen.getByRole('region', { name: 'Bulk actions' })
  expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Clone', 'Pause', 'Resume', 'Archive', 'Clear Selection'])
  await user.click(within(bar).getByRole('button', { name: 'Resume' }))
  await vi.waitFor(() => expect(calls.find((call) => call.url.endsWith('/campaigns/bulk/'))?.body).toEqual({ action: 'resume', ids: ['c2'] }))
  expect((await screen.findByRole('status')).textContent).toContain('1 campaign resumed.')
})

// ---- the top bar ----------------------------------------------------------

test('the search finds campaigns, lists, templates and pages; / focuses it and n opens Create Campaign', async () => {
  installMockApi({ campaigns: [makeCampaign({ id: 'c1', name: 'Fall Launch', status: 'ACTIVE' })] })
  const user = userEvent.setup()
  await renderAppAt('/')
  const box = await screen.findByRole('searchbox', { name: 'Search' })
  await user.keyboard('/')
  expect(document.activeElement).toBe(box)
  await user.type(box, 'fall')
  const results = await screen.findByRole('list', { name: 'Search results' })
  await vi.waitFor(() => expect(within(results).getByText('Fall Launch')).toBeTruthy())
  expect(within(results).getByText('Fall Master Audience')).toBeTruthy()
  expect(within(results).getByText('Fall Email')).toBeTruthy()
  await user.click(within(results).getByText('Fall Launch'))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/campaigns/c1'))

  await user.keyboard('{Escape}')
  ;(document.activeElement as HTMLElement | null)?.blur()
  await user.keyboard('n')
  await vi.waitFor(() => expect(window.location.pathname).toBe('/campaigns/new'))
  await user.keyboard('{Escape}')
  await user.keyboard('?')
  expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeTruthy()
})

// ---- templates, lists, integrations ----------------------------------------

test('a template card says what last used it, and a list row says how many it can reach by channel', async () => {
  installMockApi()
  await renderAppAt('/templates')
  await screen.findByText('Fall Email')
  expect(screen.getByText('Used in Fall Launch (Active) and 1 more')).toBeTruthy()
  expect(screen.getAllByText('Not used by a campaign yet').length).toBeGreaterThan(0)

  cleanup()
  installMockApi()
  await renderAppAt('/contact-lists')
  await screen.findByText('Fall Master Audience')
  const reach = await vi.waitFor(() => { const found = document.querySelectorAll('[data-reach]'); expect(found.length).toBeGreaterThan(0); return found[0] })
  expect(reach.textContent).toBe('Email 79SMS 36')                                                     // 88% and 40% of 90
})

test('a call in the log offers Retry Send when its send failed, Replay Callback when it was a callback; the card’s Email Alerts switch calls the API', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/integrations')
  const cards = await screen.findByRole('list', { name: 'Integrations' })
  const pos = within(cards).getByRole('listitem', { name: 'POS receipts' })
  const alerts = within(pos).getByRole('switch', { name: 'Email Alerts for POS receipts' })
  expect(alerts.getAttribute('aria-checked')).toBe('true')
  await user.click(alerts)
  await vi.waitFor(() => expect(calls.find((call) => call.url.endsWith('/integrations/int-pos/alerts/'))?.body).toEqual({ enabled: false }))

  const table = await screen.findByRole('table', { name: 'Call Log' })
  await user.click(within(table).getByText('Received · mailer_execution:7'))
  let call = await screen.findByRole('dialog')
  expect(within(call).getByRole('button', { name: 'Replay Callback' })).toBeTruthy()
  expect(within(call).queryByRole('button', { name: 'Retry Send' })).toBeNull()
  await user.click(within(call).getByRole('button', { name: 'Replay Callback' }))
  expect((await within(call).findByRole('status')).textContent).toContain('Replayed: 1 of 1 event applied')
  expect(calls.some((call) => /\/integrations\/log\/50\/replay\/$/.test(call.url) && call.method === 'POST')).toBe(true)
  await user.keyboard('{Escape}')                                                                   // the modal has two Close buttons

  await user.click(within(screen.getByRole('table', { name: 'Call Log' })).getByText('Sent · receipt:R-1001'))
  call = await screen.findByRole('dialog')
  expect(within(call).getByRole('button', { name: 'Retry Send' })).toBeTruthy()
  expect(within(call).queryByRole('button', { name: 'Replay Callback' })).toBeNull()
  await user.click(within(call).getByRole('button', { name: 'Retry Send' }))
  expect((await within(call).findByRole('status')).textContent).toContain('Queued again.')
  expect(calls.some((call) => /\/integrations\/log\/51\/retry\/$/.test(call.url) && call.method === 'POST')).toBe(true)

  await user.keyboard('{Escape}')                                                                   // the modal has two Close buttons
  await user.click(within(screen.getByRole('table', { name: 'Call Log' })).getByText('Received · receipt:R-1001'))
  call = await screen.findByRole('dialog')
  expect(within(call).queryByRole('button', { name: 'Replay Callback' })).toBeNull()                 // a receipt from the POS is not a provider callback
  expect(within(call).queryByRole('button', { name: 'Retry Send' })).toBeNull()
})
