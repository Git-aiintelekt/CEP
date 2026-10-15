/** Review & Publish when the workspace requires approval: ask, decide, and only then publish. Through the real app and the in-memory API. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { CampaignApproval } from '@/lib/types'
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

const REVIEW = '/campaigns/c1/edit?step=publish&section=review'
const tested = { runs: [{ id: 'rt', test_mode: true, status: 'COMPLETED', run_number: 1 }] as never }
const requested = (requested_by: string): CampaignApproval => ({
  status: 'REQUESTED', requested_by, requested_by_name: requested_by === 'u1' ? 'Aby John' : 'Devon Okafor', requested_at: '2026-09-29T09:14:00Z',
  note: 'Please check the 10% code.', decided_by_name: null, decided_at: null, decision_note: null,
})
const approvalCard = async () => within((await screen.findByRole('heading', { name: 'Approval' })).closest('section') as HTMLElement)
const posts = (calls: { url: string; method: string; body: unknown }[], part: string) => calls.filter((call) => call.method === 'POST' && call.url.includes(part))

test('the author asks for approval with a note; publishing stays shut until it is approved', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, approval_required: true, ...tested }) })
  const user = userEvent.setup()
  await renderAppAt(REVIEW)

  const card = await approvalCard()
  expect(card.getByText('Required')).toBeTruthy()
  expect((await screen.findByRole('button', { name: 'Publish to Production' }) as HTMLButtonElement).disabled).toBe(true)
  expect(await screen.findByText('It can be published once it is approved and the items marked above are done.')).toBeTruthy()

  await user.type(card.getByLabelText(/Note to the Approver/), 'Loyalty Gold+ only.')
  await user.click(card.getByRole('button', { name: 'Request Approval' }))
  await vi.waitFor(() => expect(posts(calls, '/request-approval/')[0]?.body).toEqual({ note: 'Loyalty Gold+ only.' }))
  const after = await approvalCard()
  expect(await after.findByText('Awaiting Approval')).toBeTruthy()
  expect(after.getByText('Waiting for someone who can approve. Nobody approves their own campaign.')).toBeTruthy()
  expect(after.queryByRole('button', { name: 'Approve' })).toBeNull()
})

test('an approver sees the request and approves it, and the publish opens', async () => {
  const calls = installMockApi({
    me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, 'campaign.approve'] } },
    campaign: makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, approval_required: true, approval: requested('u2'), ...tested }),
  })
  const user = userEvent.setup()
  await renderAppAt(REVIEW)

  const card = await approvalCard()
  expect(card.getByText('Devon Okafor')).toBeTruthy()
  expect(card.getByText('Please check the 10% code.')).toBeTruthy()
  expect((card.getByRole('button', { name: 'Send Back' }) as HTMLButtonElement).disabled).toBe(true)     // sending back needs a note
  await user.click(card.getByRole('button', { name: 'Approve' }))
  await vi.waitFor(() => expect(posts(calls, '/approve/')).toHaveLength(1))
  expect(await (await approvalCard()).findByText('Approved')).toBeTruthy()
  await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Publish to Production' }) as HTMLButtonElement).disabled).toBe(false))
})

test('an approver sends it back with a note, and the author can ask again', async () => {
  const calls = installMockApi({ campaign: makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, approval_required: true, approval: requested('u2'), ...tested }) })
  const user = userEvent.setup()
  await renderAppAt(REVIEW)

  const card = await approvalCard()
  await user.type(card.getByLabelText(/^Note/), 'Use the 15% code.')
  await user.click(card.getByRole('button', { name: 'Send Back' }))
  await vi.waitFor(() => expect(posts(calls, '/send-back/')[0]?.body).toEqual({ note: 'Use the 15% code.' }))
  const after = await approvalCard()
  expect(await after.findByText('Sent Back')).toBeTruthy()
  expect(after.getByText('Use the 15% code.')).toBeTruthy()
  expect(after.getByRole('button', { name: 'Request Approval Again' })).toBeTruthy()
})

test('the Before You Publish summary points at the Approval card', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, approval_required: true, ...tested }) })
  await renderAppAt(REVIEW)
  expect(await screen.findByRole('button', { name: 'Go to Approval' })).toBeTruthy()
})

test('a workspace without the requirement shows no Approval card', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'TEST_PUBLISHED', setup_step: 6, ...tested }) })
  await renderAppAt(REVIEW)
  await screen.findByRole('button', { name: 'Publish to Production' })
  expect(screen.queryByRole('heading', { name: 'Approval' })).toBeNull()
})
