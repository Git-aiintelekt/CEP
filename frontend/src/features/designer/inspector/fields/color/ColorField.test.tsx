import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { RESET_LABEL } from '../types'
import { CONTRAST_HINT, ColorField, HEX_ERROR, SWATCH_LABEL } from './ColorField'
import { AREA_LABEL, HEX_LABEL, HUE_LABEL, NO_COLOR_LABEL, RECENT_LABEL } from './ColorPicker'

afterEach(cleanup)

/** jsdom has no layout and no pointer capture; the picker uses both. */
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => true)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 248, bottom: 120, width: 248, height: 120, toJSON: () => ({}),
  })
})

function renderField(over: Partial<React.ComponentProps<typeof ColorField>> = {}) {
  const onCommit = vi.fn()
  const onPreview = vi.fn()
  const onCancel = vi.fn()
  const onRecentUse = vi.fn()
  const result = render(
    <ColorField
      label="Text Color" value="#2753e4"
      onCommit={onCommit} onPreview={onPreview} onCancel={onCancel} onRecentUse={onRecentUse}
      {...over}
    />,
  )
  return { onCommit, onPreview, onCancel, onRecentUse, ...result }
}

const swatch = () => screen.getByRole('button', { name: new RegExp(SWATCH_LABEL) })
const hexInput = () => screen.getByLabelText('Text Color') as HTMLInputElement
const area = () => screen.getByRole('slider', { name: AREA_LABEL })
const hue = () => screen.getByRole('slider', { name: HUE_LABEL })

// --- the field itself ---------------------------------------------------

test('the swatch carries the colour and names it', () => {
  renderField()
  expect(swatch().style.backgroundColor).toBe('rgb(39, 83, 228)')
  expect(swatch().getAttribute('aria-label')).toBe(`${SWATCH_LABEL}: Brand Blue`)
})

test('no colour shows a slash on white rather than a fill', () => {
  renderField({ value: null })
  expect(swatch().style.backgroundColor).toBe('')
  expect(swatch().querySelector('svg')).toBeTruthy()
  expect(swatch().getAttribute('aria-label')).toBe(`${SWATCH_LABEL}: No Colour`)
})

test('a typed hex is normalised to six lowercase digits when it commits', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: null })

  await user.type(hexInput(), '#ABC{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('#aabbcc')
  expect(hexInput().value).toBe('#aabbcc')
})

test('a hex that is not a hex is refused and nothing is committed', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: null })

  for (const bad of ['#12345', 'rgb(1,2,3)', 'red']) {
    await user.clear(hexInput())
    await user.type(hexInput(), `${bad}{Enter}`)
    expect(screen.getByText(HEX_ERROR), bad).toBeTruthy()
    expect(onCommit, bad).not.toHaveBeenCalled()
  }
})

test('emptying the hex clears the setting, and so does Reset', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField()

  await user.clear(hexInput())
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenLastCalledWith(null)

  await user.click(screen.getByRole('button', { name: RESET_LABEL }))
  expect(onCommit).toHaveBeenLastCalledWith(null)
})

test('what the email sends shows in the swatch and the placeholder when the block sets nothing', () => {
  renderField({ value: null, effective: '#334155', inherited: true })
  expect(swatch().style.backgroundColor).toBe('rgb(51, 65, 85)')
  expect(hexInput().placeholder).toBe('#334155')
})

test('the readability hint appears only when the pair is below the AA ratio', () => {
  renderField({ value: '#808080', against: '#ffffff' })
  expect(screen.getByText(CONTRAST_HINT)).toBeTruthy()

  cleanup()
  renderField({ value: '#000000', against: '#ffffff' })
  expect(screen.queryByText(CONTRAST_HINT)).toBeNull()

  cleanup()
  renderField({ value: '#808080' }) // nothing to measure against
  expect(screen.queryByText(CONTRAST_HINT)).toBeNull()
})

// --- the popover --------------------------------------------------------

test('the swatch opens the picker, and a disabled swatch does not', async () => {
  const user = userEvent.setup()
  renderField()
  await user.click(swatch())
  expect(screen.getByRole('region', { name: 'Colour Picker' })).toBeTruthy()

  cleanup()
  renderField({ disabled: true })
  await user.click(swatch())
  expect(screen.queryByRole('region', { name: 'Colour Picker' })).toBeNull()
  // and it did not quietly open behind the guard that hides it
  expect(swatch().getAttribute('aria-expanded')).toBe('false')
  expect(swatch().getAttribute('aria-disabled')).toBe('true')
})

test('a swatch in the grid commits that colour once and remembers it', async () => {
  const user = userEvent.setup()
  const { onCommit, onRecentUse } = renderField({ value: null })

  await user.click(swatch())
  await user.click(screen.getByRole('button', { name: 'Heading Navy' }))

  expect(onCommit).toHaveBeenCalledExactlyOnceWith('#0f172a')
  expect(onRecentUse).toHaveBeenCalledExactlyOnceWith('#0f172a')
})

