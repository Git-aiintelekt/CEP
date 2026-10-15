import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('Customers finds a customer by part of their name or email, and opens the record', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/customers')

  expect(await screen.findByRole('heading', { name: 'Customers' })).toBeTruthy()
  expect(screen.getByText('Find a customer')).toBeTruthy()
  await user.type(screen.getByLabelText('Search customers'), 'aali')
  const table = await screen.findByRole('table', { name: 'Customers' })
  expect(within(table).getByRole('link', { name: 'Aaliyah Brooks' }).getAttribute('href')).toBe('/customers/p-aaliyah')
  expect(within(table).queryByText('Marcus Hale')).toBeNull()
  expect(new URL(calls.filter((call) => call.url.includes('/customers/?')).at(-1)!.url, 'http://x').searchParams.get('q')).toBe('aali')

  await user.click(within(table).getByRole('link', { name: 'Aaliyah Brooks' }))
  expect(await screen.findByRole('heading', { name: 'Aaliyah Brooks', level: 1 })).toBeTruthy()
})

test('the customer record shows consent, attributes, journeys with a timeline link, events, orders, messages and lists', async () => {
  installMockApi()
  await renderAppAt('/customers/p-aaliyah')

  expect(await screen.findByRole('heading', { name: 'Aaliyah Brooks', level: 1 })).toBeTruthy()
  expect(screen.getByText(/Customer ID p-aaliyah · C360/)).toBeTruthy()
  expect(screen.getByText('Email: Can receive')).toBeTruthy()
  expect(screen.getByText('SMS: No consent')).toBeTruthy()
  const attributes = screen.getByRole('table', { name: 'Custom attributes' })
  expect(within(attributes).getByText('loyalty_tier')).toBeTruthy()
  expect(within(attributes).getByText('Gold')).toBeTruthy()
  const journeys = screen.getByRole('table', { name: 'Journeys entered' })
  expect(within(journeys).getByRole('link', { name: 'New Loyalty Member Welcome' }).getAttribute('href')).toBe('/journeys/j1')
  expect(within(journeys).getByRole('link', { name: 'View Timeline' }).getAttribute('href')).toBe('/journeys/j1?customer=e-1')
  expect(within(journeys).getByText('Wait 3 days')).toBeTruthy()
  expect(within(screen.getByRole('table', { name: 'Events received' })).getByText('Abandoned Cart')).toBeTruthy()
  expect(within(screen.getByRole('table', { name: 'Orders' })).getByText('W-100234')).toBeTruthy()
  expect(within(screen.getByRole('table', { name: 'Messages sent' })).getByText(/Opened · opened/)).toBeTruthy()
  expect(within(screen.getByRole('table', { name: 'Contact lists' })).getByRole('link', { name: 'VIP Customers' })).toBeTruthy()
})

test('an unknown customer says so', async () => {
  installMockApi()
  await renderAppAt('/customers/nobody')
  expect(await screen.findByText('This customer could not be loaded')).toBeTruthy()
})
