import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { LengthField } from './LengthField'
import { lengthError } from './length'
import { INHERITED_NOTE, RESET_LABEL } from './types'

afterEach(cleanup)

function renderField(over: Partial<React.ComponentProps<typeof LengthField>> = {}) {
  const onCommit = vi.fn()
  const onPreview = vi.fn()
  const onCancel = vi.fn()
  const result = render(
    <LengthField label="Font Size" value="15px" onCommit={onCommit} onPreview={onPreview} onCancel={onCancel} {...over} />,
  )
  return { onCommit, onPreview, onCancel, ...result }
}

const input = () => screen.getByLabelText('Font Size') as HTMLInputElement

test('the number is shown without its unit, which sits beside it', () => {
  renderField()
  expect(input().value).toBe('15')
  expect(screen.getByText('px')).toBeTruthy()
})

test('Enter commits the number with its unit', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: null })

  await user.click(input())
  await user.keyboard('24{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('24px')
})

test('leaving the field commits it too', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: null })

  await user.click(input())
  await user.keyboard('18')
  await user.tab()
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('18px')
})

test('an arrow steps by one and previews rather than committing', async () => {
  const user = userEvent.setup()
  const { onCommit, onPreview } = renderField()

  await user.click(input())
  await user.keyboard('{ArrowUp}')
  expect(input().value).toBe('16')
  expect(onPreview).toHaveBeenLastCalledWith('16px')
  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(input().value).toBe('14')
  expect(onCommit).not.toHaveBeenCalled()
})

test('Shift makes the arrow step ten times as far', async () => {
  const user = userEvent.setup()
  renderField()

  await user.click(input())
  await user.keyboard('{Shift>}{ArrowUp}{/Shift}')
  expect(input().value).toBe('25')
  await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
  expect(input().value).toBe('15')
})

test('a custom step is what the arrows move by', async () => {
  const user = userEvent.setup()
  renderField({ value: '10px', step: 0.5 })

  await user.click(input())
  await user.keyboard('{ArrowUp}')
  expect(input().value).toBe('10.5')
})

test('the arrows stop at min and max', async () => {
  const user = userEvent.setup()
  renderField({ value: '1px', min: 0, max: 3 })

  await user.click(input())
  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
  expect(input().value).toBe('0')
  await user.keyboard('{Shift>}{ArrowUp}{/Shift}')
  expect(input().value).toBe('3')
})

test('a unit we cannot emit is refused, and nothing is committed', async () => {
  const user = userEvent.setup()
  const { onCommit, onPreview } = renderField({ value: null })

  for (const bad of ['2em', '1.2rem', 'abc']) {
    await user.clear(input())
    await user.type(input(), bad)
    expect(screen.getByText(lengthError(['px'])), bad).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(onCommit, bad).not.toHaveBeenCalled()
  }
  // typing "2em" previews the valid "2" on the way through; what must never be previewed is the unit we cannot emit
  for (const [previewed] of onPreview.mock.calls) {
    expect(previewed as string).toMatch(/^\d+(\.\d+)?px$/)
  }
})

test('a number below min is refused the same way', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: null, min: 0 })

  await user.type(input(), '-4')
  expect(screen.getByText(lengthError(['px']))).toBeTruthy()
  await user.keyboard('{Enter}')
  expect(onCommit).not.toHaveBeenCalled()
})

test('Escape puts the field back and says the edit was abandoned', async () => {
  const user = userEvent.setup()
  const { onCommit, onCancel } = renderField()

  await user.clear(input())
  await user.type(input(), '99')
  await user.keyboard('{Escape}')
  expect(input().value).toBe('15')
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})

test('emptying the field clears the setting', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField()

  await user.clear(input())
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(null)
})

test('Reset clears it too, and is offered only when the block sets its own', () => {
  const { onCommit } = renderField()
  screen.getByRole('button', { name: RESET_LABEL }).click()
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(null)

  cleanup()
  renderField({ value: null })
  expect(screen.queryByRole('button', { name: RESET_LABEL })).toBeNull()
})

test('what the email sends shows as the placeholder, with a note, when the block sets nothing', () => {
  renderField({ value: null, effective: '15px', inherited: true })
  expect(input().value).toBe('')
  expect(input().placeholder).toBe('15')
  expect(screen.getByText(INHERITED_NOTE)).toBeTruthy()
})

test('a percentage is offered only where the unit list allows one', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '50%', units: ['px', '%'] })

  const group = screen.getByRole('radiogroup', { name: 'Font Size Unit' })
  expect(group).toBeTruthy()
  expect(screen.getByRole('radio', { name: '%' }).getAttribute('aria-checked')).toBe('true')

  await user.click(screen.getByRole('radio', { name: 'px' }))
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('50px')
})

test('disabled takes no input, offers no Reset, and is grey rather than faded', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ disabled: true })

  expect(input().disabled).toBe(true)
  expect(input().className).toContain('bg-fill-subtle')
  expect(input().className).not.toContain('opacity')
  expect(screen.queryByRole('button', { name: RESET_LABEL })).toBeNull()

  await user.type(input(), '9')
  expect(onCommit).not.toHaveBeenCalled()
})

test('em and rem can be typed and are written as px, the field settling on that px', async () => {
  const user = userEvent.setup()
  const { onCommit, onPreview } = renderField({ value: null, units: ['px'], emBase: 20 })
  await user.click(screen.getByRole('radio', { name: 'em' }))
  await user.type(screen.getByLabelText('Font Size'), '2')
  expect(screen.getByText('= 40px in the email')).toBeTruthy()
  expect(onPreview).toHaveBeenLastCalledWith('40px')
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('40px')
  expect((screen.getByLabelText('Font Size') as HTMLInputElement).value).toBe('40')
  expect(screen.getByRole('radio', { name: 'px' }).getAttribute('aria-checked')).toBe('true')
})

test('picking em or rem shows the px already in the box in that unit and writes nothing until Enter', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '40px', units: ['px'], emBase: 20 })
  await user.click(screen.getByRole('radio', { name: 'rem' }))                                        // 40px is 2.5rem
  expect((screen.getByLabelText('Font Size') as HTMLInputElement).value).toBe('2.5')
  expect(screen.getByText('= 40px in the email')).toBeTruthy()
  expect(onCommit).not.toHaveBeenCalled()

  await user.click(screen.getByRole('radio', { name: 'em' }))                                         // and 2em at 20px
  expect((screen.getByLabelText('Font Size') as HTMLInputElement).value).toBe('2')
  await user.click(screen.getByRole('radio', { name: 'px' }))                                         // back to px: still 40
  expect((screen.getByLabelText('Font Size') as HTMLInputElement).value).toBe('40')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('40px')

  await user.click(screen.getByRole('radio', { name: 'em' }))
  await user.clear(screen.getByLabelText('Font Size'))
  await user.type(screen.getByLabelText('Font Size'), '1.5{Enter}')
  expect(onCommit).toHaveBeenLastCalledWith('30px')
})