test('dragging the square previews all the way and commits once at the end', async () => {
  const user = userEvent.setup()
  const { onCommit, onPreview } = renderField()

  await user.click(swatch())
  fireEvent.pointerDown(area(), { pointerId: 1, clientX: 10, clientY: 10 })
  for (const x of [40, 80, 120, 160, 200]) fireEvent.pointerMove(area(), { pointerId: 1, clientX: x, clientY: 40 })
  fireEvent.pointerUp(area(), { pointerId: 1, clientX: 200, clientY: 40 })

  expect(onPreview.mock.calls.length).toBeGreaterThanOrEqual(5)
  expect(onCommit).toHaveBeenCalledTimes(1)
})

test('dragging the hue strip behaves the same way', async () => {
  const user = userEvent.setup()
  const { onCommit, onPreview } = renderField()

  await user.click(swatch())
  fireEvent.pointerDown(hue(), { pointerId: 1, clientX: 0, clientY: 0 })
  for (const x of [50, 100, 150, 200]) fireEvent.pointerMove(hue(), { pointerId: 1, clientX: x, clientY: 0 })
  fireEvent.pointerUp(hue(), { pointerId: 1, clientX: 200, clientY: 0 })

  expect(onPreview.mock.calls.length).toBeGreaterThanOrEqual(4)
  expect(onCommit).toHaveBeenCalledTimes(1)
})

test('the arrows move the square by one, and by ten with Shift, committing when it is left', async () => {
  const user = userEvent.setup()
  const { onCommit, onPreview } = renderField({ value: '#808080' })

  await user.click(swatch())
  area().focus()
  const before = Number(area().getAttribute('aria-valuenow'))

  await user.keyboard('{ArrowRight}')
  expect(Number(area().getAttribute('aria-valuenow'))).toBe(before + 1)
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
  expect(Number(area().getAttribute('aria-valuenow'))).toBe(before + 11)

  expect(onPreview).toHaveBeenCalledTimes(2)
  expect(onCommit).not.toHaveBeenCalled()

  fireEvent.blur(area())
  expect(onCommit).toHaveBeenCalledTimes(1)
})

test('the arrows move the hue too', async () => {
  const user = userEvent.setup()
  renderField({ value: '#808080' })

  await user.click(swatch())
  hue().focus()
  await user.keyboard('{ArrowRight}')
  expect(hue().getAttribute('aria-valuenow')).toBe('1')
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
  expect(hue().getAttribute('aria-valuenow')).toBe('11')
})

test('Escape abandons the edit without committing anything', async () => {
  const user = userEvent.setup()
  const { onCommit, onCancel, onPreview } = renderField({ value: '#808080' })

  await user.click(swatch())
  area().focus()
  await user.keyboard('{ArrowRight}')
  expect(onPreview).toHaveBeenCalled()

  await user.keyboard('{Escape}')
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})

test('closing puts focus back on the swatch', async () => {
  const user = userEvent.setup()
  renderField()

  await user.click(swatch())
  expect(screen.getByRole('region', { name: 'Colour Picker' })).toBeTruthy()
  await user.keyboard('{Escape}')

  expect(screen.queryByRole('region', { name: 'Colour Picker' })).toBeNull()
  expect(document.activeElement).toBe(swatch())
})

test('the hex inside the picker commits a normalised value', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ value: null })

  await user.click(swatch())
  const inside = screen.getByLabelText(HEX_LABEL)
  await user.clear(inside)
  await user.type(inside, '#FFF{Enter}')
  expect(onCommit).toHaveBeenLastCalledWith('#ffffff')
})

test('No Colour clears the setting', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField()

  await user.click(swatch())
  await user.click(screen.getByRole('button', { name: NO_COLOR_LABEL }))
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(null)
})

test('recent colours are shown newest first and never more than eight', async () => {
  const user = userEvent.setup()
  const recent = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999']
  renderField({ recent })

  await user.click(swatch())
  const row = screen.getByText(RECENT_LABEL).parentElement as HTMLElement
  const shown = [...row.querySelectorAll('button')].map((node) => node.style.backgroundColor)

  expect(shown).toHaveLength(8)
  expect(shown[0]).toBe('rgb(17, 17, 17)') // #111111, the most recent
  expect(shown).not.toContain('rgb(153, 153, 153)') // #999999 falls off the end
})

test('clicking a recent colour commits it', async () => {
  const user = userEvent.setup()
  const { onCommit } = renderField({ recent: ['#123456'] })

  await user.click(swatch())
  const row = screen.getByText(RECENT_LABEL).parentElement as HTMLElement
  await user.click(row.querySelector('button') as HTMLButtonElement)
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('#123456')
})

test('with nothing recent that row is left out entirely', async () => {
  const user = userEvent.setup()
  renderField({ recent: [] })
  await user.click(swatch())
  expect(screen.queryByText(RECENT_LABEL)).toBeNull()
})
