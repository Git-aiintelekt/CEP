import { expect, test } from 'vitest'

import { DEFAULT_FILTERS } from './data/types'
import { homeLayout, packCards, type Availability, type CardKey, type SectionKey } from './homeLayout'

const ALL: SectionKey[] = ['attention', 'createNew', 'revenueCost', 'funnel', 'topBottom', 'schedule', 'snapshot', 'recent', 'governance', 'eReceipts']
const every = (value: Availability) => Object.fromEntries(ALL.map((key) => [key, value])) as Record<SectionKey, Availability>
/** only these cards there (Needs Attention and Create New present) */
const onlyCards = (cards: CardKey[]) => ({ ...every('unavailable'), attention: 'ready' as const, createNew: 'ready' as const, ...Object.fromEntries(cards.map((card) => [card, 'ready' as const])) })
const shape = (rows: { layout: string; cards: string[] }[]) => rows.map((row) => `${row.layout} ${row.cards.join(' | ')}`)
const one = { ...DEFAULT_FILTERS, campaignIds: ['c06'] }

test('everything there: the design, unchanged', () => {
  const layout = homeLayout({ filters: DEFAULT_FILTERS, availability: every('ready') })
  expect(layout.mode).toBe('design')
  expect(shape(layout.rows)).toEqual(['2:1 revenueCost | funnel', '1:1 topBottom | schedule', 'thirds snapshot | governance | eReceipts', 'full recent'])
  expect(layout.rows.map((row) => row.name)).toEqual(['a', 'b', 'c', 'd'])
})

test('live today with e-receipts: Recent takes the odd row; the rest pair in page order', () => {
  const layout = homeLayout({ filters: DEFAULT_FILTERS, availability: onlyCards(['funnel', 'topBottom', 'schedule', 'snapshot', 'recent', 'eReceipts']) })
  expect(layout.mode).toBe('pack')
  expect(shape(layout.rows)).toEqual(['1:1 funnel | topBottom', '1:1 schedule | snapshot', '1:1 eReceipts | recent'])
})

test('live today without e-receipts: Recent alone at the end', () => {
  const layout = homeLayout({ filters: DEFAULT_FILTERS, availability: onlyCards(['funnel', 'topBottom', 'schedule', 'snapshot', 'recent', 'eReceipts']), eReceiptsOn: false })
  expect(shape(layout.rows)).toEqual(['1:1 funnel | topBottom', '1:1 schedule | snapshot', 'full recent'])
})

test('light (no e-receipts): Recent takes the odd row, Governance pairs with the snapshot', () => {
  const layout = homeLayout({ filters: DEFAULT_FILTERS, availability: { ...every('ready'), eReceipts: 'empty' } })
  expect(shape(layout.rows)).toEqual(['2:1 revenueCost | funnel', '1:1 topBottom | schedule', '1:1 snapshot | governance', 'full recent'])
})

test('two cards pair; one card stands alone; none, no rows', () => {
  expect(shape(packCards(['schedule', 'recent']))).toEqual(['1:1 schedule | recent'])
  expect(shape(packCards(['funnel']))).toEqual(['full funnel'])
  expect(shape(packCards(['governance']))).toEqual(['full governance'])
  expect(packCards([])).toEqual([])
  expect(homeLayout({ filters: DEFAULT_FILTERS, availability: every('unavailable') }).rows).toEqual([])
})

test('the odd card follows the preference: Recent, Marketing Performance, Top Campaigns, Next 7 Days, Funnel, Snapshot; never Governance or E-Receipts beside others', () => {
  expect(shape(packCards(['topBottom', 'funnel', 'governance']))).toEqual(['1:1 funnel | governance', 'full topBottom'])
  expect(shape(packCards(['revenueCost', 'schedule', 'snapshot']))).toEqual(['full revenueCost', '1:1 schedule | snapshot'])
  expect(shape(packCards(['funnel', 'governance', 'eReceipts']))).toEqual(['full funnel', '1:1 governance | eReceipts'])
  expect(shape(packCards(['governance', 'eReceipts']))).toEqual(['1:1 governance | eReceipts'])
  expect(shape(packCards(['funnel', 'recent']))).toEqual(['1:2 funnel | recent'])                          // a small card first: one third, then two
})

test('one campaign: the design row when Next 7 Days and Governance are both there; packed when one is missing', () => {
  const complete = homeLayout({ filters: one, availability: every('ready') })
  expect(complete.mode).toBe('design')
  expect(shape(complete.rows)).toEqual(['2:1 revenueCost | funnel', '1:1 schedule | governance'])
  const noGovernance = homeLayout({ filters: one, availability: { ...every('ready'), governance: 'unavailable' } })
  expect(noGovernance.mode).toBe('pack')
  expect(shape(noGovernance.rows)).toEqual(['full revenueCost', '1:1 funnel | schedule'])
  const liveToday = homeLayout({ filters: one, availability: { ...every('ready'), revenueCost: 'unavailable', governance: 'unavailable' } })
  expect(shape(liveToday.rows)).toEqual(['1:1 funnel | schedule'])
  const onlySchedule = homeLayout({ filters: one, availability: onlyCards(['schedule']) })
  expect(shape(onlySchedule.rows)).toEqual(['full schedule'])
  expect(homeLayout({ filters: { ...DEFAULT_FILTERS, campaignIds: ['a', 'b'] }, availability: every('ready') }).singleCampaign).toBe(false)
})

test('Needs Attention hides when it has no alert groups or can’t be read, in either view', () => {
  expect(homeLayout({ filters: DEFAULT_FILTERS, availability: { ...every('ready'), attention: 'empty' } }).attention).toBe(false)
  expect(homeLayout({ filters: DEFAULT_FILTERS, availability: { ...every('ready'), attention: 'unavailable' } }).attention).toBe(false)
  expect(homeLayout({ filters: one, availability: { ...every('ready'), attention: 'empty' } }).attention).toBe(false)
})
