/** The Content step's Sender card: New Sender opens the sending engine settings in a new tab, for people who manage senders. */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, me, signIn } from '@/test/mockApi'

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

const senderCard = async () => within((await screen.findByRole('heading', { name: 'Sender' })).closest('section') as HTMLElement)

test('New Sender opens Add a Sender in a new tab for the campaign’s channel, and says a sender belongs to the workspace', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, channel: 'MMS', template: null, sender_profile: null }) })
  await renderAppAt('/campaigns/c1/edit?step=content')
  const card = await senderCard()
  const link = card.getByRole('link', { name: 'New Sender' })
  expect(link.getAttribute('href')).toBe('/settings/delivery?add=sender&channel=SMS')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(await card.findByText(/Senders belong to the workspace/)).toBeTruthy()
})

test('without provider.edit there is no New Sender link', async () => {
  installMockApi({
    me: { principal: { ...me.principal, kind: 'user' as const, permissions: me.principal.permissions.filter((code) => code !== 'provider.edit') } },
    campaign: makeCampaign({ status: 'DRAFT', setup_step: 2 }),
  })
  await renderAppAt('/campaigns/c1/edit?step=content')
  const card = await senderCard()
  expect(card.queryByRole('link', { name: 'New Sender' })).toBeNull()
})
