/** Conditional formatting: the helpers, formats following their columns, and Format Values in the editor colouring the preview and saving with the view. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import { fillOf, rangeOf, toneClass, toneOf } from './components/formats'
import { pruneFormats, removeField, setCompare } from './editor/definition'
import type { ColumnFormat, ReportDefinition } from './types'

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

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

test('the first rule a value meets gives its tone; a scale and bars are shades of Blue 600 by the value', () => {
  const rules: ColumnFormat = { column: 'sent', style: 'rules', rules: [{ op: '<', value: 30000, tone: 'bad' }, { op: '<', value: 150000, tone: 'warning' }, { op: '>=', value: 150000, tone: 'good' }] }
  expect([25100, 142300, 201500, null].map((v) => toneOf(rules, v))).toEqual(['bad', 'warning', 'good', null])
  expect(toneClass(rules, 25100)).toBe('bg-danger-bg text-danger-text')
  const range = rangeOf([25100, 142300, 201500, null])
  expect(range).toEqual({ min: 25100, max: 201500, peak: 201500 })
  expect(fillOf({ column: 'sent', style: 'scale' }, 201500, range)?.backgroundColor).toBe('color-mix(in srgb, var(--color-brand-600) 40%, transparent)')
  expect(fillOf({ column: 'sent', style: 'scale' }, 25100, range)?.backgroundColor).toBe('color-mix(in srgb, var(--color-brand-600) 6%, transparent)')
  expect(fillOf({ column: 'sent', style: 'bars' }, 100750, range)?.backgroundImage).toContain(' 50%, transparent 50%)')
  expect(fillOf(rules, 25100, range)).toBeUndefined()
})

test('a format goes with its column: removing the measure or the comparison removes it', () => {
  const definition: ReportDefinition = { columns: [{ field: 'channel' }, { field: 'sent', aggregate: 'sum', compare: ['percent_of_total'] }, { field: 'delivered', aggregate: 'sum' }],
    view: { type: 'grid', formats: [{ column: 'sent', style: 'bars' }, { column: 'sent__percent_of_total', style: 'scale' }, { column: 'delivered', style: 'scale' }] } }
  expect(setCompare(definition, 'sent', []).view?.formats?.map((f) => f.column)).toEqual(['sent', 'delivered'])
  expect(removeField(definition, 'delivered').view?.formats?.map((f) => f.column)).toEqual(['sent', 'sent__percent_of_total'])
  expect(pruneFormats({ ...definition, columns: [{ field: 'channel' }] }).view).toEqual({ type: 'grid' })
})

test('Format Values: rules on Sent Count colour the preview cells, and Save writes them with the view', async () => {
  const user = userEvent.setup()
  window.localStorage.setItem('insights.editor', 'wells')
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  await screen.findByRole('region', { name: 'Preview rows' })
  await user.click(screen.getByRole('button', { name: 'Format Values' }))
  const dialog = await screen.findByRole('dialog', { name: 'Format Values' })
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Sent Count formatting' }), 'rules')
  await user.type(within(dialog).getByRole('spinbutton', { name: 'Sent Count rule 1 value' }), '30000')
  await user.click(within(dialog).getByRole('button', { name: 'Add Rule' }))
  await user.type(within(dialog).getByRole('spinbutton', { name: 'Sent Count rule 2 value' }), '150000')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Delivered Count formatting' }), 'bars')
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(screen.queryByRole('dialog', { name: 'Format Values' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Format Values · 2' })).toBeTruthy()
  const grid = screen.getByRole('region', { name: 'Preview rows' })
  await vi.waitFor(() => {
    const low = within(grid).getByText('25,100').closest('[role="gridcell"]') as HTMLElement
    expect(low.className).toContain('bg-danger-bg')
    expect((within(grid).getByText('201,500').closest('[role="gridcell"]') as HTMLElement).className).toContain('bg-success-bg')
  })
  const save = screen.getByRole('button', { name: 'Save' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  await user.click(save)
  await vi.waitFor(() => {
    const put = calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/insights/reports/rep-1/')).at(-1)?.body as { definition?: ReportDefinition } | undefined
    expect(put?.definition?.view?.formats).toEqual([{ column: 'sent', style: 'rules', rules: [{ op: '<', value: 30000, tone: 'bad' }, { op: '>=', value: 150000, tone: 'good' }] }, { column: 'delivered', style: 'bars' }])
  })
})
