/**
 * The name at the top of a text's phone preview: an MMS template looks for an MMS sender before an SMS one, the editor opened from a
 * campaign shows that campaign's sender, and a workspace with no sender says so (No SMS Sender, Add a Sender) instead of "Your brand".
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

import type { SenderProfile } from '@/lib/types'
import { cepReady, installMockApi, signIn } from '@/test/mockApi'

import { PhoneFrame } from './PhoneFrame'
import { pickTextSender } from './textSender'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const sender = (id: string, channel: SenderProfile['channel'], is_default = false): SenderProfile =>
  ({ id, display_name: id, channel, from_address: null, reply_to_address: null, sender_id: '55512', verification_status: 'VERIFIED', is_default })

test('an MMS template prefers an MMS sender, the default first, and falls back to the SMS one', () => {
  const sms = sender('Texts', 'SMS', true)
  expect(pickTextSender([sms, sender('Pictures', 'MMS'), sender('Pictures Default', 'MMS', true)], 'MMS')?.display_name).toBe('Pictures Default')
  expect(pickTextSender([sms, sender('Pictures', 'MMS')], 'MMS')?.display_name).toBe('Pictures')
  expect(pickTextSender([sms, sender('Mail', 'EMAIL', true)], 'MMS')?.display_name).toBe('Texts')
  expect(pickTextSender([sender('Pictures', 'MMS', true), sender('Second', 'SMS'), sms], 'SMS')?.display_name).toBe('Texts')
  expect(pickTextSender([sender('Mail', 'EMAIL', true)], 'SMS')).toBeUndefined()
})

test('with no sender the phone says so, and the editor offers to add one in Settings → Delivery', () => {
  render(<MemoryRouter><PhoneFrame sender={null} channel="MMS" addSender><p>Hello</p></PhoneFrame></MemoryRouter>)
  expect(screen.getByText('No MMS Sender')).toBeTruthy()
  expect(screen.queryByText(/your brand/i)).toBeNull()
  const link = screen.getByRole('link', { name: 'Add a Sender' })
  expect(link.getAttribute('href')).toBe('/settings/delivery?add=sender&channel=SMS')
  expect(link.getAttribute('target')).toBe('_blank')
  cleanup()

  render(<MemoryRouter><PhoneFrame sender={null}><p>Hello</p></PhoneFrame></MemoryRouter>)
  expect(screen.getByText('No SMS Sender')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Add a Sender' })).toBeNull()    // thumbnails and previews: the fact, no link
})

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

test('the Message Editor shows the workspace SMS sender, and the campaign\'s own sender when a campaign opened it', async () => {
  installMockApi()
  await renderAppAt('/templates/tpl-sms/message')
  expect(await screen.findByText('Northwind SMS')).toBeTruthy()
  cleanup()

  installMockApi()
  await renderAppAt('/templates/tpl-sms/message?campaign=c1&return=%2Fcampaigns%2Fc1')
  expect(await screen.findByText('Northwind Rewards')).toBeTruthy()
  expect(screen.queryByText('Northwind SMS')).toBeNull()
})
