/** The editor's builder (docs/mockups/report-editor-workspace.html, phase E4): Show, Split By, Only Include, Order. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, me, signIn } from '@/test/mockApi'
import type { ReportDefinition } from './types'

const withInsights = { ...me, components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderEditor() {
  const calls = installMockApi({ me: withInsights as never })
  signIn('/insights/reports/rep-1/edit')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  await screen.findByRole('textbox', { name: 'Report name' })
  return calls
}

const lastPreview = (calls: { url: string; body?: unknown }[]) =>
  (calls.filter((call) => call.url.endsWith('/insights/reports/preview/')).at(-1)?.body as { definition: ReportDefinition } | undefined)?.definition

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('one builder in the right pane, no Field Wells or Steps: Show, Split By, Only Include and a folded Order', async () => {
  await renderEditor()
  const build = screen.getByRole('complementary', { name: 'Build' })
  expect(within(build).getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['Show', 'Split By', 'Only Include', 'Order'])
  expect(screen.queryByRole('radio', { name: 'Field Wells' })).toBeNull()
  expect(screen.queryByRole('radio', { name: 'Steps' })).toBeNull()
  const order = within(build).getByRole('region', { name: 'Order' })
  expect(within(order).getByRole('button', { expanded: false }).textContent).toMatch(/^Order.+·/)
  expect(within(order).queryByRole('combobox', { name: 'Sort by' })).toBeNull()
})

test('Add a Split and Add a Number pick from a list of what is not in the report yet; Save writes a version', async () => {
  const user = userEvent.setup()
  await renderEditor()
  const show = screen.getByRole('region', { name: 'Show' })
  const split = screen.getByRole('region', { name: 'Split By' })
  await user.click(within(split).getByRole('button', { name: 'Add a Split' }))
  const splits = screen.getByRole('region', { name: 'Add a Split' })
  expect(within(splits).queryByRole('menuitem', { name: 'Campaign' })).toBeNull()          // already in the report
  await user.click(within(splits).getByRole('menuitem', { name: 'Sent' }))
  expect(within(split).getByRole('listitem', { name: 'Sent' })).toBeTruthy()
  expect(within(split).getByRole('combobox', { name: 'Sent bucket' })).toBeTruthy()

  const addNumber = within(show).queryByRole('button', { name: 'Add a Number' })
  if (addNumber) {
    await user.click(addNumber)
    expect(within(screen.getByRole('region', { name: 'Add a Number' })).getAllByRole('menuitem').length).toBeGreaterThan(0)
    await user.keyboard('{Escape}')
  }

  const save = screen.getByRole('button', { name: 'Save' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  await user.click(save)
  await screen.findAllByText(/version 3/i)
})

test('a number’s one menu: Add Up As only when it has a choice, Compare With always; a comparison shows under the card and is sent', async () => {
  const user = userEvent.setup()
  const calls = await renderEditor()
  const show = screen.getByRole('region', { name: 'Show' })
  await user.click(within(show).getByRole('button', { name: 'Sent Count calculation' }))
  const menu = screen.getByRole('region', { name: 'Sent Count calculation' })
  expect(within(menu).queryByRole('group', { name: 'Add Up As' })).toBeNull()             // Sent Count only adds up one way
  await user.click(within(menu).getByRole('menuitemcheckbox', { name: '% of Total' }))
  expect(within(menu).getByRole('menuitemcheckbox', { name: '% of Total' }).getAttribute('aria-checked')).toBe('true')
  await user.keyboard('{Escape}')
  expect(within(show).getByRole('button', { name: 'Remove % of Total from Sent Count' })).toBeTruthy()
  await vi.waitFor(() => expect(lastPreview(calls)?.columns.find((c) => c.field === 'sent')?.compare).toEqual(['percent_of_total']))
})

test('cards reorder: the grip and ⋯ only in a section of two or more, Move Up and Move Down, greyed at the ends', async () => {
  const user = userEvent.setup()
  const calls = await renderEditor()
  const show = screen.getByRole('region', { name: 'Show' })
  const names = () => within(show).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))
  const before = names()
  expect(before.length).toBeGreaterThan(1)
  const [first, second] = before as string[]
  await screen.findByRole('region', { name: 'Preview rows' })
  const startedAs = (lastPreview(calls)?.columns.filter((c) => c.aggregate).map((c) => c.field) ?? []).slice(0, 2)
  const movedTo = [startedAs[1], startedAs[0]]
  await user.click(within(show).getByRole('button', { name: `More for ${first}` }))
  const menu = screen.getByRole('region', { name: `More for ${first}` })
  expect(within(menu).getByRole('menuitem', { name: 'Move Up' }).getAttribute('aria-disabled')).toBe('true')
  await user.click(within(menu).getByRole('menuitem', { name: 'Move Down' }))
  expect(names().slice(0, 2)).toEqual([second, first])
  await vi.waitFor(() => expect(lastPreview(calls)?.columns.filter((c) => c.aggregate).map((c) => c.field).slice(0, 2)).toEqual(movedTo))

  const split = screen.getByRole('region', { name: 'Split By' })
  if (within(split).getAllByRole('listitem').length === 1) {
    expect(within(split).queryByRole('button', { name: /^More for / })).toBeNull()
  }
})

test('a second split in a pivot can go Across the Top', async () => {
  const user = userEvent.setup()
  const calls = await renderEditor()
  await user.click(await screen.findByRole('radio', { name: 'Pivot' }, { timeout: 5000 }))
  const split = screen.getByRole('region', { name: 'Split By' })
  const pane = screen.getByRole('complementary', { name: 'Fields' })
  for (const name of ['Channel', 'Sent']) {
    const add = within(pane).queryByRole('button', { name: `${name}, add` })
    if (add) await user.click(add)
  }
  const cards = within(split).getAllByRole('listitem')
  expect(cards.length).toBeGreaterThan(1)
  const second = cards[1]
  const label = second.getAttribute('aria-label') as string
  await user.click(within(second).getByRole('radio', { name: 'Across the Top' }))
  await vi.waitFor(() => expect(lastPreview(calls)?.view?.across).toBeTruthy())
  expect(within(second).getByRole('radio', { name: 'Across the Top' }).getAttribute('aria-checked')).toBe('true')
  expect(within(cards[0]).queryByRole('group', { name: /^Put / })).toBeNull()
  expect(label).toBeTruthy()
})

test('Only Include adds a rule; Order opens to Sort By, Show and Top, and its line says what is set', async () => {
  const user = userEvent.setup()
  const calls = await renderEditor()
  const only = screen.getByRole('region', { name: 'Only Include' })
  await user.click(within(only).getByRole('button', { name: 'Add a Rule' }))
  expect(within(only).getByRole('combobox', { name: 'Rule 1 field' })).toBeTruthy()

  const order = screen.getByRole('region', { name: 'Order' })
  await user.click(within(order).getByRole('button', { expanded: false }))
  fireEvent.change(within(order).getByRole('combobox', { name: 'Limit' }), { target: { value: '100' } })
  expect(within(order).getByRole('button', { expanded: true }).textContent).toContain('First 100')
  await vi.waitFor(() => expect(lastPreview(calls)?.limit).toBe(100))
  expect(within(order).getByRole('combobox', { name: 'Sort by' })).toBeTruthy()
  expect(within(order).getByRole('combobox', { name: 'Top' })).toBeTruthy()
})
