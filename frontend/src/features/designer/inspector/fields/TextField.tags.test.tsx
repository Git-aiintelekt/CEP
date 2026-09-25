import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { LinkField } from './LinkField'
import { TextField } from './TextField'
import { LINK_ERROR } from './link'

afterEach(cleanup)

const tag = (tag_key: string, label: string): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'],
  description: null, sample_value: null, default_value: null, static_value: null, is_active: true,
})
const tags = [tag('first_name', 'First name'), tag('shop_url', 'Shop URL')]
const slot = (onPick = vi.fn()) => ({ tags, channel: 'EMAIL', recent: [], onPick })

const input = () => screen.getByRole('textbox', { name: 'Label' }) as HTMLInputElement
const picker = () => screen.getByRole('button', { name: 'Insert Tag' })

/** the field puts focus back in the input a tick later, so the caret can be checked */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(picker())
  await user.click(screen.getByRole('button', { name }))
  await settle()
}

test('the button sits inside the row and opens the picker', async () => {
  const user = userEvent.setup()
  render(<TextField label="Label" value="Shop now" onCommit={vi.fn()} tagPicker={slot()} />)
  expect(picker().className).toContain('h-8 w-8')
  await user.click(picker())
  expect(screen.getByRole('region', { name: 'Insert Tag' })).toBeTruthy()
})

test.each([
  ['at the start', 0, 0, '{{first_name}}Shop now'],
  ['in the middle', 4, 4, 'Shop{{first_name}} now'],
  ['at the end', 8, 8, 'Shop now{{first_name}}'],
  ['over a selection', 0, 4, '{{first_name}} now'],
])('the tag lands %s and commits like typing', async (_where, start, end, expected) => {
  const user = userEvent.setup()
  const onCommit = vi.fn()
  const onPick = vi.fn()
  render(<TextField label="Label" value="Shop now" onCommit={onCommit} tagPicker={slot(onPick)} />)
  input().setSelectionRange(start, end)

  await pick(user, /First name/)
  expect(onCommit).toHaveBeenLastCalledWith(expected)
  expect(input().value).toBe(expected)
  expect(onPick).toHaveBeenCalledWith('first_name')
  // the caret is just after the tag, and the input has focus again
  expect(document.activeElement).toBe(input())
  expect(input().selectionStart).toBe(start + '{{first_name}}'.length)
})

test('a link takes a tag and still refuses a bad address around it', async () => {
  const user = userEvent.setup()
  const onCommit = vi.fn()
  render(<LinkField label="Label" value="" onCommit={onCommit} tagPicker={slot()} />)
  await pick(user, /Shop URL/)
  expect(onCommit).toHaveBeenLastCalledWith('{{shop_url}}')

  onCommit.mockClear()
  await user.clear(input())
  await user.type(input(), 'htt ps://x')
  input().setSelectionRange(10, 10)
  await pick(user, /Shop URL/)
  expect(onCommit).not.toHaveBeenCalled()
  expect(screen.getByText(LINK_ERROR)).toBeTruthy()
})

test('read-only shows the button greyed and it opens nothing', async () => {
  const user = userEvent.setup()
  render(<TextField label="Label" value="Shop now" onCommit={vi.fn()} disabled tagPicker={slot()} />)
  expect(picker().getAttribute('aria-disabled')).toBe('true')
  expect(picker().className).toContain('bg-line-subtle')
  expect(picker().className).not.toContain('opacity')
  await user.click(picker())
  expect(screen.queryByRole('region', { name: 'Insert Tag' })).toBeNull()
})

test('without the slot there is no button', () => {
  render(<TextField label="Label" value="Shop now" onCommit={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Insert Tag' })).toBeNull()
})
