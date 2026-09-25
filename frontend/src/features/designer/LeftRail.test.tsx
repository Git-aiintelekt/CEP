import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Braces, LayoutGrid, Layers, Image } from 'lucide-react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createRef } from 'react'

import { LeftRail, type LeftRailHandle, type RailTab } from './LeftRail'

const KEY = 'cep.test.rail'

const TABS: RailTab[] = [
  { id: 'blocks', label: 'Blocks', icon: LayoutGrid, panel: <input aria-label="Search blocks" /> },
  { id: 'layers', label: 'Layers', icon: Layers, panel: <p>Layer tree</p> },
  { id: 'assets', label: 'Assets', icon: Image, panel: <p>Asset list</p> },
]

afterEach(cleanup)
beforeEach(() => window.localStorage.clear())

function renderRail(over: Partial<React.ComponentProps<typeof LeftRail>> = {}) {
  const onLayoutChange = vi.fn()
  const result = render(<LeftRail tabs={TABS} storageKey={KEY} onLayoutChange={onLayoutChange} {...over} />)
  return { onLayoutChange, ...result }
}

const tab = (name: string) => screen.getByRole('tab', { name })
const selected = () => screen.queryAllByRole('tab', { selected: true }).map((node) => node.textContent)
// by id rather than by name: an accessible name is not computed for a hidden element, and hidden is the point here
const panel = (name: string) => document.getElementById(tab(name).getAttribute('aria-controls') ?? '') as HTMLElement

test('the strip shows exactly the tabs it was given, in order', () => {
  renderRail()
  expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual(['Blocks', 'Layers', 'Assets'])
})

test('the tablist is vertical, named, and its panels are labelled by their tab', () => {
  renderRail({ 'aria-label': 'Designer Panels' })

  const list = screen.getByRole('tablist', { name: 'Designer Panels' })
  expect(list.getAttribute('aria-orientation')).toBe('vertical')
  for (const item of TABS) {
    expect(panel(item.label), item.id).toBeTruthy()
    expect(panel(item.label).getAttribute('role')).toBe('tabpanel')
    expect(panel(item.label).getAttribute('aria-labelledby')).toBe(tab(item.label).id)
  }
})

test('the first tab is open by default and only its panel is visible', () => {
  renderRail()

  expect(selected()).toEqual(['Blocks'])
  expect(panel('Blocks').hasAttribute('hidden')).toBe(false)
  expect(panel('Layers').hasAttribute('hidden')).toBe(true)
  // the class too: `display: flex` from a class outranks the browser's [hidden] rule
  expect(panel('Layers').className).toContain('hidden')
  expect(panel('Layers').className).not.toContain('flex ')
})

test('clicking the open tab collapses the rail, and clicking it again reopens', async () => {
  const user = userEvent.setup()
  const { onLayoutChange } = renderRail()

  await user.click(tab('Blocks'))
  expect(selected()).toEqual([])
  expect(panel('Blocks').closest('[hidden]')).toBeTruthy() // the whole panel column is hidden
  expect(tab('Blocks').tabIndex).toBe(0) // still the tab Tab key reaches, and the one that will reopen
  expect(onLayoutChange).toHaveBeenCalledTimes(1)

  await user.click(tab('Blocks'))
  expect(selected()).toEqual(['Blocks'])
  expect(panel('Blocks').closest('[hidden]')).toBeNull()
  expect(onLayoutChange).toHaveBeenCalledTimes(2)
})

test('clicking another tab opens it instead, without collapsing', async () => {
  const user = userEvent.setup()
  const { onLayoutChange } = renderRail()

  await user.click(tab('Layers'))
  expect(selected()).toEqual(['Layers'])
  expect(panel('Layers').hasAttribute('hidden')).toBe(false)
  expect(panel('Blocks').hasAttribute('hidden')).toBe(true)
  expect(onLayoutChange).not.toHaveBeenCalled() // the width did not change
})

test('clicking any tab while collapsed opens that tab', async () => {
  const user = userEvent.setup()
  renderRail()

  await user.click(tab('Blocks'))
  await user.click(tab('Assets'))
  expect(selected()).toEqual(['Assets'])
  expect(panel('Assets').hasAttribute('hidden')).toBe(false)
})

