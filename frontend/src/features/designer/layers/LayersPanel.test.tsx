import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'

import { DESKTOP_MARKER_LABEL, DESKTOP_NOTE, EMPTY_NOTE, FOOTER_NOTE, HIDDEN_NOTE, LayersPanel, PHONES_MARKER_LABEL, PHONES_NOTE } from './LayersPanel'
import type { LayerNode } from './types'

// jsdom has no layout, so it ships no scrollIntoView; the panel calls it to reveal the selected row
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function node(over: Partial<LayerNode> & Pick<LayerNode, 'id' | 'name'>): LayerNode {
  return {
    kind: 'mj-section',
    children: [],
    open: true,
    visible: true,
    hiddenOnPhones: false,
    hiddenOnDesktop: false,
    selected: false,
    removable: true,
    draggable: true,
    canMoveUp: true,
    canMoveDown: true,
    ...over,
  }
}

/** A section with a column holding two blocks, plus a second, non-removable section standing in for the footer. */
const TREE: LayerNode[] = [
  node({
    id: 's1',
    name: 'Section',
    canMoveUp: false,
    children: [
      node({
        id: 'c1',
        name: 'Column',
        kind: 'mj-column',
        canMoveUp: false,
        canMoveDown: false,
        children: [
          node({ id: 't1', name: 'Text', kind: 'mj-text', children: [], canMoveUp: false }),
          node({ id: 'b1', name: 'Button', kind: 'mj-button', children: [], canMoveDown: false }),
        ],
      }),
    ],
  }),
  node({ id: 'f1', name: 'Footer', removable: false, canMoveDown: false, children: [] }),
]

function renderPanel(over: Partial<React.ComponentProps<typeof LayersPanel>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onToggleOpen: vi.fn(),
    onToggleVisible: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onHover: vi.fn(),
  }
  const result = render(<LayersPanel nodes={TREE} {...handlers} {...over} />)
  return { ...handlers, ...result }
}

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) })
const rows = () => screen.getAllByRole('treeitem')
const action = (rowName: string, actionName: string) => within(row(rowName)).getByRole('button', { name: actionName })

test('the tree renders nested rows with the aria a reader needs', () => {
  renderPanel()

  expect(screen.getByRole('tree', { name: 'Layers' })).toBeTruthy()
  expect(rows().map((item) => item.getAttribute('aria-level'))).toEqual(['1', '2', '3', '3', '1'])
  expect(row('Section').getAttribute('aria-expanded')).toBe('true')
  expect(row('Text').hasAttribute('aria-expanded')).toBe(false) // no children, so no expanded state at all
  expect(row('Footer').hasAttribute('aria-expanded')).toBe(false)
})

test('a closed branch hides its descendants', () => {
  renderPanel({ nodes: [{ ...TREE[0], open: false }, TREE[1]] })

  expect(rows().map((item) => item.textContent)).toEqual(['Section', 'Footer'])
  expect(row('Section').getAttribute('aria-expanded')).toBe('false')
})

test('the selected row says so and carries the brand tint, not a blue fill of its own', () => {
  renderPanel({ nodes: [{ ...TREE[0], selected: true }, TREE[1]] })

  expect(row('Section').getAttribute('aria-selected')).toBe('true')
  expect(row('Footer').getAttribute('aria-selected')).toBe('false')
  // the treeitem wraps the design's row, which is what carries the tint and the brand bar
  expect((row('Section').firstElementChild as HTMLElement).className).toContain('bg-brand-100')
  expect(within(row('Section')).getByTitle('Section').className).toContain('text-brand-800')
})

test('the selected row is scrolled into view, since the canvas can select something far down the tree', () => {
  const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
  renderPanel({ nodes: [TREE[0], { ...TREE[1], selected: true }] })
  expect(scrollIntoView).toHaveBeenCalled()
})

test('clicking a row selects it and the chevron only expands', async () => {
  const user = userEvent.setup()
  const { onSelect, onToggleOpen } = renderPanel()

  await user.click(row('Text'))
  expect(onSelect).toHaveBeenCalledWith('t1')

  await user.click(within(row('Section')).getByRole('button', { name: 'Collapse Section' }))
  expect(onToggleOpen).toHaveBeenCalledWith('s1')
  expect(onSelect).toHaveBeenCalledTimes(1) // the chevron did not also select
})

