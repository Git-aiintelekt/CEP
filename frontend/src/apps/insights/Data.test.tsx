/** Fiscal calendars, report parameters and uploaded files: the arithmetic and the words, Settings → Fiscal Year, a report that
 * asks before it runs, the Parameters dialog, and a CSV uploaded, reviewed and reported on. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import { fiscalExample, fiscalName } from './components/fiscal'
import { formatCell } from './components/resultWords'
import { periodBounds, presetsFor } from './dashboards/layout'
import { answerWords, askable, parameterKey, unanswered } from './editor/parameters'
import type { CatalogField } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin', 'user.admin'] },
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

test('a fiscal year from April: its quarters and years named, a dashboard period from its start, the words on a result', () => {
  const april = { start: 4, named_by: 'end' as const }
  expect(fiscalName('2026-04-01', 'fiscal_year', april)).toBe('FY2027')
  expect(fiscalName('2026-04-01', 'fiscal_quarter', april)).toBe('FY2027 Q1')
  expect(fiscalName('2027-01-01', 'fiscal_quarter', april)).toBe('FY2027 Q4')
  expect(fiscalName('2026-04-01', 'fiscal_year', { start: 4, named_by: 'start' })).toBe('FY2026')
  expect(formatCell({ key: 'sent_at', label: 'Sent', type: 'date', format: 'date', bucket: 'fiscal_quarter', fiscal: april }, '2026-07-01')).toBe('FY2027 Q2')
  const today = new Date(2026, 9, 19)
  expect(periodBounds({ preset: 'fyear' }, today, 4).from).toBe('2026-04-01')
  expect(periodBounds({ preset: 'fquarter' }, today, 4).from).toBe('2026-10-01')
  expect(fiscalExample(april, today)).toBe('FY2027 runs from April 2026 to March 2027; today is in FY2027 Q3.')
  expect(presetsFor(4).map((p) => p.label)).toContain('Fiscal Quarter')
  expect(presetsFor(1).map((p) => p.label)).toEqual(['7 Days', '30 Days', '90 Days', 'This Month', 'Quarter', 'This Year', 'Custom'])
})

test('parameters: what a field can be asked as, a key from a label, the questions still unanswered, an answer in words', () => {
  const channel = { key: 'channel', label: 'Channel', type: 'string', role: 'dimension', aggregates: [], operators: ['=', '!=', 'in'], buckets: [], format: null, sensitivity: 'NORMAL' } as CatalogField
  expect(askable(channel)).toEqual(['in', '='])
  expect(parameterKey('Store Name', ['store_name'])).toBe('store_name_2')
  const asked = [{ key: 'channel', label: 'Channel', field: 'channel', operator: 'in' as const, required: true }, { key: 'since', label: 'Since', field: 'submitted_at', operator: '>=' as const, required: true, default: '2026-09-01' }]
  expect(unanswered(asked, {}).map((p) => p.key)).toEqual(['channel'])
  expect(unanswered(asked, { channel: ['SMS'] })).toEqual([])
  expect(answerWords('between', ['2026-09-01', '2026-09-30'])).toBe('2026-09-01 to 2026-09-30')
  expect(answerWords('in', [])).toBe('Any')
})

test('Settings → Fiscal Year: April, named by the year it ends in, saved at once with an example', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/settings/fiscal-year')
  expect(await screen.findByRole('heading', { name: 'Fiscal Year' })).toBeTruthy()
  expect(screen.getByText('Your fiscal year is the calendar year.')).toBeTruthy()
  await user.selectOptions(screen.getByLabelText('Starts In'), 'April')
  await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/workspace/fiscal-year/') && c.method === 'PUT' && (c.body as { start: number }).start === 4)).toBe(true))
  expect(await screen.findByText(/^FY\d{4} runs from April \d{4} to March \d{4}; today is in FY\d{4} Q\d\.$/)).toBeTruthy()
})

test('a report that asks: nothing runs until Channel is chosen; Run Report sends the answer, and the export carries it', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-asked')
  expect(await screen.findByText('Choose Channel above, then run the report.')).toBeTruthy()
  expect(calls.some((c) => c.url.includes('/rep-asked/run/'))).toBe(false)
  const bar = screen.getByRole('form', { name: 'Parameters' })
  expect((within(bar).getByRole('button', { name: 'Run Report' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(await within(within(bar).getByRole('group', { name: 'Channel' })).findByRole('button', { name: 'Any' }))
  await user.click(await screen.findByRole('option', { name: 'SMS' }))
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  await user.click(within(bar).getByRole('button', { name: 'Run Report' }))
  await vi.waitFor(() => expect(calls.some((c) => c.url.includes('/rep-asked/run/') && JSON.stringify((c.body as { params?: unknown }).params) === '{"channel":["SMS"]}')).toBe(true))
  expect(await screen.findByText('Weekend Flash Sale')).toBeTruthy()
  expect(screen.queryByText('Fall Launch')).toBeNull()
  await user.click(await screen.findByRole('button', { name: 'More actions' }, { timeout: 5000 }))
  await user.click(screen.getByRole('menuitem', { name: 'Export CSV' }))
  await vi.waitFor(() => expect(calls.some((c) => c.url.includes('/rep-asked/export.csv?params=') && decodeURIComponent(c.url).includes('{"channel":["SMS"]}'))).toBe(true))
})

test('the editor: Report Filters adds a required question on Channel, saved with the report', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await user.click(await screen.findByRole('button', { name: 'Report Filters' }))
  const dialog = await screen.findByRole('dialog', { name: 'Report Filters' })
  await user.click(within(dialog).getByRole('button', { name: 'Add Filter' }))
  await user.selectOptions(within(dialog).getByLabelText('Parameter 1 field'), 'Channel')
  expect((within(dialog).getByLabelText('Parameter 1 asked as') as HTMLSelectElement).value).toBe('in')
  await user.click(within(dialog).getByLabelText('An Answer Is Required'))
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(await screen.findByRole('button', { name: 'Report Filters · 1' })).toBeTruthy()
  expect(await screen.findByRole('form', { name: 'Parameters' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => {
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/insights/reports/rep-1/'))
    expect((put?.body as { definition?: { parameters?: unknown[] } } | undefined)?.definition?.parameters).toEqual([{ key: 'channel', label: 'Channel', field: 'channel', operator: 'in', required: true }])
  })
})

test('Uploaded Files: a CSV is read, its columns reviewed, and Create Report opens on it, picked', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/uploads')
  expect(await screen.findByRole('heading', { name: 'Uploaded Files' })).toBeTruthy()
  expect(await screen.findByText(/Up to 100,000 rows, 50 columns and 20 MB\./)).toBeTruthy()
  await user.upload(screen.getByLabelText('Choose a file to upload'), new File(['Store,Sales,Opened\nDowntown,1234.5,2026-10-19\n'], 'store_sales.csv', { type: 'text/csv' }))
  const dialog = await screen.findByRole('dialog', { name: 'Review the Columns' })
  expect(within(dialog).getByText('store_sales.csv · 3 rows · 3 columns')).toBeTruthy()
  expect(within(dialog).getByText('Downtown · Mall · Airport')).toBeTruthy()
  const types = within(dialog).getByLabelText('Sales type') as HTMLSelectElement
  expect(Array.from(types.options).map((o) => o.text)).toEqual(['Number', 'Text'])
  await user.clear(within(dialog).getByLabelText('Sales label'))
  await user.type(within(dialog).getByLabelText('Sales label'), 'Net Sales')
  await user.selectOptions(within(dialog).getByLabelText('Sales use'), 'A Measure (Adds Up)')
  await user.click(within(dialog).getByRole('button', { name: 'Save as Dataset' }))
  await vi.waitFor(() => {
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/insights/uploads/upl-1/'))
    expect(put?.body).toMatchObject({ ready: true, columns: [{ key: 'store' }, { key: 'sales', label: 'Net Sales', type: 'number', role: 'measure' }, { key: 'opened' }] })
  })
  const create = await screen.findByRole('dialog', { name: 'Create Report' })
  const option = await within(create).findByRole('radio', { name: /store sales/i })
  expect(option.getAttribute('aria-checked')).toBe('true')
  expect(within(create).getByText('store_sales.csv · 3 rows')).toBeTruthy()
  expect(within(create).getByRole('button', { name: /Upload a File/ })).toBeTruthy()
})
