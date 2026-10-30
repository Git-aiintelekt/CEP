/** The Insights admin pages' shared pieces (docs/mockups/insights-admin-pages.html, phase A1): one working ⋯ per row, a disabled item that says why, Title Case headers, filters in the address. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsBenchmarksNow, insightsUploadsNow, installMockApi, me, signIn } from '@/test/mockApi'

const admin = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

const upload = (id: string, name: string, reports: number) => ({ id, key: `u_${id}`, name, description: null, file_name: `${id}.csv`, file_kind: 'csv' as const, row_count: 6, status: 'READY' as const,
  created_at: '2026-10-27T22:10:00Z', updated_at: '2026-10-27T22:10:00Z', replaced_at: null, row_version: 1, reports, sample: [],
  columns: [{ key: 'store', label: 'Store', column: 'store', source: 'Store', type: 'string', inferred: 'string', types: ['string'], role: 'dimension' as const }] })

async function renderAppAt(path: string, setUp?: () => void) {
  installMockApi({ me: admin as never })
  setUp?.()
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the last file\'s ⋯ opens on top of the page, closes on Escape and on a click outside; Delete says why it is greyed out', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/uploads', () => { insightsUploadsNow.push(upload('stores', 'Store List', 0), upload('targets', 'Store Targets', 1)) })
  const table = await screen.findByRole('table', { name: 'Uploaded files' })
  expect(within(table).getAllByRole('columnheader').map((h) => h.className.includes('uppercase'))).not.toContain(true)

  await user.click(within(table).getByRole('button', { name: 'Actions for Store Targets' }))
  const menu = screen.getByRole('menu', { name: 'Actions for Store Targets' })
  expect(menu.className).toContain('fixed')                                          // not inside the table's scrolling card
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Review Columns', 'New Report', 'Replace File…', 'Delete…1 report uses it'])
  expect(within(menu).getByRole('menuitem', { name: /Delete/ }).getAttribute('aria-disabled')).toBe('true')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()

  await user.click(within(table).getByRole('button', { name: 'Actions for Store List' }))
  expect(screen.getByRole('menu', { name: 'Actions for Store List' })).toBeTruthy()
  await user.click(screen.getByRole('heading', { name: 'Uploaded Files' }))
  expect(screen.queryByRole('menu')).toBeNull()
})

test('Benchmarks: the pencil and bin become a ⋯ with Edit and Remove; the count shows by the title', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/benchmarks', () => {
    insightsBenchmarksNow.push({ id: 'bm-1', dataset: 'messages', dataset_label: 'Messages', measure: 'delivered_rate', measure_label: 'Delivered Rate', format: 'percent', higher_is_better: true, good: 95, act: 90, count_field: null, base_field: null, row_version: 1 })
  })
  const table = await screen.findByRole('table', { name: 'Benchmarks' })
  expect(within(table).queryByRole('button', { name: 'Edit Delivered Rate' })).toBeNull()
  await user.click(within(table).getByRole('button', { name: 'Actions for Delivered Rate' }))
  expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Remove…'])
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
  expect(await screen.findByRole('dialog', { name: 'Edit Delivered Rate' })).toBeTruthy()
})

test('Run Log and Usage keep their filters in the address, and Clear Filters takes them off', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/runs?days=30&outcome=REFUSED')
  await screen.findByRole('heading', { name: 'Run Log' })
  expect(screen.getByRole('button', { name: /Period: 30 Days/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Refused/ })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))
  expect(window.location.search).toBe('')
  cleanup()

  await renderAppAt('/insights/usage?days=7')
  await screen.findByRole('heading', { name: 'Usage' })
  expect(screen.getByRole('button', { name: /Period: 7 Days/ })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /Period: 7 Days/ }))
  await user.click(screen.getByRole('option', { name: '90 Days' }))
  expect(window.location.search).toBe('?days=90')
})
