/** The pie and the funnel of the chart kit: slices and stages from the palette, their numbers and shares, folding into Other, a pick, the empty state. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { FunnelChart } from './FunnelChart'
import { foldSlices } from './pie'
import { PieChart } from './PieChart'

afterEach(cleanup)

const slices = [{ key: 'EMAIL', label: 'Email', value: 300 }, { key: 'SMS', label: 'Text', value: 100 }]

test('a pie draws a slice per value from the palette, lists each with its share, reads the total in the middle and a hovered slice in its place', () => {
  render(<PieChart title="Sent Count by Channel" categoryHeader="Channel" valueLabel="Sent Count" slices={slices} />)
  const email = document.querySelector('[data-slice="EMAIL"]') as SVGPathElement
  const sms = document.querySelector('[data-slice="SMS"]') as SVGPathElement
  expect(email.getAttribute('fill')).toBe('var(--color-chart-1)')
  expect(sms.getAttribute('fill')).toBe('var(--color-chart-pair)')                 // exactly two: the second takes the pair colour
  const legend = screen.getByRole('list', { name: 'Slices' })
  expect(within(legend).getByText('75.0%')).toBeTruthy()
  expect(within(legend).getByText('25.0%')).toBeTruthy()
  const plot = screen.getByRole('group', { name: 'Sent Count by Channel' })
  expect(within(plot).getByText('400')).toBeTruthy()                                 // the total, in the middle
  fireEvent.pointerEnter(sms)
  expect(within(plot).getByText('25.0%')).toBeTruthy()                               // the middle now reads the hovered slice
  expect(within(plot).getByText('Text')).toBeTruthy()
  const table = document.querySelector('[data-chart-table]') as HTMLElement
  expect(within(table).getByRole('row', { name: /Total 400 100%/ })).toBeTruthy()
})

test('a slice can be picked with a click or with the keyboard; Other, when the slices fold, cannot', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<PieChart title="Sent Count by Channel" categoryHeader="Channel" valueLabel="Sent Count" slices={slices} onSelect={onSelect} />)
  await user.click(screen.getByRole('button', { name: /^Text/ }))
  expect(onSelect).toHaveBeenCalledWith(1)
  const plot = screen.getByRole('group', { name: 'Sent Count by Channel' })
  plot.focus()
  await user.keyboard('{ArrowRight}{Enter}')
  expect(onSelect).toHaveBeenLastCalledWith(0)
  const many = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, label: `Slice ${i}`, value: 10 - i }))
  const folded = foldSlices(many)
  expect(folded.length).toBe(9)
  expect(folded[8]).toEqual({ key: '__other__', label: 'Other (2)', value: 3 })
})

test('a funnel shows the stages in order, as wide as their share of the widest, with the share of the first and the drop from the one before; a stage can be picked', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  const stages = [{ key: 'entered', label: 'Entered', value: 1000 }, { key: 'opened', label: 'Opened', value: 500 }, { key: 'converted', label: 'Converted', value: 50 }]
  render(<FunnelChart title="Enrollments by Status" valueLabel="Enrollments" stages={stages} onSelect={onSelect} />)
  const list = screen.getByRole('list', { name: 'Enrollments by Status' })
  const items = within(list).getAllByRole('listitem')
  expect(items.length).toBe(3)
  const opened = document.querySelector('[data-stage="opened"]') as HTMLElement
  expect(opened.style.width).toBe('50%')
  expect(opened.style.left).toBe('25%')                                               // centred in its lane
  expect(within(items[1]).getByText('50%')).toBeTruthy()
  expect(within(items[2]).getByText('−90%')).toBeTruthy()
  await user.click(within(items[2]).getByRole('button'))
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('both say when there is nothing to draw', () => {
  render(<PieChart title="Nothing" categoryHeader="Channel" valueLabel="Sent Count" slices={[{ key: 'a', label: 'A', value: 0 }]} />)
  render(<FunnelChart title="Nothing either" valueLabel="Sent Count" stages={[]} />)
  expect(document.querySelectorAll('[data-chart-state="empty"]').length).toBe(2)
})
