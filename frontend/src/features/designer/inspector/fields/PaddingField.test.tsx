import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { LINK_SIDES_LABEL, PADDING_ERROR, PaddingField } from './PaddingField'
import { RESET_LABEL } from './types'

afterEach(cleanup)

function renderField(over: Partial<React.ComponentProps<typeof PaddingField>> = {}) {
  const onCommit = vi.fn()
  const onPreview = vi.fn()
  const onCancel = vi.fn()
  const result = render(
    <PaddingField label="Padding" value="10px 20px" onCommit={onCommit} onPreview={onPreview} onCancel={onCancel} {...over} />,
  )
  return { onCommit, onPreview, onCancel, ...result }
}

const side = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const linkToggle = () => screen.getByRole('button', { name: LINK_SIDES_LABEL })

test('a shorthand is spread across the four sides', () => {
  renderField()
  expect([side('Top Padding').value, side('Right Padding').value, side('Bottom Padding').value, side('Left Padding').value])
    .toEqual(['10', '20', '10', '20'])
})

test('linked is where it starts, and typing in one side fills all four', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: null })
  expect(linkToggle().getAttribute('aria-pressed')).toBe('true')

  await user.type(side('Top Padding'), '12')
  expect(side('Left Padding').value).toBe('12')
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('12px')
})

test('unlinked lets one side move on its own', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '10px' })

  await user.click(linkToggle())
  expect(linkToggle().getAttribute('aria-pressed')).toBe('false')

  await user.clear(side('Top Padding'))
  await user.type(side('Top Padding'), '30')
  expect(side('Bottom Padding').value).toBe('10')
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('30px 10px 10px 10px')
})

test('the shorthand written back is the shortest of the one, two and four value forms', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '1px' })

  await user.click(linkToggle())
  await user.clear(side('Right Padding'))
  await user.type(side('Right Padding'), '2')
  await user.clear(side('Left Padding'))
  await user.type(side('Left Padding'), '2')
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenLastCalledWith('1px 2px')
})

test('a per cent side is kept as a per cent', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '10px' })

  await user.click(linkToggle())
  await user.clear(side('Right Padding'))
  await user.type(side('Right Padding'), '5%')
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenLastCalledWith('10px 5% 10px 10px')
})

test('a side that is not a number is flagged on that input, and nothing is committed', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '10px' })

  await user.click(linkToggle())
  await user.clear(side('Right Padding'))
  await user.type(side('Right Padding'), 'abc')

  expect(screen.getByText(PADDING_ERROR)).toBeTruthy()
  expect(side('Right Padding').getAttribute('aria-invalid')).toBe('true')
  expect(side('Top Padding').getAttribute('aria-invalid')).toBe(null)

  await user.keyboard('{Enter}')
  expect(onCommit).not.toHaveBeenCalled()
})

test('a valid edit previews as it is typed', async () => {
  const user = userEvent.setup()
  const { onPreview } = renderField({ value: null })

  await user.type(side('Top Padding'), '8')
  expect(onPreview).toHaveBeenLastCalledWith('8px')
})

test('clearing every side clears the setting', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '10px' })

  await user.clear(side('Top Padding'))
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(null)
})

test('Escape puts every side back', async () => {
  const user = userEvent.setup()
  const { onCommit, onCancel } = renderField()

  await user.clear(side('Top Padding'))
  await user.type(side('Top Padding'), '99')
  await user.keyboard('{Escape}')

  expect(side('Top Padding').value).toBe('10')
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})

test('what the email sends shows as the placeholder on each side', () => {
  renderField({ value: null, effective: '10px 25px' })
  expect(side('Top Padding').placeholder).toBe('10')
  expect(side('Right Padding').placeholder).toBe('25')
})

test('Reset clears the setting', () => {
  const { onCommit } = renderField()
  screen.getByRole('button', { name: RESET_LABEL }).click()
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(null)
})

test('disabled takes no input and is grey rather than faded', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ disabled: true })

  expect(side('Top Padding').disabled).toBe(true)
  expect(side('Top Padding').className).toContain('bg-line-subtle')
  expect(side('Top Padding').className).not.toContain('opacity')

  await user.type(side('Top Padding'), '5')
  expect(onCommit).not.toHaveBeenCalled()
})

test('a side typed in em or rem is written as px and the box shows the px', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: '0px', emBase: 20 })
  await user.click(linkToggle())
  await user.clear(side('Top Padding'))
  await user.type(side('Top Padding'), '2em')
  await user.clear(side('Left Padding'))
  await user.type(side('Left Padding'), '1rem')
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenLastCalledWith('40px 0px 0px 16px')                                     // moving between boxes committed once on the way
  expect(side('Top Padding').value).toBe('40')
})
