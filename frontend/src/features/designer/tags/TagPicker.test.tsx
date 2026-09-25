import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { TagPicker } from './TagPicker'
import { EMPTY_CATALOGUE_NOTE, NO_DEFAULT_NOTE, NO_MATCH_NOTE, RECENT_LABEL, SEARCH_LABEL, defaultNote } from './pickerNotes'

afterEach(cleanup)

const tag = (tag_key: string, label: string, over: Partial<PersonalizationTag> = {}): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'],
  description: null, sample_value: null, default_value: null, static_value: null, is_active: true, ...over,
})

const catalogue = [
  tag('first_name', 'First name', { sample_value: 'Jordan', default_value: 'there', description: 'Given name from the contact record' }),
  tag('loyalty_tier', 'Loyalty tier', { sample_value: 'Gold' }),
  tag('offer_code', 'Offer code', { tag_kind: 'CUSTOM', sample_value: 'FALL017' }),
  tag('shop_url', 'Shop URL', { tag_kind: 'SYSTEM' }),
  tag('sms_only', 'SMS only', { applies_to_channels: ['SMS'] }),
  tag('retired', 'Retired', { is_active: false }),
]

function renderPicker(over: Partial<React.ComponentProps<typeof TagPicker>> = {}) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<TagPicker tags={catalogue} channel="EMAIL" recent={[]} onPick={onPick} onClose={onClose} {...over} />)
  return { onPick, onClose }
}

const labelOf = (row: HTMLElement) => row.querySelector('span > span')?.textContent ?? ''
const rowNames = () => screen.getAllByRole('button').map(labelOf)
const headings = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

test('tags are grouped by kind under the catalogue headings, sorted by label', () => {
  renderPicker()
  expect(headings()).toEqual(['Customer', 'Campaign List', 'System'])
  expect(rowNames()).toEqual(['First name', 'Loyalty tier', 'Offer code', 'Shop URL'])
})

test('inactive tags and tags for another channel are never offered', () => {
  renderPicker()
  expect(screen.queryByText('Retired')).toBeNull()
  expect(screen.queryByText('SMS only')).toBeNull()

  cleanup()
  renderPicker({ channel: 'SMS' })
  expect(rowNames()).toEqual(['SMS only'])
})

test('recent tags come first, at most five, and only ones still in the catalogue', () => {
  renderPicker({ recent: ['offer_code', 'first_name', 'gone_key'] })
  expect(headings()[0]).toBe(RECENT_LABEL)
  const recent = within(screen.getByRole('region', { name: RECENT_LABEL }))
  expect(recent.getAllByRole('button').map(labelOf)).toEqual(['Offer code', 'First name'])
})

test('no recent section when nothing has been used yet', () => {
  renderPicker()
  expect(screen.queryByText(RECENT_LABEL)).toBeNull()
})

test('each row shows the token, the sample value and what happens when the value is empty', () => {
  renderPicker()
  const first = screen.getByRole('button', { name: /First name/ })
  expect(first.textContent).toContain('{{first_name}}')
  expect(first.textContent).toContain('Jordan')
  expect(first.textContent).toContain(defaultNote('there'))
  expect(first.getAttribute('title')).toBe('First name — Given name from the contact record')

  const tier = screen.getByRole('button', { name: /Loyalty tier/ })
  expect(tier.textContent).toContain(NO_DEFAULT_NOTE)
  expect(tier.className).toContain('h-12')
})

test('search matches the label, the key and the description, whatever the case', async () => {
  const user = userEvent.setup()
  renderPicker()
  const search = screen.getByRole('searchbox', { name: SEARCH_LABEL })
  expect(search.className).toContain('h-8!')

  await user.type(search, 'LOYAL')
  expect(rowNames()).toEqual(['Loyalty tier'])

  await user.clear(search)
  await user.type(search, 'offer_c')
  expect(rowNames()).toEqual(['Offer code'])

  await user.clear(search)
  await user.type(search, 'contact record')
  expect(rowNames()).toEqual(['First name'])

  await user.clear(search)
  await user.type(search, 'zzz')
  expect(screen.getByText(NO_MATCH_NOTE)).toBeTruthy()
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})

test('an empty catalogue says so and offers no search box', () => {
  renderPicker({ tags: [] })
  expect(screen.getByText(EMPTY_CATALOGUE_NOTE)).toBeTruthy()
  expect(screen.queryByRole('searchbox')).toBeNull()
})

test('choosing a row hands back its key', async () => {
  const user = userEvent.setup()
  const { onPick } = renderPicker()
  await user.click(screen.getByRole('button', { name: /Offer code/ }))
  expect(onPick).toHaveBeenCalledWith('offer_code')
})

test('arrows walk the rows from the search box, Enter picks, Escape closes', async () => {
  const user = userEvent.setup()
  const { onPick, onClose } = renderPicker({ recent: ['shop_url'] })
  screen.getByRole('searchbox').focus()

  await user.keyboard('{ArrowDown}')
  expect(document.activeElement?.textContent).toContain('Shop URL') // recent first
  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(document.activeElement?.textContent).toContain('Loyalty tier')
  await user.keyboard('{ArrowUp}')
  expect(document.activeElement?.textContent).toContain('First name')
  await user.keyboard('{End}')
  expect(document.activeElement?.textContent).toContain('Shop URL') // the last row is the System one
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement?.textContent).toContain('Shop URL') // wraps to the recent copy at the top

  await user.keyboard('{Enter}')
  expect(onPick).toHaveBeenCalledWith('shop_url')

  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('the search box can be left out', () => {
  renderPicker({ showSearch: false })
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(rowNames()).toHaveLength(4)
})

test('the panel layout fills its host and does not grab focus; the popover caps itself and does', () => {
  renderPicker({ layout: 'panel', focusSearchOnMount: false })
  expect(screen.getByRole('searchbox').closest('.h-full')).toBeTruthy()
  expect(document.activeElement).toBe(document.body)

  cleanup()
  renderPicker()
  expect(screen.getByRole('searchbox').closest('.max-h-\\[360px\\]')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('searchbox'))
})
