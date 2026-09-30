import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Monitor, Smartphone, Tablet, X } from 'lucide-react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { Button, IconButton } from './Button'
import { buttonClass } from './buttonStyles'
import { controlClass } from './controlStyles'
import { buttonDanger, buttonPrimary, buttonSecondary } from './Form'
import { InputGroup } from './InputGroup'
import { MenuRow } from './MenuRow'
import { Modal } from './Modal'
import { Notice } from './Notice'
import { Popover } from './Popover'
import { ProgressBar } from './ProgressBar'
import { SegmentedControl } from './SegmentedControl'
import { Spinner } from './States'
import { StatusBadge } from './StatusBadge'
import { statusColours } from './statusColours'
import { Switch } from './Switch'
import { Tabs } from './Tabs'
import { tabPanelId } from './tabIds'

afterEach(cleanup)

test('a loading button keeps its label, reports busy and swallows clicks', () => {
  const onClick = vi.fn()
  render(<Button variant="primary" loading onClick={onClick}>Save draft</Button>)
  const button = screen.getByRole('button', { name: /Save draft/ })
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

test('a soft-disabled button stays focusable, looks disabled and does nothing', () => {
  const onClick = vi.fn()
  render(<Button variant="primary" softDisabled onClick={onClick} title="Fix 2 errors first">Activate</Button>)
  const button = screen.getByRole('button', { name: 'Activate' })
  expect((button as HTMLButtonElement).disabled).toBe(false)
  expect(button.className).not.toContain('bg-brand-600')
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

test('the class-string aliases stay identical to the Button looks', () => {
  expect(buttonPrimary).toBe(buttonClass({ variant: 'primary' }))
  expect(buttonSecondary).toBe(buttonClass({ variant: 'secondary' }))
  expect(buttonDanger).toBe(buttonClass({ variant: 'danger' }))
})

test('secondary is a white outline in Blue 600, Blue 100 with Blue 800 on hover and press, and the default variant', () => {
  render(<Button>Cancel</Button>)
  const secondary = screen.getByRole('button', { name: 'Cancel' }).className
  expect(secondary).toContain('border border-brand-600 bg-surface text-brand-600')
  expect(secondary).toContain('hover:border-brand-800 hover:bg-brand-100 hover:text-brand-800')
  expect(secondary).toContain('active:border-brand-800 active:bg-brand-100 active:text-brand-800')
  expect(secondary).not.toMatch(/(^| )bg-brand-600|text-white|opacity|scale/)
  expect(buttonClass()).toBe(buttonClass({ variant: 'secondary' }))
  expect(buttonClass({ size: 'sm' })).toContain('h-8 px-3 rounded-control-md')
  expect(secondary).toContain('h-10 px-4 rounded-control-lg')
})

test('a disabled secondary takes the standard disabled look with a visible grey border, soft or native, never opacity', () => {
  render(<><Button softDisabled>Soft</Button><Button disabled>Native</Button></>)
  const soft = screen.getByRole('button', { name: 'Soft' }).className
  expect(soft).toContain('cursor-not-allowed border border-line bg-fill-subtle text-ink-300')
  expect(soft).not.toContain('border-brand-600')
  expect(soft).not.toContain('hover:')
  const native = screen.getByRole('button', { name: 'Native' }).className
  expect(native).toContain('disabled:cursor-not-allowed disabled:border-line disabled:bg-fill-subtle disabled:text-ink-300')
  expect(`${soft} ${native}`).not.toContain('opacity')
})

test('primary is unchanged: the only solid blue button', () => {
  expect(buttonClass({ variant: 'primary' })).toBe(
    'inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard h-10 px-4 rounded-control-lg bg-brand-600 text-white hover:bg-brand-800 active:bg-brand-800 disabled:cursor-not-allowed disabled:bg-fill-subtle disabled:text-ink-300',
  )
  expect(buttonClass({ variant: 'primary', disabled: true })).toContain('cursor-not-allowed border-line bg-fill-subtle text-ink-300')
})

test('an icon button is named by its label and reports a pressed toggle', () => {
  render(<IconButton label="Show block outlines" icon={X} pressed />)
  const button = screen.getByRole('button', { name: 'Show block outlines' })
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.getAttribute('title')).toBe('Show block outlines')
})

test('a spinner given its own size and colours does not also get the defaults', () => {
  render(<Spinner className="h-4 w-4 border-brand-800 border-t-white" />)
  const ring = screen.getByRole('status')
  expect(ring.className).not.toContain('border-t-brand-600')
  expect(ring.className).not.toContain('h-5')
})

const DEVICES = [
  { value: 'desktop', label: 'Desktop', icon: Monitor },
  { value: 'tablet', label: 'Tablet', icon: Tablet },
  { value: 'mobile', label: 'Mobile', icon: Smartphone },
] as const

function Devices({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  return <SegmentedControl label="Device" options={[...DEVICES]} value={value} onChange={setValue} iconOnly disabled={disabled} />
}

test('a segmented control is one tab stop and arrow keys move the selection', () => {
  render(<Devices />)
  const desktop = screen.getByRole('radio', { name: 'Desktop' })
  expect(desktop.getAttribute('tabindex')).toBe('0')
  expect(screen.getByRole('radio', { name: 'Tablet' }).getAttribute('tabindex')).toBe('-1')

  fireEvent.keyDown(desktop, { key: 'ArrowLeft' })
  const mobile = screen.getByRole('radio', { name: 'Mobile' })
  expect(mobile.getAttribute('aria-checked')).toBe('true')
  expect(document.activeElement).toBe(mobile)

  fireEvent.keyDown(mobile, { key: 'Home' })
  expect(screen.getByRole('radio', { name: 'Desktop' }).getAttribute('aria-checked')).toBe('true')
})

test('a disabled segmented control keeps its selection visible', () => {
  render(<Devices disabled />)
  const desktop = screen.getByRole('radio', { name: 'Desktop' })
  expect((desktop as HTMLButtonElement).disabled).toBe(true)
  expect(desktop.getAttribute('aria-checked')).toBe('true')
})

test('a switch toggles and exposes its state', () => {
  const onChange = vi.fn()
  render(<Switch checked={false} onChange={onChange} label="Full width" />)
  const control = screen.getByRole('switch', { name: 'Full width' })
  expect(control.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(control)
  expect(onChange).toHaveBeenCalledWith(true)
})

function EditorTabs() {
  const [tab, setTab] = useState<'content' | 'preview'>('content')
  return (
    <Tabs
      label="Editor view"
      idPrefix="ed"
      value={tab}
      onChange={setTab}
      tabs={[
        { id: 'content', label: 'Content' },
        { id: 'preview', label: 'Preview' },
      ]}
    />
  )
}

test('tabs move and activate with the arrow keys and point at their panels', () => {
  render(<EditorTabs />)
  const content = screen.getByRole('tab', { name: 'Content' })
  expect(content.getAttribute('aria-controls')).toBe(tabPanelId('ed', 'content'))
  fireEvent.keyDown(content, { key: 'ArrowRight' })
  const preview = screen.getByRole('tab', { name: 'Preview' })
  expect(preview.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(preview)
})

test('a disabled menu row is skipped by the dropdown keys and ignores clicks', () => {
  const onClick = vi.fn()
  render(<MenuRow title="Version 11" detail="Current" disabled onClick={onClick} />)
  const row = screen.getByRole('button', { name: /Version 11/ })
  expect(row.hasAttribute('data-dropdown-item')).toBe(true)
  expect(row.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(row)
  expect(onClick).not.toHaveBeenCalled()
})

test('a popover is a labelled region with an optional close button', () => {
  const onClose = vi.fn()
  render(
    <Popover label="Version history" title="Version history" onClose={onClose}>
      <p>rows</p>
    </Popover>,
  )
  expect(screen.getByRole('region', { name: 'Version history' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalled()
})

test('errors interrupt, warnings and info are polite', () => {
  render(
    <>
      <Notice tone="error">This template was changed elsewhere.</Notice>
      <Notice tone="warning">You are viewing version 9.</Notice>
    </>,
  )
  expect(screen.getByRole('alert').textContent).toContain('changed elsewhere')
  expect(screen.getByRole('status').textContent).toContain('version 9')
})

test('progress is clamped and announced', () => {
  render(<ProgressBar value={140} label="Uploading hero.jpg" />)
  expect(screen.getByRole('progressbar', { name: 'Uploading hero.jpg' }).getAttribute('aria-valuenow')).toBe('100')
})

test('an input group keeps its wiring on the input and marks it invalid', () => {
  render(<InputGroup aria-label="Button link" invalid suffix="px" describedBy="note" defaultValue="ftp://x" />)
  const input = screen.getByRole('textbox', { name: 'Button link' })
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toBe('note')
  expect(screen.getByText('px')).toBeTruthy()
})

const STATUS_TOKENS: [string, string, string][] = [
  ['DRAFT', 'Draft', 'draft'],
  ['TEST_PUBLISHED', 'Test Published', 'test-published'],
  ['PRODUCTION_PUBLISHED', 'Production Published', 'production-published'],
  ['SCHEDULED', 'Scheduled', 'scheduled'],
  ['ACTIVE', 'Active', 'active'],
  ['SENDING', 'Sending', 'active'],
  ['PREPARING', 'Preparing', 'active'],
  ['COMPLETED', 'Completed', 'completed'],
  ['PAUSED', 'Paused', 'paused'],
  ['FAILED', 'Failed', 'failed'],
  ['CANCELLED', 'Cancelled', 'failed'],
  ['ARCHIVED', 'Archived', 'archived'],
  ['PRODUCTION', 'Production', 'production-published'],
  ['TEST', 'Test', 'test-published'],
]

test.each(STATUS_TOKENS)('status %s uses the %s tag tokens', (status, label, colour) => {
  render(<StatusBadge status={status} />)
  expect(screen.getByText(label).className).toContain(`bg-tag-${colour}-bg text-tag-${colour}-text`)
})

test('status tags: an unknown status is neutral grey, nothing is brand blue, and the locked wording wins', () => {
  render(<><StatusBadge status="DRAFT" label="draft" /><StatusBadge status="SOMETHING_NEW" /></>)
  expect(screen.getByText('Draft').className).toContain('bg-tag-draft-bg')
  expect(screen.getByText('Something New').className).toContain('bg-fill-subtle text-ink-800')
  for (const [status] of STATUS_TOKENS) expect(statusColours(status)).not.toMatch(/brand/)
})

test('status tags: only Active, Sending and Preparing carry the dot, in the Active dot colour', () => {
  const { container } = render(<>{STATUS_TOKENS.map(([status]) => <StatusBadge key={status} status={status} />)}</>)
  const dots = [...container.querySelectorAll('[data-live-dot]')]
  expect(dots.map((dot) => dot.parentElement?.textContent)).toEqual(['Active', 'Sending', 'Preparing'])
  for (const dot of dots) {
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    expect(dot.className).toContain('h-1.5 w-1.5 shrink-0 rounded-full bg-tag-active-dot')
  }
})

test('status tags: Archived is the only unfilled tag, a 1px dashed outline; Cancelled uses the Failed colours', () => {
  render(<><StatusBadge status="ARCHIVED" /><StatusBadge status="CANCELLED" /></>)
  expect(screen.getByText('Archived').className).toContain('border border-dashed border-tag-archived-border bg-tag-archived-bg text-tag-archived-text')
  expect(screen.getByText('Cancelled').className).toContain('bg-tag-failed-bg text-tag-failed-text')
  expect(screen.getByText('Cancelled').className).not.toContain('border')
})

test('a sunken field is Gray 100 with no border at rest and white while focused; a disabled one keeps its border and grey text', () => {
  render(
    <>
      <InputGroup aria-label="Search" tone="sunken" />
      <InputGroup aria-label="Search, refused" tone="sunken" invalid />
      <InputGroup aria-label="Search, off" tone="sunken" disabled />
    </>,
  )
  const shell = (name: string) => screen.getByRole('textbox', { name }).parentElement as HTMLElement
  expect(shell('Search').className).toContain('border-transparent bg-surface-sunken focus-within:bg-surface')
  expect(shell('Search, refused').className).toContain('border-danger')
  expect(shell('Search, off').className).toContain('border-line bg-fill-subtle text-ink-300')
  expect(shell('Search, off').className).not.toContain('border-transparent')

  const sunken = controlClass({ tone: 'sunken' })
  expect(sunken).toContain('bg-surface-sunken focus:bg-surface')
  expect(sunken).toContain('border-transparent')
  expect(sunken).toContain('disabled:border-line')
  expect(controlClass({ tone: 'sunken', invalid: true })).not.toContain('border-transparent')
})

test('an ordinary modal still dims the page and closes from its backdrop, Escape and ×, handing focus back', () => {
  const opener = document.createElement('button')
  document.body.appendChild(opener)
  opener.focus()
  const onClose = vi.fn()
  const { unmount } = render(<Modal title="Archive this campaign?" onClose={onClose}><p>Nothing is deleted.</p></Modal>)
  const dialog = screen.getByRole('dialog', { name: 'Archive this campaign?' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  const backdrop = dialog.parentElement as HTMLElement
  expect(backdrop.className).toContain('bg-scrim')
  expect(backdrop.className).toContain('fixed inset-0')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  fireEvent.mouseDown(backdrop)
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(3)
  unmount()
  expect(document.activeElement).toBe(opener)
  opener.remove()
})
