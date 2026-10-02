/**
 * The setup after Create Campaign: Audience → Content → Test → Targets → Review & Publish, through the real app against the
 * in-memory API. What each Continue records (setup_step), where an unfinished setup resumes, and where old links land.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, me, problem, signIn } from '@/test/mockApi'

import { placeFromParams, resumeStep } from '../setupFlow'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const draft = (overrides = {}) => makeCampaign({ status: 'DRAFT', setup_step: 1, template: null, template_name: null, sender_profile: null, sender_profile_name: null, ...overrides })
/** the step's own heading (the one focus moves to), not a panel's */
const stepHeading = (name: string) => vi.waitFor(() => {
  const heading = document.querySelector<HTMLElement>('h1[tabindex="-1"]')
  expect(heading?.textContent).toBe(name)
  return heading!
})
const patches = (calls: { method: string; url: string; body: unknown }[]) => calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/campaigns/c1/'))
const railButtons = () => within(screen.getByRole('navigation', { name: 'Setup Steps' })).getAllByRole('button')

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('five steps on the rail, one at a time; each Continue says where it goes and records the step', async () => {
  const calls = installMockApi({ campaign: draft({ contact_lists: [], contact_list_details: [] }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit')

  expect(await stepHeading('Audience')).toBeTruthy()
  expect(railButtons().map((button) => button.querySelector('[data-step-label]')?.textContent)).toEqual(['Audience', 'Content', 'Test', 'Targets', 'Review & Publish'])
  expect(railButtons()[0].getAttribute('aria-current')).toBe('step')
  expect(railButtons().map((button) => button.querySelector('[data-marker]')?.getAttribute('data-marker'))).toEqual(['current', 'ahead', 'ahead', 'ahead', 'ahead'])
  expect(railButtons().slice(1).map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true, true, true])   // steps ahead open through Continue
  expect(screen.getByText('Step 1 of 5')).toBeTruthy()
  await user.click((await screen.findAllByRole('button', { name: 'Add Contact List' }))[0])
  const picker = await screen.findByRole('dialog', { name: 'Add Contact List' })
  await user.click(await within(picker).findByRole('checkbox', { name: 'Fall Master Audience' }))
  await user.click(within(picker).getByRole('button', { name: 'Add 1 List' }))
  await user.click(screen.getByRole('button', { name: 'Continue to Content' }))

  expect(await stepHeading('Content')).toBeTruthy()
  expect(patches(calls).at(-1)?.body).toMatchObject({ contact_lists: ['cl-master'], setup_step: 2 })
  expect(screen.getByRole('button', { name: 'Audience, completed' }).querySelector('[data-marker="done"] .lucide-check')).toBeTruthy()   // a green tick
  expect(railButtons()[1].getAttribute('aria-current')).toBe('step')
  const cards = await screen.findByRole('radiogroup', { name: 'Template' })
  await user.click(within(cards).getByRole('radio', { name: /Fall Email/ }))
  await user.selectOptions(screen.getByLabelText('Send From'), 'snd-email')
  await user.click(screen.getByRole('button', { name: 'Continue to Test' }))

  expect(await stepHeading('Test')).toBeTruthy()
  expect(patches(calls).at(-1)?.body).toMatchObject({ template: 'tpl-email', sender_profile: 'snd-email', setup_step: 3 })
  expect(await screen.findByRole('group', { name: 'Send a Test' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Continue to Targets' }))                       // a test is not required

  expect(await stepHeading('Targets')).toBeTruthy()
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toMatchObject({ setup_step: 4 }))
  expect(screen.getByRole('button', { name: 'Skip for Now' })).toBeTruthy()                            // targets can wait
  await user.type(screen.getByLabelText('Clicks'), '40')
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))

  expect(await stepHeading('Review & Publish')).toBeTruthy()
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toMatchObject({ targets: { target_clicks: 40 }, setup_step: 5 }))
  expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull()                             // the last step publishes instead
  expect(screen.getAllByRole('heading', { level: 3 }).slice(0, 2).map((heading) => heading.textContent)).toEqual(['When and How It Goes Out', 'Summary and Publish'])
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(await stepHeading('Targets')).toBeTruthy()
  expect(document.activeElement).toBe(document.querySelector('h1[tabindex="-1"]'))     // focus follows the step
})

test('Test: a test sent records 4; Targets skipped records 5; Review & Publish: saving the schedule records 6 (the setup is done), and the publish asks once more', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 3 }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit')
  expect(await stepHeading('Test')).toBeTruthy()

  const test = await screen.findByRole('group', { name: 'Send a Test' })
  await user.clear(within(test).getByLabelText('Other Addresses'))
  await user.click(await within(test).findByRole('checkbox', { name: /Devon Okafor/ }))
  await user.click(within(test).getByRole('button', { name: 'Send Test' }))
  expect(await within(test).findByText('Sent to devon@example.com')).toBeTruthy()
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toEqual({ setup_step: 4, row_version: expect.any(Number) }))
  await user.click(screen.getByRole('button', { name: 'Continue to Targets' }))
  expect(await stepHeading('Targets')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Skip for Now' }))
  expect(await stepHeading('Review & Publish')).toBeTruthy()
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toMatchObject({ setup_step: 5 }))
  expect(await screen.findByText('No targets set. Results are shown against them once the campaign runs.')).toBeTruthy()   // the summary card at the top

  await user.click(screen.getByRole('radio', { name: /Schedule for Later/ }))
  await user.click(screen.getByRole('button', { name: 'Save Schedule' }))
  expect(await screen.findByText('Choose the date and time of the send.')).toBeTruthy()
  await user.selectOptions(screen.getByLabelText('Time Zone'), 'America/Chicago')
  await user.type(screen.getByLabelText(/^Send At\*/), '2099-11-02T09:00')
  await user.click(screen.getByRole('button', { name: 'Save Schedule' }))
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toMatchObject({ send_type: 'SCHEDULED', send_timezone: 'America/Chicago', scheduled_at: '2099-11-02T15:00:00.000Z', setup_step: 6 }))

  const checklist = await screen.findByRole('list', { name: 'Pre-Publish Checklist' })
  expect(within(checklist).getByText('Test message sent and reviewed').nextElementSibling?.textContent).toBe(': done')
  await user.click(screen.getByRole('button', { name: 'Publish to Production' }))
  const dialog = await screen.findByRole('dialog', { name: 'Publish to production?' })
  expect(calls.some((call) => call.url.endsWith('/publish/'))).toBe(false)
  await user.click(within(dialog).getByRole('button', { name: 'Publish' }))
  expect(await screen.findByRole('tab', { name: 'Overview' })).toBeTruthy()                              // landed on the campaign page
  expect(within(screen.getByTestId('campaign-chips')).getByText('Scheduled')).toBeTruthy()             // published, its send in 2099
})

