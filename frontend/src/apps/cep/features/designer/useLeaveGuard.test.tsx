import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useLeaveGuard } from './useLeaveGuard'

const proceeded = vi.fn()

/** Drives the hook the way the workspace does: a dirty toggle and a "leave" button. */
function Host({ initialDirty = true, strict = false, fallback }: { initialDirty?: boolean; strict?: boolean; fallback?: () => void }) {
  const [dirty, setDirty] = useState(initialDirty)
  const guard = useLeaveGuard(dirty, fallback)
  const body = (
    <div>
      <button type="button" onClick={() => guard.requestLeave(() => proceeded())}>
        leave
      </button>
      <button type="button" onClick={() => setDirty(false)}>
        mark saved
      </button>
      <button type="button" onClick={() => setDirty(true)}>
        mark dirty
      </button>
      {guard.dialog}
    </div>
  )
  return strict ? <StrictMode>{body}</StrictMode> : body
}

const click = (name: string) => userEvent.setup().click(screen.getByRole('button', { name }))
const dialog = () => screen.queryByRole('dialog', { name: 'Leave without saving?' })
const marked = () => Boolean((window.history.state as Record<string, unknown> | null)?.cepLeaveGuard)

/** history.length is the only handle jsdom gives us on the stack depth. */
let baseline = 0

beforeEach(() => {
  proceeded.mockClear()
  window.history.replaceState(null, '', '/templates/x/design')
  baseline = window.history.length
})
afterEach(cleanup)

test('a clean editor leaves at once, with no dialog and no sentinel', async () => {
  render(<Host initialDirty={false} />)

  expect(marked()).toBe(false)
  expect(window.history.length).toBe(baseline)

  await click('leave')
  expect(proceeded).toHaveBeenCalledTimes(1)
  expect(dialog()).toBeNull()
})

test('a dirty editor asks first and does not proceed on its own', async () => {
  render(<Host />)

  await click('leave')
  expect(dialog()).toBeTruthy()
  expect(screen.getByText('You have unsaved changes to this template. Leaving discards them.')).toBeTruthy()
  expect(proceeded).not.toHaveBeenCalled()
})

test('Keep Editing closes the dialog and stays put', async () => {
  render(<Host />)

  await click('leave')
  await click('Keep Editing')

  expect(dialog()).toBeNull()
  expect(proceeded).not.toHaveBeenCalled()
})

test('Escape counts as keep editing', async () => {
  const user = userEvent.setup()
  render(<Host />)

  await click('leave')
  await user.keyboard('{Escape}')

  expect(dialog()).toBeNull()
  expect(proceeded).not.toHaveBeenCalled()
})

test('Leave Without Saving proceeds exactly once', async () => {
  render(<Host />)

  await click('leave')
  await click('Leave Without Saving')

  expect(proceeded).toHaveBeenCalledTimes(1)
  expect(dialog()).toBeNull()
})

test('one sentinel entry is held while dirty and never more than one', async () => {
  render(<Host />)

  expect(marked()).toBe(true)
  expect(window.history.length).toBe(baseline + 1)

  // saving and dirtying again must reuse one entry, never stack a second
  await click('mark saved')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  await click('mark dirty')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  expect(marked()).toBe(true)
  expect(window.history.length).toBe(baseline + 1)
})

test('the sentinel is dropped once the work is saved', async () => {
  render(<Host />)
  expect(marked()).toBe(true)

  await click('mark saved')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50)) // history.go is asynchronous
  })

  expect(marked()).toBe(false)
})

test('a clean editor never arms the sentinel at all', () => {
  render(<Host initialDirty={false} />)
  expect(marked()).toBe(false)
  expect(window.history.length).toBe(baseline)
})

test('the browser Back button opens the dialog instead of leaving', async () => {
  render(<Host />)
  expect(marked()).toBe(true)

  // jsdom will not run the real back navigation: stand in for it by clearing the marker the way
  // popping the sentinel would, then raising the popstate the browser would raise
  await act(async () => {
    window.history.replaceState(null, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })

  expect(dialog()).toBeTruthy()
  expect(marked()).toBe(true) // the sentinel was put back, so a second Back is caught too
})

test('beforeunload is registered only while dirty', async () => {
  const add = vi.spyOn(window, 'addEventListener')
  const remove = vi.spyOn(window, 'removeEventListener')
  const { unmount } = render(<Host />)

  expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true)

  const warn = add.mock.calls.find(([type]) => type === 'beforeunload')?.[1]
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)

  unmount()
  expect(remove.mock.calls.some(([type, handler]) => type === 'beforeunload' && handler === warn)).toBe(true)
  add.mockRestore()
  remove.mockRestore()
})

test('beforeunload does not block once the work is saved', async () => {
  render(<Host />)
  await click('mark saved')

  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

test('leaving disarms beforeunload so nothing prompts twice', async () => {
  render(<Host />)

  await click('leave')
  await click('Leave Without Saving')

  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

test('unmounting leaves no armed sentinel behind', () => {
  const { unmount } = render(<Host />)
  expect(marked()).toBe(true)

  unmount()
  expect(marked()).toBe(false) // un-marked synchronously, so a later Back is not intercepted
})

test('StrictMode double mounting still arms exactly one sentinel', () => {
  render(<Host strict />)

  expect(marked()).toBe(true)
  expect(window.history.length).toBe(baseline + 1)
})

test('Back falls back to a normal navigation when the editor opened the tab', async () => {
  // history.length 1 means there is nothing behind the sentinel for go(-2) to reach
  const fallback = vi.fn()
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  vi.spyOn(window.history, 'length', 'get').mockReturnValue(1)
  render(<Host fallback={fallback} />)

  await act(async () => {
    window.history.replaceState(null, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })
  await click('Leave Without Saving')

  expect(fallback).toHaveBeenCalledTimes(1)
  expect(go).not.toHaveBeenCalledWith(-2)
  vi.restoreAllMocks()
})

test('Back uses go(-2) when the editor was opened from another page', async () => {
  const fallback = vi.fn()
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
  vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)
  render(<Host fallback={fallback} />)

  await act(async () => {
    window.history.replaceState(null, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })
  await click('Leave Without Saving')

  expect(go).toHaveBeenCalledWith(-2)
  expect(fallback).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})
