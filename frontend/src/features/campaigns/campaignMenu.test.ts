import { expect, test } from 'vitest'

import { makeCampaign } from '@/test/mockApi'

import { campaignPageActions } from './campaignMenu'
import { EDIT_PLACE_OF_TAB, tabOfStep } from './vocabulary'

const all = { edit: true, publish: true }

test('the part of the setup for each tab, and the tab each step leads back to', () => {
  expect(EDIT_PLACE_OF_TAB).toEqual({ overview: 'details', performance: { step: 'targets' }, audience: { step: 'audience' }, content: { step: 'content' }, activity: 'details' })
  const draft = makeCampaign({ status: 'DRAFT' })
  const edit = (tab: string) => campaignPageActions(draft, all, EDIT_PLACE_OF_TAB[tab]).menu.find((item) => item.key === 'edit')
  expect(edit('overview')).toMatchObject({ command: 'edit-details' })                                       // the Edit details pop-up, over the page
  expect(edit('activity')).toMatchObject({ command: 'edit-details' })
  expect(edit('audience')?.to).toBe('/campaigns/c1/edit?step=audience')
  expect(edit('content')?.to).toBe('/campaigns/c1/edit?step=content')
  expect(edit('performance')?.to).toBe('/campaigns/c1/edit?step=targets')
  expect(['audience', 'content', 'targets', 'publish'].map((step) => tabOfStep(step as never, draft))).toEqual(['audience', 'content', 'overview', 'overview'])
  const sent = makeCampaign({ status: 'COMPLETED', runs: [{ id: 'r1', test_mode: false, started_at: '2026-09-18T10:00:00Z', status: 'COMPLETED' }] as never })
  expect(tabOfStep('targets', sent)).toBe('performance')                                                     // the targets live in Economics once there are results
})

test('the main button and ⋮ lead to the right part of Test & publish', () => {
  expect(campaignPageActions(makeCampaign({ status: 'DRAFT' }), all, 'details').main?.to).toBe('/campaigns/c1/edit?step=publish&section=test')
  expect(campaignPageActions(makeCampaign({ status: 'TEST_PUBLISHED' }), all, 'details').main?.to).toBe('/campaigns/c1/edit?step=publish&section=review')
  const menu = campaignPageActions(makeCampaign({ status: 'TEST_PUBLISHED' }), all, 'details').menu
  expect(menu.find((item) => item.key === 'test-publish')?.to).toBe('/campaigns/c1/edit?step=publish&section=test')
})

test('every action of the old header row stays reachable, under the same permissions', () => {
  const keys = (status: string, can = all) => {
    const { main, clone, menu } = campaignPageActions(makeCampaign({ status, setup_step: 6 }), can, 'details')
    return [main?.key, clone && 'clone', ...menu.map((item) => item.key)].filter(Boolean)
  }
  expect(keys('DRAFT')).toEqual(['continue-setup', 'clone', 'edit', 'production-publish', 'archive', 'copy-id'])
  expect(keys('DRAFT', { edit: true, publish: false })).toEqual(['continue-setup', 'clone', 'edit', 'archive', 'copy-id'])
  expect(keys('DRAFT', { edit: false, publish: true })).toEqual(['production-publish', 'copy-id'])
  expect(keys('PAUSED')).toEqual(['resume', 'clone', 'archive', 'copy-id'])
  expect(keys('PAUSED', { edit: true, publish: false })).toEqual(['clone', 'archive', 'copy-id'])
  expect(keys('ARCHIVED')).toEqual(['clone', 'unarchive', 'copy-id'])
  expect(keys('ARCHIVED', { edit: false, publish: false })).toEqual(['copy-id'])
})