test('the eye toggles, and a hidden row explains that the block still ships', async () => {
  const user = userEvent.setup()
  const { onToggleVisible } = renderPanel()

  await user.click(action('Text', 'Hide on Canvas: Text'))
  expect(onToggleVisible).toHaveBeenCalledWith('t1')

  cleanup()
  renderPanel({ nodes: [{ ...TREE[0], visible: false, children: TREE[0].children }, TREE[1]] })
  const label = within(row('Section')).getByTitle(`Section — ${HIDDEN_NOTE}`)
  expect(label.className).toContain('text-ink-300')
  expect(within(row('Section')).getByTitle('Hidden on Canvas')).toBeTruthy()
  expect(screen.getByText(HIDDEN_NOTE)).toBeTruthy()
  expect(within(row('Section')).getByRole('button', { name: 'Show on Canvas: Section' })).toBeTruthy()
})

test('F2 renames: Enter commits, Escape keeps the old name', async () => {
  const user = userEvent.setup()
  const { onRename } = renderPanel()

  row('Section').focus()
  await user.keyboard('{F2}')
  await user.clear(screen.getByRole('textbox', { name: 'Rename Section' }))
  await user.keyboard('Masthead{Enter}')
  expect(onRename).toHaveBeenCalledWith('s1', 'Masthead')

  row('Section').focus()
  await user.keyboard('{F2}')
  await user.keyboard('Nope{Escape}')
  expect(onRename).toHaveBeenCalledTimes(1)
})

test('leaving the rename field commits what was typed', async () => {
  const user = userEvent.setup()
  const { onRename } = renderPanel()

  row('Section').focus()
  await user.keyboard('{F2}')
  await user.clear(screen.getByRole('textbox', { name: 'Rename Section' }))
  await user.keyboard('Top')
  await user.click(row('Footer'))
  expect(onRename).toHaveBeenCalledWith('s1', 'Top')
})

test('delete works from the button and the key, and never for a row that cannot be removed', async () => {
  const user = userEvent.setup()
  const { onDelete } = renderPanel()

  await user.click(action('Text', 'Delete: Text'))
  expect(onDelete).toHaveBeenNthCalledWith(1, 't1')

  row('Button').focus()
  await user.keyboard('{Delete}')
  expect(onDelete).toHaveBeenNthCalledWith(2, 'b1')

  expect(within(row('Footer')).queryByRole('button', { name: /^Delete/ })).toBeNull()
  row('Footer').focus()
  await user.keyboard('{Delete}')
  expect(onDelete).toHaveBeenCalledTimes(2)
})

test('the move buttons and Alt+arrows reorder, and go inert at the ends', async () => {
  const user = userEvent.setup()
  const { onMove } = renderPanel()

  await user.click(action('Button', 'Move Up: Button'))
  expect(onMove).toHaveBeenNthCalledWith(1, 'b1', 'up')

  row('Text').focus()
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
  expect(onMove).toHaveBeenNthCalledWith(2, 't1', 'down')

  // Text is first in its column and Button is last: each has one end it cannot pass
  expect(action('Text', 'Move Up: Text').getAttribute('aria-disabled')).toBe('true')
  expect(action('Button', 'Move Down: Button').getAttribute('aria-disabled')).toBe('true')
  await user.click(action('Text', 'Move Up: Text'))
  row('Button').focus()
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
  expect(onMove).toHaveBeenCalledTimes(2)
})

test('arrow keys walk the visible rows, and Right and Left open and close a branch', async () => {
  const user = userEvent.setup()
  const { onToggleOpen } = renderPanel()

  row('Section').focus()
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(row('Column'))

  await user.keyboard('{ArrowUp}')
  expect(document.activeElement).toBe(row('Section'))

  await user.keyboard('{ArrowLeft}') // open with children: collapses
  expect(onToggleOpen).toHaveBeenCalledWith('s1')

  await user.keyboard('{ArrowRight}') // already open: steps into the first child
  expect(document.activeElement).toBe(row('Column'))

  // a leaf has no branch to close, so Left steps up to the parent instead
  row('Text').focus()
  await user.keyboard('{ArrowLeft}')
  expect(document.activeElement).toBe(row('Column'))
})

test('Right on a leaf does nothing, and the ends of the list hold', async () => {
  const user = userEvent.setup()
  const { onToggleOpen } = renderPanel()

  row('Text').focus()
  await user.keyboard('{ArrowRight}')
  expect(document.activeElement).toBe(row('Text'))
  expect(onToggleOpen).not.toHaveBeenCalled()

  row('Section').focus()
  await user.keyboard('{ArrowUp}')
  expect(document.activeElement).toBe(row('Section'))

  row('Footer').focus()
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(row('Footer'))
})

test('Enter selects the focused row', async () => {
  const user = userEvent.setup()
  const { onSelect } = renderPanel()

  row('Button').focus()
  await user.keyboard('{Enter}')
  expect(onSelect).toHaveBeenCalledWith('b1')
})

