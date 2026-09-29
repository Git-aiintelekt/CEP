import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { Breadcrumb, CRUMBS_SHOWN, DESKTOP_TAG_LABEL, DESKTOP_TAG_NOTE, ELLIPSIS, NOTHING_SELECTED, PHONES_TAG_LABEL, PHONES_TAG_NOTE, SELECTED_LABEL } from './Breadcrumb'
import { HIDDEN_NOTE } from '../layers/LayersPanel'

afterEach(cleanup)

const chain = [
  { id: 'body', name: 'Email Body' },
  { id: 's1', name: 'Section' },
  { id: 'c1', name: 'Column' },
  { id: 'b1', name: 'Shop now' },
]

test('the chain runs from the email body to the block, ancestors as buttons and the block as text', () => {
  render(<Breadcrumb crumbs={chain} onSelect={vi.fn()} />)
  const nav = screen.getByRole('navigation', { name: 'Selection' })
  expect(nav.className).toContain('h-8')
  expect(within(nav).getByText(SELECTED_LABEL)).toBeTruthy()
  expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Email Body', 'Section', 'Column'])
  const last = within(nav).getByText('Shop now')
  expect(last.tagName).toBe('SPAN')
  expect(last.getAttribute('aria-current')).toBe('location')
  expect(last.className).toContain('font-semibold')
})

test('clicking an ancestor selects it', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<Breadcrumb crumbs={chain} onSelect={onSelect} />)
  await user.click(screen.getByRole('button', { name: 'Column' }))
  expect(onSelect).toHaveBeenCalledWith('c1')
  await user.click(screen.getByRole('button', { name: 'Email Body' }))
  expect(onSelect).toHaveBeenCalledWith('body')
})

test('nothing selected says so, quietly', () => {
  render(<Breadcrumb crumbs={[]} onSelect={vi.fn()} />)
  expect(screen.getByText(NOTHING_SELECTED).className).toContain('text-ink-500')
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})

test('a long chain is cut from the left with an ellipsis that names what was dropped', () => {
  const long = [
    { id: 'body', name: 'Email Body' },
    { id: 'w', name: 'Wrapper' },
    { id: 's', name: 'Section' },
    { id: 'g', name: 'Group' },
    { id: 'c', name: 'Column' },
    { id: 't', name: 'Text' },
  ]
  render(<Breadcrumb crumbs={long} onSelect={vi.fn()} />)
  const nav = screen.getByRole('navigation', { name: 'Selection' })
  const ellipsis = within(nav).getByText(ELLIPSIS)
  expect(ellipsis.getAttribute('title')).toBe('Email Body › Wrapper')
  expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Section', 'Group', 'Column'])
  expect(within(nav).getByText('Text').tagName).toBe('SPAN')
  expect(within(nav).getAllByRole('listitem')).toHaveLength(CRUMBS_SHOWN + 1)
  expect(nav.className).toContain('whitespace-nowrap')
  expect(nav.className).toContain('overflow-hidden')
})

test('a custom name is shown as given', () => {
  render(<Breadcrumb crumbs={[{ id: 'body', name: 'Email Body' }, { id: 'x', name: 'Hero banner' }]} onSelect={vi.fn()} />)
  expect(screen.getByText('Hero banner')).toBeTruthy()
})

test('a single crumb is the block itself, with no button at all', () => {
  render(<Breadcrumb crumbs={[{ id: 'body', name: 'Email Body' }]} onSelect={vi.fn()} />)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(screen.getByText('Email Body').tagName).toBe('SPAN')
})

// ---- hidden on phones ----------------------------------------------------

test('the selected block says when it is hidden on phones', () => {
  render(<Breadcrumb crumbs={[{ id: 'body', name: 'Email Body' }, { id: 's1', name: 'Promo', hiddenOnPhones: true }]} onSelect={vi.fn()} />)

  expect(screen.getByText(PHONES_TAG_LABEL)).toBeTruthy()
  expect(screen.getByTitle(PHONES_TAG_NOTE)).toBeTruthy()
})

test('the selected block says when it is hidden on desktop', () => {
  render(<Breadcrumb crumbs={[{ id: 'body', name: 'Email Body' }, { id: 's1', name: 'Phone menu', hiddenOnDesktop: true }]} onSelect={vi.fn()} />)

  expect(screen.getByText(DESKTOP_TAG_LABEL)).toBeTruthy()
  expect(screen.getByTitle(DESKTOP_TAG_NOTE)).toBeTruthy()
  expect(screen.queryByText(PHONES_TAG_LABEL)).toBeNull()
})

test('the tag is worded apart from the layers tree canvas-only hiding', () => {
  expect(PHONES_TAG_NOTE).not.toBe(HIDDEN_NOTE)
  expect(PHONES_TAG_NOTE).toContain('sent')
})

test('a block that is not hidden on phones carries no tag', () => {
  render(<Breadcrumb crumbs={[{ id: 'body', name: 'Email Body' }, { id: 's1', name: 'Promo' }]} onSelect={vi.fn()} />)
  expect(screen.queryByText(PHONES_TAG_LABEL)).toBeNull()
})
