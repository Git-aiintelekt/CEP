import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import type { Issue } from './issues'
import { ERRORS_HEADING, ErrorsPill, LinksPill, WARNINGS_HEADING, type PillKey } from './IssuePills'
import type { LinkEntry } from './links'

const tag = (tag_key: string): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'],
  description: null, sample_value: 'x', default_value: null, static_value: null, is_active: true,
})

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'subject-missing', severity: 'error', message: 'The subject line is empty. Add one before activating.',
  target: { kind: 'field', field: 'subject' }, source: 'live', stale: false, ...over,
})

const warning = (over: Partial<Issue> = {}) =>
  issue({ id: 'subject-long', severity: 'warning', message: 'The subject line is 120 characters.', target: { kind: 'design' }, ...over })

const link = (over: Partial<LinkEntry> = {}): LinkEntry => ({ id: '0:https://a.example.com', url: 'https://a.example.com', label: 'Shop now', kind: 'tracked', element: 'button', flags: [], block: { tag: 'mj-button', nth: 0 }, ...over })

function Pills({ issues = [] as Issue[], links = [] as LinkEntry[], onIssue = () => {}, onLink = () => {} }) {
  const controller = useSingleDropdown<PillKey>()
  return (
    <div>
      <ErrorsPill issues={issues} controller={controller} onJump={onIssue} />
      <LinksPill links={links} tags={[tag('shop_url')]} controller={controller} onJump={onLink} />
      <button type="button">elsewhere</button>
    </div>
  )
}

const errorsPill = () => screen.getByRole('button', { name: /No Errors|Review Errors/ })
const linksPill = () => screen.getByRole('button', { name: /Links ·|Review Links/ })

afterEach(cleanup)

test('with no issues the errors pill is neutral and reads "No Errors"', () => {
  render(<Pills />)
  expect(errorsPill().textContent).toBe('No Errors')
  expect(errorsPill().className).toContain('bg-surface')
  expect(errorsPill().className).not.toContain('bg-danger-bg')
})

test('errors put the pill in the danger tone with a count', () => {
  render(<Pills issues={[issue(), issue({ id: 'not-saved' })]} />)
  expect(errorsPill().textContent).toBe('Review Errors · 2')
  expect(errorsPill().className).toContain('bg-danger-bg')
})

test('warnings alone put the pill in the warning tone and never in the danger one', () => {
  render(<Pills issues={[warning(), warning({ id: 'may-be-clipped' })]} />)
  const pill = screen.getByRole('button', { name: /Warnings/ })
  expect(pill.textContent).toBe('2 Warnings')
  expect(pill.className).toContain('bg-warning-bg')
  expect(pill.className).not.toContain('bg-danger-bg')
})

test('one warning is counted in the singular', () => {
  render(<Pills issues={[warning()]} />)
  expect(screen.getByRole('button', { name: /Warning/ }).textContent).toBe('1 Warning')
})

test('an error outranks a warning in the pill', () => {
  render(<Pills issues={[issue(), warning()]} />)
  expect(errorsPill().textContent).toBe('Review Errors · 1')
  expect(errorsPill().className).toContain('bg-danger-bg')
})

test('the panel opens under its two headings, errors first and warnings after', async () => {
  const user = userEvent.setup()
  render(<Pills issues={[issue(), warning()]} />)

  await user.click(errorsPill())
  const panel = screen.getByRole('region', { name: 'Errors' })
  expect(panel).toBeTruthy()
  expect(screen.getByText(ERRORS_HEADING)).toBeTruthy()
  expect(screen.getByText(WARNINGS_HEADING)).toBeTruthy()

  const rows = panel.querySelectorAll('[data-dropdown-item]')
  expect(rows[0].textContent).toContain('The subject line is empty')
  expect(rows[1].textContent).toContain('120 characters')
})

test('a stale saved issue is marked as of the last save', async () => {
  const user = userEvent.setup()
  render(<Pills issues={[issue({ source: 'saved', stale: true })]} />)

  await user.click(errorsPill())
  expect(screen.getByText('As of last save')).toBeTruthy()
})

test('choosing a row calls onJump, closes the panel and leaves focus off the pill', async () => {
  const onIssue = vi.fn()
  const user = userEvent.setup()
  render(<Pills issues={[issue()]} onIssue={onIssue} />)

  await user.click(errorsPill())
  await user.click(screen.getByRole('button', { name: /The subject line is empty/ }))

  expect(onIssue).toHaveBeenCalledWith(expect.objectContaining({ id: 'subject-missing' }))
  expect(screen.queryByRole('region', { name: 'Errors' })).toBeNull()
  expect(document.activeElement).not.toBe(errorsPill())
})

test('with nothing to fix the open panel says so', async () => {
  const user = userEvent.setup()
  render(<Pills />)

  await user.click(errorsPill())
  expect(screen.getByText('Nothing to fix — all required content resolves.')).toBeTruthy()
  expect(screen.getByText('No warnings.')).toBeTruthy()
})

test('the panel switches to the empty state in place when the last issue clears', async () => {
  const user = userEvent.setup()
  // the issues change underneath the open panel; clicking anything outside it would dismiss it by design
  const { rerender } = render(<Pills issues={[issue()]} />)

  await user.click(errorsPill())
  expect(screen.getByRole('region', { name: 'Errors' })).toBeTruthy()

  rerender(<Pills issues={[]} />)

  expect(screen.getByRole('region', { name: 'Errors' })).toBeTruthy()
  expect(screen.getByText('Nothing to fix — all required content resolves.')).toBeTruthy()
  expect(errorsPill().textContent).toBe('No Errors')
})