test('the tree is one tab stop, and it follows the focused row', async () => {
  const user = userEvent.setup()
  renderPanel()

  expect(rows().filter((item) => item.tabIndex === 0)).toHaveLength(1)
  expect(row('Section').tabIndex).toBe(0)

  row('Section').focus()
  await user.keyboard('{ArrowDown}')
  expect(rows().filter((item) => item.tabIndex === 0)).toHaveLength(1)
  expect(row('Column').tabIndex).toBe(0)
})

test('read-only still selects and expands, but every mutating action is inert and grey', async () => {
  const user = userEvent.setup()
  const { onSelect, onToggleOpen, onToggleVisible, onDelete, onMove, onRename } = renderPanel({ disabled: true })

  await user.click(row('Text'))
  expect(onSelect).toHaveBeenCalledWith('t1')
  await user.click(within(row('Section')).getByRole('button', { name: 'Collapse Section' }))
  expect(onToggleOpen).toHaveBeenCalledWith('s1')

  const eye = action('Text', 'Hide on Canvas: Text')
  expect(eye.getAttribute('aria-disabled')).toBe('true')
  expect(eye.className).toContain('bg-line-subtle')
  expect(eye.className).not.toContain('opacity')

  await user.click(eye)
  await user.click(action('Text', 'Delete: Text'))
  await user.click(action('Button', 'Move Up: Button'))
  row('Text').focus()
  await user.keyboard('{Delete}{F2}')
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

  expect(onToggleVisible).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
  expect(onMove).not.toHaveBeenCalled()
  expect(onRename).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox')).toBeNull()
})

test('hovering a row reports it, and leaving the tree clears it', async () => {
  const user = userEvent.setup()
  const { onHover } = renderPanel()

  await user.hover(row('Text'))
  expect(onHover).toHaveBeenCalledWith('t1')
  await user.unhover(screen.getByRole('tree'))
  expect(onHover).toHaveBeenLastCalledWith(null)
})

test('an empty tree says what to do about it', () => {
  renderPanel({ nodes: [] })
  expect(screen.getByText(EMPTY_NOTE)).toBeTruthy()
  expect(screen.queryByRole('treeitem')).toBeNull()
})

test('the footer keeps a delete it cannot use: grey, inert and able to say why', async () => {
  const user = userEvent.setup()
  const { onDelete } = renderPanel()

  const button = within(row('Footer')).getByRole('button', { name: FOOTER_NOTE })
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.getAttribute('title')).toBe(FOOTER_NOTE)
  expect(button.className).toContain('bg-line-subtle')
  expect(button.className).toContain('text-ink-300')
  expect(button.className).not.toContain('opacity')

  await user.click(button)
  expect(onDelete).not.toHaveBeenCalled()
})

// ---- hidden on phones ----------------------------------------------------

test('a section hidden on phones is marked, and says something different from hidden-on-canvas', () => {
  renderPanel({ nodes: [node({ id: 's1', name: 'Promo', hiddenOnPhones: true })] })

  expect(screen.getByLabelText(PHONES_MARKER_LABEL)).toBeTruthy()
  expect(screen.getByText(PHONES_NOTE)).toBeTruthy()
  expect(screen.queryByText(HIDDEN_NOTE)).toBeNull()
  // the two states must never read as the same thing
  expect(PHONES_NOTE).not.toBe(HIDDEN_NOTE)
})

test('a block hidden on desktop is marked, apart from one hidden on phones', () => {
  renderPanel({ nodes: [node({ id: 't1', name: 'Phone menu', hiddenOnDesktop: true })] })

  expect(screen.getByLabelText(DESKTOP_MARKER_LABEL)).toBeTruthy()
  expect(screen.getByText(DESKTOP_NOTE)).toBeTruthy()
  expect(screen.queryByLabelText(PHONES_MARKER_LABEL)).toBeNull()
  expect(DESKTOP_NOTE).not.toBe(PHONES_NOTE)
})

test('the two kinds of hiding are marked apart on one row', () => {
  renderPanel({ nodes: [node({ id: 's1', name: 'Promo', visible: false, hiddenOnPhones: true })] })

  expect(screen.getByLabelText(PHONES_MARKER_LABEL)).toBeTruthy()
  expect(screen.getByTitle('Hidden on Canvas')).toBeTruthy()
  expect(screen.getByText(PHONES_NOTE)).toBeTruthy()
  expect(screen.getByText(HIDDEN_NOTE)).toBeTruthy()
})

test('a section that is not hidden on phones carries no marker', () => {
  renderPanel({ nodes: [node({ id: 's1', name: 'Promo' })] })

  expect(screen.queryByLabelText(PHONES_MARKER_LABEL)).toBeNull()
  expect(screen.queryByText(PHONES_NOTE)).toBeNull()
})
