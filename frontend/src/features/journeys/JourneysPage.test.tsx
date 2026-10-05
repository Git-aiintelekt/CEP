import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('the stat cards are gone, and the page no longer asks for the stats', async () => {
  const calls = installMockApi()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })

  expect(screen.queryByLabelText('Journey Totals')).toBeNull()
  for (const label of ['Active journeys', 'Currently enrolled', 'Completed in 30 days', 'Campaign runs today']) expect(screen.queryByText(label)).toBeNull()
  expect(calls.some((call) => call.url.includes('/journeys/stats/'))).toBe(false)
})

test('Your Journeys, with its count, comes straight after the Journey Templates panel, and Your Templates is gone', async () => {
  const calls = installMockApi()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })

  const panel = screen.getByRole('region', { name: 'Journey Templates' })
  const yours = screen.getByRole('region', { name: /Your Journeys/ })
  const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
  expect(headings).toEqual(['Journey Templates', 'Your Journeys5'])
  expect(panel.compareDocumentPosition(yours) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(yours).getByRole('heading', { name: /Your Journeys/ }).textContent).toBe('Your Journeys5')
  expect(screen.queryByText('Your Templates')).toBeNull()
  expect(calls.some((call) => call.url.includes('/journey-templates/'))).toBe(false)
  expect(within(yours).getByText('5 journeys shown')).toBeTruthy()
})

test('Your Journeys shows as a list by default or a grid, and the choice is remembered', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  await screen.findByRole('table', { name: 'Journeys' })
  expect(screen.getByRole('radio', { name: 'List View' }).getAttribute('aria-checked')).toBe('true')

  await user.click(screen.getByRole('radio', { name: 'Grid View' }))
  const grid = screen.getByRole('list', { name: 'Journeys' })
  expect(screen.queryByRole('table', { name: 'Journeys' })).toBeNull()
  expect(within(grid).getAllByRole('listitem')).toHaveLength(5)
  expect(window.localStorage.getItem('cep.journeys.view')).toBe('grid')

  // a card: family, status, name, trigger, steps and channels, then created date and the starter it came from
  const card = within(grid).getByRole('button', { name: 'Abandoned Cart Recovery' })
  expect(within(card).getByText('Commerce / Offer')).toBeTruthy()
  expect(within(card).getByText('Active')).toBeTruthy()
  expect(within(card).getByText('When a shopper leaves items in their cart')).toBeTruthy()
  expect(within(card).getByRole('img', { name: 'Steps: Entry, Wait, Condition, Send Email, Send SMS, Issue Coupon, Exit Journey' })).toBeTruthy()
  expect(within(card).getByText('6 Steps')).toBeTruthy()
  expect(within(card).getByRole('img', { name: 'Channels: Email, SMS' })).toBeTruthy()
  expect(within(card).getByText(/^Created /)).toBeTruthy()
  expect(within(card).getByText('From Abandoned Cart Recovery')).toBeTruthy()
  expect(within(grid).getByRole('button', { name: 'VIP Milestone' }).textContent).toContain('0 Steps')
  expect(screen.getByText('5 journeys shown')).toBeTruthy()

  cleanup()
  installMockApi()
  await renderAppAt('/journeys')
  expect(await screen.findByRole('list', { name: 'Journeys' })).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'Grid View' }).getAttribute('aria-checked')).toBe('true')

  await user.click(screen.getByRole('radio', { name: 'List View' }))
  expect(await screen.findByRole('table', { name: 'Journeys' })).toBeTruthy()
  expect(window.localStorage.getItem('cep.journeys.view')).toBe('list')
})

test('a grid card click opens the same preview popover as a row', async () => {
  window.localStorage.setItem('cep.journeys.view', 'grid')
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  const grid = await screen.findByRole('list', { name: 'Journeys' })
  await user.click(within(grid).getByRole('button', { name: 'New Loyalty Member Welcome' }))
  const popover = await screen.findByRole('region', { name: 'Preview: New Loyalty Member Welcome' })
  expect(within(popover).getByText('Aby John')).toBeTruthy()
  await user.click(within(popover).getByRole('button', { name: 'View Details' }))
  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })
})

test('no journeys at all shows the empty state; filters that match nothing say so', async () => {
  installMockApi({ journeysList: [] })
  await renderAppAt('/journeys')
  expect(await screen.findByText('No journeys yet.')).toBeTruthy()
  expect(screen.getByText('Start from a template above or from a blank canvas.')).toBeTruthy()

  cleanup()
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })
  await user.type(screen.getByLabelText('Search journeys'), 'zzz')
  expect(await screen.findByText('No matching journeys')).toBeTruthy()
  expect(screen.queryByText('No journeys yet.')).toBeNull()
})

test('Status, Triggered by and Channel each send their own query param', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })

  await user.click(screen.getByRole('button', { name: 'Status' }))
  await user.click(screen.getByRole('option', { name: 'Active' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('status=ACTIVE'))).toBe(true))
  expect(screen.getByRole('button', { name: /^Active$/ })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Active' }))
  await user.click(screen.getByRole('option', { name: 'Needs Attention' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('needs_attention=true'))).toBe(true))
  expect(calls.at(-1)?.url).not.toContain('status=')

  await user.click(screen.getByRole('button', { name: 'Needs Attention' }))
  await user.click(screen.getByRole('option', { name: 'All Statuses' }))

  await user.click(screen.getByRole('button', { name: 'Triggered By' }))
  await user.click(screen.getByRole('option', { name: 'Commerce / Offer' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('trigger_family=COMMERCE_OFFER'))).toBe(true))

  await user.click(screen.getByRole('button', { name: 'Channel' }))
  await user.click(screen.getByRole('option', { name: 'SMS' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('channel=SMS'))).toBe(true))
})

test('a row click opens a preview popover near the row with real facts, then View Details opens the real Journey Details page', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')

  const table = await screen.findByRole('table', { name: 'Journeys' })
  await user.click(within(table).getByText('New Loyalty Member Welcome'))

  const popover = await screen.findByRole('region', { name: 'Preview: New Loyalty Member Welcome' })
  expect(within(popover).getByText('Segment / Loyalty')).toBeTruthy()
  expect(within(popover).getByText('Email')).toBeTruthy()
  await vi.waitFor(() => expect(within(popover).getByText(/Loyalty enrollment event/)).toBeTruthy())
  await vi.waitFor(() => expect(within(popover).getByText('55')).toBeTruthy())                 // 40 + 12 + 3 ever enrolled
  expect(within(popover).getByText('40 in journey')).toBeTruthy()
  expect(within(popover).getByText('Aby John')).toBeTruthy()

  await user.click(within(popover).getByRole('button', { name: 'View Details' }))
  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })
  expect(screen.getByRole('heading', { name: 'Performance' })).toBeTruthy()
})

test('Create Journey opens the real Setup modal', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/journeys')
  await screen.findByRole('table', { name: 'Journeys' })

  await user.click(screen.getByRole('button', { name: /Create Journey/ }))
  const dialog = await screen.findByRole('dialog', { name: /^Create Journey$/ })
  expect(within(dialog).getByText(/^Step 1 of 2/)).toBeTruthy()
})
