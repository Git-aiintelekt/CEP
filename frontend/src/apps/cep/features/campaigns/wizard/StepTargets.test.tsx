/**
 * Targets (engagement targets with their share of the recipients, economics with cost chips, the plan at a glance) and
 * the setup's top bar: the dot stepper, its narrow-screen menu and progress bar, and where Back goes.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, problem, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const draft = (overrides = {}) => makeCampaign({ status: 'DRAFT', setup_step: 4, ...overrides })
const atTargets = () => vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Targets'))
const patches = (calls: { method: string; url: string; body: unknown }[]) => calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/campaigns/c1/'))
const shareOf = (label: string) => {
  let box: HTMLElement | null = screen.getByLabelText(label)
  while (box && !box.querySelector('[data-share]')) box = box.parentElement
  return box?.querySelector('[data-share]')?.textContent
}
const plan = () => screen.getByTestId('cost-per-conversion')
const fact = (label: string) => within(within(document.querySelector<HTMLElement>('[data-plan-card]')!).getByText(label).closest('div') as HTMLElement)

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('an email campaign has Opens, Clicks, Conversions and Offer Redemptions, each with its share of the estimated recipients', async () => {
  installMockApi({ campaign: draft() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()

  expect(screen.getByRole('heading', { name: 'Engagement Targets' })).toBeTruthy()
  for (const label of ['Opens', 'Clicks', 'Conversions', 'Offer Redemptions']) expect(screen.getByLabelText(label)).toBeTruthy()
  await vi.waitFor(() => expect(shareOf('Clicks')).toBe('Leave blank if you’re not tracking this'))
  await user.type(screen.getByLabelText('Clicks'), '44')
  expect(shareOf('Clicks')).toBe('≈ 50.0% of 88 estimated recipients')
  await user.type(screen.getByLabelText('Conversions'), '1200')
  await user.tab()
  expect((screen.getByLabelText('Conversions') as HTMLInputElement).value).toBe('1,200')              // formatted once the box is left
  expect((screen.getByLabelText('Offer Redemptions') as HTMLInputElement).value).toBe('')              // kept apart from conversions
})

test('a text campaign has no Opens target; with no lists the share asks for them; an e-receipt shows no share', async () => {
  installMockApi({ texts: true, campaign: draft({ channel: 'SMS', contact_lists: [], contact_list_details: [] }) })
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()
  expect(screen.queryByLabelText('Opens')).toBeNull()
  expect(screen.getByLabelText('Clicks')).toBeTruthy()
  expect(shareOf('Clicks')).toBe('Add contact lists to see the share')

  cleanup()
  installMockApi({ campaign: draft({ campaign_type: 'E_RECEIPT', solicitation_type: 'TRANSACTIONAL', contact_lists: [], contact_list_details: [] }) })
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()
  await vi.waitFor(() => expect(document.querySelector('[data-share]')).toBeNull())                   // once the stored campaign has filled the form
})

test('cost chips fill the amount; Custom opens a box; an amount off the chips selects Custom; Clear empties it', async () => {
  const calls = installMockApi({ campaign: draft({ targets: { target_revenue: null, target_opens: null, target_clicks: null, target_conversions: null, target_redemptions: null, planned_cost: null, planned_offer_cost: '750', notes: null } }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()

  const campaign = screen.getByRole('radiogroup', { name: 'Planned Campaign Cost' })
  expect(within(campaign).getAllByRole('radio').map((chip) => chip.textContent)).toEqual(['$500', '$1,000', '$2,500', 'Custom'])
  expect(within(campaign).queryByRole('button', { name: 'Clear' })).toBeNull()
  await user.click(within(campaign).getByRole('radio', { name: '$1,000' }))
  expect(within(campaign).getByRole('radio', { name: '$1,000' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.queryByLabelText('Planned Campaign Cost')).not.toBeInstanceOf(HTMLInputElement)       // no box for a chip

  const offer = screen.getByRole('radiogroup', { name: 'Planned Offer Cost' })
  expect(within(offer).getByRole('radio', { name: 'Custom' }).getAttribute('aria-checked')).toBe('true')   // $750 isn't a chip
  const box = document.querySelector<HTMLInputElement>('[data-cost="planned_offer_cost"] input')!
  expect(box.value).toBe('750')
  await user.click(within(offer).getByRole('button', { name: 'Clear' }))
  expect(document.querySelector('[data-cost="planned_offer_cost"] input')).toBeNull()
  expect(within(offer).getByRole('radio', { name: 'Custom' }).getAttribute('aria-checked')).toBe('false')

  await user.click(within(offer).getByRole('radio', { name: 'Custom' }))
  await user.type(document.querySelector<HTMLInputElement>('[data-cost="planned_offer_cost"] input')!, '120')
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))
  await vi.waitFor(() => expect(patches(calls).at(-1)?.body).toMatchObject({ targets: { planned_cost: '1000', planned_offer_cost: '120' } }))
})

test('the plan: cost per conversion from both costs, total spend and return, and "—" until there is enough to work it out', async () => {
  installMockApi({ campaign: draft() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()

  expect(within(document.querySelector<HTMLElement>('[data-plan-card]')!).getByRole('heading', { name: 'Plan at a Glance' })).toBeTruthy()
  expect(within(document.querySelector<HTMLElement>('[data-plan-card]')!).getByText(/Enter a revenue target and the planned costs/)).toBeTruthy()

  await user.type(screen.getByLabelText('Target Revenue'), '10000')
  expect(plan().textContent).toContain('—')
  expect(plan().textContent).toContain('Add planned costs and a conversions target')
  expect(fact('Target Revenue').getByText('$10,000')).toBeTruthy()
  expect(fact('Planned Return').getByText('—')).toBeTruthy()

  await user.click(within(screen.getByRole('radiogroup', { name: 'Planned Campaign Cost' })).getByRole('radio', { name: '$2,500' }))
  await user.click(within(screen.getByRole('radiogroup', { name: 'Planned Offer Cost' })).getByRole('radio', { name: '$500' }))
  expect(fact('Total Planned Spend').getByText('$3,000')).toBeTruthy()
  expect(fact('Planned Return').getByText('3.3 : 1')).toBeTruthy()
  expect(plan().textContent).toContain('—')                                                           // still no conversions target

  await user.type(screen.getByLabelText('Conversions'), '40')
  expect(plan().textContent).toContain('$75.00')                                                       // (2,500 + 500) ÷ 40
  expect(plan().textContent).toContain('Planning estimate, not a guaranteed outcome')
})

test('an empty Targets step continues; a bad number is explained; the server’s words land on the field', async () => {
  const calls = installMockApi({ campaign: draft() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))
  await vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Review & Publish'))
  expect(patches(calls).at(-1)?.body).toMatchObject({ setup_step: 5 })

  cleanup()
  installMockApi({ campaign: draft(), onSave: () => problem(400, { title: 'Invalid input', errors: { targets: { target_clicks: ['Clicks cannot exceed the audience.'] } } }) })
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()
  await user.type(screen.getByLabelText('Clicks'), '4x')
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))
  expect(await screen.findByText('Enter a whole number, zero or more.')).toBeTruthy()
  await user.clear(screen.getByLabelText('Clicks'))
  await user.type(screen.getByLabelText('Clicks'), '5000')
  await user.click(screen.getByRole('button', { name: 'Continue to Review & Publish' }))
  expect(await screen.findByText('Clicks cannot exceed the audience.')).toBeTruthy()
  await atTargets()
})

test('the top bar: back, the name with step · type · channel, a dot stepper that only opens reached steps, and Save and Close', async () => {
  installMockApi({ campaign: draft() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()

  const bar = document.querySelector<HTMLElement>('[data-flow-bar]')!
  expect(within(bar).getByRole('link', { name: 'Back to Campaigns' }).getAttribute('href')).toBe('/campaigns')
  expect(within(bar).getByTestId('flow-campaign-name').getAttribute('title')).toBe('Fall Launch')
  expect(bar.querySelector('[data-flow-subtitle]')).toBeNull()                                    // no "Step · Type · Channel" line

  const stepper = within(bar).getByRole('navigation', { name: 'Setup Steps' })
  expect(stepper.querySelector('ol')).toBeTruthy()
  const steps = within(stepper).getAllByRole('button')
  expect(steps.map((step) => step.querySelector('[data-marker]')?.getAttribute('data-marker'))).toEqual(['done', 'done', 'done', 'current', 'ahead'])
  expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, null, null, 'step', null])
  expect((steps[2] as HTMLButtonElement).disabled).toBe(false)
  expect((steps[4] as HTMLButtonElement).disabled).toBe(true)
  expect(stepper.querySelectorAll('li > span[aria-hidden]').length).toBe(4)                           // a connector between each pair

  steps[1].focus()
  await user.keyboard('{Enter}')
  await vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Content'))
  expect(within(stepper).getByRole('button', { name: /^Content/ }).getAttribute('aria-current')).toBe('step')
  expect(within(bar).getAllByRole('button', { name: 'Save and Close' })).toHaveLength(2)             // the text button, and the icon under lg
  expect(within(bar).getByRole('button', { name: 'Edit Details' })).toBeTruthy()
})

test('under lg the stepper folds into "Step n of 5 · Step", a menu of the steps and a progress bar', async () => {
  installMockApi({ campaign: draft() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()

  const progress = screen.getByRole('progressbar', { name: 'Setup progress' })
  expect(progress.getAttribute('aria-valuenow')).toBe('4')
  expect((progress.firstElementChild as HTMLElement).style.width).toBe('80%')
  const trigger = screen.getByRole('button', { name: /^Step 4 of 5 · Targets/ })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  await user.click(trigger)
  const menu = await screen.findByRole('region', { name: 'Setup Steps' })
  const rows = within(menu).getAllByRole('button')
  expect(rows.map((row) => row.textContent?.replace(/^\d/, ''))).toEqual(['Audience', 'Content', 'Test', 'Targets', 'Review & Publish'])
  expect(rows[4].getAttribute('aria-disabled')).toBe('true')                                        // not reached yet
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('region', { name: 'Setup Steps' })).toBeNull()

  await user.click(trigger)
  await user.click(within(await screen.findByRole('region', { name: 'Setup Steps' })).getByRole('button', { name: 'Audience' }))
  await vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Audience'))
  expect(screen.getByRole('button', { name: /^Step 1 of 5 · Audience/ })).toBeTruthy()
})

test('a finished setup goes back to the campaign; an e-receipt shows only its own steps', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 6 }) })
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()
  expect(screen.getByRole('link', { name: 'Back to the Campaign' }).getAttribute('href')).toBe('/campaigns/c1?tab=overview')

  cleanup()
  installMockApi({ campaign: draft({ campaign_type: 'E_RECEIPT', solicitation_type: 'TRANSACTIONAL', contact_lists: [], contact_list_details: [] }) })
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()
  const stepper = screen.getByRole('navigation', { name: 'Setup Steps' })
  expect(within(stepper).getAllByRole('button').map((button) => button.querySelector('[data-step-label]')?.textContent)).toEqual(['Content', 'Test', 'Targets', 'Review & Publish'])
  expect(screen.getByRole('button', { name: /^Step 3 of 4 · Targets/ })).toBeTruthy()
})

test('stepper circles: a Blue 600 tick when done, the number ringed in blue when current, a grey number ahead', async () => {
  installMockApi({ campaign: draft() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()

  const steps = within(screen.getByRole('navigation', { name: 'Setup Steps' })).getAllByRole('button')
  const circle = (index: number) => steps[index].querySelector<HTMLElement>('[data-marker]')!
  const label = (index: number) => steps[index].querySelector<HTMLElement>('[data-step-label]')!

  expect(circle(0).className).toContain('bg-brand-600')
  expect(circle(0).className).toContain('h-6')
  expect(circle(0).querySelector('.lucide-check')).toBeTruthy()
  expect(circle(0).textContent).toBe('')
  expect(label(0).className).toContain('text-ink-800')
  expect(label(0).className).not.toContain('font-semibold')

  expect(circle(3).textContent).toBe('4')
  expect(circle(3).className).toContain('bg-brand-100')
  expect(circle(3).className).toContain('border-link')
  expect(circle(3).className).toContain('text-brand-800')
  expect(label(3).className).toContain('font-semibold')
  expect(label(3).className).toContain('text-ink-900')

  expect(circle(4).textContent).toBe('5')
  expect(circle(4).className).toContain('border-line')
  expect(circle(4).className).toContain('text-ink-300')
  expect(label(4).className).toContain('text-ink-800')                                              // Gray 400 would fail 4.5:1 on white
  expect(label(0).className + label(3).className).toContain('text-card-title')                      // 15px labels
  expect(circle(0).className).not.toContain('bg-success')                                          // progress, not a status

  expect(steps[4].className).toContain('disabled:cursor-default')
  expect((steps[4] as HTMLButtonElement).disabled).toBe(true)
  expect(steps[0].getAttribute('aria-label') ?? steps[0].textContent).toContain('Audience')
  expect(screen.getByRole('button', { name: 'Audience, completed' })).toBe(steps[0])
  expect([...document.querySelectorAll('[data-connector]')].every((line) => line.className.includes('w-14') && line.className.includes('bg-fill-subtle'))).toBe(true)

  await user.click(steps[0])                                                                         // a done step opens
  await vi.waitFor(() => expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Audience'))
  await user.click(steps[3])                                                                         // one ahead does nothing
  expect(document.querySelector('h1[tabindex="-1"]')?.textContent).toBe('Audience')
})

test('a flow bar under 1340px: every step keeps its name (smaller type, shorter connectors), no subtitle, Details as an icon', async () => {
  installMockApi({ campaign: draft() })
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()

  const bar = document.querySelector<HTMLElement>('[data-flow-bar]')!
  const steps = within(within(bar).getByRole('navigation', { name: 'Setup Steps' })).getAllByRole('button')
  expect(steps.map((step) => step.querySelector('[data-step-label]')?.textContent)).toEqual(['Audience', 'Content', 'Test', 'Targets', 'Review & Publish'])
  for (const step of steps) {
    const label = step.querySelector('[data-step-label]')!
    expect(label.className).not.toContain('sr-only')                                               // done, current and ahead all show their names
    expect(label.className).toContain('@max-[1339px]:text-sm')
    expect(step.querySelector('[data-tooltip]')).toBeNull()                                        // nothing to reveal on hover
  }
  expect(screen.getByRole('button', { name: 'Audience, completed' })).toBeTruthy()                  // a done step still says so
  expect(bar.querySelector('[data-connector]')!.className).toContain('@max-[1339px]:w-5')

  const details = within(bar).getByRole('button', { name: 'Edit Details' })
  expect(details.querySelector('.lucide-pencil')).toBeTruthy()
  expect([...details.querySelectorAll('span')].find((span) => span.textContent === 'Details')!.className).toContain('xl:@max-[1339px]:sr-only')
  expect(details.querySelector('[data-tooltip]')?.textContent).toBe('Edit Details')
})

test('the narrow-screen menu uses the same circles at 20px', async () => {
  installMockApi({ campaign: draft() })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=targets')
  await atTargets()
  await user.click(screen.getByRole('button', { name: /^Step 4 of 5 · Targets/ }))
  const rows = within(await screen.findByRole('region', { name: 'Setup Steps' })).getAllByRole('button')
  const markers = rows.map((row) => row.querySelector<HTMLElement>('[data-marker]')!)
  expect(markers.map((marker) => marker.getAttribute('data-marker'))).toEqual(['done', 'done', 'done', 'current', 'ahead'])
  expect(markers.every((marker) => marker.className.includes('h-5') && marker.className.includes('w-5'))).toBe(true)
  expect(markers[0].querySelector('.lucide-check')).toBeTruthy()
  expect(markers.slice(3).map((marker) => marker.textContent)).toEqual(['4', '5'])
})
