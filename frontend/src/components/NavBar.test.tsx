import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { useLeaveGuard } from '@/features/designer/useLeaveGuard'

import { NavBar } from './NavBar'

const has = vi.fn((_feature: string) => true)
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ has }) }))

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

test('the bar carries the five destinations, with the editor’s own section marked current', () => {
  renderBar()
  const bar = screen.getByRole('navigation', { name: 'Main' })
  expect([...bar.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'))).toEqual([
    'CEP overview',
    'Overview',
    'Campaigns',
    'Journeys',
    'Templates',
    'Contact lists',
  ])

  const templates = screen.getByRole('link', { name: 'Templates' })
  expect(templates.getAttribute('aria-current')).toBe('page')
  expect(templates.className).toContain('bg-brand-600')
  expect(screen.getByRole('link', { name: 'Campaigns' }).className).toContain('text-sidebar-icon')
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

  await user.click(screen.getByRole('link', { name: 'CEP overview' }))
  expect(onNavigate).toHaveBeenCalledWith('/', expect.anything())
})

test('the targets are the design’s 44px tiles on the navy bar, with 22px icons', () => {
  renderBar()
  const bar = screen.getByRole('navigation', { name: 'Main' })
  expect(bar.className).toContain('w-[72px]')
  expect(bar.className).toContain('bg-sidebar')

  const templates = screen.getByRole('link', { name: 'Templates' })
  expect(templates.className).toContain('h-11')
  expect(templates.className).toContain('w-11')
  expect(templates.className).toContain('rounded-lg')
  expect(templates.querySelector('svg')?.getAttribute('width')).toBe('22')
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

  await user.click(screen.getByRole('button', { name: 'Leave without saving' }))
  expect(screen.getByText('left for /campaigns')).toBeTruthy()
})

test('with nothing unsaved a link goes straight there', async () => {
  const user = userEvent.setup()
  render(<GuardedBar dirty={false} />)

  await user.click(screen.getByRole('link', { name: 'Templates' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText('left for /templates')).toBeTruthy()
})
