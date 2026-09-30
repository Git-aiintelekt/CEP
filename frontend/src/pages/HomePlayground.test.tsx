import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import HomePlayground from './HomePlayground'

afterEach(cleanup)

const tile = (label: string) => document.querySelector(`[data-kpi="${label}"]`) as HTMLElement

test('/dev/home shows the Home page on sample data, with the account state and viewer switches', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/dev/home']}><HomePlayground /></MemoryRouter>)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Sarah$/)
  expect(screen.getByRole('region', { name: 'Active Journeys' })).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: 'Light' }))
  expect(screen.queryByRole('region', { name: 'Active Journeys' })).toBeNull()

  await user.click(screen.getByRole('radio', { name: 'No Attribution' }))
  await user.click(screen.getByRole('radio', { name: 'Not Admin' }))
  expect(tile('Attributed Revenue').textContent).toContain('Ask an admin to set up attribution.')
})

test('the read-only viewer: no Create New, and the KPI access line instead of the strip', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/dev/home']}><HomePlayground /></MemoryRouter>)
  await user.click(screen.getByRole('radio', { name: 'Viewer (Read Only)' }))
  expect(screen.queryByRole('region', { name: 'Create New' })).toBeNull()
  expect(screen.getByText('You don’t have access to performance reports.')).toBeTruthy()
  expect(screen.queryByRole('group', { name: 'Marketing Performance' })).toBeNull()
})
