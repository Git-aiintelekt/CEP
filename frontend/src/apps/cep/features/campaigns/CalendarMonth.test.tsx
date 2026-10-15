import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { todayIn } from '@/apps/cep/features/reports/period'
import type { Campaign } from '@/lib/types'
import { atZone } from '@/lib/zonedTime'
import { cepReady, installMockApi, makeCampaign, makeStep, signIn } from '@/test/mockApi'

const ZONE = 'America/New_York'

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
})

/** `count` one-day campaigns today */
const today = (count: number): Campaign[] => Array.from({ length: count }, (_, index) => makeCampaign({
  id: `m${index}`, name: `Campaign ${index + 1}`, status: 'PRODUCTION_PUBLISHED', runs: [{
    id: `r${index}`, campaign: `m${index}`, tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
    started_at: atZone(todayIn(ZONE), `${String(9 + index).padStart(2, '0')}:00`, ZONE), completed_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', row_version: 1,
  }] as Campaign['runs'],
}))
const bars = (grid: HTMLElement) => within(grid).queryAllByRole('link', { name: /^Campaign \d/ })

test('three campaigns on a day: all three bars, no More', async () => {
  installMockApi({ campaigns: today(3) })
  await renderAppAt('/campaigns?view=calendar')
  const grid = await screen.findByRole('grid')
  await vi.waitFor(() => expect(bars(grid)).toHaveLength(3))
  expect(within(grid).queryByRole('button', { name: /More$/ })).toBeNull()
})

test('five campaigns on a day: two bars, then "+3 More" in the third lane, which lists all five', async () => {
  installMockApi({ campaigns: today(5) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?view=calendar')
  const grid = await screen.findByRole('grid')
  await vi.waitFor(() => expect(bars(grid)).toHaveLength(2))
  const more = within(grid).getByRole('button', { name: '+3 More' })
  expect(more.style.gridRow).toBe('3')
  await user.click(more)
  const modal = await screen.findByRole('dialog')
  expect(within(modal).getAllByRole('link')).toHaveLength(5)
})

// ---------------------------------------------------------------------------------------------------- drips in the month
const monthDay = (day: number) => `${todayIn(ZONE).slice(0, 8)}${String(day).padStart(2, '0')}`
const dripRun = (id: string, step: string, day: number, status: string) => ({
  id, campaign: 'd1', tenant: 't1', run_number: 1, run_type: 'DRIP_INSTANCE', status, test_mode: false, scheduled_at: atZone(monthDay(day), '09:00', ZONE),
  started_at: status === 'COMPLETED' ? atZone(monthDay(day), '09:00', ZONE) : null, completed_at: null, drip_step: step, sequence_label: `Day ${day}`,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', row_version: 1,
})
const loyaltyDrip = (status = 'ACTIVE') => makeCampaign({
  id: 'd1', name: 'Loyalty Welcome Series', campaign_type: 'DRIP', send_type: 'DRIP', status, send_timezone: ZONE,
  runs: [dripRun('r1', 's1', 10, 'COMPLETED'), dripRun('r2', 's2', 12, 'SCHEDULED'), dripRun('r3', 's3', 14, 'SCHEDULED')] as Campaign['runs'],
})
const loyaltySteps = { d1: [makeStep({ id: 's1', day: 0, name: 'Welcome' }), makeStep({ id: 's2', day: 2, name: 'How Points Work' }), makeStep({ id: 's3', day: 4, name: 'First Reward' })] }
const markers = () => [...document.querySelectorAll<HTMLElement>('[data-marker]')]

test('a drip is one bar with a numbered marker on each send day: filled once sent, outlined to come, and a tooltip naming the message', async () => {
  installMockApi({ campaigns: [loyaltyDrip()], dripSteps: loyaltySteps })
  await renderAppAt('/campaigns?view=calendar')
  const grid = await screen.findByRole('grid')
  await vi.waitFor(() => expect(markers()).toHaveLength(3))
  expect(new Set(within(grid).getAllByRole('link', { name: /^Loyalty Welcome Series: / }).map((bar) => bar.textContent))).toEqual(new Set(['Loyalty Welcome Series']))
  expect(markers().map((marker) => [marker.textContent, marker.getAttribute('data-marker-state')])).toEqual([['1', 'sent'], ['2', 'upcoming'], ['3', 'upcoming']])
  expect(markers()[0].className).toContain('bg-tag-completed-bg')
  expect(markers()[1].className).not.toMatch(/brand-600/)
  expect(markers()[1].getAttribute('aria-label')).toMatch(/^Loyalty Welcome Series, Message 2 of 3 · How Points Work · [A-Z][a-z]{2} 12 [A-Z][a-z]{2}, 09:00 ET$/)

  markers()[1].focus()
  expect((await screen.findByRole('tooltip')).textContent).toMatch(/^Message 2 of 3 · How Points Work · [A-Z][a-z]{2} 12 [A-Z][a-z]{2}, 09:00 ET$/)
})

test('a paused drip: the waiting messages have no day, and the bar stops at the last send saying On hold', async () => {
  installMockApi({ campaigns: [loyaltyDrip('PAUSED')], dripSteps: loyaltySteps })
  await renderAppAt('/campaigns?view=calendar')
  const grid = await screen.findByRole('grid')
  await vi.waitFor(() => expect(markers()).toHaveLength(1))
  const bar = within(grid).getByRole('link', { name: /^Loyalty Welcome Series: Paused, on hold/ })
  expect(bar.textContent).toBe('On hold · Loyalty Welcome Series')
})

test('the day pop-up lists each drip message as its own row, the time once; other campaigns as today', async () => {
  const others = Array.from({ length: 3 }, (_, index) => makeCampaign({ id: `m${index}`, name: `Campaign ${index + 1}`, status: 'PRODUCTION_PUBLISHED', runs: [{
    id: `x${index}`, campaign: `m${index}`, tenant: 't1', run_number: 1, run_type: 'ONE_TIME', status: 'COMPLETED', test_mode: false, scheduled_at: null,
    started_at: atZone(monthDay(12), '10:00', ZONE), completed_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', row_version: 1 }] as Campaign['runs'] }))
  installMockApi({ campaigns: [loyaltyDrip(), ...others], dripSteps: loyaltySteps })
  const user = userEvent.setup()
  await renderAppAt('/campaigns?view=calendar')
  const grid = await screen.findByRole('grid')
  await user.click(await within(grid).findByRole('button', { name: /More$/ }))
  const modal = await screen.findByRole('dialog')
  const drip = modal.querySelector('[data-day-row="drip"]')!
  expect(drip.textContent).toBe('Loyalty Welcome Series · Message 2 of 3How Points Work · 09:00 ETScheduled')
  expect(modal.querySelectorAll('[data-day-row="campaign"]')).toHaveLength(3)
})

test('below 768px the month list has each drip message on its own line', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: !query.includes('768'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  installMockApi({ campaigns: [loyaltyDrip()], dripSteps: loyaltySteps })
  await renderAppAt('/campaigns?view=calendar')
  const list = await screen.findByRole('list', { name: /^Campaigns in / })
  await vi.waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3))
  expect(within(list).getAllByRole('listitem').map((item) => item.textContent?.replace(/[A-Z][a-z]+day, .*$/, ''))).toEqual([
    'Loyalty Welcome Series · Message 1 of 3Welcome', 'Loyalty Welcome Series · Message 2 of 3How Points Work', 'Loyalty Welcome Series · Message 3 of 3First Reward'])
})
