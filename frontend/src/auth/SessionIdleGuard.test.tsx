/**
 * The idle-timeout guard, end to end through the real App: a warning after the configured idle time, "Stay signed in"
 * resets it, running the warning out signs out and redirects with a notice, and activity in another tab (the shared
 * localStorage timestamp) stands a warning down. Fake timers throughout: the real defaults are minutes, not seconds.
 *
 * The API client reads its session from localStorage once, when its module loads, so signing in has to happen before
 * a *fresh* import of the app (vi.resetModules + a dynamic import), the same way the rest of this test suite does it.
 * Fake timers are installed only after that import settles, and every wait uses advanceTimersByTimeAsync, which
 * flushes the mocked fetch's promise chain between ticks — plain findBy/waitFor poll with a real setTimeout and
 * would otherwise never see anything the fake clock hasn't been told to move past.
 *
 * Every advance runs inside act(): the guard's interval fires outside React's event handling, so without act the
 * re-render it causes (the warning, the sign-out, the login page) is left to React's real-time scheduler, and whether it
 * had happened by the next check depended on machine load.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, signIn } from '@/test/mockApi'

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** moves the fake clock and lets React finish whatever that set off before the test looks */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

/**
 * 1 minute idle, a 3-second warning: short enough to drive with fake timers, long enough to exercise the "at least a
 * minute" floor. Button presses go through fireEvent, not userEvent: userEvent's own pointer-simulation machinery
 * hangs indefinitely under this fake-timer setup (an environment quirk, not something either side of the click is
 * doing wrong — every raw-dispatched interaction in this file behaves exactly as the app code says it should).
 */
async function renderSignedIn() {
  installMockApi({ campaigns: [makeCampaign({})], me: { session: { idle_timeout_minutes: 1, idle_warning_seconds: 3 } } })
  signIn('/')
  vi.resetModules()
  const { default: App } = await import('../App')
  vi.useFakeTimers()
  render(<App />)
  await tick(50) // lets the mocked GET /me/ (a resolved promise, no real delay) settle and the shell render
  expect(screen.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })).toBeTruthy()
}

test('idle warning: appears after the configured idle time, counts down, and "Stay signed in" clears it without signing out', async () => {
  await renderSignedIn()
  expect(screen.queryByRole('dialog', { name: 'Still there?' })).toBeNull()

  await tick(60_000) // the 1-minute idle timeout
  expect(screen.getByRole('dialog', { name: 'Still there?' }).textContent).toContain('3 seconds')

  await tick(1_000)
  expect(screen.getByRole('dialog', { name: 'Still there?' }).textContent).toContain('2 seconds')

  fireEvent.click(screen.getByRole('button', { name: 'Stay Signed In' }))
  expect(screen.queryByRole('dialog', { name: 'Still there?' })).toBeNull()
  expect(window.localStorage.getItem('cep.access')).toBe('access-1') // still signed in

  // and the clock was genuinely reset, not just the dialog hidden: another 59s must not bring it back
  await tick(59_000)
  expect(screen.queryByRole('dialog', { name: 'Still there?' })).toBeNull()
})

test('idle warning: no response before it runs out signs the person out and the login page explains why', async () => {
  await renderSignedIn()
  await tick(60_000)
  expect(screen.getByRole('dialog', { name: 'Still there?' })).toBeTruthy()

  await tick(3_000) // the whole warning window, untouched
  await tick(50) // settles the sign-out -> redirect -> login-page render chain

  expect(screen.getByRole('heading', { name: 'Log In to CEP' })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain('signed out after some time without activity')
  expect(window.localStorage.getItem('cep.access')).toBeNull() // the token is really gone, not just the screen changed
})

test('idle warning: "Sign out now" ends the session immediately, without waiting out the countdown', async () => {
  await renderSignedIn()
  await tick(60_000)
  expect(screen.getByRole('dialog', { name: 'Still there?' })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Sign Out Now' }))
  await tick(50)
  expect(screen.getByRole('heading', { name: 'Log In to CEP' })).toBeTruthy()
})

test('idle warning: activity recorded in another tab (the shared timestamp) stands a warning down in this one', async () => {
  await renderSignedIn()
  await tick(60_000)
  expect(screen.getByRole('dialog', { name: 'Still there?' })).toBeTruthy()

  // a real cross-tab "storage" event never fires on the tab that wrote it, so this fakes the OTHER tab's write reaching this one
  const at = String(Date.now())
  window.localStorage.setItem('cep.lastActivity', at)
  window.dispatchEvent(new StorageEvent('storage', { key: 'cep.lastActivity', newValue: at }))
  await tick(0) // the resulting state update is not routed through testing-library, so it needs an explicit flush
  expect(screen.queryByRole('dialog', { name: 'Still there?' })).toBeNull()
})

test('a resting pointer over the page while the warning is up does not silently cancel the sign-out', async () => {
  await renderSignedIn()
  await tick(60_000)
  expect(screen.getByRole('dialog', { name: 'Still there?' })).toBeTruthy()

  // a raw mousedown reaching window, not one of the dialog's own buttons: ordinary page activity, not "I am still here"
  // (dispatched directly rather than through userEvent.click, which needs real timer advancement this fake-timer setup does not provide)
  window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await tick(0)
  expect(screen.getByRole('dialog', { name: 'Still there?' })).toBeTruthy() // still up: that mousedown did not reset the clock

  await tick(3_000)
  await tick(50) // settles the sign-out -> redirect -> login-page render chain
  expect(screen.getByRole('heading', { name: 'Log In to CEP' })).toBeTruthy()
})
