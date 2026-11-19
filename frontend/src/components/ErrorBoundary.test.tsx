/** The error screen: a real fault is shown and reported; a screen from a build the server no longer has (C360 upgraded while the page was open) says so plainly and is not reported. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { isStaleBuild } from '@/lib/staleBuild'

vi.mock('@/lib/errorReporter', () => ({ reportError: vi.fn(() => true) }))

function Throws({ message }: { message: string }): never {
  throw new Error(message)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('the browsers’ words for a module the server no longer has are all read as an older build', () => {
  expect(isStaleBuild(new Error('Failed to fetch dynamically imported module: https://cep.example.com/assets/JourneyCanvas-BXF3K9Nu.js'))).toBe(true)
  expect(isStaleBuild(new Error('error loading dynamically imported module: https://cep.example.com/assets/x.js'))).toBe(true)
  expect(isStaleBuild(new Error('Importing a module script failed.'))).toBe(true)
  expect(isStaleBuild(new Error('Cannot read properties of undefined'))).toBe(false)
})

test('after an upgrade, an old page opening a new screen is told to reload, and nothing is reported', async () => {
  const { reportError } = await import('@/lib/errorReporter')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  render(<ErrorBoundary><Throws message="Failed to fetch dynamically imported module: https://cep.example.com/assets/JourneyCanvas-BXF3K9Nu.js" /></ErrorBoundary>)

  expect(screen.getByText('C360 has been updated')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Reload to open this screen' })).toBeTruthy()
  expect(screen.queryByText(/JourneyCanvas/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  expect(reportError).not.toHaveBeenCalled()
})

test('a real fault still shows its message and is reported', async () => {
  const { reportError } = await import('@/lib/errorReporter')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  render(<ErrorBoundary><Throws message="Cannot read properties of undefined" /></ErrorBoundary>)

  expect(screen.getByRole('heading', { name: 'This screen could not be shown' })).toBeTruthy()
  expect(screen.getByText('Cannot read properties of undefined')).toBeTruthy()
  expect(reportError).toHaveBeenCalledTimes(1)
})
