/**
 * What texts cost (docs/mockups/sms-mms-costs.html): Settings → Message Costs (prices read-only, the limits the administrator sets),
 * the price line on a template, and the campaign's Estimated Cost with its limit tag. Money is shown only with View Message Costs.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { MessageCosts, MessagePrices } from '@/lib/types'
import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

import { textCostLine } from './data'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SET_UP: MessageCosts = {
  currency: 'USD', set_up: true, can_edit: true, viewers: ['Marketing Admin'], countries: [{ code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' }],
  texts: [{ sender_id: 's1', sender: 'Northwind SMS', number: '24680', channel: 'SMS', is_default: true, engine: 'Digivize', sender_type: 'Short Code', countries: [],
            current: { effective_from: '2026-10-01', effective_until: '2026-12-31', sms: '0.0075', mms: '0.0300', fee_part: '0.0030', fee_mms: '0.0050', fees: 'PASS_ON' },
            next: { effective_from: '2027-01-01', effective_until: null, sms: '0.0080', mms: '0.0300', fee_part: '0.0030', fee_mms: '0.0050', fees: 'PASS_ON' } }],
  whatsapp: [], month: { month: '2026-11-01', sent: '612.40', campaigns: '431.06', journeys: '92.18', receipts: '89.16', scheduled: '0.00', total: '612.40', days_left: 7 },
  settings: { approval_above: '100.00', monthly_budget: '1000.00', warn_at: 80, over_budget: 'APPROVAL', wa_countries: null, home_country: null, home_country_name: null },
}

/** the mock API with the cost endpoints in front of it */
function withCosts(costs: MessageCosts, extra: Record<string, unknown> = {}, permissions: string[] = []) {
  const calls = installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, ...permissions] } } as never, ...extra })
  const base = globalThis.fetch
  let now = costs
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input).split('?')[0]
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (path.endsWith('/message-costs/')) {
      calls.push({ url: String(input), method: init.method ?? 'GET', headers: {}, body: init.body ? JSON.parse(String(init.body)) : null })
      if (init.method === 'PUT') now = { ...now, settings: { ...now.settings, ...JSON.parse(String(init.body)) } }
      return json(now)
    }
    return base(input, init)
  })
  return calls
}

test('Message Costs shows the prices read-only, the month against the budget, and saves the limits', async () => {
  const calls = withCosts(SET_UP)
  const user = userEvent.setup()
  await renderAppAt('/settings/message-costs')
  const prices = (await screen.findByRole('heading', { name: 'Prices' })).closest('section') as HTMLElement
  expect(within(prices).getByText('Short Code 24680')).toBeTruthy()
  expect(prices.textContent).toContain('$0.0075')
  expect(prices.textContent).toContain('$0.0030 a part · $0.0050 an MMS')
  expect(prices.textContent).toMatch(/From .*Short Code SMS is \$0\.0080 a part/)

  const month = screen.getByRole('heading', { name: 'This Month' }).closest('section') as HTMLElement
  expect(month.textContent).toContain('$612.40')
  expect(month.textContent).toContain('of a $1,000.00 budget')
  expect(month.textContent).toContain('61% used · 7 days left · Warn at 80%')

  const limits = screen.getByRole('heading', { name: 'Limits' }).closest('section') as HTMLElement
  expect(limits.textContent).toContain('$100.00 a campaign')
  await user.click(within(limits).getByRole('button', { name: 'Edit' }))
  await user.clear(within(limits).getByLabelText(/^Approval Above/))
  await user.type(within(limits).getByLabelText(/^Approval Above/), '250')
  await user.selectOptions(within(limits).getByLabelText('Over Budget'), 'BLOCK')
  await user.click(within(limits).getByRole('button', { name: 'Save Limits' }))
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ approval_above: '250', over_budget: 'BLOCK', warn_at: 80 }))
  await vi.waitFor(() => expect((screen.getByRole('heading', { name: 'Limits' }).closest('section') as HTMLElement).textContent).toContain('$250.00 a campaign'))
  expect((screen.getByRole('heading', { name: 'Who Sees Costs' }).closest('section') as HTMLElement).textContent).toContain('View Message Costs permission: Marketing Admin.')
})

test('before the platform team sets a price the page says so and offers no limits', async () => {
  withCosts({ ...SET_UP, set_up: false, texts: [], month: null })
  await renderAppAt('/settings/message-costs')
  expect(await screen.findByText('Prices are not set up yet')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Limits' })).toBeNull()
})

test('the template line: parts × (price + carrier fee) for SMS, one flat price for MMS', () => {
  const prices: MessagePrices = { currency: 'USD', whatsapp: null, sms: { each: '0.0075', fee: '0.0030', fees: 'PASS_ON', sender: 'Northwind SMS', number: '24680' },
                                  mms: { each: '0.0300', fee: '0.0050', fees: 'PASS_ON', sender: 'Northwind SMS', number: '24680' } }
  expect(textCostLine(prices, 'SMS', 3)).toEqual({ headline: 'About $0.0315 a recipient · $31.50 per 1,000', detail: '3 parts × ($0.0075 + $0.0030 carrier fee).' })
  expect(textCostLine(prices, 'MMS', 4)).toEqual({ headline: '$0.0350 a recipient · $35.00 per 1,000', detail: 'MMS $0.0300 + $0.0050 carrier fee, any length.' })
  expect(textCostLine({ ...prices, sms: null }, 'SMS', 1)).toBeNull()
})
