/** Insights → Uploaded Files (docs/mockups/insights-admin-pages.html, phase A3): a file dropped on the page, the filters, Needs Review, Review Columns alone. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsUploadsNow, installMockApi, me, signIn } from '@/test/mockApi'

const admin = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

const upload = (id: string, name: string, reports: number, status: 'READY' | 'DRAFT' = 'READY') => ({ id, key: `u_${id}`, name, description: null, file_name: `${id}.csv`, file_kind: 'csv' as const, row_count: 6, status,
  created_at: '2026-10-27T22:10:00Z', updated_at: '2026-10-27T22:10:00Z', replaced_at: null, row_version: 1, reports, sample: [{ store: 'Downtown' }],
  columns: [{ key: 'store', label: 'Store', column: 'store', source: 'Store', type: 'string', inferred: 'string', types: ['string'], role: 'dimension' as const }] })

async function renderAppAt(path: string, files: ReturnType<typeof upload>[] = []) {
  const calls = installMockApi({ me: admin as never })
  insightsUploadsNow.push(...files)
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

test('no drop box on the page; a file dropped anywhere on it opens Upload a File, already reading, then on to its columns', async () => {
  const calls = await renderAppAt('/insights/uploads', [upload('shops', 'Store List', 0)])
  await screen.findByRole('table', { name: 'Uploaded files' })
  expect(screen.queryByText(/Drop a CSV or Excel file here/)).toBeNull()
  expect(screen.getByText('Drop a CSV or Excel file anywhere here to upload it')).toBeTruthy()

  const page = screen.getByRole('heading', { name: 'Uploaded Files' }).closest('.relative') as HTMLElement
  const file = new File(['Store,Sales\nDowntown,12\n'], 'store_sales.csv', { type: 'text/csv' })
  fireEvent.dragOver(page, { dataTransfer: { types: ['Files'], files: [file] } })
  expect(screen.getByText('Drop to upload the file')).toBeTruthy()
  fireEvent.drop(page, { dataTransfer: { types: ['Files'], files: [file] } })
  const dialog = await screen.findByRole('dialog', { name: 'Upload a File' })
  expect(await within(dialog).findByText('Step 2 of 2 · Review the Columns')).toBeTruthy()
  expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/insights/uploads/'))).toBe(true)
  await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Back' }))
  expect(within(dialog).getByText(/^Read: store_sales\.csv/)).toBeTruthy()
})

test('Status and Used by Reports narrow the files and live in the address; a draft reads Needs Review', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/uploads', [upload('shops', 'Store List', 0), upload('targets', 'Store Targets', 2), upload('budgets', 'Regional Budgets', 0, 'DRAFT')])
  const table = await screen.findByRole('table', { name: 'Uploaded files' })
  const names = () => within(screen.getByRole('table', { name: 'Uploaded files' })).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent)
  expect(within(table).getByText('Needs Review')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: /^Used by Reports/ }))
  await user.click(screen.getByRole('option', { name: 'Used by a Report' }))
  expect(window.location.search).toBe('?used=yes')
  expect(names()).toEqual(['Store Targets'])
  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))

  await user.click(screen.getByRole('button', { name: /^Status/ }))
  await user.click(screen.getByRole('option', { name: 'Needs Review' }))
  expect(names()).toEqual(['Regional Budgets'])
  await user.type(screen.getByRole('searchbox', { name: 'Search files' }), 'zzz')
  expect(await screen.findByText('No Files Match These Filters')).toBeTruthy()
})

test('Review Columns on an uploaded file is the review screen alone, with Save', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/uploads', [upload('shops', 'Store List', 0)])
  const table = await screen.findByRole('table', { name: 'Uploaded files' })
  await user.click(within(table).getByRole('button', { name: 'Actions for Store List' }))
  await user.click(screen.getByRole('menuitem', { name: 'Review Columns' }))
  const dialog = await screen.findByRole('dialog', { name: 'Review the File' })
  expect(within(dialog).queryByText(/Step \d of 2/)).toBeNull()
  expect(within(dialog).queryByRole('button', { name: 'Back' })).toBeNull()
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy()
  expect(within(dialog).getByRole('textbox', { name: 'Dataset name' })).toBeTruthy()
})

test('?upload=1 opens Upload a File', async () => {
  await renderAppAt('/insights/uploads?upload=1')
  expect(await screen.findByRole('dialog', { name: 'Upload a File' })).toBeTruthy()
  await vi.waitFor(() => expect(window.location.search).toBe(''))
})