test('arrow keys move and activate, wrapping at both ends', async () => {
  const user = userEvent.setup()
  renderRail()

  tab('Blocks').focus()
  await user.keyboard('{ArrowDown}')
  expect(selected()).toEqual(['Layers'])
  expect(document.activeElement).toBe(tab('Layers'))

  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(selected()).toEqual(['Blocks'])

  await user.keyboard('{ArrowUp}')
  expect(selected()).toEqual(['Assets'])
  expect(document.activeElement).toBe(tab('Assets'))
})

test('Home and End jump to the ends', async () => {
  const user = userEvent.setup()
  renderRail()

  tab('Blocks').focus()
  await user.keyboard('{End}')
  expect(selected()).toEqual(['Assets'])

  await user.keyboard('{Home}')
  expect(selected()).toEqual(['Blocks'])
})

test('Enter and Space work the focused tab', async () => {
  const user = userEvent.setup()
  renderRail()

  tab('Blocks').focus()
  await user.keyboard('{Enter}')
  expect(selected()).toEqual([]) // the open tab collapses

  await user.keyboard(' ')
  expect(selected()).toEqual(['Blocks'])
})

test('an arrow key reopens a collapsed rail rather than leaving it shut', async () => {
  const user = userEvent.setup()
  renderRail()

  await user.click(tab('Blocks'))
  await user.keyboard('{ArrowDown}')
  expect(selected()).toEqual(['Layers'])
})

test('a panel stays mounted while another tab is open, keeping what was typed in it', async () => {
  const user = userEvent.setup()
  renderRail()

  const search = screen.getByLabelText('Search blocks')
  await user.type(search, 'butt')
  await user.click(tab('Layers'))

  expect(screen.getByLabelText('Search blocks')).toBe(search)
  expect((search as HTMLInputElement).value).toBe('butt')
})

test('the open tab and the collapsed state are remembered', async () => {
  const user = userEvent.setup()
  const first = renderRail()
  await user.click(tab('Assets'))
  await user.click(tab('Assets'))
  first.unmount()

  renderRail()
  expect(selected()).toEqual([])
  expect(tab('Assets').tabIndex).toBe(0)

  await user.click(tab('Assets'))
  expect(selected()).toEqual(['Assets'])
})

test('a stored tab that no longer exists falls back to the first tab, expanded', () => {
  window.localStorage.setItem(KEY, JSON.stringify({ activeId: 'gone', collapsed: true }))
  renderRail()
  expect(selected()).toEqual(['Blocks'])
})

test('stored nonsense falls back instead of breaking', () => {
  window.localStorage.setItem(KEY, 'not json')
  renderRail()
  expect(selected()).toEqual(['Blocks'])
})

test('storage that throws on read or write does not stop the rail working', async () => {
  const user = userEvent.setup()
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })

  renderRail()
  expect(selected()).toEqual(['Blocks'])
  await user.click(tab('Blocks'))
  expect(selected()).toEqual([])

  getItem.mockRestore()
  setItem.mockRestore()
})

test('without a storage key nothing is written and every mount starts open', async () => {
  const user = userEvent.setup()
  const { unmount } = renderRail({ storageKey: undefined })

  await user.click(tab('Layers'))
  unmount()
  expect(window.localStorage.length).toBe(0)

  renderRail({ storageKey: undefined })
  expect(selected()).toEqual(['Blocks'])
})

test('openTab opens a tab from outside, expanding a collapsed rail', async () => {
  const user = userEvent.setup()
  const ref = createRef<LeftRailHandle>()
  const onLayoutChange = vi.fn()
  render(<LeftRail ref={ref} tabs={TABS} storageKey={KEY} onLayoutChange={onLayoutChange} />)

  await user.click(tab('Blocks')) // collapse
  expect(selected()).toEqual([])

  act(() => ref.current?.openTab('assets'))
  expect(selected()).toEqual(['Assets'])
  expect(panel('Assets').closest('[hidden]')).toBeNull()
  expect(onLayoutChange).toHaveBeenCalledTimes(2) // collapsed, then expanded again
})

