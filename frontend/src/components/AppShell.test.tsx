/** The app shell's navigation rail: its items and groups, collapsing and expanding, and the collapsed tooltips. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const rail = () => screen.getByRole('complementary', { name: 'Sidebar' })
const nav = () => screen.getByRole('navigation', { name: 'Main' })

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('240px expanded: the brand, Home and the everyday pages, then Settings below a divider; no section headings', async () => {
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(rail().className).toContain('w-60')
  expect(rail().className).not.toContain('border')
  const mark = within(rail()).getByRole('link', { name: 'C360 home' })
  expect(within(mark).getByText('C360').className).toContain('bg-brand-600')
  expect(within(rail()).getByText('Engagement')).toBeTruthy()                            // the wordmark sits under the mark, outside the link

  const [pages, admin] = within(nav()).getAllByRole('list')
  expect(within(pages).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Campaigns', 'Journeys', 'Templates', 'Contact lists', 'Reports'])
  expect(within(admin).getAllByRole('link').map((link) => link.textContent)).toEqual(['Settings'])
  expect(within(rail()).queryByText(/^engage$/i)).toBeNull()
  expect(within(rail()).queryByText(/^manage$/i)).toBeNull()

  const current = within(nav()).getByRole('link', { name: 'Campaigns' })
  expect(current.getAttribute('aria-current')).toBe('page')
  expect(current.querySelector('[data-current-bar]')).toBeTruthy()
})

test('collapsing: 64px, labels gone at once, remembered; expanding brings the labels back after the width', async () => {
  const user = userEvent.setup()
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  const toggle = screen.getByRole('button', { name: 'Collapse navigation' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(toggle.getAttribute('data-rail-toggle')).toBe('beside')                                       // expanded: 32px beside the mark
  expect(within(rail()).getByRole('link', { name: 'C360 home' }).compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  await user.click(toggle)
  expect(rail().className).toContain('w-16')
  const collapsedToggle = screen.getByRole('button', { name: 'Expand navigation' })                   // 64px has no room beside the mark: the round toggle sits under it
  expect(collapsedToggle.getAttribute('data-rail-toggle')).toBe('below')
  expect(collapsedToggle.className).toContain('h-8 w-8 items-center justify-center rounded-full')
  expect(within(rail()).getByRole('link', { name: 'C360 home' }).compareDocumentPosition(collapsedToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(nav()).getByRole('link', { name: 'Campaigns' }).textContent).toBe('')                 // named by aria-label only
  expect(within(rail()).queryByText('Engagement')).toBeNull()
  expect(window.localStorage.getItem('cep.nav.collapsed')).toBe('1')

  await user.click(screen.getByRole('button', { name: 'Expand navigation' }))
  expect(rail().className).toContain('w-60')
  await vi.waitFor(() => expect(within(nav()).getByRole('link', { name: 'Campaigns' }).textContent).toBe('Campaigns'))
})

test('collapsed, a hovered item names itself in a tooltip', async () => {
  const user = userEvent.setup()
  window.localStorage.setItem('cep.nav.collapsed', '1')
  installMockApi()
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  await user.hover(within(nav()).getByRole('link', { name: 'Templates' }))
  await vi.waitFor(() => expect(document.querySelector('[data-rail-tooltip]')?.textContent).toBe('Templates'))
  await user.unhover(within(nav()).getByRole('link', { name: 'Templates' }))
  expect(document.querySelector('[data-rail-tooltip]')).toBeNull()
})

test('without user.admin there is no second group and no divider', async () => {
  installMockApi({ me: { principal: { ...me.principal, permissions: ['campaign.view'] } } as never })
  await renderAppAt('/campaigns')
  await screen.findByRole('navigation', { name: 'Main' })
  expect(within(nav()).getAllByRole('list')).toHaveLength(1)
})
