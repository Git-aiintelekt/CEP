import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Component } from 'grapesjs'
import { afterEach, expect, test, vi } from 'vitest'

import { DESELECT_LABEL, EMPTY_NOTE, InspectorPanel, NO_SETTINGS_NOTE, VIEW_ONLY_EMPTY_NOTE } from './InspectorPanel'
import { VIEW_ONLY_NOTE } from '../readOnly'

afterEach(cleanup)

function make(type: string, attributes: Record<string, unknown> = {}) {
  let attrs = { ...attributes }
  const state: Record<string, unknown> = { type, tagName: type }
  return {
    get: (key: string) => state[key],
    set: () => {},
    parent: () => undefined,
    getAttributes: () => attrs,
    addAttributes: (next: Record<string, unknown>) => {
      attrs = { ...attrs, ...next }
    },
    removeAttributes: (key: string) => {
      delete attrs[key]
    },
    components: () => ({ map: () => [] }),
  } as unknown as Component
}

const editor = { UndoManager: { stop: vi.fn(), start: vi.fn() } }

function renderPanel(over: Partial<React.ComponentProps<typeof InspectorPanel>> = {}) {
  const onSelectParent = vi.fn()
  const result = render(
    <InspectorPanel kind="mj-spacer" name="Spacer" component={make('mj-spacer')} editor={editor} onSelectParent={onSelectParent} {...over} />,
  )
  return { onSelectParent, ...result }
}

const panel = () => screen.getByRole('complementary', { name: 'Block Settings' })

test('nothing selected says what to do about it', () => {
  renderPanel({ kind: null, component: null })
  expect(screen.getByText(EMPTY_NOTE)).toBeTruthy()
  expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
})

test('the header names the block and carries its glyph', () => {
  renderPanel({ kind: 'mj-button', name: 'Shop now button', component: make('mj-button') })
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Shop now button')
  expect(panel().querySelector('svg')).toBeTruthy()
})

test('the selected block gets its own settings, not a read-only list', () => {
  renderPanel()
  expect(screen.getByLabelText('Height')).toBeTruthy()
  expect(screen.getByRole('button', { name: /^Layout/ })).toBeTruthy()
})

test('a block with nothing to edit says so', () => {
  renderPanel({ kind: 'mj-raw', name: 'Raw', component: make('mj-raw'), hasFields: false })
  expect(screen.getByText(NO_SETTINGS_NOTE)).toBeTruthy()
})

test('select parent is offered only when there is a parent, and calls back', async () => {
  const user = userEvent.setup()
  const { onSelectParent } = renderPanel({ canSelectParent: true })

  await user.click(screen.getByRole('button', { name: /select parent/i }))
  expect(onSelectParent).toHaveBeenCalledTimes(1)

  cleanup()
  renderPanel({ canSelectParent: false })
  expect(screen.queryByRole('button', { name: /select parent/i })).toBeNull()
})

test('the panel narrows a step at a time as the window does', () => {
  renderPanel()
  expect(panel().className).toContain('max-[1439px]:w-[272px]')
  expect(panel().className).toContain('max-[1199px]:w-[264px]')
})

test('the panel is 296px wide with a single hairline on its left edge, and scrolls on its own', () => {
  renderPanel()
  expect(panel().className).toContain('w-[296px]')
  expect(panel().className).toContain('border-l')
  expect(panel().className).not.toContain('border-r')
  expect(panel().querySelector('.overflow-y-auto')).toBeTruthy()
})

test('read-only greys the fields rather than hiding them', () => {
  renderPanel({ disabled: true })
  expect((screen.getByLabelText('Height') as HTMLInputElement).disabled).toBe(true)
  expect(screen.getByLabelText('Height').className).not.toContain('opacity')
})

test('Deselect sits in the header when a block is selected, and clears it', async () => {
  const user = userEvent.setup()
  const onDeselect = vi.fn()
  renderPanel({ onDeselect })
  const button = screen.getByRole('button', { name: DESELECT_LABEL })
  expect(button.getAttribute('title')).toBe(DESELECT_LABEL)
  expect(button.className).toContain('h-8 w-8')
  await user.click(button)
  expect(onDeselect).toHaveBeenCalledTimes(1)
})

test('there is no Deselect with nothing selected', () => {
  renderPanel({ kind: null, component: null, onDeselect: vi.fn() })
  expect(screen.queryByRole('button', { name: DESELECT_LABEL })).toBeNull()
})

// ---- view-only -----------------------------------------------------------

test('view-only says so once, at the top, above the selected block', () => {
  renderPanel({ disabled: true })
  const note = screen.getByText(VIEW_ONLY_NOTE)
  const title = screen.getByRole('heading', { level: 2 })
  expect(note.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getAllByText(VIEW_ONLY_NOTE)).toHaveLength(1)
})

test('an editor sees no view-only note', () => {
  renderPanel()
  expect(screen.queryByText(VIEW_ONLY_NOTE)).toBeNull()
})

test('with nothing selected, view-only asks to select a block to see it, not to edit it', () => {
  renderPanel({ kind: null, component: null, disabled: true })
  expect(screen.getByText(VIEW_ONLY_NOTE)).toBeTruthy()
  expect(screen.getByText(VIEW_ONLY_EMPTY_NOTE)).toBeTruthy()
  expect(screen.queryByText(EMPTY_NOTE)).toBeNull()
})

test('view-only keeps the way out: select parent and deselect still work', async () => {
  const user = userEvent.setup()
  const onSelectParent = vi.fn()
  const onDeselect = vi.fn()
  renderPanel({ disabled: true, canSelectParent: true, onSelectParent, onDeselect })
  await user.click(screen.getByRole('button', { name: /Select Parent/ }))
  await user.click(screen.getByRole('button', { name: DESELECT_LABEL }))
  expect(onSelectParent).toHaveBeenCalledTimes(1)
  expect(onDeselect).toHaveBeenCalledTimes(1)
})

test('the receipt slot says it is fixed, opens Receipt layout and switches the layout', async () => {
  const user = userEvent.setup()
  const onOpenLayout = vi.fn()
  const onPresetChange = vi.fn()
  renderPanel({ kind: 'cep-receipt-slot', name: 'Receipt Slot', component: make('cep-receipt-slot'), receiptSlot: { preset: 'STANDARD', onOpenLayout, onPresetChange } })

  expect(screen.getByText(/This slot is fixed/)).toBeTruthy()
  expect(screen.queryByText(NO_SETTINGS_NOTE)).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Open Receipt Layout' }))
  expect(onOpenLayout).toHaveBeenCalledTimes(1)

  const select = screen.getByLabelText('Current Layout') as HTMLSelectElement
  expect(select.value).toBe('STANDARD')
  expect([...select.options].map((option) => option.textContent)).toEqual(['Compact', 'Standard', 'Itemized'])
  await user.selectOptions(select, 'ITEMIZED')
  expect(onPresetChange).toHaveBeenCalledWith('ITEMIZED')
})

test('a receipt block with no fields shows its callout, not the generic note', () => {
  renderPanel({ kind: 'cep-receipt-divider', name: 'Divider', component: make('cep-receipt-divider'), hasFields: false })
  expect(screen.getByText(/Spacing is fixed by the design system/)).toBeTruthy()
  expect(screen.queryByText(NO_SETTINGS_NOTE)).toBeNull()
})
