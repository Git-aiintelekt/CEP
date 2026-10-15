/** One set of words for why someone was left out, with consent by channel. */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { AudiencePicture } from '@/apps/cep/features/campaigns/AudiencePicture'
import { frozenFunnel } from '@/apps/cep/features/campaigns/audienceNumbers'
import { audienceEstimate } from '@/test/mockCampaigns'

import { exclusionReason } from './exclusionReasons'

afterEach(cleanup)

test('consent by channel; the other reasons the same everywhere', () => {
  expect(exclusionReason('NO_CONSENT', 'EMAIL')).toBe('No Email Consent')
  expect(exclusionReason('NO_CONSENT', 'E_RECEIPT')).toBe('No Email Consent')
  expect(exclusionReason('NO_CONSENT', 'SMS')).toBe('No Text Consent')
  expect(exclusionReason('NO_CONSENT', 'MMS')).toBe('No MMS Consent')
  expect(exclusionReason('NO_CONSENT', 'MULTI')).toBe('No Consent')
  expect(exclusionReason('FREQUENCY_CAP', 'SMS')).toBe('Over Frequency Limit')
  expect(exclusionReason('SOMETHING_NEW')).toBe('Something New')
})

test("the Audience tab's frozen list uses the same words", () => {
  const lines = frozenFunnel({ members: 10, generated_at: '2026-09-18T10:00:00Z', eligible: 8, suppressed: { NO_CONSENT: 2 } }, 'SMS')
  expect(lines.map((line) => line.label)).toContain('Left Out: No Text Consent')
})

test("the wizard's audience estimate names reasons the same way, by channel; unknown codes keep the API's label", () => {
  const statuses = [{ code: 'NO_CONSENT' as const, label: 'No consent on record', sendable: false, count: 5 }, { code: 'SOMETHING_NEW', label: 'Held back by the API', sendable: false, count: 2 }]
  render(<AudiencePicture audience={{ ...audienceEstimate, channel: 'SMS', statuses: statuses as never }} />)
  const reasons = within(screen.getByRole('list', { name: 'Why people are left out' })).getAllByRole('listitem').map((item) => item.firstElementChild?.textContent)
  expect(reasons).toEqual(['No Text Consent', 'Held back by the API'])
})
