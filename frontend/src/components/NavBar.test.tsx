import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { useLeaveGuard } from '@/features/designer/useLeaveGuard'

import { NavBar } from './NavBar'

const has = vi.fn((_feature: string) => true)
const can = vi.fn((_permission: string) => true)
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ has, can }) }))

afterEach(() => {
  cleanup()
  has.mockReturnValue(true)
})

function renderBar(path = '/templates/7/design', onNavigate?: (to: string, event: React.MouseEvent) => void) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavBar onNavigate={onNavigate} />
    </MemoryRouter>,
  )
}

test('the bar carries the six destinations, with the editor’s own section marked current', () => {
  renderBar()
  const bar = screen.getByRole('navigation', { name: 'Main' })
  expect([...bar.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'))).toEqual([
    'CEP home',
    'Home',
    'Campaigns',
    'Journeys',
    'Templates',
    'Contact lists',
    'Reports',
  ])

  const templates = screen.getByRole('link', { name: 'Templates' })
  expect(templates.getAttribute('aria-current')).toBe('page')
  expect(templates.className).toContain('bg-sidebar-selected')
  expect(templates.querySelector('[data-current-bar]')).toBeTruthy()                                     // the 3px left bar
  expect(screen.getByRole('link', { name: 'Campaigns' }).className).toContain('text-sidebar-text')
  expect(screen.getByRole('link', { name: 'Campaigns' }).querySelector('[data-current-bar]')).toBeNull()
})

test('a destination behind a flag that is off is not offered', () => {
  has.mockImplementation((feature: string) => feature !== 'journeys')
  renderBar()
  expect(screen.queryByRole('link', { name: 'Journeys' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Campaigns' })).toBeTruthy()
})

test('every link hands the destination back so the page can hold it', async () => {
  const onNavigate = vi.fn((_to: string, event: React.MouseEvent) => event.preventDefault())
  const user = userEvent.setup()
  renderBar('/templates/7/design', onNavigate)

  await user.click(screen.getByRole('link', { name: 'Campaigns' }))
  expect(onNavigate).toHaveBeenCalledWith('/campaigns', expect.anything())

  await user.click(screen.getByRole('link', { name: 'CEP home' }))
  expect(onNavigate).toHaveBeenCalledWith('/', expect.anything())
})

test('the bar is the app rail collapsed: 64px, 40px items with 4px corners, 20px icons, no labels', () => {
  renderBar()
  const bar = screen.getByRole('navigation', { name: 'Main' })
  expect(bar.className).toContain('w-16')
  expect(bar.className).toContain('bg-sidebar')

  const templates = screen.getByRole('link', { name: 'Templates' })
  expect(templates.className).toContain('h-10')
  expect(templates.className).toContain('w-10')
  expect(templates.className).toContain('rounded-sm')
  expect(templates.querySelector('svg')?.getAttribute('width')).toBe('20')
  expect(templates.textContent).toBe('')
})

test('a collapsed item names itself in a tooltip on keyboard focus, and Escape hides it', async () => {
  const user = userEvent.setup()
  renderBar()
  await user.tab()                                                                                      // the mark
  await user.tab()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Home')
  expect(document.querySelector('[data-rail-tooltip]')?.textContent).toBe('Home')
  await user.keyboard('{Escape}')
  expect(document.querySelector('[data-rail-tooltip]')).toBeNull()
})

/** The bar wired the way the editor wires it: every destination goes through the unsaved-work guard. */
function GuardedBar({ dirty }: { dirty: boolean }) {
  const guard = useLeaveGuard(dirty)
  const [went, setWent] = useState<string | null>(null)
  return (
    <MemoryRouter initialEntries={['/templates/7/design']}>
      <NavBar
        onNavigate={(to, event) => {
          event.preventDefault()
          guard.requestLeave(() => setWent(to))
        }}
      />
      <p>{went ? `left for ${went}` : 'still here'}</p>
      {guard.dialog}
    </MemoryRouter>
  )
}

test('with unsaved work a link opens the leave dialog instead of leaving', async () => {
  const user = userEvent.setup()
  render(<GuardedBar dirty />)

  await user.click(screen.getByRole('link', { name: 'Campaigns' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeTruthy()
  expect(screen.getByText('still here')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Leave Without Saving' }))
  expect(screen.getByText('left for /campaigns')).toBeTruthy()
})

test('with nothing unsaved a link goes straight there', async () => {
  const user = userEvent.setup()
  render(<GuardedBar dirty={false} />)

  await user.click(screen.getByRole('link', { name: 'Templates' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText('left for /templates')).toBeTruthy()
})
