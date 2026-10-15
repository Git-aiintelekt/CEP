/**
 * Journey Setup (phase 6e): Step 1 name + entry trigger gates Next; each entry pill shows its own grouped
 * trigger dropdown; Step 2's population/re-entry cards gate "Continue to Build"; Continue to Build really
 * creates the journey (POST /journeys/), saves the entry rule onto its blank version 1
 * (PUT /journeys/{id}/versions/1/graph/), and navigates to the Build canvas.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

async function openSetup() {
  const user = userEvent.setup()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })
  await user.click(screen.getByRole('button', { name: /Create Journey/ }))
  return { user, dialog: await screen.findByRole('dialog', { name: /^Create Journey$/ }) }
}

// jsdom has neither, and "Continue to Build" navigates into the Build canvas (@xyflow/react) — same stubs as
// JourneyBuild.test.tsx: a DOMMatrixReadOnly for the pane's zoom reads, and a ResizeObserver that reports a
// plausible card size at once so nodes (and their buttons) appear.
beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1
      constructor(_transform?: string) {
        void _transform
      }
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe(target: Element) {
        const rect = { width: 224, height: 64, top: 0, left: 0, bottom: 64, right: 224, x: 0, y: 0, toJSON: () => ({}) }
        const size = [{ inlineSize: 224, blockSize: 64 }]
        this.callback([{ target, contentRect: rect, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('Next stays disabled until a name and a trigger are both chosen', async () => {
  installMockApi()
  const { user, dialog } = await openSetup()

  const next = within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(next.disabled).toBe(true)

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Welcome Series')
  expect(next.disabled).toBe(true)                                      // name alone isn't enough

  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  expect(next.disabled).toBe(true)                                      // pill chosen, no specific trigger yet

  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Welcome' }))
  expect(next.disabled).toBe(false)
})

test('each entry pill opens its own grouped trigger dropdown', async () => {
  installMockApi()
  const { user, dialog } = await openSetup()

  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  expect(within(dialog).getByText('Customer / Lifecycle')).toBeTruthy()
  expect(within(dialog).getByText('Commerce / Offer')).toBeTruthy()
  expect(within(dialog).getByText('Segment / Loyalty')).toBeTruthy()
  expect(within(dialog).getByText('Engagement')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Abandoned Cart' })).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Abandoned Cart' }))
  expect(within(dialog).getByRole('button', { name: /Abandoned Cart/ })).toBeTruthy()

  await user.click(within(dialog).getByRole('radio', { name: 'Date / Time' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select a Schedule' }))
  expect(within(dialog).getByText('Recurring')).toBeTruthy()
  expect(within(dialog).getByText('Fixed')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Weekly' })).toBeTruthy()

  await user.click(within(dialog).getByRole('radio', { name: 'Segment or Customer Change' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select a Change Trigger' }))
  expect(within(dialog).getByText('Attribute Change')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Enters Segment' })).toBeTruthy()

  await user.click(within(dialog).getByRole('radio', { name: 'Customer List' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select a Customer List' }))
  expect(await within(dialog).findByText('Uploaded Lists')).toBeTruthy()
  expect(within(dialog).getByText('Synced Lists')).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Fall Master Audience' })).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Georgia only' })).toBeTruthy()
})

test('Create Journey stays disabled until population and re-entry are chosen', async () => {
  installMockApi()
  const { user, dialog } = await openSetup()

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Welcome Series')
  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Welcome' }))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  await screen.findByText(/^Step 2 of 2/)
  const build = within(dialog).getByRole('button', { name: 'Create Journey' }) as HTMLButtonElement
  expect(build.disabled).toBe(true)                                     // re-entry defaults to Never, but population is unset

  await user.click(within(dialog).getByRole('radio', { name: /^Fixed/ }))
  expect(build.disabled).toBe(false)

  await user.click(within(dialog).getByRole('radio', { name: /^After X Days/ }))
  expect(build.disabled).toBe(true)                                     // needs a cooldown number now

  await user.type(within(dialog).getByLabelText('Cooldown Days'), '90')
  expect(build.disabled).toBe(false)
})

test('Create Journey creates the journey, saves its entry rule, and opens the Build canvas', async () => {
  const calls = installMockApi()
  const { user, dialog } = await openSetup()

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Welcome Series — New Loyalty Members')
  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Welcome' }))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  await screen.findByText(/^Step 2 of 2/)
  await user.click(within(dialog).getByRole('radio', { name: /^Continuously Qualifying/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create Journey' }))

  await screen.findByRole('heading', { name: 'Journey Settings' })

  const create = calls.find((call) => call.method === 'POST' && call.url.endsWith('/journeys/'))
  expect(create?.body).toMatchObject({ name: 'Welcome Series — New Loyalty Members', population_mode: 'CONTINUOUSLY_QUALIFYING', reentry_policy: 'NEVER' })

  const save = calls.find((call) => call.method === 'PUT' && /\/journeys\/.+\/versions\/1\/graph\/$/.test(call.url))
  expect(save?.body?.graph).toMatchObject({ entry_rules: [{ entry_type: 'EVENT', rule_definition: { event_type: 'WELCOME' } }] })
})

test('Date / Time Weekly: weekdays, a time and who enters; the summary reads it back and the rule is saved whole', async () => {
  const calls = installMockApi()
  const { user, dialog } = await openSetup()

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Monday VIP Picks')
  await user.click(within(dialog).getByRole('radio', { name: 'Date / Time' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select a Schedule' }))
  await user.click(screen.getByRole('button', { name: 'Weekly' }))
  const next = within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(next.disabled).toBe(true)                                      // no weekday and nobody to enter yet

  await user.click(within(dialog).getByRole('button', { name: 'Monday' }))
  await user.selectOptions(within(dialog).getByLabelText(/^At/), '09:30')
  await user.click(within(dialog).getByRole('button', { name: 'Select a List or Segment' }))
  await user.click(await screen.findByRole('button', { name: 'Fall Master Audience' }))
  expect(dialog.textContent).toContain('Every Monday at 9:30 AM, the members of Fall Master Audience enter.')
  expect(next.disabled).toBe(false)

  await user.click(next)
  await screen.findByText(/^Step 2 of 2/)
  await user.click(within(dialog).getByRole('radio', { name: /^Continuously Qualifying/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create Journey' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/graph/'))).toBe(true))
  const saved = calls.find((call) => call.method === 'PUT' && call.url.includes('/graph/'))?.body as { graph: { entry_rules: unknown[] } }
  expect(saved.graph.entry_rules).toEqual([{ entry_type: 'DATE_TIME', rule_definition: { schedule: 'WEEKLY', time: '09:30', weekdays: ['MON'],
                                                                                          contact_list_id: 'cl-master', contact_list_name: 'Fall Master Audience' } }])
})

test('Date / Time On a Date Attribute: the date, the offset, Every Year or Once, and an optional segment', async () => {
  installMockApi()
  const { user, dialog } = await openSetup()

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Birthday Week Reward')
  await user.click(within(dialog).getByRole('radio', { name: 'Date / Time' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select a Schedule' }))
  await user.click(screen.getByRole('button', { name: 'On a Date Attribute' }))
  const date = await within(dialog).findByRole('combobox', { name: /^Date/ })
  await vi.waitFor(() => expect((date as HTMLSelectElement).disabled).toBe(false))
  await user.selectOptions(date, 'birth_date')
  expect(dialog.textContent).toContain('18,240 customers have it today.')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^When/ }), '-7')
  await user.selectOptions(within(dialog).getByLabelText(/^At/), '10:00')
  expect(dialog.textContent).toContain('Every year, 7 days before each customer’s Birth Date, at 10:00 AM, every customer with that date enters.')
  expect((within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)   // the segment is optional

  await user.click(within(dialog).getByRole('radio', { name: 'Once' }))
  await user.click(within(dialog).getByRole('button', { name: 'Every Customer With This Date' }))
  await user.click(await screen.findByRole('button', { name: 'Loyalty Gold & Platinum' }))
  expect(dialog.textContent).toContain('7 days before each customer’s Birth Date, at 10:00 AM, customers in Loyalty Gold & Platinum enter.')
})

test('the name and description count against their published limits, and re-entry days must be 1 to 3,650', async () => {
  installMockApi()
  const { user, dialog } = await openSetup()

  const name = within(dialog).getByLabelText(/^Journey Name/) as HTMLInputElement
  await vi.waitFor(() => expect(within(dialog).getByLabelText('0 of 200 characters')).toBeTruthy())
  expect(name.maxLength).toBe(200)
  await user.type(name, 'Welcome Series')
  expect(within(dialog).getByLabelText('14 of 200 characters')).toBeTruthy()
  expect((within(dialog).getByLabelText(/^Description/) as HTMLTextAreaElement).maxLength).toBe(2000)
  expect(within(dialog).getByLabelText('0 of 2,000 characters')).toBeTruthy()

  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Welcome' }))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await screen.findByText(/^Step 2 of 2/)
  await user.click(within(dialog).getByRole('radio', { name: /^Continuously Qualifying/ }))
  await user.click(within(dialog).getByRole('radio', { name: /^After X Days/ }))
  const days = within(dialog).getByLabelText('Cooldown Days')
  await user.type(days, '4000')
  expect(within(dialog).getByText('A whole number from 1 to 3,650.')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Create Journey' }) as HTMLButtonElement).disabled).toBe(true)
  await user.clear(days)
  await user.type(days, '90')
  expect(within(dialog).queryByText('A whole number from 1 to 3,650.')).toBeNull()
  expect((within(dialog).getByRole('button', { name: 'Create Journey' }) as HTMLButtonElement).disabled).toBe(false)
})

test('Customer Attribute Matches takes a rule, Only Customers Where narrows any trigger, and both are saved into the entry rule', async () => {
  const calls = installMockApi()
  const { user, dialog } = await openSetup()

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'New Customer Welcome')
  await user.click(within(dialog).getByRole('radio', { name: 'Segment or Customer Change' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select a Change Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Customer Attribute Matches' }))
  const next = within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(next.disabled).toBe(true) // the rule is still empty

  const matches = within(dialog.querySelector('[data-attribute-match]') as HTMLElement)
  await user.click(matches.getByRole('button', { name: 'Add Condition' }))
  await user.click(matches.getByRole('button', { name: 'Field' }))
  await user.click(screen.getByRole('button', { name: /Customer Status/ }))
  await user.selectOptions(matches.getByLabelText('Operator'), 'is')
  await user.type(matches.getByLabelText('Value'), 'New')
  expect(matches.getByText('Customers enter when their Customer Status is “New”.')).toBeTruthy()
  expect(next.disabled).toBe(false)

  const filters = within(dialog.querySelector('[data-entry-filters]') as HTMLElement)
  await user.click(filters.getByRole('button', { name: 'Add Condition' }))
  expect(next.disabled).toBe(true) // an unfinished filter row holds Next
  await user.click(filters.getByRole('button', { name: 'Field' }))
  await user.click(screen.getByRole('button', { name: 'Country' }))
  await user.selectOptions(filters.getByLabelText('Operator'), 'is')
  await user.type(filters.getByLabelText('Value'), 'United States')
  expect(filters.getByText('Only customers where their country is “United States”.')).toBeTruthy()
  expect(await within(dialog).findByText('218 of 20,100 customers would enter now.', {}, { timeout: 3000 })).toBeTruthy()
  expect(next.disabled).toBe(false)

  await user.click(next)
  await user.click(within(dialog).getByRole('radio', { name: /^Continuously Qualifying/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create Journey' }))
  await screen.findByRole('heading', { name: 'Journey Settings' })
  const save = calls.find((call) => call.method === 'PUT' && /\/journeys\/.+\/versions\/1\/graph\/$/.test(call.url))
  expect(save?.body?.graph).toMatchObject({ entry_rules: [{ entry_type: 'SEGMENT_CHANGE', rule_definition: {
    change_trigger: 'ATTRIBUTE_MATCH',
    rule: { all: true, conditions: [{ field: 'attr:customer_status', op: 'is', value: 'New' }] },
    filters: { all: true, conditions: [{ field: 'customer:country', op: 'is', value: 'United States' }] },
  } }] })
  expect(screen.getAllByText(/Customer Attribute Matches/).length).toBeGreaterThan(0)
})
