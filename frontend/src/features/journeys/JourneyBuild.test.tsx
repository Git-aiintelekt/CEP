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
