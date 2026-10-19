/** The formula language in the editor: a measure formula and a formula column written in Custom Fields, checked as you type
 * (the error and its place, then what it works out), fields and functions put in at the cursor, and the fields they make. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import { withCustom } from './editor/definition'
import { insertAt } from './editor/formulaHelp'
import type { CatalogDataset } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  const calls = installMockApi({ me: withInsights as never })
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

test('a formula column and a measure formula become fields of their type and use', () => {
  const base = { key: 'messages', label: 'Messages', fields: [] } as unknown as CatalogDataset
  const fields = withCustom(base, { columns: [], derived: [
    { key: 'c_size', label: 'Size', kind: 'formula', expression: 'IF([Sent Count] >= 1000, "Large", "Small")', type: 'string', role: 'dimension' },
    { key: 'c_double', label: 'Doubled', kind: 'formula', expression: '[Sent Count] * 2', type: 'number', role: 'measure', format: 'integer' },
    { key: 'c_share', label: 'Email Share', kind: 'measure', expression: 'DIVIDE(SUM([Sent Count], [Channel] = "EMAIL"), SUM([Sent Count])) * 100', type: 'number', format: 'percent' },
    { key: 'c_day', label: 'Due', kind: 'formula', expression: 'DATEADD([Sent], 30, "day")', type: 'datetime', role: 'dimension' },
  ] }).fields
  expect(fields.map((f) => [f.key, f.type, f.role, f.aggregates.join('/'), f.format])).toEqual([
    ['c_size', 'string', 'dimension', '', null], ['c_double', 'number', 'measure', 'sum/avg/min/max/count', 'integer'], ['c_share', 'number', 'measure', 'calc', 'percent'], ['c_day', 'datetime', 'dimension', '', 'datetime']])
  expect(fields[3].buckets).toContain('month')
  expect(insertAt('SUM()', 4, '[Sent Count]')).toEqual({ text: 'SUM([Sent Count])', cursor: 16 })
})

test('Custom Fields: a measure formula is checked as you type, the error shown at its place, then added and saved with its format', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await user.click(await screen.findByRole('button', { name: 'Custom Fields' }))
  const dialog = await screen.findByRole('dialog', { name: 'Custom Fields' })
  await user.type(within(dialog).getByLabelText(/^Name/), 'Email Share')
  await user.selectOptions(within(dialog).getByLabelText('Kind'), 'Measure Formula')
  const box = within(dialog).getByLabelText('Formula')
  await user.click(within(dialog).getByRole('button', { name: /^DIVIDE\(a, b, if zero\)/ }))
  expect((box as HTMLTextAreaElement).value).toBe('DIVIDE(')
  await user.clear(box)
  await user.type(box, 'SUM([[Sent Count]) *')
  expect(await within(dialog).findByText('The formula ends too soon: something is missing at the end.')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Add Field' }) as HTMLButtonElement).disabled).toBe(true)
  await user.clear(box)
  await user.type(box, 'DIVIDE(SUM([[Sent Count], [[Channel] = "EMAIL"), SUM([[Sent Count])) * 100')
  expect(await within(dialog).findByText(/Works out a number\. Reads Sent Count, Channel\./)).toBeTruthy()
  await user.selectOptions(within(dialog).getByLabelText('Show as'), 'Percentage')
  await vi.waitFor(() => expect((within(dialog).getByRole('button', { name: 'Add Field' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(within(dialog).getByRole('button', { name: 'Add Field' }))
  const list = await within(dialog).findByRole('list', { name: 'Custom fields' })
  expect(within(list).getByText('Email Share')).toBeTruthy()
  expect(within(list).getByText('Measure Formula')).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => {
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/insights/reports/rep-1/'))
    expect((put?.body as { definition?: { derived?: unknown[] } } | undefined)?.definition?.derived).toEqual([{ key: 'c_email_share', label: 'Email Share', kind: 'measure',
      expression: 'DIVIDE(SUM([Sent Count], [Channel] = "EMAIL"), SUM([Sent Count])) * 100', type: 'number', format: 'percent' }])
  })
})

test('a formula column: a field put in at the cursor, a number used as a dimension', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  await user.click(await screen.findByRole('button', { name: 'Custom Fields' }))
  const dialog = await screen.findByRole('dialog', { name: 'Custom Fields' })
  await user.type(within(dialog).getByLabelText(/^Name/), 'Doubled')
  await user.selectOptions(within(dialog).getByLabelText('Kind'), 'Formula (Each Row)')
  await user.click(within(within(dialog).getByRole('region', { name: 'Fields to put in' })).getByRole('button', { name: /^Sent Count/ }))
  const box = within(dialog).getByLabelText('Formula') as HTMLTextAreaElement
  expect(box.value).toBe('[Sent Count]')
  await user.type(box, ' * 2')
  expect(await within(dialog).findByText(/Works out a number, used as a measure\./)).toBeTruthy()
  await user.selectOptions(within(dialog).getByLabelText('Use as'), 'A Dimension (Groups)')
  expect(await within(dialog).findByText(/used as a dimension\./)).toBeTruthy()
})
