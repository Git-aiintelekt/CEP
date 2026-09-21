import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { CanvasToolbar } from './CanvasToolbar'
import { EXIT_FULLSCREEN_LABEL, FIT_LABEL, MORE_LABEL, OUTLINES_LABEL, TOOL_LABELS, ZOOM_MENU_LABEL } from './toolbarLabels'

/**
 * jsdom lays nothing out, so the measurement the toolbar makes is fed here: each hidden tier reports what it
 * really comes to in the browser, and the row is as wide as a test says. ResizeObserver is a stub tests fire.
 */
const TIER_WIDTHS = [598, 518, 386]
let rowWidth = 2000
let resize: (() => void) | null = null
beforeEach(() => {
  rowWidth = 2000
  resize = null
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      const tier = this.dataset.tier
      return tier === undefined ? 0 : TIER_WIDTHS[Number(tier)]
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'toolbar' ? rowWidth : 0
    },
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) {
      resize = callback
    }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const DEVICES = [{ id: 'Desktop', label: 'Desktop' }, { id: 'Tablet', label: 'Tablet' }, { id: 'Mobile portrait', label: 'Mobile' }]

function renderToolbar(over: Partial<React.ComponentProps<typeof CanvasToolbar>> = {}) {
  const handlers = {
    onUndo: vi.fn(), onRedo: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(), onZoomSelect: vi.fn(), onDeviceChange: vi.fn(),
    onOutlinesChange: vi.fn(), onPreview: vi.fn(), onFullscreen: vi.fn(), onViewCode: vi.fn(), onDownload: vi.fn(),
  }
  render(<CanvasToolbar canUndo canRedo zoom={100} zoomMode="manual" devices={DEVICES} device="Desktop" outlines {...handlers} {...over} />)
  return handlers
}

/** the visible group only: the measuring copy is aria-hidden and is never what a reader sees */
const group = () => document.querySelector('[data-tools-group]') as HTMLElement
const button = (name: string) => within(group()).getByRole('button', { name })
const maybe = (name: string) => within(group()).queryByRole('button', { name })
const disabled = (name: string) => button(name).getAttribute('aria-disabled') === 'true'
const order = () => [...group().querySelectorAll<HTMLElement>('[data-tool]')].map((el) => el.dataset.tool)

test('one centred group, in the given order, in a 56px row with the hairline beneath', () => {
  renderToolbar()
  const bar = screen.getByRole('toolbar', { name: 'Canvas' })
  expect(bar.className).toContain('h-14')
  expect(bar.className).toContain('justify-center')
  expect(bar.className).toContain('border-b')
  expect(order()).toEqual(['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|', 'outlines', 'preview', 'fullscreen', 'code', 'download'])
  expect(group().className).toContain('gap-2')
  for (const name of ['Undo', 'Redo', 'Zoom out', 'Zoom in', OUTLINES_LABEL, 'Preview', 'Fullscreen', 'View code', TOOL_LABELS.download]) {
    expect(button(name).className).toContain('h-8')
    expect(button(name).getAttribute('title')).toBe(name)
  }
})

test('the buttons report what was pressed', async () => {
  const user = userEvent.setup()
  const handlers = renderToolbar()
  for (const name of ['Undo', 'Redo', 'Zoom out', 'Zoom in', OUTLINES_LABEL, 'Preview', 'Fullscreen', 'View code', TOOL_LABELS.download]) await user.click(button(name))
  expect(handlers.onUndo).toHaveBeenCalledTimes(1)
  expect(handlers.onRedo).toHaveBeenCalledTimes(1)
  expect(handlers.onZoomOut).toHaveBeenCalledTimes(1)
  expect(handlers.onZoomIn).toHaveBeenCalledTimes(1)
  expect(handlers.onOutlinesChange).toHaveBeenCalledWith(false)
  expect(handlers.onPreview).toHaveBeenCalledTimes(1)
  expect(handlers.onFullscreen).toHaveBeenCalledTimes(1)
  expect(handlers.onViewCode).toHaveBeenCalledTimes(1)
  expect(handlers.onDownload).toHaveBeenCalledTimes(1)
})

test('the zoom label reads Fit with the percentage in fit mode and the bare percentage otherwise, on one line', () => {
  renderToolbar({ zoom: 78, zoomMode: 'fit' })
  expect(button(ZOOM_MENU_LABEL).textContent).toBe('Fit · 78%')
  expect(button(ZOOM_MENU_LABEL).className).toContain('whitespace-nowrap')
  cleanup()
  renderToolbar({ zoom: 100, zoomMode: 'manual' })
  expect(button(ZOOM_MENU_LABEL).textContent).toBe('100%')
})

