import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { BlockPalette, FALLBACK_ICON } from './BlockPalette'
import { BLOCK_CATEGORIES, CEP_BLOCKS } from './blocks/registry'

afterEach(cleanup)

function renderPalette(over: Partial<React.ComponentProps<typeof BlockPalette>> = {}) {
  const onDragStart = vi.fn()
  const onInsert = vi.fn()
  const result = render(<BlockPalette blocks={CEP_BLOCKS} onDragStart={onDragStart} onInsert={onInsert} {...over} />)
  return { onDragStart, onInsert, ...result }
}

const tile = (label: string) => screen.getByRole('button', { name: label })
const search = () => screen.getByRole('searchbox', { name: 'Search blocks' })

test('every block in the registry gets a tile, under its category heading', () => {
  renderPalette()

  for (const category of BLOCK_CATEGORIES) {
    const heading = screen.getByRole('heading', { name: category.label })
    const group = heading.parentElement as HTMLElement
    const expected = CEP_BLOCKS.filter((block) => block.category === category.id).map((block) => block.label)
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(expected)
  }
  expect(screen.getAllByRole('button').filter((button) => CEP_BLOCKS.some((block) => block.label === button.textContent))).toHaveLength(CEP_BLOCKS.length)
})

test('every tile shows its whole label, two to a row as the design lays them out', () => {
  renderPalette()

  for (const block of CEP_BLOCKS) {
    const button = tile(block.label)
    expect(button.textContent, block.id).toBe(block.label) // the full name, not a clipped one
    expect(button.className, block.id).not.toContain('truncate')
    expect(button.className, block.id).toContain('py-2.5')
    expect(button.querySelector('span')?.className, block.id).not.toMatch(/truncate|line-clamp|text-ellipsis/)
    expect(button.parentElement?.className, block.id).toContain('grid-cols-2')
  }
})

test('the palette is a region a reader can find by name', () => {
  renderPalette()
  expect(screen.getByRole('complementary', { name: 'Blocks' })).toBeTruthy()
})

test('search filters by block label', async () => {
  const user = userEvent.setup()
  renderPalette()

  await user.type(search(), 'but')
  expect(tile('Button')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Coupon' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Structure' })).toBeNull() // empty groups are hidden
})

test('search filters by category label, case-insensitively', async () => {
  const user = userEvent.setup()
  renderPalette()

  await user.type(search(), 'COMMERCE')
  expect(tile('Product card')).toBeTruthy()
  expect(tile('Coupon')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Heading' })).toBeNull()
})

test('a search that matches nothing says so, and clearing brings the blocks back', async () => {
  const user = userEvent.setup()
  renderPalette()

  await user.type(search(), 'zzz')
  expect(screen.getByText('No blocks match')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Content' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(screen.queryByText('No blocks match')).toBeNull()
  expect(tile('Button')).toBeTruthy()
  expect((search() as HTMLInputElement).value).toBe('')
})

test('the clear button only appears once something is typed', async () => {
  const user = userEvent.setup()
  renderPalette()

  expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  await user.type(search(), 'a')
  expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy()
})

test('pressing the primary pointer button starts a drag with the block id', async () => {
  const user = userEvent.setup()
  const { onDragStart, onInsert } = renderPalette()

  await user.pointer({ keys: '[MouseLeft>]', target: tile('Two columns') })
  expect(onDragStart).toHaveBeenCalledTimes(1)
  expect(onDragStart.mock.calls[0][0]).toBe('columns-2')
  expect(onInsert).not.toHaveBeenCalled()
})

test('a secondary pointer button starts nothing', async () => {
  const user = userEvent.setup()
  const { onDragStart } = renderPalette()

  await user.pointer({ keys: '[MouseRight>]', target: tile('Button') })
  expect(onDragStart).not.toHaveBeenCalled()
})

test('Enter and Space insert, and Space does not scroll the palette', async () => {
  const user = userEvent.setup()
  const { onInsert, onDragStart } = renderPalette()

  tile('Button').focus()
  await user.keyboard('{Enter}')
  expect(onInsert).toHaveBeenNthCalledWith(1, 'button')

  await user.keyboard(' ')
  expect(onInsert).toHaveBeenNthCalledWith(2, 'button')
  expect(onDragStart).not.toHaveBeenCalled()
})

test('a pointer click does not insert as well as drag', async () => {
  const user = userEvent.setup()
  const { onInsert, onDragStart } = renderPalette()

  await user.click(tile('Coupon'))
  expect(onDragStart).toHaveBeenCalledTimes(1)
  expect(onInsert).not.toHaveBeenCalled()
})

test('disabled tiles stay focusable and say so, but do nothing', async () => {
  const user = userEvent.setup()
  const { onDragStart, onInsert } = renderPalette({ disabled: true })

  const button = tile('Button')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.hasAttribute('disabled')).toBe(false)
  expect(button.className).toContain('bg-line-subtle')
  expect(button.className).not.toContain('opacity')

  button.focus()
  expect(document.activeElement).toBe(button)

  await user.click(button)
  await user.keyboard('{Enter}')
  await user.pointer({ keys: '[MouseLeft>]', target: button })
  expect(onDragStart).not.toHaveBeenCalled()
  expect(onInsert).not.toHaveBeenCalled()
})

test('the message is announced politely and is empty when there is none', () => {
  const { rerender } = renderPalette()
  const region = screen.getByRole('status')
  expect(region.getAttribute('aria-live')).toBe('polite')
  expect(region.textContent).toBe('')

  rerender(<BlockPalette blocks={CEP_BLOCKS} onDragStart={vi.fn()} onInsert={vi.fn()} message="Drop this inside a column." />)
  expect(screen.getByRole('status').textContent).toBe('Drop this inside a column.')
})

test('every icon the registry names resolves, so no tile falls back', () => {
  renderPalette()

  const fallback = render(<FALLBACK_ICON data-testid="fallback" />)
  const fallbackPath = fallback.container.querySelector('svg')?.innerHTML
  fallback.unmount()

  for (const block of CEP_BLOCKS) {
    const svg = tile(block.label).querySelector('svg')
    expect(svg, block.id).toBeTruthy()
    expect(svg?.innerHTML, `${block.id} fell back to the generic icon`).not.toBe(fallbackPath)
  }
})

test('an unknown icon name falls back instead of breaking the tile', () => {
  renderPalette({ blocks: [{ id: 'odd', label: 'Odd one', category: 'content', icon: 'NoSuchIcon', mjml: '<mj-text>x</mj-text>' }] })
  expect(tile('Odd one').querySelector('svg')).toBeTruthy()
})

test('a note is a callout under the grid, announced once and never twice', () => {
  renderPalette({ message: 'Drop this inside a column.' })

  const callout = screen.getByText('Drop this inside a column.', { selector: 'div' })
  expect(callout.closest('[aria-hidden]')).toBeTruthy() // the live region below says it instead
  const frame = callout.parentElement as HTMLElement
  expect(frame.className).toContain('bg-callout-bg')
  expect(frame.className).toContain('mx-2')
  expect(screen.getAllByRole('status')).toHaveLength(1)
})
