/**
 * Journey Details (phase 6d): the notice banner and lifecycle action change with status, the metric cards show
 * "—" for a Draft journey instead of zeros, and the Generated Campaigns table shows real rows or its empty state.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { installMockApi, makeJourney, makeJourneyMetrics, makeJourneyVersion, signIn } from '@/test/mockApi'

afterEach(() => cleanup())

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

test('a Draft journey shows "Not published" banner, dashes on every metric, and a Publish Journey link to the builder', async () => {
  installMockApi({
    journey: makeJourney({ id: 'j1', status: 'DRAFT' }),
    journeyVersions: [makeJourneyVersion()],
    journeyMetrics: makeJourneyMetrics({ enrolled: null, in_journey: null, goal_converted: null, goal_converted_pct: null, exited_early: null, exited_early_pct: null }),
  })
  await renderAppAt('/journeys/j1')

  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })
  expect(screen.getByText('Not published — no contacts enrolled yet.')).toBeTruthy()

  const performance = screen.getByRole('heading', { name: 'Performance' }).closest('section')!
  const dashes = within(performance).getAllByText('—')
  expect(dashes.length).toBeGreaterThanOrEqual(4)                                  // Enrolled / In Journey / Goal Converted / Exited Early

  const publish = screen.getByRole('link', { name: 'Publish Journey' })
  expect(publish.getAttribute('href')).toBe('/journeys/j1/build')

  // the chart only shows for a published journey
  expect(screen.queryByText('Enrollment Over Time')).toBeNull()
})

test('an Active journey shows real metrics, no banner, and a Pause Journey button that pauses it', async () => {
  const calls = installMockApi({
    journey: makeJourney({ id: 'j1', status: 'ACTIVE' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', published_at: '2026-08-27T09:00:00Z' })],
    journeyMetrics: makeJourneyMetrics({ enrolled: 55, in_journey: 40, goal_converted: 12, goal_converted_pct: 21.8, exited_early: 3, exited_early_pct: 5.5 }),
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')

  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })
  expect(screen.queryByText('Not published — no contacts enrolled yet.')).toBeNull()
  expect(screen.queryByText(/Paused/)).toBeNull()

  const performance = screen.getByRole('heading', { name: 'Performance' }).closest('section')!
  await vi.waitFor(() => expect(within(performance).getByText('55')).toBeTruthy())
  expect(within(performance).getByText('40')).toBeTruthy()
  expect(within(performance).getByText('21.8% of enrolled')).toBeTruthy()

  const pauseButton = screen.getByRole('button', { name: 'Pause Journey' })
  await user.click(pauseButton)
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/pause/'))).toBe(true))
  await screen.findByRole('button', { name: 'Resume Journey' })
})

test('a Paused journey shows the held-contacts banner and a Resume Journey button', async () => {
  const calls = installMockApi({
    journey: makeJourney({ id: 'j1', status: 'PAUSED', updated_at: '2026-09-20T10:00:00Z' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE' })],
    journeyMetrics: makeJourneyMetrics({ in_journey: 7 }),
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')

  await screen.findByText(/Paused .* new enrollments halted, 7 contacts held in place\./)

  const resumeButton = screen.getByRole('button', { name: 'Resume Journey' })
  await user.click(resumeButton)
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/resume/'))).toBe(true))
  await screen.findByRole('button', { name: 'Pause Journey' })
})

test('Generated Campaigns shows real rows linking to the real campaign page', async () => {
  installMockApi({
    journey: makeJourney({ id: 'j1', status: 'ACTIVE' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE' })],
  })
  await renderAppAt('/journeys/j1')

  const table = await screen.findByRole('table', { name: 'Generated campaigns' })
  const link = within(table).getByRole('link', { name: /New Loyalty Member Welcome/ })
  expect(link.getAttribute('href')).toBe('/campaigns/c1')
  expect(within(table).getByText('Completed')).toBeTruthy()
})

test('Generated Campaigns empty state tells a Draft journey to publish first', async () => {
  installMockApi({
    journey: makeJourney({ id: 'j1', status: 'DRAFT' }),
    journeyVersions: [makeJourneyVersion()],
    journeyGeneratedCampaigns: [],
  })
  await renderAppAt('/journeys/j1')

  await screen.findByText('No campaigns generated yet')
  expect(screen.getByText('Publish the journey to start generating campaigns.')).toBeTruthy()
})
