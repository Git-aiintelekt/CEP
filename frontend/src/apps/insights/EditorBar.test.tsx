/** The report editor's workspace frame and bar (docs/mockups/report-editor-workspace.html, phase E1). */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'

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

test('the editor takes the whole window: no rail, no menu, no menu toggle; the report list keeps them', async () => {
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  expect(screen.queryByRole('complementary', { name: 'Sidebar' })).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  expect(screen.queryByRole('button', { name: /navigation/i })).toBeNull()
  cleanup()

  await renderAppAt('/insights/reports')
  expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy()
})

test('the bar: saved state until a change, then Unsaved Changes, Discard Changes for Close, and Save', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  const name = await screen.findByRole('textbox', { name: 'Report name' })
  const bar = name.closest('header') as HTMLElement
  expect(within(bar).getByRole('status').textContent).toMatch(/^Saved .* · Version \d+$/)
  expect(within(bar).getByRole('button', { name: 'Close' })).toBeTruthy()
  expect((within(bar).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

  await user.type(name, ' 2026')
  expect(within(bar).getByRole('status').textContent).toBe('Unsaved Changes')
  expect(within(bar).queryByRole('button', { name: 'Close' })).toBeNull()
  expect(within(bar).getByRole('button', { name: 'Discard Changes' })).toBeTruthy()
  await vi.waitFor(() => expect((within(bar).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false))
})

test('leaving with unsaved changes asks first; Keep Editing stays, Discard Changes leaves without asking', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  const name = await screen.findByRole('textbox', { name: 'Report name' })
  await user.type(name, ' 2026')

  await user.click(screen.getByRole('button', { name: 'Back to Report' }))
  const ask = await screen.findByRole('dialog', { name: 'Leave without saving?' })
  expect(within(ask).getByText(/Your changes to .* 2026 will be lost\./)).toBeTruthy()
  await user.click(within(ask).getByRole('button', { name: 'Keep Editing' }))
  expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).toBeNull()
  expect(window.location.pathname).toBe('/insights/reports/rep-1/edit')

  await user.click(screen.getByRole('button', { name: 'Discard Changes' }))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/insights/reports/rep-1'))
  expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).toBeNull()
})

test('with nothing changed, Close and Back go straight to the report', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/insights/reports/rep-1'))
})

test('⋯ holds Show the SQL; Component is on the Settings tab', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  const menu = screen.getByRole('menu', { name: 'More actions' })
  expect(within(menu).getByRole('menuitem', { name: 'Show the SQL' })).toBeTruthy()
  expect(within(menu).queryByRole('combobox', { name: 'Component' })).toBeNull()
  await user.keyboard('{Escape}')
  await user.click(await screen.findByRole('tab', { name: 'Settings' }))
  expect(await screen.findByRole('combobox', { name: 'Component' })).toBeTruthy()
})

const previews = (calls: { url: string; body?: unknown }[]) => calls.filter((call) => call.url.endsWith('/insights/reports/preview/'))

