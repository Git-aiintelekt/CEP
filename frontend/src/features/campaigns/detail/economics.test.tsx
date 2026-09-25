/** The Economics card's sums: headline variants, the planned-spend line, signs and tones of the differences, and the meter. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import type { CampaignTargets } from '@/lib/types'
import { metrics } from '@/test/mockCampaigns'

import { Meter } from '../parts'
import { economicsHeadline, economicsRows, economicsSubline, hasTargets } from './economics'

const none: CampaignTargets = { target_revenue: null, target_opens: null, target_clicks: null, target_conversions: null, target_redemptions: null, planned_cost: null, planned_offer_cost: null, notes: null }
const noCosts = { campaign: null, offer: null }

afterEach(cleanup)

test('headline: what was spent to earn what, and per conversion, once the cost is known; otherwise conversions from delivered', () => {
  expect(economicsHeadline(metrics, { campaign: 400, offer: 100 })).toBe('Spent $500.00 to earn $1,250.00 · $100.00 per conversion')
  expect(economicsHeadline({ ...metrics, conversions: 0 }, { campaign: 400, offer: null })).toBe('Spent $400.00 to earn $1,250.00')
  expect(economicsHeadline(metrics, noCosts)).toBe('5 conversions from 76 delivered')
  expect(economicsHeadline({ ...metrics, revenue: null }, { campaign: 400, offer: 100 })).toBe('5 conversions from 76 delivered')
  expect(economicsHeadline({ ...metrics, conversions: 1 }, noCosts)).toBe('1 conversion from 76 delivered')
})

test('sub-line: the planned spend and the conversions target, each only when set', () => {
  expect(economicsSubline({ ...none, planned_cost: '500', planned_offer_cost: '200.5', target_conversions: 400 })).toBe('Against a planned spend of $700.50 and a target of 400 conversions.')
  expect(economicsSubline({ ...none, planned_offer_cost: '200' })).toBe('Against a planned spend of $200.00.')
  expect(economicsSubline({ ...none, target_conversions: 1 })).toBe('Against a target of 1 conversion.')
  expect(economicsSubline(none)).toBeNull()
})

test('differences: + and − signs, better is higher for results and lower for costs, "—" without a target or an actual', () => {
  const rows = economicsRows({ ...none, target_opens: 40, target_clicks: 12, target_conversions: 9, target_revenue: '1250', planned_cost: '300', planned_offer_cost: '100' }, metrics,
    { texts: false, costs: { campaign: 250, offer: 180 } })
  const by = Object.fromEntries(rows.map((row) => [row.measure, [row.difference, row.tone]]))
  expect(by.Opens).toEqual(['0', 'better'])                                                             // met exactly
  expect(by.Clicks).toEqual(['0', 'better'])
  expect(by.Conversions).toEqual(['−4', 'worse'])
  expect(by.Revenue).toEqual(['$0.00', 'better'])
  expect(by['Campaign Cost']).toEqual(['−$50.00', 'better'])                                            // under budget
  expect(by['Offer Cost']).toEqual(['+$80.00', 'worse'])
  expect(by['Offer Redemptions']).toEqual(['—', 'none'])

  const texts = economicsRows({ ...none, target_opens: 40 }, metrics, { texts: true, costs: noCosts })
  expect(texts[0]).toEqual({ measure: 'Opens', target: '40', actual: '—', difference: '—', tone: 'none' })   // texts have no opens
})

test('targets saved with nothing in them count as none', () => {
  expect(hasTargets(null)).toBe(false)
  expect(hasTargets(none)).toBe(false)
  expect(hasTargets({ ...none, notes: 'Holiday push' })).toBe(true)
  expect(hasTargets({ ...none, target_clicks: 0 })).toBe(true)
})

test('meter: an 8px bar on the Gray 100 track, brand until the target is met, then success', () => {
  render(<><Meter label="Clicks" actual={12} target={40} percent={30} /><Meter label="Revenue" actual={30000} target={25000} percent={120} money /></>)
  const clicks = screen.getByRole('progressbar', { name: 'Clicks against target' })
  expect(clicks.className).toContain('h-2')
  expect(clicks.className).toContain('rounded-xs')
  expect(clicks.className).toContain('bg-line-subtle')
  expect((clicks.firstElementChild as HTMLElement).className).toContain('bg-brand-600')
  const revenue = screen.getByRole('progressbar', { name: 'Revenue against target' })
  expect(revenue.getAttribute('aria-valuenow')).toBe('100')
  expect((revenue.firstElementChild as HTMLElement).className).toContain('bg-success')
  expect(screen.getByText('$30,000 of $25,000 · 120%')).toBeTruthy()
})
