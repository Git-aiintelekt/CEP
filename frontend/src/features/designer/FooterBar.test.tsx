import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

import { FooterBar, footerNote } from './FooterBar'
import { summarise, type Issue } from './issues'

const issue = (severity: 'error' | 'warning', id: string): Issue => ({
  id, severity, message: id, target: { kind: 'design' }, source: 'live', stale: false,
})

const sum = (errors: number, warnings: number) =>
  summarise([...Array.from({ length: errors }, (_, i) => issue('error', `e${i}`)), ...Array.from({ length: warnings }, (_, i) => issue('warning', `w${i}`))])

function renderFooter(props: Partial<React.ComponentProps<typeof FooterBar>> = {}) {
  return render(
    <MemoryRouter>
      <FooterBar note="No errors." {...props} />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

// ---- footerNote ----------------------------------------------------------

test('errors outrank link warnings and suggestions', () => {
  expect(footerNote(sum(3, 1), 4)).toEqual({ text: '3 errors must be fixed.', tone: 'danger' })
  expect(footerNote(sum(1, 0), 0)).toEqual({ text: '1 error must be fixed.', tone: 'danger' })
})

test('link warnings outrank suggestions and are never danger', () => {
  expect(footerNote(sum(0, 2), 2)).toEqual({ text: '2 link warnings · advisory only.', tone: 'default' })
  expect(footerNote(sum(0, 0), 1)).toEqual({ text: '1 link warning · advisory only.', tone: 'default' })
})

test('suggestions show when there are no errors and no flagged links', () => {
  expect(footerNote(sum(0, 1), 0)).toEqual({ text: '1 warning · advisory only.', tone: 'default' })
  expect(footerNote(sum(0, 2), 0)).toEqual({ text: '2 warnings · advisory only.', tone: 'default' })
})

test('a clean design says so', () => {
  expect(footerNote(sum(0, 0), 0)).toEqual({ text: 'No errors.', tone: 'default' })
})

// ---- FooterBar -----------------------------------------------------------

test('it shows the note and, as designed, no back link of its own', () => {
  renderFooter({ note: '2 errors must be fixed.', noteTone: 'danger' })

  expect(screen.queryByRole('link')).toBeNull()
  const note = screen.getByText('2 errors must be fixed.')
  expect(note.getAttribute('aria-live')).toBe('polite')
  expect(note.className).toContain('text-danger-text')
})

test('Save Draft is the secondary button, as the design has it, whether or not Activate is there', () => {
  renderFooter({ save: { onClick: () => {} } })
  const only = screen.getByRole('button', { name: /Save Draft/ })
  expect(only.className).not.toContain('bg-brand-600')
  expect(only.className).toContain('border-line')
})

test('Save Draft stays secondary once a primary action exists', () => {
  renderFooter({ save: { onClick: () => {} }, primary: { label: 'Activate', onClick: () => {} } })

  expect(screen.getByRole('button', { name: /Save Draft/ }).className).not.toContain('bg-brand-600')
  expect(screen.getByRole('button', { name: 'Activate' }).className).toContain('bg-brand-600')
})

test('read-only shows neither button', () => {
  renderFooter()
  expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
})

test('Save Draft is disabled only while busy', async () => {
  const onClick = vi.fn()
  const user = userEvent.setup()
  const { rerender } = renderFooter({ save: { onClick } })

  await user.click(screen.getByRole('button', { name: /Save Draft/ }))
  expect(onClick).toHaveBeenCalledTimes(1)

  rerender(
    <MemoryRouter>
      <FooterBar note="No errors." save={{ onClick, busy: true }} />
    </MemoryRouter>,
  )
  // busy says so in the label as well as in the state, and swaps the save glyph for the spinner
  const busy = screen.getByRole('button', { name: /Saving/ }) as HTMLButtonElement
  expect(busy.disabled).toBe(true)
  expect(busy.textContent).toContain('Saving…')
  expect(busy.querySelector('.animate-spin')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull()
})

test('a disabled primary stays focusable, does nothing when clicked and explains itself', async () => {
  const onClick = vi.fn()
  const user = userEvent.setup()
  renderFooter({ primary: { label: 'Activate', onClick, disabled: true, disabledReason: 'Save your changes first.' } })

  const button = screen.getByRole('button', { name: 'Activate' })
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.hasAttribute('disabled')).toBe(false) // must stay in the tab order
  expect(button.getAttribute('title')).toBe('Save your changes first.')
  expect(button.className).toContain('bg-line')
  expect(button.className).toContain('text-ink-300')
  expect(button.className).not.toContain('opacity')
  // no leftover primary utilities: two backgrounds or two text colours resolve by stylesheet order
  expect(button.className).not.toContain('bg-brand-600')
  expect(button.className).not.toContain('text-white')

  const described = document.getElementById(button.getAttribute('aria-describedby') ?? '')
  expect(described?.textContent).toBe('Save your changes first.')
  expect(described?.className).toContain('sr-only')

  button.focus()
  expect(document.activeElement).toBe(button)

  await user.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

test('an enabled primary runs and carries no reason', async () => {
  const onClick = vi.fn()
  const user = userEvent.setup()
  renderFooter({ primary: { label: 'Activate', onClick } })

  const button = screen.getByRole('button', { name: 'Activate' })
  expect(button.getAttribute('aria-disabled')).toBeNull()
  expect(button.getAttribute('aria-describedby')).toBeNull()

  await user.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('the labels are generic enough for the campaign wizard', () => {
  renderFooter({ primary: { label: 'Continue to targets', onClick: () => {} } })

  expect(screen.getByRole('button', { name: 'Continue to targets' })).toBeTruthy()
})