test('publishing with an unsaved schedule stores it first', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, runs: [{ id: 'rt', test_mode: true, status: 'COMPLETED', run_number: 1 }] as never }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=publish&section=review')
  await stepHeading('Review & Publish')
  await user.click(await screen.findByRole('checkbox', { name: /Each Recipient's Local Time/ }))
  await user.click(await screen.findByRole('button', { name: 'Publish to Production' }))
  expect(await screen.findByRole('dialog', { name: 'Publish to production?' })).toBeTruthy()
  expect(patches(calls).at(-1)?.body).toMatchObject({ timezone_optimization: true })
})

test('an e-receipt skips Audience; its schedule section says there is none', async () => {
  installMockApi({ campaign: draft({ campaign_type: 'E_RECEIPT', solicitation_type: 'TRANSACTIONAL', contact_lists: [], contact_list_details: [], setup_step: 5 }) })
  await renderAppAt('/campaigns/c1/edit')
  expect(await stepHeading('Review & Publish')).toBeTruthy()
  expect(railButtons().map((button) => button.querySelector('[data-step-label]')?.textContent)).toEqual(['Content', 'Test', 'Targets', 'Review & Publish'])
  expect(await screen.findByText('This is an E-Receipt campaign, so there is no schedule to set')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Change the campaign type' })).toBeNull()                // the type is fixed after creation
  expect(screen.queryByRole('button', { name: 'Save Schedule' })).toBeNull()
})

test('resume: 1 → Audience (Content for an e-receipt), 2 → Content, 3 → Test, 4 → Targets, 5 → Review & Publish; complete → the campaign page', async () => {
  expect([0, 1, 2, 3, 4, 5, 6].map((progress) => resumeStep(progress, 'REGULAR_MARKETING'))).toEqual(['audience', 'audience', 'content', 'test', 'targets', 'publish', 'publish'])
  expect(resumeStep(1, 'E_RECEIPT')).toBe('content')

  for (const [progress, heading] of [[1, 'Audience'], [2, 'Content'], [3, 'Test'], [4, 'Targets'], [5, 'Review & Publish']] as const) {
    installMockApi({ campaigns: [draft({ setup_step: progress })] })
    await renderAppAt('/campaigns/c1')                                                                   // a bookmark or a typed address
    expect(await stepHeading(heading)).toBeTruthy()
    cleanup()
  }

  const user = userEvent.setup()
  installMockApi({ campaigns: [draft({ setup_step: 2 })] })
  await renderAppAt('/campaigns')
  await user.click(within(await screen.findByRole('table', { name: 'Campaigns' })).getByRole('button', { name: 'Actions for Fall Launch' }))
  await user.click(within(screen.getByRole('region', { name: /^Actions for / })).getByRole('button', { name: 'Continue Setup' }))
  expect(window.location.pathname + window.location.search).toBe('/campaigns/c1/edit?step=content')
  expect(screen.queryByTestId('setup-progress')).toBeNull()                                           // not on the step it resumes at
  expect(screen.queryByRole('link', { name: 'Back to the Campaign' })).toBeNull()
  await user.click(await screen.findByRole('radio', { name: /Fall Email/ }))
  await user.click(screen.getAllByRole('button', { name: 'Save and Close' })[0])                             // keeps the place, does not move it on
  expect(await screen.findByRole('table', { name: 'Campaigns' })).toBeTruthy()

  cleanup()
  installMockApi({ campaigns: [draft({ setup_step: 2 })] })
  await renderAppAt('/campaigns/c1/edit?step=publish')                                                  // no jumping ahead
  expect(await stepHeading('Content')).toBeTruthy()
})

test('old links (?step=1..7) land in the new places, and the address is rewritten', async () => {
  const campaign = makeCampaign({ status: 'DRAFT' })
  const at = (step: string) => placeFromParams(new URLSearchParams({ step }), 'REGULAR_MARKETING')
  expect(['1', '2', '3', '4', '5', '6', '7'].map(at)).toEqual([
    { step: 'audience', details: true }, { step: 'audience' }, { step: 'content' }, { step: 'publish', section: 'schedule' },
    { step: 'targets' }, { step: 'test' }, { step: 'publish', section: 'review' }])
  expect(placeFromParams(new URLSearchParams({ step: '1' }), 'E_RECEIPT')).toEqual({ step: 'content', details: true })

  for (const [old, heading, search] of [['1', 'Audience', '?step=audience&details=1'], ['3', 'Content', '?step=content'], ['5', 'Targets', '?step=targets'],
    ['4', 'Review & Publish', '?step=publish&section=schedule'], ['6', 'Test', '?step=test'], ['7', 'Review & Publish', '?step=publish&section=review']] as const) {
    installMockApi({ campaign })
    await renderAppAt(`/campaigns/c1/edit?step=${old}`)
    expect(await stepHeading(heading)).toBeTruthy()
    await vi.waitFor(() => expect(window.location.search).toBe(search))
    if (old === '1') expect(await screen.findByRole('dialog', { name: 'Edit Details' })).toBeTruthy()
    if (old === '7') await vi.waitFor(() => expect((document.activeElement as HTMLElement).id).toBe('publish-review-title'))
    cleanup()
  }
})

test('the API’s field messages open where the field is: a step, or the Details pop-up', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), onSave: () => problem(400, { title: 'Invalid input', errors: { name: ['Another campaign already has this name.'] } }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await user.type(await screen.findByLabelText('Conversions'), '12')
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))
  const details = await screen.findByRole('dialog', { name: 'Edit Details' })
  expect(within(details).getByText('Another campaign already has this name.')).toBeTruthy()

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), onSave: () => problem(400, { title: 'Invalid input', errors: { contact_lists: ['One of the lists no longer exists.'] } }) })
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await user.type(await screen.findByLabelText('Conversions'), '12')
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))
  expect(await stepHeading('Audience')).toBeTruthy()
})

