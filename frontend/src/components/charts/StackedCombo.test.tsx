/** The chart frame's stacked bars and its right-hand scale for a combo's line. */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { Chart, type ChartCategory } from './Chart'

afterEach(cleanup)

const categories: ChartCategory[] = [{ key: 'jul', label: 'Jul' }, { key: 'aug', label: 'Aug' }]

test('stacked: one bar per category made of its series bottom to top, the scale reaching the tallest stack', () => {
  render(<Chart title="Sent by month" categoryHeader="Month" type="bar" stacked categories={categories}
    series={[{ key: 'email', label: 'Email', values: [300, 250] }, { key: 'sms', label: 'Text', values: [100, 50] }]} />)
  const marks = document.querySelectorAll('[data-stacked]')
  expect(marks.length).toBe(4)
  const [email, sms] = [document.querySelector('[data-series="email"] [data-stacked]')!, document.querySelector('[data-series="sms"] [data-stacked]')!]
  expect(Number(sms.getAttribute('data-bottom'))).toBeCloseTo(Number(email.getAttribute('data-top')), 5)   // Text sits on Email
  expect(screen.getByText('400')).toBeTruthy()                                                              // the top tick covers 300 + 100
  expect(email.getAttribute('d')).not.toContain('A')                                                       // only the top segment is rounded
  expect(sms.getAttribute('d')).toContain('A2 2')
})

test('combo: the bars on the left scale, a line with its own format on the right one, and the numbers table reads each in its format', () => {
  render(<Chart title="Sent and open rate" categoryHeader="Month" type="bar" categories={categories}
    series={[{ key: 'sent', label: 'Sent', values: [300000, 250000], mark: 'bar' }, { key: 'rate', label: 'Open Rate', values: [31.2, 37.6], mark: 'line', axis: 'right', format: (v) => `${v.toFixed(1)}%` }]} />)
  const right = [...document.querySelectorAll('[data-axis="right"]')].map((node) => node.textContent)
  expect(right.length).toBeGreaterThan(1)
  expect(right.every((text) => text?.endsWith('%'))).toBe(true)
  expect(document.querySelectorAll('[data-series="sent"] [data-bar-mark]').length).toBe(2)
  const table = document.querySelector('[data-chart-table]') as HTMLElement
  expect(within(table).getByText('37.6%')).toBeTruthy()
  expect(within(table).getByText('300,000')).toBeTruthy()
})
