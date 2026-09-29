/** The campaign quick view on the Campaigns list, through the real app against the in-memory API. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, makeDesign, makeMessage, mediaLibrary, signIn } from '@/test/mockApi'

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
  makeCampaign({ id: 'c1', name: 'Fall Launch' }),
  makeCampaign({ id: 'c2', name: 'Labor Day SMS Blast', code: 'CMP-2026-0002', channel: 'SMS', status: 'ACTIVE', sender_profile: 'snd-sms', sender_profile_name: 'Northwind SMS', template: 'tpl-sms', template_name: 'Fall SMS' }),
  makeCampaign({ id: 'c3', name: 'Winter Preview', code: 'CMP-2026-0003', status: 'PRODUCTION_PUBLISHED', send_type: 'SCHEDULED', scheduled_at: soon, send_timezone: 'America/Chicago',
                 runs: [run({ id: 'r3', campaign: 'c3', status: 'SCHEDULED', scheduled_at: soon, started_at: null, completed_at: null })] as never }),
  makeCampaign({ id: 'c4', name: 'Welcome Series Email 1', code: 'CMP-2026-0004', campaign_type: 'DRIP', status: 'PRODUCTION_PUBLISHED', is_journey_generated: true, triggered_by: 'JOURNEY', origin_journey: 'j1',
                 contact_lists: [], contact_list_details: [] }),
  makeCampaign({ id: 'c5', name: 'Holiday Draft', code: 'CMP-2026-0005', setup_step: 1, template: null, template_name: null, sender_profile: null, sender_profile_name: null, contact_lists: [], contact_list_details: [], audience_size: null }),
  makeCampaign({ id: 'c6', name: 'Store Receipt', code: 'CMP-2026-0006', campaign_type: 'E_RECEIPT', status: 'ACTIVE', template: 'tpl-receipt', template_name: 'Northline order receipt', contact_lists: [], contact_list_details: [] }),
  makeCampaign({ id: 'c7', name: 'Lookbook Picture', code: 'CMP-2026-0007', channel: 'MMS', status: 'ACTIVE', sender_profile: 'snd-sms', sender_profile_name: 'Northwind SMS', template: 'tpl-sms', template_name: 'Fall SMS' }),
  makeCampaign({ id: 'c8', name: 'Everywhere Weekend', code: 'CMP-2026-0008', channel: 'MULTI', template: 'tpl-sms', template_name: 'Fall SMS', sender_profile: 'snd-sms', sender_profile_name: 'Northwind SMS' }),
]
const emailDesign = makeDesign({ template: 'tpl-email', html_content: '<p>Hello</p>', mjml_source: null, subject_line: 'Fall is here, {{first_name}}', preheader: 'New arrivals inside' })

const dialog = () => screen.getByRole('dialog')
const detail = (label: string) => dialog().querySelector(`[data-detail="${label}"]`) as HTMLElement
const table = () => screen.getByRole('table', { name: 'Campaigns' })

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('a row click or Enter on the name opens the quick view; the checkbox and ⋮ do not; Back, Escape and × close it, and focus goes back to the name', async () => {
  installMockApi({ campaigns: workspace(), design: emailDesign })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  const name = within(table()).getByRole('button', { name: 'Winter Preview' })
  const row = name.closest('tr') as HTMLElement

  await user.click(within(row).getByRole('checkbox'))
  await user.click(within(row).getByRole('button', { name: 'Actions for Winter Preview' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.keyboard('{Escape}')
  await user.click(within(row).getByRole('checkbox'))

  await user.click(within(row).getByText('Regular'))
  expect(await screen.findByRole('dialog', { name: 'Winter Preview' })).toBeTruthy()
  expect(window.location.search).toBe('?preview=c3')
  expect(row.className).toContain('bg-callout-bg')
  window.history.back()
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(window.location.search).toBe('')

  name.focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('dialog', { name: 'Winter Preview' })).toBeTruthy()
  await user.keyboard('{Escape}')
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await vi.waitFor(() => expect(document.activeElement).toBe(within(table()).getByRole('button', { name: 'Winter Preview' })))   // focus returns as the dialog's effects clean up

  await user.click(within(table()).getByRole('button', { name: 'Fall Launch' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Fall Launch' })).getByRole('button', { name: 'Close' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await vi.waitFor(() => expect(document.activeElement).toBe(within(table()).getByRole('button', { name: 'Fall Launch' })))   // focus returns as the dialog's effects clean up
})

test('?preview=<id> opens it on load, and closing replaces the address instead of leaving the page', async () => {
  installMockApi({ campaigns: workspace() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?preview=c2')
  expect(await screen.findByRole('dialog', { name: 'Labor Day SMS Blast' })).toBeTruthy()
  await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(window.location.pathname + window.location.search).toBe('/campaigns')
})

test('the header is one line: name, the same status tag as the row and the channel icon; no date, chips, clone or ⋮', async () => {
  installMockApi({ campaigns: workspace(), design: emailDesign })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  const rowTag = within(within(table()).getByRole('button', { name: 'Winter Preview' }).closest('tr') as HTMLElement).getByText('Scheduled')
  await user.click(within(table()).getByRole('button', { name: 'Winter Preview' }))
  const view = within(await screen.findByRole('dialog', { name: 'Winter Preview' }))
  expect(view.getByRole('heading', { level: 2, name: 'Winter Preview' })).toBeTruthy()
  expect(view.getByText('Scheduled').className).toBe(rowTag.className)
  expect(view.getByRole('img', { name: 'Email' }).getAttribute('title')).toBe('Email')
  expect(view.queryByText(/^Sends /)).toBeNull()
  expect(view.queryByText('Regular Marketing')).toBeNull()
  expect(view.queryByRole('button', { name: 'More Actions' })).toBeNull()
  expect(view.queryByRole('button', { name: 'Clone campaign' })).toBeNull()
  expect(view.queryByText('Audience')).toBeNull()
  expect(view.queryByText('Triggered By')).toBeNull()
  expect(view.queryByText(/^Owner/)).toBeNull()

  cleanup()
  installMockApi({ campaigns: workspace() })
  await renderAppAt('/campaigns?preview=c8')                                                         // a multi-channel campaign shows its template's channel
  await screen.findByRole('dialog', { name: 'Everywhere Weekend' })
  expect(await within(dialog()).findByRole('img', { name: 'SMS' })).toBeTruthy()
})

test('previous / next and ↑ / ↓ walk the rows in place: the address is replaced, the row tint follows, the ends are disabled, and the thumbnail keeps its arrows', async () => {
  installMockApi({ campaigns: workspace(), design: emailDesign })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  await user.click(within(table()).getByRole('button', { name: 'Fall Launch' }))
  await screen.findByRole('dialog', { name: 'Fall Launch' })
  const previous = within(dialog()).getByRole('button', { name: 'Previous Campaign' })
  const next = within(dialog()).getByRole('button', { name: 'Next Campaign' })
  expect(previous.getAttribute('aria-disabled')).toBe('true')                                        // the very first campaign

  await user.click(next)
  expect(await screen.findByRole('dialog', { name: 'Labor Day SMS Blast' })).toBeTruthy()
  expect(window.location.search).toBe('?preview=c2')
  expect(document.activeElement).toBe(next)                                                         // the same dialog, the same button
  expect(within(dialog()).getByText('Labor Day SMS Blast, 2 of 8').getAttribute('aria-live')).toBe('polite')
  expect(within(table()).getByRole('button', { name: 'Labor Day SMS Blast' }).closest('tr')?.className).toContain('bg-callout-bg')
  expect(within(table()).getByRole('button', { name: 'Fall Launch' }).closest('tr')?.className).not.toContain('bg-callout-bg')

  await user.keyboard('{ArrowDown}')
  expect(await screen.findByRole('dialog', { name: 'Winter Preview' })).toBeTruthy()
  await user.keyboard('{ArrowUp}')
  expect(await screen.findByRole('dialog', { name: 'Labor Day SMS Blast' })).toBeTruthy()

  within(dialog()).getByRole('region', { name: 'Message preview' }).focus()
  await user.keyboard('{ArrowDown}')                                                                 // scrolls the thumbnail, not the table
  expect(screen.getByRole('dialog', { name: 'Labor Day SMS Blast' })).toBeTruthy()

  window.history.back()                                                                              // one step, however far it walked
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(window.location.search).toBe('')

  await user.click(within(table()).getByRole('button', { name: 'Everywhere Weekend' }))
  await screen.findByRole('dialog', { name: 'Everywhere Weekend' })
  expect(within(dialog()).getByRole('button', { name: 'Next Campaign' }).getAttribute('aria-disabled')).toBe('true')   // the very last
})

test('previous / next cross page boundaries', async () => {
  const many = Array.from({ length: 30 }, (_, index) => makeCampaign({ id: `m${index + 1}`, name: `Campaign ${String(index + 1).padStart(2, '0')}`, code: `CMP-${index + 1}` }))
  const calls = installMockApi({ campaigns: many, design: emailDesign })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  await user.click(within(table()).getByRole('button', { name: 'Campaign 25' }))
  await screen.findByRole('dialog', { name: 'Campaign 25' })
  await user.click(within(dialog()).getByRole('button', { name: 'Next Campaign' }))
  expect(await screen.findByRole('dialog', { name: 'Campaign 26' })).toBeTruthy()
  expect(window.location.search).toBe('?preview=m26')
  expect(calls.some((call) => call.url.includes('/campaigns/?') && call.url.includes('page=2'))).toBe(true)
  expect(await within(table()).findByRole('button', { name: 'Campaign 26' })).toBeTruthy()
  expect(screen.getByText('Page 2 of 2')).toBeTruthy()
  expect(within(dialog()).getByRole('button', { name: 'Next Campaign' }).getAttribute('aria-disabled')).toBe(null)
  await user.click(within(dialog()).getByRole('button', { name: 'Previous Campaign' }))
  expect(await screen.findByRole('dialog', { name: 'Campaign 25' })).toBeTruthy()
  expect(await screen.findByText('Page 1 of 2')).toBeTruthy()
})

test('email details: template, contact list, subject, preheader and sender, with the email as the thumbnail', async () => {
  installMockApi({ campaigns: workspace(), design: emailDesign })
  await renderAppAt('/campaigns?preview=c1')
  await screen.findByRole('dialog', { name: 'Fall Launch' })
  expect(within(detail('Template')).getByText('Based on Fall Email')).toBeTruthy()
  expect(within(detail('Contact List')).getByText('Fall Master Audience')).toBeTruthy()
  expect(within(detail('Contact List')).getByText('Static List · Production')).toBeTruthy()
  expect(await within(detail('Subject Line')).findByText('Fall is here, Jordan')).toBeTruthy()          // sample values, as the thumbnail shows them
  expect(within(detail('Subject Line')).getByText('Shown with sample values')).toBeTruthy()
  expect(within(detail('Preheader')).getByText('New arrivals inside')).toBeTruthy()
  expect(within(detail('Preheader')).queryByText('Shown with sample values')).toBeNull()             // nothing to fill in
  expect(within(detail('Subject Line')).getByText('Subject Line').className).toContain('text-helper')
  expect(await within(detail('Sender')).findByText('Northwind Rewards')).toBeTruthy()
  expect(within(detail('Sender')).getByText('rewards@northwind.example')).toBeTruthy()
  expect(await within(dialog()).findByTitle('Email preview')).toBeTruthy()
  expect(within(dialog()).getByRole('link', { name: 'View Details' }).getAttribute('href')).toBe('/campaigns/c1')
  expect(dialog().style.width).toBe('760px')                                                        // a peek, not a page
  expect(dialog().style.maxHeight).toBe('min(640px, 100dvh - 96px)')
})

test('a preheader with tags reads with sample values too', async () => {
  installMockApi({ campaigns: workspace(), design: makeDesign({ template: 'tpl-email', html_content: '<p>Hello</p>', mjml_source: null, subject_line: 'Hello', preheader: 'Use {{offer_code}} before Sunday' }) })
  await renderAppAt('/campaigns?preview=c1')
  await screen.findByRole('dialog', { name: 'Fall Launch' })
  expect(await within(detail('Preheader')).findByText('Use FALL017 before Sunday')).toBeTruthy()
  expect(within(detail('Preheader')).getByText('Shown with sample values')).toBeTruthy()
  expect(within(detail('Subject Line')).queryByText('Shown with sample values')).toBeNull()
})

test('while the template content loads, its details are grey bars under their labels, then values', async () => {
  installMockApi({ campaigns: workspace(), design: emailDesign })
  const answer = globalThis.fetch
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/templates/tpl-email/design/')) await held
    return answer(input, init)
  })
  await renderAppAt('/campaigns?preview=c1')
  await screen.findByRole('dialog', { name: 'Fall Launch' })
  expect(within(detail('Template')).getByText('Based on Fall Email')).toBeTruthy()                 // from the row, at once
  expect(detail('Subject Line').querySelector('[data-skeleton]')).toBeTruthy()
  expect(detail('Preheader').querySelector('[data-skeleton]')).toBeTruthy()
  expect(detail('Template').parentElement?.getAttribute('aria-busy')).toBe('true')
  const widths = [...dialog().querySelectorAll<HTMLElement>('[data-skeleton]')].map((bar) => bar.style.width)
  expect(new Set(widths).size).toBe(widths.length)                                                   // no two bars alike
  release()
  expect(await within(detail('Subject Line')).findByText('Fall is here, Jordan')).toBeTruthy()
  expect(dialog().querySelector('[data-skeleton]')).toBeNull()
})

test('SMS details: sender number and name, length in characters and segments (Unicode noted); the thumbnail is the Templates phone', async () => {
  installMockApi({ campaigns: workspace() })
  await renderAppAt('/campaigns?preview=c2')
  await screen.findByRole('dialog', { name: 'Labor Day SMS Blast' })
  expect(within(dialog()).queryByText('Subject Line')).toBeNull()
  expect(await within(detail('Sender')).findByText('55512')).toBeTruthy()
  expect(within(detail('Sender')).getByText('Northwind SMS')).toBeTruthy()
  expect(await within(detail('Length')).findByText('44 characters · 1 segment')).toBeTruthy()
  expect(within(detail('Length')).queryByText('Unicode')).toBeNull()
  expect(within(dialog()).getByTestId('preview-bubble').textContent).toBe('Northwind: Hi Jordan. Reply STOP to opt out.')   // sample values filled in
  expect(within(dialog()).getByText('Text Message')).toBeTruthy()                                   // PhoneFrame's header
  expect(within(dialog()).getByText('Shown with sample values')).toBeTruthy()

  cleanup()
  installMockApi({ campaigns: workspace(), message: makeMessage({ sms_body: 'Northwind: fall is here 🍂 Reply STOP to opt out.' }) })
  await renderAppAt('/campaigns?preview=c2')
  await screen.findByRole('dialog', { name: 'Labor Day SMS Blast' })
  expect(await within(detail('Length')).findByText('Unicode')).toBeTruthy()
})

test('MMS details: the sender, and the template image in the conversation (or a placeholder when there is none)', async () => {
  installMockApi({ campaigns: workspace(), message: makeMessage({ channel: 'MMS', media_asset: mediaLibrary[0] }) })
  await renderAppAt('/campaigns?preview=c7')
  await screen.findByRole('dialog', { name: 'Lookbook Picture' })
  expect(await within(detail('Sender')).findByText('55512')).toBeTruthy()
  expect(within(dialog()).queryByText('Length')).toBeNull()
  expect((await within(dialog()).findByRole('img', { name: 'Attached image' })).getAttribute('src')).toBe('http://cdn.test/lookbook.jpg')

  cleanup()
  installMockApi({ campaigns: workspace(), message: makeMessage({ channel: 'MMS' }) })
  await renderAppAt('/campaigns?preview=c7')
  await screen.findByRole('dialog', { name: 'Lookbook Picture' })
  expect(await within(dialog()).findByText('No image yet')).toBeTruthy()
})

test('e-receipt details: subject generated from the order, sender and receipt layout; no contact list', async () => {
  installMockApi({ campaigns: workspace(), design: makeDesign({ html_content: '<p>Receipt</p>', subject_line: 'Your receipt for order {{order_number}}' }) })
  await renderAppAt('/campaigns?preview=c6')
  await screen.findByRole('dialog', { name: 'Store Receipt' })
  expect(within(dialog()).queryByText('Contact List')).toBeNull()
  expect(await within(detail('Subject Line')).findByText('Generated from the order')).toBeTruthy()
  expect(await within(detail('Sender')).findByText('Northwind Rewards')).toBeTruthy()
  expect(within(detail('Receipt Layout')).getByText('Standard')).toBeTruthy()
  expect(within(detail('Receipt Layout')).getByText(/^Order header, .*items, totals/)).toBeTruthy()
  expect(within(dialog()).getByRole('img', { name: 'Email' })).toBeTruthy()
})

test('a draft with no template or sender says what is missing and where to add it, and its way on is Continue setup', async () => {
  installMockApi({ campaigns: workspace() })
  await renderAppAt('/campaigns?preview=c5')
  await screen.findByRole('dialog', { name: 'Holiday Draft' })
  expect(within(detail('Template')).getByText('Not set yet')).toBeTruthy()
  expect(within(detail('Template')).getByText('Choose a template on the Content step')).toBeTruthy()
  expect(within(detail('Contact List')).getByText('Choose contact lists on the Audience step')).toBeTruthy()
  expect(within(detail('Subject Line')).getByText('Write a subject line on the Content step')).toBeTruthy()
  expect(within(detail('Sender')).getByText('Choose a sender on the Content step')).toBeTruthy()
  expect(within(dialog()).getByText('No content yet')).toBeTruthy()
  expect(within(dialog()).getByRole('link', { name: 'Continue Setup' }).getAttribute('href')).toBe('/campaigns/c5/edit?step=audience')
})

test('a journey campaign is marked read only, links to the journeys in a new tab, and cannot be cloned from here', async () => {
  installMockApi({ campaigns: workspace(), design: emailDesign })
  await renderAppAt('/campaigns?preview=c4')
  await screen.findByRole('dialog', { name: 'Welcome Series Email 1' })
  expect(within(dialog()).getByText('Journey-Generated · Read Only')).toBeTruthy()
  const link = within(dialog()).getByRole('link', { name: 'View Journey (opens in a new tab)' })
  expect(link.getAttribute('href')).toBe('/journeys')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noreferrer')
  expect(within(detail('Contact List')).getByText('Managed by the journey')).toBeTruthy()
  expect(within(dialog()).queryByRole('button', { name: 'Clone' })).toBeNull()
})

test('footer: Clone makes the copy and closes the quick view; the ID copies with a spoken confirmation', async () => {
  installMockApi({ campaigns: workspace(), design: emailDesign })
  const user = userEvent.setup()
  await renderAppAt('/campaigns')
  await screen.findByRole('table', { name: 'Campaigns' })
  await user.click(within(table()).getByRole('button', { name: 'Winter Preview' }))
  await screen.findByRole('dialog', { name: 'Winter Preview' })
  await user.click(within(dialog()).getByRole('button', { name: 'ID CMP-2026-0003' }))
  expect(await navigator.clipboard.readText()).toBe('CMP-2026-0003')
  expect(within(dialog()).getByText('Campaign ID copied').getAttribute('role')).toBe('status')

  await user.click(within(dialog()).getByRole('button', { name: 'Clone' }))
  expect(await screen.findByText(/“Copy of Winter Preview” was created as a draft/, {}, { timeout: 3000 })).toBeTruthy()   // the toast waits for every open campaigns query to refetch
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('link', { name: 'Open the Copy' })).toBeTruthy()
})
