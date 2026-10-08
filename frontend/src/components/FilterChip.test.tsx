import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { ClearFiltersLink, FilterChip, MultiSelectMenu, SingleSelectMenu } from './FilterChip'

afterEach(cleanup)

const CHANNELS = [{ value: 'ALL', label: 'All Channels' }, { value: 'SMS', label: 'SMS' }]

function Channel() {
  const [value, setValue] = useState('ALL')
  return (
    <>
      <FilterChip label={CHANNELS.find((option) => option.value === value)!.label} active={value !== 'ALL'} menuLabel="Channel">
        {({ close }) => <SingleSelectMenu label="Channel" options={CHANNELS} value={value} onChange={(next) => { setValue(next); close() }} />}
      </FilterChip>
      <button type="button">Elsewhere</button>
    </>
  )
}

test('a chip is 40px with a chevron; its active look is Blue 600 / Blue 100 / Blue 800', async () => {
  const user = userEvent.setup()
  render(<Channel />)
  const chip = screen.getByRole('button', { name: 'All Channels' })
  expect(chip.className).toContain('h-10')
  expect(chip.className).toContain('rounded-control-lg')
  expect(chip.className).toContain('border-line bg-surface text-ink-900 hover:bg-surface-hover')
  expect(chip.getAttribute('aria-haspopup')).toBe('listbox')
  expect(chip.querySelector('.lucide-chevron-down')).toBeTruthy()

  await user.click(chip)
  const listbox = screen.getByRole('listbox', { name: 'Channel' })
  const options = within(listbox).getAllByRole('option')
  expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  expect(options[0].className).toContain('bg-brand-100')
  expect(options[0].className).toContain('text-brand-800')
  await user.click(options[1])
  expect(screen.queryByRole('listbox')).toBeNull()                          // a single choice closes the menu
  const active = screen.getByRole('button', { name: 'SMS' })
  expect(active.className).toContain('border-link bg-brand-100 text-brand-800')
  expect(document.activeElement).toBe(active)                                // focus goes back to the chip
})

test('Escape and a click outside close the menu', async () => {
  const user = userEvent.setup()
  render(<Channel />)
  const chip = screen.getByRole('button', { name: 'All Channels' })
  await user.click(chip)
  expect(chip.getAttribute('aria-expanded')).toBe('true')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(document.activeElement).toBe(chip)
  await user.click(chip)
  await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
  expect(screen.queryByRole('listbox')).toBeNull()
})

test('the multi-select is a draft until Apply; Clear empties it; the search narrows the list', async () => {
  const user = userEvent.setup()
  const onApply = vi.fn()
  const options = [{ value: 'a', label: 'Fall Launch' }, { value: 'b', label: 'Flash Sale' }, { value: 'c', label: 'Win-Back' }]
  render(<MultiSelectMenu label="Campaigns" searchLabel="Search Campaigns" options={options} value={['a']} onApply={onApply} />)
  const listbox = screen.getByRole('listbox', { name: 'Campaigns' })
  expect(listbox.getAttribute('aria-multiselectable')).toBe('true')
  expect(screen.getByRole('textbox', { name: 'Search Campaigns' }).parentElement!.className).toContain('bg-surface-sunken')
  const option = (name: string) => within(listbox).getByRole('option', { name })
  expect(option('Fall Launch').getAttribute('aria-selected')).toBe('true')
  expect(option('Fall Launch').querySelector('input[type="checkbox"]')).toBeTruthy()

  await user.click(option('Win-Back'))
  expect(option('Win-Back').getAttribute('aria-selected')).toBe('true')
  expect(onApply).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onApply).toHaveBeenLastCalledWith(['a', 'c'])

  await user.click(screen.getByRole('button', { name: 'Clear' }))
  expect(within(listbox).getAllByRole('option').every((item) => item.getAttribute('aria-selected') === 'false')).toBe(true)
  expect(onApply).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(onApply).toHaveBeenLastCalledWith([])
  expect(screen.getByRole('button', { name: 'Apply' }).className).toContain('bg-brand-600')

  await user.type(screen.getByRole('textbox', { name: 'Search Campaigns' }), 'fla')
  expect(within(listbox).getAllByRole('option').map((item) => item.textContent)).toEqual(['Flash Sale'])
})

test('Clear Filters is a link-style button', async () => {
  const onClick = vi.fn()
  render(<ClearFiltersLink onClick={onClick} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Clear Filters' }))
  expect(onClick).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Clear Filters' }).className).toContain('text-brand-800')
})
