/**
 * Journey Setup (phase 6e): Step 1 name + entry trigger gates Next; each entry pill shows its own grouped
 * trigger dropdown; Step 2's population/re-entry cards gate "Continue to Build"; Continue to Build really
 * creates the journey (POST /journeys/), saves the entry rule onto its blank version 1
 * (PUT /journeys/{id}/versions/1/graph/), and navigates to the Build canvas.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

async function openSetup() {
  const user = userEvent.setup()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })
  await user.click(screen.getByRole('button', { name: /Create Journey/ }))
  return { user, dialog: await screen.findByRole('dialog', { name: /Create A Journey/ }) }
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

  const next = within(dialog).getByRole('button', { name: 'Next →' }) as HTMLButtonElement
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

test('Continue to Build stays disabled until population and re-entry are chosen', async () => {
  installMockApi()
  const { user, dialog } = await openSetup()

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Welcome Series')
  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Welcome' }))
  await user.click(within(dialog).getByRole('button', { name: 'Next →' }))

  await screen.findByText('Step 2 of 2')
  const build = within(dialog).getByRole('button', { name: 'Continue to Build' }) as HTMLButtonElement
  expect(build.disabled).toBe(true)                                     // re-entry defaults to Never, but population is unset

  await user.click(within(dialog).getByRole('radio', { name: /^Fixed/ }))
  expect(build.disabled).toBe(false)

  await user.click(within(dialog).getByRole('radio', { name: /^After X Days/ }))
  expect(build.disabled).toBe(true)                                     // needs a cooldown number now

  await user.type(within(dialog).getByLabelText('Cooldown Days'), '90')
  expect(build.disabled).toBe(false)
})

test('Continue to Build creates the journey, saves its entry rule, and opens the Build canvas', async () => {
  const calls = installMockApi()
  const { user, dialog } = await openSetup()

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Welcome Series — New Loyalty Members')
  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Welcome' }))
  await user.click(within(dialog).getByRole('button', { name: 'Next →' }))

  await screen.findByText('Step 2 of 2')
  await user.click(within(dialog).getByRole('radio', { name: /^Continuously Qualifying/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Continue to Build' }))

  await screen.findByRole('heading', { name: 'Journey Settings' })

  const create = calls.find((call) => call.method === 'POST' && call.url.endsWith('/journeys/'))
  expect(create?.body).toMatchObject({ name: 'Welcome Series — New Loyalty Members', population_mode: 'CONTINUOUSLY_QUALIFYING', reentry_policy: 'NEVER' })

  const save = calls.find((call) => call.method === 'PUT' && /\/journeys\/.+\/versions\/1\/graph\/$/.test(call.url))
  expect(save?.body?.graph).toMatchObject({ entry_rules: [{ entry_type: 'EVENT', rule_definition: { event_type: 'WELCOME' } }] })
})
