/** Smoke test of the whole shell against a mocked API: login -> overview -> campaigns -> detail, plus the 401 path. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, type Call } from '@/test/mockApi'

import App from './App'

let calls: Call[] = []

beforeEach(() => {
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
  calls = installMockApi()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('anonymous visitors are sent to the login form, and a wrong password is explained', async () => {
  const user = userEvent.setup()
  render(<App />)

  expect(await screen.findByText('Log in to CEP')).toBeTruthy()
  await user.type(screen.getByLabelText('Email'), 'aby.john@aiintelekt.com')
  await user.type(screen.getByLabelText('Password'), 'nope')
  await user.click(screen.getByRole('button', { name: 'Log In' }))

  expect((await screen.findByRole('alert')).textContent).toContain('Incorrect email or password')
})

test('sign in -> overview -> campaigns -> detail -> publish, with tenant and bearer headers on every call', async () => {
  const user = userEvent.setup()
  render(<App />)

  await user.clear(await screen.findByLabelText('Workspace'))
  await user.type(screen.getByLabelText('Workspace'), 'NWA')
  await user.type(screen.getByLabelText('Email'), 'aby.john@aiintelekt.com')
  await user.type(screen.getByLabelText('Password'), 'correct-horse')
  await user.click(screen.getByRole('button', { name: 'Log In' }))

  expect(await screen.findByText('Welcome back, Aby')).toBeTruthy()
  expect(screen.getByText('NWA')).toBeTruthy()

  await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByText('Campaigns'))
  await user.click(await screen.findByText('CMP-2026-0001'))

  await user.click(await screen.findByRole('button', { name: 'Publish to production' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/campaigns/c1/publish/') && call.method === 'POST')).toBe(true))

  // the login call and the public sign-in options lookup carry no token
  const authed = calls.filter((call) => !call.url.includes('/auth/token/') && !call.url.includes('/auth/options/'))
  expect(authed.length).toBeGreaterThan(0)
  expect(authed.every((call) => call.headers['X-Tenant'] === 'NWA' && call.headers.Authorization === 'Bearer access-1')).toBe(true)
})