test('the status line says how the preview ran and offers Show the SQL', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('region', { name: 'Preview rows' })
  const status = screen.getAllByRole('status').find((node) => node.textContent?.startsWith('Preview · '))
  expect(status?.textContent).toMatch(/^Preview · \d+ rows? · .+ · /)
  expect(screen.getByRole('switch', { name: 'Update Automatically' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.queryByRole('button', { name: 'Run Preview' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Show the SQL' }))
  expect(await screen.findByRole('dialog', { name: 'Show the SQL' })).toBeTruthy()
})

test('Update Automatically off: a change waits for Run Preview, and the choice is remembered', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('region', { name: 'Preview rows' })
  await user.click(screen.getByRole('switch', { name: 'Update Automatically' }))
  expect(window.localStorage.getItem('insights.editor.auto')).toBe('off')
  const before = previews(calls).length

  await user.click(within(screen.getByRole('complementary', { name: 'Fields' })).getByRole('button', { name: 'Sent, add' }))
  expect(await screen.findByText('Not updated since your last change')).toBeTruthy()
  await new Promise((resolve) => setTimeout(resolve, 700))
  expect(previews(calls).length).toBe(before)

  await user.click(screen.getByRole('button', { name: 'Run Preview' }))
  await vi.waitFor(() => {
    const body = previews(calls).at(-1)?.body as { definition: { columns: { field: string }[] } } | undefined
    expect(body?.definition.columns.some((column) => column.field === 'sent')).toBe(true)
  })
  await vi.waitFor(() => expect(screen.queryByText('Not updated since your last change')).toBeNull())
})

test('the Data pane: the data, its fields in groups, In Use, a click adds a field, search, and the two dialogs', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  const pane = screen.getByRole('complementary', { name: 'Fields' })
  expect(within(pane).getByText('Messages')).toBeTruthy()
  expect(within(pane).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Dimensions', 'Measures', 'Custom Fields', 'Linked Measures'])
  expect(within(within(pane).getByRole('region', { name: 'Dimensions' })).getByRole('button', { name: 'Campaign, in use' })).toBeTruthy()

  await user.click(within(pane).getByRole('button', { name: 'Sent, add' }))
  expect(within(screen.getByRole('region', { name: 'Split By' })).getByRole('combobox', { name: 'Sent bucket' })).toBeTruthy()
  expect(within(pane).getByRole('button', { name: 'Sent, in use' })).toBeTruthy()

  await user.type(within(pane).getByRole('searchbox', { name: 'Search fields' }), 'deliv')
  expect(within(pane).queryByRole('button', { name: /^Campaign/ })).toBeNull()
  expect(within(pane).getByRole('button', { name: /^Delivered Count/ })).toBeTruthy()
  await user.clear(within(pane).getByRole('searchbox', { name: 'Search fields' }))
  await user.type(within(pane).getByRole('searchbox', { name: 'Search fields' }), 'zzz')
  expect(within(pane).getByText('No fields match “zzz”.')).toBeTruthy()

  await user.click(within(pane).getByRole('button', { name: 'New Custom Field' }))
  expect(await screen.findByRole('dialog', { name: 'Custom Fields' })).toBeTruthy()
})

test('the Settings tab: Viewer Filters with its count, Detail Report, Component; Tooltip Report only for a chart split by a field', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  expect(screen.getByRole('tab', { name: 'Build' }).getAttribute('aria-selected')).toBe('true')
  await user.click(screen.getByRole('tab', { name: 'Settings' }))
  const settings = screen.getByRole('group', { name: 'Settings' })
  expect(within(settings).getByRole('button', { name: /^Viewer Filters/ })).toBeTruthy()
  expect(within(settings).getByRole('button', { name: /^Detail Report/ }).textContent).toMatch(/None$/)
  expect(within(settings).queryByRole('button', { name: /^Tooltip Report/ })).toBeNull()
  expect(within(settings).getByRole('combobox', { name: 'Component' })).toBeTruthy()
  await user.click(within(settings).getByRole('button', { name: /^Detail Report/ }))
  expect(await screen.findByRole('dialog', { name: 'Detail Report' })).toBeTruthy()
  await user.keyboard('{Escape}')

  await user.click(screen.getByRole('tab', { name: 'Build' }))
  await user.click(await screen.findByRole('radio', { name: 'Chart' }, { timeout: 5000 }))
  await user.click(screen.getByRole('tab', { name: 'Settings' }))
  await user.click(within(screen.getByRole('group', { name: 'Settings' })).getByRole('button', { name: /^Tooltip Report/ }))
  expect(await screen.findByRole('dialog', { name: 'Tooltip Report' })).toBeTruthy()
})

test('in a narrow window the Data pane starts folded to a strip; Show Fields opens it and Hide Fields folds it again', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: !query.includes('1280px'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  await renderAppAt('/insights/reports/rep-1/edit')
  await screen.findByRole('textbox', { name: 'Report name' })
  const pane = () => screen.getByRole('complementary', { name: 'Fields' })
  expect(within(pane()).queryByRole('searchbox', { name: 'Search fields' })).toBeNull()
  await user.click(within(pane()).getByRole('button', { name: 'Show Fields' }))
  expect(within(pane()).getByRole('searchbox', { name: 'Search fields' })).toBeTruthy()
  await user.click(within(pane()).getByRole('button', { name: 'Hide Fields' }))
  expect(within(pane()).getByRole('button', { name: 'Show Fields' })).toBeTruthy()
})
