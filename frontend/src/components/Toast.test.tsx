import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ToastProvider, useToast } from './Toast'

/** Buttons that fire toasts, so the tests drive the provider through the public hook. */
function Harness() {
  const toast = useToast()
  const ids = useRef<string[]>([])
  const n = useRef(0)
  return (
    <div>
      <button type="button" onClick={() => toast.error(`Send failed for batch ${++n.current}`)}>
        fire numbered error
      </button>
      <button type="button" onClick={() => ids.current.push(toast.success('Template saved', 'All changes are live'))}>
        fire success
      </button>
      <button type="button" onClick={() => ids.current.push(toast.error('Template could not be saved', 'Check the subject line'))}>
        fire error
      </button>
      <button type="button" onClick={() => toast.dismiss(ids.current[0])}>
        dismiss first
      </button>
    </div>
  )
}

function renderToasts() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  )
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
/** the exit fade, which keeps a dismissed toast on screen for a moment longer */
const EXIT_MS = 70
const exit = () => advance(EXIT_MS)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('a success toast appears and auto-dismisses after 4.5s', () => {
  renderToasts()
  click('fire success')

  expect(screen.getByText('Template saved')).toBeTruthy()
  expect(screen.getByText('All changes are live')).toBeTruthy()

  advance(4499)
  expect(screen.queryByText('Template saved')).toBeTruthy()
  advance(1)
  // the fade has begun but the toast is still there to see
  expect(screen.queryByText('Template saved')).toBeTruthy()
  exit()
  expect(screen.queryByText('Template saved')).toBeNull()
})

test('an error toast stays until it is dismissed', () => {
  renderToasts()
  click('fire error')

  advance(60_000)
  expect(screen.getByText('Template could not be saved')).toBeTruthy()

  click('Dismiss')
  exit()
  expect(screen.queryByText('Template could not be saved')).toBeNull()
})

test('hovering pauses the auto-dismiss timer and leaving resumes it', () => {
  renderToasts()
  click('fire success')

  const toast = screen.getByRole('status')
  advance(3000)
  fireEvent.mouseEnter(toast)
  advance(60_000)
  expect(screen.getByText('Template saved')).toBeTruthy()

  // it resumes with the 1.5s it had left, not a fresh 4.5s
  fireEvent.mouseLeave(toast)
  advance(1499)
  expect(screen.queryByText('Template saved')).toBeTruthy()
  advance(1)
  exit()
  expect(screen.queryByText('Template saved')).toBeNull()
})

test('keyboard focus pauses the auto-dismiss timer', () => {
  renderToasts()
  click('fire success')

  fireEvent.focus(screen.getByRole('button', { name: 'Dismiss' }))
  advance(60_000)
  expect(screen.getByText('Template saved')).toBeTruthy()
})

test('the dismiss button closes the toast', () => {
  renderToasts()
  click('fire success')

  click('Dismiss')
  exit()
  expect(screen.queryByText('Template saved')).toBeNull()
})

test('the navy bar carries the status in a dot, and the error tone fills the bar', () => {
  renderToasts()
  click('fire success')
  const success = screen.getByRole('status')
  expect(success.className).toContain('bg-sidebar')
  expect(success.querySelector('.bg-success')).toBeTruthy()
  expect(success.className).toContain('animate-toast-in')

  click('fire error')
  const error = screen.getByRole('alert')
  expect(error.className).toContain('bg-danger')
  expect(error.querySelector('.bg-white')).toBeTruthy()
})

test('a fourth toast evicts the oldest', () => {
  renderToasts()
  for (let i = 0; i < 4; i++) click('fire numbered error')

  const alerts = screen.getAllByRole('alert')
  expect(alerts).toHaveLength(3)
  expect(screen.queryByText('Send failed for batch 1')).toBeNull()
  expect(screen.getByText('Send failed for batch 4')).toBeTruthy()
})

test('the tone sets the live region role', () => {
  renderToasts()
  click('fire success')
  expect(screen.getByRole('status')).toBeTruthy()

  click('fire error')
  expect(screen.getByRole('alert')).toBeTruthy()
})

test('an identical toast fired again within a second is ignored', () => {
  renderToasts()
  click('fire error')
  click('fire error')
  expect(screen.getAllByRole('alert')).toHaveLength(1)

  advance(1000)
  click('fire error')
  expect(screen.getAllByRole('alert')).toHaveLength(2)
})

test('the id it returns can dismiss the toast programmatically', () => {
  renderToasts()
  click('fire success')

  click('dismiss first')
  expect(screen.queryByText('Template saved')).toBeNull()
})
