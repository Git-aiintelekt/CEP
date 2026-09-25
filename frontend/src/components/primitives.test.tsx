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

test('status tags: Draft is orange, Scheduled the one blue status, the rest by severity; the locked wording wins', () => {
  render(
    <>
      <StatusBadge status="DRAFT" label="draft" />
      <StatusBadge status="SCHEDULED" />
      <StatusBadge status="TEST_PUBLISHED" />
      <StatusBadge status="PRODUCTION_PUBLISHED" />
      <StatusBadge status="CANCELLED" />
      <StatusBadge status="ARCHIVED" />
    </>,
  )
  expect(screen.getByText('Draft').className).toContain('bg-draft-bg text-draft-text')
  expect(screen.getByText('Scheduled').className).toContain('bg-brand-100 text-brand-800')
  expect(screen.getByText('Test Published').className).toContain('bg-warning-bg')
  expect(screen.getByText('Production Published').className).toContain('bg-success-bg')
  expect(screen.getByText('Cancelled').className).toContain('bg-danger-bg')
  expect(screen.getByText('Archived').className).toContain('bg-line-subtle')
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
  expect(shell('Search, off').className).toContain('border-line bg-line-subtle text-ink-300')
  expect(shell('Search, off').className).not.toContain('border-transparent')

  const sunken = controlClass({ tone: 'sunken' })
  expect(sunken).toContain('bg-surface-sunken focus:bg-surface')
  expect(sunken).toContain('border-transparent')
  expect(sunken).toContain('disabled:border-line')
  expect(controlClass({ tone: 'sunken', invalid: true })).not.toContain('border-transparent')
})

test('only live statuses (Active, Sending, Preparing) carry the green dot', () => {
  const statuses = ['ACTIVE', 'SENDING', 'PREPARING', 'DRAFT', 'TEST_PUBLISHED', 'PRODUCTION_PUBLISHED', 'SCHEDULED', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED', 'FAILED']
  const { container } = render(<>{statuses.map((status) => <StatusBadge key={status} status={status} />)}</>)
  const withDot = [...container.querySelectorAll('[data-live-dot]')].map((dot) => dot.parentElement?.textContent)
  expect(withDot).toEqual(['Active', 'Sending', 'Preparing'])
  const dot = container.querySelector('[data-live-dot]') as HTMLElement
  expect(dot.getAttribute('aria-hidden')).toBe('true')
  expect(dot.className).toContain('bg-success')
  expect(dot.className).toContain('h-1.5 w-1.5')
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