test('openTab ignores a tab this rail does not have', () => {
  const ref = createRef<LeftRailHandle>()
  render(<LeftRail ref={ref} tabs={TABS} storageKey={KEY} />)

  act(() => ref.current?.openTab('nope'))
  expect(selected()).toEqual(['Blocks'])
})

test('a single tab still works, and arrow keys stay on it', async () => {
  const user = userEvent.setup()
  renderRail({ tabs: [TABS[0]] })

  expect(screen.getAllByRole('tab')).toHaveLength(1)
  tab('Blocks').focus()
  await user.keyboard('{ArrowDown}')
  expect(selected()).toEqual(['Blocks'])

  await user.click(tab('Blocks'))
  expect(selected()).toEqual([])
})

const FOUR: RailTab[] = [...TABS, { id: 'tags', label: 'Tags', icon: Braces, panel: <input aria-label="Search Tags" /> }]

test('a Tags tab sits after Assets and its panel is wired like the rest', () => {
  renderRail({ tabs: FOUR })
  expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual(['Blocks', 'Layers', 'Assets', 'Tags'])
  expect(panel('Tags').getAttribute('role')).toBe('tabpanel')
  expect(panel('Tags').hasAttribute('hidden')).toBe(true)
})

test('the arrow keys reach Tags from Assets and wrap back to Blocks', async () => {
  const user = userEvent.setup()
  renderRail({ tabs: FOUR })
  await user.click(tab('Assets'))
  await user.keyboard('{ArrowDown}')
  expect(selected()).toEqual(['Tags'])
  expect(panel('Tags').hasAttribute('hidden')).toBe(false)
  await user.keyboard('{ArrowDown}')
  expect(selected()).toEqual(['Blocks'])
})

test('openTab("tags") opens the Tags panel from outside, expanding a collapsed rail', async () => {
  const user = userEvent.setup()
  const ref = createRef<LeftRailHandle>()
  render(<LeftRail ref={ref} tabs={FOUR} storageKey={KEY} />)
  await user.click(tab('Blocks')) // collapses the open tab
  expect(selected()).toEqual([])

  act(() => ref.current?.openTab('tags'))
  expect(selected()).toEqual(['Tags'])
  expect(panel('Tags').hasAttribute('hidden')).toBe(false)
  expect(screen.getByLabelText('Search Tags')).toBeTruthy()
})

// --- folding itself when the viewport is too narrow, without ever overwriting what the viewer chose ---

const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? '{}')

test('a narrow viewport opens with the rail folded to its strip', () => {
  renderRail({ autoCollapse: true })
  expect(selected()).toEqual([])
  expect(panel('Blocks').closest('[hidden]')).toBeTruthy() // the whole panel column is hidden
})

test('crossing below the breakpoint folds it, and crossing back restores what the viewer chose', () => {
  const { rerender } = renderRail()
  expect(selected()).toEqual(['Blocks'])

  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse />)
  expect(selected()).toEqual([])

  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse={false} />)
  expect(selected()).toEqual(['Blocks'])
})

test('the automatic fold is never written down as a preference', async () => {
  const user = userEvent.setup()
  const { rerender } = renderRail()
  await user.click(tab('Layers'))
  expect(stored()).toEqual({ activeId: 'layers', collapsed: false })

  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse />)
  expect(selected()).toEqual([])
  expect(stored()).toEqual({ activeId: 'layers', collapsed: false })
})

test('a collapse the viewer chose is written down, and survives a trip through a narrow viewport', async () => {
  const user = userEvent.setup()
  const { rerender } = renderRail()
  await user.click(tab('Blocks')) // the open tab: collapses it
  expect(stored()).toEqual({ activeId: 'blocks', collapsed: true })

  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse />)
  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse={false} />)
  expect(selected()).toEqual([])
})

