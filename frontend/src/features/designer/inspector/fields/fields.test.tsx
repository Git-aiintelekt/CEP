import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { AlignField } from './AlignField'
import { controlClass } from './controls'
import { LinkField } from './LinkField'
import { SelectField } from './SelectField'
import { TextField } from './TextField'
import { ToggleField } from './ToggleField'
import { LINK_ERROR, linkError } from './link'
import { FONT_WEIGHTS } from './options'
import { INHERITED_NOTE, RESET_LABEL } from './types'

afterEach(cleanup)

const spies = () => ({ onCommit: vi.fn(), onCancel: vi.fn(), onPreview: vi.fn() })

// --- AlignField ---------------------------------------------------------

test('alignment offers the three horizontal choices, each with a name a reader can hear', () => {
  const { onCommit } = spies()
  render(<AlignField label="Alignment" value="center" onCommit={onCommit} />)

  expect(screen.getByRole('radiogroup', { name: 'Alignment' })).toBeTruthy()
  expect(screen.getAllByRole('radio').map((node) => node.getAttribute('aria-label'))).toEqual(['Left', 'Center', 'Right'])
  expect(screen.getByRole('radio', { name: 'Center' }).getAttribute('aria-checked')).toBe('true')
})

test('the vertical axis offers the vertical choices instead', () => {
  render(<AlignField label="Vertical alignment" value="middle" axis="vertical" onCommit={vi.fn()} />)
  expect(screen.getAllByRole('radio').map((node) => node.getAttribute('aria-label'))).toEqual(['Top', 'Middle', 'Bottom'])
})

test('clicking a choice commits it', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  render(<AlignField label="Alignment" value="left" onCommit={onCommit} />)

  await user.click(screen.getByRole('radio', { name: 'Right' }))
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('right')
})

test('the arrows move along the group and wrap at both ends', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  render(<AlignField label="Alignment" value="left" onCommit={onCommit} />)

  screen.getByRole('radio', { name: 'Left' }).focus()
  await user.keyboard('{ArrowRight}')
  expect(onCommit).toHaveBeenLastCalledWith('center')
  await user.keyboard('{ArrowLeft}')
  expect(onCommit).toHaveBeenLastCalledWith('left')
  await user.keyboard('{ArrowLeft}')
  expect(onCommit).toHaveBeenLastCalledWith('right')
})

test('the selected choice is an outline over a tint, never a filled blue', () => {
  render(<AlignField label="Alignment" value="center" onCommit={vi.fn()} />)
  const chosen = screen.getByRole('radio', { name: 'Center' })
  expect(chosen.className).toContain('border-brand-600')
  expect(chosen.className).toContain('bg-brand-100')
  expect(chosen.className).not.toContain('bg-brand-600')
})

test('an inherited alignment is shown as chosen but still offers no Reset', () => {
  render(<AlignField label="Alignment" value={null} effective="center" inherited onCommit={vi.fn()} />)
  expect(screen.getByRole('radio', { name: 'Center' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText(INHERITED_NOTE)).toBeTruthy()
  expect(screen.queryByRole('button', { name: RESET_LABEL })).toBeNull()
})

test('a disabled group still says which choice is the current one, in greys', () => {
  render(<AlignField label="Alignment" value="center" disabled onCommit={vi.fn()} />)
  const chosen = screen.getByRole('radio', { name: 'Center' })
  const other = screen.getByRole('radio', { name: 'Left' })

  expect(chosen.className).not.toBe(other.className)
  for (const node of [chosen, other]) {
    expect(node.className).not.toContain('opacity')
    expect(node.className).not.toContain('brand')
  }
})

test('a disabled group commits nothing, by click or by key', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  render(<AlignField label="Alignment" value="left" disabled onCommit={onCommit} />)

  await user.click(screen.getByRole('radio', { name: 'Right' }))
  screen.getByRole('radio', { name: 'Left' }).focus()
  await user.keyboard('{ArrowRight}')
  expect(onCommit).not.toHaveBeenCalled()
})

// --- ToggleField --------------------------------------------------------

test('a switch reads as on when the value is the one it writes', () => {
  render(<ToggleField label="Full width" value="full-width" onValue="full-width" onCommit={vi.fn()} />)
  expect(screen.getByRole('switch', { name: 'Full width' }).getAttribute('aria-checked')).toBe('true')
})

test('switching on writes the value, and switching off clears the setting', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  const { rerender } = render(<ToggleField label="Full width" value={null} onValue="full-width" onCommit={onCommit} />)

  await user.click(screen.getByRole('switch', { name: 'Full width' }))
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('full-width')

  rerender(<ToggleField label="Full width" value="full-width" onValue="full-width" onCommit={onCommit} />)
  await user.click(screen.getByRole('switch', { name: 'Full width' }))
  expect(onCommit).toHaveBeenLastCalledWith(null)
})

test('a disabled switch is grey rather than faded and does not move', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  render(<ToggleField label="Full width" value={null} onValue="full-width" disabled onCommit={onCommit} />)

  const control = screen.getByRole('switch', { name: 'Full width' })
  expect(control.className).toContain('bg-line-subtle')
  expect(control.className).not.toContain('opacity')
  await user.click(control)
  expect(onCommit).not.toHaveBeenCalled()
})

// --- TextField and LinkField -------------------------------------------

