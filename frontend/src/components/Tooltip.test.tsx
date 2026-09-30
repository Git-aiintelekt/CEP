import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { Tooltip, TruncatedText } from './Tooltip'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('hover shows the tooltip after 300ms; leaving hides it', () => {
  render(<Tooltip content="Edit Details"><button type="button">Pencil</button></Tooltip>)
  const button = screen.getByRole('button', { name: 'Pencil' })
  fireEvent.mouseEnter(button.parentElement!)
  act(() => vi.advanceTimersByTime(299))
  expect(screen.queryByRole('tooltip')).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  const tip = screen.getByRole('tooltip')
  expect(tip.textContent).toBe('Edit Details')
  expect(tip.className).toContain('rounded-sm')
  expect(tip.className).toContain('text-xs')
  expect(tip.className).toContain('shadow-toast')
  expect(tip.className).toContain('max-w-[280px]')
  expect(button.getAttribute('aria-describedby')).toBe(tip.id)
  fireEvent.mouseLeave(button.parentElement!)
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(button.getAttribute('aria-describedby')).toBeNull()
})

test('keyboard focus shows it at once; Escape and blur hide it', () => {
  render(<Tooltip content="Edit Details"><button type="button">Pencil</button></Tooltip>)
  const button = screen.getByRole('button', { name: 'Pencil' })
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.focus(button)
  fireEvent.blur(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

const sizes = (scrollWidth: number, clientWidth: number) => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
}

test('TruncatedText shows the full text only when it is cut', () => {
  sizes(300, 120)
  const { unmount } = render(<TruncatedText text="VIP Early Access: Autumn Collection" focusable />)
  const text = screen.getByText('VIP Early Access: Autumn Collection')
  expect(text.className).toContain('truncate')
  expect(text.getAttribute('tabindex')).toBe('0')
  fireEvent.mouseEnter(text.parentElement!)
  act(() => vi.advanceTimersByTime(300))
  expect(screen.getByRole('tooltip').textContent).toBe('VIP Early Access: Autumn Collection')
  unmount()

  vi.restoreAllMocks()
  sizes(100, 120)
  render(<TruncatedText text="Short" focusable />)
  const short = screen.getByText('Short')
  expect(short.getAttribute('tabindex')).toBeNull()
  fireEvent.mouseEnter(short.parentElement!)
  act(() => vi.advanceTimersByTime(300))
  expect(screen.queryByRole('tooltip')).toBeNull()
})