test('the zoom menu lists Fit to width then the steps, ticks the current one, and picks by keyboard', async () => {
  const user = userEvent.setup()
  const handlers = renderToolbar({ zoom: 75, zoomMode: 'manual' })
  await user.click(button(ZOOM_MENU_LABEL))
  const menu = screen.getByRole('region', { name: ZOOM_MENU_LABEL })
  const items = within(menu).getAllByRole('button')
  expect(items.map((item) => item.textContent)).toEqual([FIT_LABEL, '50%', '75%', '100%', '125%', '150%'])
  expect(items[2].getAttribute('aria-current')).toBe('true')
  expect(menu.className).toContain('shadow-menu')
  expect(menu.className).toContain('rounded-lg')
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(items[0])
  await user.keyboard('{Enter}')
  expect(handlers.onZoomSelect).toHaveBeenCalledWith('fit')
  expect(screen.queryByRole('region', { name: ZOOM_MENU_LABEL })).toBeNull()
})

test('Escape closes the zoom menu and puts focus back on its button', async () => {
  const user = userEvent.setup()
  renderToolbar()
  await user.click(button(ZOOM_MENU_LABEL))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('region', { name: ZOOM_MENU_LABEL })).toBeNull()
  expect(document.activeElement).toBe(button(ZOOM_MENU_LABEL))
})

test('undo and redo grey out when there is nothing to do, and never fade', () => {
  renderToolbar({ canUndo: false, canRedo: false })
  expect(disabled('Undo')).toBe(true)
  expect(disabled('Redo')).toBe(true)
  expect(button('Undo').className).toContain('bg-line-subtle')
  expect(button('Undo').className).not.toContain('opacity')
})

test('zoom out stops at the smallest step and zoom in at the largest', () => {
  renderToolbar({ zoom: 25 })
  expect(disabled('Zoom out')).toBe(true)
  cleanup()
  renderToolbar({ zoom: 200 })
  expect(disabled('Zoom in')).toBe(true)
})

test('read-only turns history off and leaves every view tool on', async () => {
  const user = userEvent.setup()
  const handlers = renderToolbar({ disabled: true })
  expect(disabled('Undo')).toBe(true)
  expect(disabled('Redo')).toBe(true)
  await user.click(button('Undo'))
  expect(handlers.onUndo).not.toHaveBeenCalled()
  for (const name of ['Zoom in', OUTLINES_LABEL, 'Preview', 'Fullscreen', 'View code', TOOL_LABELS.download]) expect(disabled(name)).toBe(false)
  await user.click(button(TOOL_LABELS.download))
  expect(handlers.onDownload).toHaveBeenCalledTimes(1)
})

test('the three devices are one segmented control with exactly one selected', async () => {
  const user = userEvent.setup()
  const handlers = renderToolbar({ device: 'Tablet' })
  const radios = within(group()).getAllByRole('radio')
  expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Desktop', 'Tablet', 'Mobile'])
  expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  await user.click(within(group()).getByRole('radio', { name: 'Mobile' }))
  expect(handlers.onDeviceChange).toHaveBeenCalledWith('Mobile portrait')
})

test('the outlines button carries its state as aria-pressed', () => {
  renderToolbar({ outlines: false })
  expect(button(OUTLINES_LABEL).getAttribute('aria-pressed')).toBe('false')
})

// --- folding, by measurement: the full group is 598px inside 12px sides, the smallest 362px inside 8px ---

test('a row wide enough shows everything and no More button', () => {
  rowWidth = TIER_WIDTHS[0] + 24
  renderToolbar()
  expect(maybe(MORE_LABEL)).toBeNull()
  expect(order().at(-1)).toBe('download')
})

test('one pixel short folds Fullscreen, View code and Download into More, and the rest stays', async () => {
  const user = userEvent.setup()
  rowWidth = TIER_WIDTHS[0] + 24 - 1
  const handlers = renderToolbar()
  expect(order()).toEqual(['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|', 'outlines', 'preview', 'more'])
  await user.click(button(MORE_LABEL))
  const menu = screen.getByRole('region', { name: MORE_LABEL })
  const items = within(menu).getAllByRole('button')
  expect(items.map((item) => item.textContent)).toEqual(['Fullscreen', 'View code', TOOL_LABELS.download])
  expect(items.every((item) => item.querySelector('svg'))).toBe(true)
  expect(menu.className).toContain('shadow-menu')
  await user.click(items[1])
  expect(handlers.onViewCode).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('region', { name: MORE_LABEL })).toBeNull()
})

