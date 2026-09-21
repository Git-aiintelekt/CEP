import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { FIT_GUTTER, MJML_STACK_WIDTH } from '../zoom/zoom'
import { PHONE_FRAME_CSS } from './decoratePreview'
import { NO_PREHEADER, NO_SUBJECT, SENDER_PLACEHOLDER } from './InboxRow'
import { PreviewPane } from './PreviewPane'
import {
  EMPTY_HINT, EMPTY_LINK_NOTE, EMPTY_TITLE, FAILED_NOTE, FOOTNOTE, LOADING_LABEL, PREVIEW_AS_LABEL, PREVIEW_FRAME_TITLE, PREVIEW_FRAME_WIDTH, PREVIEW_WIDTH,
  SHOW_DETAILS,
} from './previewCopy'
import type { PreviewState } from './previewState'

afterEach(cleanup)

const tag = (tag_key: string, over: Partial<PersonalizationTag> = {}): PersonalizationTag => ({
  id: tag_key, tag_key, label: tag_key, tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null,
  sample_value: null, default_value: null, static_value: null, is_active: true, ...over,
})
const TAGS = [
  tag('first_name', { sample_value: 'Jordan', default_value: 'there' }),
  tag('loyalty_tier', { sample_value: 'Gold' }),
  tag('order_url', { sample_value: 'https://shop.example.com/orders/1' }),
]

const READY: PreviewState = {
  status: 'ready',
  builtAt: '2026-09-22T04:12:00Z',
  html: '<html><head></head><body><p>Hi {{first_name}}</p><a href="{{order_url}}">Track</a></body></html>',
}

function renderPane(state: PreviewState = READY, over: { subject?: string; preheader?: string } = {}) {
  return render(<PreviewPane state={state} subject={over.subject ?? '{{first_name}}, your {{loyalty_tier}} offer'} preheader={over.preheader ?? 'Ends soon'} tags={TAGS} />)
}

const frame = () => screen.getByTitle(PREVIEW_FRAME_TITLE) as HTMLIFrameElement
const radio = (name: string) => screen.getByRole('radio', { name })

// ---- widths --------------------------------------------------------------

const column = () => document.querySelector('[data-preview-width]') as HTMLElement

test('the email is 600 wide on a desktop and 360 on a phone', () => {
  expect(PREVIEW_WIDTH).toEqual({ desktop: 600, mobile: 360 })
})

test('the desktop frame keeps a gutter like the canvas, so a scrollbar that takes up space never narrows the 600', async () => {
  const user = userEvent.setup()
  renderPane()
  expect(PREVIEW_FRAME_WIDTH.desktop).toBe(PREVIEW_WIDTH.desktop + FIT_GUTTER * 2)
  // a 15px scrollbar, the widest in common use, still leaves the email its full width
  expect(PREVIEW_FRAME_WIDTH.desktop - 15).toBeGreaterThanOrEqual(PREVIEW_WIDTH.desktop)
  expect(column().style.width).toBe('648px')
  expect(frame().className).toContain('w-full')

  await user.click(radio('Mobile'))
  expect(column().style.width).toBe('360px')
})

test('the hairline sits outside the frame, so the frame is the full width it is given', () => {
  renderPane()
  expect(column().className).toContain('box-content')
  expect(column().className).toContain('border')
  expect(frame().className).not.toMatch(/\bborder\b/)
})

test('a phone frame hides its scrollbar as a phone does, so the fluid layout keeps its 360; a desktop keeps its own', async () => {
  const user = userEvent.setup()
  renderPane()
  expect(frame().getAttribute('srcdoc')).not.toContain(PHONE_FRAME_CSS)
  await user.click(radio('Mobile'))
  expect(frame().getAttribute('srcdoc')).toContain(PHONE_FRAME_CSS)
})

test('the phone width sits under MJML’s 480px breakpoint, so columns stack and hide-on-phones applies', () => {
  expect(PREVIEW_WIDTH.mobile).toBeLessThan(MJML_STACK_WIDTH)
  expect(PREVIEW_WIDTH.desktop).toBeGreaterThan(MJML_STACK_WIDTH)
})

test('the device switch is the shared segmented control, one radio per width', () => {
  renderPane()
  expect(screen.getByRole('radiogroup', { name: 'Device' })).toBeTruthy()
  expect(radio('Desktop').getAttribute('aria-checked')).toBe('true')
})

// ---- profiles ------------------------------------------------------------

