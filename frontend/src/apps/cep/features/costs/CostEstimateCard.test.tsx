/** The campaign's Estimated Cost (option A of docs/mockups/sms-mms-costs.html): the figure, the parts, the lines and the limit it is over. */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import type { CostEstimate } from '@/lib/types'

import { CostBreakdown, CostTag } from './CostEstimateCard'

afterEach(() => cleanup())

test('the estimate shows the figure, the parts, the lines and the limit it is over', () => {
  const estimate: Extract<CostEstimate, { available: true }> = {
    available: true, currency: 'USD', channel: 'SMS', price_date: '2026-11-28', sender: 'Short Code 24680', recipients: 12480, units: 13120, unit: 'parts',
    parts: [{ parts: 1, people: 11900, units: 11900 }, { parts: 2, people: 520, units: 1040 }, { parts: 3, people: 60, units: 180 }],
    lines: [{ label: 'parts', units: 13120, each: '0.0075', total: '98.40' }, { label: 'Carrier fees', units: 13120, each: '0.0030', total: '39.36' }],
    total: '137.76', per_recipient: '0.0110', unpriced: 0, exact: true, counted: 12480, upto: false, from_price: false,
    check: { state: 'APPROVAL', reasons: [], message: 'The estimate, 137.76 USD, is above the approval limit of 100.00 USD.', approval_above: '100.00', monthly_budget: '1000.00',
             over_budget: 'APPROVAL', month_spent: '612.40', after: '750.16' },
  }
  render(<section><CostTag estimate={estimate} /><CostBreakdown estimate={estimate} /></section>)
  const card = document.querySelector('section') as HTMLElement
  expect(card.textContent).toContain('$137.76')
  expect(within(card).getByText('Over $100.00 Limit')).toBeTruthy()
  expect(within(card).getByRole('table', { name: 'Parts each' }).textContent).toContain('3 parts60180')
  expect(card.textContent).toContain('13,120 parts × $0.0075')
  expect(card.textContent).toContain('Carrier fees, 13,120 × $0.0030')
  expect(card.textContent).toContain('About $0.0110 a recipient.')
  expect(card.textContent).toContain('An approver signs it off before Publish to Production.')
  expect(card.textContent).toContain('This month after this: $750.16 of $1,000.00.')
  cleanup()

  render(<CostBreakdown estimate={{ ...estimate, from_price: true, each: '0.0105', total: '131.04', check: undefined }} />)
  expect(screen.getByText('From $131.04')).toBeTruthy()
  expect(screen.getByText(/Pick the template to see the exact figure/)).toBeTruthy()
  cleanup()

  render(<CostTag estimate={{ ...estimate, total: '29.40', check: { ...estimate.check!, state: 'OK' } }} />)
  expect(screen.getByText('Within Limits')).toBeTruthy()
})
