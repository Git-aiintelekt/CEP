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

test('Versions lists every version newest first, the live one tagged Live', async () => {
  installMockApi({
    journey: makeJourney({ id: 'j1', status: 'ACTIVE', current_version: 'jv2' }),
    journeyVersions: [
      makeJourneyVersion({ status: 'RETIRED', status_label: 'Retired', published_at: '2026-08-27T09:00:00Z' }),
      makeJourneyVersion({ id: 'jv2', version_number: 2, status: 'ACTIVE', status_label: 'Active', published_at: '2026-09-20T09:00:00Z' }),
    ],
  })
  await renderAppAt('/journeys/j1')

  const table = await screen.findByRole('table', { name: 'Journey versions' })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows[0].textContent).toContain('Version 2')
  expect(within(rows[0]).getByText('Live')).toBeTruthy()
  expect(rows[1].textContent).toContain('Version 1')
  expect(within(rows[1]).queryByText('Live')).toBeNull()
})

test('Archive Journey asks first, then ends the journey and hides Edit Journey', async () => {
  const calls = installMockApi({
    journey: makeJourney({ id: 'j1', status: 'ACTIVE' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE' })],
    journeyMetrics: makeJourneyMetrics({ in_journey: 12 }),
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')

  await user.click(await screen.findByRole('button', { name: 'Archive Journey' }))
  const dialog = await screen.findByRole('dialog', { name: 'Archive This Journey?' })
  expect(dialog.textContent).toContain('the 12 customers in it leave')
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(calls.some((call) => call.url.endsWith('/archive/'))).toBe(false)

  await user.click(screen.getByRole('button', { name: 'Archive Journey' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Archive This Journey?' })).getByRole('button', { name: 'Archive Journey' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/archive/'))).toBe(true))
  await screen.findByText(/is archived; 12 customers left it\./)
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Archive Journey' })).toBeNull())
  expect(screen.queryByRole('link', { name: 'Edit Journey' })).toBeNull()
})

test('a scheduled journey offers Cancel Schedule, which takes it back to Test Publish', async () => {
  const calls = installMockApi({
    journey: makeJourney({ id: 'j1', status: 'APPROVED', scheduled_activate_at: '2026-10-09T09:00:00Z' }),
    journeyVersions: [makeJourneyVersion({ status: 'TEST_PUBLISHED' })],
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')

  await user.click(await screen.findByRole('button', { name: 'Cancel Schedule' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/cancel-schedule/'))).toBe(true))
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel Schedule' })).toBeNull())
})

test('a live journey’s new draft is announced, with Test Publish Version 2; the live version keeps its Live tag', async () => {
  installMockApi({
    journey: makeJourney({ id: 'j1', status: 'ACTIVE', current_version: 'jv1' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', status_label: 'Active' }), makeJourneyVersion({ id: 'jv2', version_number: 2 })],
  })
  await renderAppAt('/journeys/j1')

  await screen.findByText('Version 2 is a draft. The live version keeps running; test publish the new one, then approve it to replace the live version.')
  expect(screen.getByRole('link', { name: 'Test Publish Version 2' }).getAttribute('href')).toBe('/journeys/j1/test-publish')
  const rows = within(await screen.findByRole('table', { name: 'Journey versions' })).getAllByRole('row').slice(1)
  expect(within(rows[1]).getByText('Live')).toBeTruthy()
})

test('a live journey’s scheduled new version: the date, a Scheduled tag, and Cancel Schedule keeps the journey Active', async () => {
  const calls = installMockApi({
    journey: makeJourney({ id: 'j1', status: 'ACTIVE', current_version: 'jv2', scheduled_activate_at: '2026-10-09T09:00:00Z' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', status_label: 'Active' }),
                      makeJourneyVersion({ id: 'jv2', version_number: 2, status: 'TEST_PUBLISHED', status_label: 'Test Published' })],
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')

  await screen.findByText(/^Version 2 replaces the live version on .*; the live version keeps running until then\.$/)
  const rows = within(await screen.findByRole('table', { name: 'Journey versions' })).getAllByRole('row').slice(1)
  expect(within(rows[0]).getByText('Scheduled')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Test Publish Version 2' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Cancel Schedule' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/cancel-schedule/'))).toBe(true))
  await screen.findByText('Version 2 is tested and waiting for approval. The live version keeps running until it is approved.')
  expect(screen.getByRole('link', { name: 'Test Publish Version 2' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Pause Journey' })).toBeTruthy()
})

test('Goal edits in place against its 500-character limit', async () => {
  installMockApi({ journey: makeJourney({ id: 'j1', status: 'DRAFT', goal_description: null }), journeyVersions: [makeJourneyVersion()] })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')

  await user.click(await screen.findByRole('button', { name: 'Edit Goal' }))
  const goal = screen.getByLabelText('Goal') as HTMLTextAreaElement
  expect(goal.maxLength).toBe(500)
  await user.type(goal, 'First purchase in 30 days')
  expect(screen.getByLabelText('25 of 500 characters')).toBeTruthy()
})

test('the Customers card lists everyone enrolled with where they are, and opening one shows their timeline', async () => {
  installMockApi({ journey: makeJourney({ id: 'j1', status: 'ACTIVE' }), journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', published_at: '2026-08-27T09:00:00Z' })] })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')
  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })

  const table = await screen.findByRole('table', { name: 'Customers in the journey' })
  expect(within(table).getByText('Marcus Hale')).toBeTruthy()
  expect(within(table).getByText('Wait 3 days')).toBeTruthy()                       // Aaliyah is waiting there
  expect(within(table).getByText('Goal reached')).toBeTruthy()                       // Marcus completed through the goal
  await user.type(screen.getByLabelText('Search customers'), 'aali')
  await vi.waitFor(() => expect(within(table).queryByText('Marcus Hale')).toBeNull())

  await user.click(within(table).getByRole('button', { name: 'Aaliyah Brooks' }))
  const drawer = await screen.findByRole('dialog', { name: 'Aaliyah Brooks' })
  expect(within(drawer).getByText(/Entered .* · version 1 · In Journey/)).toBeTruthy()
  const timeline = within(drawer).getByRole('list', { name: 'Customer timeline' })
  expect(within(timeline).getByText('Email: Welcome')).toBeTruthy()
  expect(within(timeline).getByText(/delivered .* · opened/)).toBeTruthy()
  expect(within(timeline).getByText(/waiting until/)).toBeTruthy()
})

test('the Suppressions card adds a customer by email, says they left the journey, and removes them again', async () => {
  installMockApi({ journey: makeJourney({ id: 'j1', status: 'ACTIVE' }), journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', published_at: '2026-08-27T09:00:00Z' })] })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1')
  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })

  expect(await screen.findByText('Nobody is suppressed for this journey.')).toBeTruthy()
  await user.type(screen.getByLabelText('Customer to suppress'), 'nobody')
  await user.click(screen.getByRole('button', { name: 'Suppress' }))
  expect((await screen.findByRole('alert')).textContent).toContain('No customer has that email address')

  await user.clear(screen.getByLabelText('Customer to suppress'))
  await user.type(screen.getByLabelText('Customer to suppress'), 'dolores@example.com')
  await user.type(screen.getByLabelText('Suppression note'), 'asked to be left out')
  await user.click(screen.getByRole('button', { name: 'Suppress' }))
  const list = await screen.findByRole('list', { name: 'Suppressed customers' })
  expect(within(list).getByText('Dolores Alvarez')).toBeTruthy()
  expect(within(list).getByText(/asked to be left out/)).toBeTruthy()
  expect(screen.getByText('Taken out of the journey now.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()

  await user.click(within(list).getByRole('button', { name: 'Remove' }))
  expect(await screen.findByText('Nobody is suppressed for this journey.')).toBeTruthy()
})