test('Preview as opens on sample values and offers the three profiles', () => {
  renderPane()
  const group = screen.getByRole('radiogroup', { name: PREVIEW_AS_LABEL })
  expect(group).toBeTruthy()
  expect(['Sample values', 'Full profile', 'Empty profile'].map((name) => radio(name).getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
})

test('choosing a profile re-fills the email, the subject and the preheader for that contact', async () => {
  const user = userEvent.setup()
  renderPane()
  expect(frame().getAttribute('srcdoc')).toContain('Jordan')
  expect(screen.getByRole('group', { name: 'Inbox row' }).textContent).toContain('Jordan, your Gold offer')

  await user.click(radio('Full profile'))
  expect(frame().getAttribute('srcdoc')).toContain('Aaliyah')
  expect(screen.getByRole('group', { name: 'Inbox row' }).textContent).toContain('Aaliyah, your GOLD offer')

  await user.click(radio('Empty profile'))
  const row = screen.getByRole('group', { name: 'Inbox row' })
  expect(row.querySelector('[data-fill="default"]')?.textContent).toBe('there')
  expect(row.querySelector('[data-fill="blank"]')?.textContent).toBe('(no value)')
})

test('a link that comes out empty for the contact is called out above the email', async () => {
  const user = userEvent.setup()
  renderPane()
  expect(screen.queryByText(EMPTY_LINK_NOTE)).toBeNull()

  await user.click(radio('Empty profile'))
  expect(screen.getByText(EMPTY_LINK_NOTE)).toBeTruthy()
})

// ---- the inbox row -------------------------------------------------------

test('the inbox row has a placeholder sender, the subject, the preheader and a time, and no character counts', () => {
  renderPane()
  const row = screen.getByRole('group', { name: 'Inbox row' })
  expect(row.textContent).toContain(SENDER_PLACEHOLDER)
  expect(row.textContent).toContain('Ends soon')
  expect(row.textContent).toContain('04:12 UTC')
  expect(row.textContent).not.toMatch(/\d+ \/ \d+/)
})

test('an empty subject and preheader keep their own wording', () => {
  renderPane(READY, { subject: ' ', preheader: '' })
  const row = screen.getByRole('group', { name: 'Inbox row' })
  expect(row.textContent).toContain(NO_SUBJECT)
  expect(row.textContent).toContain(NO_PREHEADER)
})

// ---- states --------------------------------------------------------------

test('while building, the shared spinner says so', () => {
  renderPane({ status: 'loading' })
  expect(screen.getByText(LOADING_LABEL)).toBeTruthy()
  expect(screen.queryByTitle(PREVIEW_FRAME_TITLE)).toBeNull()
})

test('an empty template says there is nothing yet, instead of a white box', () => {
  renderPane({ status: 'empty' })
  expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
  expect(screen.getByText(EMPTY_HINT)).toBeTruthy()
  expect(screen.queryByTitle(PREVIEW_FRAME_TITLE)).toBeNull()
})

test('broken email code is one plain line, the compiler text behind Show details, and no half-rendered email', async () => {
  const user = userEvent.setup()
  renderPane({ status: 'failed', details: ['mj-text cannot be used inside mj-body'] })

  expect(screen.getByRole('alert').textContent).toContain(FAILED_NOTE)
  expect(screen.queryByText(/mj-text cannot be used/)).toBeNull()
  expect(screen.queryByTitle(PREVIEW_FRAME_TITLE)).toBeNull()

  await user.click(screen.getByRole('button', { name: SHOW_DETAILS }))
  expect(screen.getByText(/mj-text cannot be used/)).toBeTruthy()
})

// ---- safety and access ---------------------------------------------------

test('the email sits in a sandbox with no allowances, and the footnote says it is a preview', () => {
  renderPane()
  expect(frame().getAttribute('sandbox')).toBe('')
  expect(screen.getByText(FOOTNOTE)).toBeTruthy()
})

test('the pane offers nothing to edit, so view-only readers use it exactly as editors do', () => {
  renderPane()
  expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  expect(screen.queryAllByRole('switch')).toHaveLength(0)
  for (const control of screen.getAllByRole('radio')) expect((control as HTMLButtonElement).disabled).toBe(false)
})

test('a pane narrower than the email scales it to fit, like the canvas Fit, without changing its width', () => {
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 357 })
  try {
    renderPane()
    // (357 - 32 of padding) / (648 + 2 of hairline) = 0.5
    expect(column().style.transform).toBe('scale(0.5)')
    expect(column().style.width).toBe('648px')
  } finally {
    if (was) Object.defineProperty(HTMLElement.prototype, 'clientWidth', was)
  }
})

test('a pane with room for the email leaves it at its own size', () => {
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
  try {
    renderPane()
    expect(column().style.transform).toBe('')
  } finally {
    if (was) Object.defineProperty(HTMLElement.prototype, 'clientWidth', was)
  }
})
