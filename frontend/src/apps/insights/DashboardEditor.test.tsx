/** The dashboard editor's frame (docs/mockups/dashboards.html, phase D4): the whole window, the bar, the settings line and the pages. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import type { DashboardLayout } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit'] }, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string) {
  const calls = installMockApi({ me: withInsights as never })
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

const lastPut = (calls: { method: string; url: string; body?: unknown }[]) => calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/insights/dashboards/dash-1/')).at(-1)?.body as { layout: DashboardLayout; visibility?: string } | undefined

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the editor takes the whole window; the bar shows the saved state, then Unsaved Changes, Discard Changes and Save', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1/edit')
  const name = await screen.findByRole('textbox', { name: 'Dashboard name' })
  expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  const bar = name.closest('header') as HTMLElement
  expect(within(bar).getByRole('status').textContent).toMatch(/^Saved .* · Version 2$/)
  expect((within(bar).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(bar).getByRole('button', { name: 'Close' })).toBeTruthy()

  await user.type(name, ' 2026')
  expect(within(bar).getByRole('status').textContent).toBe('Unsaved Changes')
  expect(within(bar).getByRole('button', { name: 'Discard Changes' })).toBeTruthy()
  expect((within(bar).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
})

test('Back with unsaved changes asks first; Keep Editing stays, Discard Changes goes to the dashboard', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1/edit')
  await user.type(await screen.findByRole('textbox', { name: 'Dashboard name' }), ' 2026')
  await user.click(screen.getByRole('button', { name: 'Back to Dashboard' }))
  const ask = await screen.findByRole('dialog', { name: 'Leave without saving?' })
  expect(within(ask).getByText('Your changes to Marketing Weekly 2026 will be lost.')).toBeTruthy()
  await user.click(within(ask).getByRole('button', { name: 'Keep Editing' }))
  expect(window.location.pathname).toBe('/insights/dashboards/dash-1/edit')
  await user.click(screen.getByRole('button', { name: 'Discard Changes' }))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/insights/dashboards/dash-1'))
})

test('the settings line: period, Compare, Slicers, Theme, Who Can Open It, the layout switch and Add opening its panel', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  const line = screen.getByRole('group', { name: 'Dashboard settings' })
  expect(within(line).getByRole('button', { name: /^30 Days · / })).toBeTruthy()
  expect(within(line).getByRole('switch', { name: 'Compare With Previous Period' })).toBeTruthy()
  expect(within(line).getByRole('button', { name: 'Slicers · 1' })).toBeTruthy()
  expect(within(line).getByRole('radiogroup', { name: 'Layout' })).toBeTruthy()
  expect(within(line).getByRole('button', { name: 'Phone Preview' })).toBeTruthy()

  await user.click(within(line).getByRole('button', { name: 'Who Can Open It: The Workspace' }))
  await user.click(screen.getByRole('option', { name: 'Only Me' }))
  await user.click(within(line).getByRole('button', { name: 'Add' }))
  const panel = screen.getByRole('complementary', { name: 'Add to the Dashboard' })
  expect(within(within(panel).getByRole('radiogroup', { name: 'What to Add' })).getAllByRole('radio').map((item) => item.textContent)).toEqual(['Report', 'Text', 'Button'])
  await user.click(within(panel).getByRole('button', { name: 'Close the Panel' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(lastPut(calls)?.visibility).toBe('PRIVATE'))
})

test('pages: Add Page makes tabs; the chosen page\'s ⋯ renames it or removes it', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  expect(screen.queryByRole('tablist', { name: 'Pages' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Add Page' }))
  const tabs = screen.getByRole('tablist', { name: 'Pages' })
  expect(within(tabs).getAllByRole('tab')).toHaveLength(2)

  await user.click(screen.getByRole('button', { name: /^Actions for the page / }))
  await user.click(screen.getByRole('menuitem', { name: 'Rename Page' }))
  const dialog = await screen.findByRole('dialog', { name: 'Rename Page' })
  const box = within(dialog).getByRole('textbox', { name: /Page title/ })
  await user.clear(box)
  await user.type(box, 'Revenue')
  await user.click(within(dialog).getByRole('button', { name: 'Rename' }))
  expect(within(screen.getByRole('tablist', { name: 'Pages' })).getByRole('tab', { name: 'Revenue' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => expect(lastPut(calls)?.layout.pages?.map((p) => p.title)).toContain('Revenue'))
})

test('Grid: the page as it looks, each tile\'s toolbar sizes, duplicates and removes it, and Save keeps the flow', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  expect(screen.getByRole('radio', { name: 'Grid' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.queryByRole('combobox', { name: /Row 1 width/ })).toBeNull()
  const chart = screen.getByRole('toolbar', { name: 'Arrange Sends by Campaign' })
  expect(within(chart).getByRole('button', { name: 'Size of Sends by Campaign: Two Thirds' })).toBeTruthy()

  await user.click(within(chart).getByRole('button', { name: /^Size of Sends by Campaign/ }))
  const menu = screen.getByRole('menu', { name: 'Size of Sends by Campaign' })
  expect(within(menu).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['Small¼', 'One Third⅓', 'Medium½', 'Two Thirds⅔', 'Wide¾', 'Full Width'])
  await user.click(within(menu).getByRole('menuitemradio', { name: /Full Width/ }))
  expect(within(chart).getByRole('button', { name: 'Size of Sends by Campaign: Full Width' })).toBeTruthy()
  await user.click(within(chart).getByRole('button', { name: /^Size of Sends by Campaign/ }))
  await user.click(screen.getByRole('menuitemcheckbox', { name: /Tall/ }))
  expect(within(chart).getByRole('button', { name: 'Size of Sends by Campaign: Full Width, Tall' })).toBeTruthy()

  await user.click(within(chart).getByRole('button', { name: 'Duplicate Sends by Campaign' }))
  expect(screen.getAllByRole('toolbar', { name: 'Arrange Sends by Campaign' })).toHaveLength(2)
  await user.click(within(screen.getAllByRole('toolbar', { name: 'Arrange Sends by Campaign' })[1]).getByRole('button', { name: 'Remove Sends by Campaign' }))
  expect(screen.getAllByRole('toolbar', { name: 'Arrange Sends by Campaign' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Add a Tile' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => {
    const cells = lastPut(calls)?.layout.cells
    expect(lastPut(calls)?.layout.canvas).toBe(true)
    expect(cells?.map((c) => [c.id, c.x, c.y, c.w, c.h])).toEqual([['t1', 0, 0, 12, 10], ['t2', 0, 10, 4, 2]])
  })
})

test('dragging a tile\'s grip onto another puts it in that place; Move Earlier does it without a mouse', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  const order = () => screen.getAllByRole('toolbar').map((bar) => bar.getAttribute('aria-label'))
  expect(order()).toEqual(['Arrange Sends by Campaign', 'Arrange Sends by campaign'])
  const grip = screen.getByRole('button', { name: 'Drag Sends by campaign to another place' })
  const target = document.querySelector('[data-cell="t1"]') as HTMLElement
  const data = new Map<string, string>()
  const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: 'move' }
  fireEvent.dragStart(grip, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  expect(order()).toEqual(['Arrange Sends by campaign', 'Arrange Sends by Campaign'])

  await user.click(screen.getByRole('button', { name: /^Size of Sends by Campaign/ }))
  await user.click(screen.getByRole('menuitem', { name: 'Move Earlier' }))
  expect(order()).toEqual(['Arrange Sends by Campaign', 'Arrange Sends by campaign'])
})

test('Free Canvas stays a free canvas once switched; back to Grid flows the tiles again', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  await user.click(screen.getByRole('radio', { name: 'Free Canvas' }))
  expect(screen.getByRole('radio', { name: 'Free Canvas' }).getAttribute('aria-checked')).toBe('true')
  expect((await screen.findAllByRole('button', { name: /^Move / })).length).toBeGreaterThan(0)
  await user.click(screen.getByRole('radio', { name: 'Grid' }))
  expect(screen.getAllByRole('toolbar').length).toBe(2)
})

test('the Add panel: a report as a chart at a size and title lands chosen at the end; the panel stays open for the next', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  await user.click(screen.getByRole('button', { name: 'Add' }))
  const panel = screen.getByRole('complementary', { name: 'Add to the Dashboard' })
  expect(within(panel).queryByRole('radiogroup', { name: 'Size' })).toBeNull()                    // pick a report first
  await user.click(await within(panel).findByRole('button', { name: /Sends by campaign/ }))
  await user.click(within(panel).getByRole('radio', { name: 'Chart' }))
  expect(within(within(panel).getByRole('radiogroup', { name: 'Size' })).getByRole('radio', { name: /Medium/ }).getAttribute('aria-checked')).toBe('true')
  await user.click(within(panel).getByRole('radio', { name: /Full Width/ }))
  await user.type(within(panel).getByRole('textbox', { name: /Title on the Dashboard/ }), 'Sends, Wide')
  await user.click(within(panel).getByRole('button', { name: 'Add to the Dashboard' }))

  const bar = screen.getByRole('toolbar', { name: 'Arrange Sends, Wide' })
  expect(bar.className).not.toContain('opacity-0')                                                 // chosen: its toolbar shows
  expect(within(bar).getByRole('button', { name: 'Size of Sends, Wide: Full Width' })).toBeTruthy()
  expect(screen.getByRole('complementary', { name: 'Add to the Dashboard' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await vi.waitFor(() => {
    const added = lastPut(calls)?.layout.cells?.at(-1)
    expect(added).toMatchObject({ report_id: 'rep-1', show: 'chart', title: 'Sends, Wide', x: 0, w: 12 })
  })
})

test('a text tile\'s edit opens the panel filled in; Save Changes keeps it in its place with its new words', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  await user.click(screen.getByRole('button', { name: 'Add' }))
  let panel = screen.getByRole('complementary', { name: 'Add to the Dashboard' })
  await user.click(within(panel).getByRole('radio', { name: 'Text' }))
  await user.type(within(panel).getByRole('textbox', { name: /^Title/ }), 'Read Me')
  await user.type(within(panel).getByRole('textbox', { name: /^Text/ }), 'First words.')
  await user.click(within(panel).getByRole('button', { name: 'Add to the Dashboard' }))
  await user.click(within(panel).getByRole('button', { name: 'Close the Panel' }))

  await user.click(screen.getByRole('button', { name: 'Edit Read Me' }))
  panel = screen.getByRole('complementary', { name: 'Change the Text' })
  expect(within(panel).queryByRole('radiogroup', { name: 'What to Add' })).toBeNull()
  const words = within(panel).getByRole('textbox', { name: /^Text/ }) as HTMLTextAreaElement
  expect(words.value).toBe('First words.')
  await user.clear(words)
  await user.type(words, 'New words.')
  await user.click(within(panel).getByRole('button', { name: 'Save Changes' }))
  expect(screen.queryByRole('complementary', { name: 'Change the Text' })).toBeNull()
  expect(screen.getByText('New words.')).toBeTruthy()
  expect(screen.getAllByRole('toolbar').at(-1)?.getAttribute('aria-label')).toBe('Arrange Read Me')
})

test('a button: a label and a page to go to; Add waits until both are set', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/dashboards/dash-1/edit')
  await screen.findByRole('textbox', { name: 'Dashboard name' })
  await user.click(screen.getByRole('button', { name: 'Add' }))
  const panel = screen.getByRole('complementary', { name: 'Add to the Dashboard' })
  await user.click(within(panel).getByRole('radio', { name: 'Button' }))
  const add = within(panel).getByRole('button', { name: 'Add to the Dashboard' }) as HTMLButtonElement
  expect(add.disabled).toBe(true)
  await user.type(within(panel).getByRole('textbox', { name: /Label/ }), 'Go On')
  await user.selectOptions(within(panel).getByRole('combobox', { name: /When Pressed/ }), 'page')
  await user.selectOptions(within(panel).getByRole('combobox', { name: /^Page/ }), 'p1')
  expect(add.disabled).toBe(false)
  await user.click(add)
  expect(screen.getByRole('toolbar', { name: 'Arrange Go On' })).toBeTruthy()
})
