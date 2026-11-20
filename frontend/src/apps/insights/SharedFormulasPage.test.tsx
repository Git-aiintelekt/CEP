/** Insights → Shared Formulas (docs/mockups/insights-admin-pages.html, phase A4): every dataset's formulas or one's, the filters in the address, Add a Formula on the chosen dataset, Edit on step 2. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsSharedFormulasNow, me, signIn } from '@/test/mockApi'

const admin = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

const formula = (id: string, dataset: string, label: string, kind: 'measure' | 'formula', certified: boolean) => ({ id, dataset_key: dataset, key: `f_${id}`, label, description: null, kind, expression: kind === 'measure' ? 'SUM([Sent Count])' : 'YEAR([Sent])',
  type: 'number', role: null, format: null, sensitivity: 'NORMAL', certified, certified_at: certified ? '2026-10-19T10:00:00Z' : null, certified_by_name: certified ? 'Aby' : null, created_by_name: 'Aby',
  created_at: '2026-10-19T09:00:00Z', updated_at: '2026-10-19T09:00:00Z', row_version: 1, reports: 0 })

async function renderAppAt(path: string) {
  installMockApi({ me: admin as never })
  insightsSharedFormulasNow.messages = [formula('sf-1', 'messages', 'Emails Sent', 'measure', true), formula('sf-2', 'messages', 'Send Year', 'formula', false)]
  insightsSharedFormulasNow.attributed_orders = [formula('sf-3', 'attributed_orders', 'Order Count', 'measure', false)]
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const names = () => within(screen.getByRole('table', { name: 'Shared formulas' })).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent?.trim())

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('every dataset\'s formulas at first, with a Dataset column; the Dataset chip narrows to one and lives in the address', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/formulas')
  const table = await screen.findByRole('table', { name: 'Shared formulas' })
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Dataset', 'Formula', 'Kind', 'Certified', 'Reports', 'Changed', 'Actions'])
  expect(names()).toEqual(['Emails Sent', 'Send Year', 'Order Count'])
  expect(screen.queryByRole('combobox', { name: 'Dataset' })).toBeNull()                       // the old field above the table

  await user.click(screen.getByRole('button', { name: /^Dataset/ }))
  await user.click(screen.getByRole('option', { name: 'Attributed Orders' }))
  expect(window.location.search).toBe('?dataset=attributed_orders')
  expect(names()).toEqual(['Order Count'])
})

test('Kind and Certified narrow the list; Clear Filters takes them off', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/formulas')
  await screen.findByRole('table', { name: 'Shared formulas' })
  await user.click(screen.getByRole('button', { name: 'Certified' }))
  expect(names()).toEqual(['Emails Sent'])
  await user.click(screen.getByRole('button', { name: 'Certified' }))
  await user.click(screen.getByRole('button', { name: /^Kind/ }))
  await user.click(screen.getByRole('option', { name: 'Formula (Each Row)' }))
  expect(names()).toEqual(['Send Year'])
  await user.click(screen.getByRole('button', { name: 'Clear Filters' }))
  expect(names()).toHaveLength(3)
  expect(window.location.search).toBe('')
})

test('Add a Formula starts on the chosen dataset; Edit opens on The Formula with the dataset fixed', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/formulas?dataset=attributed_orders')
  await screen.findByRole('table', { name: 'Shared formulas' })
  await user.click(screen.getByRole('button', { name: 'Add a Formula' }))
  let dialog = await screen.findByRole('dialog', { name: 'Add a Formula' })
  expect((within(dialog).getByRole('combobox', { name: /Dataset/ }) as HTMLSelectElement).value).toBe('attributed_orders')
  await user.keyboard('{Escape}')

  await user.click(screen.getByRole('button', { name: 'Actions for Order Count' }))
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
  dialog = await screen.findByRole('dialog', { name: 'Edit Order Count' })
  expect(within(dialog).getByText('Step 2 of 2 · The Formula')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Back' }))
  expect((within(dialog).getByRole('combobox', { name: /Dataset/ }) as HTMLSelectElement).disabled).toBe(true)
})
