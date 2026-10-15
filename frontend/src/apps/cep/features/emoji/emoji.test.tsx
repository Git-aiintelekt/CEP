import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { createRef } from 'react'

import { HeaderField } from '@/apps/cep/features/designer/HeaderField'
import { insertIntoHeader } from '@/apps/cep/features/designer/tags/insertIntoHeader'

import { EmojiPicker } from './EmojiPicker'
import { EmojiPickerButton } from './EmojiPickerButton'
import { charCount } from './text'

afterEach(() => cleanup())

test('a character is counted once whether it takes one or two UTF-16 units', () => {
  expect(charCount('Sale 🔥')).toBe(6)
  expect('Sale 🔥'.length).toBe(7)                                                                       // what JavaScript would have said
  expect(charCount('Big Sale 🔥🎉 50% off ❤')).toBe(21)
})

test('the picker loads the catalogue on demand, searches by name and by word, and hands the chosen emoji back', async () => {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<EmojiPicker onPick={onPick} onClose={onClose} />)
  const list = await screen.findByRole('listbox', { name: 'Emoji' })
  await vi.waitFor(() => expect(within(list).getAllByRole('option').length).toBeGreaterThan(100))
  expect(within(list).getByRole('option', { name: 'fire' })).toBeTruthy()

  await user.type(screen.getByRole('searchbox', { name: 'Search Emoji' }), 'party')
  const options = within(list).getAllByRole('option').map((option) => option.getAttribute('aria-label'))
  expect(options).toContain('party popper')                                                            // by name
  expect(options).toContain('balloon')                                                                 // by search word
  expect(options.length).toBeLessThan(20)

  await user.click(within(list).getByRole('option', { name: 'party popper' }))
  expect(onPick).toHaveBeenCalledWith('🎉')
  expect(onClose).toHaveBeenCalled()
})

test('the safe set is the default; Show All opens the rest', async () => {
  const user = userEvent.setup()
  render(<EmojiPicker onPick={() => {}} onClose={() => {}} />)
  await screen.findByRole('listbox', { name: 'Emoji' })
  await user.type(screen.getByRole('searchbox', { name: 'Search Emoji' }), 'rocket')
  expect(screen.getByText('No emoji matches. Try another word.')).toBeTruthy()                          // transport is outside the safe set
  await user.click(screen.getByRole('button', { name: 'Show All' }))
  expect(await screen.findByRole('option', { name: 'rocket' })).toBeTruthy()
})

test('the button opens the picker in a popover and closes it once an emoji is picked', async () => {
  const onPick = vi.fn()
  const user = userEvent.setup()
  render(<EmojiPickerButton onPick={onPick} />)
  const button = screen.getByRole('button', { name: 'Insert Emoji' })
  expect(button.getAttribute('aria-haspopup')).toBe('dialog')
  await user.click(button)
  const panel = await screen.findByRole('region', { name: 'Insert Emoji' })
  await user.click(await within(panel).findByRole('option', { name: 'fire' }))
  expect(onPick).toHaveBeenCalledWith('🔥')
  await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Insert Emoji' })).toBeNull())
})

test('the subject field counts an emoji as one character, and an emoji goes in at the caret within the limit', () => {
  const inputRef = createRef<HTMLInputElement>()
  render(<HeaderField id="subject" label="Subject" inputRef={inputRef} value="Sale 🔥🎉" placeholder="" readOnly={false} advisory={60} max={300} note={null}
    onChange={() => {}} picker={{ tags: [], channel: 'EMAIL', recent: [], onPick: () => {} }} onPickEmoji={() => {}} />)
  expect(screen.getByText('7 / 60')).toBeTruthy()

  const inserted = insertIntoHeader('subject', 'Sale', 4, 4, ' 🔥')
  expect(inserted).toEqual({ value: 'Sale 🔥', caret: 7 })
  const full = insertIntoHeader('subject', 'x'.repeat(299), 299, 299, '🔥🔥')
  expect('refused' in full).toBe(true)
  const fits = insertIntoHeader('subject', 'x'.repeat(299), 299, 299, '🔥')
  expect('refused' in fits).toBe(false)                                                                // 300 characters, even though JavaScript counts 301
})