test('plain text commits on Enter and clears when emptied', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  render(<TextField label="Alt text" value={null} onCommit={onCommit} />)

  await user.type(screen.getByLabelText('Alt text'), 'A logo{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('A logo')

  await user.clear(screen.getByLabelText('Alt text'))
  await user.keyboard('{Enter}')
  expect(onCommit).toHaveBeenLastCalledWith(null)
})

test('a link may be a web address, a mailto, a tel, an anchor or a tag', () => {
  for (const good of [
    'https://example.com', 'http://example.com/a?b=1', 'HTTPS://EXAMPLE.COM',
    'mailto:someone@example.com', 'tel:+441234567890', '#top', '{{shop_url}}',
  ]) {
    expect(linkError(good), good).toBe(null)
  }
})

test('javascript: is refused however it is spelled or padded', () => {
  for (const bad of [
    'javascript:alert(1)', 'JavaScript:alert(1)', 'JAVASCRIPT:alert(1)',
    'java\nscript:alert(1)', 'JaVa\nScript:alert(1)', 'java\tscript:alert(1)',
    ' javascript:alert(1)', 'java script:alert(1)', 'javascript\u0000:alert(1)', 'java\u0001script:alert(1)',
  ]) {
    expect(linkError(bad), bad).toBe(LINK_ERROR)
  }
})

test('other schemes and a bare host are refused, because email needs an absolute address', () => {
  for (const bad of ['data:text/html,x', 'vbscript:msgbox', 'file:///etc/passwd', 'example.com', 'ftp://example.com']) {
    expect(linkError(bad), bad).toBe(LINK_ERROR)
  }
})

/** The scheme is read twice, and judging the written value on the stripped text would let these through. */
test('an address broken by a stray space is refused rather than silently mended', () => {
  for (const bad of ['htt ps://example.com', 'http s://x.com', 'https ://x.com', 'h ttps://x.com']) {
    expect(linkError(bad), bad).toBe(LINK_ERROR)
  }
})

test('a bad link keeps its text on screen with the error, and commits nothing until it is fixed', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  render(<LinkField label="Link" value={null} onCommit={onCommit} />)

  const field = screen.getByLabelText('Link') as HTMLInputElement
  await user.type(field, 'javascript:alert(1){Enter}')
  expect(screen.getByText(LINK_ERROR)).toBeTruthy()
  expect(field.value).toBe('javascript:alert(1)')
  expect(onCommit).not.toHaveBeenCalled()

  await user.clear(field)
  await user.type(field, 'https://example.com{Enter}')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('https://example.com')
})

test('Escape drops the bad text and the error with it', async () => {
  const user = userEvent.setup()
  const { onCommit, onCancel } = spies()
  render(<LinkField label="Link" value="https://kept.test" onCommit={onCommit} onCancel={onCancel} />)

  const field = screen.getByLabelText('Link') as HTMLInputElement
  await user.clear(field)
  await user.type(field, 'javascript:alert(1){Enter}')
  expect(screen.getByText(LINK_ERROR)).toBeTruthy()

  await user.keyboard('{Escape}')
  expect(field.value).toBe('https://kept.test')
  expect(screen.queryByText(LINK_ERROR)).toBeNull()
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})

// --- SelectField --------------------------------------------------------

test('a select offers every option plus a row that clears the setting', () => {
  render(<SelectField label="Font weight" value="700" options={FONT_WEIGHTS} onCommit={vi.fn()} />)
  const control = screen.getByLabelText('Font weight') as HTMLSelectElement

  expect([...control.options].map((option) => option.textContent))
    .toEqual(['Default', 'Light', 'Regular', 'Medium', 'Semibold', 'Bold'])
  expect(control.value).toBe('700')
})

test('the empty row names what the email would send instead', () => {
  render(<SelectField label="Font weight" value={null} effective="400" options={FONT_WEIGHTS} onCommit={vi.fn()} />)
  expect((screen.getByLabelText('Font weight') as HTMLSelectElement).options[0].textContent).toBe('Default (Regular)')
})

test('picking an option commits it and picking the empty row clears it', async () => {
  const user = userEvent.setup()
  const { onCommit } = spies()
  render(<SelectField label="Font weight" value="400" options={FONT_WEIGHTS} onCommit={onCommit} />)

  await user.selectOptions(screen.getByLabelText('Font weight'), '600')
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('600')

  await user.selectOptions(screen.getByLabelText('Font weight'), '')
  expect(onCommit).toHaveBeenLastCalledWith(null)
})

test('a disabled select is grey rather than faded', () => {
  render(<SelectField label="Font weight" value="400" options={FONT_WEIGHTS} disabled onCommit={vi.fn()} />)
  const control = screen.getByLabelText('Font weight')
  expect((control as HTMLSelectElement).disabled).toBe(true)
  expect(control.className).toContain('bg-line-subtle')
  expect(control.className).not.toContain('opacity')
})

test('a disabled control carries only the grey colours, so the white ones can never win', () => {
  const disabled = controlClass(false, true).split(' ')
  expect(disabled).toContain('bg-line-subtle')
  expect(disabled).toContain('text-ink-700')
  expect(disabled).not.toContain('bg-surface')
  expect(disabled).not.toContain('text-ink-900')
  expect(disabled.some((name) => name.startsWith('opacity-'))).toBe(false)

  const live = controlClass(false, false).split(' ')
  expect(live).toContain('bg-surface')
  expect(live).not.toContain('bg-line-subtle')
})
