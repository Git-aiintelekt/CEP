/** The shared chart kit: legend toggling, the tooltip on hover, keyboard and touch, the numbers table, and the three states. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { useChartLegend } from './legend'
import { Chart, ChartLegend, type ChartCategory, type ChartSeries } from './Chart'
import { niceTicks, seriesColor } from './scale'

const categories: ChartCategory[] = [
  { key: 'a', label: '10:00', detail: '18 Sept 2026, 10:00' },
  { key: 'b', label: '11:00', detail: '18 Sept 2026, 11:00' },
  { key: 'c', label: '12:00', detail: '18 Sept 2026, 12:00' },
]
const series: ChartSeries[] = [
  { key: 'sent', label: 'Sent', values: [50, 30, 10] },
  { key: 'opened', label: 'Opened', values: [20, 18, 4] },
]

const renderChart = (props: Partial<Parameters<typeof Chart>[0]> = {}) =>
  render(<Chart title="Messages per hour" categoryHeader="Hour" categories={categories} series={series} {...props} />)
const plot = () => screen.getByRole('group', { name: 'Messages per hour' })
const tooltip = () => document.querySelector('[data-chart-tooltip]') as HTMLElement | null

afterEach(cleanup)

test('series take the palette in order (two series: the second is Plum); the legend shows or hides each one', async () => {
  const user = userEvent.setup()
  renderChart()
  const legend = screen.getByRole('group', { name: 'Series' })
  const sent = within(legend).getByRole('button', { name: 'Sent' })
  expect(sent.getAttribute('aria-pressed')).toBe('true')
  expect((sent.querySelector('span') as HTMLElement).style.backgroundColor).toBe('var(--color-chart-1)')
  expect(document.querySelector('[data-series="opened"] path')!.getAttribute('stroke')).toBe('var(--color-chart-pair)')
  expect(document.querySelector('[data-series="opened"] path')!.getAttribute('stroke-width')).toBe('2')

  await user.click(sent)
  expect(sent.getAttribute('aria-pressed')).toBe('false')
  expect(document.querySelector('[data-series="sent"]')).toBeNull()
  await user.click(sent)
  expect(document.querySelector('[data-series="sent"]')).toBeTruthy()
})

test('no dots on a line until a point is hovered: then a guide, one ringed dot per series, and the tooltip', async () => {
  const user = userEvent.setup()
  renderChart()
  expect(document.querySelectorAll('circle')).toHaveLength(0)
  await user.pointer({ target: plot(), coords: { clientX: 400, clientY: 40 } })
  expect(document.querySelector('[data-guide]')).toBeTruthy()
  const dots = document.querySelectorAll('[data-active-dot]')
  expect(dots).toHaveLength(2)
  expect(dots[0].getAttribute('r')).toBe('3')
  expect(dots[0].getAttribute('stroke-width')).toBe('2')
  const tip = tooltip()!
  expect(tip.className).toContain('shadow-toast')
  expect(tip.className).toContain('rounded-lg')
  expect(within(tip).getByText('18 Sept 2026, 11:00').className).toContain('text-xs')
  expect(tip.textContent).toContain('Sent30')
  expect(tip.textContent).toContain('Opened18')

  await user.pointer({ target: plot(), coords: { clientX: 710, clientY: 40 } })                     // near the right edge the tooltip flips to the left
  expect(tooltip()!.style.transform).toBe('translateX(-100%)')
  await user.unhover(plot())
  expect(tooltip()).toBeNull()
})

test('keyboard: the chart takes focus, ← and → move between points, Escape hides the tooltip', async () => {
  const user = userEvent.setup()
  renderChart()
  await user.tab()
  await user.tab()
  await user.tab()                                                                                     // past the two legend buttons
  expect(document.activeElement).toBe(plot())
  expect(tooltip()).toBeNull()
  await user.keyboard('{ArrowRight}')
  expect(within(tooltip()!).getByText('18 Sept 2026, 10:00')).toBeTruthy()
  await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
  expect(within(tooltip()!).getByText('18 Sept 2026, 12:00')).toBeTruthy()                          // stops at the last point
  await user.keyboard('{ArrowLeft}')
  expect(within(tooltip()!).getByText('18 Sept 2026, 11:00')).toBeTruthy()
  expect(screen.getByText('18 Sept 2026, 11:00: Sent 30, Opened 18')).toBeTruthy()                    // said to screen readers
  await user.keyboard('{Escape}')
  expect(tooltip()).toBeNull()
})

test('touch: a tap shows a point, a tap outside hides it', () => {
  render(<><button type="button">Elsewhere</button><Chart title="Messages per hour" categoryHeader="Hour" categories={categories} series={series} /></>)
  fireEvent.pointerDown(plot(), { pointerType: 'touch', clientX: 20 })
  expect(within(tooltip()!).getByText('18 Sept 2026, 10:00')).toBeTruthy()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }), { pointerType: 'touch' })
  expect(tooltip()).toBeNull()
})

test('the numbers are a table for screen readers, and anyone can show it', async () => {
  const user = userEvent.setup()
  renderChart()
  const table = screen.getByRole('table', { name: 'Messages per hour' })
  expect(table.closest('[data-chart-table]')!.className).toBe('sr-only')
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Hour', 'Sent', 'Opened'])
  expect(within(table).getAllByRole('row')[2].textContent).toBe('18 Sept 2026, 11:003018')
  await user.click(screen.getByRole('button', { name: 'Show the Numbers' }))
  expect(table.closest('[data-chart-table]')!.className).not.toContain('sr-only')
  expect(screen.getByRole('button', { name: 'Hide the Numbers' }).getAttribute('aria-expanded')).toBe('true')
})

const third: ChartSeries = { key: 'clicked', label: 'Clicked', values: [5, 4, 1] }
const stroke = (key: string) => document.querySelector(`[data-series="${key}"] path`)?.getAttribute('stroke')
const legendSwatch = (name: string) => (within(screen.getByRole('group', { name: 'Series' })).getByRole('button', { name }).querySelector('span') as HTMLElement).style.borderColor

test('palette: two series pair Blue with Plum; three or more keep the fixed order', () => {
  expect([0, 1].map((index) => seriesColor(index, 2))).toEqual(['var(--color-chart-1)', 'var(--color-chart-pair)'])
  expect([0, 1, 2].map((index) => seriesColor(index, 3))).toEqual(['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)'])
  expect(seriesColor(0, 1)).toBe('var(--color-chart-1)')

  renderChart({ series: [...series, third] })
  expect(stroke('opened')).toBe('var(--color-chart-2)')
  expect(stroke('clicked')).toBe('var(--color-chart-3)')
})

test('palette: a colour named on the series always wins', () => {
  renderChart({ series: [series[0], { ...series[1], color: 'var(--color-chart-4)' }] })
  expect(stroke('opened')).toBe('var(--color-chart-4)')
  expect(legendSwatch('Opened')).toBe('var(--color-chart-4)')
})

test('palette: hiding a series with the legend recolours nothing', async () => {
  const user = userEvent.setup()
  renderChart({ series: [...series, third] })
  await user.click(within(screen.getByRole('group', { name: 'Series' })).getByRole('button', { name: 'Sent' }))
  expect(document.querySelector('[data-series="sent"]')).toBeNull()
  expect(stroke('opened')).toBe('var(--color-chart-2)')                // two now shown, but the chart has three
  expect(stroke('clicked')).toBe('var(--color-chart-3)')
  cleanup()

  renderChart()
  await user.click(within(screen.getByRole('group', { name: 'Series' })).getByRole('button', { name: 'Sent' }))
  expect(stroke('opened')).toBe('var(--color-chart-pair)')             // one shown, still the pair colour
  expect(legendSwatch('Sent')).toBe('var(--color-chart-1)')
})

test('palette: the legend swatch and the tooltip swatch match the line and the bars', async () => {
  const user = userEvent.setup()
  renderChart()
  await user.pointer({ target: plot(), coords: { clientX: 400, clientY: 40 } })
  const tipSwatches = [...tooltip()!.querySelectorAll('span[aria-hidden]')].map((swatch) => (swatch as HTMLElement).style.backgroundColor).filter(Boolean)
  expect(tipSwatches).toEqual(['var(--color-chart-1)', 'var(--color-chart-pair)'])
  expect(legendSwatch('Opened')).toBe(stroke('opened'))
  expect(legendSwatch('Sent')).toBe(stroke('sent'))
  cleanup()

  renderChart({ type: 'bar' })
  const fills = [...document.querySelectorAll('[data-series="opened"] path')].map((bar) => bar.getAttribute('fill'))
  expect(new Set(fills)).toEqual(new Set(['var(--color-chart-pair)']))
  expect(legendSwatch('Opened')).toBe('var(--color-chart-pair)')
})

test('bars: grouped per category, each a pill with both ends fully rounded', () => {
  renderChart({ type: 'bar' })
  const bars = document.querySelectorAll('[data-series="sent"] path')
  expect(bars).toHaveLength(3)
  expect(bars[0].getAttribute('d')).toContain('A')
  expect(document.querySelectorAll('[data-series="opened"] path')).toHaveLength(3)
})

test('areas sit under the line at 12% at most', () => {
  renderChart({ type: 'area' })
  expect(document.querySelector('[data-series="sent"] path')!.getAttribute('fill-opacity')).toBe('0.12')
})

test('gridlines are horizontal only; axis labels are 13px', () => {
  renderChart()
  const lines = [...document.querySelectorAll('svg line')]
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.every((line) => line.getAttribute('y1') === line.getAttribute('y2'))).toBe(true)
  expect([...document.querySelectorAll('svg text')].every((text) => text.getAttribute('font-size') === '13')).toBe(true)
})

test('the same loading, empty and error states for every chart', async () => {
  const user = userEvent.setup()
  renderChart({ loading: true, height: 280 })
  const loading = document.querySelector('[data-chart-state="loading"]')!
  expect((loading.querySelector('[data-skeleton]') as HTMLElement).style.height).toBe('280px')
  expect(screen.getByText('Loading the chart')).toBeTruthy()

  cleanup()
  renderChart({ categories: [], emptyText: 'Nothing has been sent yet.' })
  expect(screen.getByText('Nothing has been sent yet.')).toBeTruthy()

  cleanup()
  const retry = vi.fn()
  renderChart({ error: new Error('The server did not answer.'), onRetry: retry })
  expect(screen.getByRole('alert').textContent).toContain('The chart could not be loaded. The server did not answer.')
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalled()
})

test('axis steps are round numbers that reach past the largest value', () => {
  expect(niceTicks(80)).toEqual([0, 20, 40, 60, 80])
  expect(niceTicks(83)).toEqual([0, 25, 50, 75, 100])
  expect(niceTicks(3)).toEqual([0, 1, 2, 3])
  expect(niceTicks(0)).toEqual([0, 1])
})

// ---------------------------------------------------------------- mixed marks, the reference line, the bar fade, an outside legend
const revenue: ChartSeries[] = [
  { key: 'revenue', label: 'Revenue', mark: 'bar', values: [40, 60, 20] },
  { key: 'cost', label: 'Cost', mark: 'line', values: [4, 5, 3] },
]
const target = { key: 'target', label: 'Target Pace', values: [70, 70, 70] }

test('mixed marks: bars and a line in one chart, the line drawn over the bars', () => {
  renderChart({ series: revenue, type: 'bar' })
  const bars = document.querySelectorAll('[data-series="revenue"] path')
  expect(bars).toHaveLength(3)
  expect(bars[0].getAttribute('d')).toContain('A')                                                       // a bar, rounded on top
  const line = document.querySelector('[data-series="cost"] path')!
  expect(line.getAttribute('fill')).toBe('none')
  expect(line.getAttribute('stroke')).toBe('var(--color-chart-pair)')                                     // the second of two series is Plum
  const order = [...document.querySelectorAll('[data-series]')].map((group) => group.getAttribute('data-series'))
  expect(order).toEqual(['revenue', 'cost'])
})

test('a reference line is dashed Gray 700, takes no colour slot, stretches the scale, and is in the legend, tooltip and table', async () => {
  const user = userEvent.setup()
  renderChart({ series: revenue, type: 'bar', reference: target })
  const dashed = document.querySelector('[data-reference="target"] path')!
  expect(dashed.getAttribute('stroke-dasharray')).toBe('5 4')
  expect(dashed.getAttribute('stroke-width')).toBe('1.5')
  expect(dashed.getAttribute('stroke')).toBe('var(--color-ink-700)')
  expect(document.querySelector('[data-series="cost"] path')!.getAttribute('stroke')).toBe('var(--color-chart-pair)')
  expect([...document.querySelectorAll('svg text')].map((text) => text.textContent)).toContain('80')        // the axis reaches past 70
  const legend = screen.getByRole('group', { name: 'Series' })
  expect(within(legend).queryByRole('button', { name: 'Target Pace' })).toBeNull()                      // a label, not a toggle
  expect(legend.querySelector('[data-legend-reference] [data-swatch="dashed"]')).toBeTruthy()
  expect(within(legend).getByRole('button', { name: 'Cost' }).querySelector('[data-swatch="line"]')).toBeTruthy()

  await user.pointer({ target: plot(), coords: { clientX: 400, clientY: 40 } })
  expect(tooltip()!.textContent).toContain('Target Pace70')
  const table = screen.getByRole('table', { name: 'Messages per hour' })
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Hour', 'Revenue', 'Cost', 'Target Pace'])
})

test('bar hover fade: the active category stays full, the others drop to 40%; lines and the reference never fade', async () => {
  const user = userEvent.setup()
  renderChart({ series: revenue, type: 'bar', reference: target })
  const opacity = () => [...document.querySelectorAll('[data-series="revenue"] path')].map((bar) => bar.getAttribute('fill-opacity'))
  expect(opacity()).toEqual(['1', '1', '1'])
  expect(document.querySelector('[data-series="revenue"] path')!.getAttribute('class')).toContain('duration-fast')
  plot().focus()
  await user.keyboard('{ArrowRight}{ArrowRight}')
  expect(opacity()).toEqual(['0.4', '1', '0.4'])
  expect(document.querySelector('[data-series="cost"] path')!.getAttribute('fill-opacity')).toBeNull()
  expect(document.querySelector('[data-reference="target"] path')!.getAttribute('fill-opacity')).toBeNull()
  await user.keyboard('{Escape}')
  expect(opacity()).toEqual(['1', '1', '1'])
})

function OutsideLegend() {
  const legend = useChartLegend()
  return (
    <>
      <header><ChartLegend series={revenue} reference={target} hidden={legend.hidden} onToggle={legend.toggle} /></header>
      <Chart title="Messages per hour" categoryHeader="Hour" categories={categories} series={revenue} reference={target} type="bar" legend="none" hidden={legend.hidden} />
    </>
  )
}

test('a legend drawn elsewhere still shows and hides the series', async () => {
  const user = userEvent.setup()
  render(<OutsideLegend />)
  expect(screen.getAllByRole('group', { name: 'Series' })).toHaveLength(1)                              // not drawn twice
  const cost = within(screen.getByRole('banner')).getByRole('button', { name: 'Cost' })
  await user.click(cost)
  expect(cost.getAttribute('aria-pressed')).toBe('false')
  expect(document.querySelector('[data-series="cost"]')).toBeNull()
  expect(document.querySelector('[data-series="revenue"]')).toBeTruthy()
  await user.click(cost)
  expect(document.querySelector('[data-series="cost"]')).toBeTruthy()
})