test('guards: a published or journey campaign is not editable; without campaign.edit there is no setup', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'ACTIVE' }) })
  await renderAppAt('/campaigns/c1/edit')
  expect(await screen.findByText(/This campaign is active, so it can no longer be edited/)).toBeTruthy()

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'PRODUCTION_PUBLISHED', is_journey_generated: true }) })
  await renderAppAt('/campaigns/c1/edit')
  expect(await screen.findByText('This campaign is generated by a journey. Change the journey instead.')).toBeTruthy()

  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), me: { principal: { ...me.principal, permissions: ['campaign.view'] } } as never })
  await renderAppAt('/campaigns/c1/edit')
  expect(await screen.findByText('You cannot edit campaigns')).toBeTruthy()
})

test('a conflict (409) offers to reload the stored version', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }), onSave: () => problem(409, { title: 'Conflict', detail: 'Someone else changed this campaign. Reload to see their version.' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await user.type(await screen.findByLabelText('Conversions'), '12')
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))
  expect(await screen.findByText('Someone else changed this campaign. Reload to see their version.')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Reload the Latest Version/ })).toBeTruthy()
})

test('a drip series is set in Review & Publish, as it was on Scheduling & Delivery', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'DRAFT', campaign_type: 'DRIP', send_type: 'DRIP', drip_config: { time: '10:00', steps: [{ day: 0, label: 'Welcome' }] } }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=publish')
  expect(await screen.findByRole('radio', { name: /Drip Series/ })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add a Step' }))
  await user.clear(screen.getByLabelText(/^Step 2: Day/))
  await user.type(screen.getByLabelText(/^Step 2: Day/), '0')
  await user.click(screen.getByRole('button', { name: 'Save Schedule' }))
  expect(await screen.findByText('Another step is already on this day.')).toBeTruthy()
  await user.clear(screen.getByLabelText(/^Step 2: Day/))
  await user.type(screen.getByLabelText(/^Step 2: Day/), '7')
  await user.click(screen.getByRole('button', { name: 'Save Schedule' }))
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toMatchObject({ send_type: 'DRIP', drip_config: { time: '10:00', steps: [{ day: 0, label: 'Welcome' }, { day: 7 }] } }))
})

