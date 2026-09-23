import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { History, Type } from 'lucide-react'
import { afterEach, expect, test, vi } from 'vitest'

import { FieldRow } from './FieldRow'
import { PillTrigger } from './PillTrigger'
import { SectionHeader } from './SectionHeader'
import { Stepper } from './Stepper'
import { Swatch } from './Swatch'
import { Tile } from './Tile'
import { TreeRow } from './TreeRow'

afterEach(cleanup)

test('a pill trigger passes dropdown wiring straight through', () => {
  render(
    <PillTrigger icon={History} open aria-expanded aria-controls="history-panel">
      History
    </PillTrigger>,
  )
  const trigger = screen.getByRole('button', { name: 'History' })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(trigger.getAttribute('aria-controls')).toBe('history-panel')
})

test('a field row describes its control with the error before the note, and hides Reset when disabled', () => {
  const { rerender } = render(
    <FieldRow label="Link" note="From email defaults" error="Enter a full web address" onReset={() => {}}>
      {({ id, describedBy, invalid }) => <input id={id} aria-describedby={describedBy} aria-invalid={invalid} />}
    </FieldRow>,
  )
  const input = screen.getByLabelText('Link')
  expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a full web address')
  expect(screen.queryByText('From email defaults')).toBeNull()
  expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()

  rerender(
    <FieldRow label="Link" onReset={() => {}} disabled>
      {({ id }) => <input id={id} />}
    </FieldRow>,
  )
  expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
})

test('a stepper is one tab stop; its buttons step by pointer', () => {
  const onIncrement = vi.fn()
  render(<Stepper aria-label="Font size" value="16" onChange={() => {}} onDecrement={() => {}} onIncrement={onIncrement} unit="px" canDecrement={false} />)
  const increase = screen.getByRole('button', { name: 'Increase' })
  expect(increase.getAttribute('tabindex')).toBe('-1')
  fireEvent.click(increase)
  expect(onIncrement).toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Decrease' }) as HTMLButtonElement).disabled).toBe(true)
})

test('an empty swatch still has a name', () => {
  render(<Swatch label="No colour" aria-pressed={false} />)
  expect(screen.getByRole('button', { name: 'No colour' })).toBeTruthy()
})

test('a collapsible section header is a disclosure button', () => {
  const onToggle = vi.fn()
  render(<SectionHeader title="Spacing" open={false} onToggle={onToggle} controls="spacing-body" />)
  const header = screen.getByRole('button', { name: 'Spacing' })
  expect(header.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(header)
  expect(onToggle).toHaveBeenCalled()
})

test('a soft-disabled tile stays focusable and ignores clicks', () => {
  const onClick = vi.fn()
  render(<Tile label="Heading" icon={Type} softDisabled onClick={onClick} />)
  const tile = screen.getByRole('button', { name: 'Heading' })
  expect(tile.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(tile)
  expect(onClick).not.toHaveBeenCalled()
})

test('a tree row indents by level', () => {
  render(
    <TreeRow level={3} icon={Type}>
      <span>Paragraph</span>
    </TreeRow>,
  )
  // the design indents the row's content 12px per level, inside the row's own 2px bar
  expect((screen.getByText('Paragraph').parentElement as HTMLElement).style.paddingLeft).toBe('36px')
})
