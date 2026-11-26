/** The Audience step: Send To, Don't Send To, the Add Contact List pop-up, and the live audience summary. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
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
  expect(within(card('Send To')).queryByText(/lists? selected/)).toBeNull()                          // no summary line under the table

  await user.click(within(rows[0]).getByRole('button', { name: 'Remove Fall Master Audience' }))
  expect(within(card('Send To')).getByText('No contact lists yet')).toBeTruthy()
  expect(within(card('Send To')).getByText('Pick the contact lists to send this campaign to.')).toBeTruthy()
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
  expect(within(within(dialog).getByRole('radiogroup', { name: 'How to add a list' })).getAllByRole('radio').map((tab) => tab.getAttribute('aria-label'))).toEqual(['Existing Lists', 'Upload New', 'Audience or Clone'])

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
  const empty = card('Don’t Send To').querySelector<HTMLElement>('[data-empty="leave-out"]')!             // the same dashed box as Send To
  expect(within(empty).getByText('No lists added')).toBeTruthy()
  expect(within(empty).getByText('Add a contact list to keep its people from getting this campaign.')).toBeTruthy()
  expect(within(empty).getByRole('button', { name: 'Exclude a List' })).toBeTruthy()
  expect(card('Don’t Send To').querySelector('[data-empty="send-to"]')).toBeNull()
  expect(within(card('Don’t Send To')).getByText('Anyone on these lists won’t get this campaign, even if they’re also in Send To.')).toBeTruthy()

  const dialog = await openPicker(user, 'Exclude a List', 'Exclude a List')
  expect(within(dialog).queryByRole('radiogroup', { name: 'How to add a list' })).toBeNull()           // existing lists only
  expect((within(dialog).getByRole('checkbox', { name: 'Fall Master Audience' }) as HTMLInputElement).disabled).toBe(true)   // sent to already
  await user.click(within(dialog).getByRole('checkbox', { name: 'Georgia only' }))
  await user.click(within(dialog).getByRole('button', { name: 'Exclude 1 List' }))
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
  expect(within(header).getByRole('button', { name: 'Exclude a List' }).parentElement!.className).toContain('shrink-0')
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
  await within(dialog).findByLabelText('CSV File')
  await user.upload(within(dialog).getByLabelText('CSV File'), csv())
  await within(dialog).findByText('leads.csv')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('table', { name: /Columns of leads\.csv/ })
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await vi.waitFor(() => expect(dialog.querySelector('[data-tag-values-step]')).not.toBeNull())          // Tag Values: the campaign has no template yet, so Skip
  await user.click(within(dialog).getByRole('button', { name: /^(Skip|Next)$/ }))
  await within(dialog).findByRole('heading', { name: 'How did these people opt in?' })
  await user.click(within(dialog).getByRole('radio', { name: /Signed up on our website or app/ }))
  await user.click(within(dialog).getByLabelText(/^I confirm these people agreed/))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  const importButton = await within(dialog).findByRole('button', { name: 'Create List' }) as HTMLButtonElement
  await vi.waitFor(() => expect(importButton.disabled).toBe(false))
  await user.click(importButton)
  await within(dialog).findByRole('heading', { name: 'List Created' })
  await user.click(within(dialog).getByRole('button', { name: 'Review List' }))
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
test('a drip: no "How a Drip Audience Works" note; everything else as for any campaign', async () => {
  await openStep(drip({ contact_lists: [], contact_list_details: [] }))
  expect(screen.queryByText('How a Drip Audience Works')).toBeNull()
  expect(within(card('Send To')).getByText('Pick the contact lists to send this drip to.')).toBeTruthy()
  expect(within(card('Don’t Send To')).getByText('Add a contact list to keep its people from getting this drip.')).toBeTruthy()
  expect(within(card('Don’t Send To')).getAllByRole('button', { name: 'Exclude a List' })).toHaveLength(2)   // the header's, and the box's
  expect(screen.getByRole('button', { name: /Continue to Drip Campaign Setup/ })).toBeTruthy()                  // a draft can move on without lists
  cleanup()

  await openStep(makeCampaign({ status: 'DRAFT', contact_lists: [], contact_list_details: [] }))
  expect(within(card('Send To')).getByText('Pick the contact lists to send this campaign to.')).toBeTruthy()
})

test('a drip nobody can receive: a warning in the channel’s words, never a block', async () => {
  await openStep(drip({ channel: 'EMAIL' }), { estimate: { estimated_recipients: 0 } })
  expect(await screen.findByText('No one on these lists can receive marketing email right now. Check consent or the lists you’re leaving out.')).toBeTruthy()
  expect((screen.getByRole('button', { name: /Continue to Drip Campaign Setup/ }) as HTMLButtonElement).disabled).toBe(false)
  cleanup()
  await openStep(drip({ channel: 'SMS' }), { estimate: { estimated_recipients: 0 } })
  expect(await screen.findByText('No one on these lists can receive marketing texts right now. Check consent or the lists you’re leaving out.')).toBeTruthy()
})

test('Upload New: a stepper over the steps, the cards leave after the first one, Enter continues, no Cancel, closing leaves no draft', async () => {
  const { user, calls } = await openStep(empty())
  const dialog = await openPicker(user)
  await user.click(within(dialog).getByRole('radio', { name: 'Upload New' }))

  const progress = () => within(within(dialog).getByRole('list', { name: 'Progress' })).getAllByRole('listitem')
  expect(progress().map((item) => item.textContent?.replace(/, done$/, ''))).toEqual(['Details', 'File', 'Columns', 'Tags', 'Consent', 'Review'])
  expect(progress().map((item) => item.getAttribute('data-step-state'))).toEqual(['current', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead'])
  expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()
  expect(within(dialog).getByRole('radiogroup', { name: 'Use For' }).querySelector('[aria-checked="true"]')!.textContent).toBe('Email')   // from the campaign's channel
  expect(within(dialog).getByText('Test lists are held out of live sends until you promote them.')).toBeTruthy()
  expect(within(dialog).queryByRole('textbox', { name: /Description/ })).toBeNull()                         // collapsed until asked for
  expect((within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

  await user.type(within(dialog).getByLabelText('List Name'), 'Booth scans{Enter}')                         // Enter continues
  await within(dialog).findByLabelText('CSV File')
  expect(progress().map((item) => item.getAttribute('data-step-state'))).toEqual(['done', 'current', 'ahead', 'ahead', 'ahead', 'ahead'])
  expect(within(dialog).queryByRole('radiogroup', { name: 'How to add a list' })).toBeNull()               // switching way in now would drop the upload
  expect(within(dialog).getByText('Up to 50 MB and 250,000 rows. An Email column is required.')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Download Sample CSV' })).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Back' })).toBeTruthy()

  await user.upload(within(dialog).getByLabelText('CSV File'), csv())
  await within(dialog).findByText('leads.csv')
  expect(within(dialog).queryByText('Received')).toBeNull()
  expect(within(dialog).getByRole('button', { name: 'Replace' })).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  const table = await within(dialog).findByRole('table', { name: /Columns of leads\.csv/ })
  expect(within(dialog).getByText(/columns matched/)).toBeTruthy()
  expect(within(table).queryByText('Mapped')).toBeNull()
  expect(progress().map((item) => item.getAttribute('data-step-state'))).toEqual(['done', 'done', 'current', 'ahead', 'ahead', 'ahead'])

  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'DELETE' && /\/contact-lists\/[^/]+\/$/.test(call.url))).toBe(true))
})

test('Upload New, steps 4 to Done: opt-in rows gate Next, the review shows tiles and reach, and Review List focuses the new row', async () => {
  const { user } = await openStep(empty())
  const dialog = await openPicker(user)
  await user.click(within(dialog).getByRole('radio', { name: 'Upload New' }))
  await user.type(within(dialog).getByLabelText('List Name'), 'Booth scans')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await user.upload(await within(dialog).findByLabelText('CSV File'), csv())
  await within(dialog).findByText('leads.csv')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('table', { name: /Columns of leads\.csv/ })
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await vi.waitFor(() => expect(dialog.querySelector('[data-tag-values-step]')).not.toBeNull())          // Tag Values: the campaign has no template yet, so Skip
  await user.click(within(dialog).getByRole('button', { name: /^(Skip|Next)$/ }))

  await within(dialog).findByRole('heading', { name: 'How did these people opt in?' })
  const next = () => within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(next().disabled).toBe(true)
  expect(within(dialog).getByRole('radio', { name: /Bought or Rented List/ }).getAttribute('aria-disabled')).toBe('true')
  expect(within(dialog).getByText('Not Allowed')).toBeTruthy()
  expect(within(dialog).getByText('Where It Was Collected (Optional)')).toBeTruthy()
  await user.click(within(dialog).getByRole('radio', { name: /Signed up on our website or app/ }))
  expect(within(dialog).getByRole('radio', { name: /Signed up on our website or app/ }).getAttribute('aria-checked')).toBe('true')
  expect(next().disabled).toBe(true)                                                                        // the confirmation is still needed
  await user.click(within(dialog).getByLabelText(/^I confirm these people agreed/))
  expect(next().disabled).toBe(false)
  await user.click(next())

  await within(dialog).findByText(/contacts ready to import/)
  expect(['New', 'Already in C360', 'Warnings', 'Held Back'].every((label) => dialog.querySelector(`[data-tile="${label}"]`))).toBe(true)
  expect(within(dialog).getByRole('button', { name: /Download Row-by-Row Report/ })).toBeTruthy()
  const create = await within(dialog).findByRole('button', { name: 'Create List' }) as HTMLButtonElement
  await vi.waitFor(() => expect(create.disabled).toBe(false))
  await user.click(create)

  await within(dialog).findByRole('heading', { name: 'List Created' })
  expect(within(dialog).getByText('Needs Review')).toBeTruthy()
  expect(within(dialog).getAllByRole('button', { name: 'Close' })).toHaveLength(2)                          // the X, and the footer's
  await user.click(within(dialog).getByRole('button', { name: 'Review List' }))
  const link = await within(sendTo()).findByRole('link', { name: 'Booth scans (opens in a new tab)' })
  await vi.waitFor(() => expect(document.activeElement).toBe(link))
})

test('Audience or Clone: audiences and lists in one searchable list, Change goes back, and a copy ends on a Clone tag with one Done', async () => {
  const { user, calls } = await openStep(empty())
  const dialog = await openPicker(user)
  await user.click(within(dialog).getByRole('radio', { name: 'Audience or Clone' }))

  expect(within(dialog).getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true)         // nothing picked yet
  expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()
  const group = await within(dialog).findByRole('radiogroup', { name: 'Source to copy' })
  expect(within(group).getByRole('radio', { name: /Loyalty Gold/ }).textContent).toMatch(/Segment/)        // an audience
  await user.type(within(dialog).getByLabelText('Search audiences and lists'), 'georgia')
  expect(within(group).getAllByRole('radio')).toHaveLength(1)                                              // a list
  await user.click(within(group).getByRole('radio', { name: /Georgia only/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  expect((within(dialog).getByLabelText('List Name') as HTMLInputElement).value).toBe('Copy of Georgia only')
  expect(within(dialog).getByRole('radiogroup', { name: 'Use For' }).querySelector('[aria-checked="true"]')!.textContent).toBe('Email')
  await user.click(within(dialog).getByRole('button', { name: 'Change' }))                                 // back to the Source step, the cards back
  expect(within(dialog).getByRole('radiogroup', { name: 'How to add a list' })).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))                                   // the pick is kept
  await user.click(within(dialog).getByRole('button', { name: 'Create List' }))

  await within(dialog).findByRole('heading', { name: 'List Created' })
  expect(within(dialog).getByText('Clone')).toBeTruthy()
  expect(within(dialog).getAllByRole('button', { name: 'Done' })).toHaveLength(1)
  expect(calls.some((call) => call.method === 'POST' && /\/contact-lists\/[^/]+\/clone\/$/.test(call.url))).toBe(true)
})
