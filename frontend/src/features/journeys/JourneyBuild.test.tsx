/**
 * The Build canvas: the node chain renders with a fixed, non-interactive Entry step, a step can be added through
 * the "+" picker, a Condition opens exactly two branches (and can't be nested inside one), and Save Draft either
 * succeeds or reports the backend's 409 ("someone else saved this") conflict without overwriting it.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeJourney, makeJourneyVersion, signIn } from '@/test/mockApi'

// jsdom has neither: @xyflow/react's pane reads the current zoom out of a DOMMatrixReadOnly on every pointer
// event (even with panning turned off), and keeps a node hidden until its own ResizeObserver reports a size for
// it — firing the callback at once with a plausible card size is what makes nodes (and their buttons) appear.
beforeEach(() => {
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
})

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const putGraphCalls = (calls: { method: string; url: string; body: unknown }[]) => calls.filter((call) => call.method === 'PUT' && call.url.includes('/graph/'))

test('the node chain renders with a fixed, non-interactive Entry step', async () => {
  installMockApi({ journey: makeJourney() })
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')
  expect(within(canvas).getByText('Entry')).toBeTruthy()
  // Entry is plain text, not a button or any other interactive role
  expect(within(canvas).queryByRole('button', { name: /entry/i })).toBeNull()
})

test('adding a step through the "+" picker', async () => {
  installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  expect(await screen.findByRole('dialog', { name: 'Add a step' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Wait' }))

  expect(await within(canvas).findByText('No duration set')).toBeTruthy()
  expect(within(canvas).getByRole('button', { name: /wait step/i })).toBeTruthy()
})

test('a Condition opens exactly two branches, and cannot be nested inside one', async () => {
  installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Condition / Split' }))
  expect(await within(canvas).findByRole('button', { name: /condition step/i })).toBeTruthy()

  // a Condition opens exactly two branches: the single root "+" becomes four (before the Condition, one per
  // branch, and after it), none of which nest another Condition
  const addButtons = await vi.waitFor(() => {
    const buttons = within(canvas).getAllByRole('button', { name: 'Add a Step' })
    expect(buttons).toHaveLength(4)
    return buttons
  })
  await user.click(addButtons[1])
  await screen.findByRole('dialog', { name: 'Add a step' })
  const nestedCondition = screen.getByRole('button', { name: 'Condition / Split' }) as HTMLButtonElement
  expect(nestedCondition.disabled).toBe(true)
})

test("a step's ⋮ menu duplicates it right after itself, and deletes it", async () => {
  installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Wait' }))
  await within(canvas).findByRole('button', { name: /wait step/i })

  await user.click(within(canvas).getByRole('button', { name: 'Actions for Wait' }))
  await user.click(screen.getByRole('button', { name: 'Duplicate' }))
  await vi.waitFor(() => expect(within(canvas).getAllByRole('button', { name: /wait step/i })).toHaveLength(2))

  await user.click(within(canvas).getAllByRole('button', { name: 'Actions for Wait' })[0])
  await user.click(screen.getByRole('button', { name: 'Delete Step' }))
  await vi.waitFor(() => expect(within(canvas).getAllByRole('button', { name: /wait step/i })).toHaveLength(1))
})

test("the step panel's own Delete Step removes the step and closes the panel", async () => {
  installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Wait' }))
  // adding a step opens its panel straight away
  const panel = await screen.findByRole('dialog', { name: 'No duration set' })
  await user.click(within(panel).getByRole('button', { name: 'Delete Step' }))

  await vi.waitFor(() => expect(within(canvas).queryByRole('button', { name: /wait step/i })).toBeNull())
  expect(screen.queryByRole('dialog', { name: 'No duration set' })).toBeNull()
})

test('the top bar links back to the Journeys list', async () => {
  installMockApi({ journey: makeJourney() })
  await renderAppAt('/journeys/j1/build')
  const back = await screen.findByRole('link', { name: 'Back to Journeys' })
  expect(back.getAttribute('href')).toBe('/journeys')
})

test('Save Draft succeeds and shows a confirmation', async () => {
  const calls = installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas')

  await user.click(screen.getByRole('button', { name: 'Save Draft' }))
  await vi.waitFor(() => expect(putGraphCalls(calls)).toHaveLength(1))
  expect(putGraphCalls(calls)[0].body).toMatchObject({ row_version: 1 })
  expect(await screen.findByText('Draft saved')).toBeTruthy()
})

test('Save Draft on a stale version reports the conflict instead of overwriting it', async () => {
  installMockApi({ journey: makeJourney(), journeySaveConflicts: true })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas')

  await user.click(screen.getByRole('button', { name: 'Save Draft' }))
  const toast = await screen.findByRole('alert')
  expect(within(toast).getByText('Someone else saved this journey')).toBeTruthy()
  expect(within(toast).getByText(/Reload to see their changes/)).toBeTruthy()
})

test('editing a live version: the builder says so, and Save Draft saves the changes as version 2', async () => {
  const calls = installMockApi({ journey: makeJourney({ status: 'ACTIVE', current_version: 'jv1' }), journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', status_label: 'Active' })] })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas')
  expect(screen.getByText(/Saving makes your changes a new version; this one keeps running until you test publish and approve it\./)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Save Draft' }))
  await vi.waitFor(() => expect(putGraphCalls(calls).map((call) => call.url)).toEqual([expect.stringMatching(/\/journeys\/j1\/versions\/2\/graph\/$/)]))
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/versions/'))?.body).toEqual({ from_version: 1 })
  expect(await screen.findByText('Saved as version 2')).toBeTruthy()
})

test('a Wait longer than 999 is refused in the step panel before it reaches the server', async () => {
  installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Wait' }))
  const panel = await screen.findByRole('dialog', { name: 'No duration set' })
  const duration = within(panel).getByLabelText(/^Duration/)
  await user.type(duration, '1000')
  expect(within(panel).getByText('A whole number from 0 to 999.')).toBeTruthy()
  expect((within(panel).getByRole('button', { name: 'Save Step' }) as HTMLButtonElement).disabled).toBe(true)
  await user.clear(duration)
  await user.type(duration, '30')
  expect((within(panel).getByRole('button', { name: 'Save Step' }) as HTMLButtonElement).disabled).toBe(false)
})

test('a Condition is written with the builder: field, comparison and value, read back, counted, and saved as a rule', async () => {
  const calls = installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Condition / Split' }))
  const panel = await screen.findByRole('dialog', { name: 'No condition set' })
  const save = within(panel).getByRole('button', { name: 'Save Step' }) as HTMLButtonElement
  expect(save.disabled).toBe(false) // an empty rule saves as a step still to set up

  await user.click(within(panel).getByRole('button', { name: 'Add Condition' }))
  expect(save.disabled).toBe(true) // a half-written row does not
  await user.click(within(panel).getByRole('button', { name: 'Field' }))
  await user.type(screen.getByLabelText('Search Fields'), 'loyal')
  await user.click(screen.getByRole('button', { name: /Loyalty Tier/ }))
  await user.selectOptions(within(panel).getByLabelText('Operator'), 'in')
  await user.type(within(panel).getByLabelText('Values'), 'Gold{Enter}Platinum{Enter}')
  expect(within(panel).getByText('Yes when their Loyalty Tier is any of Gold or Platinum.')).toBeTruthy()
  expect(await within(panel).findByText('1,284 of the 3,412 customers in this journey would answer Yes right now.', {}, { timeout: 3000 })).toBeTruthy()
  expect(save.disabled).toBe(false)
  await user.click(save)

  expect(await within(canvas).findByText('Their Loyalty Tier is any of Gold or Platinum')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save Draft' }))
  await vi.waitFor(() => expect(putGraphCalls(calls)).toHaveLength(1))
  const graph = putGraphCalls(calls)[0].body as { graph: { nodes: { type: string; config: Record<string, unknown> }[] } }
  expect(graph.graph.nodes.find((node) => node.type === 'CONDITION')?.config).toEqual({ rule: { all: true, conditions: [{ field: 'attr:loyalty_tier', op: 'in', value: ['Gold', 'Platinum'] }] } })
})

test('a Wait can wait until a time of day in the customer’s time zone, on chosen days, and is saved with its mode', async () => {
  const calls = installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Wait' }))
  const panel = await screen.findByRole('dialog', { name: 'No duration set' })
  await user.click(within(panel).getByRole('radio', { name: 'Until a Time of Day' }))
  await user.selectOptions(within(panel).getByLabelText(/^Time\*?$/), '18:30')
  await user.click(within(panel).getByRole('button', { name: 'Monday' }))
  await user.click(within(panel).getByRole('button', { name: 'Friday' }))
  expect(within(panel).getByText(/11,980 customers have one/)).toBeTruthy()
  expect(within(panel).getByText(/waits until 6:30 PM on the next Monday, Friday, their time/)).toBeTruthy()
  await user.click(within(panel).getByRole('button', { name: 'Save Step' }))

  expect(await within(canvas).findByText('Wait until 6:30 PM on Mon, Fri, their time')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save Draft' }))
  await vi.waitFor(() => expect(putGraphCalls(calls)).toHaveLength(1))
  const graph = putGraphCalls(calls)[0].body as { graph: { nodes: { type: string; config: Record<string, unknown> }[] } }
  expect(graph.graph.nodes.find((node) => node.type === 'WAIT')?.config).toEqual({ mode: 'TIME_OF_DAY', time: '18:30', zone: 'CUSTOMER', weekdays: ['MON', 'FRI'] })
})

test('a Goal names its event, filters and window; set to continue it opens Reached and Not Yet paths, and is saved with its branches', async () => {
  const calls = installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  const canvas = await screen.findByTestId('journey-canvas')

  await user.click(within(canvas).getAllByRole('button', { name: 'Add a Step' })[0])
  await user.click(await screen.findByRole('button', { name: 'Goal' }))
  const panel = await screen.findByRole('dialog', { name: 'No goal event chosen' })
  await user.selectOptions(await within(panel).findByLabelText(/^Counts as Reached When/), 'PURCHASE')
  await user.click(within(panel).getByRole('button', { name: 'Add Filter' }))
  await user.type(within(panel).getByLabelText('Property'), 'amount')
  await user.selectOptions(within(panel).getByLabelText('Property Operator'), 'gte')
  await user.type(within(panel).getByLabelText('Property Value'), '25')
  await user.selectOptions(within(panel).getByLabelText(/^Attribution Window/), '14')
  await user.click(within(panel).getByRole('radio', { name: /Mark converted and continue/ }))
  await user.click(within(panel).getByRole('button', { name: 'Save Step' }))

  expect(await within(canvas).findByText('Purchase with 1 filter within 14 days of entering')).toBeTruthy()
  // a Goal that continues forks like a Condition: one "+" becomes four
  await vi.waitFor(() => expect(within(canvas).getAllByRole('button', { name: 'Add a Step' })).toHaveLength(4))
  await user.click(screen.getByRole('button', { name: 'Save Draft' }))
  await vi.waitFor(() => expect(putGraphCalls(calls)).toHaveLength(1))
  const graph = putGraphCalls(calls)[0].body as { graph: { nodes: { key: string; type: string; config: Record<string, unknown> }[]; connections: { from: string }[] } }
  const goal = graph.graph.nodes.find((node) => node.type === 'GOAL')!
  expect(goal.config).toEqual({ event_type: 'PURCHASE', window_days: 14, when_reached: 'CONTINUE', props: [{ key: 'amount', op: 'gte', value: 25 }] })
  expect(graph.graph.connections.some((edge) => edge.from === goal.key)).toBe(false) // nothing follows the goal yet: its paths open on the canvas, the graph gets edges once steps are added
})

test('Preview Route walks the saved draft as a chosen customer, and a step that depends on what has not happened asks what to assume', async () => {
  installMockApi({ journey: makeJourney() })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/build')
  await screen.findByTestId('journey-canvas')

  await user.click(screen.getByRole('button', { name: 'Preview Route' }))
  const panel = await screen.findByRole('dialog', { name: 'Preview Route' })
  await user.type(within(panel).getByLabelText('Preview As'), 'dev')
  await user.click(await within(panel).findByRole('button', { name: /Devon Okafor/ }))
  const route = await within(panel).findByRole('list', { name: 'Preview route' }, { timeout: 4000 })
  expect(within(route).getByText('Enters when a Welcome event arrives for them. The entry filters pass.')).toBeTruthy()
  expect(within(route).getByText('Continues Tue 13 Oct, 11:02')).toBeTruthy()
  expect(within(route).getByText(/assuming No/)).toBeTruthy()
  await user.click(within(route).getByRole('radio', { name: 'Assume Yes' }))
  expect(await within(route).findByText(/assuming Yes/)).toBeTruthy()
  expect(within(route).getByText(/Would exit .* as not converted/)).toBeTruthy()
})
