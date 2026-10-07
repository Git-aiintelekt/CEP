/** A drip in a line or two: the progress under its name and its Next Send, for every state; other campaigns get none. */
import { expect, test } from 'vitest'

import { makeCampaign } from '@/test/mockApi'

import { dripNextSend, dripProgressText } from './dripLines'

const ZONE = 'America/Chicago'
const drip = (overrides = {}) => makeCampaign({ campaign_type: 'DRIP', send_type: 'DRIP', send_timezone: ZONE, ...overrides })
const NOW = Date.parse('2026-10-17T12:00:00Z')

test('progress: sent so far, starts, stopped, draft; never for a regular or a journey campaign', () => {
  expect(dripProgressText(drip({ status: 'ACTIVE', drip_progress: { total: 4, sent: 2, failed: 0, cancelled: 0, next: null } }), ZONE)).toBe('2 of 4 messages sent')
  expect(dripProgressText(drip({ status: 'PRODUCTION_PUBLISHED', drip_progress: { total: 5, sent: 0, failed: 0, cancelled: 0, next: { position: 1, name: 'Hi', scheduled_at: '2026-10-26T13:00:00Z' } } }), ZONE)).toBe('5 messages · starts Mon 26 Oct')
  expect(dripProgressText(drip({ status: 'COMPLETED', stopped_early: { at: '2026-09-10T15:00:00Z', by_name: null, cancelled: 3 }, drip_progress: { total: 5, sent: 2, failed: 0, cancelled: 3, next: null } }), ZONE)).toBe('Stopped after 2 of 5')
  expect(dripProgressText(drip({ status: 'DRAFT', drip_summary: { count: 3, last_day: 7, first_send_at: null, last_send_at: null, ready: false } }), ZONE)).toBe('3 messages · draft')
  expect(dripProgressText(makeCampaign({ status: 'ACTIVE' }), ZONE)).toBeNull()
  expect(dripProgressText(drip({ is_journey_generated: true, status: 'ACTIVE' }), ZONE)).toBeNull()
})

test('Next Send: the date and "09:00 CT · Message 3 of 4"; paused "On hold" with what was due; finished "None"', () => {
  const next = { position: 3, name: 'First Reward', scheduled_at: '2026-10-19T14:00:00Z' }
  expect(dripNextSend(drip({ status: 'ACTIVE', drip_progress: { total: 4, sent: 2, failed: 0, cancelled: 0, next } }), ZONE, NOW)?.detail).toBe('09:00 CT · Message 3 of 4')
  expect(dripNextSend(drip({ status: 'PAUSED', drip_progress: { total: 4, sent: 2, failed: 0, cancelled: 0, next: { ...next, scheduled_at: '2026-10-16T14:00:00Z' } } }), ZONE, NOW))
    .toEqual({ day: 'On hold', detail: 'Message 3 was due Fri 16 Oct' })
  expect(dripNextSend(drip({ status: 'PAUSED', drip_progress: { total: 4, sent: 2, failed: 0, cancelled: 0, next } }), ZONE, NOW)).toEqual({ day: 'On hold', detail: 'Message 3 due Mon 19 Oct' })
  expect(dripNextSend(drip({ status: 'COMPLETED', drip_progress: { total: 4, sent: 4, failed: 0, cancelled: 0, next: null } }), ZONE, NOW)).toEqual({ day: 'None', detail: null })
  expect(dripNextSend(drip({ status: 'DRAFT' }), ZONE, NOW)).toBeNull()
})
