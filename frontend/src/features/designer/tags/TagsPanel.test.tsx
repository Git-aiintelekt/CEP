import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { TagsPanel, type TagsPanelHandle } from './TagsPanel'
import { EMPTY_CATALOGUE_NOTE, NO_DEFAULT_NOTE, NO_MATCH_NOTE, RECENT_LABEL, SEARCH_LABEL, defaultNote } from './pickerNotes'

const tag = (tag_key: string, label: string, over: Partial<PersonalizationTag> = {}): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'],
  description: null, sample_value: null, default_value: null, static_value: null, is_active: true, ...over,
})
const catalogue = [
  tag('first_name', 'First name', { sample_value: 'Jordan', default_value: 'there' }),
  tag('loyalty_tier', 'Loyalty tier', { sample_value: 'Gold' }),
  tag('offer_code', 'Offer code', { tag_kind: 'CUSTOM' }),
]

const writeText = vi.fn()
/** user-event's setup() puts its own clipboard on navigator, so the spy goes on after it */
function setupUser() {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return user
}
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(cleanup)

function renderPanel(over: Partial<React.ComponentProps<typeof TagsPanel>> = {}) {
  const onPick = over.onPick ?? vi.fn(() => false)
  const onEngage = vi.fn()
  const onCopied = vi.fn()
  const onCopyFailed = vi.fn()
  const ref = createRef<TagsPanelHandle>()
  render(<TagsPanel ref={ref} tags={catalogue} channel="EMAIL" recent={[]} onEngage={onEngage} onCopied={onCopied} onCopyFailed={onCopyFailed} {...over} onPick={onPick} />)
  return { onPick, onEngage, onCopied, onCopyFailed, ref }
}

const row = (name: RegExp) => screen.getByRole('button', { name })
const status = () => screen.getByRole('status').textContent
const flush = () => act(() => Promise.resolve())

test('the list is the picker, inline: search at the top, headings, and rows of name and token', () => {
  renderPanel({ recent: ['offer_code'] })
  // the design's pop-up search: a 32px grey field around a bare input
  expect((screen.getByRole('searchbox', { name: SEARCH_LABEL }).parentElement as HTMLElement).className).toContain('h-8')
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([RECENT_LABEL, 'Customer', 'Campaign list'])

  // the sample and the default moved into the row's title, so the row itself is just the name and its token
  expect(row(/First name/).textContent).toBe('First name{{first_name}}')
  expect(row(/First name/).getAttribute('title')).toContain(defaultNote('there'))
  expect(row(/Loyalty tier/).getAttribute('title')).toContain(NO_DEFAULT_NOTE)
  expect(within(screen.getByRole('region', { name: RECENT_LABEL })).getByRole('button', { name: /Offer code/ })).toBeTruthy()
})

test('the panel fills its tab rather than capping itself, and never grabs focus on mount', () => {
  renderPanel()
  const list = screen.getByRole('searchbox').closest('.h-full')
  expect(list).toBeTruthy()
  expect(document.activeElement).toBe(document.body)
})

test('search filters and says when nothing matches; an empty catalogue says so', async () => {
  const user = setupUser()
  renderPanel()
  await user.type(screen.getByRole('searchbox'), 'loyal')
  expect(screen.getAllByRole('button', { name: /Loyalty|Offer|First|Last/ })).toHaveLength(1)
  await user.clear(screen.getByRole('searchbox'))
  await user.type(screen.getByRole('searchbox'), 'zzz')
  expect(screen.getByText(NO_MATCH_NOTE)).toBeTruthy()

  cleanup()
  renderPanel({ tags: [] })
  expect(screen.getByText(EMPTY_CATALOGUE_NOTE)).toBeTruthy()
})

test('a row goes into the canvas when the caller says it did: nothing copied, no toast, nothing said', async () => {
  const user = setupUser()
  const { onPick, onCopied } = renderPanel({ onPick: vi.fn(() => true) })
  await user.click(row(/First name/))
  await flush()
  expect(onPick).toHaveBeenCalledWith('first_name')
  expect(writeText).not.toHaveBeenCalled()
  expect(onCopied).not.toHaveBeenCalled()
  expect(status()).toBe('')
})

test('with nothing being edited a row copies the token and reports it for a toast, not the status line', async () => {
  const user = setupUser()
  const { onCopied } = renderPanel()
  await user.click(row(/First name/))
  await flush()
  expect(writeText).toHaveBeenCalledWith('{{first_name}}')
  expect(onCopied).toHaveBeenCalledWith('{{first_name}}')
  expect(status()).toBe('')
})

test('the status line still carries whatever else the panel is given to say', () => {
  renderPanel({ message: 'Something else' })
  expect(status()).toBe('Something else')
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
})

test('Enter on a focused row does the same as a click', async () => {
  const user = setupUser()
  const { onPick, onCopied } = renderPanel()
  row(/Offer code/).focus()
  await user.keyboard('{Enter}')
  await flush()
  expect(onPick).toHaveBeenCalledWith('offer_code')
  expect(onCopied).toHaveBeenCalledWith('{{offer_code}}')
})

test('a blocked clipboard is reported with its reason, for an error toast', async () => {
  const user = setupUser()
  writeText.mockRejectedValue(new Error('denied'))
  const { onCopied, onCopyFailed } = renderPanel()
  await user.click(row(/First name/))
  await flush()
  expect(onCopied).not.toHaveBeenCalled()
  expect(onCopyFailed).toHaveBeenCalledWith('{{first_name}}', 'denied')
})

test('read-only rows are grey and inert, never faded, while the search still filters', async () => {
  const user = setupUser()
  const { onPick } = renderPanel({ disabled: true })
  const first = row(/First name/)
  expect(first.getAttribute('aria-disabled')).toBe('true')
  expect(first.className).toContain('bg-line-subtle')
  expect(first.className).not.toContain('opacity')
  await user.click(first)
  await flush()
  expect(onPick).not.toHaveBeenCalled()
  expect(writeText).not.toHaveBeenCalled()

  await user.type(screen.getByRole('searchbox'), 'offer')
  expect(screen.getAllByRole('button', { name: /Loyalty|Offer|First|Last/ })).toHaveLength(1)
})

test('a press on a row never reaches the page beneath, and notes the caret first', () => {
  const heard = vi.fn()
  document.addEventListener('mousedown', heard)
  const { onEngage } = renderPanel()
  const event = fireEvent.mouseDown(row(/First name/))
  expect(event).toBe(false) // default prevented: focus stays where the caret is
  expect(heard).not.toHaveBeenCalled()
  expect(onEngage).toHaveBeenCalledTimes(1)
  document.removeEventListener('mousedown', heard)
})

test('a press on the search box keeps its default, so a click can place its caret, but still goes no further', () => {
  const heard = vi.fn()
  document.addEventListener('mousedown', heard)
  renderPanel()
  const event = fireEvent.mouseDown(screen.getByRole('searchbox'))
  expect(event).toBe(true)
  expect(heard).not.toHaveBeenCalled()
  document.removeEventListener('mousedown', heard)
})

test('the handle focuses the search box, for the header button', () => {
  const { ref } = renderPanel()
  act(() => ref.current?.focusSearch())
  expect(document.activeElement).toBe(screen.getByRole('searchbox'))
})
