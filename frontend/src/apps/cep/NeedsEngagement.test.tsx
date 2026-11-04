import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

const INSIGHTS = { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }
const insightsAlone = { ...me, components: [INSIGHTS] }

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('a workspace with Insights alone lands on Insights, not on the Engagement Home', async () => {
  installMockApi({ me: insightsAlone as never })
  await renderAppAt('/')
  await vi.waitFor(() => expect(window.location.pathname).toMatch(/^\/insights/), { timeout: 4000 })
  expect(screen.queryByRole('heading', { name: 'Marketing Performance' })).toBeNull()
})

test('an Engagement page in a workspace with Insights alone says the workspace does not have it, and an editor goes to Insights', async () => {
  installMockApi({ me: insightsAlone as never })
  await renderAppAt('/campaigns')
  expect(await screen.findByText('This workspace does not have Engagement')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Campaigns' })).toBeNull()
  cleanup()
  await renderAppAt('/journeys/j1/build')
  await vi.waitFor(() => expect(window.location.pathname).toMatch(/^\/insights/), { timeout: 4000 })
})

test('without Engagement the campaign shortcuts are gone: n opens nothing, and the shortcuts list leaves them out', async () => {
  installMockApi({ me: insightsAlone as never })
  await renderAppAt('/settings/users')
  await screen.findByRole('table', { name: 'Users' })
  const user = userEvent.setup()
  await user.keyboard('n')
  expect(window.location.pathname).toBe('/settings/users')
  await user.keyboard('?')
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
  expect(dialog.textContent).toContain('Search')
  expect(dialog.textContent).not.toContain('Create a campaign')
})

test('a workspace with Engagement still gets Home at /', async () => {
  installMockApi()
  await renderAppAt('/')
  await screen.findByRole('heading', { name: /Good (morning|afternoon|evening)/ }, { timeout: 4000 })
  expect(window.location.pathname).toBe('/')
})
