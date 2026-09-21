import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import type { DesignVersion } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { CURRENT_LABEL, HISTORY_EMPTY, HISTORY_FAILED, HISTORY_HEADING, HISTORY_LABEL, HistoryMenu, LOAD_LABEL } from './HistoryMenu'
import { ErrorsPill, type PillKey } from './IssuePills'

afterEach(cleanup)

const versions: DesignVersion[] = [
  { version_number: 1, saved_at: '2026-09-20T09:00:00Z', saved_by: 'Sarah' },
  { version_number: 3, saved_at: '2026-09-21T10:30:00Z', saved_by: 'Jordan' },
  { version_number: 2, saved_at: '2026-09-20T15:00:00Z', saved_by: null },
]

/** the menu with a real controller, sharing it with the Errors pill the way the tab bar does */
function Harness(props: Partial<React.ComponentProps<typeof HistoryMenu>> & { withPill?: boolean }) {
  const controller = useSingleDropdown<PillKey>()
  const { withPill, ...over } = props
  return (
    <>
      <HistoryMenu versions={versions} shown={3} latest={3} controller={controller} onLoad={vi.fn()} {...over} />
      {withPill ? <ErrorsPill issues={[]} controller={controller} onJump={vi.fn()} /> : null}
    </>
  )
}

const trigger = () => screen.getByRole('button', { name: HISTORY_LABEL })
const menu = () => screen.getByRole('region', { name: HISTORY_HEADING })
const rows = () => within(menu()).getAllByRole('button')

test('the button opens a list of versions, newest first, under the design heading', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(trigger())
  expect(within(menu()).getByText(HISTORY_HEADING)).toBeTruthy()
  expect(menu().textContent).toMatch(/Version 3.*Version 2.*Version 1/s)
})

test('the version on the canvas is marked current and cannot be loaded; the others can', async () => {
  const user = userEvent.setup()
  const onLoad = vi.fn()
  render(<Harness onLoad={onLoad} />)
  await user.click(trigger())
  const [current, older, oldest] = rows()
  expect(current.textContent).toBe(CURRENT_LABEL)
  expect(current.getAttribute('aria-disabled')).toBe('true')
  expect(menu().textContent).toContain('Version 3 · current')
  expect(older.textContent).toBe(LOAD_LABEL)
  await user.click(current)
  expect(onLoad).not.toHaveBeenCalled()
  await user.click(oldest)
  expect(onLoad).toHaveBeenCalledWith(1)
})

test('while an older version is on the canvas, that row is the one that cannot be loaded, and the newest is not called current', async () => {
  const user = userEvent.setup()
  const onLoad = vi.fn()
  render(<Harness shown={1} latest={3} onLoad={onLoad} />)
  await user.click(trigger())
  const [newest, , shown] = rows()
  expect(menu().textContent).not.toContain('· current')
  expect(newest.textContent).toBe(LOAD_LABEL)
  expect(newest.getAttribute('aria-disabled')).toBeNull()
  expect(shown.getAttribute('aria-disabled')).toBe('true')
  await user.click(newest)
  expect(onLoad).toHaveBeenCalledWith(3)
})

test('each row carries the saved time and the saver', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(trigger())
  expect(menu().textContent).toContain('Jordan')
  expect(menu().textContent).toContain('Sarah')
})

test('opening asks for the list, and shows it loading, failed or empty', async () => {
  const user = userEvent.setup()
  const onOpen = vi.fn()
  const { rerender } = render(<Harness versions={null} onOpen={onOpen} />)
  await user.click(trigger())
  expect(onOpen).toHaveBeenCalledTimes(1)
  expect(within(menu()).getByText('Loading')).toBeTruthy()

  rerender(<Harness versions={null} failed onOpen={onOpen} />)
  expect(within(menu()).getByText(HISTORY_FAILED)).toBeTruthy()

  rerender(<Harness versions={[]} onOpen={onOpen} />)
  expect(within(menu()).getByText(HISTORY_EMPTY)).toBeTruthy()
})

test('while a load is in flight every Load is greyed, never faded', async () => {
  const user = userEvent.setup()
  render(<Harness busy />)
  await user.click(trigger())
  for (const row of rows()) {
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.className).toContain('bg-line-subtle')
    expect(row.className).not.toContain('opacity')
  }
})

test('keyboard: Enter opens, arrows walk the Load buttons, Enter loads, Escape closes and returns focus', async () => {
  const user = userEvent.setup()
  const onLoad = vi.fn()
  render(<Harness onLoad={onLoad} />)
  trigger().focus()
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('region', { name: HISTORY_HEADING })).toBeTruthy()
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(rows()[1]) // the current row's button is disabled, so the first reachable Load
  await user.keyboard('{Enter}')
  expect(onLoad).toHaveBeenCalledWith(2)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('region', { name: HISTORY_HEADING })).toBeNull()
  expect(document.activeElement).toBe(trigger())
})

test('only one of History and the pills is open at a time', async () => {
  const user = userEvent.setup()
  render(<Harness withPill />)
  await user.click(trigger())
  expect(screen.queryByRole('region', { name: HISTORY_HEADING })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /No errors/ }))
  expect(screen.queryByRole('region', { name: HISTORY_HEADING })).toBeNull()
  expect(screen.getByRole('region', { name: 'Errors' })).toBeTruthy()
})
