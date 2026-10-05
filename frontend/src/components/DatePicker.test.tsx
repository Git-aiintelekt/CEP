/** DatePicker: the field's text, the month calendar (today, past days, the chosen day), month navigation and the
 * keyboard (arrows, Page Down, Enter, Escape). */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { formatDateValue } from '@/lib/dateValue'

import { DatePicker } from './DatePicker'

afterEach(() => cleanup())

const TODAY = new Date(2026, 9, 5) // Monday, October 5, 2026

function Harness({ initial = '', onChange = () => {} }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <DatePicker
      label="Activation Date"
      value={value}
      today={TODAY}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

test('formats values as "MMM D, YYYY"', () => {
  expect(formatDateValue('2026-12-25')).toBe('Dec 25, 2026')
  expect(formatDateValue('')).toBe('')
})

test('shows the placeholder, then opens a month calendar with today marked and past days disabled', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  const field = screen.getByRole('button', { name: 'Activation Date, not set' })
  expect(field.textContent).toContain('Select Date')
  expect(field.getAttribute('aria-expanded')).toBe('false')

  await user.click(field)
  expect(field.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('dialog', { name: 'October 2026' })).toBeTruthy()
  expect(screen.getAllByRole('columnheader')).toHaveLength(7)

  const today = screen.getByRole('button', { name: 'Monday, October 5, 2026' })
  expect(today.getAttribute('aria-current')).toBe('date')
  expect(document.activeElement).toBe(today)
  expect((screen.getByRole('button', { name: 'Sunday, October 4, 2026' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Previous Month' }) as HTMLButtonElement).disabled).toBe(true)
})

test('clicking a day chooses it, closes the calendar and shows the date in the field', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness onChange={onChange} />)

  await user.click(screen.getByRole('button', { name: /^Activation Date/ }))
  await user.click(screen.getByRole('button', { name: 'Next Month' }))
  expect(screen.getByRole('dialog', { name: 'November 2026' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Wednesday, November 18, 2026' }))

  expect(onChange).toHaveBeenCalledWith('2026-11-18')
  expect(screen.queryByRole('dialog')).toBeNull()
  const field = screen.getByRole('button', { name: 'Activation Date, Nov 18, 2026' })
  expect(field.textContent).toContain('Nov 18, 2026')
  expect(document.activeElement).toBe(field)
})

test('the chosen day is selected when the calendar opens again', async () => {
  const user = userEvent.setup()
  render(<Harness initial="2026-12-25" />)

  await user.click(screen.getByRole('button', { name: /^Activation Date/ }))
  expect(screen.getByRole('dialog', { name: 'December 2026' })).toBeTruthy()
  const chosen = screen.getByRole('button', { name: 'Friday, December 25, 2026' })
  expect(chosen.closest('[role="gridcell"]')?.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(chosen)
})

test('arrow keys and Page Down move through days and months, Enter chooses', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness onChange={onChange} />)

  await user.click(screen.getByRole('button', { name: /^Activation Date/ }))
  await user.keyboard('{ArrowRight}{ArrowDown}')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Tuesday, October 13, 2026')
  await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
  // can't go before today
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Monday, October 5, 2026')
  await user.keyboard('{PageDown}')
  expect(screen.getByRole('dialog', { name: 'November 2026' })).toBeTruthy()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Thursday, November 5, 2026')
  await user.keyboard('{Enter}')

  expect(onChange).toHaveBeenCalledWith('2026-11-05')
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('Escape closes the calendar without choosing and returns focus to the field', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness onChange={onChange} />)

  const field = screen.getByRole('button', { name: /^Activation Date/ })
  await user.click(field)
  await user.keyboard('{ArrowRight}{Escape}')

  expect(screen.queryByRole('dialog')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(field)
})