test('the default 392px canvas folds the outlines and Preview as well, and the menu shows the outlines state', async () => {
  const user = userEvent.setup()
  rowWidth = 392
  const handlers = renderToolbar({ outlines: true, zoom: 53, zoomMode: 'fit' })
  expect(order()).toEqual(['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|', 'more'])
  // option 1 and option 2, and only here: the bare percentage, 4px either side of each divider, 8px row sides
  expect(button(ZOOM_MENU_LABEL).textContent).toBe('53%')
  expect(screen.getByRole('toolbar', { name: 'Canvas' }).className).toContain('px-2')
  expect([...group().querySelectorAll('[data-tool="|"]')].every((d) => d.className.includes('-mx-1'))).toBe(true)
  await user.click(button(MORE_LABEL))
  const items = within(screen.getByRole('region', { name: MORE_LABEL })).getAllByRole('button')
  expect(items.map((item) => item.textContent)).toEqual([OUTLINES_LABEL, 'Preview', 'Fullscreen', 'View code', TOOL_LABELS.download])
  expect(items[0].getAttribute('aria-pressed')).toBe('true')
  await user.click(items[0])
  expect(handlers.onOutlinesChange).toHaveBeenCalledWith(false)
})

test('the More menu is keyboard-driven and Escape returns focus to its button', async () => {
  const user = userEvent.setup()
  rowWidth = 392
  const handlers = renderToolbar()
  await user.click(button(MORE_LABEL))
  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(document.activeElement?.textContent).toBe('Preview')
  await user.keyboard('{Enter}')
  expect(handlers.onPreview).toHaveBeenCalledTimes(1)
  await user.click(button(MORE_LABEL))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('region', { name: MORE_LABEL })).toBeNull()
  expect(document.activeElement).toBe(button(MORE_LABEL))
})

test.each([[392], [368]])('a %ipx row folds as far as the tiers go and no further', (width) => {
  rowWidth = width
  renderToolbar()
  expect(order()).toEqual(['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|', 'more'])
})

test('402 is where the smallest tier fits with its 8px sides untouched', () => {
  rowWidth = 402
  renderToolbar()
  expect(TIER_WIDTHS[2]).toBeLessThanOrEqual(402 - 16)
  expect(maybe(MORE_LABEL)).toBeTruthy()
})

test('at 392 the group is within the row even at its widest label, so nothing is clipped', () => {
  rowWidth = 392
  renderToolbar({ zoom: 200, zoomMode: 'manual' })
  expect(button(ZOOM_MENU_LABEL).textContent).toBe('200%')
  expect(TIER_WIDTHS[2]).toBeLessThanOrEqual(392)
})

test('a wide row keeps the full label, 8px divider gaps and 12px sides', () => {
  rowWidth = 2000
  renderToolbar({ zoom: 53, zoomMode: 'fit' })
  expect(button(ZOOM_MENU_LABEL).textContent).toBe('Fit · 53%')
  expect(screen.getByRole('toolbar', { name: 'Canvas' }).className).toContain('px-3')
  expect([...group().querySelectorAll('[data-tool="|"]')].some((d) => d.className.includes('-mx-1'))).toBe(false)
})

test('the row being resized re-measures, so widening it unfolds the tools again', () => {
  rowWidth = 392
  renderToolbar()
  expect(maybe(MORE_LABEL)).toBeTruthy()
  rowWidth = 1000
  act(() => resize?.())
  expect(maybe(MORE_LABEL)).toBeNull()
  expect(order().at(-1)).toBe('download')
})

test('Fullscreen shows as pressed, and reads as the way out, while it is on', () => {
  renderToolbar({ fullscreen: true })
  const exit = within(group()).getByRole('button', { name: EXIT_FULLSCREEN_LABEL })
  expect(exit.getAttribute('aria-pressed')).toBe('true')
  expect(exit.className).toContain('bg-brand-100')
  cleanup()
  renderToolbar({ fullscreen: false })
  expect(button('Fullscreen').getAttribute('aria-pressed')).toBe('false')
})
