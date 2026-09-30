import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { BarList } from './BarList'

afterEach(cleanup)

const width = (key: string) => (document.querySelector(`[data-bar-row="${key}"] [data-bar] > span`) as HTMLElement | null)?.style.width

test('a list of bars measured against max, each row reading as its label and value; a row with no value has no bar', () => {
  render(<BarList title="Email engagement funnel" max={1000} rows={[
    { key: 'delivered', label: 'Delivered', value: 1000 },
    { key: 'opened', label: 'Opened', value: null, valueText: 'Not Tracked' },
    { key: 'clicked', label: 'Clicked', value: 250, secondary: '25.0%', color: 'var(--color-chart-2)' },
  ]} />)
  const list = screen.getByRole('list', { name: 'Email engagement funnel' })
  const items = within(list).getAllByRole('listitem')
  expect(items.map((item) => item.textContent)).toEqual(['Delivered 1,000', 'Opened Not Tracked', 'Clicked 25025.0%'])
  expect(width('delivered')).toBe('100%')
  expect(width('clicked')).toBe('25%')
  expect((document.querySelector('[data-bar-row="clicked"] [data-bar] > span') as HTMLElement).style.backgroundColor).toBe('var(--color-chart-2)')
  expect(document.querySelector('[data-bar-row="opened"] [data-bar]')).toBeNull()
  expect(within(items[1]).getByText('Not Tracked').className).toContain('text-ink-800')
  const bar = document.querySelector('[data-bar-row="delivered"] [data-bar]')!
  expect(bar.className).toContain('h-1.5')
  expect(bar.className).toContain('rounded-pill bg-fill-subtle')
})

test('without max the largest value is the full bar', () => {
  render(<BarList title="Revenue by campaign" rows={[{ key: 'a', label: 'A', value: 50 }, { key: 'b', label: 'B', value: 200 }]} />)
  expect(width('a')).toBe('25%')
  expect(width('b')).toBe('100%')
})

test('loading, empty and error states, the same as Chart', async () => {
  const { rerender } = render(<BarList title="Funnel" rows={[]} loading />)
  expect(document.querySelector('[data-chart-state="loading"]')).toBeTruthy()
  rerender(<BarList title="Funnel" rows={[]} emptyText="Nothing was delivered in this period." />)
  expect(screen.getByText('Nothing was delivered in this period.').className).toContain('text-ink-800')
  const retry = vi.fn()
  rerender(<BarList title="Funnel" rows={[]} error={new Error('Timed out.')} onRetry={retry} />)
  expect(screen.getByRole('alert').textContent).toContain('The chart could not be loaded. Timed out.')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalled()
})
