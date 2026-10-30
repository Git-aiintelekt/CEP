/** Insights → Benchmarks (docs/mockups/insights-admin-pages.html, phase A5): Add a Benchmark in two steps with the measure's unit, the bands in words, Edit on step 2, the filters. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsBenchmarksNow, installMockApi, me, signIn } from '@/test/mockApi'

const admin = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

const bench = (id: string, measure: string, label: string, dataset: string, datasetLabel: string, higher: boolean, good: number, act: number) => ({ id, dataset, dataset_label: datasetLabel, measure, measure_label: label, format: 'percent',
  higher_is_better: higher, good, act, count_field: null, base_field: null, row_version: 1 })

async function renderAppAt(path: string, seed: ReturnType<typeof bench>[] = []) {
  const calls = installMockApi({ me: admin as never })
  insightsBenchmarksNow.push(...seed)
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Add a Benchmark: what to judge, then the bands with % beside each number; Watch, the bar and the sentence follow as you type', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/benchmarks')
  expect(await screen.findByText('No Benchmarks Yet')).toBeTruthy()
  expect(screen.getByText(/Add Base Reports brings suggested ones/)).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: 'Add a Benchmark' })[0])
  const dialog = await screen.findByRole('dialog', { name: 'Add a Benchmark' })
  expect(within(dialog).getByText('Step 1 of 2 · What to Judge')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Dataset/ }), 'messages')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Measure/ }), 'delivered_rate')
  expect(within(dialog).getByText('A percentage')).toBeTruthy()
  expect(within(dialog).getByRole('radio', { name: /^Higher/ }).getAttribute('aria-checked')).toBe('true')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  expect(within(dialog).getByText('Step 2 of 2 · The Bands')).toBeTruthy()
  const bands = within(dialog).getByRole('group', { name: 'The Bands' })
  expect(within(bands).getAllByText('%')).toHaveLength(2)
  await user.type(within(dialog).getByRole('textbox', { name: 'Good' }), '95')
  await user.type(within(dialog).getByRole('textbox', { name: 'Needs Action' }), '90')
  expect(within(bands).getByText('90.0% to 95.0%')).toBeTruthy()
  expect(within(dialog).getByRole('status').textContent).toBe('A Delivered Rate of 95.0% or more is Good, 90.0% to 95.0% is Watch and under 90.0% Needs Action.')

  await user.click(within(dialog).getByRole('button', { name: /Judge Small Numbers Fairly/ }))
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Counted/ }), 'delivered')
  expect(within(dialog).getByText('Give both, or neither.')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Add Benchmark' }) as HTMLButtonElement).disabled).toBe(true)
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Out Of/ }), 'sent')
  await user.click(within(dialog).getByRole('button', { name: 'Add Benchmark' }))
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/insights/benchmarks/')).at(-1)?.body)
    .toMatchObject({ dataset: 'messages', measure: 'delivered_rate', higher_is_better: true, good: 95, act: 90, count_field: 'delivered', base_field: 'sent' }))
})

test('the table says each band in words with its colour; Edit opens on The Bands, the measure fixed', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/benchmarks', [bench('bm-1', 'delivered_rate', 'Delivered Rate', 'messages', 'Messages', true, 95, 90)])
  const table = await screen.findByRole('table', { name: 'Benchmarks' })
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Measure', 'Dataset', 'Good', 'Watch', 'Needs Action', 'Judged Fairly From', 'Actions'])
  expect(within(table).getByText('95.0% or more')).toBeTruthy()
  expect(within(table).getByText('Under 90.0%')).toBeTruthy()

  await user.click(within(table).getByRole('button', { name: 'Actions for Delivered Rate' }))
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit Delivered Rate' })
  expect(within(dialog).getByText('Step 2 of 2 · The Bands')).toBeTruthy()
  expect((within(dialog).getByRole('textbox', { name: 'Good' }) as HTMLInputElement).value).toBe('95')
  await user.click(within(dialog).getByRole('button', { name: 'Back' }))
  expect((within(dialog).getByRole('combobox', { name: /^Measure/ }) as HTMLSelectElement).disabled).toBe(true)
})

test('search and Dataset narrow the benchmarks and live in the address', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/benchmarks', [bench('bm-1', 'delivered_rate', 'Delivered Rate', 'messages', 'Messages', true, 95, 90), bench('bm-2', 'refund_rate', 'Refund Rate', 'attributed_orders', 'Attributed Orders', false, 2, 5)])
  await screen.findByRole('table', { name: 'Benchmarks' })
  await user.click(screen.getByRole('button', { name: /^Dataset/ }))
  await user.click(screen.getByRole('option', { name: 'Attributed Orders' }))
  expect(window.location.search).toBe('?dataset=attributed_orders')
  const rows = () => within(screen.getByRole('table', { name: 'Benchmarks' })).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent)
  expect(rows()).toEqual(['Refund Rate'])
  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))
  await user.type(screen.getByRole('searchbox', { name: 'Search measures' }), 'deliv')
  expect(rows()).toEqual(['Delivered Rate'])
})
