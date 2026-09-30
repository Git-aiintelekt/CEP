/** The sign-in screen: the password path, the code step, and the reset flow that has no endpoint behind it yet. */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, MFA_CODE } from '@/test/mockApi'

async function renderApp() {
  window.history.pushState({}, '', '/login')
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
  return userEvent.setup()
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>, password: string) {
  await user.clear(await screen.findByLabelText('Workspace'))
  await user.type(screen.getByLabelText('Workspace'), 'NWA')
  await user.type(screen.getByLabelText('Email'), 'aby.john@aiintelekt.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Log In' }))
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the password is hidden until the reveal toggle is pressed', async () => {
  installMockApi()
  const user = await renderApp()

  const password = await screen.findByLabelText('Password')
  expect(password.getAttribute('type')).toBe('password')

  await user.click(screen.getByRole('button', { name: 'Show Password' }))
  expect(password.getAttribute('type')).toBe('text')

  await user.click(screen.getByRole('button', { name: 'Hide Password' }))
  expect(password.getAttribute('type')).toBe('password')
})

test('a wrong password shows only the message: the log-in animation never starts', async () => {
  installMockApi()
  const user = await renderApp()
  const { loadingOverlay } = await import('@/lib/loadingOverlay')
  const show = vi.spyOn(loadingOverlay, 'show')

  await fillCredentials(user, 'wrong-password')

  expect((await screen.findByRole('alert')).textContent).toContain('Incorrect email or password')
  expect(show).not.toHaveBeenCalled()
  expect(screen.queryByText('Logging you in…')).toBeNull()
})

test('the right password starts the animation before the dashboard', async () => {
  installMockApi()
  const user = await renderApp()
  const { loadingOverlay } = await import('@/lib/loadingOverlay')
  const show = vi.spyOn(loadingOverlay, 'show')

  await fillCredentials(user, 'correct-horse')

  expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })).toBeTruthy()
  expect(show).toHaveBeenCalledWith('Logging you in…')
})

test('a workspace that requires a code asks for one instead of signing in', async () => {
  const calls = installMockApi()
  const user = await renderApp()

  await fillCredentials(user, 'needs-a-code')

  expect(await screen.findByText('Enter Your Code')).toBeTruthy()
  await user.type(screen.getByLabelText('Authentication Code'), MFA_CODE)
  await user.click(screen.getByRole('button', { name: 'Verify' }))

  expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Aby$/ })).toBeTruthy()
  const verify = calls.find((call) => call.url.endsWith('/auth/mfa/verify/'))
  expect(verify?.body).toEqual({ mfa_token: 'mfa-token-1', code: MFA_CODE })
})

test('a wrong code is explained and sign in can be started again', async () => {
  installMockApi()
  const user = await renderApp()

  await fillCredentials(user, 'needs-a-code')
  await user.type(await screen.findByLabelText('Authentication Code'), '111111')
  await user.click(screen.getByRole('button', { name: 'Verify' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Codes change every 30 seconds')

  await user.click(screen.getByRole('button', { name: '← Back to Log In' }))
  expect(await screen.findByText('Log In to CEP')).toBeTruthy()
})

test('forgot password: the address is checked here, and the missing endpoint is reported honestly', async () => {
  const calls = installMockApi()
  const user = await renderApp()

  await user.click(await screen.findByRole('button', { name: 'Forgot password?' }))
  expect(await screen.findByText('Reset Your Password')).toBeTruthy()

  // a malformed address never reaches the API
  await user.type(screen.getByLabelText('Email'), 'not-an-address')
  await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))
  expect(screen.getByText('Enter a valid email address')).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/auth/forgot-password/'))).toBe(false)

  // with a real one it is attempted, and the 404 is not dressed up as a sent email
  await user.clear(screen.getByLabelText('Email'))
  await user.type(screen.getByLabelText('Email'), 'aby.john@aiintelekt.com')
  await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

  expect(await screen.findByText(/not switched on yet/)).toBeTruthy()
  expect(screen.queryByText('Check Your Email')).toBeNull()
  expect(calls.some((call) => call.url.includes('/auth/forgot-password/'))).toBe(true)
})

test('once the endpoint exists the reset link is confirmed as sent', async () => {
  const calls = installMockApi({ onForgotPassword: () => new Response(null, { status: 204 }) })
  const user = await renderApp()

  await user.click(await screen.findByRole('button', { name: 'Forgot password?' }))
  await user.type(screen.getByLabelText('Email'), 'aby.john@aiintelekt.com')
  await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

  expect(await screen.findByText('Check Your Email')).toBeTruthy()
  expect(screen.getByText('aby.john@aiintelekt.com')).toBeTruthy()
  expect(calls.find((call) => call.url.includes('/auth/forgot-password/'))?.body).toEqual({ email: 'aby.john@aiintelekt.com' })

  await user.click(screen.getByRole('button', { name: 'Resend Link' }))
  expect(await screen.findByText(/Link resent at/)).toBeTruthy()
})
