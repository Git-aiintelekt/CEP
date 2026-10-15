import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import type { PersonalizationTag } from '@/lib/types'

import { COMBINED_FRAME_TITLE, PreviewTestPane } from './PreviewTestPane'
import { defaultSectionsFor } from './receiptPresets'

afterEach(cleanup)

const TAGS: PersonalizationTag[] = [{
  id: 'first_name', tag_key: 'first_name', label: 'First name', tag_kind: 'STANDARD', data_type: 'STRING', applies_to_channels: ['E_RECEIPT'],
  description: null, sample_value: 'Jordan', default_value: 'there', static_value: null, is_active: true,
}]
const SECTIONS = defaultSectionsFor('STANDARD')

const samples = () => within(screen.getByRole('radiogroup', { name: 'Samples' })).getAllByRole('radio').map((radio) => radio.getAttribute('data-sample'))
const subject = () => screen.getByTestId('inbox-subject').textContent
const preheader = () => screen.getByTestId('inbox-preheader').textContent
const totals = () => document.querySelector('[data-section="totals"]')?.textContent ?? ''
const check = (id: string) => document.querySelector(`[data-check="${id}"]`) as HTMLElement

test('opens on the first eCommerce sample; the data source filters the list', async () => {
  const user = userEvent.setup()
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} />)

  expect(samples()).toEqual(['order-48219', 'order-48204', 'order-48188', 'refund-r1187'])
  expect(screen.getByRole('radio', { name: /Order #48219/ }).getAttribute('aria-checked')).toBe('true')

  await user.click(screen.getByRole('radio', { name: 'POS' }))
  expect(samples()).toEqual(['sale-pos3391', 'sale-pos3376', 'exchange-pos3352'])
  // the selection follows the list rather than pointing at a sample no longer shown
  expect(subject()).toBe('Your Northline receipt · sale #POS-3391')
})

test('choosing a sample rewrites the inbox row and the receipt', async () => {
  const user = userEvent.setup()
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} />)
  expect(subject()).toBe('Your Northline receipt · order #48219')
  expect(preheader()).toBe('Total $144.11 · keep this receipt for returns')

  await user.click(screen.getByRole('radio', { name: /Refund #R-1187/ }))
  expect(subject()).toBe('Your Northline receipt · refund #R-1187')
  expect(preheader()).toBe('Total −$96.12 · keep this receipt for returns')
  expect(totals()).toContain('−$96.12')

  await user.click(screen.getByRole('radio', { name: 'POS' }))
  await user.click(screen.getByRole('radio', { name: /Exchange #POS-3352/ }))
  expect(totals()).toContain('Total$0.00')
  expect(totals()).not.toContain('−$0.00')
})

test('each sample card shows its item count and time', () => {
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} />)
  expect(screen.getByRole('radio', { name: /Order #48219/ }).textContent).toContain('3 items · Sep 22, 2026, 10:14 AM')
  expect(screen.getByRole('radio', { name: /Order #48204/ }).textContent).toContain('1 item ·')
})

test('the device switch sets the frame to 600 or 375 pixels', async () => {
  const user = userEvent.setup()
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} />)
  expect(screen.getByTestId('preview-frame').style.width).toBe('600px')
  await user.click(screen.getByRole('radio', { name: 'Mobile' }))
  expect(screen.getByTestId('preview-frame').style.width).toBe('375px')
})

test('the receipt sits inside the outer email at full opacity', () => {
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} />)
  const outer = screen.getByTestId('outer-email')
  expect(within(outer).getByTestId('receipt')).toBeTruthy()
  expect(outer.querySelector('.opacity-40')).toBeNull()
  expect(screen.queryByRole('button', { name: /send test/i })).toBeNull()
})

test('all five checks show, and the footer flag flips the sender address check', () => {
  const onChecksChange = vi.fn()
  const { rerender } = render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} onChecksChange={onChecksChange} />)
  expect(within(screen.getByRole('complementary', { name: 'Checks' })).getAllByRole('listitem')).toHaveLength(5)
  expect(check('sender-address').dataset.status).toBe('pass')
  expect(onChecksChange).toHaveBeenLastCalledWith({ total: 5, failing: 0 })

  rerender(<PreviewTestPane sections={SECTIONS} hasFooterBlock={false} tags={TAGS} onChecksChange={onChecksChange} />)
  expect(check('sender-address').dataset.status).toBe('fail')
  expect(check('sender-address').textContent).toContain('add a Footer block')
  expect(onChecksChange).toHaveBeenLastCalledWith({ total: 5, failing: 1 })
})

test('a failing check reads as a warning, a passing one does not', () => {
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock={false} tags={[]} />)
  expect(check('sender-address').querySelector('p')?.className).toContain('text-warning-text')
  expect(check('no-unsubscribe').querySelector('p')?.className).not.toContain('text-warning-text')
  expect(check('personalization-fallback').dataset.status).toBe('fail')
})

// ---- with the real email ---------------------------------------------------

test('given a renderer, the pane shows the whole email in a sandboxed frame instead of the stand-in', () => {
  const renderCombinedHtml = vi.fn((transaction: { order_number: string }) => `<html><body>EMAIL FOR ${transaction.order_number}</body></html>`)
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} renderCombinedHtml={renderCombinedHtml} />)

  const frame = screen.getByTitle(COMBINED_FRAME_TITLE) as HTMLIFrameElement
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(frame.getAttribute('srcdoc')).toBe('<html><body>EMAIL FOR #48219</body></html>')
  expect(screen.queryByTestId('outer-email')).toBeNull()
})

test('choosing another sample renders the email again for it', async () => {
  const user = userEvent.setup()
  const renderCombinedHtml = vi.fn((transaction: { order_number: string }) => `<p>${transaction.order_number}</p>`)
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} renderCombinedHtml={renderCombinedHtml} />)

  await user.click(screen.getByRole('radio', { name: /Refund #R-1187/ }))
  expect(screen.getByTitle(COMBINED_FRAME_TITLE).getAttribute('srcdoc')).toBe('<p>#R-1187</p>')
  expect(renderCombinedHtml).toHaveBeenLastCalledWith(expect.objectContaining({ order_number: '#R-1187', total: -96.12 }))
})

test('without a renderer the stand-in stays, exactly as before', () => {
  render(<PreviewTestPane sections={SECTIONS} hasFooterBlock tags={TAGS} />)
  expect(screen.getByTestId('outer-email')).toBeTruthy()
  expect(screen.queryByTitle(COMBINED_FRAME_TITLE)).toBeNull()
})