test('opening it by hand at a narrow width wins, and survives a re-render', async () => {
  const user = userEvent.setup()
  const { rerender } = renderRail({ autoCollapse: true })
  expect(selected()).toEqual([])

  await user.click(tab('Assets'))
  expect(selected()).toEqual(['Assets'])

  // a re-render at the same width leaves the viewer's choice alone
  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse />)
  expect(selected()).toEqual(['Assets'])
  expect(panel('Assets').closest('[hidden]')).toBeNull()
})

test('openTab wins over the automatic fold too, since it is the viewer asking', () => {
  const ref = createRef<LeftRailHandle>()
  render(<LeftRail ref={ref} tabs={TABS} storageKey={KEY} autoCollapse />)
  expect(selected()).toEqual([])

  act(() => ref.current?.openTab('layers'))
  expect(selected()).toEqual(['Layers'])
})

test('folding again needs another crossing, not just another render', async () => {
  const user = userEvent.setup()
  const { rerender } = renderRail({ autoCollapse: true })
  await user.click(tab('Blocks'))
  expect(selected()).toEqual(['Blocks'])

  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse />)
  expect(selected()).toEqual(['Blocks'])

  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse={false} />)
  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse />)
  expect(selected()).toEqual([])
})

test('the zone is 256px at every width: a 64px strip and a 192px panel', () => {
  renderRail()
  const rail = panel('Blocks').parentElement as HTMLElement
  expect(rail.className).toContain('w-48')
  expect(rail.className).not.toContain('max-[')
  expect(screen.getByRole('tablist').className).toContain('w-16')
  expect(screen.getByRole('tablist').className).not.toContain('max-[')
})

// --- a fold forced from outside (fullscreen), lifted to exactly what was there before ---

test('a forced fold hides the panel and, lifted, gives back an open rail', () => {
  const { rerender } = renderRail()
  rerender(<LeftRail tabs={TABS} storageKey={KEY} forceCollapsed />)
  expect(selected()).toEqual([])
  expect(panel('Blocks').closest('[hidden]')).toBeTruthy()
  rerender(<LeftRail tabs={TABS} storageKey={KEY} forceCollapsed={false} />)
  expect(selected()).toEqual(['Blocks'])
  expect(stored()).toEqual({ activeId: 'blocks', collapsed: false })
})

test('a rail the viewer had folded stays folded once the force is lifted', async () => {
  const user = userEvent.setup()
  const { rerender } = renderRail()
  await user.click(tab('Blocks'))
  expect(selected()).toEqual([])
  rerender(<LeftRail tabs={TABS} storageKey={KEY} forceCollapsed />)
  rerender(<LeftRail tabs={TABS} storageKey={KEY} forceCollapsed={false} />)
  expect(selected()).toEqual([])
  expect(stored()).toEqual({ activeId: 'blocks', collapsed: true })
})

test('a rail folded by a narrow viewport is still folded that way once the force is lifted', () => {
  const { rerender } = renderRail({ autoCollapse: true })
  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse forceCollapsed />)
  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse forceCollapsed={false} />)
  expect(selected()).toEqual([])
  rerender(<LeftRail tabs={TABS} storageKey={KEY} autoCollapse={false} forceCollapsed={false} />)
  expect(selected()).toEqual(['Blocks'])
})

test('a tab pressed while forced is reported, not acted on, and the stored state is untouched', async () => {
  const user = userEvent.setup()
  const onPressWhileForced = vi.fn()
  render(<LeftRail tabs={TABS} storageKey={KEY} forceCollapsed onPressWhileForced={onPressWhileForced} />)
  await user.click(tab('Layers'))
  expect(onPressWhileForced).toHaveBeenCalledWith('layers')
  expect(selected()).toEqual([])
  expect(stored()).toEqual({ activeId: 'blocks', collapsed: false })
})

test('the handle says whether the panel is showing', () => {
  const ref = createRef<LeftRailHandle>()
  const { rerender } = render(<LeftRail ref={ref} tabs={TABS} storageKey={KEY} />)
  expect(ref.current?.isOpen()).toBe(true)
  rerender(<LeftRail ref={ref} tabs={TABS} storageKey={KEY} forceCollapsed />)
  expect(ref.current?.isOpen()).toBe(false)
})
