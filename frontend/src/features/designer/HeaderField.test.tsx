import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { HeaderField } from './HeaderField'

afterEach(cleanup)

const picker = { tags: [], channel: 'EMAIL', recent: [], onPick: vi.fn() }

function field(value: string, over: { readOnly?: boolean; note?: string | null } = {}) {
  render(
    <HeaderField
      id="subject"
      label="Subject"
      inputRef={createRef<HTMLInputElement>()}
      value={value}
      placeholder="Your offer is here"
      readOnly={over.readOnly ?? false}
      advisory={60}
      max={300}
      note={over.note ?? null}
      onChange={vi.fn()}
      picker={picker}
    />,
  )
  return screen.getByLabelText('Subject') as HTMLInputElement
}

const shell = (input: HTMLInputElement) => input.parentElement as HTMLElement
const counter = () => screen.getByText(/\d+ \//)

test('the counter reads against the advisory limit and stays quiet in its own colour', () => {
  field('Spring loyalty refresh')
  expect(counter().textContent).toBe('22 / 60')
  expect(counter().className).toContain('text-ink-800')
  expect(counter().className).toContain('cep-num')
})

test('past the advisory limit the counter names the hard limit and the field turns warning', () => {
  const input = field('x'.repeat(61))
  expect(counter().textContent).toBe('61 / 60 · max 300')
  expect(counter().className).toContain('text-warning-text')
  expect(shell(input).className).toContain('border-warning')
  expect(screen.getByText('Over 60 characters may be cut off in some inboxes.')).toBeTruthy()
})

test('past the hard limit the field turns error and the counter with it', () => {
  const input = field('x'.repeat(301))
  expect(counter().className).toContain('text-danger-plain')
  expect(shell(input).className).toContain('border-danger')
  expect(shell(input).className).not.toContain('border-warning')
})

test('a refused tag outranks the length advice and is said in the error colour', () => {
  field('x'.repeat(61), { note: 'There is no room for that tag.' })
  const message = screen.getByText('There is no room for that tag.')
  expect(message.className).toContain('text-danger-text')
  expect(screen.queryByText(/may be cut off/)).toBeNull()
})

test('the field is filled and transparent-bordered at rest, and shows focus on the whole control', () => {
  const input = field('')
  expect(shell(input).className).toContain('bg-fill-subtle')
  expect(shell(input).className).toContain('border-transparent')
  expect(shell(input).className).toContain('focus-within:border-brand-600')
  expect(shell(input).className).toContain('focus-within:shadow-focus')
  expect(input.className).toContain('cep-input-bare')
})

test('the tag button sits inside the field and comes with the caret', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()
  const input = field('Spring loyalty refresh')
  expect(screen.queryByRole('button', { name: 'Insert Tag' })).toBeNull()

  await user.click(input)
  const button = screen.getByRole('button', { name: 'Insert Tag' })
  expect(shell(input).contains(button)).toBe(true)
  expect(button.className).toContain('h-[26px]')
  expect(button.className).toContain('w-[26px]')
  expect(button.className).not.toContain('border')
})

test('a read-only field never offers the tag button', () => {
  const input = field('Locked', { readOnly: true })
  input.focus()
  expect(screen.queryByRole('button', { name: 'Insert Tag' })).toBeNull()
})

test('read-only is a grey fill and quieter text, never a faded one', () => {
  const input = field('Locked', { readOnly: true })
  expect(input.disabled).toBe(true)
  expect(shell(input).className).toContain('bg-fill-subtle')
  expect(input.className).toContain('text-ink-800')
  expect(shell(input).className).not.toContain('opacity')
})
