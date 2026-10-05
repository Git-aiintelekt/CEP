/**
 * Test Publish + Approve: the Run Test Publish button is gated by the 4 readiness checks, running a test shows real
 * results (success, and a partial-delivery / failure case), the Approve modal's Activate-now and Schedule-later
 * paths both work, and "View This Journey" links to the real Journey Details page (phase 6d).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { installMockApi, makeJourney, makeJourneyReadiness, makeJourneyTestResult, makeJourneyVersion, signIn } from '@/test/mockApi'
import type { JourneyGraph } from '@/lib/types'

afterEach(() => cleanup())

const GRAPH: JourneyGraph = {
  entry_rules: [{ entry_type: 'EVENT', rule_definition: { event_type: 'LOYALTY_ENROLLED' } }],
  nodes: [
    { key: 'start', type: 'START', config: {}, position: { x: 0, y: 0 } },
    { key: 'sms-1', type: 'SMS', config: { template_id: 'tpl-sms' }, position: { x: 0, y: 150 } },
    { key: 'exit', type: 'EXIT', config: {}, position: { x: 0, y: 300 } },
  ],
  connections: [
    { from: 'start', to: 'sms-1', branch_key: null, label: null },
    { from: 'sms-1', to: 'exit', branch_key: null, label: null },
  ],
}

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

test('Run Test Publish is disabled until every readiness check passes', async () => {
  installMockApi({
    journey: makeJourney(),
    journeyVersions: [makeJourneyVersion()],
    journeyGraph: GRAPH,
    journeyReadiness: makeJourneyReadiness({
      ready: false,
      items: [
        { key: 'entry_rules', label: 'Entry rules configured', description: 'Loyalty enrollment event.', ok: true },
        { key: 'steps_configured', label: 'All canvas steps configured', description: '1 of 2 steps have complete settings.', ok: false },
        { key: 'templates_ready', label: 'Templates ready', description: 'Email and SMS templates are published in Template Studio.', ok: true },
        { key: 'governance', label: 'Governance rules satisfied', description: 'Frequency caps and quiet hours pass for this population.', ok: true },
      ],
    }),
  })
  await renderAppAt('/journeys/j1/test-publish')

  expect(await screen.findByText('1 of 2 steps have complete settings.')).toBeTruthy()
  const runButton = screen.getByRole('button', { name: 'Run Test Publish' }) as HTMLButtonElement
  expect(runButton.disabled).toBe(true)
  expect(screen.getByRole('img', { name: '3 of 4 checks passed' })).toBeTruthy()
  expect(screen.getByText('1 Check to Fix')).toBeTruthy()
  // an SMS-only journey: the Email preview tab shows, disabled
  expect(screen.getByRole('tab', { name: 'Email' }).getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByRole('tab', { name: 'SMS' }).getAttribute('aria-selected')).toBe('true')
})

test('running a test sends a real request and shows the results, including a partial-delivery case', async () => {
  const calls = installMockApi({
    journey: makeJourney(),
    journeyVersions: [makeJourneyVersion()],
    journeyGraph: GRAPH,
    journeyTestResult: makeJourneyTestResult({ sent_to: 50, delivered: 40, opened: 10, clicked: 2, bounced: 5, governance_flags: ['FREQUENCY_CAP'] }),
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/test-publish')

  const runButton = await screen.findByRole('button', { name: 'Run Test Publish' }) as HTMLButtonElement
  expect(runButton.disabled).toBe(false)
  await user.click(runButton)

  const modal = await screen.findByRole('dialog', { name: 'Send This Test Now?' })
  await user.click(within(modal).getByRole('button', { name: 'Send Test' }))

  expect(await screen.findByText('Approve & Activate →')).toBeTruthy()
  expect(screen.getByText('40')).toBeTruthy()
  expect(screen.getByText(/FREQUENCY_CAP/)).toBeTruthy()
  expect(screen.getByText('Test run completed just now for 50 customers.')).toBeTruthy()
  expect(screen.getByText('SMS Delivered').nextElementSibling?.textContent).toBe('40/50')
  expect(calls.some((call) => call.method === 'POST' && call.url.includes('/test-publish/'))).toBe(true)
})

test('Approve: Activate Immediately goes live right away', async () => {
  installMockApi({
    journey: makeJourney(),
    journeyVersions: [makeJourneyVersion()],
    journeyGraph: GRAPH,
    journeyTestResult: makeJourneyTestResult(),
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/test-publish')

  await user.click(await screen.findByRole('button', { name: 'Run Test Publish' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Send This Test Now?' })).getByRole('button', { name: 'Send Test' }))
  await user.click(await screen.findByRole('button', { name: 'Approve & Activate →' }))

  const approveModal = await screen.findByRole('dialog', { name: 'Activate This Journey?' })
  await user.click(within(approveModal).getByRole('button', { name: 'Activate Journey' }))

  expect(await screen.findByRole('heading', { name: 'Journey Is Now Live' })).toBeTruthy()
  expect(await screen.findByText('120 customers')).toBeTruthy()
})

test('Approve: Schedule for Later keeps it Approved · Scheduled', async () => {
  installMockApi({
    journey: makeJourney(),
    journeyVersions: [makeJourneyVersion()],
    journeyGraph: GRAPH,
    journeyTestResult: makeJourneyTestResult(),
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/test-publish')

  await user.click(await screen.findByRole('button', { name: 'Run Test Publish' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Send This Test Now?' })).getByRole('button', { name: 'Send Test' }))
  await user.click(await screen.findByRole('button', { name: 'Approve & Activate →' }))

  const approveModal = await screen.findByRole('dialog', { name: 'Activate This Journey?' })
  await user.click(within(approveModal).getByRole('radio', { name: /Schedule for Later/ }))
  const scheduleButton = within(approveModal).getByRole('button', { name: 'Schedule Journey' }) as HTMLButtonElement
  expect(scheduleButton.disabled).toBe(true)

  await user.click(within(approveModal).getByRole('button', { name: /^Activation Date/ }))
  await user.click(within(approveModal).getByRole('button', { name: 'Next Month' }))
  await user.click(within(approveModal).getByRole('button', { name: /^\w+, \w+ 15, \d{4}$/ }))
  expect(scheduleButton.disabled).toBe(true)
  await user.click(within(approveModal).getByRole('button', { name: /^Activation Time/ }))
  await user.click(within(approveModal).getByRole('button', { name: '9:00 AM' }))
  expect(scheduleButton.disabled).toBe(false)
  await user.click(scheduleButton)

  expect(await screen.findByRole('heading', { name: 'Journey Is Scheduled to Activate' })).toBeTruthy()
})

test('"View This Journey" links to the real Journey Details page', async () => {
  installMockApi({
    journey: makeJourney({ status: 'ACTIVE' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE' })],
    journeyGraph: GRAPH,
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/test-publish')

  expect(await screen.findByRole('heading', { name: 'Journey Is Now Live' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to Build' }).getAttribute('href')).toBe('/journeys/j1/build')
  expect(screen.getByRole('link', { name: 'Go to Journey Dashboard →' }).getAttribute('href')).toBe('/journeys')
  const link = screen.getByRole('link', { name: 'View This Journey' })
  await user.click(link)
  await screen.findByRole('heading', { name: 'New Loyalty Member Welcome', level: 1 })
  expect(screen.getByRole('heading', { name: 'Performance' })).toBeTruthy()
})

test('a live journey with a new version opens on that version’s test; approving it now replaces the live version', async () => {
  const calls = installMockApi({
    journey: makeJourney({ status: 'ACTIVE', current_version: 'jv1' }),
    journeyVersions: [makeJourneyVersion({ status: 'ACTIVE', status_label: 'Active' }), makeJourneyVersion({ id: 'jv2', version_number: 2 })],
    journeyGraph: GRAPH,
    journeyTestResult: makeJourneyTestResult(),
  })
  const user = userEvent.setup()
  await renderAppAt('/journeys/j1/test-publish')

  expect(await screen.findByRole('heading', { name: 'Test Publish' })).toBeTruthy()
  expect(screen.getByText(/You are testing version 2 of a live journey\. The live version keeps running meanwhile/)).toBeTruthy()
  await user.click(await screen.findByRole('button', { name: 'Run Test Publish' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Send This Test Now?' })).getByRole('button', { name: 'Send Test' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/journeys/j1/versions/2/test-publish/'))).toBe(true))
  await user.click(await screen.findByRole('button', { name: 'Approve & Activate →' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Activate This Journey?' })).getByRole('button', { name: 'Activate Journey' }))

  expect(await screen.findByRole('heading', { name: 'Version 2 Is Now Live' })).toBeTruthy()
  expect(screen.getByText('New customers enter version 2 from now on. Customers already inside finish the version they started.')).toBeTruthy()
})
