/**
 * Journey Templates: the blue panel and its View More pop-up, the read-only preview of a starter, Use This Template
 * through the pre-filled Setup pop-up to Build, the canvas's "From" line and setup banner, Save as Template being gone
 * from the canvas and Journey Details, and what a viewer without journey.edit sees.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { abandonedCartGraph, installMockApi, makeJourney, makeJourneyVersion, makeSavedTemplate, me, signIn } from '@/test/mockApi'

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
  vi.restoreAllMocks()
})

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

test('the Journey Templates panel offers Start from Scratch and the first four starters', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  const panel = await screen.findByRole('region', { name: 'Journey Templates' })
  expect(within(panel).getByText('Start a journey from a blank canvas, a C360 starter or a template saved from one of your journeys. A template is copied into a new draft; the original never changes.')).toBeTruthy()
  const row = within(panel).getByRole('list', { name: 'Start a Journey' })
  await vi.waitFor(() => expect(within(row).getAllByRole('listitem')).toHaveLength(5))
  expect(within(row).getByRole('button', { name: /Start from Scratch/ })).toBeTruthy()
  expect(within(row).getByRole('button', { name: 'Abandoned Cart Recovery, C360 Starter' })).toBeTruthy()
  expect(within(row).getByText('When a shopper leaves items in their cart')).toBeTruthy()
  expect(within(row).queryByRole('button', { name: /Loyalty Tier Upgrade/ })).toBeNull()        // the fifth starter waits for View More

  await user.click(within(row).getByRole('button', { name: /Start from Scratch/ }))
  const setup = await screen.findByRole('dialog', { name: /^Create Journey$/ })
  expect((within(setup).getByLabelText(/Journey Name/) as HTMLInputElement).value).toBe('')
  expect(within(setup).queryByText('From Template')).toBeNull()
})

test('View More lists every starter by category, with search', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  await user.click(await screen.findByRole('button', { name: /View More/ }))
  const gallery = await screen.findByRole('dialog', { name: 'Starter Templates' })
  const categories = within(gallery).getByRole('navigation', { name: 'Category' })
  await within(gallery).findByRole('heading', { name: 'All · 6' })
  expect(within(gallery).getAllByText('C360 Starter')).toHaveLength(7)                         // the header's and each card's
  expect(within(categories).getByRole('button', { name: /Commerce\s*2/ })).toBeTruthy()

  await user.click(within(categories).getByRole('button', { name: /Lifecycle/ }))
  expect(within(gallery).getByRole('heading', { name: 'Lifecycle · 2' })).toBeTruthy()
  expect(within(gallery).getByRole('button', { name: 'Welcome Series, C360 Starter' })).toBeTruthy()
  expect(within(gallery).queryByRole('button', { name: 'Abandoned Cart Recovery, C360 Starter' })).toBeNull()

  await user.type(within(gallery).getByPlaceholderText('Search Starter Templates'), 'first')
  expect(within(gallery).getByRole('heading', { name: 'Lifecycle · 1' })).toBeTruthy()
  expect(within(gallery).getByRole('button', { name: 'First to Second Purchase, C360 Starter' })).toBeTruthy()
  expect(within(gallery).getAllByText('Made by C360 · Never changes')).toHaveLength(1)

  await user.type(within(gallery).getByPlaceholderText('Search Starter Templates'), 'zzz')
  expect(within(gallery).getByText('No matching starters')).toBeTruthy()
})

test("a starter's preview lists the steps that need setup", async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  await user.click(await screen.findByRole('button', { name: 'Abandoned Cart Recovery, C360 Starter' }))
  const preview = await screen.findByRole('dialog', { name: 'Abandoned Cart Recovery' })
  expect(within(preview).getByText('C360 Starter')).toBeTruthy()
  expect(within(preview).getByText('Read-only preview. Nothing is copied yet.')).toBeTruthy()
  expect(within(preview).queryByText('What Starts It')).toBeNull()
  expect(within(preview).getByText('Order placed within 3 days')).toBeTruthy()
  expect(within(preview).getByText('Re-entry: After 7 days')).toBeTruthy()
  expect(within(preview).getByText('8 steps after the entry trigger')).toBeTruthy()
  expect(within(preview).getByText('3 steps need setup')).toBeTruthy()
  const list = within(preview).getByRole('list', { name: 'Steps That Need Setup' })
  expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Cart reminderSend Email', 'Issue CouponIssue Coupon', 'SMS with codeSend SMS'])

  // the flow: the canvas's own cards, read-only, with Needs Setup on the empty ones
  const flow = await within(preview).findByTestId('journey-flow-preview', {}, { timeout: 10_000 })   // the canvas chunk loads lazily
  await vi.waitFor(() => expect(within(flow).getAllByText('Needs Setup')).toHaveLength(3))
  expect(within(flow).queryByRole('button', { name: 'Add a Step' })).toBeNull()
  expect(within(flow).queryByRole('button', { name: /Actions for/ })).toBeNull()
  expect(within(flow).getByText('When a shopper leaves items in their cart')).toBeTruthy()

  expect(within(preview).getByRole('button', { name: 'Use This Template' })).toBeTruthy()
})

test('Use This Template pre-fills Setup, creates from the starter, keeps its steps and opens Build', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  await user.click(await screen.findByRole('button', { name: 'Abandoned Cart Recovery, C360 Starter' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Abandoned Cart Recovery' })).getByRole('button', { name: 'Use This Template' }))

  const setup = await screen.findByRole('dialog', { name: /^Create Journey$/ })
  expect(within(setup).getByText('From Template')).toBeTruthy()
  expect(within(setup).getByText('Abandoned Cart Recovery · Pre-filled. Change anything before you build.')).toBeTruthy()
  expect((within(setup).getByLabelText(/Journey Name/) as HTMLInputElement).value).toBe('Abandoned Cart Recovery (copy)')
  expect(within(setup).getByRole('radio', { name: 'Event' }).getAttribute('aria-checked')).toBe('true')
  expect(within(setup).getByText('Abandoned Cart')).toBeTruthy()
  await user.click(within(setup).getByRole('button', { name: /Next/ }))
  expect(within(setup).getByRole('radio', { name: /Event Triggered/ }).getAttribute('aria-checked')).toBe('true')
  expect(within(setup).getByRole('radio', { name: /After X Days/ }).getAttribute('aria-checked')).toBe('true')
  expect((within(setup).getByLabelText('Cooldown Days') as HTMLInputElement).value).toBe('7')
  await user.click(within(setup).getByRole('button', { name: 'Create Journey' }))

  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/journeys/j-new/versions/1/graph/'))).toBe(true))
  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/journeys/'))
  expect(post?.body).toMatchObject({ name: 'Abandoned Cart Recovery (copy)', starter: 'abandoned-cart-recovery', population_mode: 'EVENT_TRIGGERED', reentry_policy: 'AFTER_X_DAYS', reentry_after_days: 7 })
  expect(post?.body).not.toHaveProperty('template')
  const put = calls.find((call) => call.method === 'PUT')
  const graph = put?.body?.graph as typeof abandonedCartGraph
  expect(graph.nodes.map((node) => node.key)).toEqual(abandonedCartGraph.nodes.map((node) => node.key))
  expect(graph.entry_rules).toEqual([{ entry_type: 'EVENT', rule_definition: { event_type: 'CART_ABANDON' } }])

  // Build: the banner naming the steps that still need content
  const banner = await screen.findByText(/steps need your content before you can test publish/, {}, { timeout: 10_000 })
  expect(banner.textContent).toBe('Created from Abandoned Cart Recovery. 3 steps need your content before you can test publish: Cart reminder, Issue Coupon, SMS with code. Select a step to set it up.')
})

test('the canvas banner goes away when dismissed, and stays away for the session', async () => {
  installMockApi({ journey: makeJourney({ source_name: 'Abandoned Cart Recovery', source_starter_key: 'abandoned-cart-recovery' }), journeyGraph: abandonedCartGraph })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')

  const canvas = await screen.findByTestId('journey-canvas', {}, { timeout: 10_000 })
  await vi.waitFor(() => expect(within(canvas).getAllByText('Needs Setup')).toHaveLength(3))
  // the top bar shows just the journey's name: no "Journey · Draft · From …" subheading
  expect(screen.queryByText(/Journey · Draft/)).toBeNull()
  await screen.findByText(/need your content/)
  await user.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByText(/need your content/)).toBeNull()

  cleanup()
  installMockApi({ journey: makeJourney({ source_name: 'Abandoned Cart Recovery' }), journeyGraph: abandonedCartGraph })
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas', {}, { timeout: 10_000 })
  expect(screen.queryByText(/need your content/)).toBeNull()
})

test('without journey.edit the starters can be looked at but not used', async () => {
  installMockApi({
    me: { principal: { ...me.principal, permissions: me.principal.permissions.filter((code) => code !== 'journey.edit') } } as never,
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  const panel = await screen.findByRole('region', { name: 'Journey Templates' })
  await within(panel).findByRole('button', { name: 'Abandoned Cart Recovery, C360 Starter' })
  expect(within(panel).queryByRole('button', { name: /Start from Scratch/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Create Journey/ })).toBeNull()

  await user.click(within(panel).getByRole('button', { name: 'Abandoned Cart Recovery, C360 Starter' }))
  const preview = await screen.findByRole('dialog', { name: 'Abandoned Cart Recovery' })
  expect(within(preview).queryByRole('button', { name: 'Use This Template' })).toBeNull()
  expect(within(preview).getAllByRole('button', { name: 'Close' })).toHaveLength(2)          // the header's × and the footer's
})

test('the Build canvas has no Save as Template; the journey page does, and it snapshots the live version under a name and category', async () => {
  const calls = installMockApi({ journey: makeJourney({ id: 'j1', status: 'ACTIVE', current_version: 'v1' }), journeyVersions: [makeJourneyVersion({ id: 'v1', status: 'ACTIVE', published_at: '2026-08-27T09:00:00Z' })] })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas', {}, { timeout: 10_000 })
  expect(screen.queryByText('Save as Template')).toBeNull()

  await renderAppAt('/journeys/j1')
  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })
  await user.click(screen.getByRole('button', { name: 'Save as Template' }))
  const dialog = await screen.findByRole('dialog', { name: 'Save as Template' })
  expect(within(dialog).getByText(/Version 1 of/)).toBeTruthy()
  const name = within(dialog).getByLabelText(/Template Name/) as HTMLInputElement
  expect(name.value).toBe('New Loyalty Member Welcome')
  await user.clear(name)
  await user.type(name, 'Our Welcome')
  await user.selectOptions(within(dialog).getByLabelText(/Category/), 'LOYALTY')
  await user.type(within(dialog).getByLabelText(/Description/), 'Welcome as we run it.')
  await user.click(within(dialog).getByRole('button', { name: 'Save Template' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save as Template' })).toBeNull())
  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/journey-templates/'))
  expect(post?.body).toEqual({ journey_id: 'j1', version_number: 1, name: 'Our Welcome', category: 'LOYALTY', description: 'Welcome as we run it.' })
  expect(await screen.findByText(/is saved as a template/)).toBeTruthy()
})

test('a saved template sits under Your Templates on the panel and in the gallery; Use This Template creates from it, and it can be deleted', async () => {
  const calls = installMockApi({ savedTemplates: [makeSavedTemplate()] })
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  const panel = await screen.findByRole('region', { name: 'Journey Templates' })
  const yours = await within(panel).findByRole('list', { name: /Your Templates/ })
  await user.click(within(yours).getByRole('button', { name: 'Our Cart Reminder, Saved Template' }))
  const preview = await screen.findByRole('dialog', { name: 'Our Cart Reminder' })
  expect(within(preview).getByText('Saved Template')).toBeTruthy()
  expect(within(preview).getByText(/by Aby John/)).toBeTruthy()
  expect(within(preview).getByText('2 journeys made from it')).toBeTruthy()
  await user.click(within(preview).getByRole('button', { name: 'Use This Template' }))
  const setup = await screen.findByRole('dialog', { name: /^Create Journey$/ })
  expect((within(setup).getByLabelText(/Journey Name/) as HTMLInputElement).value).toBe('Our Cart Reminder (copy)')
  await user.click(within(setup).getByRole('button', { name: /Next/ }))
  await user.click(within(setup).getByRole('button', { name: 'Create Journey' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/journeys/j-new/versions/1/graph/'))).toBe(true))
  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/journeys/'))
  expect(post?.body).toMatchObject({ name: 'Our Cart Reminder (copy)', template: 'jt-1' })
  expect(post?.body).not.toHaveProperty('starter')
  expect(await screen.findByText(/Created from Our Cart Reminder/)).toBeTruthy()

  await renderAppAt('/journeys')
  await user.click(await screen.findByRole('button', { name: 'View More' }))
  const gallery = await screen.findByRole('dialog', { name: 'Starter Templates' })
  await user.click(within(gallery).getByRole('button', { name: /^Your Templates/ }))
  expect(within(gallery).getByRole('heading', { name: 'Your Templates · 1' })).toBeTruthy()
  await user.click(within(gallery).getByRole('button', { name: 'Our Cart Reminder, Saved Template' }))
  const again = await screen.findByRole('dialog', { name: 'Our Cart Reminder' })
  await user.click(within(again).getByRole('button', { name: 'Delete Template' }))
  expect(within(again).getByText(/Delete this template\?/)).toBeTruthy()
  await user.click(within(again).getByRole('button', { name: 'Delete Template' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/journey-templates/jt-1/'))).toBe(true))
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Our Cart Reminder' })).toBeNull())
})
