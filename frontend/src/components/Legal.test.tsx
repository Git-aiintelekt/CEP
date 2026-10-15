import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const year = String(new Date().getFullYear())

test('the sign-in page ends with the copyright for this year and a link to the Terms of Use', async () => {
  installMockApi()
  window.history.pushState({}, '', '/login')
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)

  const footer = await screen.findByRole('contentinfo', { name: 'Legal' })
  await within(footer).findByText(`© ${year} Transaction Tree`)
  expect(within(footer).getByRole('link', { name: 'Terms of Use' }).getAttribute('href')).toBe('/terms')
  expect(within(footer).queryByText('Privacy')).toBeNull()
})

test('the Terms of Use page renders the platform text, its date, and leads back to the sign-in page', async () => {
  installMockApi()
  window.history.pushState({}, '', '/terms')
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)

  expect(await screen.findByRole('heading', { name: 'Terms of Use', level: 1 })).toBeTruthy()
  expect(await screen.findByText(/Last updated/)).toBeTruthy()
  expect(await screen.findByRole('heading', { name: '1. What C360 is' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '8. Contact' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to Log In' }).getAttribute('href')).toBe('/login')
  expect(within(screen.getByRole('contentinfo', { name: 'Legal' })).getByText(`© ${year} Transaction Tree`)).toBeTruthy()
})

test('every signed-in page ends with the same line', async () => {
  installMockApi()
  signIn('/campaigns')
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
  const user = userEvent.setup()

  await screen.findByRole('heading', { name: 'Campaigns' })
  const footer = await screen.findByRole('contentinfo', { name: 'Legal' })
  await within(footer).findByText(`© ${year} Transaction Tree`)
  await user.click(within(footer).getByRole('link', { name: 'Terms of Use' }))
  expect(await screen.findByRole('heading', { name: 'Terms of Use', level: 1 })).toBeTruthy()
})
