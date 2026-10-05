/**
 * Edit Setup (Build's sidebar and Back to Setup) reopens the Setup pop-up filled from the journey; saving a draft
 * PATCHes the journey and PUTs only the entry rule, keeping the canvas's steps (saved or not); a published journey
 * saves onto a new draft version. Setup's Segment picker is required for Enters / Exits Segment, including when a
 * starter (Win-Back) pre-fills it. Lists and segments show by name, never by id.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { JourneyGraph } from '@/lib/types'
import { installMockApi, journeyStarters, makeJourney, makeJourneyStarter, makeJourneyVersion, signIn } from '@/test/mockApi'

// @xyflow/react needs both in jsdom (see JourneyBuild.test.tsx): the zoom matrix, and a ResizeObserver that reports a size
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.stubGlobal('DOMMatrixReadOnly', class {
    m22 = 1
    constructor(_transform?: string) {
      void _transform
    }
  })
  vi.stubGlobal('ResizeObserver', class {
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
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const listGraph: JourneyGraph = {
  entry_rules: [{ entry_type: 'CUSTOMER_LIST', rule_definition: { contact_list_id: 'cl-master' } }],
  nodes: [
    { key: 'start', type: 'START', config: {}, position: { x: 0, y: 0 } },
    { key: 'wait-1', type: 'WAIT', config: { duration: 2, unit: 'DAYS' }, position: { x: 0, y: 150 } },
    { key: 'email-1', type: 'EMAIL', config: { label: 'Hello' }, position: { x: 0, y: 300 } },
    { key: 'exit-1', type: 'EXIT', config: {}, position: { x: 0, y: 450 } },
  ],
  connections: [
    { from: 'start', to: 'wait-1', branch_key: null, label: null },
    { from: 'wait-1', to: 'email-1', branch_key: null, label: null },
    { from: 'email-1', to: 'exit-1', branch_key: null, label: null },
  ],
}

async function openEditSetup() {
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas')
  await user.click(screen.getByRole('button', { name: 'Edit Setup' }))
  return { user, dialog: await screen.findByRole('dialog', { name: /Edit Setup/ }) }
}

test('Edit Setup opens the Setup pop-up pre-filled from the journey', async () => {
  installMockApi({ journey: makeJourney({ population_mode: 'CONTINUOUSLY_QUALIFYING', reentry_policy: 'AFTER_X_DAYS', reentry_after_days: 30 }), journeyGraph: listGraph })
  const { user, dialog } = await openEditSetup()

  expect(within(dialog).queryByText('From Template')).toBeNull()
  expect((within(dialog).getByLabelText(/Journey Name/) as HTMLInputElement).value).toBe('New Loyalty Member Welcome')
  expect(within(dialog).getByRole('radio', { name: 'Customer List' }).getAttribute('aria-checked')).toBe('true')
  expect(within(dialog).getByRole('button', { name: 'Fall Master Audience' })).toBeTruthy()

  await user.click(within(dialog).getByRole('button', { name: /Next/ }))
  expect(within(dialog).getByRole('radio', { name: /^Continuously Qualifying/ }).getAttribute('aria-checked')).toBe('true')
  expect(within(dialog).getByRole('radio', { name: /^After X Days/ }).getAttribute('aria-checked')).toBe('true')
  expect((within(dialog).getByLabelText('Cooldown Days') as HTMLInputElement).value).toBe('30')
  expect(within(dialog).getByRole('button', { name: 'Save Setup' })).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: 'Create Journey' })).toBeNull()
})

test('Back to Setup opens the same pop-up', async () => {
  installMockApi({ journey: makeJourney(), journeyGraph: listGraph })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas')
  await user.click(screen.getByRole('button', { name: /Back to Setup/ }))
  expect(await screen.findByRole('dialog', { name: /Edit Setup/ })).toBeTruthy()
})

test('saving a draft PATCHes the journey and PUTs only the entry rule, keeping the canvas steps', async () => {
  const calls = installMockApi({ journey: makeJourney(), journeyGraph: listGraph })
  const { user, dialog } = await openEditSetup()

  const name = within(dialog).getByLabelText(/Journey Name/)
  await user.clear(name)
  await user.type(name, 'Gold Welcome')
  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Purchase' }))
  await user.click(within(dialog).getByRole('button', { name: /Next/ }))
  await user.click(within(dialog).getByRole('radio', { name: /^Event Triggered/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Save Setup' }))

  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit Setup/ })).toBeNull())
  const patch = calls.find((call) => call.method === 'PATCH' && call.url.endsWith('/journeys/j1/'))
  expect(patch?.body).toEqual({ name: 'Gold Welcome', description: null, population_mode: 'EVENT_TRIGGERED', reentry_policy: 'NEVER', reentry_after_days: null })
  const put = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/journeys/j1/versions/1/graph/'))
  const graph = put?.body?.graph as JourneyGraph
  expect(put?.body?.row_version).toBe(1)
  expect(graph.entry_rules).toEqual([{ entry_type: 'EVENT', rule_definition: { event_type: 'PURCHASE' } }])
  expect(graph.nodes.map((node) => node.key)).toEqual(['start', 'wait-1', 'email-1', 'exit-1'])
  expect(calls.some((call) => call.method === 'POST' && call.url.includes('/versions/'))).toBe(false)

  // the sidebar and the Entry card follow
  const sidebar = screen.getByRole('complementary', { name: 'Journey Settings' })
  expect(within(sidebar).getByText('Event · Purchase')).toBeTruthy()
  expect(within(sidebar).getByText('Event Triggered')).toBeTruthy()
})

test('canvas changes not yet saved go along with the new setup', async () => {
  const calls = installMockApi({ journey: makeJourney(), journeyGraph: listGraph })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Wait' }))
  await user.click(screen.getByRole('button', { name: 'Edit Setup' }))
  const dialog = await screen.findByRole('dialog', { name: /Edit Setup/ })
  await user.click(within(dialog).getByRole('button', { name: /Next/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Save Setup' }))

  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/graph/'))).toBe(true))
  const graph = calls.find((call) => call.method === 'PUT')?.body?.graph as JourneyGraph
  expect(graph.nodes.filter((node) => node.type === 'WAIT')).toHaveLength(2)
  expect(graph.entry_rules).toEqual([{ entry_type: 'CUSTOMER_LIST', rule_definition: { contact_list_id: 'cl-master' } }])
})

test('a stale save reports that someone else saved the journey', async () => {
  installMockApi({ journey: makeJourney(), journeyGraph: listGraph, journeySaveConflicts: true })
  const { user, dialog } = await openEditSetup()
  await user.click(within(dialog).getByRole('button', { name: /Next/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Save Setup' }))
  expect(await screen.findByText('Someone else saved this journey')).toBeTruthy()
  expect(screen.getByRole('dialog', { name: /Edit Setup/ })).toBeTruthy()
})

test('editing a published journey says so and saves onto a new draft version', async () => {
  const calls = installMockApi({
    journey: makeJourney({ status: 'ACTIVE' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', status_label: 'Active' })],
    journeyGraph: listGraph,
  })
  const { user, dialog } = await openEditSetup()

  expect(within(dialog).getByText('This journey is published, so saving starts a new draft version and customers already in it stay on theirs.')).toBeTruthy()
  await user.click(within(dialog).getByRole('radio', { name: 'Event' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select an Event Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Welcome' }))
  await user.click(within(dialog).getByRole('button', { name: /Next/ }))
  expect((within(dialog).getByRole('radio', { name: /^Event Triggered/ }) as HTMLInputElement).disabled).toBe(true)
  await user.click(within(dialog).getByRole('button', { name: 'Save Setup' }))

  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.endsWith('/journeys/j1/versions/2/graph/'))).toBe(true))
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/versions/'))?.body).toEqual({ from_version: 1 })
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ name: 'New Loyalty Member Welcome', description: null })
  const graph = calls.find((call) => call.method === 'PUT')?.body?.graph as JourneyGraph
  expect(graph.entry_rules).toEqual([{ entry_type: 'EVENT', rule_definition: { event_type: 'WELCOME' } }])
  expect(graph.nodes.map((node) => node.key)).toEqual(['start', 'wait-1', 'email-1', 'exit-1'])
  expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/versions/1/graph/'))).toBe(false)
})

test('Enters Segment needs a Segment, saved into the rule', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })
  await user.click(screen.getByRole('button', { name: /Create Journey/ }))
  const dialog = await screen.findByRole('dialog', { name: /^Create Journey$/ })

  await user.type(within(dialog).getByLabelText(/^Journey Name/), 'Lapsed Win-Back')
  await user.click(within(dialog).getByRole('radio', { name: 'Segment or Customer Change' }))
  await user.click(within(dialog).getByRole('button', { name: 'Select a Change Trigger' }))
  await user.click(screen.getByRole('button', { name: 'Enters Segment' }))
  const next = within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(next.disabled).toBe(true)

  await user.click(within(dialog).getByRole('button', { name: 'Select a Segment' }))
  await user.click(await screen.findByRole('button', { name: 'No purchase in 90 days' }))
  expect(next.disabled).toBe(false)

  // the Attribute Change options need no segment
  await user.click(within(dialog).getByRole('button', { name: 'Enters Segment' }))
  await user.click(screen.getByRole('button', { name: 'Preference Update' }))
  expect(within(dialog).queryByRole('button', { name: /Select a Segment|No purchase/ })).toBeNull()
  expect(next.disabled).toBe(false)

  await user.click(within(dialog).getByRole('button', { name: 'Preference Update' }))
  await user.click(screen.getByRole('button', { name: 'Exits Segment' }))
  expect(next.disabled).toBe(true)
  await user.click(within(dialog).getByRole('button', { name: 'Select a Segment' }))
  await user.click(await screen.findByRole('button', { name: 'No purchase in 90 days' }))
  await user.click(next)
  await user.click(within(dialog).getByRole('radio', { name: /^Continuously Qualifying/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Create Journey' }))

  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/graph/'))).toBe(true))
  const graph = calls.find((call) => call.method === 'PUT')?.body?.graph as JourneyGraph
  expect(graph.entry_rules).toEqual([{ entry_type: 'SEGMENT_CHANGE', rule_definition: { change: 'LEFT', segment_id: 'aud-lapsed', segment_name: 'No purchase in 90 days' } }])
})

test('the Win-Back starter pre-fills Setup with its segment still to choose', async () => {
  const winBack = makeJourneyStarter({
    key: 'win-back-lapsed', name: 'Win-Back Lapsed Customers', category: 'ENGAGEMENT', description: 'Bring lapsed customers back.', goal: 'Purchase within 30 days',
    graph: { ...listGraph, entry_rules: [{ entry_type: 'SEGMENT_CHANGE', rule_definition: { change: 'JOINED', setup_note: 'Choose your Lapsed segment' } }] },
    step_count: 3, channels: ['EMAIL'],
  })
  const calls = installMockApi({ journeyStarters: [winBack, ...journeyStarters] })
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  await user.click(await screen.findByRole('button', { name: 'Win-Back Lapsed Customers, CEP Starter' }))
  const preview = await screen.findByRole('dialog', { name: 'Win-Back Lapsed Customers' })
  expect((await within(preview).findAllByText('Choose your Lapsed segment')).length).toBeGreaterThan(0)
  await user.click(within(preview).getByRole('button', { name: 'Use This Template' }))

  const setup = await screen.findByRole('dialog', { name: /^Create Journey$/ })
  expect(within(setup).getByRole('button', { name: 'Enters Segment' })).toBeTruthy()
  expect(within(setup).getByRole('button', { name: 'Select a Segment' })).toBeTruthy()
  expect(within(setup).getByText('Choose your Lapsed segment')).toBeTruthy()
  const next = within(setup).getByRole('button', { name: /Next/ }) as HTMLButtonElement
  expect(next.disabled).toBe(true)

  await user.click(within(setup).getByRole('button', { name: 'Select a Segment' }))
  await user.click(await screen.findByRole('button', { name: 'No purchase in 90 days' }))
  expect(next.disabled).toBe(false)
  await user.click(next)
  await user.click(within(setup).getByRole('button', { name: 'Create Journey' }))

  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/graph/'))).toBe(true))
  const graph = calls.find((call) => call.method === 'PUT')?.body?.graph as JourneyGraph
  expect(graph.entry_rules).toEqual([{ entry_type: 'SEGMENT_CHANGE', rule_definition: { change: 'JOINED', segment_id: 'aud-lapsed', segment_name: 'No purchase in 90 days' } }])
})

test('the sidebar and the Entry card name the list, never its id', async () => {
  installMockApi({ journey: makeJourney(), journeyGraph: listGraph })
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')
  const sidebar = screen.getByRole('complementary', { name: 'Journey Settings' })
  expect(within(sidebar).getByText('Customer List · Fall Master Audience')).toBeTruthy()
  expect(within(canvas).getByText('Customer List · Fall Master Audience')).toBeTruthy()
  expect(document.body.textContent).not.toContain('cl-master')
})

test('a deleted list or segment shows as unknown, never its id', async () => {
  installMockApi({
    journey: makeJourney(),
    journeyGraph: { ...listGraph, entry_rules: [{ entry_type: 'CUSTOMER_LIST', rule_definition: { contact_list_id: 'cl-gone' } }, { entry_type: 'SEGMENT_CHANGE', rule_definition: { change: 'JOINED', segment_id: 'seg-gone' } }] },
  })
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas')
  const sidebar = screen.getByRole('complementary', { name: 'Journey Settings' })
  expect(within(sidebar).getByText('Customer List · Unknown list')).toBeTruthy()
  expect(within(sidebar).getByText('Segment or Customer Change · Enters Unknown segment')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/cl-gone|seg-gone/)
})