test('opening one pill closes the other', async () => {
  const user = userEvent.setup()
  render(<Pills issues={[issue()]} links={[link()]} />)

  await user.click(errorsPill())
  expect(screen.getByRole('region', { name: 'Errors' })).toBeTruthy()

  await user.click(linksPill())
  expect(screen.queryByRole('region', { name: 'Errors' })).toBeNull()
  expect(screen.getByRole('region', { name: 'Links' })).toBeTruthy()
})

test('Escape closes the panel and returns focus to the pill', async () => {
  const user = userEvent.setup()
  render(<Pills issues={[issue()]} />)

  await user.click(errorsPill())
  await user.keyboard('{Escape}')

  expect(screen.queryByRole('region', { name: 'Errors' })).toBeNull()
  expect(document.activeElement).toBe(errorsPill())
})

test('the pills carry the dropdown aria wiring', async () => {
  const user = userEvent.setup()
  render(<Pills issues={[issue()]} />)

  expect(errorsPill().getAttribute('aria-expanded')).toBe('false')
  expect(errorsPill().getAttribute('aria-haspopup')).toBe('dialog')

  await user.click(errorsPill())
  expect(errorsPill().getAttribute('aria-expanded')).toBe('true')
  expect(errorsPill().getAttribute('aria-controls')).toBe(screen.getByRole('region', { name: 'Errors' }).id)
})

test('the links pill counts links when none are flagged', () => {
  render(<Pills links={[link(), link({ id: '1:x', url: 'https://b.example.com' })]} />)
  expect(linksPill().textContent).toBe('Links · 2')
  expect(linksPill().className).toContain('bg-surface')
})

test('the links pill counts only flagged links and is warning, never danger', () => {
  render(<Pills links={[link(), link({ id: '1:x', url: 'http://b.example.com', flags: ['insecure'] })]} />)

  expect(linksPill().textContent).toBe('Review Links · 1')
  expect(linksPill().className).toContain('bg-warning-bg')
  expect(linksPill().className).not.toContain('danger')
  expect(linksPill().className).not.toContain('brand')
})

test('a link row shows the url, label, tracking tag and a plain-words note', async () => {
  const user = userEvent.setup()
  render(<Pills links={[link({ url: 'http://b.example.com', label: 'Sale', flags: ['insecure'] }), link({ id: '2:m', url: 'mailto:a@b.com', label: 'Mail', kind: 'advisory' })]} />)

  await user.click(linksPill())
  expect(screen.getByText('http://b.example.com')).toBeTruthy()
  expect(screen.getByText('Uses http:// instead of https://')).toBeTruthy()
  expect(screen.getByText('Tracked')).toBeTruthy()
  expect(screen.getByText('Advisory')).toBeTruthy()
})

test('an unknown tag in a link is explained by name', async () => {
  const user = userEvent.setup()
  render(<Pills links={[link({ url: '{{mystery}}', flags: ['unknown-tag'] })]} />)

  await user.click(linksPill())
  expect(screen.getByText('The tag {{mystery}} is not a known personalization tag')).toBeTruthy()
})

test('an empty link is explained in the words of the thing it came from', async () => {
  const user = userEvent.setup()
  render(
    <Pills
      links={[
        link({ id: 'b', url: '', label: 'Shop now', element: 'button', flags: ['empty'] }),
        link({ id: 's', url: '', label: 'facebook', element: 'social', flags: ['empty'] }),
        link({ id: 'a', url: '', label: 'Read more', element: 'link', flags: ['empty'] }),
      ]}
    />,
  )

  await user.click(linksPill())
  expect(screen.getByText('This button has no link')).toBeTruthy()
  expect(screen.getByText('This icon has no link')).toBeTruthy()
  expect(screen.getByText('This link has no destination')).toBeTruthy()
})

test('with no links the panel offers a hint', async () => {
  const user = userEvent.setup()
  render(<Pills />)

  await user.click(linksPill())
  expect(screen.getByText('No links in this email yet.')).toBeTruthy()
  expect(linksPill().textContent).toBe('Links · 0')
})

test('choosing a link row calls onJump and closes', async () => {
  const onLink = vi.fn()
  const user = userEvent.setup()
  render(<Pills links={[link()]} onLink={onLink} />)

  await user.click(linksPill())
  await user.click(screen.getByRole('button', { name: /Shop now/ }))

  expect(onLink).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://a.example.com' }))
  expect(screen.queryByRole('region', { name: 'Links' })).toBeNull()
})

test('arrow keys move between rows inside the panel', async () => {
  const user = userEvent.setup()
  render(<Pills issues={[issue(), issue({ id: 'not-saved', message: 'Save the email once before continuing.' })]} />)

  await user.click(errorsPill())
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement?.textContent).toContain('The subject line is empty')

  await user.keyboard('{ArrowDown}')
  expect(document.activeElement?.textContent).toContain('Save the email once')
})

test('an issue row shows what is wrong on one line and what to do on the next', async () => {
  const user = userEvent.setup()
  render(<Pills issues={[issue()]} />)
  await user.click(errorsPill())
  expect(screen.getByText('The subject line is empty')).toBeTruthy()
  expect(screen.getByText('Add one before activating.')).toBeTruthy()
})