test('every field of the old seven steps is still reachable', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?details=1')
  const details = await screen.findByRole('dialog', { name: 'Edit Details' })                           // old step 1
  expect(within(details).getByRole('button', { name: /More Details/ }).getAttribute('aria-expanded')).toBe('true')   // it has a code
  for (const label of [/^Campaign Name/, /^Message Purpose/, /^Code/, /^Description/, /^Tags/]) expect(await within(details).findByLabelText(label)).toBeTruthy()
  expect(within(details).getByRole('button', { name: 'Change' })).toBeTruthy()                          // owner
  expect(details.querySelector('[data-locked="Campaign Type"]')).toBeTruthy()
  expect(details.querySelector('[data-locked="Channel"]')).toBeTruthy()
  await user.click(within(details).getByRole('button', { name: 'Cancel' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  await user.click(screen.getByRole('button', { name: /^Content/ }))                                     // old step 3
  expect(await screen.findByLabelText('Send From')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /^Targets/ }))                                     // old step 5
  for (const label of [/^Target Revenue/, /^Clicks/, /^Conversions/, /^Offer Redemptions/]) expect(await screen.findByLabelText(label)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /^Test\b/ }))                                        // old step 6
  expect(await screen.findByRole('group', { name: 'Send a Test' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /^Review & Publish/ }))                            // old steps 4 and 7
  expect(await screen.findByRole('radiogroup', { name: 'When to Send' })).toBeTruthy()
  expect(await screen.findByRole('list', { name: 'Pre-Publish Checklist' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /^Audience/ }))                                    // old step 2
  expect(await screen.findByRole('link', { name: 'Fall Master Audience (opens in a new tab)' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Add List to Leave Out' })).toBeTruthy()
})

test('the setup-in-progress line says how far the setup got, and the back button goes to the list', async () => {
  const user = userEvent.setup()
  installMockApi({ campaign: draft({ setup_step: 3 }) })
  await renderAppAt('/campaigns/c1/edit')
  await stepHeading('Test')
  expect(screen.queryByTestId('setup-progress')).toBeNull()
  await user.click(screen.getByRole('button', { name: /^Audience/ }))
  expect((await screen.findByTestId('setup-progress')).textContent).toBe('Setup in progress: 2 of 5 steps done. The campaign opens here until setup is finished. Nothing is sent until you publish.')
  const back = screen.getByRole('link', { name: 'Back to Campaigns' })                                   // the flow bar's back button
  expect(back.getAttribute('href')).toBe('/campaigns')
  expect(back.querySelector('svg')?.getAttribute('class')).toContain('lucide-arrow-left')
})

test('a text campaign with an email list attached says what the list may lack, and the Audience card names the biggest reason people are left out', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', channel: 'SMS' }) })
  await renderAppAt('/campaigns/c1/edit?step=audience')
  expect(await stepHeading('Audience')).toBeTruthy()
  expect(await screen.findByText('An email list: its people may have no mobile number or no text consent.')).toBeTruthy()
  expect((await screen.findByTestId('audience-reason')).textContent).toBe('9 left out: Unsubscribed')
  cleanup()
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', channel: 'EMAIL' }) })
  await renderAppAt('/campaigns/c1/edit?step=audience')
  expect(await stepHeading('Audience')).toBeTruthy()
  await screen.findByTestId('audience-reason')
  expect(screen.queryByText(/its people may have no/)).toBeNull()
})
