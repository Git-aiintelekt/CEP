import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { ConflictStrip, ReadOnlyStrip, VersionStrip } from './NoticeStrips'
import { BACK_TO_LATEST, CONFLICT_NOTE, LOAD_LATEST, READ_ONLY_NOTE, oldVersionNote } from './versionNotes'

afterEach(cleanup)

const strip = (role: 'status' | 'alert' = 'status') => screen.getByRole(role)

test('the old-version strip says which version is on the canvas and offers the way back', async () => {
  const onBack = vi.fn()
  const user = userEvent.setup()
  render(<VersionStrip version={2} onBackToLatest={onBack} />)

  expect(strip().textContent).toContain(oldVersionNote(2))
  expect(strip().className).toContain('bg-warning-bg')
  expect(strip().className).toContain('border-warning')

  await user.click(screen.getByRole('button', { name: BACK_TO_LATEST }))
  expect(onBack).toHaveBeenCalledTimes(1)
})

test('the way back is the design\'s 28px control, and goes grey rather than faded while a load is running', async () => {
  const onBack = vi.fn()
  const user = userEvent.setup()
  render(<VersionStrip version={1} busy onBackToLatest={onBack} />)

  const button = screen.getByRole('button', { name: BACK_TO_LATEST })
  expect(button.className).toContain('h-7')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.className).toContain('bg-line-subtle')
  expect(button.className).not.toContain('opacity')

  await user.click(button)
  expect(onBack).not.toHaveBeenCalled()
})

test('the read-only strip is a callout, not a warning, and asks for nothing', () => {
  render(<ReadOnlyStrip />)
  expect(strip().textContent).toContain(READ_ONLY_NOTE)
  expect(strip().className).toContain('bg-callout-bg')
  expect(screen.queryByRole('button')).toBeNull()
})

test('the conflict strip interrupts, says what happened and offers the latest version', async () => {
  const onLoad = vi.fn()
  const user = userEvent.setup()
  render(<ConflictStrip onLoadLatest={onLoad} />)

  expect(strip('alert').textContent).toContain(CONFLICT_NOTE)
  expect(strip('alert').className).toContain('bg-danger-bg')

  await user.click(screen.getByRole('button', { name: LOAD_LATEST }))
  expect(onLoad).toHaveBeenCalledTimes(1)
})

test('the strips fade in where they appear, and never move the canvas twice', () => {
  render(<ReadOnlyStrip />)
  expect(strip().className).toContain('animate-popover-in')
  expect(strip().className).not.toContain('slide')
})
